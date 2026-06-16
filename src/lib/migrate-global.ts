/**
 * One-time, self-cleaning import of pre-split persisted state into the global
 * device store.
 *
 * Before the global/session split, the whole app state — profile list included —
 * was partitioned per tab under `igloo-pwa.state.v2::<instanceId>` (and, even
 * earlier, a single un-namespaced `igloo-pwa.state.v2`). That orphaned a tab's
 * devices on a browser restart. This importer lifts every legacy partition's
 * profiles into the shared `igloo-pwa.profiles.v1` store, then deletes all the
 * legacy keys (partitions, the bare blob, the v1 secret-bearing blob, the
 * instance registry, and their `.corrupt.` copies).
 *
 * There is NO persistent sentinel flag: once the legacy keys are gone the scan
 * finds nothing and returns immediately, so it is naturally a no-op on every
 * subsequent boot. It is also idempotent — `saveGlobalState` merges by profile
 * id, so a re-run after a failed delete cannot duplicate or lose data.
 */

import { toPersistableProfile, type PersistableProfile } from './persist-allowlist';
import { loadGlobalState, saveGlobalState } from './storage';
import type { PwaProfile, PwaSettings } from './types';

const LEGACY_STATE_PREFIX = 'igloo-pwa.state.v'; // matches state.v1, state.v2, state.v2::*, .corrupt copies
const LEGACY_PARTITIONED_PREFIX = 'igloo-pwa.state.v2::';
const LEGACY_BARE_KEY = 'igloo-pwa.state.v2';
const LEGACY_REGISTRY_KEY = 'igloo-pwa.instances.v1';

type LegacyRegistryRecord = { id?: unknown; updatedAt?: unknown };

/** Read `updatedAt` per instance id from the old registry (best effort). */
function readLegacyRegistryUpdatedAt(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = window.localStorage.getItem(LEGACY_REGISTRY_KEY);
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed as LegacyRegistryRecord[]) {
      if (entry && typeof entry.id === 'string' && typeof entry.updatedAt === 'number') {
        out.set(entry.id, entry.updatedAt);
      }
    }
  } catch {
    // unreadable registry — treat every partition as updatedAt 0
  }
  return out;
}

/** The `updatedAt` to attribute to a legacy import key (newest-wins on dup ids). */
function updatedAtForKey(key: string, registry: Map<string, number>): number {
  if (key.startsWith(LEGACY_PARTITIONED_PREFIX)) {
    return registry.get(key.slice(LEGACY_PARTITIONED_PREFIX.length)) ?? 0;
  }
  return 0; // the bare pre-partition blob is the oldest
}

export function importLegacyProfilesOnce(): void {
  if (typeof window === 'undefined') return;

  // 1. Enumerate legacy keys.
  let keys: string[];
  try {
    keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
  } catch {
    return;
  }

  const deleteKeys = keys.filter(
    (key) => key.startsWith(LEGACY_STATE_PREFIX) || key === LEGACY_REGISTRY_KEY,
  );
  if (deleteKeys.length === 0) return; // nothing legacy left — natural no-op

  // Import only from the current-schema (non-secret) blobs; never from the v1
  // secret-bearing blob or `.corrupt.` debug copies.
  const importKeys = deleteKeys.filter(
    (key) =>
      !key.includes('.corrupt.') &&
      (key === LEGACY_BARE_KEY || key.startsWith(LEGACY_PARTITIONED_PREFIX)),
  );

  // 2. Collect + dedupe profiles (newest-wins by partition updatedAt) and pick
  //    the newest partition's settings.
  const registry = readLegacyRegistryUpdatedAt();
  const byId = new Map<string, { profile: PersistableProfile; updatedAt: number }>();
  let settings: PwaSettings | undefined;
  let settingsUpdatedAt = -1;

  for (const key of importKeys) {
    let parsed: unknown;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      parsed = JSON.parse(raw);
    } catch {
      continue; // skip unparseable/corrupt partition — never abort the import
    }
    if (parsed == null || typeof parsed !== 'object') continue;
    const blob = parsed as { profiles?: unknown; settings?: unknown };
    const updatedAt = updatedAtForKey(key, registry);

    if (Array.isArray(blob.profiles)) {
      for (const entry of blob.profiles as PwaProfile[]) {
        if (!entry || typeof entry.id !== 'string') continue;
        const existing = byId.get(entry.id);
        if (!existing || updatedAt >= existing.updatedAt) {
          byId.set(entry.id, { profile: toPersistableProfile(entry), updatedAt });
        }
      }
    }
    if (
      blob.settings &&
      typeof blob.settings === 'object' &&
      updatedAt >= settingsUpdatedAt
    ) {
      settings = blob.settings as PwaSettings;
      settingsUpdatedAt = updatedAt;
    }
  }

  const profiles = [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((entry) => entry.profile);

  // 3. Write to the global store only when there is something to migrate (a v1
  //    secret-bearing blob alone yields nothing — it is deleted, never
  //    imported). Only delete the legacy keys if the write succeeded (e.g. a
  //    quota failure leaves them in place to retry next boot).
  if (profiles.length > 0 || settings !== undefined) {
    try {
      saveGlobalState({ profiles, settings });
    } catch {
      return;
    }
    // Confirm the write actually landed before deleting the source of truth.
    if (loadGlobalState() == null) return;
  }

  for (const key of deleteKeys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // best effort; a leftover key just means the importer runs again next boot
    }
  }
}
