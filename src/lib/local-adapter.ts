import { getPublicKey } from 'nostr-tools';

import type {
  PwaGeneratedKeyset,
  PwaLoadConfirmation,
  PwaOnboardConnection,
  PwaPeerPermissionState,
  PwaProfile,
  PwaProfilePreview,
  PwaRuntimeSnapshot,
  PwaSignerSettings,
} from './types';
import {
  connectOnboardingPackageAndCaptureProfile,
  createEncryptedProfileBackup,
  createProfilePackagePair,
  decodeBfProfilePackage,
  deriveProfileIdFromShareSecret,
  encodeBfOnboardPackage,
  getWasmKeysetApi,
  publishEncryptedProfileBackup,
  recoverProfileFromSharePackage,
  startBrowserRuntimeSession,
  startPersistedBrowserRuntimeSession,
  type BrowserOnboardPackagePayload,
  type BrowserProfileGroupMember,
  type BrowserManualPeerPolicyOverride,
  type BrowserProfilePackagePayload,
  type BrowserRemotePeerPolicyObservation,
  type BrowserRuntimeSession,
  type RuntimePeerPermissionState,
} from 'igloo-shared';

type GeneratedKeysetInput = {
  keysetName: string;
  threshold: number;
  count: number;
};

type GeneratedProfileInput = {
  keyset: PwaGeneratedKeyset;
  shareMemberIdx: number;
  label: string;
  password: string;
  relayUrls: string;
  existingProfileIds?: string[];
};

type LoadInput = {
  profileString: string;
  password: string;
};

type RecoverInput = {
  shareString: string;
  password: string;
};

type OnboardConnectInput = {
  packageText: string;
  password: string;
};

type OnboardFinalizeInput = {
  connection: PwaOnboardConnection;
  label: string;
  password: string;
  existingProfileIds?: string[];
};

type OperatorSettingsInput = {
  label: string;
  relays: string[];
  signerSettings: PwaSignerSettings;
};

type DistributionPackageInput = {
  keyset: PwaGeneratedKeyset;
  shareMemberIdx: number;
  label: string;
  password: string;
  relayUrls: string;
  signerPubkey: string;
};

let activeRuntimeSession: BrowserRuntimeSession | null = null;
let activeRuntimeProfileId: string | null = null;

export const DEFAULT_PWA_SIGNER_SETTINGS: PwaSignerSettings = {
  sign_timeout_secs: 30,
  ping_timeout_secs: 15,
  request_ttl_secs: 300,
  state_save_interval_secs: 30,
  peer_selection_strategy: 'deterministic_sorted',
};

export function normalizePwaSignerSettings(input?: Partial<PwaSignerSettings> | null): PwaSignerSettings {
  const normalizePositive = (value: unknown, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : fallback;
  };

  return {
    sign_timeout_secs: normalizePositive(input?.sign_timeout_secs, DEFAULT_PWA_SIGNER_SETTINGS.sign_timeout_secs),
    ping_timeout_secs: normalizePositive(input?.ping_timeout_secs, DEFAULT_PWA_SIGNER_SETTINGS.ping_timeout_secs),
    request_ttl_secs: normalizePositive(input?.request_ttl_secs, DEFAULT_PWA_SIGNER_SETTINGS.request_ttl_secs),
    state_save_interval_secs: normalizePositive(
      input?.state_save_interval_secs,
      DEFAULT_PWA_SIGNER_SETTINGS.state_save_interval_secs,
    ),
    peer_selection_strategy: input?.peer_selection_strategy === 'random' ? 'random' : 'deterministic_sorted',
  };
}

export function defaultPeerPermissionStates(): PwaPeerPermissionState[] {
  return [];
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function browserProfileArtifactLabel(profileId: string, artifact: 'group' | 'share' | 'state') {
  return `browser-profile:${profileId}:${artifact}`;
}

function normalizeRelayUrls(relayUrls: string) {
  return relayUrls
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeRelayList(relays: string[]) {
  return relays
    .map((relay) => relay.trim())
    .filter(Boolean);
}

function normalizeHex32(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizeGroupMemberSharePublicKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error('Invalid group member share public key.');
}

function hexToBytes(hex: string) {
  const normalized = normalizeHex32(hex, 'hex string');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function publicKeyFromSecret(secretHex: string) {
  return getPublicKey(hexToBytes(secretHex)).toLowerCase();
}

function parseJsonObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function groupJsonFromPayload(payload: BrowserProfilePackagePayload) {
  return JSON.stringify(
    {
      group_pk: payload.group.groupPublicKey,
      threshold: payload.group.threshold,
      members: payload.group.members.map((member) => ({
        idx: member.index,
        pubkey: `02${member.sharePublicKey}`,
      })),
    },
    null,
    2,
  );
}

function shareJsonFromPayload(payload: BrowserProfilePackagePayload) {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const member =
    payload.group.members.find((candidate) => candidate.sharePublicKey === sharePublicKey) ??
    payload.group.members[0];
  return JSON.stringify(
    {
      idx: member?.index ?? 1,
      seckey: payload.device.shareSecret,
    },
    null,
    2,
  );
}

function previewFromProfilePayload(
  payload: BrowserProfilePackagePayload,
  source: PwaProfilePreview['source'],
  labelOverride?: string,
): PwaProfilePreview {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  return {
    label: labelOverride?.trim() || payload.device.name,
    share_public_key: sharePublicKey,
    group_public_key: payload.group.groupPublicKey,
    relays: payload.device.relays,
    group_package_json: groupJsonFromPayload(payload),
    share_package_json: shareJsonFromPayload(payload),
    source,
  };
}

function createDefaultManualOverride(): BrowserManualPeerPolicyOverride['policy'] {
  return {
    request: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
    respond: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
  };
}

function defaultPeerPermissionState(pubkey: string): PwaPeerPermissionState {
  return {
    pubkey,
    manual_override: {
      request: { ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
      respond: { ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
    },
    remote_observation: null,
    effective_policy: {
      request: { ping: true, onboard: true, sign: true, ecdh: true },
      respond: { ping: true, onboard: true, sign: true, ecdh: true },
    },
  };
}

function toPwaPeerPermissionState(state: RuntimePeerPermissionState): PwaPeerPermissionState {
  return {
    pubkey: state.pubkey,
    manual_override: {
      request: { ...state.manual_override.request },
      respond: { ...state.manual_override.respond },
    },
    remote_observation: state.remote_observation
      ? {
          request: { ...state.remote_observation.request },
          respond: { ...state.remote_observation.respond },
          updated: state.remote_observation.updated,
          revision: state.remote_observation.revision,
        }
      : null,
    effective_policy: {
      request: { ...state.effective_policy.request },
      respond: { ...state.effective_policy.respond },
    },
  };
}

function derivePeerPermissionStatesFromPayload(payload: BrowserProfilePackagePayload): PwaPeerPermissionState[] {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const states = new Map<string, PwaPeerPermissionState>();

  for (const member of payload.group.members) {
    if (member.sharePublicKey === sharePublicKey) continue;
    states.set(member.sharePublicKey, defaultPeerPermissionState(member.sharePublicKey));
  }

  for (const override of payload.device.manualPeerPolicyOverrides) {
    const existing = states.get(override.pubkey) ?? defaultPeerPermissionState(override.pubkey);
    states.set(override.pubkey, {
      ...existing,
      manual_override: {
        request: {
          ping: override.policy.request.ping,
          onboard: override.policy.request.onboard,
          sign: override.policy.request.sign,
          ecdh: override.policy.request.ecdh,
        },
        respond: {
          ping: override.policy.respond.ping,
          onboard: override.policy.respond.onboard,
          sign: override.policy.respond.sign,
          ecdh: override.policy.respond.ecdh,
        },
      },
    });
  }

  for (const observation of payload.device.remotePeerPolicyObservations) {
    const existing = states.get(observation.pubkey) ?? defaultPeerPermissionState(observation.pubkey);
    states.set(observation.pubkey, {
      ...existing,
      remote_observation: {
        request: {
          ping: observation.profile.request.ping,
          onboard: observation.profile.request.onboard,
          sign: observation.profile.request.sign,
          ecdh: observation.profile.request.ecdh,
        },
        respond: {
          ping: observation.profile.respond.ping,
          onboard: observation.profile.respond.onboard,
          sign: observation.profile.respond.sign,
          ecdh: observation.profile.respond.ecdh,
        },
        updated: observation.profile.updated,
        revision: observation.profile.revision,
      },
    });
  }

  return Array.from(states.values()).sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

async function profilePayloadFromGeneratedShare(
  keyset: PwaGeneratedKeyset,
  shareMemberIdx: number,
  label: string,
  relays: string[],
  peerPermissionStates?: PwaPeerPermissionState[],
): Promise<BrowserProfilePackagePayload> {
  const share = keyset.shares.find((entry) => entry.member_idx === shareMemberIdx);
  if (!share) {
    throw new Error('Select a generated share first.');
  }
  const shareJson = parseJsonObject(share.share_package_json, 'share package JSON');
  const members = keyset.shares.map(
    (entry): BrowserProfileGroupMember => ({
      index: entry.member_idx,
      sharePublicKey: entry.share_public_key.toLowerCase(),
    }),
  );
  const shareSecret = normalizeHex32(typeof shareJson.seckey === 'string' ? shareJson.seckey : '', 'share secret');
  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: label.trim(),
      shareSecret,
      manualPeerPolicyOverrides:
        peerPermissionStates?.map((policy) => ({
          pubkey: policy.pubkey.toLowerCase(),
          policy: {
            request: { ...createDefaultManualOverride().request, ...policy.manual_override.request },
            respond: { ...createDefaultManualOverride().respond, ...policy.manual_override.respond },
          },
        })) ??
        members
          .filter((member) => member.index !== shareMemberIdx)
          .map((member) => ({
            pubkey: member.sharePublicKey,
            policy: createDefaultManualOverride(),
          })),
      remotePeerPolicyObservations: [],
      relays,
    },
    group: {
      keysetName: keyset.keyset_name,
      groupPublicKey: keyset.group_public_key.toLowerCase(),
      threshold: keyset.threshold,
      totalCount: keyset.count,
      members,
    },
  };
}
async function publishBackup(payload: BrowserProfilePackagePayload) {
  const backup = await createEncryptedProfileBackup(payload);
  await publishEncryptedProfileBackup({
    relays: payload.device.relays,
    shareSecret: payload.device.shareSecret,
    backup,
  });
}

async function createStoredProfileFromPayload(args: {
  payload: BrowserProfilePackagePayload;
  password: string;
  source: PwaProfilePreview['source'];
  existingProfileIds?: string[];
  profileString?: string;
  shareString?: string;
  onboardingPackage?: string | null;
  runtimeSnapshotJson?: string | null;
  peerPubkey?: string | null;
}) {
  const preview = previewFromProfilePayload(args.payload, args.source);
  const id = args.payload.profileId;
  if (args.existingProfileIds?.includes(id)) {
    throw new Error(`Device profile ${preview.label} (${id.slice(0, 8)}) already exists.`);
  }
  const packagePair = await createProfilePackagePair(args.payload, args.password);
  const profileString = args.profileString ?? packagePair.profileString;
  const shareString = args.shareString ?? packagePair.shareString;

  await publishBackup(args.payload);

  return {
    ...preview,
    id,
    relay_profile: 'browser',
    group_ref: browserProfileArtifactLabel(id, 'group'),
    share_ref: browserProfileArtifactLabel(id, 'share'),
    state_path: browserProfileArtifactLabel(id, 'state'),
    created_at: now(),
    stored_password: args.password,
    profile_string: profileString,
    share_string: shareString,
    signer_settings: normalizePwaSignerSettings(),
    peer_pubkey: args.peerPubkey ?? null,
    runtime_snapshot_json: args.runtimeSnapshotJson ?? null,
    onboarding_package: args.onboardingPackage ?? null,
    manual_peer_policy_overrides: args.payload.device.manualPeerPolicyOverrides,
    remote_peer_policy_observations: args.payload.device.remotePeerPolicyObservations,
  } satisfies PwaProfile;
}

function buildRuntimePreviewFromPayload(payload: BrowserProfilePackagePayload, labelOverride?: string): PwaProfilePreview {
  return previewFromProfilePayload(
    {
      ...payload,
      device: {
        ...payload.device,
        name: labelOverride?.trim() || payload.device.name,
      },
    },
    'bfonboard',
  );
}

async function runtimePayloadFromSnapshot(args: {
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
  peerPubkey: string | null;
}): Promise<BrowserProfilePackagePayload> {
  const snapshot = JSON.parse(args.runtimeSnapshotJson) as {
    bootstrap?: {
      group?: {
        group_pk?: string;
        threshold?: number;
        members?: Array<{ idx?: number; pubkey?: string }>;
      };
      share?: {
        seckey?: string;
      };
    };
  };
  const group = snapshot.bootstrap?.group;
  const share = snapshot.bootstrap?.share;
  const members =
    group?.members?.map(
      (member): BrowserProfileGroupMember => ({
        index: Math.trunc(member.idx ?? 0),
        sharePublicKey: normalizeGroupMemberSharePublicKey(member.pubkey ?? ''),
      }),
    ) ?? [];
  const shareSecret = normalizeHex32(share?.seckey ?? '', 'share secret');
  const sharePublicKey = publicKeyFromSecret(shareSecret);

  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: args.label.trim() || 'Onboarded Device',
      shareSecret,
      manualPeerPolicyOverrides: members
        .filter((member) => member.sharePublicKey !== sharePublicKey)
        .map((member) => ({
          pubkey: member.sharePublicKey,
          policy: createDefaultManualOverride(),
        })),
      remotePeerPolicyObservations: [],
      relays: args.relays,
    },
    group: {
      keysetName: args.label.trim() || 'Onboarded Device',
      groupPublicKey: normalizeHex32(group?.group_pk ?? '', 'group public key'),
      threshold: Math.trunc(group?.threshold ?? 0),
      totalCount: members.length,
      members,
    },
  };
}

function toRuntimeProfile(profile: PwaProfile, snapshot: ReturnType<BrowserRuntimeSession['read']>): PwaProfile {
  return {
    ...profile,
    manual_peer_policy_overrides: snapshot.peerPermissionStates.map((policy) => ({
      pubkey: policy.pubkey,
      policy: {
        request: { ...createDefaultManualOverride().request, ...policy.manual_override.request },
        respond: { ...createDefaultManualOverride().respond, ...policy.manual_override.respond },
      },
    })),
    remote_peer_policy_observations: snapshot.peerPermissionStates
      .filter((policy) => policy.remote_observation !== null)
      .map((policy) => ({
        pubkey: policy.pubkey,
        profile: {
          forPeer: profile.share_public_key,
          revision: policy.remote_observation?.revision ?? 0,
          updated: policy.remote_observation?.updated ?? 0,
          blockAll: false,
          request: {
            echo: true,
            ping: policy.remote_observation?.request.ping ?? true,
            onboard: policy.remote_observation?.request.onboard ?? true,
            sign: policy.remote_observation?.request.sign ?? true,
            ecdh: policy.remote_observation?.request.ecdh ?? true,
          },
          respond: {
            echo: true,
            ping: policy.remote_observation?.respond.ping ?? true,
            onboard: policy.remote_observation?.respond.onboard ?? true,
            sign: policy.remote_observation?.respond.sign ?? true,
            ecdh: policy.remote_observation?.respond.ecdh ?? true,
          },
        },
      })),
    runtime_snapshot_json: snapshot.runtimeSnapshotJson,
    signer_settings: normalizePwaSignerSettings(snapshot.signerSettings),
  };
}

function toRuntimeSnapshot(profile: PwaProfile, session: BrowserRuntimeSession, active: boolean): PwaRuntimeSnapshot {
  const snapshot = session.read();
  const logs = session.collectLogs();
  const runtimeProfile = toRuntimeProfile(profile, snapshot);
  return {
    active,
    profile: runtimeProfile,
    runtime_status: snapshot.runtimeStatus,
    readiness: snapshot.readiness,
    peer_permission_states: snapshot.peerPermissionStates.map(toPwaPeerPermissionState),
    runtime_log_lines:
      logs.length > 0
        ? logs
        : [active ? '[info] attached live browser signer session' : '[info] browser signer session stopped'],
    runtime_host: {
      profile_id: runtimeProfile.id,
      mode: 'browser',
      log_source: 'In-memory session logs',
      started_at: now(),
      signer_pubkey: snapshot.metadata.share_public_key,
    },
  };
}

async function clearActiveRuntimeSession() {
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

export async function createGeneratedKeyset(input: GeneratedKeysetInput): Promise<PwaGeneratedKeyset> {
  if (!input.keysetName.trim()) {
    throw new Error('Keyset name is required.');
  }
  const api = await getWasmKeysetApi();
  const raw = api.create_keyset_bundle(JSON.stringify({
    threshold: input.threshold,
    count: input.count,
  }));
  const bundle = JSON.parse(raw) as {
    group: {
      group_pk: string;
      threshold: number;
      members: Array<{ idx: number; pubkey: string }>;
    };
    shares: Array<{ idx: number; seckey: string }>;
  };
  const shares = bundle.shares.map((share) => ({
    name: `${input.keysetName.trim()} Device ${share.idx}`,
    member_idx: share.idx,
    share_public_key: publicKeyFromSecret(share.seckey),
    share_package_json: JSON.stringify(
      {
        idx: share.idx,
        seckey: share.seckey,
      },
      null,
      2,
    ),
  }));

  return {
    keyset_name: input.keysetName.trim(),
    threshold: input.threshold,
    count: input.count,
    group_public_key: normalizeHex32(bundle.group.group_pk, 'group public key'),
    group_package_json: JSON.stringify(
      {
        group_pk: bundle.group.group_pk,
        threshold: bundle.group.threshold,
        members: bundle.group.members,
      },
      null,
      2,
    ),
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

  return createStoredProfileFromPayload({
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

export async function saveDeviceProfileFromGeneratedShare(input: GeneratedProfileInput) {
  const profile = await createDeviceProfileFromGeneratedShare(input);
  return {
    profile,
    download_text: profile.profile_string,
  };
}

export async function importBfProfile(input: LoadInput): Promise<PwaLoadConfirmation> {
  const payload = await decodeBfProfilePackage(input.profileString, input.password);
  const preview = previewFromProfilePayload(payload, 'bfprofile');
  const { shareString } = await createProfilePackagePair(payload, input.password);
  return {
    kind: 'bfprofile',
    preview,
    stored_password: input.password,
    profile_string: input.profileString.trim(),
    share_string: shareString,
    profile_payload: payload,
    manual_peer_policy_overrides: payload.device.manualPeerPolicyOverrides,
    remote_peer_policy_observations: payload.device.remotePeerPolicyObservations,
  };
}

export async function recoverProfileFromBfShare(input: RecoverInput): Promise<PwaLoadConfirmation> {
  const recovered = await recoverProfileFromSharePackage(input.shareString, input.password);
  const preview = previewFromProfilePayload(recovered.profile, 'bfshare');
  const { profileString } = await createProfilePackagePair(recovered.profile, input.password);
  return {
    kind: 'bfshare',
    preview,
    stored_password: input.password,
    profile_string: profileString,
    share_string: input.shareString.trim(),
    profile_payload: recovered.profile,
    manual_peer_policy_overrides: recovered.profile.device.manualPeerPolicyOverrides,
    remote_peer_policy_observations: recovered.profile.device.remotePeerPolicyObservations,
  };
}

export async function finalizeLoadedProfile(
  input: PwaLoadConfirmation,
  existingProfileIds: string[] = [],
): Promise<PwaProfile> {
  if (!input.profile_payload) {
    throw new Error('Missing canonical profile payload.');
  }
  return createStoredProfileFromPayload({
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

export async function connectOnboardingPackage(input: OnboardConnectInput): Promise<PwaOnboardConnection> {
  const result = await connectOnboardingPackageAndCaptureProfile({
    packageText: input.packageText.trim(),
    password: input.password,
    keysetName: 'Onboarded Device',
  });
  const payload = await runtimePayloadFromSnapshot({
    label: 'Onboarded Device',
    relays: result.profile.relays,
    runtimeSnapshotJson: result.runtimeSnapshotJson,
    peerPubkey: result.profile.peerPubkey ?? result.decoded.peerPubkey,
  });
  const packagePair = await createProfilePackagePair(payload, input.password);

  return {
    preview: buildRuntimePreviewFromPayload(payload),
    stored_password: input.password,
    package_text: input.packageText.trim(),
    profile_string: packagePair.profileString,
    share_string: packagePair.shareString,
    peer_pubkey: result.profile.peerPubkey ?? result.decoded.peerPubkey,
    runtime_snapshot_json: result.runtimeSnapshotJson,
    profile_payload: payload,
    manual_peer_policy_overrides: payload.device.manualPeerPolicyOverrides,
    remote_peer_policy_observations: payload.device.remotePeerPolicyObservations,
  };
}

export async function finalizeOnboardedDevice(input: OnboardFinalizeInput): Promise<PwaProfile> {
  if (!input.connection.profile_payload) {
    throw new Error('Missing canonical onboarded profile payload.');
  }
  const payload = {
    ...input.connection.profile_payload,
    device: {
      ...input.connection.profile_payload.device,
      name: input.label.trim(),
    },
  } satisfies BrowserProfilePackagePayload;

  return createStoredProfileFromPayload({
    payload,
    password: input.password,
    source: 'bfonboard',
    existingProfileIds: input.existingProfileIds,
    onboardingPackage: input.connection.package_text,
    runtimeSnapshotJson: input.connection.runtime_snapshot_json ?? null,
    peerPubkey: input.connection.peer_pubkey ?? null,
  });
}

export async function exportProfile(profile: PwaProfile) {
  return profile.profile_string;
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
        keysetName: profile.label,
        relays: profile.relays,
        groupPublicKey: profile.group_public_key,
        sharePublicKey: profile.share_public_key,
        peerPubkey: profile.peer_pubkey ?? undefined,
        signerSettings: profile.signer_settings,
        runtimeSnapshotJson: profile.runtime_snapshot_json,
      })
    : await startBrowserRuntimeSession({
        keysetName: profile.label,
        relays: profile.relays,
        groupPublicKey: profile.group_public_key,
        sharePublicKey: profile.share_public_key,
        peerPubkey: profile.peer_pubkey ?? undefined,
        signerSettings: profile.signer_settings,
        groupPackageJson: profile.group_package_json,
        sharePackageJson: profile.share_package_json,
      });
  activeRuntimeProfileId = profile.id;

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
  const refreshed = await activeRuntimeSession.refreshPeers();
  const runtimeProfile = toRuntimeProfile(current.profile, refreshed);
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
      started_at: now(),
      signer_pubkey: refreshed.metadata.share_public_key,
    },
  };
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
      keysetName: runtimeProfile.label,
      relays: runtimeProfile.relays,
      groupPublicKey: runtimeProfile.group_public_key,
      sharePublicKey: runtimeProfile.share_public_key,
      peerPubkey: runtimeProfile.peer_pubkey ?? undefined,
      signerSettings: runtimeProfile.signer_settings,
      runtimeSnapshotJson: runtimeProfile.runtime_snapshot_json,
    });
    activeRuntimeProfileId = runtimeProfile.id;
    return toRuntimeSnapshot(runtimeProfile, activeRuntimeSession, true);
  }

  activeRuntimeSession.updateConfig(updatedProfile.signer_settings);
  return toRuntimeSnapshot(updatedProfile, activeRuntimeSession, true);
}
