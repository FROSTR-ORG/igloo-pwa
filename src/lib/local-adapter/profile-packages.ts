import {
  createBrowserOnboardingConnection,
  finalizeConnectedBrowserProfile,
  finalizeRotatedBrowserProfile,
  importBrowserProfilePackage,
  recoverBrowserProfilePackage,
} from 'igloo-shared';

import { connectOnboardingPackageAndCaptureProfile } from '../page-runtime-host';
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
  type RecoverInput,
} from './common';

export async function importBfProfile(input: LoadInput): Promise<PwaLoadConfirmation> {
  const imported = await importBrowserProfilePackage(input.profileString, input.password);
  return {
    kind: 'bfprofile',
    preview: imported.preview,
    stored_password: input.password,
    profile_string: imported.profileString,
    share_string: imported.shareString,
    profile_payload: imported.payload,
    manual_peer_policy_overrides: imported.payload.device.manualPeerPolicyOverrides,
  };
}

export async function recoverProfileFromBfShare(input: RecoverInput): Promise<PwaLoadConfirmation> {
  const recovered = await recoverBrowserProfilePackage(input.shareString, input.password);
  return {
    kind: 'bfshare',
    preview: recovered.preview,
    stored_password: input.password,
    profile_string: recovered.profileString,
    share_string: recovered.shareString,
    profile_payload: recovered.payload,
    manual_peer_policy_overrides: recovered.payload.device.manualPeerPolicyOverrides,
  };
}

export async function finalizeLoadedProfile(
  input: PwaLoadConfirmation,
  existingProfileIds: string[] = [],
): Promise<PwaProfile> {
  if (!input.profile_payload) {
    throw new Error('Missing canonical profile payload.');
  }
  return await createStoredProfileFromPayload({
    payload: input.profile_payload,
    password: input.stored_password,
    source: input.kind,
    existingProfileIds,
    profileString: input.kind === 'bfprofile' ? input.profile_string : undefined,
    shareString: input.share_string,
    runtimeSnapshotJson: input.runtime_snapshot_json ?? null,
    peerPubkey: input.peer_pubkey ?? null,
  });
}

export async function finalizeRotationUpdateFromConnection(input: {
  targetProfile: PwaProfile;
  connection: PwaOnboardConnection;
  existingProfileIds?: string[];
}) {
  if (!input.connection.profile_payload) {
    throw new Error('Missing canonical rotated profile payload.');
  }
  const finalized = await finalizeRotatedBrowserProfile({
    targetProfile: {
      id: input.targetProfile.id,
      label: input.targetProfile.label,
      relays: input.targetProfile.relays,
      groupPackageJson: input.targetProfile.group_package_json,
      sharePackageJson: input.targetProfile.share_package_json,
      manualPeerPolicyOverrides: input.targetProfile.manual_peer_policy_overrides ?? [],
      storedPassword: input.targetProfile.stored_password,
      runtimeSnapshotJson: input.targetProfile.runtime_snapshot_json ?? null,
      peerPubkey: input.targetProfile.peer_pubkey ?? null,
    },
    connection: {
      preview: input.connection.preview,
      storedPassword: input.connection.stored_password,
      packageText: input.connection.package_text,
      profileString: input.connection.profile_string,
      shareString: input.connection.share_string,
      profilePayload: input.connection.profile_payload,
      manualPeerPolicyOverrides: input.connection.manual_peer_policy_overrides ?? [],
      peerPubkey: input.connection.peer_pubkey ?? null,
      runtimeSnapshotJson: input.connection.runtime_snapshot_json ?? null,
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

export async function connectOnboardingPackage(input: OnboardConnectInput): Promise<PwaOnboardConnection> {
  const result = await connectOnboardingPackageAndCaptureProfile({
    packageText: input.packageText.trim(),
    password: input.password,
    groupName: 'Onboarded Device',
  });
  const connection = await createBrowserOnboardingConnection({
    packageText: input.packageText,
    password: input.password,
    label: 'Onboarded Device',
    relays: result.profile.relays,
    runtimeSnapshotJson: result.runtimeSnapshotJson,
    peerPubkey: result.profile.peerPubkey ?? result.decoded.peerPubkey,
  });

  return {
    preview: connection.preview,
    stored_password: connection.storedPassword,
    package_text: connection.packageText,
    profile_string: connection.profileString,
    share_string: connection.shareString,
    peer_pubkey: connection.peerPubkey ?? null,
    runtime_snapshot_json: connection.runtimeSnapshotJson ?? null,
    profile_payload: connection.profilePayload,
    manual_peer_policy_overrides: connection.manualPeerPolicyOverrides,
  };
}

export async function finalizeOnboardedDevice(input: OnboardFinalizeInput): Promise<PwaProfile> {
  if (!input.connection.profile_payload) {
    throw new Error('Missing canonical onboarded profile payload.');
  }
  const finalized = await finalizeConnectedBrowserProfile({
    connection: {
      preview: input.connection.preview,
      storedPassword: input.connection.stored_password,
      packageText: input.connection.package_text,
      profileString: input.connection.profile_string,
      shareString: input.connection.share_string,
      profilePayload: input.connection.profile_payload,
      manualPeerPolicyOverrides: input.connection.manual_peer_policy_overrides ?? [],
      peerPubkey: input.connection.peer_pubkey ?? null,
      runtimeSnapshotJson: input.connection.runtime_snapshot_json ?? null,
    },
    label: input.label,
    password: input.password,
    existingProfileIds: input.existingProfileIds,
  });
  return toPwaProfile(finalized);
}
