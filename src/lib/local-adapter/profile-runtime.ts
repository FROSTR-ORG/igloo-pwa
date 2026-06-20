import { decodeBfSharePackage, sharePackageToWireJson } from 'igloo-shared';

import type { PwaProfile, PwaRuntimeSnapshot } from '../types';
import {
  getDefaultSessionController,
  SessionController,
  type SessionEpoch,
} from '../session-controller';
import type { BrowserRuntimeSession } from '../page-runtime-host';
import {
  normalizePwaSignerSettings,
  normalizeRelayList,
  now,
  toRuntimeProfile,
  toRuntimeSnapshot,
  type OperatorSettingsInput,
} from './common';

/* ------------------------------------------------------------------ */
/* Onboard-complete forwarder (distribute flow)                       */
/* ------------------------------------------------------------------ */
// Forwards onboard-served signals from the currently-active runtime session
// to a single host-supplied listener (the store sets this during the
// distribute flow to mark a peer's share onboarded). The active session is
// owned by the SessionController; we (re)subscribe whenever a session starts
// and unsubscribe when it stops. Module-level by design — there is one active
// signer session in the PWA, matching the single store-level listener.
let onboardCompleteListener: ((peerPubkey: string) => void) | null = null;
let onboardCompleteUnsubscribe: (() => void) | null = null;

export function setOnboardCompleteListener(listener: ((peerPubkey: string) => void) | null) {
  onboardCompleteListener = listener;
}

function attachOnboardCompleteForwarder(session: BrowserRuntimeSession) {
  detachOnboardCompleteForwarder();
  onboardCompleteUnsubscribe = session.onOnboardComplete((peerPubkey) => {
    onboardCompleteListener?.(peerPubkey);
  });
}

function detachOnboardCompleteForwarder() {
  if (onboardCompleteUnsubscribe) {
    onboardCompleteUnsubscribe();
    onboardCompleteUnsubscribe = null;
  }
}

/**
 * Resolve which controller a call should use. All adapter helpers now
 * accept an optional controller so that the React store can inject a
 * per-instance one while test code and a future background utility can
 * fall back to the default module-scoped instance.
 */
function resolveController(controller?: SessionController | null): SessionController {
  return controller ?? getDefaultSessionController();
}

/**
 * Profile-runtime extension to a `PwaRuntimeSnapshot`. Captures the
 * monotonically-increasing `SessionEpoch` returned by
 * `SessionController.start()`. Stored in React state so later read /
 * refresh / policy calls can pass it back — stale epochs silently
 * no-op instead of throwing on drift.
 */
export type PwaSessionEpoch = SessionEpoch;

export function getSharePackageJsonForProfile(
  profileId: string,
  controller?: SessionController | null,
): string | null {
  return resolveController(controller).getSharePackageJson(profileId);
}

export function requireSharePackageJsonForProfile(
  profileId: string,
  controller?: SessionController | null,
): string {
  const value = resolveController(controller).getSharePackageJson(profileId);
  if (!value) {
    throw new Error('Signer session is not unlocked. Start the signer with the profile passphrase first.');
  }
  return value;
}

export function clearSharePackageJsonForProfile(
  profileId: string,
  controller?: SessionController | null,
): void {
  resolveController(controller).clearSharePackageJson(profileId);
}

export async function disposeRuntimeSessionForProfile(
  profileId?: string,
  controller?: SessionController | null,
): Promise<void> {
  const target = resolveController(controller);
  if (!profileId || target.getActiveProfileId() === profileId) {
    // Idempotent stop; safe on a fresh controller or on drift.
    detachOnboardCompleteForwarder();
    await target.stop();
  }
  if (profileId) {
    target.clearSharePackageJson(profileId);
  }
}

/**
 * Decrypt the password-sealed share artifact and rebuild a fresh
 * `sharePackageJson` suitable for runtime bootstrap. The passphrase is
 * only held on the stack for the duration of this call. On failure we
 * throw an "Incorrect passphrase" error with a stable, non-leaky
 * message — the AEAD is the authenticator, so there is no timing
 * side-channel to worry about here.
 */
export async function unlockShareFromArtifact(
  profile: Pick<PwaProfile, 'encrypted_bfshare_artifact' | 'member_idx'>,
  passphrase: string,
): Promise<string> {
  try {
    const decoded = await decodeBfSharePackage(
      profile.encrypted_bfshare_artifact,
      passphrase,
    );
    // `member_idx` is persisted directly on the profile record (v2). For
    // legacy callers that still have an older shape, we fall back to 1
    // via `memberIdxFromSharePackageJson(null)` which yields 0 — then
    // we guard against zero to avoid producing an invalid share JSON.
    const memberIdx = profile.member_idx > 0 ? profile.member_idx : 1;
    return sharePackageToWireJson(memberIdx, decoded.shareSecret);
  } catch {
    throw new Error('Incorrect passphrase.');
  }
}

export async function startSession(
  profile: PwaProfile,
  passphrase: string,
  controller?: SessionController | null,
  // Ephemeral, in-memory ONLY (never persisted). When supplied — currently only by
  // the onboard handoff — the signer restores from this runtime snapshot (preserving
  // the nonce pool both sides exchanged during onboarding) instead of re-initializing
  // a fresh, empty pool. Without it a freshly-onboarded device strands the inviter's
  // nonces and can't co-sign until a re-sync.
  restoreSnapshotJson?: string | null,
): Promise<PwaRuntimeSnapshot> {
  if (!passphrase.trim()) {
    throw new Error('Passphrase is required.');
  }
  if (!profile.encrypted_bfshare_artifact?.trim()) {
    // v1 → v2 migration drop: profile is missing the encrypted artifact.
    // Force the user to re-onboard / re-import to produce one.
    throw new Error(
      'This profile was persisted under the legacy v1 schema and no longer has an encrypted share artifact. Re-onboard or re-import the profile to continue.',
    );
  }

  const target = resolveController(controller);
  const sharePackageJson = await unlockShareFromArtifact(profile, passphrase);

  const { session } = await target.start(profile.id, {
    groupName: profile.label,
    relays: profile.relays,
    groupPublicKey: profile.group_public_key,
    sharePublicKey: profile.share_public_key,
    peerPubkey: profile.peer_pubkey ?? undefined,
    signerSettings: profile.signer_settings,
    groupPackageJson: profile.group_package_json,
    sharePackageJson,
    // Restore the exchanged nonce pool when handed an onboard snapshot; otherwise a
    // fresh signer (null) bootstraps an empty pool. Never sourced from persistence.
    runtimeSnapshotJson: restoreSnapshotJson ?? null,
  });

  // Bridge onboard-served signals from this session to the store listener.
  attachOnboardCompleteForwarder(session);

  return toRuntimeSnapshot(profile, session, true, sharePackageJson);
}

export async function stopSession(
  current: PwaRuntimeSnapshot | null,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  if (target.getActiveProfileId() !== current.profile.id) {
    // Idempotent: nothing active for this profile. Do not throw —
    // callers hit this legitimately under React StrictMode double-mount
    // or after a reload.
    return null;
  }
  const session = target.getActiveSession();
  const sharePackageJson = target.getSharePackageJson(current.profile.id);
  // Capture a final stopped snapshot before clearing caches. If the
  // share JSON is already gone, fall back to `toRuntimeSnapshot` without
  // the projection refresh by passing an empty string — the runtime
  // will still surface logs and `active: false`.
  const stoppedSnapshot = session && sharePackageJson
    ? toRuntimeSnapshot(current.profile, session, false, sharePackageJson)
    : { ...(current as PwaRuntimeSnapshot), active: false, runtime_log_lines: [] };
  detachOnboardCompleteForwarder();
  await target.stop();
  return {
    ...stoppedSnapshot,
    active: false,
    runtime_log_lines: [...stoppedSnapshot.runtime_log_lines, '[info] browser signer session stopped'],
  };
}

export async function refreshSession(
  current: PwaRuntimeSnapshot | null,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  const profileId = current.profile.id;
  if (target.getActiveProfileId() !== profileId) {
    return null;
  }
  const sharePackageJson = target.getSharePackageJson(profileId);
  if (!sharePackageJson) {
    return null;
  }
  const refreshed = await target.refresh(profileId, target.currentEpoch());
  if (!refreshed) {
    return null;
  }
  const runtimeProfile = toRuntimeProfile(current.profile, refreshed, sharePackageJson);
  const session = target.getActiveSession();
  return {
    active: true,
    profile: runtimeProfile,
    runtime_status: refreshed.runtimeStatus,
    readiness: refreshed.readiness,
    runtime_log_lines: [
      ...(session?.collectLogs() ?? []),
      '[info] session refresh completed',
    ],
    runtime_host: {
      profile_id: runtimeProfile.id,
      mode: 'browser',
      log_source: 'In-memory session logs',
      started_at: Math.floor(Date.now() / 1000),
      signer_pubkey: refreshed.metadata.share_public_key,
    },
  };
}

export async function readSession(
  current: PwaRuntimeSnapshot | null,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  const profileId = current.profile.id;
  if (target.getActiveProfileId() !== profileId) {
    return null;
  }
  const sharePackageJson = target.getSharePackageJson(profileId);
  if (!sharePackageJson) {
    // Session exists but share JSON is gone — shouldn't happen in
    // practice but bail out rather than reading a stale profile.
    return null;
  }
  // `read()` returns null on stale epoch as well; here we use the
  // current epoch because the store does not track an epoch for this
  // code path yet, but the profile-id guard above is sufficient for
  // correctness.
  const snapshot = target.read(profileId, target.currentEpoch());
  if (!snapshot) {
    return null;
  }
  const session = target.getActiveSession();
  if (!session) {
    return null;
  }
  return toRuntimeSnapshot(current.profile, session, true, sharePackageJson);
}


export async function applyPeerPolicy(
  current: PwaRuntimeSnapshot | null,
  pubkey: string,
  direction: 'request' | 'respond',
  method: 'ping' | 'onboard' | 'sign' | 'ecdh',
  value: boolean,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  const profileId = current.profile.id;
  if (!current.active || target.getActiveProfileId() !== profileId) {
    // Idempotent: drift between the snapshot in React state and the
    // live session. Return null — the store leaves `runtimeSnapshot`
    // untouched instead of throwing.
    return null;
  }
  const applied = await target.applyPeerPolicy(profileId, target.currentEpoch(), {
    pubkey,
    direction,
    method,
    value: value ? 'allow' : 'deny',
  });
  if (!applied) {
    return null;
  }
  const sharePackageJson = target.getSharePackageJson(profileId);
  const session = target.getActiveSession();
  if (!sharePackageJson || !session) {
    return null;
  }
  return toRuntimeSnapshot(current.profile, session, true, sharePackageJson);
}

export async function clearPeerPolicies(
  current: PwaRuntimeSnapshot | null,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  const profileId = current.profile.id;
  if (!current.active || target.getActiveProfileId() !== profileId) {
    return null;
  }
  const cleared = await target.clearPeerPolicies(profileId, target.currentEpoch());
  if (!cleared) {
    return null;
  }
  const sharePackageJson = target.getSharePackageJson(profileId);
  const session = target.getActiveSession();
  if (!sharePackageJson || !session) {
    return null;
  }
  return toRuntimeSnapshot(current.profile, session, true, sharePackageJson);
}

export async function clearSessionLogs(
  current: PwaRuntimeSnapshot | null,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  const target = resolveController(controller);
  const profileId = current.profile.id;
  if (!current.active || target.getActiveProfileId() !== profileId) {
    // Idempotent: snapshot/live-session drift. Leave the snapshot untouched.
    return null;
  }
  const sharePackageJson = target.getSharePackageJson(profileId);
  const session = target.getActiveSession();
  if (!sharePackageJson || !session) {
    return null;
  }
  session.clearLogs();
  return toRuntimeSnapshot(current.profile, session, true, sharePackageJson);
}

export async function applyOperatorSettings(
  profile: PwaProfile,
  current: PwaRuntimeSnapshot | null,
  input: OperatorSettingsInput,
  controller?: SessionController | null,
): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile || !current.active) {
    return null;
  }
  const target = resolveController(controller);
  if (target.getActiveProfileId() !== profile.id) {
    return null;
  }

  const relays = normalizeRelayList(input.relays);
  if (!relays.length) {
    throw new Error('At least one relay is required.');
  }

  const updatedProfile: PwaProfile = {
    ...profile,
    label: input.label.trim() || profile.label,
    relays,
    signer_settings: normalizePwaSignerSettings(input.signerSettings),
    updated_at: now(),
  };

  const previousRelays = profile.relays.join('\n');
  const nextRelays = updatedProfile.relays.join('\n');
  const relayChanged = previousRelays !== nextRelays;

  const sharePackageJson = target.getSharePackageJson(profile.id);
  if (!sharePackageJson) {
    return null;
  }

  const session = target.getActiveSession();
  if (!session) {
    return null;
  }

  if (relayChanged) {
    // Relay change requires a fresh session bootstrap. With
    // `runtime_snapshot_json` persistence deleted under D.1, the
    // caller is responsible for supplying a passphrase to re-unlock
    // the share. We preserve legacy behaviour for the in-memory
    // session: stop the current session and let the caller drive
    // re-start via the main start flow.
    target.updateConfig(profile.id, target.currentEpoch(), updatedProfile.signer_settings);
    const snapshot = toRuntimeSnapshot(updatedProfile, session, true, sharePackageJson);
    await target.stop();
    return {
      ...snapshot,
      active: false,
      runtime_log_lines: [
        ...snapshot.runtime_log_lines,
        '[info] relays changed; stop and restart the signer to bootstrap against the new relays',
      ],
    };
  }

  target.updateConfig(profile.id, target.currentEpoch(), updatedProfile.signer_settings);
  return toRuntimeSnapshot(updatedProfile, session, true, sharePackageJson);
}
