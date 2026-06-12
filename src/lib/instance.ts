/**
 * Per-tab instance identity + a registry of known storage partitions.
 *
 * Each browser tab is its own JS realm, so the WASM bridge, the
 * `SessionController`, and all in-memory state are already isolated per tab.
 * The ONLY surface tabs share at the same origin is web storage. To make each
 * tab a fully isolated igloo-pwa instance — "worlds apart," communicating only
 * over Nostr relays, as FROSTR v1 worked on the web — we partition persisted
 * state by a per-tab instance id.
 *
 * The id lives in `sessionStorage`: unique per tab, stable across a same-tab
 * reload, and absent in a brand-new tab (which therefore becomes a fresh
 * instance). `localStorage` is partitioned as `${STORAGE_KEY}::${instanceId}`.
 *
 * A small shared registry (`igloo-pwa.instances.v1`, intentionally
 * un-namespaced) indexes the known partitions so a fresh tab can resume an
 * existing device after a browser restart (which clears `sessionStorage`),
 * rather than orphaning its profiles.
 *
 * Every storage access here is wrapped — private mode, disabled storage, and
 * quota errors degrade gracefully instead of throwing.
 */

export const INSTANCE_ID_KEY = 'igloo-pwa.instanceId';
export const INSTANCE_REGISTRY_KEY = 'igloo-pwa.instances.v1';

export type InstanceRecord = {
  id: string;
  label: string | null;
  createdAt: number;
  updatedAt: number;
  profileCount: number;
};

let cachedInstanceId: string | null = null;
let testInstanceIdOverride: string | null = null;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function mintId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual generator
  }
  // Non-crypto fallback id; only used where crypto.randomUUID is unavailable.
  return `inst-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * The current tab's instance id. Minted on first use and stored in
 * `sessionStorage`; a same-tab reload reuses it, a new tab mints a fresh one.
 * Falls back to an in-memory id if `sessionStorage` is unavailable.
 */
export function getInstanceId(): string {
  if (testInstanceIdOverride !== null) return testInstanceIdOverride;
  if (cachedInstanceId !== null) return cachedInstanceId;
  if (!hasWindow()) return 'default';

  try {
    const existing = window.sessionStorage.getItem(INSTANCE_ID_KEY);
    if (existing) {
      cachedInstanceId = existing;
      return existing;
    }
  } catch {
    // sessionStorage unreadable — mint an in-memory id below.
  }

  const minted = mintId();
  cachedInstanceId = minted;
  try {
    window.sessionStorage.setItem(INSTANCE_ID_KEY, minted);
    registerInstance(minted);
  } catch {
    // Degraded: in-memory id for this realm only (lost on reload).
  }
  return minted;
}

export function readInstanceRegistry(): InstanceRecord[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(INSTANCE_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is InstanceRecord =>
        entry != null && typeof entry === 'object' && typeof (entry as InstanceRecord).id === 'string',
    );
  } catch {
    return [];
  }
}

function writeInstanceRegistry(records: InstanceRecord[]): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(INSTANCE_REGISTRY_KEY, JSON.stringify(records));
  } catch {
    // best effort
  }
}

/** Upsert a registry record for a (usually newly minted) instance id. */
export function registerInstance(id: string): void {
  const records = readInstanceRegistry();
  if (records.some((record) => record.id === id)) return;
  const now = Date.now();
  records.push({ id, label: null, createdAt: now, updatedAt: now, profileCount: 0 });
  writeInstanceRegistry(records);
}

/** Update the registry record for `id` with the latest partition metadata. */
export function touchInstanceRegistry(
  id: string,
  meta: { profileCount: number; label?: string | null },
): void {
  const records = readInstanceRegistry();
  const now = Date.now();
  const existing = records.find((record) => record.id === id);
  if (existing) {
    existing.profileCount = meta.profileCount;
    existing.updatedAt = now;
    if (meta.label !== undefined) existing.label = meta.label;
  } else {
    records.push({
      id,
      label: meta.label ?? null,
      createdAt: now,
      updatedAt: now,
      profileCount: meta.profileCount,
    });
  }
  writeInstanceRegistry(records);
}

/**
 * Adopt an existing partition's instance id into this tab, then the caller
 * reloads so the store re-hydrates from the adopted partition. Used by the
 * "resume this device" affordance after a browser restart.
 */
export function adoptInstanceId(id: string): void {
  if (!hasWindow()) return;
  try {
    window.sessionStorage.setItem(INSTANCE_ID_KEY, id);
    cachedInstanceId = id;
  } catch {
    // If sessionStorage is unavailable the reload won't stick; nothing to do.
  }
}

/**
 * Conservatively prune registry records (and their partition keys) ONLY when
 * the partition holds no profiles. Never touches the current instance and
 * never deletes a partition with profiles.
 */
export function gcEmptyInstances(opts: { keepId: string }): void {
  if (!hasWindow()) return;
  const records = readInstanceRegistry();
  const kept: InstanceRecord[] = [];
  for (const record of records) {
    if (record.id === opts.keepId) {
      kept.push(record);
      continue;
    }
    if (record.profileCount > 0) {
      kept.push(record);
      continue;
    }
    // profileCount is 0 in the registry — confirm the partition is truly empty
    // before deleting, then drop both the partition key and the record.
    if (partitionIsEmpty(record.id)) {
      removePartition(record.id);
      continue;
    }
    kept.push(record);
  }
  if (kept.length !== records.length) writeInstanceRegistry(kept);
}

function partitionKeyForId(id: string): string {
  // Mirrors storage.ts partition layout without importing it (avoids a cycle).
  return `igloo-pwa.state.v2::${id}`;
}

function partitionIsEmpty(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(partitionKeyForId(id));
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    const profiles = (parsed as { profiles?: unknown })?.profiles;
    return !Array.isArray(profiles) || profiles.length === 0;
  } catch {
    // Unparseable partition is treated as empty (safe to reclaim).
    return true;
  }
}

function removePartition(id: string): void {
  try {
    window.localStorage.removeItem(partitionKeyForId(id));
  } catch {
    // best effort
  }
}

/**
 * Copy a bad persisted blob aside for debugging, then drop the live key so the
 * next load boots clean instead of crashing.
 */
export function quarantineCorruptState(partitionKey: string, raw: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(`${partitionKey}.corrupt.${Date.now()}`, raw);
  } catch {
    // quota/unavailable — still drop the live key below.
  }
  try {
    window.localStorage.removeItem(partitionKey);
  } catch {
    // best effort
  }
}

/** Test-only: pin the instance id so seeded partitions are deterministic. */
export function __setInstanceIdForTests(id: string | null): void {
  testInstanceIdOverride = id;
  cachedInstanceId = null;
}
