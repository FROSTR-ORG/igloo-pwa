import {
  createBrowserRuntimeProfileProjection,
  createDefaultManualPeerPolicy,
  createFinalizedBrowserStoredProfile,
  DEFAULT_SIGNER_SETTINGS,
  deriveProfileIdFromShareSecret,
  normalizeGroupMemberSharePublicKey,
  normalizeHex32,
  normalizeSignerSettings,
  publicKeyFromSecret,
  type BrowserGroupPackageMember,
  type BrowserProfilePackagePayload,
  type RuntimePeerPermissionState,
  xOnlyFromCompressedPubkey,
} from 'igloo-shared';

import type {
  PwaGeneratedKeyset,
  PwaPeerPermissionState,
  PwaProfile,
  PwaProfilePreview,
  PwaRuntimeSnapshot,
  PwaSignerSettings,
} from '../types';
import type { BrowserRuntimeSession } from '../page-runtime-host';

export type GeneratedKeysetInput = {
  groupName: string;
  threshold: number;
  count: number;
};

export type GeneratedProfileInput = {
  keyset: PwaGeneratedKeyset;
  shareMemberIdx: number;
  label: string;
  password: string;
  relayUrls: string;
  existingProfileIds?: string[];
};

export type LoadInput = {
  profileString: string;
  password: string;
};

export type RecoverInput = {
  shareString: string;
  password: string;
};

export type OnboardConnectInput = {
  packageText: string;
  password: string;
};

export type OnboardFinalizeInput = {
  connection: import('../types').PwaOnboardConnection;
  label: string;
  password: string;
  existingProfileIds?: string[];
};

export type OperatorSettingsInput = {
  label: string;
  relays: string[];
  signerSettings: PwaSignerSettings;
};

export type DistributionPackageInput = {
  keyset: PwaGeneratedKeyset;
  shareMemberIdx: number;
  label: string;
  password: string;
  relayUrls: string;
  signerPubkey: string;
};

export const DEFAULT_PWA_SIGNER_SETTINGS: PwaSignerSettings = {
  ...DEFAULT_SIGNER_SETTINGS,
};

export function normalizePwaSignerSettings(input?: Partial<PwaSignerSettings> | null): PwaSignerSettings {
  return normalizeSignerSettings(input);
}

export function defaultPeerPermissionStates(): PwaPeerPermissionState[] {
  return [];
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function normalizeRelayUrls(relayUrls: string) {
  return relayUrls
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeRelayList(relays: string[]) {
  return relays
    .map((relay) => relay.trim())
    .filter(Boolean);
}

export function parseJsonObject(value: string, label: string) {
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

export function toPwaProfile(finalized: Awaited<ReturnType<typeof createFinalizedBrowserStoredProfile>>): PwaProfile {
  return {
    ...finalized.preview,
    id: finalized.summary.id,
    relay_profile: 'browser',
    group_ref: finalized.artifactRefs.groupRef,
    encrypted_profile_ref: finalized.artifactRefs.encryptedProfileRef,
    state_path: finalized.artifactRefs.statePath,
    created_at: now(),
    stored_password: finalized.storedPassword,
    profile_string: finalized.profileString,
    share_string: finalized.shareString,
    signer_settings: normalizePwaSignerSettings(finalized.summary.signerSettings),
    peer_pubkey: finalized.peerPubkey,
    runtime_snapshot_json: finalized.runtimeSnapshotJson,
    onboarding_package: finalized.onboardingPackage,
    manual_peer_policy_overrides: finalized.manualPeerPolicyOverrides,
  } satisfies PwaProfile;
}

export function toPwaPeerPermissionState(state: RuntimePeerPermissionState): PwaPeerPermissionState {
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

export function derivePeerPermissionStatesFromPayload(payload: BrowserProfilePackagePayload): PwaPeerPermissionState[] {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const states = new Map<string, PwaPeerPermissionState>();

  for (const member of payload.groupPackage.members) {
    const memberPubkey = xOnlyFromCompressedPubkey(member.pubkey);
    if (memberPubkey === sharePublicKey) continue;
    states.set(memberPubkey, defaultPeerPermissionState(memberPubkey));
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

  return Array.from(states.values()).sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

export async function profilePayloadFromGeneratedShare(
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
  const group = parseJsonObject(keyset.group_package_json, 'group package JSON');
  const members = Array.isArray(group.members)
    ? group.members.map(
        (member): BrowserGroupPackageMember => ({
          idx: Math.trunc(typeof member?.idx === 'number' ? member.idx : 0),
          pubkey: (() => {
            const raw = typeof member?.pubkey === 'string' ? member.pubkey : '';
            const normalized = raw.trim().toLowerCase();
            if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
              return normalized;
            }
            return `02${normalizeGroupMemberSharePublicKey(raw)}`;
          })(),
        }),
      )
    : [];
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
            request: { ...createDefaultManualPeerPolicy().request, ...policy.manual_override.request },
            respond: { ...createDefaultManualPeerPolicy().respond, ...policy.manual_override.respond },
          },
        })) ??
        members
          .filter((member) => member.idx !== shareMemberIdx)
          .map((member) => ({
            pubkey: xOnlyFromCompressedPubkey(member.pubkey),
            policy: createDefaultManualPeerPolicy(),
          })),
      relays,
    },
    groupPackage: {
      groupName: keyset.group_name,
      groupPk: normalizeHex32(typeof group.group_pk === 'string' ? group.group_pk : keyset.group_public_key, 'group public key'),
      threshold: Math.trunc(typeof group.threshold === 'number' ? group.threshold : keyset.threshold),
      members,
    },
  };
}

export async function createStoredProfileFromPayload(args: {
  payload: BrowserProfilePackagePayload;
  password: string;
  source: PwaProfilePreview['source'];
  existingProfileIds?: string[];
  profileString?: string;
  shareString?: string;
  onboardingPackage?: string | null;
  runtimeSnapshotJson?: string | null;
  peerPubkey?: string | null;
  signerSettings?: Partial<PwaSignerSettings> | null;
}) {
  const finalized = await createFinalizedBrowserStoredProfile({
    payload: args.payload,
    password: args.password,
    source: args.source,
    existingProfileIds: args.existingProfileIds,
    signerSettings: args.signerSettings ?? DEFAULT_SIGNER_SETTINGS,
    peerPubkey: args.peerPubkey ?? null,
    runtimeSnapshotJson: args.runtimeSnapshotJson ?? null,
    profileString: args.profileString,
    shareString: args.shareString,
    onboardingPackage: args.onboardingPackage ?? null,
  });
  return toPwaProfile(finalized);
}

export function toRuntimeProfile(profile: PwaProfile, snapshot: ReturnType<BrowserRuntimeSession['read']>): PwaProfile {
  const projection = createBrowserRuntimeProfileProjection({
    profile: {
      id: profile.id,
      label: profile.label,
      relays: profile.relays,
      groupPackageJson: profile.group_package_json,
      sharePackageJson: profile.share_package_json,
      manualPeerPolicyOverrides: profile.manual_peer_policy_overrides ?? [],
      peerPubkey: profile.peer_pubkey ?? null,
      runtimeSnapshotJson: profile.runtime_snapshot_json ?? null,
    },
    signerSettings: snapshot.signerSettings,
    runtimeSnapshotJson: snapshot.runtimeSnapshotJson,
    peerPermissionStates: snapshot.peerPermissionStates,
  });
  const summary = projection.summary;
  return {
    ...profile,
    label: summary.label,
    relays: summary.relays,
    group_public_key: summary.groupPublicKey,
    share_public_key: summary.sharePublicKey,
    manual_peer_policy_overrides: projection.manualPeerPolicyOverrides,
    runtime_snapshot_json: summary.runtimeSnapshotJson ?? null,
    signer_settings: normalizePwaSignerSettings(snapshot.signerSettings),
    peer_pubkey: summary.peerPubkey ?? null,
  };
}

export function toRuntimeSnapshot(profile: PwaProfile, session: BrowserRuntimeSession, active: boolean): PwaRuntimeSnapshot {
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
