import { getInstanceId, quarantineCorruptState } from './instance';
import {
  GLOBAL_SCHEMA_VERSION,
  SESSION_SCHEMA_VERSION,
  type PersistableGlobalState,
  type PersistableProfile,
  type PersistableSessionState,
} from './persist-allowlist';
import type { PwaSettings } from './types';

/** Shared device list + settings, visible to every tab at this origin. */
export const GLOBAL_STORE_KEY = 'igloo-pwa.profiles.v1';
/** Per-tab UI/session state, partitioned by instance id. */
export const SESSION_STORE_KEY = 'igloo-pwa.session.v1';

/** Per-tab session key, e.g. `igloo-pwa.session.v1::<instanceId>`. */
export function sessionKeyFor(id: string = getInstanceId()): string {
  return `${SESSION_STORE_KEY}::${id}`;
}

// ---------------------------------------------------------------------------
// Structural guards. A blob that fails its guard is quarantined (copied aside,
// live key dropped) so the next load boots clean instead of crashing hydrate.
// ---------------------------------------------------------------------------

function isPlausibleGlobalState(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { profiles?: unknown; settings?: unknown; schemaVersion?: unknown };
  if (!Array.isArray(candidate.profiles)) return false;
  if (
    candidate.settings !== undefined &&
    (typeof candidate.settings !== 'object' || candidate.settings === null)
  ) {
    return false;
  }
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== GLOBAL_SCHEMA_VERSION) {
    return false;
  }
  return true;
}

function isPlausibleSessionState(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { drafts?: unknown; schemaVersion?: unknown };
  if (
    candidate.drafts !== undefined &&
    (typeof candidate.drafts !== 'object' || candidate.drafts === null)
  ) {
    return false;
  }
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== SESSION_SCHEMA_VERSION) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Global store: profiles + settings (shared across tabs).
// ---------------------------------------------------------------------------

export function loadGlobalState(): PersistableGlobalState | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(GLOBAL_STORE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineCorruptState(GLOBAL_STORE_KEY, raw);
    return null;
  }
  if (!isPlausibleGlobalState(parsed)) {
    quarantineCorruptState(GLOBAL_STORE_KEY, raw);
    return null;
  }
  return parsed as PersistableGlobalState;
}

/**
 * Keep the writer's profile list and order, then append any profiles present on
 * disk that the writer didn't know about — so a concurrent tab's just-added
 * profile is not clobbered by this tab's debounced save. Removals must go
 * through {@link deleteProfileGlobal} (a writer omitting an id is treated as
 * "didn't know about it", not "delete it").
 */
function mergeProfilesById(
  disk: PersistableProfile[],
  writer: PersistableProfile[],
): PersistableProfile[] {
  const writerIds = new Set(writer.map((profile) => profile.id));
  const diskOnly = disk.filter((profile) => !writerIds.has(profile.id));
  return [...writer, ...diskOnly];
}

export function saveGlobalState(next: {
  profiles: PersistableProfile[];
  settings?: PwaSettings;
}): void {
  if (typeof window === 'undefined') return;
  // Read-merge-write: localStorage writes are synchronous and same-origin
  // serialized, so re-reading immediately before writing makes the per-profile
  // merge effectively atomic against other tabs. `settings` falls back to the
  // on-disk value when the caller doesn't supply one (the legacy importer).
  const current = loadGlobalState();
  const merged = {
    schemaVersion: GLOBAL_SCHEMA_VERSION,
    profiles: mergeProfilesById(current?.profiles ?? [], next.profiles),
    settings: next.settings ?? current?.settings,
  };
  window.localStorage.setItem(GLOBAL_STORE_KEY, JSON.stringify(merged));
}

/**
 * Explicit profile deletion (read-filter-write). Separate from
 * {@link saveGlobalState}'s merge so a debounced background save can never
 * resurrect a just-deleted profile.
 */
export function deleteProfileGlobal(profileId: string): void {
  if (typeof window === 'undefined') return;
  const current = loadGlobalState();
  if (!current) return;
  const profiles = current.profiles.filter((profile) => profile.id !== profileId);
  window.localStorage.setItem(
    GLOBAL_STORE_KEY,
    JSON.stringify({ ...current, schemaVersion: GLOBAL_SCHEMA_VERSION, profiles }),
  );
}

export function clearGlobalState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GLOBAL_STORE_KEY);
  } catch {
    // best effort
  }
}

/**
 * Subscribe to cross-tab changes of the global store. The `storage` event fires
 * only in OTHER tabs, so this never reflects our own writes — exactly what we
 * want for live profile-list sync. Returns an unsubscribe fn.
 */
export function subscribeGlobalState(
  callback: (next: PersistableGlobalState | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key !== null && event.key !== GLOBAL_STORE_KEY) return;
    callback(loadGlobalState());
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

// ---------------------------------------------------------------------------
// Session store: per-tab UI state (selected profile, view, drafts).
// ---------------------------------------------------------------------------

export function loadSessionState(): PersistableSessionState | null {
  if (typeof window === 'undefined') return null;
  const key = sessionKeyFor();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineCorruptState(key, raw);
    return null;
  }
  if (!isPlausibleSessionState(parsed)) {
    quarantineCorruptState(key, raw);
    return null;
  }
  return parsed as PersistableSessionState;
}

export function saveSessionState(state: PersistableSessionState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(sessionKeyFor(), JSON.stringify(state));
}

export function clearSessionState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(sessionKeyFor());
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Debounced persistor (shared by both stores).
// ---------------------------------------------------------------------------

export type DebouncedSaveOptions = {
  /** Trailing-edge debounce delay (ms). */
  wait: number;
  /** Maximum time to defer a pending save (ms). */
  maxWait: number;
};

export type DebouncedPersistor<T> = {
  schedule: (state: T) => void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Create a debounced localStorage persistor. leading=false, trailing=true,
 * with a maxWait so a typing-heavy draft flow cannot starve persistence
 * indefinitely. This is the ONLY reactive write path for each store.
 */
export function createDebouncedPersistor<T>(
  save: (state: T) => void,
  options: DebouncedSaveOptions = { wait: 250, maxWait: 500 },
): DebouncedPersistor<T> {
  let trailingHandle: ReturnType<typeof setTimeout> | null = null;
  let maxHandle: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

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
    const toWrite = pending.value;
    pending = null;
    clearTimers();
    try {
      save(toWrite);
    } catch {
      // ignore storage failures (quota, privacy mode, etc.)
    }
  };

  return {
    schedule(state: T) {
      pending = { value: state };
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
