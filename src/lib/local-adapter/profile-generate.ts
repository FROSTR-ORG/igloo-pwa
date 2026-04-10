import {
  buildRotationDraftFromBfshares,
  encodeBfOnboardPackage,
  getWasmKeysetApi,
  groupPackageToWireJson,
  normalizeHex32,
  publicKeyFromSecret,
  sharePackageToWireJson,
  type BrowserOnboardPackagePayload,
} from 'igloo-shared';

import type {
  PwaGeneratedKeyset,
  PwaProfile,
  PwaProfilePreview,
} from '../types';
import {
  createStoredProfileFromPayload,
  normalizeRelayUrls,
  parseJsonObject,
  profilePayloadFromGeneratedShare,
  type DistributionPackageInput,
  type GeneratedKeysetInput,
  type GeneratedProfileInput,
} from './common';

export async function createGeneratedKeyset(input: GeneratedKeysetInput): Promise<PwaGeneratedKeyset> {
  if (!input.groupName.trim()) {
    throw new Error('Group name is required.');
  }
  const api = await getWasmKeysetApi();
  const raw = api.create_keyset_bundle(JSON.stringify({
    group_name: input.groupName.trim(),
    threshold: input.threshold,
    count: input.count,
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
  const draft = await buildRotationDraftFromBfshares({
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

  const shareJson = parseJsonObject(share.share_package_json, 'share package JSON');
  const shareSecret = normalizeHex32(
    typeof shareJson.seckey === 'string' ? shareJson.seckey : '',
    'share secret',
  );

  const payload: BrowserOnboardPackagePayload = {
    shareSecret,
    relays,
    peerPubkey: normalizeHex32(input.signerPubkey, 'peer pubkey'),
  };

  return {
    package_text: await encodeBfOnboardPackage(payload, input.password),
    preview: {
      label: input.label.trim(),
      share_public_key: share.share_public_key,
      group_public_key: input.keyset.group_public_key,
      relays,
      group_package_json: input.keyset.group_package_json,
      share_package_json: share.share_package_json,
      source: 'bfonboard',
    } satisfies PwaProfilePreview,
  };
}
