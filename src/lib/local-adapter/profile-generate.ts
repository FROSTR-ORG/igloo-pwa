import {
  buildRotationDraft,
  decodeBfSharePackage,
  encodeBfOnboardPackage,
  getWasmKeysetApi,
  groupPackageFromWireJson,
  groupPackageToWireJson,
  normalizeHex32,
  publicKeyFromSecret,
  recoverSecretKeyFromShares,
  Secret,
  sharePackageToWireJson,
  type BrowserOnboardPackagePayload,
  type ShareSecretHex,
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
  parseJsonObject,
  profilePayloadFromGeneratedShare,
  type DistributionPackageInput,
  type GeneratedKeysetInput,
  type GeneratedProfileInput,
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
  // The rotating device's own profile group package (wire JSON) — supplies the
  // member indices for the pasted shares, replacing the removed relay fetch.
  groupPackageJson: string;
  groupName: string;
  threshold: number;
  count: number;
  // The rotating device's own password-sealed bfshare artifact + its passphrase.
  // When supplied, the device's own current share is auto-included toward the
  // reconstruction threshold so the operator only pastes the other members'.
  encryptedShareArtifact?: string | null;
  devicePassphrase?: string | null;
  sources: Array<{ packageText: string; password: string }>;
}): Promise<PwaGeneratedKeyset> {
  if (!input.groupName.trim()) {
    throw new Error('Group name is required.');
  }
  // Decode the pasted current-keyset shares locally; the group context comes from
  // the rotating device's own profile (no relay-backup fetch).
  const shareSecrets = await decodeShareSecrets(input.sources);

  // Auto-include the rotating device's own current share when its artifact +
  // passphrase are provided (mirrors the recover flow).
  if (input.encryptedShareArtifact?.trim() && input.devicePassphrase) {
    let deviceShareSecret: ShareSecretHex;
    try {
      const deviceShare = await decodeBfSharePackage(input.encryptedShareArtifact, Secret.of(input.devicePassphrase));
      deviceShareSecret = Secret.of(deviceShare.shareSecret);
    } catch {
      throw new Error('Incorrect device passphrase.');
    }
    shareSecrets.unshift(deviceShareSecret);
  }
  const draft = await buildRotationDraft({
    groupPackage: groupPackageFromWireJson(input.groupPackageJson),
    shareSecrets,
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
    share_package_json: sharePackageToWireJson(share.memberIndex, share.shareSecret.expose()),
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

// Decode a set of pasted bfshare packages into redacting share-secret wrappers,
// skipping empty rows. Each row's password decrypts its own package.
async function decodeShareSecrets(
  sources: Array<{ packageText: string; password: string }>,
): Promise<ShareSecretHex[]> {
  const filled = sources.filter((source) => source.packageText.trim() && source.password);
  const decoded = await Promise.all(
    filled.map((source) => decodeBfSharePackage(source.packageText.trim(), Secret.of(source.password))),
  );
  return decoded.map((share) => Secret.of(share.shareSecret));
}

// Verify a device passphrase unlocks its own bfshare artifact, without running a
// full recovery. Lets the recover UI gate the "this device — validated" state on
// a real unlock instead of optimistically counting the device share.
export async function verifyDeviceShareUnlock(input: {
  encryptedShareArtifact: string;
  devicePassphrase: string;
}): Promise<boolean> {
  if (!input.encryptedShareArtifact?.trim() || !input.devicePassphrase) {
    return false;
  }
  try {
    await decodeBfSharePackage(input.encryptedShareArtifact, Secret.of(input.devicePassphrase));
    return true;
  } catch {
    return false;
  }
}

export async function recoverNsecFromShares(input: {
  // The recovering device's own profile group package (wire JSON) — supplies the
  // member indices for every share, replacing the removed relay fetch.
  groupPackageJson: string;
  // The recovering device's password-sealed bfshare artifact + its passphrase;
  // the device contributes its own share toward the threshold. Both are omitted
  // on the lost-device path, where the threshold is met from pasted shares alone.
  encryptedShareArtifact?: string | null;
  devicePassphrase?: string | null;
  sources: Array<{ packageText: string; password: string }>;
}): Promise<{ nsec: string; signingKeyHex: string }> {
  const groupPackage = groupPackageFromWireJson(input.groupPackageJson);
  const shareSecrets = await decodeShareSecrets(input.sources);

  // Contribute the device's own share only when its artifact + passphrase are
  // supplied. The lost-device path omits both and relies on the threshold check
  // in recoverSecretKeyFromShares to require enough pasted shares.
  if (input.encryptedShareArtifact?.trim() && input.devicePassphrase) {
    let deviceShareSecret: ShareSecretHex;
    try {
      const deviceShare = await decodeBfSharePackage(input.encryptedShareArtifact, Secret.of(input.devicePassphrase));
      deviceShareSecret = Secret.of(deviceShare.shareSecret);
    } catch {
      throw new Error('Incorrect device passphrase.');
    }
    shareSecrets.unshift(deviceShareSecret);
  }

  const recovered = await recoverSecretKeyFromShares({
    groupPackage,
    shareSecrets,
  });
  return {
    nsec: recovered.nsec.expose(),
    signingKeyHex: recovered.signingKeyHex.expose(),
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
    package_text: await encodeBfOnboardPackage(payload, Secret.of(input.password)),
    preview: {
      label: input.label.trim(),
      share_public_key: share.share_public_key,
      group_public_key: input.keyset.group_public_key,
      relays,
      group_package_json: input.keyset.group_package_json,
      member_idx: share.member_idx,
      source: 'bfonboard',
    } satisfies PwaProfilePreview,
  };
}
