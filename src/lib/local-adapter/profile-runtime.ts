import { decodeBfSharePackage, sharePackageToWireJson } from 'igloo-shared';

import {
  startBrowserRuntimeSession,
  type BrowserRuntimeSession,
} from '../page-runtime-host';
import type { PwaProfile, PwaRuntimeSnapshot } from '../types';
import {
  normalizePwaSignerSettings,
  normalizeRelayList,
  toRuntimeProfile,
  toRuntimeSnapshot,
  type OperatorSettingsInput,
} from './common';

let activeRuntimeSession: BrowserRuntimeSession | null = null;
let activeRuntimeProfileId: string | null = null;

/**
 * Module-scoped in-memory cache of the reconstructed `{idx, seckey}`
 * share package JSON per profile id. Populated on `startSession` after
 * the user's passphrase unlocks `encrypted_bfshare_artifact`, and read
 * by runtime-snapshot / rotation paths that need to re-derive the
 * profile payload. Cleared when the session stops or the profile is
 * deleted. This value CONTAINS THE RAW SHARE SECKEY and is never
 * serialized outside the tab (no localStorage, no postMessage).
 */
const sharePackageJsonByProfileId = new Map<string, string>();

export function getSharePackageJsonForProfile(profileId: string): string | null {
  return sharePackageJsonByProfileId.get(profileId) ?? null;
}

export function requireSharePackageJsonForProfile(profileId: string): string {
  const value = sharePackageJsonByProfileId.get(profileId);
  if (!value) {
    throw new Error('Signer session is not unlocked. Start the signer with the profile passphrase first.');
  }
  return value;
}

export function clearSharePackageJsonForProfile(profileId: string) {
  sharePackageJsonByProfileId.delete(profileId);
}

async function clearActiveRuntimeSession() {
  if (!activeRuntimeSession) return;
  try {
    activeRuntimeSession.stop();
  } catch {
    // Ignore stop failures while replacing or resetting the session.
  }
  if (activeRuntimeProfileId) {
    sharePackageJsonByProfileId.delete(activeRuntimeProfileId);
  }
  activeRuntimeSession = null;
  activeRuntimeProfileId = null;
}

export async function disposeRuntimeSessionForProfile(profileId?: string) {
  if (!profileId || activeRuntimeProfileId === profileId) {
    await clearActiveRuntimeSession();
  }
  if (profileId) {
    sharePackageJsonByProfileId.delete(profileId);
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

export async function startSession(profile: PwaProfile, passphrase: string): Promise<PwaRuntimeSnapshot> {
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

  const sharePackageJson = await unlockShareFromArtifact(profile, passphrase);

  await clearActiveRuntimeSession();
  activeRuntimeSession = await startBrowserRuntimeSession({
    groupName: profile.label,
    relays: profile.relays,
    groupPublicKey: profile.group_public_key,
    sharePublicKey: profile.share_public_key,
    peerPubkey: profile.peer_pubkey ?? undefined,
    signerSettings: profile.signer_settings,
    groupPackageJson: profile.group_package_json,
    sharePackageJson,
  });
  activeRuntimeProfileId = profile.id;
  sharePackageJsonByProfileId.set(profile.id, sharePackageJson);

  return toRuntimeSnapshot(profile, activeRuntimeSession, true, sharePackageJson);
}

export async function stopSession(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  if (!activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    // Idempotent: nothing active for this profile. Do not throw — callers
    // may hit this legitimately under React StrictMode double-mount or
    // after a reload.
    return null;
  }
  const sharePackageJson = sharePackageJsonByProfileId.get(current.profile.id);
  // Capture a final stopped snapshot before clearing caches. If the
  // share JSON is already gone, fall back to `toRuntimeSnapshot` without
  // the projection refresh by passing an empty string — the runtime
  // will still surface logs and `active: false`.
  const stoppedSnapshot = sharePackageJson
    ? toRuntimeSnapshot(current.profile, activeRuntimeSession, false, sharePackageJson)
    : { ...(current as PwaRuntimeSnapshot), active: false, runtime_log_lines: [] };
  await clearActiveRuntimeSession();
  return {
    ...stoppedSnapshot,
    active: false,
    runtime_log_lines: [...stoppedSnapshot.runtime_log_lines, '[info] browser signer session stopped'],
  };
}

export async function refreshSession(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  if (!activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    return null;
  }
  const sharePackageJson = requireSharePackageJsonForProfile(current.profile.id);
  const refreshed = await activeRuntimeSession.refreshPeers();
  const runtimeProfile = toRuntimeProfile(current.profile, refreshed, sharePackageJson);
  return {
    active: true,
    profile: runtimeProfile,
    runtime_status: refreshed.runtimeStatus,
    readiness: refreshed.readiness,
    runtime_log_lines: [...activeRuntimeSession.collectLogs(), '[info] session refresh completed'],
    runtime_host: {
      profile_id: runtimeProfile.id,
      mode: 'browser',
      log_source: 'In-memory session logs',
      started_at: Math.floor(Date.now() / 1000),
      signer_pubkey: refreshed.metadata.share_public_key,
    },
  };
}

export async function readSession(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  if (!activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    return null;
  }
  const sharePackageJson = sharePackageJsonByProfileId.get(current.profile.id);
  if (!sharePackageJson) {
    // Session exists but share JSON is gone — shouldn't happen in
    // practice but bail out rather than reading a stale profile.
    return null;
  }

  return toRuntimeSnapshot(current.profile, activeRuntimeSession, true, sharePackageJson);
}


export async function applyPeerPolicy(
  current: PwaRuntimeSnapshot | null,
  pubkey: string,
  direction: 'request' | 'respond',
  method: 'ping' | 'onboard' | 'sign' | 'ecdh',
  value: boolean,
): Promise<PwaRuntimeSnapshot> {
  if (!current?.profile) {
    throw new Error('Load or onboard a device profile before editing peer policies.');
  }
  if (!current.active || !activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    throw new Error('Start the signer before editing live peer policies.');
  }

  await activeRuntimeSession.updatePeerPolicyOverride(pubkey, {
    direction,
    method,
    value: value ? 'allow' : 'deny',
  });

  const sharePackageJson = requireSharePackageJsonForProfile(current.profile.id);
  return toRuntimeSnapshot(current.profile, activeRuntimeSession, true, sharePackageJson);
}

export async function clearPeerPolicies(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot> {
  if (!current?.profile) {
    throw new Error('Load or onboard a device profile before clearing peer policies.');
  }
  if (!current.active || !activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    throw new Error('Start the signer before clearing live peer policies.');
  }

  const session = activeRuntimeSession;
  await session.clearPeerPolicyOverrides();

  const sharePackageJson = requireSharePackageJsonForProfile(current.profile.id);
  return toRuntimeSnapshot(current.profile, session, true, sharePackageJson);
}

export async function applyOperatorSettings(
  profile: PwaProfile,
  current: PwaRuntimeSnapshot | null,
  input: OperatorSettingsInput,
): Promise<PwaRuntimeSnapshot> {
  if (!current?.profile || !current.active || !activeRuntimeSession || activeRuntimeProfileId !== profile.id) {
    throw new Error('Start the signer before applying live operator settings.');
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
  };

  const previousRelays = profile.relays.join('\n');
  const nextRelays = updatedProfile.relays.join('\n');
  const relayChanged = previousRelays !== nextRelays;

  const sharePackageJson = requireSharePackageJsonForProfile(profile.id);

  if (relayChanged) {
    // Relay change requires a fresh session bootstrap. With
    // `runtime_snapshot_json` persistence deleted under D.1, the
    // caller is responsible for supplying a passphrase to re-unlock
    // the share. We preserve legacy behaviour for the in-memory
    // session: stop the current session and let the caller drive
    // re-start via the main start flow.
    activeRuntimeSession.updateConfig(updatedProfile.signer_settings);
    const snapshot = toRuntimeSnapshot(updatedProfile, activeRuntimeSession, true, sharePackageJson);
    await clearActiveRuntimeSession();
    return {
      ...snapshot,
      active: false,
      runtime_log_lines: [
        ...snapshot.runtime_log_lines,
        '[info] relays changed; stop and restart the signer to bootstrap against the new relays',
      ],
    };
  }

  activeRuntimeSession.updateConfig(updatedProfile.signer_settings);
  return toRuntimeSnapshot(updatedProfile, activeRuntimeSession, true, sharePackageJson);
}
