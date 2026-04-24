import type { PwaPersistedState } from './types';

export const STORAGE_KEY = 'igloo-pwa.state.v2';
export const LEGACY_STORAGE_KEY_V1 = 'igloo-pwa.state.v1';

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
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PwaPersistedState;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PwaPersistedState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedState() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
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
