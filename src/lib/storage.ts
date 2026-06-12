import {
  getInstanceId,
  quarantineCorruptState,
  touchInstanceRegistry,
} from './instance';
import { SCHEMA_VERSION } from './persist-allowlist';
import type { PwaPersistedState } from './types';

export const STORAGE_KEY = 'igloo-pwa.state.v2';
export const LEGACY_STORAGE_KEY_V1 = 'igloo-pwa.state.v1';

/**
 * Per-instance partition key, e.g. `igloo-pwa.state.v2::<instanceId>`. Each tab
 * reads/writes its own partition so tabs never clobber each other's state.
 */
export function partitionKeyFor(id: string = getInstanceId()): string {
  return `${STORAGE_KEY}::${id}`;
}

/**
 * Structural + version guard. A blob is plausible if it is an object with a
 * `profiles` array, an object-or-absent `drafts`, and either no `schemaVersion`
 * (a pre-stamp blob) or the current one. Anything else is quarantined.
 */
function isPlausiblePersistedState(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { profiles?: unknown; drafts?: unknown; schemaVersion?: unknown };
  if (!Array.isArray(candidate.profiles)) return false;
  if (
    candidate.drafts !== undefined &&
    (typeof candidate.drafts !== 'object' || candidate.drafts === null)
  ) {
    return false;
  }
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== SCHEMA_VERSION) {
    return false;
  }
  return true;
}

function derivePartitionLabel(state: PwaPersistedState): string | null {
  const profiles = state.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) return null;
  const selected = profiles.find((profile) => profile.id === state.selectedProfileId);
  return (selected ?? profiles[0])?.label ?? null;
}

let legacyCleanupDone = false;

/**
 * Drop any surviving v1 localStorage blob. v1 carried secrets
 * (`stored_password`, `runtime_snapshot_json`, `unlockPhrase`,
 * `generatedKeyset`, pending onboarding state). The v2 schema is a
 * hard-cut: v1 data is NOT migrated — it is deleted on first boot of
 * v2 so secrets can no longer linger on disk.
 */
export function cleanupLegacyPersistedState() {
  if (typeof window === 'undefined') return;
  if (legacyCleanupDone) return;
  legacyCleanupDone = true;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY_V1);
  } catch {
    // ignore storage access failures
  }
}

/**
 * Test-only: reset the once-per-load sentinel so a test can exercise
 * the cleanup path again. Do not call this from production code.
 */
export function __resetLegacyCleanupSentinelForTests() {
  legacyCleanupDone = false;
}

export function loadPersistedState(): PwaPersistedState | null {
  if (typeof window === 'undefined') return null;
  cleanupLegacyPersistedState();
  const partitionKey = partitionKeyFor();

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(partitionKey);
  } catch {
    return null;
  }

  // One-time migration: pre-partition single-tab users have their blob under
  // the un-namespaced STORAGE_KEY. Adopt it into this tab's partition so their
  // profiles survive the move to per-tab isolation.
  if (raw == null) {
    raw = adoptLegacyUnpartitionedState(partitionKey);
    if (raw == null) return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineCorruptState(partitionKey, raw);
    return null;
  }
  if (!isPlausiblePersistedState(parsed)) {
    quarantineCorruptState(partitionKey, raw);
    return null;
  }
  return parsed as PwaPersistedState;
}

/**
 * Adopt a legacy un-namespaced `igloo-pwa.state.v2` blob into the current
 * partition (one-time, on the first load after the per-tab-isolation upgrade).
 * Returns the adopted raw string, or null if there was nothing valid to adopt.
 */
function adoptLegacyUnpartitionedState(partitionKey: string): string | null {
  if (partitionKey === STORAGE_KEY) return null; // never self-adopt
  let legacyRaw: string | null = null;
  try {
    legacyRaw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!legacyRaw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch {
    return null; // leave a corrupt legacy blob alone; this tab boots fresh
  }
  if (!isPlausiblePersistedState(parsed)) return null;

  try {
    window.localStorage.setItem(partitionKey, legacyRaw);
    window.localStorage.removeItem(STORAGE_KEY);
    const profiles = (parsed as { profiles?: unknown[] }).profiles;
    touchInstanceRegistry(getInstanceId(), {
      profileCount: Array.isArray(profiles) ? profiles.length : 0,
    });
  } catch {
    // If the adoption write fails, still return the raw so this session works.
  }
  return legacyRaw;
}

export function savePersistedState(state: PwaPersistedState) {
  if (typeof window === 'undefined') return;
  const partitionKey = partitionKeyFor();
  window.localStorage.setItem(partitionKey, JSON.stringify(state));
  touchInstanceRegistry(getInstanceId(), {
    profileCount: Array.isArray(state.profiles) ? state.profiles.length : 0,
    label: derivePartitionLabel(state),
  });
}

export function clearPersistedState() {
  if (typeof window === 'undefined') return;
  const partitionKey = partitionKeyFor();
  window.localStorage.removeItem(partitionKey);
  touchInstanceRegistry(getInstanceId(), { profileCount: 0 });
}

export type DebouncedSaveOptions = {
  /** Trailing-edge debounce delay (ms). */
  wait: number;
  /** Maximum time to defer a pending save (ms). */
  maxWait: number;
};

export type DebouncedStatePersistor = {
  schedule: (state: PwaPersistedState) => void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Create a debounced localStorage persistor. leading=false, trailing=true,
 * with a maxWait so that a typing-heavy draft flow cannot starve persistence
 * indefinitely. The old per-tick savePersistedState loop is deleted; this
 * persistor is the ONLY write path for `igloo-pwa.state.v2`.
 */
export function createDebouncedPersistor(
  save: (state: PwaPersistedState) => void = savePersistedState,
  options: DebouncedSaveOptions = { wait: 250, maxWait: 500 },
): DebouncedStatePersistor {
  let trailingHandle: ReturnType<typeof setTimeout> | null = null;
  let maxHandle: ReturnType<typeof setTimeout> | null = null;
  let pending: PwaPersistedState | null = null;

  const clearTimers = () => {
    if (trailingHandle !== null) {
      clearTimeout(trailingHandle);
      trailingHandle = null;
    }
    if (maxHandle !== null) {
      clearTimeout(maxHandle);
      maxHandle = null;
    }
  };

  const runSave = () => {
    if (pending === null) return;
    const toWrite = pending;
    pending = null;
    clearTimers();
    try {
      save(toWrite);
    } catch {
      // ignore storage failures (quota, privacy mode, etc.)
    }
  };

  return {
    schedule(state: PwaPersistedState) {
      pending = state;
      if (trailingHandle !== null) clearTimeout(trailingHandle);
      trailingHandle = setTimeout(runSave, options.wait);
      if (maxHandle === null) {
        maxHandle = setTimeout(runSave, options.maxWait);
      }
    },
    flush() {
      runSave();
    },
    cancel() {
      pending = null;
      clearTimers();
    },
  };
}
