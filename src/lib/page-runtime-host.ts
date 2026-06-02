import {
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
  refreshAllPeersOnNode,
  stopSignerNode,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  type DecodedOnboardingProfile,
  type NodeWithEvents,
  type ObservabilityEvent,
  type RuntimeMetadata,
  type RuntimePeerPermissionState,
  type RuntimeReadiness,
  type SignerSettings,
  type RuntimeStatusSummary,
  normalizeSignerSettings,
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
  runtimeSnapshotJson?: string | null;
};

export type BrowserBootstrapProfile = BrowserStoredProfile & {
  groupPackageJson: string;
  sharePackageJson: string;
};

export type BrowserOnboardingResult = {
  decoded: DecodedOnboardingProfile;
  profile: BrowserStoredProfile;
  runtimeSnapshotJson: string;
  runtimeStatus: RuntimeStatusSummary;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
};

export type BrowserRuntimeSessionSnapshot = {
  runtimeStatus: RuntimeStatusSummary;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peerPermissionStates: RuntimePeerPermissionState[];
  signerSettings: SignerSettings;
  runtimeSnapshotJson: string;
  // Structured runtime events retained host-side (domain/event/level/ts) so the
  // dashboard log can render type tags and a domain filter. The formatted string
  // `runtime_log_lines` is kept alongside for the plain-text fallback.
  events: ObservabilityEvent[];
};

export type BrowserRuntimeSession = {
  collectLogs: () => string[];
  clearLogs: () => void;
  read: () => BrowserRuntimeSessionSnapshot;
  refreshPeers: () => Promise<BrowserRuntimeSessionSnapshot>;
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
  startPersistedBrowserRuntimeSession?: (
    profile: BrowserStoredProfile
  ) => Promise<BrowserRuntimeSession>;
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

function formatLogLine(level: 'info' | 'warn' | 'error', payload: unknown) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const domain = typeof record.domain === 'string' ? record.domain : 'runtime';
    const event = typeof record.event === 'string' ? record.event : 'message';
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
      ? `[${level}] ${domain}.${event} ${detailParts.join(' ')}`
      : `[${level}] ${domain}.${event}`;
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

async function waitForNonceSnapshot(node: NodeWithEvents) {
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
  if (typeof record.domain !== 'string' || typeof record.level !== 'string') return null;
  return payload as ObservabilityEvent;
}

// Keep the host-side log buffers bounded so a long-lived signer session does not
// grow memory without limit; the dashboard only ever renders the recent tail.
const LOG_BUFFER_LIMIT = 500;

function pushCapped<T>(buffer: T[], value: T) {
  buffer.push(value);
  if (buffer.length > LOG_BUFFER_LIMIT) buffer.splice(0, buffer.length - LOG_BUFFER_LIMIT);
}

function attachLogBuffer(node: NodeWithEvents) {
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

function buildSessionSnapshot(
  node: NodeWithEvents,
  events: ObservabilityEvent[]
): BrowserRuntimeSessionSnapshot {
  const runtimeStatus = getRuntimeStatus(node);
  return {
    runtimeStatus,
    metadata: getRuntimeMetadata(node),
    readiness: getRuntimeReadiness(node),
    peerPermissionStates: getRuntimePeerPermissionStatesFromNode(node),
    signerSettings: normalizeSignerSettings(getRuntimeConfigFromNode(node)),
    runtimeSnapshotJson: JSON.stringify(getRuntimeSnapshot(node)),
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
        runtimeSnapshotJson
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

function createSession(node: NodeWithEvents, logs: ReturnType<typeof attachLogBuffer>): BrowserRuntimeSession {
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

export async function startPersistedBrowserRuntimeSession(
  profile: BrowserStoredProfile
): Promise<BrowserRuntimeSession> {
  ensureIglooSharedConfigured();
  if (browserRuntimeTestHooks?.startPersistedBrowserRuntimeSession) {
    return await browserRuntimeTestHooks.startPersistedBrowserRuntimeSession(profile);
  }

  const init = createBrowserRuntimeNodeInit(profile);
  const node = createSignerNode(init.config, init.restoreOptions);
  const logs = attachLogBuffer(node);
  await connectSignerNode(node);
  refreshAllPeersOnNode(node);
  return createSession(node, logs);
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
