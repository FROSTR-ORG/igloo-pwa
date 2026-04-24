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
 */

const PROFILE_ALLOWED_KEYS = [
  'id',
  'label',
  'created_at',
  'relay_profile',
  'state_path',
  'group_ref',
  'encrypted_profile_ref',
  'relays',
  'group_public_key',
  'share_public_key',
  'group_package_json',
  'share_package_json',
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

export type PersistableState = {
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
