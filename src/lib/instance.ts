/**
 * Per-tab instance identity + corrupt-blob quarantine.
 *
 * Each browser tab is its own JS realm, so the WASM bridge, the
 * `SessionController`, and all in-memory state are already isolated per tab.
 * The device list lives in a single GLOBAL store shared by all tabs
 * (`igloo-pwa.profiles.v1`); only the per-tab UI/session state is partitioned,
 * keyed by this instance id (`igloo-pwa.session.v1::<instanceId>`).
 *
 * The id lives in `sessionStorage`: unique per tab, stable across a same-tab
 * reload, and absent in a brand-new tab (which therefore becomes a fresh
 * instance, starting from the landing screen but seeing the same global
 * devices). Falls back to an in-memory id if `sessionStorage` is unavailable.
 *
 * Every storage access here is wrapped — private mode, disabled storage, and
 * quota errors degrade gracefully instead of throwing.
 */

export const INSTANCE_ID_KEY = 'igloo-pwa.instanceId';

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
  } catch {
    // Degraded: in-memory id for this realm only (lost on reload).
  }
  return minted;
}

/** Keep at most this many `${storeKey}.corrupt.<ts>` copies per key. */
const QUARANTINE_KEEP_NEWEST = 3;

/**
 * Copy a bad persisted blob aside for debugging, then drop the live key so the
 * next load boots clean instead of crashing.
 */
export function quarantineCorruptState(storeKey: string, raw: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(`${storeKey}.corrupt.${Date.now()}`, raw);
  } catch {
    // quota/unavailable — still drop the live key below.
  }
  // A repeatedly-corrupted key would otherwise accumulate unbounded
  // `.corrupt.<ts>` copies; keep only the newest few.
  pruneQuarantineCopies(storeKey);
  try {
    window.localStorage.removeItem(storeKey);
  } catch {
    // best effort
  }
}

/**
 * Cap the `${storeKey}.corrupt.<ts>` quarantine copies at the newest
 * {@link QUARANTINE_KEEP_NEWEST}, removing older ones. Best-effort: any failure
 * leaves the existing copies in place.
 */
function pruneQuarantineCopies(storeKey: string): void {
  if (!hasWindow()) return;
  const prefix = `${storeKey}.corrupt.`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    if (keys.length <= QUARANTINE_KEEP_NEWEST) return;
    keys
      // Newest first by the numeric timestamp suffix.
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
      .slice(QUARANTINE_KEEP_NEWEST)
      .forEach((key) => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // best effort
        }
      });
  } catch {
    // enumeration failed — leave copies in place
  }
}

/** Test-only: pin the instance id so seeded session partitions are deterministic. */
export function __setInstanceIdForTests(id: string | null): void {
  testInstanceIdOverride = id;
  cachedInstanceId = null;
}
