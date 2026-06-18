import {
  PERSISTABLE_PROFILE_KEYS,
  type PersistableStoredProfile,
} from 'igloo-shared';

import type {
  PwaDraftState,
  PwaPersistedState,
  PwaProfile,
} from './types';

/**
 * Persistable shapes for the two localStorage stores:
 *
 *  - GLOBAL  (`igloo-pwa.profiles.v1`)  — the device list + app settings, shared
 *    by every tab at this origin. {@link PersistableGlobalState}.
 *  - SESSION (`igloo-pwa.session.v1::<instanceId>`) — the per-tab UI/session
 *    state (which device this tab selected, its view, in-flight drafts).
 *    {@link PersistableSessionState}.
 *
 * Hard rule: anything serialized through these allow-lists is considered
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
 *
 * NOTE: `peerPermissionStates` is also OMITTED from both shapes — it is
 * runtime state of THIS tab's active signer (overwritten on every
 * `startSession`/poll, reset on logout), not durable config. The durable
 * per-profile policy travels inside each profile's
 * `manual_peer_policy_overrides`.
 */

// The persistable key list is owned by the shared contract (igloo-shared
// `persist-contract`) so the allow-list lives in exactly one place. Bind it to
// PwaProfile here: `satisfies (keyof PwaProfile)[]` proves every persisted key
// exists on the profile, and the assertion below proves the projected shape
// matches the shared `PersistableStoredProfile` exactly — either drift is a
// compile error.
const PROFILE_ALLOWED_KEYS =
  PERSISTABLE_PROFILE_KEYS satisfies readonly (keyof PwaProfile)[];

type PersistableProfileKey = (typeof PROFILE_ALLOWED_KEYS)[number];

type PersistableProfile = Pick<PwaProfile, PersistableProfileKey>;

// Compile-time drift guard: PwaProfile's persistable projection and the shared
// contract must be mutually assignable (identical shape). If PwaProfile changes a
// persisted field's type, or the contract adds/drops one, this stops compiling.
type Exact<A, B> = A extends B ? (B extends A ? true : never) : never;
type _AssertPersistableProfileMatchesContract = Exact<
  PersistableProfile,
  PersistableStoredProfile
>;

export function toPersistableProfile(profile: PwaProfile): PersistableProfile {
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
 * Schema versions stamped into each store's blob. Bump when a shape changes
 * incompatibly so the loader quarantines old blobs and boots clean instead of
 * risking a hydrate-time crash.
 */
export const GLOBAL_SCHEMA_VERSION = 1;
export const SESSION_SCHEMA_VERSION = 1;

/** Shared device list + app settings — `igloo-pwa.profiles.v1`. */
export type PersistableGlobalState = {
  schemaVersion: number;
  profiles: PersistableProfile[];
  settings: PwaPersistedState['settings'];
};

/** Per-tab UI/session state — `igloo-pwa.session.v1::<instanceId>`. */
export type PersistableSessionState = {
  schemaVersion: number;
  selectedProfileId: PwaPersistedState['selectedProfileId'];
  activeView: PwaPersistedState['activeView'];
  activeDashboardTab: PwaPersistedState['activeDashboardTab'];
  drafts: PwaDraftState;
};

/**
 * Sift the full app state down to the GLOBAL allow-list (profiles + settings).
 * Anything not surfaced here stays in-memory only (secrets, runtime snapshots,
 * unlock passphrases, etc.).
 */
export function toPersistableGlobal(state: PwaPersistedState): PersistableGlobalState {
  return {
    schemaVersion: GLOBAL_SCHEMA_VERSION,
    profiles: state.profiles.map(toPersistableProfile),
    settings: state.settings,
  };
}

/** Sift the full app state down to the PER-TAB SESSION allow-list. */
export function toPersistableSession(state: PwaPersistedState): PersistableSessionState {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    selectedProfileId: state.selectedProfileId,
    activeView: state.activeView,
    activeDashboardTab: state.activeDashboardTab,
    drafts: state.drafts,
  };
}

export type { PersistableProfile };

// Re-export the shared key list under this module's long-standing public name so
// in-repo consumers keep importing it from here, while the single source of truth
// stays in igloo-shared `persist-contract`.
export { PERSISTABLE_PROFILE_KEYS };
