import {
  buildRotationDraftFromSourcePackages,
  createBrowserOnboardSponsorshipPackage,
  createBrowserOnboardSponsorshipPackageFromBfshare,
  getWasmKeysetApi,
  groupPackageFromWireJson,
  groupPackageToWireJson,
  normalizeHex32,
  publicKeyFromSecret,
  recoverRotationSourceFromPackage,
  recoverSecretKeyFromShares,
  sharePackageToWireJson,
} from 'igloo-shared';
import { nip19 } from 'nostr-tools';

import type {
  PwaGeneratedKeyset,
  PwaProfile,
  PwaProfilePreview,
} from '../types';
import {
  createStoredProfileFromPayload,
  normalizeRelayUrls,
  profilePayloadFromGeneratedShare,
  type DistributionPackageInput,
  type GeneratedKeysetInput,
  type GeneratedProfileInput,
  normalizeRelayList,
} from './common';


function hexToByteArray(hex: string) {
  const normalized = normalizeHex32(hex, 'private key');
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function optionalSigningKeyBytes(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return hexToByteArray(trimmed);
  }
  const decoded = nip19.decode(trimmed);
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) {
    throw new Error('Existing private key must be an nsec or 64-character hex key.');
  }
  return Array.from(decoded.data);
}

export async function createGeneratedKeyset(input: GeneratedKeysetInput): Promise<PwaGeneratedKeyset> {
  if (!input.groupName.trim()) {
    throw new Error('Group name is required.');
  }
  const api = await getWasmKeysetApi();
  const raw = api.create_keyset_bundle(JSON.stringify({
    group_name: input.groupName.trim(),
    threshold: input.threshold,
    count: input.count,
    signing_key32: optionalSigningKeyBytes(input.privateKey),
  }));
  const bundle = JSON.parse(raw) as {
    group: {
      group_name: string;
      group_pk: string;
      threshold: number;
      members: Array<{ idx: number; pubkey: string }>;
    };
    shares: Array<{ idx: number; seckey: string }>;
  };
  const shares = bundle.shares.map((share) => ({
    name: `${input.groupName.trim()} Device ${share.idx}`,
    member_idx: share.idx,
    share_public_key: publicKeyFromSecret(share.seckey),
    share_package_json: sharePackageToWireJson(share.idx, share.seckey),
  }));

  return {
    group_name: input.groupName.trim(),
    threshold: input.threshold,
    count: input.count,
    group_public_key: normalizeHex32(bundle.group.group_pk, 'group public key'),
    group_package_json: groupPackageToWireJson({
      groupName: bundle.group.group_name,
      groupPk: bundle.group.group_pk,
      threshold: bundle.group.threshold,
      members: bundle.group.members,
    }),
    shares,
  };
}

export async function createRotatedKeyset(input: {
  groupName: string;
  threshold: number;
  count: number;
  sources: Array<{ packageText: string; password: string }>;
}): Promise<PwaGeneratedKeyset> {
  if (!input.groupName.trim()) {
    throw new Error('Group name is required.');
  }
  const draft = await buildRotationDraftFromSourcePackages({
    sources: input.sources,
    threshold: input.threshold,
    count: input.count,
    groupName: input.groupName.trim(),
  });
  const groupPackageJson = groupPackageToWireJson({
    groupName: draft.groupName,
    groupPk: draft.groupPublicKey,
    threshold: draft.threshold,
    members: draft.members,
  });
  const shares = draft.shares.map((share) => ({
    name: `${draft.groupName} Device ${share.memberIndex}`,
    member_idx: share.memberIndex,
    share_public_key: share.sharePublicKey,
    share_package_json: sharePackageToWireJson(share.memberIndex, share.shareSecret),
  }));
  return {
    group_name: draft.groupName,
    threshold: draft.threshold,
    count: draft.count,
    group_public_key: draft.groupPublicKey,
    group_package_json: groupPackageJson,
    shares,
  };
}

export async function recoverNsecFromShares(input: {
  sources: Array<{ packageText: string; password: string }>;
}): Promise<{ nsec: string; signingKeyHex: string }> {
  const recoveredSources = await Promise.all(
    input.sources
      .filter((source) => source.packageText.trim() && source.password)
      .map((source) =>
        recoverRotationSourceFromPackage(source.packageText.trim(), source.password),
      ),
  );
  return await recoverSecretKeyFromShares({ sources: recoveredSources });
}

export async function createDeviceProfileFromGeneratedShare(
  input: GeneratedProfileInput,
): Promise<PwaProfile> {
  const relays = normalizeRelayUrls(input.relayUrls);
  if (!relays.length) {
    throw new Error('At least one relay is required.');
  }

  const payload = await profilePayloadFromGeneratedShare(
    input.keyset,
    input.shareMemberIdx,
    input.label,
    relays,
  );

  return await createStoredProfileFromPayload({
    payload,
    password: input.password,
    source: 'generated',
    existingProfileIds: input.existingProfileIds,
  });
}

export async function createOnboardingPackageForShare(input: DistributionPackageInput) {
  const share = input.keyset.shares.find((entry) => entry.member_idx === input.shareMemberIdx);
  if (!share) {
    throw new Error('Share not found for distribution.');
  }
  const relays = normalizeRelayUrls(input.relayUrls);
  if (!relays.length) {
    throw new Error('At least one relay is required.');
  }

  const payload = await profilePayloadFromGeneratedShare(
    input.keyset,
    input.shareMemberIdx,
    input.label,
    relays,
  );
  const sponsored = await createBrowserOnboardSponsorshipPackage({
    label: input.label,
    groupPackage: payload.groupPackage,
    memberIdx: input.shareMemberIdx,
    shareSecret: payload.device.shareSecret,
    relays,
    peerPubkey: input.signerPubkey,
    password: input.password,
  });

  const { share_package_json: _secretSharePackageJson, ...publicPreview } = sponsored.preview;
  return {
    package_text: sponsored.packageText,
    preview: {
      ...publicPreview,
      member_idx: sponsored.memberIdx,
    } satisfies PwaProfilePreview,
  };
}

export async function createSettingsOnboardingPackageFromBfshare(input: {
  profile: PwaProfile;
  label: string;
  sourcePackageText: string;
  sourcePackagePassword: string;
  password: string;
  signerPubkey: string;
}) {
  const relays = normalizeRelayList(input.profile.relays);
  if (!relays.length) {
    throw new Error('At least one relay is required.');
  }

  const sponsored = await createBrowserOnboardSponsorshipPackageFromBfshare({
    label: input.label,
    groupPackage: groupPackageFromWireJson(input.profile.group_package_json),
    sourcePackageText: input.sourcePackageText,
    sourcePackagePassword: input.sourcePackagePassword,
    relays,
    peerPubkey: input.signerPubkey,
    password: input.password,
  });

  const { share_package_json: _secretSharePackageJson, ...publicPreview } = sponsored.preview;
  return {
    package_text: sponsored.packageText,
    preview: {
      ...publicPreview,
      member_idx: sponsored.memberIdx,
    } satisfies PwaProfilePreview,
  };
}
