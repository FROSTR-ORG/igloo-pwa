import type {
  PwaDraftState,
  PwaPersistedState,
  PwaProfile,
} from './types';

/**
 * Persistable shape sent to `igloo-pwa.state.v2`.
 *
 * Hard rule: anything serialized through this allow-list is considered
 * non-secret by design. Encrypted artifacts (password-sealed bech32m
 * strings like `encrypted_bfshare_artifact`) are OK; cleartext secrets
 * (share secrets, passwords, passphrases, runtime snapshots with
 * `bootstrap.share.seckey`) must never appear here.
 *
 * Every new persisted field requires an explicit addition to one of the
 * allow-lists below. Default for any new field is NON-persisted.
 *
 * NOTE: `share_package_json` is deliberately OMITTED. Its wire shape is
 * `{idx, seckey}` and the `seckey` hex is the raw FROST share secret —
 * NOT public metadata. The runtime reconstructs it in memory at session
 * start from `encrypted_bfshare_artifact` and keeps it in the
 * non-persisted `sharePackageJsonByProfileId` map.
 */

const PROFILE_ALLOWED_KEYS = [
  'id',
  'label',
  'created_at',
  'updated_at',
  'relay_profile',
  'state_path',
  'group_ref',
  'encrypted_profile_ref',
  'relays',
  'group_public_key',
  'share_public_key',
  'group_package_json',
  'member_idx',
  'signer_settings',
  'peer_pubkey',
  'manual_peer_policy_overrides',
  'source',
  'encrypted_bfshare_artifact',
] as const satisfies readonly (keyof PwaProfile)[];

type PersistableProfileKey = (typeof PROFILE_ALLOWED_KEYS)[number];

type PersistableProfile = Pick<PwaProfile, PersistableProfileKey>;

function toPersistableProfile(profile: PwaProfile): PersistableProfile {
  const out = {} as Record<PersistableProfileKey, unknown>;
  for (const key of PROFILE_ALLOWED_KEYS) {
    const value = profile[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as PersistableProfile;
}

/**
 * Schema version stamped into every persisted blob. Bump when the persisted
 * shape changes incompatibly so `loadPersistedState` quarantines old blobs and
 * boots clean instead of risking a hydrate-time crash.
 */
export const SCHEMA_VERSION = 2;

export type PersistableState = {
  schemaVersion: number;
  profiles: PersistableProfile[];
  peerPermissionStates: PwaPersistedState['peerPermissionStates'];
  selectedProfileId: PwaPersistedState['selectedProfileId'];
  activeView: PwaPersistedState['activeView'];
  activeDashboardTab: PwaPersistedState['activeDashboardTab'];
  settings: PwaPersistedState['settings'];
  drafts: PwaDraftState;
};

/**
 * Sift the full app state down to the persistable allow-list. Anything
 * not explicitly surfaced here stays in-memory only (secrets, runtime
 * snapshots, pending confirmations, unlock passphrases, etc.).
 */
export function toPersistable(state: PwaPersistedState): PersistableState {
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: state.profiles.map(toPersistableProfile),
    peerPermissionStates: state.peerPermissionStates,
    selectedProfileId: state.selectedProfileId,
    activeView: state.activeView,
    activeDashboardTab: state.activeDashboardTab,
    settings: state.settings,
    drafts: state.drafts,
  };
}

export const PERSISTABLE_PROFILE_KEYS: readonly PersistableProfileKey[] =
  PROFILE_ALLOWED_KEYS;
