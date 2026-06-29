import type { Passphrase } from 'igloo-shared';

import {
  startBrowserRuntimeSession,
  type BrowserBootstrapProfile,
  type BrowserRuntimeSession,
  type BrowserRuntimeSessionSnapshot,
} from './page-runtime-host';

/**
 * Monotonic epoch counter for session lifecycles. Every `start()` bumps
 * the controller's epoch; callers cache this value and pass it back on
 * subsequent reads / refreshes / policy edits. Passing a stale epoch is
 * never fatal — the call silently no-ops instead of throwing.
 */
export type SessionEpoch = number;

export type SessionPolicyPatch = {
  pubkey: string;
  direction: 'request' | 'respond';
  method: 'ping' | 'onboard' | 'sign' | 'ecdh';
  value: 'unset' | 'allow' | 'deny' | 'ask';
};

export type SessionBootstrapInput = Omit<BrowserBootstrapProfile, 'sharePackageJson'> & {
  sharePackageJson: string;
};

export type SessionStartOutcome = {
  epoch: SessionEpoch;
  session: BrowserRuntimeSession;
  profileId: string;
};

/**
 * Idempotent, per-instance owner of a single browser signer session.
 *
 * Replaces the module-global singleton pattern that previously lived in
 * `profile-runtime.ts`. Each `PwaStore` creates its own controller, so
 * multi-tab and React-StrictMode double-mount scenarios no longer share
 * state through module scope.
 *
 * Non-throwing contract:
 *   - `stop()` returns `false` on drift (nothing to stop, or a different
 *     profile is currently attached). Never throws.
 *   - `read()` / `refresh()` return `null` when inactive or when the
 *     caller's cached `epoch` is stale. Never throw.
 *   - `applyPeerPolicy()` / `clearPeerPolicies()` return `null` on drift.
 *     Never throw.
 *   - Only `start()` can throw, and only for genuine programming errors
 *     (bad profile, decrypt failure — the legacy error paths).
 */
export class SessionController {
  private session: BrowserRuntimeSession | null = null;
  private profileId: string | null = null;
  private epoch: SessionEpoch = 0;

  /**
   * A live signer session that has been built (the onboarding node, already
   * connected and holding the exchanged nonce pool) but not yet adopted as the
   * active session — because its durable profile is not finalized/saved until
   * the user names + protects the device. Held here, out of React state, so the
   * onboard flow can adopt it (`adoptStagedAsActive`) or tear it down
   * (`discardStagedSession`) at finalize/cancel without a second node + snapshot
   * restore round-trip. At most one staged session exists at a time.
   */
  private stagedSession: BrowserRuntimeSession | null = null;

  /**
   * In-memory cache of the reconstructed `{idx, seckey}` share package
   * JSON per profile id. Populated by whoever owns the unlocked
   * passphrase (typically the `startSession` adapter helper) and read
   * by runtime-snapshot / rotation paths. Never serialized.
   */
  private readonly sharePackageJsonByProfileId = new Map<string, string>();

  /** Current epoch for observability / test introspection. */
  currentEpoch(): SessionEpoch {
    return this.epoch;
  }

  /** `true` while a session is attached to any profile. */
  isActive(): boolean {
    return this.session != null && this.profileId != null;
  }

  /** `true` if the controller is attached to this profile id at this epoch. */
  isFresh(profileId: string, epoch: SessionEpoch): boolean {
    return this.session != null && this.profileId === profileId && this.epoch === epoch;
  }

  /** Access the live session object (caller must check `isFresh()` first). */
  getActiveSession(): BrowserRuntimeSession | null {
    return this.session;
  }

  /** Profile id of the currently-attached session, if any. */
  getActiveProfileId(): string | null {
    return this.profileId;
  }

  /**
   * Read the reconstructed share JSON for a profile. Returns `null` if
   * no session has cached one for this profile.
   */
  getSharePackageJson(profileId: string): string | null {
    return this.sharePackageJsonByProfileId.get(profileId) ?? null;
  }

  /**
   * Stash a freshly-reconstructed share JSON for the given profile id.
   * Called by the adapter after decrypting the encrypted bfshare
   * artifact at session start.
   */
  setSharePackageJson(profileId: string, sharePackageJson: string): void {
    this.sharePackageJsonByProfileId.set(profileId, sharePackageJson);
  }

  /** Drop the cached share JSON for a profile id. */
  clearSharePackageJson(profileId: string): void {
    this.sharePackageJsonByProfileId.delete(profileId);
  }

  /**
   * Start a session for the given profile. Any previously-attached
   * session is stopped first. Bumps the epoch on success. Returns the
   * attached session and the new epoch.
   *
   * The caller is responsible for decrypting the encrypted bfshare
   * artifact and supplying `input.sharePackageJson`. Passphrase lives
   * only on the caller's stack; the controller never sees it.
   *
   * Throws only for genuine programming errors (bad profile data, WASM
   * bootstrap failure). The common "drift" cases callers hit under
   * React StrictMode / multi-tab are handled by `stop()` / `read()`
   * returning null.
   */
  async start(
    profileId: string,
    input: SessionBootstrapInput,
    _passphraseForObservability?: Passphrase,
  ): Promise<SessionStartOutcome> {
    // Drop any pre-existing session before attaching a new one. `stop()` is
    // idempotent so this is safe even on a fresh controller, and it also
    // discards any stranded staged onboarding node (starting a genuine session
    // means we have left the onboard flow).
    await this.stop();

    const session = await startBrowserRuntimeSession(input);
    this.session = session;
    this.profileId = profileId;
    this.epoch += 1;
    this.sharePackageJsonByProfileId.set(profileId, input.sharePackageJson);

    return {
      epoch: this.epoch,
      session,
      profileId,
    };
  }

  /**
   * Park a freshly-built onboarding session (the live node that performed the
   * onboard handshake) until the device profile is finalized. Any previously
   * staged session is discarded first — re-connecting an onboarding package
   * supersedes the prior staged node. Does not touch the active session.
   */
  stageOnboardSession(session: BrowserRuntimeSession): void {
    this.discardStagedSession();
    this.stagedSession = session;
  }

  /** `true` while an onboarding session is staged for adoption. */
  hasStagedSession(): boolean {
    return this.stagedSession != null;
  }

  /**
   * Promote the staged onboarding session to the active session for the given
   * profile id. Stops any current active session first (mirrors `start()`),
   * bumps the epoch, and caches the reconstructed share JSON. Returns the same
   * `SessionStartOutcome` shape as `start()` — but adopts the already-running
   * node instead of building a fresh one and restoring a snapshot.
   *
   * Throws only if nothing is staged (a genuine programming error in the
   * onboard flow ordering).
   */
  async adoptStagedAsActive(
    profileId: string,
    sharePackageJson: string,
  ): Promise<SessionStartOutcome> {
    const staged = this.stagedSession;
    if (!staged) {
      throw new Error('No staged onboarding session to adopt.');
    }
    // Consume the staged slot up front so the `stop()` below (which clears the
    // active session) cannot also tear down the node we are about to adopt.
    this.stagedSession = null;
    await this.stop();

    this.session = staged;
    this.profileId = profileId;
    this.epoch += 1;
    this.sharePackageJsonByProfileId.set(profileId, sharePackageJson);

    return {
      epoch: this.epoch,
      session: staged,
      profileId,
    };
  }

  /**
   * Tear down and clear the staged onboarding session, if any. Idempotent and
   * never throws — safe to call from any onboard-flow exit (cancel, re-connect,
   * navigation away). The share secret + relay subscriptions held by the live
   * node are released here.
   */
  discardStagedSession(): void {
    const staged = this.stagedSession;
    if (!staged) {
      return;
    }
    this.stagedSession = null;
    try {
      staged.stop();
    } catch {
      // Never rethrow on a legitimate teardown.
    }
  }

  /**
   * Stop the currently-attached session. Idempotent: a second call (or
   * a call on a fresh controller) returns `false` without throwing.
   *
   * Does NOT drop the share JSON cache for non-active profiles — the
   * adapter may keep session-scoped reconstructions around for other
   * profiles.
   */
  async stop(): Promise<boolean> {
    // Tearing the active session down also abandons any in-progress onboard
    // flow (e.g. logout / clear-credentials mid-onboard), so release a stranded
    // staged node here too. Runs regardless of whether an active session exists.
    this.discardStagedSession();
    const session = this.session;
    const profileId = this.profileId;
    if (!session) {
      return false;
    }
    try {
      session.stop();
    } catch {
      // Never rethrow on a legitimate stop — StrictMode double-unmount
      // and similar scenarios hit this path.
    }
    this.session = null;
    this.profileId = null;
    if (profileId) {
      this.sharePackageJsonByProfileId.delete(profileId);
    }
    return true;
  }

  /**
   * Read the current session snapshot. Returns `null` if no session is
   * attached, if the requested `profileId` doesn't match the attached
   * profile, or if the caller's cached `epoch` is stale.
   */
  read(profileId: string, epoch: SessionEpoch): BrowserRuntimeSessionSnapshot | null {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return this.session!.read();
    } catch {
      return null;
    }
  }

  /**
   * Refresh peer state for the current session. Returns `null` on drift
   * (inactive, wrong profile, stale epoch). Never throws.
   */
  async refresh(
    profileId: string,
    epoch: SessionEpoch,
  ): Promise<BrowserRuntimeSessionSnapshot | null> {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return await this.session!.refreshPeers();
    } catch {
      return null;
    }
  }

  /**
   * Ping one peer on the current session. Returns `null` on drift. Never throws.
   */
  async pingPeer(
    profileId: string,
    epoch: SessionEpoch,
    pubkey: string,
  ): Promise<Awaited<ReturnType<BrowserRuntimeSession['pingPeer']>> | null> {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return await this.session!.pingPeer(pubkey);
    } catch {
      return null;
    }
  }

  /**
   * Apply a peer-policy override. Returns `null` on drift. Never throws.
   */
  async applyPeerPolicy(
    profileId: string,
    epoch: SessionEpoch,
    patch: SessionPolicyPatch,
  ): Promise<BrowserRuntimeSessionSnapshot | null> {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return await this.session!.updatePeerPolicyOverride(patch.pubkey, {
        direction: patch.direction,
        method: patch.method,
        value: patch.value,
      });
    } catch {
      return null;
    }
  }

  /**
   * Resolve a parked approval (the `ask` disposition). No-op on drift; never throws.
   */
  async resolveApproval(
    profileId: string,
    epoch: SessionEpoch,
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    if (!this.isFresh(profileId, epoch)) return;
    try {
      await this.session!.resolveApproval(requestId, approved);
    } catch {
      // Fire-and-forget: the next runtime-status sync recovers the truth.
    }
  }

  /**
   * Clear all peer-policy overrides on the current session. Returns
   * `null` on drift. Never throws.
   */
  async clearPeerPolicies(
    profileId: string,
    epoch: SessionEpoch,
  ): Promise<BrowserRuntimeSessionSnapshot | null> {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return await this.session!.clearPeerPolicyOverrides();
    } catch {
      return null;
    }
  }

  /**
   * Update runtime config on the attached session. Returns `null` on
   * drift. Never throws.
   */
  updateConfig(
    profileId: string,
    epoch: SessionEpoch,
    settings: Parameters<BrowserRuntimeSession['updateConfig']>[0],
  ): BrowserRuntimeSessionSnapshot | null {
    if (!this.isFresh(profileId, epoch)) {
      return null;
    }
    try {
      return this.session!.updateConfig(settings);
    } catch {
      return null;
    }
  }
}

/**
 * Default module-scoped controller. Retained for adapter call sites
 * that still use the free-function form (no explicit controller
 * injection). The React store creates its own controller and injects
 * it through the adapter helpers; see `store.tsx`.
 */
let defaultController: SessionController | null = null;

export function getDefaultSessionController(): SessionController {
  if (!defaultController) {
    defaultController = new SessionController();
  }
  return defaultController;
}

/**
 * Test hook: reset the default controller between tests. Production
 * code should never need this.
 */
export function __resetDefaultSessionControllerForTests(): void {
  defaultController = null;
}
