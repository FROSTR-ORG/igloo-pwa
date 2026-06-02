import {
  startBrowserRuntimeSession,
  startPersistedBrowserRuntimeSession,
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

// Forwards onboard-served signals from whichever runtime session is currently
// active to a single host-supplied listener (the store sets this during the
// distribute flow to mark a peer's share onboarded).
let onboardCompleteListener: ((peerPubkey: string) => void) | null = null;
let onboardCompleteUnsubscribe: (() => void) | null = null;

export function setOnboardCompleteListener(listener: ((peerPubkey: string) => void) | null) {
  onboardCompleteListener = listener;
}

function attachOnboardCompleteForwarder() {
  if (onboardCompleteUnsubscribe) {
    onboardCompleteUnsubscribe();
    onboardCompleteUnsubscribe = null;
  }
  if (activeRuntimeSession) {
    onboardCompleteUnsubscribe = activeRuntimeSession.onOnboardComplete((peerPubkey) => {
      onboardCompleteListener?.(peerPubkey);
    });
  }
}

async function clearActiveRuntimeSession() {
  if (onboardCompleteUnsubscribe) {
    onboardCompleteUnsubscribe();
    onboardCompleteUnsubscribe = null;
  }
  if (!activeRuntimeSession) return;
  try {
    activeRuntimeSession.stop();
  } catch {
    // Ignore stop failures while replacing or resetting the session.
  }
  activeRuntimeSession = null;
  activeRuntimeProfileId = null;
}

export async function disposeRuntimeSessionForProfile(profileId?: string) {
  if (!profileId || activeRuntimeProfileId === profileId) {
    await clearActiveRuntimeSession();
  }
}

export async function startSession(profile: PwaProfile, unlockPhrase: string): Promise<PwaRuntimeSnapshot> {
  if (!unlockPhrase.trim()) {
    throw new Error('Unlock phrase is required.');
  }
  if (unlockPhrase !== profile.stored_password) {
    throw new Error('Unlock phrase did not match the stored device password.');
  }

  await clearActiveRuntimeSession();
  activeRuntimeSession = profile.runtime_snapshot_json?.trim()
    ? await startPersistedBrowserRuntimeSession({
        groupName: profile.label,
        relays: profile.relays,
        groupPublicKey: profile.group_public_key,
        sharePublicKey: profile.share_public_key,
        peerPubkey: profile.peer_pubkey ?? undefined,
        signerSettings: profile.signer_settings,
        runtimeSnapshotJson: profile.runtime_snapshot_json,
      })
    : await startBrowserRuntimeSession({
        groupName: profile.label,
        relays: profile.relays,
        groupPublicKey: profile.group_public_key,
        sharePublicKey: profile.share_public_key,
        peerPubkey: profile.peer_pubkey ?? undefined,
        signerSettings: profile.signer_settings,
        groupPackageJson: profile.group_package_json,
        sharePackageJson: profile.share_package_json,
      });
  activeRuntimeProfileId = profile.id;
  attachOnboardCompleteForwarder();

  return toRuntimeSnapshot(profile, activeRuntimeSession, true);
}

export async function stopSession(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  if (!activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    throw new Error('No active browser signer session is attached to this profile.');
  }
  const stoppedSnapshot = toRuntimeSnapshot(current.profile, activeRuntimeSession, false);
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
    throw new Error('No active browser signer session is attached to this profile.');
  }
  await activeRuntimeSession.refreshPeers();
  // Build through the single snapshot path so peer_permission_states/events stay
  // in sync; just annotate the log tail with the refresh marker.
  const snapshot = toRuntimeSnapshot(current.profile, activeRuntimeSession, true);
  return {
    ...snapshot,
    runtime_log_lines: [...snapshot.runtime_log_lines, '[info] session refresh completed'],
  };
}

export async function readSession(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot | null> {
  if (!current?.profile) return null;
  if (!activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    throw new Error('No active browser signer session is attached to this profile.');
  }

  return toRuntimeSnapshot(current.profile, activeRuntimeSession, true);
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

  return toRuntimeSnapshot(current.profile, activeRuntimeSession, true);
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

  return toRuntimeSnapshot(current.profile, session, true);
}

export async function clearSessionLogs(current: PwaRuntimeSnapshot | null): Promise<PwaRuntimeSnapshot> {
  if (!current?.profile) {
    throw new Error('Load or onboard a device profile before clearing the runtime log.');
  }
  if (!current.active || !activeRuntimeSession || activeRuntimeProfileId !== current.profile.id) {
    throw new Error('Start the signer before clearing the runtime log.');
  }

  const session = activeRuntimeSession;
  session.clearLogs();

  return toRuntimeSnapshot(current.profile, session, true);
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

  if (relayChanged) {
    const snapshot = activeRuntimeSession.updateConfig(updatedProfile.signer_settings);
    const runtimeProfile = toRuntimeProfile(updatedProfile, snapshot);
    await clearActiveRuntimeSession();
    activeRuntimeSession = await startPersistedBrowserRuntimeSession({
      groupName: runtimeProfile.label,
      relays: runtimeProfile.relays,
      groupPublicKey: runtimeProfile.group_public_key,
      sharePublicKey: runtimeProfile.share_public_key,
      peerPubkey: runtimeProfile.peer_pubkey ?? undefined,
      signerSettings: runtimeProfile.signer_settings,
      runtimeSnapshotJson: runtimeProfile.runtime_snapshot_json,
    });
    activeRuntimeProfileId = runtimeProfile.id;
    attachOnboardCompleteForwarder();
    return toRuntimeSnapshot(runtimeProfile, activeRuntimeSession, true);
  }

  activeRuntimeSession.updateConfig(updatedProfile.signer_settings);
  return toRuntimeSnapshot(updatedProfile, activeRuntimeSession, true);
}
