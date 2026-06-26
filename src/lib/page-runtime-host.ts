import {
  BrowserBridgeNode,
  createBrowserRuntimeNodeInit,
  clearRuntimePeerPolicyOverridesOnNode,
  connectSignerNode,
  createSignerNode,
  decodeOnboardingProfile,
  getPublicKeyFromNode,
  getRuntimeConfigFromNode,
  getRuntimeMetadata,
  getRuntimePeerPermissionStatesFromNode,
  getRuntimeReadiness,
  getRuntimeSnapshot,
  getRuntimeStatus,
  pingSinglePeer,
  refreshAllPeersOnNode,
  stopSignerNode,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  type DecodedOnboardingProfile,
  type ObservabilityEvent,
  type PingResult,
  type RuntimeMetadata,
  type RuntimePeerPermissionState,
  type RuntimeReadiness,
  type SignerSettings,
  type RuntimeStatusSummary,
  normalizeSignerSettings,
  type ObservabilityLevel,
} from 'igloo-shared';
import { ensureIglooSharedConfigured } from './configure-igloo-shared';

const NONCE_SNAPSHOT_WAIT_TIMEOUT_MS = 5_000;
const NONCE_SNAPSHOT_POLL_INTERVAL_MS = 100;

export type BrowserStoredProfile = {
  groupName?: string;
  relays: string[];
  groupPublicKey?: string;
  sharePublicKey?: string;
  peerPubkey?: string;
  signerSettings?: Partial<SignerSettings>;
};

export type BrowserBootstrapProfile = BrowserStoredProfile & {
  groupPackageJson: string;
  sharePackageJson: string;
  // Ephemeral, in-memory ONLY (never persisted, D.1). When present, the signer
  // restores from this onboard snapshot (preserving the exchanged nonce pool)
  // instead of bootstrapping a fresh, empty pool.
  runtimeSnapshotJson?: string | null;
};

export type BrowserOnboardingResult = {
  decoded: DecodedOnboardingProfile;
  profile: BrowserStoredProfile;
  /**
   * One-shot snapshot JSON captured during onboarding. Used to derive
   * the canonical profile payload (group + share) for the new device.
   * This is the ONLY place the PWA calls `snapshot_state()`; the payload
   * is immediately re-encrypted under the user's passphrase and the
   * raw snapshot is discarded. Never persisted to localStorage.
   */
  runtimeSnapshotJson: string;
  runtimeStatus: RuntimeStatusSummary;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
};

// D.5: `runtime_snapshot_json` is no longer surfaced on the session
// snapshot. Poll paths read `runtime_status` via `getRuntimeStatus(node)`
// instead of `getRuntimeSnapshot(node)`, which closes the host-side use
// of the bifrost-rs bootstrap leak (`RuntimeSnapshotExport.bootstrap`
// carries `share.seckey` hex; `RuntimeStatusSummary` does not).
export type BrowserRuntimeSessionSnapshot = {
  runtimeStatus: RuntimeStatusSummary;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peerPermissionStates: RuntimePeerPermissionState[];
  signerSettings: SignerSettings;
  // Structured runtime events retained host-side (domain/event/level/ts) so the
  // dashboard log can render type tags and a domain filter. The formatted string
  // `runtime_log_lines` is kept alongside for the plain-text fallback.
  events: ObservabilityEvent[];
  // NOTE: `runtimeSnapshotJson` is intentionally NOT surfaced on the session
  // snapshot — `getRuntimeSnapshot()`/`snapshot_state()` emits `bootstrap.share.seckey`
  // hex. Poll/UI paths use the non-leaking `runtime_status` API instead.
};

export type BrowserRuntimeSession = {
  collectLogs: () => string[];
  clearLogs: () => void;
  read: () => BrowserRuntimeSessionSnapshot;
  refreshPeers: () => Promise<BrowserRuntimeSessionSnapshot>;
  pingPeer: (pubkey: string) => Promise<PingResult>;
  updatePeerPolicyOverride: (
    pubkey: string,
    patch: {
      direction: 'request' | 'respond';
      method: 'ping' | 'onboard' | 'sign' | 'ecdh';
      value: 'unset' | 'allow' | 'deny';
    }
  ) => Promise<BrowserRuntimeSessionSnapshot>;
  clearPeerPolicyOverrides: () => Promise<BrowserRuntimeSessionSnapshot>;
  updateConfig: (settings: Partial<SignerSettings>) => BrowserRuntimeSessionSnapshot;
  // Subscribe to onboard-served signals (the runtime served an onboard response to
  // a peer). Returns an unsubscribe. `peerPubkey` is the peer's x-only pubkey.
  onOnboardComplete: (cb: (peerPubkey: string) => void) => () => void;
  stop: () => BrowserRuntimeSessionSnapshot;
};

type BrowserRuntimeTestHooks = {
  connectOnboardingPackageAndCaptureProfile?: (input: {
    packageText: string;
    password: string;
    groupName?: string;
    signerSettings?: Partial<SignerSettings>;
  }) => Promise<BrowserOnboardingResult>;
  startBrowserRuntimeSession?: (
    profile: BrowserBootstrapProfile
  ) => Promise<BrowserRuntimeSession>;
};

let browserRuntimeTestHooks: BrowserRuntimeTestHooks | null = null;

export function setBrowserRuntimeTestHooks(hooks: BrowserRuntimeTestHooks | null) {
  browserRuntimeTestHooks = hooks;
}

function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

function isObservabilityLevel(value: unknown): value is ObservabilityLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function formatLogLine(level: ObservabilityLevel, payload: unknown) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const domain = typeof record.domain === 'string' ? record.domain : 'runtime';
    const event = typeof record.event === 'string' ? record.event : 'message';
    const eventLevel = isObservabilityLevel(record.level) ? record.level : level;
    const detailParts: string[] = [];
    if (typeof record.request_id === 'string') detailParts.push(`request_id=${record.request_id}`);
    if (Array.isArray(record.reasons) && record.reasons.length > 0) {
      detailParts.push(`reasons=${JSON.stringify(record.reasons)}`);
    }
    if (Array.isArray(record.close_reasons) && record.close_reasons.length > 0) {
      detailParts.push(`close_reasons=${JSON.stringify(record.close_reasons)}`);
    }
    if (typeof record.relays_ok === 'number' && typeof record.relays_total === 'number') {
      detailParts.push(`publish=${record.relays_ok}/${record.relays_total}`);
    }
    if (typeof record.event_id === 'string') detailParts.push(`event_id=${record.event_id}`);
    if (typeof record.error_message === 'string') {
      detailParts.push(`error=${record.error_message}`);
    }
    return detailParts.length > 0
      ? `[${eventLevel}] ${domain}.${event} ${detailParts.join(' ')}`
      : `[${eventLevel}] ${domain}.${event}`;
  }
  const text = payload instanceof Error ? payload.message : String(payload);
  return `[${level}] ${text}`;
}

function snapshotHasUsableNonces(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const state = (snapshot as { state?: unknown }).state;
  if (!state || typeof state !== 'object') return false;
  const noncePool = (state as { nonce_pool?: unknown }).nonce_pool;
  if (!noncePool || typeof noncePool !== 'object') return false;
  const peers = (noncePool as { peers?: unknown }).peers;
  if (!Array.isArray(peers)) return false;
  return peers.some((peer) => {
    if (!peer || typeof peer !== 'object') return false;
    const incoming = (peer as { incoming_available?: unknown }).incoming_available;
    const outgoing = (peer as { outgoing_available?: unknown }).outgoing_available;
    return (
      (typeof incoming === 'number' && incoming > 0) ||
      (typeof outgoing === 'number' && outgoing > 0)
    );
  });
}

async function waitForNonceSnapshot(node: BrowserBridgeNode) {
  const startedAt = Date.now();
  let lastSnapshot: unknown = null;
  while (Date.now() - startedAt < NONCE_SNAPSHOT_WAIT_TIMEOUT_MS) {
    lastSnapshot = getRuntimeSnapshot(node);
    if (snapshotHasUsableNonces(lastSnapshot)) {
      return lastSnapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, NONCE_SNAPSHOT_POLL_INTERVAL_MS));
  }
  return lastSnapshot ?? getRuntimeSnapshot(node);
}

// A payload qualifies as a structured runtime event when it carries the
// observability shape (level + domain); other emissions (raw bifrost messages,
// errors) only contribute the formatted string fallback.
function asObservabilityEvent(payload: unknown): ObservabilityEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (
    typeof record.domain !== 'string' ||
    typeof record.event !== 'string' ||
    typeof record.component !== 'string' ||
    typeof record.ts !== 'number' ||
    !Number.isFinite(record.ts) ||
    !isObservabilityLevel(record.level)
  ) {
    return null;
  }
  return payload as ObservabilityEvent;
}

// Keep the host-side log buffers bounded so a long-lived signer session does not
// grow memory without limit; the dashboard only ever renders the recent tail.
const LOG_BUFFER_LIMIT = 500;

function pushCapped<T>(buffer: T[], value: T) {
  buffer.push(value);
  if (buffer.length > LOG_BUFFER_LIMIT) buffer.splice(0, buffer.length - LOG_BUFFER_LIMIT);
}

function attachLogBuffer(node: BrowserBridgeNode) {
  const lines: string[] = [];
  const events: ObservabilityEvent[] = [];

  const onMessage = (payload: unknown) => {
    pushCapped(lines, formatLogLine('info', payload));
    const event = asObservabilityEvent(payload);
    if (event) pushCapped(events, event);
  };
  const onError = (payload: unknown) => {
    pushCapped(lines, formatLogLine('error', payload));
    const event = asObservabilityEvent(payload);
    if (event) pushCapped(events, event);
  };

  node.on('message', onMessage);
  node.on('error', onError);

  return {
    collect: () => [...lines],
    collectEvents: () => [...events],
    clear: () => {
      lines.length = 0;
      events.length = 0;
    },
    detach: () => {
      if (typeof node.off === 'function') {
        node.off('message', onMessage);
        node.off('error', onError);
      } else if (typeof node.removeListener === 'function') {
        node.removeListener('message', onMessage);
        node.removeListener('error', onError);
      }
    }
  };
}

/**
 * Build a runtime snapshot for UI consumption from the non-leaking
 * `runtime_status` API. Never calls `snapshot_state()` — that WASM
 * export still emits `bootstrap.share.seckey` hex and is now reserved
 * for the one-shot onboarding capture path. Structured `events` are
 * forwarded from the host-side log buffer for the dashboard log.
 */
function buildSessionSnapshot(
  node: BrowserBridgeNode,
  events: ObservabilityEvent[]
): BrowserRuntimeSessionSnapshot {
  const runtimeStatus = getRuntimeStatus(node);
  return {
    runtimeStatus,
    metadata: getRuntimeMetadata(node),
    readiness: getRuntimeReadiness(node),
    peerPermissionStates: getRuntimePeerPermissionStatesFromNode(node),
    signerSettings: normalizeSignerSettings(getRuntimeConfigFromNode(node)),
    events
  };
}

export async function connectOnboardingPackageAndCaptureProfile(input: {
  packageText: string;
  password: string;
  groupName?: string;
  signerSettings?: Partial<SignerSettings>;
}): Promise<BrowserOnboardingResult> {
  ensureIglooSharedConfigured();
  if (browserRuntimeTestHooks?.connectOnboardingPackageAndCaptureProfile) {
    return await browserRuntimeTestHooks.connectOnboardingPackageAndCaptureProfile(input);
  }

  const decoded = await decodeOnboardingProfile(input.packageText, input.password);
  const node = createSignerNode({
    mode: 'onboarding',
    onboardPackage: input.packageText.trim(),
    onboardPassword: input.password,
    relays: decoded.relays,
    signerSettings: normalizeSignerSettings(input.signerSettings)
  });
  const logs = attachLogBuffer(node);

  try {
    await connectSignerNode(node);
    // One-shot `snapshot_state()` to materialize the incoming profile
    // payload (group + share). Not part of any poll path. The JSON is
    // passed straight into the shared onboarding finalizer, never
    // persisted to localStorage.
    const snapshot = await waitForNonceSnapshot(node);
    const runtimeSnapshotJson = JSON.stringify(snapshot);
    const runtimeStatus = getRuntimeStatus(node);
    const metadata = getRuntimeMetadata(node);
    const readiness = getRuntimeReadiness(node);
    return {
      decoded,
      profile: {
        groupName: input.groupName,
        relays: decoded.relays,
        groupPublicKey: getPublicKeyFromNode(node),
        sharePublicKey: decoded.publicKey,
        peerPubkey: decoded.peerPubkey,
        signerSettings: normalizeSignerSettings(input.signerSettings),
      },
      runtimeSnapshotJson,
      runtimeStatus,
      metadata,
      readiness
    };
  } catch (error) {
    const lines = logs.collect().slice(-20);
    const suffix = lines.length > 0 ? ` | runtime_logs=${JSON.stringify(lines)}` : '';
    throw new Error(`${toErrorMessage(error)}${suffix}`);
  } finally {
    logs.detach();
    await (node as typeof node & { shutdown: () => Promise<void> }).shutdown();
  }
}

function createSession(node: BrowserBridgeNode, logs: ReturnType<typeof attachLogBuffer>): BrowserRuntimeSession {
  let stopped = false;

  return {
    collectLogs() {
      return logs.collect();
    },
    clearLogs() {
      logs.clear();
    },
    read() {
      return buildSessionSnapshot(node, logs.collectEvents());
    },
    async refreshPeers() {
      refreshAllPeersOnNode(node);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return buildSessionSnapshot(node, logs.collectEvents());
    },
    async pingPeer(pubkey) {
      return await pingSinglePeer(node, normalizePingPeerPubkey(pubkey));
    },
    async updatePeerPolicyOverride(pubkey, patch) {
      await updateRuntimePeerPolicyOverrideOnNode(node, pubkey, patch);
      return buildSessionSnapshot(node, logs.collectEvents());
    },
    async clearPeerPolicyOverrides() {
      await clearRuntimePeerPolicyOverridesOnNode(node);
      return buildSessionSnapshot(node, logs.collectEvents());
    },
    updateConfig(settings) {
      updateRuntimeConfigOnNode(node, settings);
      return buildSessionSnapshot(node, logs.collectEvents());
    },
    onOnboardComplete(cb) {
      const handler = (payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          typeof (payload as { peerPubkey?: unknown }).peerPubkey === 'string'
        ) {
          cb((payload as { peerPubkey: string }).peerPubkey);
        }
      };
      node.on('onboard-complete', handler);
      return () => {
        if (typeof node.off === 'function') {
          node.off('onboard-complete', handler);
        } else if (typeof node.removeListener === 'function') {
          node.removeListener('onboard-complete', handler);
        }
      };
    },
    stop() {
      if (!stopped) {
        stopped = true;
        logs.detach();
        stopSignerNode(node);
      }
      return buildSessionSnapshot(node, logs.collectEvents());
    }
  };
}

function normalizePingPeerPubkey(pubkey: string) {
  const normalized = pubkey.trim().toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  return normalized;
}

export async function startBrowserRuntimeSession(
  profile: BrowserBootstrapProfile
): Promise<BrowserRuntimeSession> {
  ensureIglooSharedConfigured();
  if (browserRuntimeTestHooks?.startBrowserRuntimeSession) {
    return await browserRuntimeTestHooks.startBrowserRuntimeSession(profile);
  }

  const init = createBrowserRuntimeNodeInit(profile);
  const node = createSignerNode(init.config, init.restoreOptions);
  const logs = attachLogBuffer(node);
  await connectSignerNode(node);
  refreshAllPeersOnNode(node);
  return createSession(node, logs);
}
