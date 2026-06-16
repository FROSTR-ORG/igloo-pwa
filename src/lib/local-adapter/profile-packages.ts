import {
  createBrowserOnboardingConnection,
  createProfilePackagePair,
  decodeBfProfilePackage,
  finalizeConnectedBrowserProfile,
  finalizeRotatedBrowserProfile,
  importBrowserProfilePackage,
  Secret,
} from 'igloo-shared';

import {
  connectOnboardingPackageAndCaptureProfile,
  type BrowserRuntimeSession,
} from '../page-runtime-host';
import type {
  PwaLoadConfirmation,
  PwaOnboardConnection,
  PwaProfile,
} from '../types';
import {
  createStoredProfileFromPayload,
  toPwaProfile,
  type LoadInput,
  type OnboardConnectInput,
  type OnboardFinalizeInput,
} from './common';
import { unlockShareFromArtifact } from './profile-runtime';

export async function importBfProfile(input: LoadInput): Promise<PwaLoadConfirmation> {
  const imported = await importBrowserProfilePackage(input.profileString, input.password);
  return {
    kind: 'bfprofile',
    preview: imported.preview,
    passphrase: input.password,
    profile_string: imported.profileString,
    share_string: imported.shareString,
    profile_payload: imported.payload,
    manual_peer_policy_overrides: imported.payload.device.manualPeerPolicyOverrides,
  };
}

export async function finalizeLoadedProfile(
  input: PwaLoadConfirmation,
  existingProfileIds: string[] = [],
  localPassword?: string,
): Promise<PwaProfile> {
  if (!input.profile_payload) {
    throw new Error('Missing canonical profile payload.');
  }
  return await createStoredProfileFromPayload({
    payload: input.profile_payload,
    password: localPassword ?? input.passphrase,
    source: input.kind,
    existingProfileIds,
    profileString: input.kind === 'bfprofile' ? input.profile_string : undefined,
    shareString: input.share_string,
    peerPubkey: input.peer_pubkey ?? null,
  });
}

export async function finalizeRotationUpdateFromConnection(input: {
  targetProfile: PwaProfile;
  targetPassphrase: string;
  connection: PwaOnboardConnection;
  existingProfileIds?: string[];
}) {
  if (!input.connection.profile_payload) {
    throw new Error('Missing canonical rotated profile payload.');
  }
  // D.1/PR16b: `share_package_json` is no longer stored on the
  // persisted profile record. Rebuild it in memory by decrypting the
  // target profile's `encrypted_bfshare_artifact` with the passphrase
  // the user entered for this rotation. The reconstructed string lives
  // only on this call's stack frame.
  const targetSharePackageJson = await unlockShareFromArtifact(
    input.targetProfile,
    input.targetPassphrase,
  );
  const finalized = await finalizeRotatedBrowserProfile({
    targetProfile: {
      id: input.targetProfile.id,
      label: input.targetProfile.label,
      relays: input.targetProfile.relays,
      groupPackageJson: input.targetProfile.group_package_json,
      sharePackageJson: targetSharePackageJson,
      manualPeerPolicyOverrides: input.targetProfile.manual_peer_policy_overrides ?? [],
      // In-memory-only passphrase supplied by the caller at rotation
      // time. We never persist it on the profile record.
      storedPassword: input.targetPassphrase,
      runtimeSnapshotJson: null,
      peerPubkey: input.targetProfile.peer_pubkey ?? null,
    },
    connection: {
      preview: input.connection.preview,
      storedPassword: input.connection.passphrase,
      packageText: input.connection.package_text,
      profileString: input.connection.profile_string,
      shareString: input.connection.share_string,
      profilePayload: input.connection.profile_payload,
      manualPeerPolicyOverrides: input.connection.manual_peer_policy_overrides ?? [],
      peerPubkey: input.connection.peer_pubkey ?? null,
      runtimeSnapshotJson: null,
    },
    existingProfileIds: input.existingProfileIds,
  });
  const next = toPwaProfile(finalized);
  return {
    ...next,
    signer_settings: input.targetProfile.signer_settings,
    relay_profile: input.targetProfile.relay_profile,
  } satisfies PwaProfile;
}

export async function connectOnboardingPackage(
  input: OnboardConnectInput,
): Promise<{ connection: PwaOnboardConnection; stagedSession?: BrowserRuntimeSession }> {
  const result = await connectOnboardingPackageAndCaptureProfile({
    packageText: input.packageText.trim(),
    password: input.password,
    groupName: 'Onboarded Device',
    keepAlive: input.keepAlive,
  });
  // The one-shot snapshot JSON carries the incoming share + group. It is
  // only used here to derive the canonical profile payload; the payload
  // is immediately re-encrypted as `encrypted_bfshare_artifact` and the
  // raw snapshot is never persisted to localStorage (D.1). On the onboard
  // (keep-alive) flow the exchanged nonce pool is preserved by adopting the
  // live `stagedSession`, not by restoring this snapshot into a second node.
  const connection = await createBrowserOnboardingConnection({
    packageText: input.packageText,
    password: input.password,
    label: 'Onboarded Device',
    relays: result.profile.relays,
    runtimeSnapshotJson: result.runtimeSnapshotJson,
    peerPubkey: result.profile.peerPubkey ?? result.decoded.peerPubkey,
  });

  return {
    connection: {
      preview: connection.preview,
      passphrase: connection.storedPassword,
      package_text: connection.packageText,
      profile_string: connection.profileString,
      share_string: connection.shareString,
      peer_pubkey: connection.peerPubkey ?? null,
      profile_payload: connection.profilePayload,
      manual_peer_policy_overrides: connection.manualPeerPolicyOverrides,
    },
    // The live onboarding node, present only on the keep-alive (onboard) path.
    // The caller stages it in the SessionController and adopts it at finalize.
    stagedSession: result.stagedSession,
  };
}

export async function finalizeOnboardedDevice(input: OnboardFinalizeInput): Promise<PwaProfile> {
  if (!input.connection.profile_payload) {
    throw new Error('Missing canonical onboarded profile payload.');
  }
  const finalized = await finalizeConnectedBrowserProfile({
    connection: {
      preview: input.connection.preview,
      storedPassword: input.connection.passphrase,
      packageText: input.connection.package_text,
      profileString: input.connection.profile_string,
      shareString: input.connection.share_string,
      profilePayload: input.connection.profile_payload,
      manualPeerPolicyOverrides: input.connection.manual_peer_policy_overrides ?? [],
      peerPubkey: input.connection.peer_pubkey ?? null,
      runtimeSnapshotJson: null,
    },
    label: input.label,
    password: input.password,
    existingProfileIds: input.existingProfileIds,
  });
  return toPwaProfile(finalized);
}

// Re-encrypt a stored profile's package with a fresh export password. The stored
// bfprofile/bfshare strings are encrypted with the profile's local password; we
// decode with that, then re-encode the payload under the export password so the
// exported backup is portable and independent of the local password.
export async function exportEncryptedPackage(input: {
  profileString: string;
  storedPassword: string;
  exportPassword: string;
  format: 'bfprofile' | 'bfshare';
}): Promise<string> {
  const payload = await decodeBfProfilePackage(input.profileString, Secret.of(input.storedPassword));
  const pair = await createProfilePackagePair(payload, Secret.of(input.exportPassword));
  return input.format === 'bfprofile' ? pair.profileString : pair.shareString;
}
