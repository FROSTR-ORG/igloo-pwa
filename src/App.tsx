import * as React from 'react';

import {
  Alert,
  AppHeader,
  Button,
  ClearCredentialsDialog,
  CreateFlowDistributionSection,
  CreateFlowGenerateCard,
  CreateFlowProfileSetup,
  CreateFlowShareSelection,
  DashboardLoadingState,
  DashboardSigningFailedDialog,
  DashboardHeaderActions,
  ImportProfileEntry,
  OnboardFailedPanel,
  OnboardHandshakePanel,
  OnboardingClientCard,
  OnboardPackageEntry,
  RecoverCollectSharesPanel,
  ReplaceShareFailedPanel,
  ReplaceSharePackageEntry,
  ReplaceShareProgressPanel,
  ReplaceShareSuccessPanel,
  RotateKeysetPanel,
  WarningCard,
  HostFlowShell,
  Modal,
  OnboardDeviceSponsorDialog,
  OperatorPermissionsPanel,
  OperatorSettingsSidebar,
  OperatorSignerPanel,
  PageLayout,
  PageBackLink,
  PasswordField,
  ProfilePasswordChangeDialog,
  ExportPackageModal,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  QrPayloadModal,
  SettingsUnsavedChangesDialog,
  StepProgress,
  WelcomeEntryHero,
  WelcomeReturningHero,
  WelcomeDeleteModal,
  WelcomeUnlockModal,
  CRITICAL_E2E_TEST_IDS,
  observabilityEventsToEventRows,
  type DashboardAttentionModel,
  type DashboardKeyModel,
  type DashboardSigningFailureModel,
  type EventLogRowModel,
  type OnboardDeviceSponsorDraft,
  type OnboardDeviceSponsorErrorField,
  type OnboardDeviceSponsorResult,
  type PeerPolicy,
  type PermissionMethodKey,
  type SharedDistributionAction,
  type SharedDistributionResult,
  type PolicyDashboardViewModel,
  type SignerDashboardViewModel,
  type WelcomeReturningProfileModel,
  type WelcomeResumableDeviceModel,
} from 'igloo-ui';
import {
  buildProfileDownloadFilename,
  normalizeRelays,
  pingRelay,
  shortProfileId,
  type RuntimeReadiness,
  type RuntimeStatusSummary,
} from 'igloo-shared';
import { nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { deriveExportSummary, deriveGroupSummary, toDashboardKey } from './lib/dashboard-view';
import { saveTextToFile } from './lib/file-save';
import {
  adoptInstanceId,
  forgetInstance,
  getInstanceId,
  instancePartitionHasProfiles,
  pruneUnavailableInstances,
  readInstanceRegistry,
} from './lib/instance';
import { createSettingsOnboardingPackageFromBfshare } from './lib/local-adapter';
import { areOperatorSettingsEqual } from './lib/operator-settings';

import { StoreProvider, useStore } from './lib/store';
import type {
  PwaDashboardTab,
  PwaDistributionActionResult,
  PwaGeneratedShare,
  PwaLoadConfirmation,
  PwaOnboardConnection,
  PwaPeerPermissionState,
  PwaRuntimeSnapshot,
} from './lib/types';

const DISTRIBUTION_ACTIONS: ReadonlySet<SharedDistributionAction> = new Set([
  'prepare',
  'copy',
  'qr',
  'save',
  'mark',
  'cancel',
  'revert',
]);

function isDistributionAction(value: string | undefined): value is SharedDistributionAction {
  return Boolean(value && DISTRIBUTION_ACTIONS.has(value as SharedDistributionAction));
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const CREATE_FLOW_STEPS = ['Create Keyset', 'Select Share', 'Save Profile', 'Distribute Shares'];
const ROTATE_FLOW_STEPS = ['Collect Shares', 'Select Share', 'Save Profile', 'Distribute Shares'];
const IMPORT_FLOW_STEPS = ['Import Existing Device', 'Save Profile'];
const ONBOARD_FLOW_STEPS = ['Input Package', 'Onboard Device', 'Save Profile'];
const RECOVER_FLOW_STEPS = ['Collect Shares', 'Recover Key'];
const RECOVER_COLLECT_FAILURE_MESSAGE =
  'Recovery failed. Check the source package and package password, then try again.';
const GENERIC_UI_ERROR_MESSAGE = 'Something went wrong. Check the inputs and try again.';
const IMPORT_PROFILE_FAILURE_MESSAGE =
  "We couldn't import this profile backup. Check the backup text and password, then try again.";
const EXPORT_PACKAGE_FAILURE_MESSAGE =
  "We couldn't create this export package. Check the export password and try again.";
const CREATE_PRIVATE_KEY_FORMAT_ERROR =
  'Invalid private key format. Paste a valid nsec or hex key, or leave this field blank to generate a new private key in the next step.';
const DASHBOARD_RECOVER_PATH = '/dashboard/recover';
const CREATE_PATH = '/create';
const IMPORT_PATH = '/import';
const ONBOARD_PATH = '/onboard';
const ROTATE_PATH = '/rotate';
const RECOVER_PATH = '/recover';
const REPLACE_SHARE_PATH = '/replace-share';
type PublicTaskRouteView =
  | 'create-generate'
  | 'load-import'
  | 'onboard-connect'
  | 'rotate-generate'
  | 'recover-collect'
  | 'replace-share';

function normalizePathname(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

function readDashboardRouteTab(pathname: string): PwaDashboardTab | null {
  const normalized = normalizePathname(pathname);
  if (normalized === '/dashboard' || normalized === '/dashboard/signer') return 'signer';
  if (normalized === '/dashboard/permissions') return 'permissions';
  if (normalized === '/dashboard/settings') return 'settings';
  return null;
}

function dashboardRoutePath(tab: PwaDashboardTab) {
  if (tab === 'permissions') return '/dashboard/permissions';
  if (tab === 'settings') return '/dashboard/settings';
  return '/dashboard';
}

function isDashboardRoutePath(pathname: string) {
  const normalized = normalizePathname(pathname);
  return normalized === '/dashboard' || normalized.startsWith('/dashboard/');
}

function isDashboardRecoverPath(pathname: string) {
  return normalizePathname(pathname) === DASHBOARD_RECOVER_PATH;
}

function readPublicTaskRouteView(pathname: string): PublicTaskRouteView | null {
  const normalized = normalizePathname(pathname);
  if (normalized === CREATE_PATH) return 'create-generate';
  if (normalized === IMPORT_PATH) return 'load-import';
  if (normalized === ONBOARD_PATH) return 'onboard-connect';
  if (normalized === ROTATE_PATH) return 'rotate-generate';
  if (normalized === RECOVER_PATH) return 'recover-collect';
  if (normalized === REPLACE_SHARE_PATH) return 'replace-share';
  return null;
}

function publicTaskRoutePathForRoute(routeView: PublicTaskRouteView) {
  if (routeView === 'create-generate') return CREATE_PATH;
  if (routeView === 'load-import') return IMPORT_PATH;
  if (routeView === 'onboard-connect') return ONBOARD_PATH;
  if (routeView === 'rotate-generate') return ROTATE_PATH;
  if (routeView === 'recover-collect') return RECOVER_PATH;
  return REPLACE_SHARE_PATH;
}

function publicTaskRoutePathForStore(store: ReturnType<typeof useStore>) {
  const { activeView } = store;
  if (activeView === 'load-error' && store.pendingLoadErrorKind === 'profile') return null;
  if (activeView.startsWith('create')) {
    return store.drafts.createForm.mode === 'rotate' ? ROTATE_PATH : CREATE_PATH;
  }
  if (activeView.startsWith('load')) return IMPORT_PATH;
  if (activeView.startsWith('onboard')) return ONBOARD_PATH;
  if (activeView.startsWith('rotate')) return REPLACE_SHARE_PATH;
  if (isRecoverView(activeView)) {
    return store.drafts.recoverKeyForm.returnView === 'dashboard' ? null : RECOVER_PATH;
  }
  return null;
}

function replaceWithLandingRoute() {
  window.history.replaceState({ iglooPublicRoute: 'landing' }, '', '/');
}

function validateCreatePrivateKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'nsec' && decoded.data instanceof Uint8Array && decoded.data.length === 32) {
      return null;
    }
  } catch {
    // Fall through to the field-level validation message.
  }
  return CREATE_PRIVATE_KEY_FORMAT_ERROR;
}

function toPwaEventRows(lines: string[] = []): EventLogRowModel[] {
  return lines.map((line, index) => ({
    id: `pwa-log-${index}-${line}`,
    badgeLabel: derivePwaLogBadgeLabel(line),
    badgeTone: derivePwaLogBadgeTone(line),
    message: derivePwaLogMessage(line),
    timestampLabel: 'live',
  }));
}

const PWA_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const PWA_LOG_DOMAINS = new Set([
  'sync',
  'relay',
  'runtime',
  'sign',
  'ecdh',
  'ping',
  'echo',
  'policy',
  'signer policy',
  'onboard',
  'onboarding',
  'bridge',
  'profile',
  'wasm',
  'ui',
]);

const PWA_STRUCTURED_EVENT_LOG_NOISE = new Set([
  'attached live browser signer session',
]);

function toDashboardEventRows(
  events: NonNullable<PwaRuntimeSnapshot['events']> = [],
  lines: string[] = [],
): EventLogRowModel[] {
  if (!events.length) return toPwaEventRows(lines);

  const fallbackLines = lines.filter((line) => shouldKeepFallbackLineWithStructuredEvents(line));
  return [
    ...observabilityEventsToEventRows(events),
    ...toPwaEventRows(fallbackLines),
  ];
}

function shouldKeepFallbackLineWithStructuredEvents(line: string): boolean {
  const message = derivePwaLogMessage(line);
  if (!message || PWA_STRUCTURED_EVENT_LOG_NOISE.has(message)) return false;
  return !isFormattedStructuredEventLine(message);
}

function isFormattedStructuredEventLine(message: string): boolean {
  const structuredMatch = message.match(/^(.+?)\.[A-Za-z0-9_-]+(?:\s|$)/);
  if (!structuredMatch) return false;
  return PWA_LOG_DOMAINS.has(normalizePwaLogDomain(structuredMatch[1]));
}

function derivePwaLogDomain(line: string): string | null {
  let rest = line.trim();

  for (;;) {
    const bracketMatch = rest.match(/^\[([^\]]+)\]\s*/);
    if (!bracketMatch) break;

    const token = normalizePwaLogDomain(bracketMatch[1]);
    rest = rest.slice(bracketMatch[0].length);
    if (!PWA_LOG_LEVELS.has(token)) return token;
  }

  const structuredMatch = rest.match(/^(.+?)\.[A-Za-z0-9_-]+(?:\s|$)/);
  return structuredMatch ? normalizePwaLogDomain(structuredMatch[1]) : null;
}

function normalizePwaLogDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'signer policy') return 'policy';
  if (normalized === 'onboarding') return 'onboard';
  return normalized;
}

function derivePwaLogMessage(line: string): string {
  let rest = line.trim();

  for (;;) {
    const bracketMatch = rest.match(/^\[([^\]]+)\]\s*/);
    if (!bracketMatch) break;

    const token = normalizePwaLogDomain(bracketMatch[1]);
    if (!PWA_LOG_LEVELS.has(token) && !PWA_LOG_DOMAINS.has(token)) break;
    rest = rest.slice(bracketMatch[0].length);
  }

  return rest;
}

function derivePwaLogBadgeLabel(line: string): string {
  const domain = derivePwaLogDomain(line);
  if (domain) return domain;
  if (line.startsWith('[error]')) return 'error';
  if (line.startsWith('[warn]')) return 'warn';
  return 'info';
}

function derivePwaLogBadgeTone(line: string): EventLogRowModel['badgeTone'] {
  if (line.startsWith('[error]')) return 'danger';
  const domain = derivePwaLogDomain(line);
  if (domain === 'sync' || domain === 'relay') return 'sync';
  if (domain === 'sign') return 'success';
  if (domain === 'ecdh') return 'ecdh';
  if (domain === 'ping') return 'ping';
  if (domain === 'echo') return 'echo';
  if (domain === 'onboard') return 'onboard';
  if (domain === 'policy') return 'policy';
  const normalized = line.toLowerCase();
  if (normalized.includes('[sync]') || normalized.includes('[relay]')) return 'sync';
  if (normalized.includes('[sign]')) return 'success';
  if (normalized.includes('[ecdh]')) return 'ecdh';
  if (normalized.includes('[ping]')) return 'ping';
  if (normalized.includes('[echo]')) return 'echo';
  if (normalized.includes('[onboard]') || normalized.includes('[onboarding]')) return 'onboard';
  if (normalized.includes('[signer policy]') || normalized.includes('[policy]')) return 'policy';
  if (line.startsWith('[warn]')) return 'warning';
  return 'info';
}

function formatDateLabel(timestamp: number | undefined): string | undefined {
  if (!timestamp) return undefined;
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(milliseconds));
}

function formatGroupThresholdLabel(summary: ReturnType<typeof deriveGroupSummary>): string | undefined {
  if (typeof summary.threshold !== 'number' || typeof summary.memberCount !== 'number') {
    return undefined;
  }
  return `${summary.threshold} of ${summary.memberCount}`;
}

function isRuntimeErrorLeak(message: string) {
  return /undefined is not an object|cannot read propert|can't access property|evaluating |is not a function|typeerror|referenceerror|syntaxerror|\[object object\]|profile\.profile_string\.trim/i.test(
    message,
  );
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string' && message.trim()) return message.trim();
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the generic message below.
    }
  }
  return '';
}

function formatUiError(error: unknown, fallback = GENERIC_UI_ERROR_MESSAGE) {
  const message = readErrorMessage(error);
  if (!message || isRuntimeErrorLeak(message)) return fallback;
  return message;
}

function isIncorrectPassphraseError(error: unknown) {
  return error instanceof Error && /incorrect passphrase/i.test(error.message);
}

type OperatorSettingsDraft = {
  signerName: string;
  relays: string[];
  newRelayUrl: string;
  signerSettings: {
    sign_timeout_secs: number;
    ping_timeout_secs: number;
    request_ttl_secs: number;
    state_save_interval_secs: number;
    peer_selection_strategy: 'deterministic_sorted' | 'random';
  };
};

type PermissionsVisualState = {
  runtimeSnapshot?: PwaRuntimeSnapshot | null;
  peerPermissionStates?: PwaPeerPermissionState[];
  activeDashboardTab?: 'signer' | 'permissions' | 'settings';
};

type ImportSaveVisualState = {
  confirmation: PwaLoadConfirmation;
  draft?: {
    label?: string;
    relayUrls?: string;
    password?: string;
    confirmPassword?: string;
  };
};

type OnboardSaveVisualState = {
  connection: PwaOnboardConnection;
  draft?: {
    label?: string;
    relayUrls?: string;
    password?: string;
    confirmPassword?: string;
  };
};

function buildOperatorSettingsDraft(
  profile: ReturnType<typeof useStore>['profiles'][number] | null,
): OperatorSettingsDraft {
  return {
    signerName: profile?.label ?? '',
    relays: profile?.relays ?? [],
    newRelayUrl: '',
    signerSettings: profile?.signer_settings ?? {
      sign_timeout_secs: 30,
      ping_timeout_secs: 15,
      request_ttl_secs: 300,
      state_save_interval_secs: 30,
      peer_selection_strategy: 'deterministic_sorted',
    },
  };
}

function buildSettingsOnboardDraft(
  profile: ReturnType<typeof useStore>['profiles'][number] | null,
): OnboardDeviceSponsorDraft {
  const baseLabel = profile?.label?.trim() || 'Igloo';
  return {
    label: `${baseLabel} Remote Device`,
    sourcePackageText: '',
    sourcePackagePassword: '',
    packagePassword: '',
    confirmPackagePassword: '',
  };
}

function hasSettingsOnboardDraftWork(
  draft: OnboardDeviceSponsorDraft,
  profile: ReturnType<typeof useStore>['profiles'][number] | null,
) {
  const baseline = buildSettingsOnboardDraft(profile);
  return (
    draft.label !== baseline.label ||
    draft.sourcePackageText.trim().length > 0 ||
    draft.sourcePackagePassword.length > 0 ||
    draft.packagePassword.length > 0 ||
    draft.confirmPackagePassword.length > 0
  );
}

type PwaRuntimePeerStatus = {
  idx: number;
  pubkey: string;
  known: boolean;
  last_seen: number | null;
  online: boolean;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  latency_ms?: number;
  nonce_inventory_history?: PwaRuntimePeerNonceInventorySample[];
  can_sign: boolean;
  can_ping?: boolean;
  can_onboard?: boolean;
  can_ecdh?: boolean;
  should_send_nonces: boolean;
};

type PwaRuntimePeerNonceInventorySample = {
  updated_at: number;
  held_count: number;
};

type PwaRuntimePendingOperation = {
  request_id: string;
  op_type: string;
  threshold: number;
  started_at: number | null;
  timeout_at: number | null;
  collected_responses: unknown[];
  target_peers: string[];
  context?: unknown;
};

type PwaRuntimeReadiness = RuntimeReadiness;

type PwaRuntimeStatus = {
  peers?: PwaRuntimePeerStatus[];
  pending_operations?: PwaRuntimePendingOperation[];
  metadata?: {
    peers?: string[];
  };
  status?: {
    last_active?: number;
  };
};

type PwaDashboardPeer = PeerPolicy & {
  permissionMethods?: PermissionMethodKey[];
  latencyMs?: number;
  nonceInventoryHistory?: Array<{ updatedAt: number; heldCount: number }>;
};

const DASHBOARD_PERMISSION_METHODS: PermissionMethodKey[] = ['sign', 'ecdh', 'ping', 'onboard'];

type DashboardPermissionState = {
  pubkey: string;
  effective_policy: {
    request: Record<PermissionMethodKey, boolean>;
    respond: Record<PermissionMethodKey, boolean>;
  };
};

function derivePwaPeers(
  policies: DashboardPermissionState[],
  runtimeStatus: RuntimeStatusSummary | null | undefined,
): PwaDashboardPeer[] {
  const summary = runtimeStatus;
  const policyByPubkey = new Map<string, DashboardPermissionState>();
  for (const policy of policies) {
    policyByPubkey.set(policy.pubkey.toLowerCase(), policy);
  }
  for (const policy of summary?.peer_permission_states ?? []) {
    policyByPubkey.set(policy.pubkey.toLowerCase(), policy);
  }

  const base = new Map<string, PwaDashboardPeer>();
  const orderedPubkeys: string[] = [];

  const markOrdered = (pubkey: string) => {
    if (!orderedPubkeys.includes(pubkey)) {
      orderedPubkeys.push(pubkey);
    }
  };

  Array.from(policyByPubkey.values()).forEach((policy, index) => {
    base.set(policy.pubkey.toLowerCase(), {
      alias: `Peer ${index + 1}`,
      pubkey: policy.pubkey.toLowerCase(),
      send: policy.effective_policy.request.sign,
      receive: policy.effective_policy.respond.sign,
      permissionMethods: deriveDashboardPermissionMethods(policy.effective_policy),
      state: 'offline',
      statusLabel: 'offline',
      lastSeen: null,
      incomingAvailable: 0,
      outgoingAvailable: 0,
      outgoingSpent: 0,
      latencyMs: undefined,
      nonceInventoryHistory: undefined,
      shouldSendNonces: false,
    });
  });

  for (const [index, peer] of (summary?.metadata?.peers ?? []).entries()) {
    const normalized = peer.toLowerCase();
    const existing = base.get(normalized);
    markOrdered(normalized);
    base.set(normalized, {
      alias: existing?.alias ?? `Peer ${index + 1}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      permissionMethods: existing?.permissionMethods,
      state: 'offline',
      statusLabel: 'offline',
      lastSeen: existing?.lastSeen ?? null,
      incomingAvailable: existing?.incomingAvailable ?? 0,
      outgoingAvailable: existing?.outgoingAvailable ?? 0,
      outgoingSpent: existing?.outgoingSpent ?? 0,
      latencyMs: existing?.latencyMs,
      nonceInventoryHistory: existing?.nonceInventoryHistory,
      shouldSendNonces: existing?.shouldSendNonces ?? false,
    });
  }

  const runtimePeers = [...(summary?.peers ?? [])].sort((left, right) => left.idx - right.idx);
  for (const peer of runtimePeers) {
    const normalized = peer.pubkey.toLowerCase();
    const existing = base.get(normalized);
    markOrdered(normalized);
    base.set(normalized, {
      alias: `Peer #${peer.idx}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      permissionMethods: existing?.permissionMethods ?? deriveRuntimePeerPermissionMethods(peer),
      // Match Paper and the shared adapter: "known" is identity metadata, not a
      // reachable state. If the runtime says the peer is not online, render it
      // as offline even when it is a known member of the keyset.
      state: peer.online ? (peer.can_sign ? 'online' : 'idle') : 'offline',
      statusLabel: peer.online ? (peer.can_sign ? 'sign-ready' : 'online') : 'offline',
      lastSeen: peer.last_seen,
      incomingAvailable: peer.incoming_available,
      outgoingAvailable: peer.outgoing_available,
      outgoingSpent: peer.outgoing_spent,
      latencyMs: readOptionalNumber(peer as unknown as Record<string, unknown>, 'latency_ms'),
      nonceInventoryHistory: peer.nonce_inventory_history?.map((sample) => ({
        updatedAt: sample.updated_at,
        heldCount: sample.held_count,
      })),
      shouldSendNonces: peer.should_send_nonces,
    });
  }

  for (const pubkey of base.keys()) {
    markOrdered(pubkey);
  }

  return orderedPubkeys.flatMap((pubkey) => {
    const peer = base.get(pubkey);
    return peer ? [peer] : [];
  });
}

function deriveDashboardPermissionMethods(policy: DashboardPermissionState['effective_policy']) {
  return DASHBOARD_PERMISSION_METHODS.filter(
    (method) => policy.request[method] || policy.respond[method],
  );
}

function deriveRuntimePeerPermissionMethods(peer: PwaRuntimePeerStatus): PermissionMethodKey[] {
  const methods: PermissionMethodKey[] = [];
  if (peer.can_sign) methods.push('sign');
  if (peer.can_ecdh) methods.push('ecdh');
  if (peer.can_ping) methods.push('ping');
  if (peer.can_onboard) methods.push('onboard');
  return methods;
}

function derivePendingApprovals(runtimeStatus: unknown) {
  const summary = (runtimeStatus ?? null) as PwaRuntimeStatus | null;
  return (summary?.pending_operations ?? [])
    .filter(isPendingApprovalOperation)
    .map((operation, index) => {
      const context = isRecord(operation.context) ? operation.context : {};
      const methodLabel = readString(context, 'method_label') ?? operation.op_type;
      const detailLabel = readString(context, 'detail_label')
        ?? formatPendingOperationDetail(operation.op_type, context);
      const peerLabel = readString(context, 'peer_label')
        ?? formatPendingPeerLabel(operation.target_peers[0], index);
      return {
        id: operation.request_id,
        methodLabel,
        peerLabel,
        detailLabel,
        expiresLabel: formatPendingExpiry(operation),
      };
    });
}

function derivePendingOperations(runtimeStatus: unknown) {
  const summary = (runtimeStatus ?? null) as PwaRuntimeStatus | null;
  return (summary?.pending_operations ?? []).map((operation) => {
    const responseCount = operation.collected_responses.length;
    return {
      id: operation.request_id,
      operationLabel: operation.op_type,
      thresholdLabel: `threshold ${operation.threshold}`,
      startedLabel: formatRuntimeTimestamp(operation.started_at),
      timeoutLabel: formatPendingExpiry(operation),
      responseLabel: `${responseCount} ${responseCount === 1 ? 'response' : 'responses'}`,
    };
  });
}

function isPendingApprovalOperation(operation: PwaRuntimePendingOperation) {
  const context = isRecord(operation.context) ? operation.context : {};
  return (
    context.approval_required === true ||
    readString(context, 'method_label') !== undefined ||
    readString(context, 'peer_label') !== undefined ||
    readString(context, 'detail_label') !== undefined
  );
}

function formatPendingOperationDetail(operationType: string, context: Record<string, unknown>) {
  const kind = readString(context, 'kind');
  const kindLabel = readString(context, 'kind_label');
  if (kind && kindLabel) return `kind:${kind} ${kindLabel}`;
  if (kind) return `kind:${kind}`;
  const detail = readString(context, 'detail') ?? readString(context, 'event') ?? readString(context, 'request');
  return detail ?? operationType;
}

function formatPendingPeerLabel(pubkey: string | undefined, index: number) {
  return pubkey ? `Peer ${shortProfileId(pubkey)}` : `Peer #${index + 1}`;
}

function formatPendingExpiry(operation: PwaRuntimePendingOperation) {
  const started = operation.started_at;
  const timeout = operation.timeout_at;
  if (typeof started === 'number' && typeof timeout === 'number' && timeout >= started) {
    return formatDurationLabel(timeout - started);
  }
  return formatRuntimeTimestamp(timeout);
}

function formatDurationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${minutes}m`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatRuntimeTimestamp(value: number | null) {
  if (typeof value !== 'number') return 'n/a';
  const normalized = value > 10_000_000_000 ? value : value * 1000;
  return new Date(normalized).toLocaleString();
}

function deriveRuntimeSummaryLabel(runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot']) {
  if (!runtimeSnapshot?.active) return 'Signer Stopped';
  const readiness = runtimeSnapshot.readiness ?? null;
  if (readiness && (!readiness.sign_ready || !readiness.ecdh_ready || !readiness.restore_complete)) {
    return 'Signer Running (Degraded)';
  }
  return 'Signer Running';
}

function deriveRuntimeRelaySummary(
  relays: readonly string[] | undefined,
  runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot'],
) {
  if (!runtimeSnapshot?.active) return 'Relays, peers, and signing are offline.';
  const activeRelays = (relays ?? []).filter(Boolean);
  if (!activeRelays.length) return 'No relays configured';
  if (isAllRelaysOffline(runtimeSnapshot.readiness ?? null)) return 'All relays unreachable · signing degraded.';
  if (runtimeSnapshot.readiness && !runtimeSnapshot.readiness.sign_ready) return 'Policy or readiness gate active.';
  return `Connected to ${activeRelays.join(', ')}`;
}

function deriveDashboardAttention(
  relays: readonly string[] | undefined,
  runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot'],
): DashboardAttentionModel | undefined {
  const activeRelays = (relays ?? []).filter(Boolean);
  if (activeRelays.length === 0) {
    return {
      tone: 'warning',
      title: 'No relays configured',
      description: 'Add at least one relay in Settings before this signer can find peers.',
    };
  }

  const readiness = runtimeSnapshot?.readiness ?? null;
  if (runtimeSnapshot?.active && readiness && isAllRelaysOffline(readiness)) {
    const relayCount = activeRelays.length;
    const relayLabel = relayCount === 1 ? 'relay' : 'relays';
    return {
      tone: 'warning',
      title: 'All Relays Offline',
      description: 'No relay route to peers.',
      details: [
        {
          label: 'Readiness',
          title: 'All Relays Offline',
          description: 'No relay route to peers.',
          badges: [
            { label: `0 / ${relayCount} ${relayLabel} reachable`, tone: 'danger' },
            { label: 'Ready count degraded', tone: 'warning' },
          ],
        },
        {
          label: 'Recovery',
          description: 'Check network, DNS, and firewall.',
          callout: 'Blocked until a relay connects.',
        },
      ],
      actionLabel: 'Retry Connections',
    };
  }

  if (runtimeSnapshot?.active && readiness && !readiness.sign_ready) {
    const signingDescription = formatSigningBlockedDescription(readiness);
    return {
      tone: 'warning',
      title: 'Signing Blocked',
      description: 'Requests held pending clearance.',
      details: [
        {
          label: 'Common Causes',
          title: 'Signing Blocked',
          description: 'Requests held pending clearance.',
          badges: [
            { label: 'Policy decision pending', tone: 'warning' },
            { label: 'Not enough ready peers', tone: 'warning' },
            { label: 'Pool imbalance', tone: 'warning' },
          ],
        },
        {
          label: 'Operator Action',
          description: 'Clear via permissions or approvals.',
          callout: signingDescription,
        },
      ],
    };
  }

  return undefined;
}

function isAllRelaysOffline(readiness: RuntimeReadiness | null) {
  return (readiness?.degraded_reasons ?? []).some((reason) => {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes('no connected relays') ||
      (normalized.includes('relay') &&
        /(unreachable|offline|unavailable|failed|connect)/i.test(reason))
    );
  });
}

function formatSigningBlockedDescription(readiness: RuntimeReadiness) {
  const readyCount = Math.max(0, readiness.signing_peer_count);
  const threshold = Math.max(1, readiness.threshold);
  const missingCount = Math.max(1, threshold - readyCount);
  const missingLabel = missingCount === 1 ? 'another signing peer' : `${missingCount} more signing peers`;
  return `${readyCount} of ${threshold} signing peers are ready. Bring ${missingLabel} online before approving signatures.`;
}

type PwaRuntimeEvent = NonNullable<PwaRuntimeSnapshot['events']>[number];

function deriveDashboardSigningFailure(
  runtimeSnapshot: PwaRuntimeSnapshot | null | undefined,
  dismissedFailureIds: readonly string[],
): DashboardSigningFailureModel | null {
  const dismissed = new Set(dismissedFailureIds);
  const events = runtimeSnapshot?.events ?? [];
  for (const event of [...events].reverse()) {
    if (!isSigningFailureEvent(event)) continue;
    const id = runtimeFailureId(event);
    if (dismissed.has(id)) continue;
    return {
      id,
      message: formatSigningFailureMessage(event),
      detail: formatSigningFailureDetail(event),
    };
  }
  return null;
}

function isSigningFailureEvent(event: PwaRuntimeEvent) {
  if (event.domain !== 'runtime' || event.event !== 'failure') return false;
  const opType = readString(event, 'op_type') ?? readString(event, 'operation') ?? readString(event, 'kind');
  return opType === 'sign';
}

function runtimeFailureId(event: PwaRuntimeEvent) {
  return (
    readString(event, 'request_id') ??
    `${event.ts}:${event.component}:${event.domain}:${event.event}:${readString(event, 'message') ?? 'failure'}`
  );
}

function formatSigningFailureMessage(event: PwaRuntimeEvent) {
  const eventKind = readOptionalNumber(event, 'event_kind') ?? readOptionalNumber(event, 'kind');
  const retryAttempts = readOptionalNumber(event, 'retry_attempts') ?? readOptionalNumber(event, 'attempts');
  const attemptSentence =
    typeof retryAttempts === 'number'
      ? `All ${retryAttempts} retry attempts exhausted.`
      : 'All retry attempts exhausted.';
  return typeof eventKind === 'number'
    ? `Unable to complete signature for event kind:${eventKind}. ${attemptSentence}`
    : `Unable to complete signature. ${attemptSentence}`;
}

function formatSigningFailureDetail(event: PwaRuntimeEvent) {
  const parts: string[] = [];
  const requestId = readString(event, 'request_id');
  const peersResponded =
    readOptionalNumber(event, 'peers_responded') ?? readOptionalNumber(event, 'responded_peers');
  const peerThreshold =
    readOptionalNumber(event, 'peers_required') ??
    readOptionalNumber(event, 'required_peers') ??
    readOptionalNumber(event, 'threshold');
  const error =
    readString(event, 'message') ??
    readString(event, 'reason_code') ??
    readString(event, 'error') ??
    'signing round failed';

  if (requestId) parts.push(`Round: ${requestId}`);
  if (typeof peersResponded === 'number' && typeof peerThreshold === 'number') {
    parts.push(`Peers responded: ${peersResponded}/${peerThreshold}`);
  }
  parts.push(`Error: ${error}`);

  return parts.join(' · ');
}

// Summary line for the export modal, e.g.
// "Share #1 · Keyset: My Signing Key · 2 relays · 3 peers".
function deriveSignerDashboardView(
  profile: ReturnType<typeof useStore>['profiles'][number] | null,
  runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot'],
  peerPermissionStates: ReturnType<typeof useStore>['peerPermissionStates'],
): SignerDashboardViewModel | null {
  if (!profile) return null;

  const summary = (runtimeSnapshot?.runtime_status ?? null) as PwaRuntimeStatus | null;
  const readiness = (runtimeSnapshot?.readiness ?? null) as (PwaRuntimeReadiness & { threshold?: number }) | null;
  const peerTotal = summary?.metadata?.peers?.length ? summary.metadata.peers.length + 1 : null;
  const thresholdLabel =
    typeof readiness?.threshold === 'number' && peerTotal ? `${readiness.threshold}/${peerTotal}` : 'threshold n/a';

  return {
    profileName: profile.label || 'Unnamed device',
    thresholdLabel,
    memberLabel: Number.isFinite(profile.member_idx) ? `Share #${profile.member_idx}` : undefined,
    publicKeyLabel: profile.group_public_key,
    shareLabel: profile.share_public_key,
    groupKey: toDashboardKey(profile.group_public_key),
    shareKey: toDashboardKey(profile.share_public_key),
    running: Boolean(runtimeSnapshot?.active),
    readinessLabel: deriveRuntimeSummaryLabel(runtimeSnapshot),
    relaySummary: deriveRuntimeRelaySummary(profile.relays, runtimeSnapshot),
    attention: deriveDashboardAttention(profile.relays, runtimeSnapshot),
    pendingApprovalRows: derivePendingApprovals(runtimeSnapshot?.runtime_status),
    peerRows: derivePwaPeers(peerPermissionStates, runtimeSnapshot?.runtime_status).map((peer) => ({
      id: peer.pubkey,
      alias: peer.alias,
      pubkey: peer.pubkey,
      state: peer.state,
      statusLabel: peer.statusLabel ?? peer.state,
      permissionMethods: peer.permissionMethods,
      lastSeenLabel: peer.lastSeen ? `last seen ${formatRuntimeTimestamp(peer.lastSeen)}` : undefined,
      incomingAvailable: peer.incomingAvailable,
      outgoingAvailable: peer.outgoingAvailable,
      outgoingSpent: peer.outgoingSpent,
      latencyMs: peer.latencyMs,
      nonceInventoryHistory: peer.nonceInventoryHistory,
    })),
    pendingOperationRows: derivePendingOperations(runtimeSnapshot?.runtime_status),
    // Prefer structured events (domain/event tags + filter), while preserving
    // non-duplicate host lifecycle lines that are only available as strings.
    eventRows: toDashboardEventRows(runtimeSnapshot?.events, runtimeSnapshot?.runtime_log_lines),
  };
}

function derivePolicyDashboardView(
  active: boolean,
  peerPermissionStates: ReturnType<typeof useStore>['peerPermissionStates'],
): PolicyDashboardViewModel {
  return {
    peerRows: active
      ? peerPermissionStates.map((policy) => ({
          pubkey: policy.pubkey,
          request: policy.effective_policy.request,
          respond: policy.effective_policy.respond,
          manualOverride: {
            request: policy.manual_override.request,
            respond: policy.manual_override.respond,
          },
        }))
      : [],
  };
}

function deriveHeaderMode(activeView: ReturnType<typeof useStore>['activeView']) {
  if (activeView === 'landing') return 'welcome';
  if (activeView === 'dashboard') return 'dashboard';
  return 'task';
}

function isPaperWelcomeSurface(store: ReturnType<typeof useStore>) {
  return store.activeView === 'landing' || store.activeView === 'create-generate';
}

function isRecoverView(activeView: ReturnType<typeof useStore>['activeView']) {
  return activeView === 'recover-collect' || activeView === 'recover-key';
}

function resolveRecoverReturnTarget(store: ReturnType<typeof useStore>) {
  const { recoverKeyForm } = store.drafts;
  const hasSourceProfile = store.profiles.some((profile) => profile.id === recoverKeyForm.sourceProfileId);
  const hasUnlockedDashboardContext =
    Boolean(store.unlockPassphrase.trim()) || Boolean(store.runtimeSnapshot?.active);
  return recoverKeyForm.returnView === 'dashboard' && hasSourceProfile && hasUnlockedDashboardContext
    ? 'dashboard'
    : 'landing';
}

function deriveHeaderTaskLabel(store: ReturnType<typeof useStore>) {
  const { activeView } = store;
  if (activeView.startsWith('create') && store.drafts.createForm.mode === 'rotate') {
    return 'Rotate';
  }
  if (activeView.startsWith('create')) return 'Create';
  if (activeView.startsWith('rotate')) return 'Replace Share';
  if (activeView.startsWith('onboard')) return 'Onboard Device';
  if (activeView.startsWith('load')) return 'Import Existing Device';
  if (activeView.startsWith('recover')) return 'Recover';
  return 'Installable browser workspace';
}

function deriveWelcomeReturningProfile(profile: ReturnType<typeof useStore>['profiles'][number]) {
  const groupPackage = parseJsonObject(profile.group_package_json);
  const threshold = typeof groupPackage?.threshold === 'number' ? groupPackage.threshold : 2;
  const memberCount = Array.isArray(groupPackage?.members) ? groupPackage.members.length : 3;
  // `member_idx` is public profile metadata; the raw share package json (with
  // its secret seckey) is no longer persisted on the profile record.
  const memberIdx = profile.member_idx;

  return {
    id: profile.id,
    label: profile.label || 'My Signing Key',
    thresholdLabel: `${threshold}/${memberCount}`,
    memberLabel: `#${Number.isFinite(memberIdx) ? memberIdx : 0}`,
    publicKeyLabel: formatWelcomeKey(profile.share_public_key || profile.id),
  };
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatWelcomeKey(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function compactReplacePackageLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'bfonboard1...';
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 24)}...`;
}

function formatReplacementKeyLabel(value: string) {
  return toDashboardKey(value)?.display ?? formatWelcomeKey(value);
}

function deriveShareMemberLabel(sharePackageJson: string | undefined) {
  try {
    const parsed = sharePackageJson ? (JSON.parse(sharePackageJson) as { idx?: unknown }) : null;
    return typeof parsed?.idx === 'number' ? `Share #${parsed.idx}` : 'Share #1';
  } catch {
    return 'Share #1';
  }
}

function deriveWelcomeReturningLayout(profileCount: number) {
  if (profileCount === 1) return 'single';
  if (profileCount <= 3) return 'multi';
  return 'many';
}

type ReplaceShareResult = {
  groupKeyLabel: string;
  oldShareKeyLabel: string;
  newShareKeyLabel: string;
};

type ReplaceShareVisualState =
  | { state: 'applying'; connection: PwaOnboardConnection; applying?: boolean; unlockPassphrase?: string }
  | { state: 'failed'; connection: PwaOnboardConnection; message: string; unlockPassphrase?: string }
  | { state: 'success'; result: ReplaceShareResult };

type SettingsOnboardVisualState = {
  result: OnboardDeviceSponsorResult;
  handoffStatus?: string | null;
  handoffStatusTone?: 'info' | 'success' | 'warning';
};

export function RecoverPrivateKeyView({
  recovered,
  onClear,
}: {
  recovered: { nsec: string; signingKeyHex: string };
  onClear: () => void;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [encrypt, setEncrypt] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  // Auto-clear the recovered key from memory after 60 seconds (matches the Paper
  // security treatment). The key is never persisted; this is an extra safeguard on
  // top of the navigate-away clear.
  React.useEffect(() => {
    const timer = window.setTimeout(onClear, 60_000);
    return () => window.clearTimeout(timer);
  }, [onClear]);

  // Encrypt Key: when enabled with a valid (non-empty, matching) password, every export
  // emits a NIP-49 `ncryptsec1` instead of the plaintext nsec. The encryption runs in
  // memory only; neither form is ever persisted.
  const passwordsMatch = password === confirmPassword;
  const encryptReady = encrypt && password.length > 0 && passwordsMatch;
  const encryptedKey = React.useMemo(() => {
    if (!encryptReady) return null;
    try {
      return nip49.encrypt(hexToBytes(recovered.signingKeyHex), password);
    } catch {
      return null;
    }
  }, [encryptReady, password, recovered.signingKeyHex]);

  // When Encrypt Key is on, exports are blocked until the password is valid.
  const exportValue = encrypt ? encryptedKey : recovered.nsec;
  const exportsDisabled = encrypt && !encryptedKey;
  const exportControlsDisabled = exportsDisabled || copying;
  const passwordError = encrypt && confirmPassword.length > 0 && !passwordsMatch
    ? 'Passwords do not match.'
    : null;
  const fieldLabel = encrypt ? 'Encrypted Key (ncryptsec)' : 'Recovered NSEC';
  const displayValue = exportValue ?? recovered.nsec;
  const masked = `${displayValue.slice(0, 10)}${'•'.repeat(32)}`;

  async function copyKey() {
    if (!exportValue || copying) return;
    setCopying(true);
    setCopied(false);
    setSaved(false);
    try {
      await navigator.clipboard?.writeText(exportValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Leave the key visible and controls unlocked; the user can retry or save instead.
    } finally {
      setCopying(false);
    }
  }

  function saveKey() {
    if (!exportValue || copying) return;
    const blob = new Blob([exportValue], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = encrypt ? 'recovered-key.ncryptsec' : 'recovered-nsec.txt';
    anchor.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setCopied(false);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <PublicTaskShell>
        <StepProgress steps={RECOVER_FLOW_STEPS} active={1} />
        <PageBackLink label="Back to Welcome" onBack={onClear} />
        <PublicTaskTitle
          title="Recover Private Key"
          description="Your private key has been recovered. Please handle it with care!"
        />
        <section className="igloo-flow-root igloo-stack">
          <section className="igloo-task-banner">
            <span className="igloo-task-kicker">Security Warning</span>
            <ul>
              <li>Your private key will auto-clear in 60 seconds.</li>
              <li>Do not screenshot or share this key.</li>
              <li>Copy to a secure password manager.</li>
            </ul>
          </section>

          <label>
            {fieldLabel}
            <div className="igloo-recover-key-field">
              <span>{revealed ? displayValue : masked}</span>
            </div>
          </label>

          <div className="igloo-button-row">
            <Button
              type="button"
              size="sm"
              onClick={() => void copyKey()}
              disabled={exportsDisabled}
              loading={copying}
              loadingLabel="Copying..."
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={saveKey} disabled={exportControlsDisabled}>
              {saved ? 'Saved!' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setQrOpen(true)}
              disabled={exportControlsDisabled}
            >
              QR code
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setRevealed((value) => !value)}
              disabled={copying}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClear} disabled={copying}>
              Clear
            </Button>
          </div>

          <label className="igloo-recover-encrypt-toggle">
            <input
              type="checkbox"
              checked={encrypt}
              disabled={copying}
              onChange={(event) => setEncrypt(event.target.checked)}
            />
            <span>
              <strong>Encrypt Key</strong>
              <small>Protect the exported key with a password before saving or sharing.</small>
            </span>
          </label>
          {encrypt ? (
            <div className="igloo-stack">
              <label>
                Password
                <PasswordField
                  value={password}
                  disabled={copying}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm Password
                <PasswordField
                  value={confirmPassword}
                  disabled={copying}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              {passwordError ? <span className="igloo-field-error">{passwordError}</span> : null}
            </div>
          ) : null}
        </section>
      </PublicTaskShell>
      <PublicFocusFooter />

      <QrPayloadModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={encrypt ? 'Encrypted Key (ncryptsec)' : 'Recovered NSEC'}
        payload={exportValue ?? ''}
        label={encrypt ? 'Scan to import the encrypted key' : 'Scan to import the recovered private key'}
      />
    </>
  );
}

function AppShell() {
  const store = useStore();
  const [uiError, setUiError] = React.useState<string | null>(null);
  const [welcomeUnlockProfileId, setWelcomeUnlockProfileId] = React.useState<string | null>(null);
  const [welcomeUnlockPassword, setWelcomeUnlockPassword] = React.useState('');
  const [welcomeUnlockError, setWelcomeUnlockError] = React.useState<string | null>(null);
  const [welcomeUnlockSubmitting, setWelcomeUnlockSubmitting] = React.useState(false);
  const [welcomeDeleteProfileId, setWelcomeDeleteProfileId] = React.useState<string | null>(null);
  const [recoveredKey, setRecoveredKey] = React.useState<{ nsec: string; signingKeyHex: string } | null>(null);
  const [recoverCollectError, setRecoverCollectError] = React.useState<string | null>(null);
  const [localSourceUnlockError, setLocalSourceUnlockError] = React.useState<string | null>(null);
  const [createPrivateKeyError, setCreatePrivateKeyError] = React.useState<string | null>(null);
  const [dashboardCopiedField, setDashboardCopiedField] = React.useState<'group' | null>(null);
  const [dismissedSigningFailureIds, setDismissedSigningFailureIds] = React.useState<string[]>([]);
  const [settingsSidebarOpen, setSettingsSidebarOpen] = React.useState(false);
  const [settingsClearCredentialsOpen, setSettingsClearCredentialsOpen] = React.useState(false);
  const [settingsOnboardOpen, setSettingsOnboardOpen] = React.useState(false);
  const [settingsOnboardDraft, setSettingsOnboardDraft] =
    React.useState<OnboardDeviceSponsorDraft>(() => buildSettingsOnboardDraft(null));
  const [settingsOnboardResult, setSettingsOnboardResult] =
    React.useState<OnboardDeviceSponsorResult | null>(null);
  const [settingsOnboardError, setSettingsOnboardError] = React.useState<string | null>(null);
  const [settingsOnboardErrorFields, setSettingsOnboardErrorFields] = React.useState<
    OnboardDeviceSponsorErrorField[]
  >([]);
  const [settingsOnboardBusy, setSettingsOnboardBusy] = React.useState(false);
  const [settingsOnboardQrOpen, setSettingsOnboardQrOpen] = React.useState(false);
  const [settingsOnboardHandoffStatus, setSettingsOnboardHandoffStatus] =
    React.useState<string | null>(null);
  const [settingsOnboardHandoffTone, setSettingsOnboardHandoffTone] =
    React.useState<'info' | 'success' | 'warning'>('success');
  const [settingsOnboardHandoffAction, setSettingsOnboardHandoffAction] =
    React.useState<'copy' | 'save' | 'qr' | null>(null);
  const [settingsPasswordOpen, setSettingsPasswordOpen] = React.useState(false);
  const [settingsPasswordCurrent, setSettingsPasswordCurrent] = React.useState('');
  const [settingsPasswordNext, setSettingsPasswordNext] = React.useState('');
  const [settingsPasswordConfirm, setSettingsPasswordConfirm] = React.useState('');
  const [settingsPasswordError, setSettingsPasswordError] = React.useState<string | null>(null);
  const [settingsPasswordBusy, setSettingsPasswordBusy] = React.useState(false);
  const [replaceShareQrOpen, setReplaceShareQrOpen] = React.useState(false);
  const [replaceShareApplying, setReplaceShareApplying] = React.useState(false);
  const [replaceShareError, setReplaceShareError] = React.useState<string | null>(null);
  const [replaceShareResult, setReplaceShareResult] = React.useState<ReplaceShareResult | null>(null);
  const [visualReplaceShareConnection, setVisualReplaceShareConnection] =
    React.useState<PwaOnboardConnection | null>(null);
  const [visualImportSaveState, setVisualImportSaveState] =
    React.useState<ImportSaveVisualState | null>(null);
  const [visualOnboardSaveState, setVisualOnboardSaveState] =
    React.useState<OnboardSaveVisualState | null>(null);
  const [visualPermissionsState, setVisualPermissionsState] =
    React.useState<PermissionsVisualState | null>(null);
  const visualReplaceShareAppliedRef = React.useRef(false);
  const visualImportSaveAppliedRef = React.useRef(false);
  const visualOnboardSaveAppliedRef = React.useRef(false);
  const visualPermissionsAppliedRef = React.useRef(false);
  const visualSettingsOnboardAppliedRef = React.useRef(false);
  const autoApplyReplaceShareKeyRef = React.useRef<string | null>(null);
  const localSourceUnlockRequestRef = React.useRef(0);
  const [dashboardRouteTab, setDashboardRouteTab] = React.useState<PwaDashboardTab | null>(() =>
    readDashboardRouteTab(window.location.pathname),
  );
  const [dashboardRouteRecover, setDashboardRouteRecover] = React.useState(() =>
    isDashboardRecoverPath(window.location.pathname),
  );
  const [resumeDeviceRevision, setResumeDeviceRevision] = React.useState(0);
  const dashboardRouteHydratedRef = React.useRef(false);
  const dashboardRoutePopStateRef = React.useRef(false);
  const publicRouteHydratedRef = React.useRef(false);
  const publicRoutePopStateRef = React.useRef(false);
  const publicRouteLandingOverrideRef = React.useRef(false);

  const syncDashboardRoute = React.useCallback(
    (tab: PwaDashboardTab, mode: 'push' | 'replace' = 'push') => {
      const path = dashboardRoutePath(tab);
      setDashboardRouteTab(tab);
      setDashboardRouteRecover(false);
      if (normalizePathname(window.location.pathname) === path) return;
      const method = mode === 'replace' ? 'replaceState' : 'pushState';
      window.history[method]({ iglooDashboardTab: tab }, '', path);
    },
    [],
  );

  const syncDashboardRecoverRoute = React.useCallback((mode: 'push' | 'replace' = 'push') => {
    setDashboardRouteTab(null);
    setDashboardRouteRecover(true);
    if (normalizePathname(window.location.pathname) === DASHBOARD_RECOVER_PATH) return;
    const method = mode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method]({ iglooDashboardRoute: 'recover' }, '', DASHBOARD_RECOVER_PATH);
  }, []);

  const syncLandingRoute = React.useCallback((mode: 'push' | 'replace' = 'push') => {
    setDashboardRouteTab(null);
    setDashboardRouteRecover(false);
    if (normalizePathname(window.location.pathname) === '/') return;
    const method = mode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method]({ iglooPublicRoute: 'landing' }, '', '/');
  }, []);

  React.useEffect(() => {
    const handlePopState = () => {
      dashboardRoutePopStateRef.current = dashboardRouteHydratedRef.current;
      const pathname = window.location.pathname;
      setDashboardRouteTab(readDashboardRouteTab(pathname));
      setDashboardRouteRecover(isDashboardRecoverPath(pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  React.useEffect(() => {
    const applyPublicTaskRoute = () => {
      const normalizedPath = normalizePathname(window.location.pathname);
      const routeView = readPublicTaskRouteView(normalizedPath);
      const routePath = routeView ? publicTaskRoutePathForRoute(routeView) : null;
      const activeRoutePath = publicTaskRoutePathForStore(store);
      const isPopStateRoute = publicRoutePopStateRef.current;
      const shouldApplyRoute = !publicRouteHydratedRef.current || isPopStateRoute;
      publicRouteHydratedRef.current = true;
      publicRoutePopStateRef.current = false;
      if (!routeView) {
        if (normalizedPath === '/' && activeRoutePath && isPopStateRoute) {
          setDashboardRouteTab(null);
          setDashboardRouteRecover(false);
          publicRouteLandingOverrideRef.current = true;
          store.setActiveView('landing');
        }
        return;
      }
      if (!shouldApplyRoute) return;
      if (routeView === 'create-generate') {
        setDashboardRouteTab(null);
        setDashboardRouteRecover(false);
        if (store.activeView === 'create-generate' && store.drafts.createForm.mode !== 'rotate') return;
        store.startCreateKeyset();
        return;
      }
      if (routeView === 'rotate-generate') {
        setDashboardRouteTab(null);
        setDashboardRouteRecover(false);
        const profileId =
          store.drafts.rotationForm.sourceProfileId ||
          store.selectedProfileId ||
          store.profiles[0]?.id ||
          '';
        if (!profileId) {
          publicRouteLandingOverrideRef.current = true;
          replaceWithLandingRoute();
          store.setActiveView('landing');
          return;
        }
        if (
          store.activeView === 'create-generate' &&
          store.drafts.createForm.mode === 'rotate' &&
          store.drafts.rotationForm.sourceProfileId === profileId
        ) {
          return;
        }
        const profile = store.profiles.find((entry) => entry.id === profileId) ?? null;
        const summary = profile ? deriveGroupSummary(profile.group_package_json) : {};
        store.selectProfile(profileId);
        store.updateCreateForm('mode', 'rotate');
        store.updateRotationForm('sourceProfileId', profileId);
        store.updateCreateForm('groupName', summary.keysetName ?? profile?.label ?? '');
        if (typeof summary.threshold === 'number') store.updateCreateForm('threshold', String(summary.threshold));
        if (typeof summary.memberCount === 'number') store.updateCreateForm('count', String(summary.memberCount));
        store.setActiveView('create-generate');
        return;
      }
      if (store.activeView === routeView || activeRoutePath === routePath) return;
      setDashboardRouteTab(null);
      setDashboardRouteRecover(false);
      if (routeView === 'recover-collect') {
        if (store.activeView === 'recover-key') {
          publicRouteLandingOverrideRef.current = true;
          replaceWithLandingRoute();
          store.setActiveView('landing');
          return;
        }
        const profileId =
          store.drafts.recoverKeyForm.sourceProfileId ||
          store.selectedProfileId ||
          store.profiles[0]?.id ||
          '';
        if (!profileId) {
          publicRouteLandingOverrideRef.current = true;
          replaceWithLandingRoute();
          store.setActiveView('landing');
          return;
        }
        store.startRecoverKey(profileId, 'landing');
        return;
      }
      if (routeView === 'replace-share') {
        const profileId = store.selectedProfileId || store.profiles[0]?.id || '';
        if (!profileId) {
          publicRouteLandingOverrideRef.current = true;
          replaceWithLandingRoute();
          store.setActiveView('landing');
          return;
        }
        store.startRotateKey(profileId);
        return;
      }
      store.setActiveView(routeView);
    };
    applyPublicTaskRoute();
    const handlePopState = () => {
      publicRoutePopStateRef.current = publicRouteHydratedRef.current;
      applyPublicTaskRoute();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [store]);

  React.useEffect(() => {
    if (!isDashboardRoutePath(window.location.pathname)) return;
    const ownsDashboardRoute =
      store.activeView === 'dashboard' ||
      (isRecoverView(store.activeView) && resolveRecoverReturnTarget(store) === 'dashboard');
    if (ownsDashboardRoute) return;
    setDashboardRouteTab(null);
    setDashboardRouteRecover(false);
    setSettingsSidebarOpen(false);
    window.history.replaceState({ iglooPublicRoute: 'landing' }, '', '/');
  }, [
    dashboardRouteRecover,
    dashboardRouteTab,
    store.activeView,
    store.drafts.recoverKeyForm.returnView,
    store.drafts.recoverKeyForm.sourceProfileId,
    store.profiles,
    store.runtimeSnapshot?.active,
    store.unlockPassphrase,
  ]);

  React.useEffect(() => {
    const path = publicTaskRoutePathForStore(store);
    if (!path) return;
    if (publicRouteLandingOverrideRef.current) {
      publicRouteLandingOverrideRef.current = false;
      return;
    }
    if (normalizePathname(window.location.pathname) === path) return;
    setDashboardRouteTab(null);
    setDashboardRouteRecover(false);
    window.history.pushState({ iglooPublicRoute: store.activeView }, '', path);
  }, [
    store.activeView,
    store.drafts.createForm.mode,
    store.drafts.recoverKeyForm.returnView,
    store.pendingLoadErrorKind,
  ]);

  const copyDashboardKey = React.useCallback(
    (field: 'group', keyModel: DashboardKeyModel | undefined, format?: 'npub' | 'hex') => {
      if (!keyModel) return;
      const value = format === 'hex' ? keyModel.hex : keyModel.npub;
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value);
      }
      setDashboardCopiedField(field);
      window.setTimeout(() => setDashboardCopiedField(null), 2000);
    },
    [],
  );

  // Export package modal state (Phase B step 4): which format is open, the
  // re-encrypted result (entry → complete), and busy/error.
  const [exportModalFormat, setExportModalFormat] = React.useState<'bfprofile' | 'bfshare' | null>(null);
  const [exportResult, setExportResult] = React.useState<string | null>(null);
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const openExportModal = React.useCallback((format: 'bfprofile' | 'bfshare') => {
    setExportModalFormat(format);
    setExportResult(null);
    setExportError(null);
  }, []);
  const openDashboardExportModal = React.useCallback(
    (format: 'bfprofile' | 'bfshare') => {
      setSettingsSidebarOpen(false);
      syncDashboardRoute('signer');
      store.setDashboardTab('signer');
      openExportModal(format);
    },
    [openExportModal, store, syncDashboardRoute],
  );
  const closeExportModal = React.useCallback(() => {
    setExportModalFormat(null);
    setExportResult(null);
    setExportError(null);
  }, []);

  // Unsaved-changes guard for the Settings sidebar: closing the sidebar with
  // edited profile/relay/runtime fields asks before discarding the draft.
  const [pendingSettingsExit, setPendingSettingsExit] =
    React.useState<'signer' | 'permissions' | 'recover' | 'close' | null>(null);

  // DEV-only seam: lets the visual harness render the recover-success screen with a
  // FAKE nsec injected on the window. Stripped from production builds (guarded on
  // import.meta.env.DEV) and never touches persistence or the real reconstruction path.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const injected = window.__IGLOO_TEST_RECOVERED_KEY__;
    if (!injected) return;
    if (!recoveredKey) {
      setRecoveredKey(injected);
    }
    if (store.activeView !== 'recover-key') {
      store.setActiveView('recover-key');
    }
  }, [recoveredKey, store]);

  // DEV-only seam: lets the visual harness render replace-share transient states
  // that intentionally cannot survive reload because they carry passphrases.
  React.useEffect(() => {
    if (!import.meta.env.DEV || visualReplaceShareAppliedRef.current) return;
    const injected = window.__IGLOO_TEST_REPLACE_SHARE_STATE__ as ReplaceShareVisualState | undefined;
    if (!injected) return;
    visualReplaceShareAppliedRef.current = true;

    if (injected.state === 'success') {
      setVisualReplaceShareConnection(null);
      setReplaceShareError(null);
      setReplaceShareApplying(false);
      setReplaceShareResult(injected.result);
      store.setActiveView('rotate-complete');
      return;
    }

    setVisualReplaceShareConnection(injected.connection);
    setReplaceShareResult(null);
    setReplaceShareApplying(Boolean(injected.state === 'applying' && injected.applying));
    setReplaceShareError(injected.state === 'failed' ? injected.message : null);
    if (injected.unlockPassphrase) {
      store.setUnlockPassphrase(injected.unlockPassphrase);
    }
    store.setActiveView('rotate-save');
  }, [store]);

  // DEV-only seam: lets the visual harness render Import Save Profile without
  // persisting `pendingLoadConfirmation`, which carries passphrase material and
  // is intentionally cleared on reload.
  React.useEffect(() => {
    if (!import.meta.env.DEV || visualImportSaveAppliedRef.current) return;
    const injected = window.__IGLOO_TEST_IMPORT_SAVE_STATE__ as ImportSaveVisualState | undefined;
    if (!injected?.confirmation) return;
    visualImportSaveAppliedRef.current = true;
    setVisualImportSaveState(injected);
    store.setActiveView('load-confirm');
  }, [store]);

  // DEV-only seam: lets the visual harness render Onboard Save Profile without
  // persisting `pendingOnboardConnection`, which carries passphrase material and
  // is intentionally cleared on reload.
  React.useEffect(() => {
    if (!import.meta.env.DEV || visualOnboardSaveAppliedRef.current) return;
    const injected = window.__IGLOO_TEST_ONBOARD_SAVE_STATE__ as OnboardSaveVisualState | undefined;
    if (!injected?.connection) return;
    visualOnboardSaveAppliedRef.current = true;
    setVisualOnboardSaveState(injected);
    store.setActiveView('onboard-save');
  }, [store]);

  // DEV-only seam: lets the visual harness render the live permissions surface.
  // Runtime snapshots are in-memory only and are intentionally cleared on reload,
  // so screenshots that need an active signer must inject that projection.
  React.useEffect(() => {
    if (!import.meta.env.DEV || visualPermissionsAppliedRef.current) return;
    const injected = window.__IGLOO_TEST_PERMISSION_STATE__ as PermissionsVisualState | undefined;
    if (!injected) return;
    visualPermissionsAppliedRef.current = true;
    setVisualPermissionsState({
      runtimeSnapshot: injected.runtimeSnapshot ?? null,
      peerPermissionStates: Array.isArray(injected.peerPermissionStates)
        ? injected.peerPermissionStates
        : undefined,
    });
    store.setDashboardTab(injected.activeDashboardTab ?? 'signer');
  }, [store]);

  // DEV-only seam: lets the visual harness render Settings Onboard Device
  // handoff results without persisting the passphrase-bearing package producer
  // state that would normally exist only during the active dialog session.
  React.useEffect(() => {
    if (!import.meta.env.DEV || visualSettingsOnboardAppliedRef.current) return;
    const injected = window.__IGLOO_TEST_SETTINGS_ONBOARD_STATE__ as SettingsOnboardVisualState | undefined;
    if (!injected?.result) return;
    visualSettingsOnboardAppliedRef.current = true;
    setSettingsOnboardDraft(buildSettingsOnboardDraft(null));
    setSettingsOnboardResult(injected.result);
    setSettingsOnboardError(null);
    setSettingsOnboardErrorFields([]);
    setSettingsOnboardBusy(false);
    setSettingsOnboardQrOpen(false);
    setSettingsOnboardHandoffStatus(injected.handoffStatus ?? null);
    setSettingsOnboardHandoffTone(injected.handoffStatusTone ?? 'success');
    setSettingsOnboardHandoffAction(null);
    setSettingsSidebarOpen(true);
    setSettingsOnboardOpen(true);
    store.setDashboardTab('settings');
  }, [store]);

  const selectedProfile = store.profiles.find((profile) => profile.id === store.selectedProfileId) ?? null;
  const recoverReturnTarget = resolveRecoverReturnTarget(store);
  const welcomeUnlockSourceProfile =
    store.profiles.find((entry) => entry.id === welcomeUnlockProfileId) ?? null;
  const dashboardLoadingProfile = React.useMemo(() => {
    if (!welcomeUnlockSubmitting || !welcomeUnlockSourceProfile) return null;
    const profile = deriveWelcomeReturningProfile(welcomeUnlockSourceProfile);
    return {
      profileName: profile.label,
      thresholdLabel: profile.thresholdLabel,
      publicKeyLabel: profile.publicKeyLabel,
      memberLabel: `Share ${profile.memberLabel}`,
    };
  }, [welcomeUnlockSourceProfile, welcomeUnlockSubmitting]);
  const dashboardHeaderActive =
    Boolean(dashboardLoadingProfile) ||
    store.activeView === 'dashboard' || (isRecoverView(store.activeView) && recoverReturnTarget === 'dashboard');
  const signingFailureRuntimeSnapshot = visualPermissionsState?.runtimeSnapshot ?? store.runtimeSnapshot;
  const signingFailure = React.useMemo(
    () => deriveDashboardSigningFailure(signingFailureRuntimeSnapshot, dismissedSigningFailureIds),
    [dismissedSigningFailureIds, signingFailureRuntimeSnapshot],
  );
  const runExport = React.useCallback(
    (exportPassword: string) => {
      if (!selectedProfile || !exportModalFormat) return;
      setExportBusy(true);
      setExportError(null);
      void store
        .exportEncryptedPackage(selectedProfile.id, exportModalFormat, exportPassword)
        .then((value) => setExportResult(value))
        .catch((error: unknown) => setExportError(formatUiError(error, EXPORT_PACKAGE_FAILURE_MESSAGE)))
        .finally(() => setExportBusy(false));
    },
    [selectedProfile, exportModalFormat, store],
  );

  const settingsOnboardSignerPubkey =
    store.runtimeSnapshot?.active && store.runtimeSnapshot.runtime_host?.signer_pubkey
      ? store.runtimeSnapshot.runtime_host.signer_pubkey
      : null;
  const settingsOnboardCancelRequiresConfirmation = hasSettingsOnboardDraftWork(
    settingsOnboardDraft,
    selectedProfile,
  );

  const openSettingsOnboardDialog = React.useCallback(() => {
    setSettingsOnboardDraft(buildSettingsOnboardDraft(selectedProfile));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardErrorFields([]);
    setSettingsOnboardQrOpen(false);
    setSettingsOnboardHandoffStatus(null);
    setSettingsOnboardHandoffTone('success');
    setSettingsOnboardHandoffAction(null);
    setSettingsOnboardOpen(true);
  }, [selectedProfile]);

  const closeSettingsOnboardDialog = React.useCallback(() => {
    setSettingsOnboardOpen(false);
    setSettingsOnboardDraft(buildSettingsOnboardDraft(null));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardErrorFields([]);
    setSettingsOnboardBusy(false);
    setSettingsOnboardQrOpen(false);
    setSettingsOnboardHandoffStatus(null);
    setSettingsOnboardHandoffTone('success');
    setSettingsOnboardHandoffAction(null);
  }, []);

  const createAnotherSettingsOnboardPackage = React.useCallback(() => {
    setSettingsOnboardDraft(buildSettingsOnboardDraft(selectedProfile));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardErrorFields([]);
    setSettingsOnboardQrOpen(false);
    setSettingsOnboardHandoffStatus(null);
    setSettingsOnboardHandoffTone('success');
    setSettingsOnboardHandoffAction(null);
  }, [selectedProfile]);

  const submitSettingsOnboardPackage = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProfile) {
        setSettingsOnboardError('Select a profile before creating an onboarding package.');
        setSettingsOnboardErrorFields([]);
        return;
      }
      if (!settingsOnboardSignerPubkey) {
        setSettingsOnboardError('Start the signer before creating an onboarding package.');
        setSettingsOnboardErrorFields([]);
        return;
      }
      if (settingsOnboardDraft.packagePassword !== settingsOnboardDraft.confirmPackagePassword) {
        setSettingsOnboardError('Package passwords do not match.');
        setSettingsOnboardErrorFields([]);
        return;
      }

      setSettingsOnboardBusy(true);
      setSettingsOnboardError(null);
      setSettingsOnboardErrorFields([]);
      setSettingsOnboardHandoffStatus(null);
      setSettingsOnboardHandoffTone('success');
      setSettingsOnboardHandoffAction(null);
      try {
        const result = await createSettingsOnboardingPackageFromBfshare({
          profile: selectedProfile,
          label: settingsOnboardDraft.label,
          sourcePackageText: settingsOnboardDraft.sourcePackageText,
          sourcePackagePassword: settingsOnboardDraft.sourcePackagePassword,
          password: settingsOnboardDraft.packagePassword,
          signerPubkey: settingsOnboardSignerPubkey,
        });
        setSettingsOnboardResult({
          label: result.preview.label,
          memberLabel: `Share #${result.preview.member_idx}`,
          packageText: result.package_text,
          sharePublicKey: result.preview.share_public_key,
          sharePublicKeyLabel: toDashboardKey(result.preview.share_public_key)?.display,
        });
        setSettingsOnboardDraft((current) => ({
          ...current,
          sourcePackageText: '',
          sourcePackagePassword: '',
          packagePassword: '',
          confirmPackagePassword: '',
        }));
      } catch (error) {
        setSettingsOnboardError(formatUiError(error, "We couldn't create this onboarding package. Check the inputs and try again."));
        setSettingsOnboardErrorFields(['sourcePackageText', 'sourcePackagePassword']);
        setSettingsOnboardHandoffStatus(null);
        setSettingsOnboardHandoffTone('success');
        setSettingsOnboardHandoffAction(null);
      } finally {
        setSettingsOnboardBusy(false);
      }
    },
    [selectedProfile, settingsOnboardDraft, settingsOnboardSignerPubkey],
  );

  const copySettingsOnboardPackage = React.useCallback(() => {
    if (!settingsOnboardResult?.packageText) return;
    if (navigator.clipboard?.writeText) {
      setSettingsOnboardHandoffAction('copy');
      setSettingsOnboardHandoffTone('info');
      setSettingsOnboardHandoffStatus('Copying package...');
      void navigator.clipboard
        .writeText(settingsOnboardResult.packageText)
        .then(() => {
          setSettingsOnboardHandoffTone('success');
          setSettingsOnboardHandoffStatus('Package copied.');
        })
        .catch(() => {
          setSettingsOnboardHandoffTone('warning');
          setSettingsOnboardHandoffStatus('Copy failed. Copy the package manually.');
        })
        .finally(() => setSettingsOnboardHandoffAction(null));
      return;
    }
    setSettingsOnboardHandoffAction(null);
    setSettingsOnboardHandoffTone('warning');
    setSettingsOnboardHandoffStatus('Clipboard unavailable. Copy the package manually.');
  }, [settingsOnboardResult]);

  const saveSettingsOnboardPackage = React.useCallback(() => {
    if (!settingsOnboardResult?.packageText) return;
    const filename = buildProfileDownloadFilename(
      settingsOnboardResult.label,
      settingsOnboardResult.sharePublicKey ?? selectedProfile?.id ?? 'bfonboard',
      'bfonboard.txt',
    );
    setSettingsOnboardHandoffAction('save');
    setSettingsOnboardHandoffTone('info');
    setSettingsOnboardHandoffStatus('Saving package...');
    void saveTextToFile(filename, settingsOnboardResult.packageText)
      .then((saved) => {
        setSettingsOnboardHandoffTone(saved ? 'success' : 'warning');
        setSettingsOnboardHandoffStatus(saved ? 'Package saved.' : 'Save canceled.');
      })
      .catch(() => {
        setSettingsOnboardHandoffTone('warning');
        setSettingsOnboardHandoffStatus('Save failed. Try again.');
      })
      .finally(() => setSettingsOnboardHandoffAction(null));
  }, [selectedProfile?.id, settingsOnboardResult]);

  const welcomeUnlockProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    return welcomeUnlockSourceProfile ? deriveWelcomeReturningProfile(welcomeUnlockSourceProfile) : null;
  }, [welcomeUnlockSourceProfile]);
  const welcomeDeleteProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeDeleteProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeDeleteProfileId]);

  React.useEffect(() => {
    const currentId = getInstanceId();
    if (pruneUnavailableInstances({ keepId: currentId })) {
      setResumeDeviceRevision((revision) => revision + 1);
    }
  }, []);

  // Other stored device partitions (from earlier browser sessions / closed
  // tabs) that hold profiles, excluding this tab's own instance. The revision
  // bumps when this tab prunes or forgets a resumable device.
  const resumeDevices = React.useMemo<WelcomeResumableDeviceModel[]>(() => {
    const currentId = getInstanceId();
    return readInstanceRegistry()
      .filter(
        (record) =>
          record.id !== currentId &&
          record.profileCount > 0 &&
          instancePartitionHasProfiles(record.id),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => ({
        id: record.id,
        label: record.label ?? `Device ${record.id.slice(0, 8)}`,
        metaLabel: `${record.profileCount} profile${record.profileCount === 1 ? '' : 's'}`,
      }));
  }, [resumeDeviceRevision]);

  // Adopt the selected partition's instance id into this tab, then reload so the
  // store re-hydrates from it. Force the URL back to the index first so stale
  // public task routes do not reopen import/recover flows in the resumed device.
  const resumeDevice = React.useCallback((deviceId: string) => {
    if (!instancePartitionHasProfiles(deviceId)) {
      setUiError('That saved device is no longer available. Refresh to update the resume list.');
      return;
    }
    adoptInstanceId(deviceId);
    window.history.replaceState({ iglooPublicRoute: 'landing' }, '', '/');
    window.location.reload();
  }, []);

  const forgetResumeDevice = React.useCallback((deviceId: string) => {
    forgetInstance(deviceId);
    setUiError(null);
    setResumeDeviceRevision((revision) => revision + 1);
  }, []);
  const selectedProfileId = selectedProfile?.id ?? null;
  const [operatorSettingsDraft, setOperatorSettingsDraft] = React.useState<OperatorSettingsDraft>(() =>
    buildOperatorSettingsDraft(selectedProfile),
  );

  React.useEffect(() => {
    setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
  }, [selectedProfileId]);

  React.useEffect(() => {
    if (!settingsSidebarOpen) return;
    setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
  }, [selectedProfileId, settingsSidebarOpen]);

  // The Settings form is dirty when the draft diverges from the saved profile
  // (transient newRelayUrl is ignored).
  const settingsDirty = React.useMemo(() => {
    const saved = buildOperatorSettingsDraft(selectedProfile);
    return !areOperatorSettingsEqual(operatorSettingsDraft, saved);
  }, [operatorSettingsDraft, selectedProfile]);
  const clearCredentialsSummary = React.useMemo(() => {
    if (!selectedProfile) return 'No profile selected';
    const groupSummary = deriveGroupSummary(selectedProfile.group_package_json);
    return [
      groupSummary.keysetName ?? selectedProfile.label,
      Number.isFinite(selectedProfile.member_idx) ? `Share #${selectedProfile.member_idx}` : null,
      selectedProfile.label,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [selectedProfile]);

  React.useEffect(() => {
    if (store.activeView !== 'dashboard') {
      setSettingsSidebarOpen(false);
      return;
    }
    if (store.activeDashboardTab === 'settings') {
      setSettingsSidebarOpen(true);
    }
  }, [store.activeDashboardTab, store.activeView]);

  // Dashboard header actions follow Paper AuthActions: brand returns home,
  // Recover starts key recovery, Permissions opens the permissions panel, and the
  // gear opens Settings as a right-side sidebar.
  const requestDashboardTab = React.useCallback(
    (tab: 'signer' | 'permissions' | 'settings') => {
      if (tab === 'settings') {
        syncDashboardRoute('settings');
        setSettingsSidebarOpen(true);
        store.setDashboardTab('settings');
        return;
      }
      if (settingsSidebarOpen && settingsDirty) {
        setPendingSettingsExit(tab);
        return;
      }
      syncDashboardRoute(tab);
      setSettingsSidebarOpen(false);
      store.setDashboardTab(tab);
    },
    [store, settingsDirty, settingsSidebarOpen, syncDashboardRoute],
  );

  const requestDashboardRecover = React.useCallback(() => {
    if (!selectedProfile) return;
    if (settingsSidebarOpen && settingsDirty) {
      setPendingSettingsExit('recover');
      return;
    }
    setSettingsSidebarOpen(false);
    setRecoveredKey(null);
    setRecoverCollectError(null);
    syncDashboardRecoverRoute();
    store.startRecoverKey(selectedProfile.id, 'dashboard');
  }, [selectedProfile, settingsDirty, settingsSidebarOpen, store, syncDashboardRecoverRoute]);

  const requestSettingsSidebarClose = React.useCallback(() => {
    if (settingsDirty) {
      setPendingSettingsExit('close');
      return;
    }
    setSettingsSidebarOpen(false);
    if (store.activeDashboardTab === 'settings') {
      syncDashboardRoute('signer');
      store.setDashboardTab('signer');
    }
  }, [settingsDirty, store, syncDashboardRoute]);

  const discardSettingsSidebarChanges = React.useCallback(() => {
    setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
    setSettingsSidebarOpen(false);
    const target = pendingSettingsExit;
    setPendingSettingsExit(null);
    if (target === 'recover') {
      if (selectedProfile) {
        setRecoveredKey(null);
        setRecoverCollectError(null);
        syncDashboardRecoverRoute();
        store.startRecoverKey(selectedProfile.id, 'dashboard');
      } else {
        store.setDashboardTab('signer');
      }
      return;
    }
    const nextTab = target && target !== 'close' ? target : 'signer';
    syncDashboardRoute(nextTab);
    store.setDashboardTab(nextTab);
  }, [pendingSettingsExit, selectedProfile, store, syncDashboardRecoverRoute, syncDashboardRoute]);

  const closeSettingsDiscardDialog = React.useCallback(() => {
    setPendingSettingsExit(null);
    if (store.activeView === 'dashboard' && store.activeDashboardTab === 'settings') {
      syncDashboardRoute('settings');
    }
  }, [store.activeDashboardTab, store.activeView, syncDashboardRoute]);

  React.useEffect(() => {
    const dashboardRouteWasHydrated = dashboardRouteHydratedRef.current;
    const dashboardRouteChangedByPopState = dashboardRoutePopStateRef.current;
    dashboardRoutePopStateRef.current = false;
    dashboardRouteHydratedRef.current = true;

    if (dashboardRouteRecover) {
      if (store.activeView === 'dashboard') {
        requestDashboardRecover();
      }
      return;
    }

    if (isRecoverView(store.activeView) && recoverReturnTarget === 'dashboard') {
      const normalizedPath = normalizePathname(window.location.pathname);
      const isInitialRecoverHydration = !dashboardRouteWasHydrated;
      if (
        dashboardRouteTab &&
        !isInitialRecoverHydration &&
        (dashboardRouteChangedByPopState || normalizedPath !== dashboardRoutePath('signer'))
      ) {
        setRecoveredKey(null);
        requestDashboardTab(dashboardRouteTab);
        return;
      }
      if (!dashboardRouteRecover) {
        syncDashboardRecoverRoute('replace');
      }
      return;
    }

    if (store.activeView !== 'dashboard') return;
    if (!dashboardRouteTab) {
      syncDashboardRoute(store.activeDashboardTab, 'replace');
      return;
    }
    if (
      dashboardRouteTab !== store.activeDashboardTab ||
      (dashboardRouteTab === 'settings' && !settingsSidebarOpen)
    ) {
      requestDashboardTab(dashboardRouteTab);
    }
  }, [
    dashboardRouteTab,
    dashboardRouteRecover,
    recoverReturnTarget,
    requestDashboardRecover,
    requestDashboardTab,
    settingsSidebarOpen,
    store.activeDashboardTab,
    store.activeView,
    syncDashboardRecoverRoute,
    syncDashboardRoute,
  ]);

  const closeSettingsPasswordDialog = React.useCallback(() => {
    if (settingsPasswordBusy) return;
    setSettingsPasswordOpen(false);
    setSettingsPasswordCurrent('');
    setSettingsPasswordNext('');
    setSettingsPasswordConfirm('');
    setSettingsPasswordError(null);
  }, [settingsPasswordBusy]);

  const submitSettingsPasswordChange = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProfile) return;
      if (!settingsPasswordCurrent.trim()) {
        setSettingsPasswordError('Current password is required.');
        return;
      }
      if (!settingsPasswordNext.trim()) {
        setSettingsPasswordError('New password is required.');
        return;
      }
      if (settingsPasswordNext !== settingsPasswordConfirm) {
        setSettingsPasswordError('New password confirmation does not match.');
        return;
      }

      try {
        setSettingsPasswordBusy(true);
        setSettingsPasswordError(null);
        await store.changeProfilePassword(
          selectedProfile.id,
          settingsPasswordCurrent,
          settingsPasswordNext,
        );
        setSettingsPasswordOpen(false);
        setSettingsPasswordCurrent('');
        setSettingsPasswordNext('');
        setSettingsPasswordConfirm('');
      } catch {
        setSettingsPasswordError('Current password is incorrect.');
      } finally {
        setSettingsPasswordBusy(false);
      }
    },
    [
      selectedProfile,
      settingsPasswordConfirm,
      settingsPasswordCurrent,
      settingsPasswordNext,
      store,
    ],
  );

  const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (action: () => Promise<void> | void, actionId?: string) => {
      try {
        setUiError(null);
        if (actionId) setPendingActionId(actionId);
        await action();
      } catch (error) {
        setUiError(formatUiError(error));
      } finally {
        if (actionId) {
          setPendingActionId((current) => (current === actionId ? null : current));
        }
      }
    },
    [],
  );

  const actionBusy = React.useCallback(
    (actionId: string) => pendingActionId === actionId,
    [pendingActionId],
  );

  const runRecoverCollect = React.useCallback(async () => {
    try {
      setUiError(null);
      setRecoverCollectError(null);
      setPendingActionId('recover.collect');
      const recovered = await store.recoverKeyFromShares();
      setRecoveredKey(recovered);
    } catch {
      setRecoverCollectError(RECOVER_COLLECT_FAILURE_MESSAGE);
    } finally {
      setPendingActionId((current) => (current === 'recover.collect' ? null : current));
    }
  }, [store]);

  const dismissSigningFailure = React.useCallback((id?: string) => {
    if (!id) return;
    setDismissedSigningFailureIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }, []);

  const distributionBusyAction = React.useMemo(() => {
    const parts = pendingActionId?.split('.');
    if (!parts || parts[0] !== 'distribution' || parts.length !== 3) return null;
    const memberIdx = Number.parseInt(parts[1], 10);
    const kind = parts[2];
    if (!Number.isFinite(memberIdx) || !isDistributionAction(kind)) return null;
    return { memberIdx, kind };
  }, [pendingActionId]);

  const applyReplaceShareConnection = React.useCallback(async () => {
    if (!selectedProfile) return;
    setReplaceShareApplying(true);
    setReplaceShareError(null);
    try {
      const previousProfile = selectedProfile;
      const updatedProfile = await store.finalizeRotationUpdate();
      setReplaceShareResult({
        groupKeyLabel: formatReplacementKeyLabel(updatedProfile.group_public_key),
        oldShareKeyLabel: formatReplacementKeyLabel(previousProfile.share_public_key),
        newShareKeyLabel: formatReplacementKeyLabel(updatedProfile.share_public_key),
      });
      store.setActiveView('rotate-complete');
    } catch (error) {
      setReplaceShareError(formatUiError(error, "We couldn't replace this share. Check the package and password, then try again."));
    } finally {
      setReplaceShareApplying(false);
    }
  }, [selectedProfile, store]);

  React.useEffect(() => {
    const connection = store.pendingRotationConnection;
    if (
      store.activeView !== 'rotate-save' ||
      !connection ||
      visualReplaceShareConnection ||
      replaceShareError ||
      replaceShareResult
    ) {
      return;
    }

    const autoApplyKey = `${store.selectedProfileId}:${connection.package_text}`;
    if (autoApplyReplaceShareKeyRef.current === autoApplyKey) return;
    autoApplyReplaceShareKeyRef.current = autoApplyKey;
    void applyReplaceShareConnection();
  }, [
    applyReplaceShareConnection,
    replaceShareError,
    replaceShareResult,
    store.activeView,
    store.pendingRotationConnection,
    store.selectedProfileId,
    visualReplaceShareConnection,
  ]);

  const openReplaceShareFlow = React.useCallback(() => {
    autoApplyReplaceShareKeyRef.current = null;
    setVisualReplaceShareConnection(null);
    setReplaceShareApplying(false);
    setReplaceShareError(null);
    setReplaceShareResult(null);
    setSettingsOnboardOpen(false);
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardQrOpen(false);
    setSettingsSidebarOpen(false);
    void run(() => {
      store.startRotateKey(selectedProfile?.id);
    });
  }, [run, selectedProfile?.id, store]);

  const applyRotationSourceProfile = React.useCallback(
    (profileId: string) => {
      const profile = store.profiles.find((entry) => entry.id === profileId) ?? null;
      const summary = profile ? deriveGroupSummary(profile.group_package_json) : {};
      localSourceUnlockRequestRef.current += 1;
      setLocalSourceUnlockError(null);
      store.updateRotationForm('sourceProfileId', profileId);
      if (summary.keysetName) store.updateCreateForm('groupName', summary.keysetName);
      if (typeof summary.threshold === 'number') store.updateCreateForm('threshold', String(summary.threshold));
      if (typeof summary.memberCount === 'number') store.updateCreateForm('count', String(summary.memberCount));
    },
    [store],
  );

	  const openCreateRotationFlow = React.useCallback(
	    (profileId: string) => {
	      setCreatePrivateKeyError(null);
	      store.selectProfile(profileId);
	      store.updateCreateForm('mode', 'rotate');
	      applyRotationSourceProfile(profileId);
      store.setActiveView('create-generate');
      setDashboardRouteTab(null);
      setDashboardRouteRecover(false);
      window.history.replaceState({ iglooPublicRoute: 'rotate' }, '', ROTATE_PATH);
    },
    [applyRotationSourceProfile, store],
  );

	  const openCreateNewFlow = React.useCallback(() => {
	    setCreatePrivateKeyError(null);
	    store.startCreateKeyset();
	  }, [store]);

	  const goToLanding = React.useCallback(() => {
	    setUiError(null);
	    setRecoveredKey(null);
	    setRecoverCollectError(null);
	    setCreatePrivateKeyError(null);
	    syncLandingRoute();
	    store.cancelOnboarding();
	  }, [store, syncLandingRoute]);

  const goToDashboard = React.useCallback(() => {
    setUiError(null);
    setRecoverCollectError(null);
    syncDashboardRoute('signer');
    store.setActiveView('dashboard');
  }, [store, syncDashboardRoute]);

  const goToDashboardSettings = React.useCallback(() => {
    setUiError(null);
    setRecoverCollectError(null);
    setReplaceShareApplying(false);
    setReplaceShareError(null);
    setReplaceShareResult(null);
    syncDashboardRoute('settings');
    store.setDashboardTab('settings');
    store.setActiveView('dashboard');
    setSettingsSidebarOpen(true);
  }, [store, syncDashboardRoute]);

  const goToRecoverReturnTarget = React.useCallback(() => {
    setUiError(null);
    setRecoveredKey(null);
    setRecoverCollectError(null);
    if (recoverReturnTarget === 'dashboard') {
      syncDashboardRoute('signer');
      store.setDashboardTab('signer');
      store.setActiveView('dashboard');
      return;
    }
    syncLandingRoute();
    store.setActiveView('landing');
  }, [recoverReturnTarget, store, syncDashboardRoute, syncLandingRoute]);

  const closeWelcomeUnlock = React.useCallback(() => {
    setWelcomeUnlockProfileId(null);
    setWelcomeUnlockPassword('');
    setWelcomeUnlockError(null);
    setWelcomeUnlockSubmitting(false);
  }, []);

  const openWelcomeUnlock = React.useCallback((profileId: string) => {
    setWelcomeUnlockProfileId(profileId);
    setWelcomeUnlockPassword('');
    setWelcomeUnlockError(null);
    setWelcomeUnlockSubmitting(false);
  }, []);

  const openWelcomeDelete = React.useCallback((profileId: string) => {
    setWelcomeDeleteProfileId(profileId);
  }, []);

  const closeWelcomeDelete = React.useCallback(() => {
    setWelcomeDeleteProfileId(null);
  }, []);

  const confirmWelcomeDelete = React.useCallback(() => {
    if (!welcomeDeleteProfileId) return;
    store.deleteProfile(welcomeDeleteProfileId);
    setWelcomeDeleteProfileId(null);
  }, [store, welcomeDeleteProfileId]);

  const submitWelcomeUnlock = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!welcomeUnlockProfileId) return;

      try {
        setWelcomeUnlockSubmitting(true);
        setWelcomeUnlockError(null);
        await store.loadStoredProfile(welcomeUnlockProfileId, welcomeUnlockPassword);
        closeWelcomeUnlock();
      } catch (error) {
        if (isIncorrectPassphraseError(error)) {
          setWelcomeUnlockError('Incorrect password. Please try again.');
          return;
        }
        store.reportProfileLoadError(formatUiError(error, "We couldn't load this saved profile. Check the password and try again."));
        closeWelcomeUnlock();
      } finally {
        setWelcomeUnlockSubmitting(false);
      }
    },
    [closeWelcomeUnlock, store, welcomeUnlockPassword, welcomeUnlockProfileId],
  );

  function renderError() {
    if (!uiError) return null;
    return <Alert tone="danger">{uiError}</Alert>;
  }

  function renderRuntimeWarning() {
    if (!store.runtimeWarning) return null;
    return <Alert tone="warning">{store.runtimeWarning}</Alert>;
  }

  // Each browser tab is its own isolated signer instance (its state is
  // partitioned per tab). A browser restart clears the tab's instance id, so a
  // fresh tab surfaces any other stored devices here for one-click resume,
  // rather than orphaning their profiles. The cards render inside the centered
  // welcome hero so they share the Paper device-card treatment and layout.
  function renderLanding() {
    if (store.profiles.length === 0) {
      return (
        <WelcomeEntryHero
          logoSrc="/igloo-paper-mark.png"
          onNewKeyset={openCreateNewFlow}
          onImportProfile={() => store.startLoadImport()}
          onOnboard={() => store.setActiveView('onboard-connect')}
          resumeDevices={resumeDevices}
          onResumeDevice={resumeDevice}
          onForgetDevice={forgetResumeDevice}
        />
      );
    }

    return (
      <WelcomeReturningHero
        logoSrc="/igloo-paper-mark.png"
        layout={deriveWelcomeReturningLayout(store.profiles.length)}
        profiles={store.profiles.map(deriveWelcomeReturningProfile)}
        onUnlock={openWelcomeUnlock}
        onRotate={openCreateRotationFlow}
        onRecover={(profileId) => {
          setRecoveredKey(null);
          setRecoverCollectError(null);
          store.startRecoverKey(profileId, 'landing');
        }}
        onDelete={openWelcomeDelete}
        onNewKeyset={openCreateNewFlow}
        onImportProfile={() => store.startLoadImport()}
        onOnboard={() => store.setActiveView('onboard-connect')}
        resumeDevices={resumeDevices}
        onResumeDevice={resumeDevice}
        onForgetDevice={forgetResumeDevice}
      />
    );
  }

  function renderCreateGenerate() {
    const isRotateMode = store.drafts.createForm.mode === 'rotate';
    const rotationSourceProfile =
      isRotateMode
        ? store.profiles.find((profile) => profile.id === store.drafts.rotationForm.sourceProfileId) ?? null
        : null;
    const validatedRotationSharePackageJson =
      rotationSourceProfile ? store.sharePackageJsonByProfileId[rotationSourceProfile.id]?.trim() : '';
    const unlockedRotationSourceProfile =
      rotationSourceProfile?.id === store.selectedProfileId && validatedRotationSharePackageJson
        ? rotationSourceProfile
        : null;
    const rotationGroupSummary = rotationSourceProfile ? deriveGroupSummary(rotationSourceProfile.group_package_json) : {};
    const rotationThreshold = readNumber(
      rotationGroupSummary.threshold,
      readNumber(store.drafts.createForm.threshold, 2),
    );
    const isLocalRotationSourcePackage = (packageText: string) => {
      const trimmed = packageText.trim();
      if (!rotationSourceProfile || !trimmed) return false;
      return [
        rotationSourceProfile.encrypted_bfshare_artifact,
        rotationSourceProfile.share_string,
        rotationSourceProfile.profile_string,
      ].some((candidate) => typeof candidate === 'string' && candidate.trim() === trimmed);
    };
    const rotationCollectedCount =
      (unlockedRotationSourceProfile ? 1 : 0) +
      store.drafts.rotationForm.sources.reduce((count, source, index) => {
        const sourcePassword = store.draftSecrets.rotationSources[index] ?? '';
        return source.packageText.trim() &&
          sourcePassword.trim() &&
          !isLocalRotationSourcePackage(source.packageText)
          ? count + 1
          : count;
      }, 0);

    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={isRotateMode ? ROTATE_FLOW_STEPS : CREATE_FLOW_STEPS} active={0} />
          {isRotateMode ? <PageBackLink label="Back to Welcome" onBack={goToLanding} /> : null}
          <PublicTaskTitle
            title={isRotateMode ? 'Collect Shares' : 'Create New Keyset'}
            description={
              isRotateMode
                ? "Collect enough existing source packages to rotate this keyset. Once the threshold is met, the next steps match the Create Keyset flow: select this device's share, save the profile, then distribute remote shares."
                : 'Define the group profile for a new keyset. After generation, choose which share stays on this device, then distribute the rest.'
            }
          />
          {!isRotateMode ? (
	            <CreateFlowGenerateCard
	              groupName={store.drafts.createForm.groupName}
	              threshold={store.drafts.createForm.threshold}
	              count={store.drafts.createForm.count}
	              privateKey={store.draftSecrets.createFormPrivateKey}
	              privateKeyError={createPrivateKeyError}
	              onChangeForm={(field, value) => {
	                if (field === 'privateKey') {
	                  setCreatePrivateKeyError(createPrivateKeyError ? validateCreatePrivateKey(value) : null);
	                }
	                store.updateCreateForm(field, value);
	              }}
	              actionBusy={actionBusy('create.generate')}
	              onGenerate={() => {
	                const privateKeyError = validateCreatePrivateKey(store.draftSecrets.createFormPrivateKey);
	                setCreatePrivateKeyError(privateKeyError);
	                if (privateKeyError) {
	                  setUiError(null);
	                  return;
	                }
	                void run(() => store.generateKeyset(), 'create.generate');
	              }}
	              onBack={goToLanding}
	            />
          ) : null}
          {isRotateMode ? (
            <RotateKeysetPanel
              sourceProfileId={store.drafts.rotationForm.sourceProfileId}
              availableProfiles={store.profiles.map((profile) => ({
                id: profile.id,
                label: `${profile.label || 'Unnamed device'} (${shortProfileId(profile.id)})`,
              }))}
              localSourceLabel={
                rotationSourceProfile
                  ? `This Device Share (#${rotationSourceProfile.member_idx})`
                  : undefined
              }
              localSourceState={unlockedRotationSourceProfile ? 'validated' : 'locked'}
              localPassphrase={store.unlockPassphrase}
              threshold={rotationThreshold}
              collectedCount={rotationCollectedCount}
              rotationSources={store.drafts.rotationForm.sources.map((source, index) => ({
                packageText: source.packageText,
                packagePassword: store.draftSecrets.rotationSources[index] ?? '',
                duplicateOfLocal: isLocalRotationSourcePackage(source.packageText),
              }))}
              onChangeSourceProfile={applyRotationSourceProfile}
              onLocalPassphraseChange={(value) => {
                localSourceUnlockRequestRef.current += 1;
                setLocalSourceUnlockError(null);
                store.setUnlockPassphrase(value);
              }}
              onSubmitLocalPassphrase={() => {
                const profileId = rotationSourceProfile?.id;
                const passphrase = store.unlockPassphrase;
                if (!profileId || !passphrase.trim()) return;
                const requestId = localSourceUnlockRequestRef.current + 1;
                localSourceUnlockRequestRef.current = requestId;
                setUiError(null);
                setLocalSourceUnlockError(null);
                setPendingActionId('rotate.local-source');
                void store
                  .unlockLocalSourceShare(profileId, passphrase)
                  .catch((error) => {
                    if (localSourceUnlockRequestRef.current !== requestId) return;
                    setLocalSourceUnlockError(formatUiError(error) || 'Profile passphrase could not unlock this share.');
                  })
                  .finally(() => {
                    if (localSourceUnlockRequestRef.current !== requestId) return;
                    setPendingActionId((current) => (current === 'rotate.local-source' ? null : current));
                  });
              }}
              localPassphraseActionBusy={actionBusy('rotate.local-source')}
              localPassphraseError={localSourceUnlockError}
              onChangeRotationSource={(index, field, value) =>
                store.updateRotationSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
              }
              onAddRotationSource={() => store.addRotationSource()}
              onRemoveRotationSource={(index) => store.removeRotationSource(index)}
              actionBusy={actionBusy('create.rotate')}
              actionLabel="Next Step"
              onRotate={() => void run(() => store.generateKeyset(), 'create.rotate')}
            />
          ) : null}
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateSelectShare() {
    if (!store.pendingKeyset) return null;
    const groupKey = toDashboardKey(store.pendingKeyset.group_public_key);
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={store.drafts.createForm.mode === 'rotate' ? ROTATE_FLOW_STEPS : CREATE_FLOW_STEPS} active={1} />
          <PublicTaskTitle
            title="Select Share"
            description="Choose which share stays on this device. The group public key identifies the shared signer for every device."
          />
          <CreateFlowShareSelection
            shares={store.pendingKeyset.shares}
            selectedMemberIdx={store.selectedGeneratedShareIdx}
            keysetName={store.pendingKeyset.group_name}
            groupPublicKey={store.pendingKeyset.group_public_key}
            groupPublicKeyNpub={groupKey?.npub}
            groupPublicKeyHex={groupKey?.hex ?? store.pendingKeyset.group_public_key}
            onSelectShare={(memberIdx) => store.selectGeneratedShare(memberIdx)}
            actionBusy={actionBusy('create.select-share')}
            onAction={() => void run(() => store.continueToSaveProfile(), 'create.select-share')}
            onBack={() => store.setActiveView('create-generate')}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateSaveProfile() {
    if (!store.pendingKeyset) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={store.drafts.createForm.mode === 'rotate' ? ROTATE_FLOW_STEPS : CREATE_FLOW_STEPS} active={2} />
          <PublicTaskTitle
            title="Save Profile"
            description="Name and protect the local profile before remote shares are packaged for distribution."
          />
          <CreateFlowProfileSetup
            draft={{
              label: store.drafts.profileForm.label,
              relayUrls: store.drafts.profileForm.relayUrls,
              primarySecret: store.draftSecrets.profileFormPassword,
              secondarySecret: store.draftSecrets.profileFormConfirm,
            }}
            actionLabel="Next Step"
            onLabelChange={(value) => store.updateProfileForm('label', value)}
            onPrimarySecretChange={(value) => store.updateProfileFormPassword('password', value)}
            onSecondarySecretChange={(value) => store.updateProfileFormPassword('confirmPassword', value)}
            onRelaysChange={(relays) => store.updateProfileForm('relayUrls', relays.join('\n'))}
            onPingRelay={(url) => pingRelay(url)}
            normalizeRelays={normalizeRelays}
            actionBusy={actionBusy('create.save-profile')}
            onAction={() => void run(() => store.acceptGeneratedProfile(), 'create.save-profile')}
            onBack={() => store.setActiveView('create-select-share')}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateDistribute() {
    if (!store.pendingKeyset || !store.distributionSession || !selectedProfile) return null;
    const session = store.distributionSession;
    const remainingShares = store.pendingKeyset.shares.filter((share) =>
      session.remaining_member_indices.includes(share.member_idx),
    );
    const distributionResults = Object.fromEntries(
      Object.entries(session.results).map(([memberIdx, result]) => [
        Number(memberIdx),
        {
          status: result.status,
          label: result.label,
          packageText: result.package_text,
        },
      ]),
    ) as Record<number, SharedDistributionResult>;

    const handleFinishSetup = () => {
      const undelivered = session.remaining_member_indices.filter((idx) => {
        const status = session.results[idx]?.status ?? 'draft';
        return status === 'draft' || status === 'packaged';
      });
      if (undelivered.length > 0) {
        const confirmed = window.confirm(
          `${undelivered.length} ${undelivered.length === 1 ? 'share is' : 'shares are'} not yet delivered. Finish setup anyway?`,
        );
        if (!confirmed) return;
      }
      void run(async () => {
        await store.finishSetup();
        syncLandingRoute('replace');
      }, 'distribution.finish');
    };

    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={store.drafts.createForm.mode === 'rotate' ? ROTATE_FLOW_STEPS : CREATE_FLOW_STEPS} active={3} />
          <PublicTaskTitle
            title="Distribute Shares"
            description="Create each remote onboarding package, set its peer permissions, and mark it delivered when the package has been handed off."
          />
          <CreateFlowDistributionSection
            sectionTitle="Remote Shares"
            sectionDescription="Each share can be copied, saved, shown as a QR package, or marked delivered after handoff."
            beforeCards={
              <OnboardingClientCard
                running={Boolean(store.runtimeSnapshot?.active)}
                relayCount={selectedProfile.relays.length}
                peerCount={store.peerPermissionStates.length}
                signerPubkey={session.signer_pubkey}
                startBusy={actionBusy('distribution.client.start')}
                stopBusy={actionBusy('distribution.client.stop')}
                onStart={() => void run(() => store.startDistributionClient(), 'distribution.client.start')}
                onStop={() => void run(() => store.stopDistributionClient(), 'distribution.client.stop')}
              />
            }
            shares={remainingShares}
            drafts={Object.fromEntries(
              Object.entries(store.drafts.distributionForms).map(([memberIdx, form]) => {
                const idx = Number(memberIdx);
                const passwordSlot = store.draftSecrets.distributionPasswords[idx] ?? {
                  password: '',
                  confirmPassword: '',
                };
                return [
                  idx,
                  {
                    label: form.label,
                    packagePassword: passwordSlot.password,
                    confirmPassword: passwordSlot.confirmPassword,
                  },
                ];
              }),
            )}
            results={distributionResults}
            permissions={store.drafts.distributionPermissions}
            onTogglePermission={(memberIdx, permission, enabled) =>
              void run(() => store.updateDistributionPermission(memberIdx, permission, enabled))
            }
            onChangeDraft={(memberIdx, field, value) => {
              if (field === 'packagePassword') {
                store.updateDistributionPassword(memberIdx, 'password', value);
              } else if (field === 'confirmPassword') {
                store.updateDistributionPassword(memberIdx, 'confirmPassword', value);
              } else {
                store.updateDistributionForm(memberIdx, 'label', value);
              }
            }}
            onDistribute={(memberIdx, kind) =>
              void run(() => store.distributeShare(memberIdx, kind), `distribution.${memberIdx}.${kind}`)
            }
            onFinish={handleFinishSetup}
            onBack={() => store.setActiveView('create-save-profile')}
            busyAction={distributionBusyAction}
            finishBusy={actionBusy('distribution.finish')}
          />
          <QrPayloadModal
            open={Boolean(session.qr_package)}
            onClose={() => store.closeQrPackage()}
            title="Onboarding Package QR"
            label={session.qr_package?.label}
            payload={session.qr_package?.package_text ?? ''}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderLoadImport() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={IMPORT_FLOW_STEPS} active={0} />
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Import Existing Device"
            description="Import an existing signing device using an encrypted backup."
          />
          <section className="igloo-flow-root">
            <ImportProfileEntry
              profileString={store.drafts.importProfileForm.profileString}
              password={store.draftSecrets.importProfileFormPassword}
              onProfileStringChange={(value) => store.updateImportProfileForm('profileString', value)}
              onPasswordChange={(value) => store.updateImportProfilePassword(value)}
              actionBusy={actionBusy('import.load-profile')}
              onNext={() => void run(() => store.loadBfProfile(), 'import.load-profile')}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderLoadError() {
    const profileLoadFailed = store.pendingLoadErrorKind === 'profile';
    const clearLoadError = () => {
      if (profileLoadFailed) {
        syncLandingRoute();
      }
      store.clearLoadError();
    };
    return (
      <>
        <PublicTaskShell>
          {profileLoadFailed ? null : <StepProgress steps={IMPORT_FLOW_STEPS} active={0} />}
          <PageBackLink
            label={profileLoadFailed ? 'Back to Profiles' : 'Back to Welcome'}
            onBack={profileLoadFailed ? clearLoadError : goToLanding}
          />
          <PublicTaskTitle
            title={profileLoadFailed ? "Couldn't load profile" : 'Import Error'}
            description={
              profileLoadFailed
                ? 'Try again, or return to your profiles.'
                : "We couldn't import this profile backup. Resolve the issue below and try again."
            }
          />
          <section className="igloo-flow-root">
            <div className="igloo-onboard-form">
              <WarningCard
                title={profileLoadFailed ? "Couldn't load profile" : 'Import Failed'}
                message={
                  store.pendingLoadError ??
                  (profileLoadFailed
                    ? "We couldn't load this saved profile."
                    : IMPORT_PROFILE_FAILURE_MESSAGE)
                }
              />
              <div className="igloo-onboard-action-row">
                <Button type="button" onClick={clearLoadError}>
                  Try Again
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={profileLoadFailed ? clearLoadError : goToLanding}
                >
                  {profileLoadFailed ? 'Back to Profiles' : 'Back to Welcome'}
                </Button>
              </div>
            </div>
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderLoadConfirm() {
    const pendingLoadConfirmation = store.pendingLoadConfirmation ?? visualImportSaveState?.confirmation ?? null;
    if (!pendingLoadConfirmation) return null;
    const visualImportSaveActive = !store.pendingLoadConfirmation && Boolean(visualImportSaveState);
    const visualDraft = visualImportSaveState?.draft;
    const importSaveDraft = visualImportSaveActive
      ? {
          label: visualDraft?.label ?? pendingLoadConfirmation.preview.label,
          relayUrls: visualDraft?.relayUrls ?? pendingLoadConfirmation.preview.relays.join('\n'),
          primarySecret: visualDraft?.password ?? '',
          secondarySecret: visualDraft?.confirmPassword ?? visualDraft?.password ?? '',
        }
      : {
          label: store.drafts.importSaveForm.label,
          relayUrls: store.drafts.importSaveForm.relayUrls,
          primarySecret: store.draftSecrets.importSaveFormPassword,
          secondarySecret: store.draftSecrets.importSaveFormConfirm,
        };
    const updateVisualDraft = (
      field: 'label' | 'relayUrls' | 'password' | 'confirmPassword',
      value: string,
    ) => {
      setVisualImportSaveState((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                [field]: value,
              },
            }
          : current,
      );
    };
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={IMPORT_FLOW_STEPS} active={1} />
          <PageBackLink label="Back" onBack={() => store.setActiveView('load-import')} />
          <PublicTaskTitle
            title="Save Profile"
            description="Name this local profile, protect it with a password, and choose the relays it should use."
          />
          <section className="igloo-flow-root">
            <CreateFlowProfileSetup
              draft={importSaveDraft}
              lockIdentity
              actionLabel="Launch Signer"
              onLabelChange={(value) =>
                visualImportSaveActive
                  ? updateVisualDraft('label', value)
                  : store.updateImportSaveForm('label', value)
              }
              onPrimarySecretChange={(value) =>
                visualImportSaveActive
                  ? updateVisualDraft('password', value)
                  : store.updateImportSavePassword('password', value)
              }
              onSecondarySecretChange={(value) =>
                visualImportSaveActive
                  ? updateVisualDraft('confirmPassword', value)
                  : store.updateImportSavePassword('confirmPassword', value)
              }
              onRelaysChange={(relays) =>
                visualImportSaveActive
                  ? updateVisualDraft('relayUrls', relays.join('\n'))
                  : store.updateImportSaveForm('relayUrls', relays.join('\n'))
              }
              onPingRelay={(url) => pingRelay(url)}
              normalizeRelays={normalizeRelays}
              actionBusy={visualImportSaveActive ? false : actionBusy('import.launch-signer')}
              actionLoadingLabel="Launching..."
              onAction={() => {
                if (visualImportSaveActive) return;
                void run(() => store.acceptPendingLoadConfirmation(), 'import.launch-signer');
              }}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderOnboardConnect() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={ONBOARD_FLOW_STEPS} active={0} />
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Input Package"
            description="Create a new signing device from an onboarding package."
          />
          <section className="igloo-flow-root">
            <OnboardPackageEntry
              packageText={store.drafts.onboardConnectForm.packageText}
              password={store.draftSecrets.onboardConnectFormPassword}
              onPackageTextChange={(value) => store.updateOnboardConnectForm('packageText', value)}
              onPasswordChange={(value) => store.updateOnboardConnectPassword(value)}
              actionBusy={actionBusy('onboard.connect')}
              onConnect={() => void run(() => store.connectOnboardingPackage(), 'onboard.connect')}
              actionLabel="Next Step"
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderOnboardHandshake() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={ONBOARD_FLOW_STEPS} active={1} />
          <section className="igloo-flow-root">
            <OnboardHandshakePanel
              title="Onboard Device"
              packageText={store.drafts.onboardConnectForm.packageText}
              keysetName="My Signing Key"
              thresholdLabel="2/3"
              activeStep="negotiate"
              onCancel={() => store.setActiveView('onboard-connect')}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderOnboardFailed() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={ONBOARD_FLOW_STEPS} active={1} />
          <PublicTaskTitle
            title="Onboarding Failed"
            description="We couldn't finish onboarding this device. Review the details below and retry."
          />
          <section className="igloo-flow-root">
            <OnboardFailedPanel
              keysetName="My Signing Key"
              thresholdLabel="2/3"
              activeStep="negotiate"
              onRetry={() => {
                setUiError(null);
                store.setActiveView('onboard-connect');
              }}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderOnboardSave() {
    const pendingOnboardConnection = store.pendingOnboardConnection ?? visualOnboardSaveState?.connection ?? null;
    if (!pendingOnboardConnection) return null;
    const visualOnboardSaveActive = !store.pendingOnboardConnection && Boolean(visualOnboardSaveState);
    const visualDraft = visualOnboardSaveState?.draft;
    const onboardSaveDraft = visualOnboardSaveActive
      ? {
          label: visualDraft?.label ?? pendingOnboardConnection.preview.label,
          relayUrls: visualDraft?.relayUrls ?? pendingOnboardConnection.preview.relays.join('\n'),
          primarySecret: visualDraft?.password ?? '',
          secondarySecret: visualDraft?.confirmPassword ?? visualDraft?.password ?? '',
        }
      : {
          label: store.drafts.onboardSaveForm.label,
          relayUrls: store.drafts.onboardSaveForm.relayUrls,
          primarySecret: store.draftSecrets.onboardSaveFormPassword,
          secondarySecret: store.draftSecrets.onboardSaveFormConfirm,
        };
    const updateVisualDraft = (
      field: 'label' | 'relayUrls' | 'password' | 'confirmPassword',
      value: string,
    ) => {
      setVisualOnboardSaveState((current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                [field]: value,
              },
            }
          : current,
      );
    };
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={ONBOARD_FLOW_STEPS} active={2} />
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Save Profile"
            description="Name and protect this profile on the device before launching the signer."
          />
          <section className="igloo-flow-root">
            <CreateFlowProfileSetup
              draft={onboardSaveDraft}
              lockIdentity
              lockName={false}
              actionLabel="Launch Signer"
              onLabelChange={(value) =>
                visualOnboardSaveActive
                  ? updateVisualDraft('label', value)
                  : store.updateOnboardSaveForm('label', value)
              }
              onPrimarySecretChange={(value) =>
                visualOnboardSaveActive
                  ? updateVisualDraft('password', value)
                  : store.updateOnboardSavePassword('password', value)
              }
              onSecondarySecretChange={(value) =>
                visualOnboardSaveActive
                  ? updateVisualDraft('confirmPassword', value)
                  : store.updateOnboardSavePassword('confirmPassword', value)
              }
              onRelaysChange={(relays) =>
                visualOnboardSaveActive
                  ? updateVisualDraft('relayUrls', relays.join('\n'))
                  : store.updateOnboardSaveForm('relayUrls', relays.join('\n'))
              }
              onPingRelay={(url) => pingRelay(url)}
              normalizeRelays={normalizeRelays}
              actionBusy={visualOnboardSaveActive ? false : actionBusy('onboard.launch-signer')}
              actionLoadingLabel="Launching..."
              onAction={() => {
                if (visualOnboardSaveActive) return;
                void run(() => store.finalizeOnboardedDevice(), 'onboard.launch-signer');
              }}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderRotateConnect() {
    if (!selectedProfile) return null;
    return (
      <HostFlowShell
        title="Enter Replacement Package"
        description="Import a prepared bfonboard package to replace this device's local share while keeping the same group public key and Group Profile."
        onBack={goToDashboardSettings}
        backTooltip="Back to Settings"
        variant="bare"
      >
        <ReplaceSharePackageEntry
          packageText={store.drafts.rotateConnectForm.packageText}
          packagePassword={store.draftSecrets.rotateConnectFormPassword}
          onPackageTextChange={(value) => store.updateRotateConnectForm('packageText', value)}
          onPackagePasswordChange={(value) => store.updateRotateConnectPassword(value)}
          onScanQr={() => setReplaceShareQrOpen(true)}
          actionBusy={replaceShareApplying || actionBusy('rotate.connect')}
          onSubmit={() => {
            setReplaceShareError(null);
            setReplaceShareResult(null);
            void run(async () => {
              setReplaceShareApplying(true);
              try {
                await store.connectRotationPackage();
              } catch (error) {
                setReplaceShareApplying(false);
                throw error;
              }
            }, 'rotate.connect');
          }}
        />
      </HostFlowShell>
    );
  }

  function renderRotateSave() {
    const pendingRotationConnection = store.pendingRotationConnection ?? visualReplaceShareConnection;
    if (!pendingRotationConnection || !selectedProfile) return null;
    const memberLabel = deriveShareMemberLabel(pendingRotationConnection.preview.share_package_json);
    const packageLabel = compactReplacePackageLabel(pendingRotationConnection.package_text);

    if (replaceShareError) {
      return (
        <HostFlowShell
          title="Replacement Failed"
          description="The replacement package could not be applied. Your current local share, group public key, and Group Profile were not changed."
          onBack={() => {
            setReplaceShareError(null);
            store.setActiveView('rotate-connect');
          }}
          backTooltip="Back to Replace Share"
          variant="bare"
        >
          <ReplaceShareFailedPanel
            message={replaceShareError}
            showHeader={false}
            onRetry={() => void applyReplaceShareConnection()}
            onBack={() => {
              setReplaceShareError(null);
              store.setActiveView('rotate-connect');
            }}
          />
        </HostFlowShell>
      );
    }

    return (
      <HostFlowShell
        title="Applying Replacement"
        description="Validating the replacement package and replacing this device's local share. The group public key and Group Profile stay the same."
        onBack={() => store.setActiveView('rotate-connect')}
        backTooltip="Back to Replace Share"
        variant="bare"
      >
        <ReplaceShareProgressPanel
          keysetName={selectedProfile.label}
          memberLabel={memberLabel}
          packageLabel={packageLabel}
          applying
          showHeader={false}
          confirmTestId={CRITICAL_E2E_TEST_IDS.rotationConfirmSubmit}
          onConfirm={() => void applyReplaceShareConnection()}
          onCancel={() => store.setActiveView('rotate-connect')}
        />
      </HostFlowShell>
    );
  }

  function renderRotateComplete() {
    if (!replaceShareResult) return null;
    return (
      <HostFlowShell
        title="Share Replaced"
        description="Your local share has been replaced. The group public key and Group Profile are unchanged."
        onBack={() => {
          setReplaceShareResult(null);
          store.setActiveView('dashboard');
          syncDashboardRoute('signer');
          store.setDashboardTab('signer');
        }}
        backTooltip="Return to Signer"
        variant="bare"
      >
        <ReplaceShareSuccessPanel
          {...replaceShareResult}
          showHeader={false}
          onReturn={() => {
            setReplaceShareResult(null);
            store.setActiveView('dashboard');
            syncDashboardRoute('signer');
            store.setDashboardTab('signer');
          }}
        />
      </HostFlowShell>
    );
  }

  function renderRecoverCollect() {
    const recoverSourceProfile =
      store.profiles.find((profile) => profile.id === store.drafts.recoverKeyForm.sourceProfileId) ??
      selectedProfile;
    const threshold = (() => {
      try {
        const group = recoverSourceProfile?.group_package_json
          ? (JSON.parse(recoverSourceProfile.group_package_json) as { threshold?: unknown })
          : null;
        return typeof group?.threshold === 'number' && group.threshold > 0 ? group.threshold : 2;
      } catch {
        return 2;
      }
    })();
    const sources = store.drafts.recoverKeyForm.sources;
    const localDeviceShareUnlocked = Boolean(
      recoverSourceProfile?.encrypted_bfshare_artifact?.trim() &&
        recoverSourceProfile.id === store.selectedProfileId &&
        store.sharePackageJsonByProfileId[recoverSourceProfile.id]?.trim(),
    );
    const isLocalRecoverSourcePackage = (packageText: string) => {
      const trimmed = packageText.trim();
      if (!recoverSourceProfile || !trimmed) return false;
      return [
        recoverSourceProfile.encrypted_bfshare_artifact,
        recoverSourceProfile.share_string,
        recoverSourceProfile.profile_string,
      ].some((candidate) => typeof candidate === 'string' && candidate.trim() === trimmed);
    };
    const completedRemoteShareCount = sources.filter(
      (source, index) =>
        source.packageText.trim().length > 0 &&
        (store.draftSecrets.recoverKeySources[index] ?? '').trim().length > 0 &&
        !isLocalRecoverSourcePackage(source.packageText),
    ).length;
    const collectedCount = (localDeviceShareUnlocked ? 1 : 0) + completedRemoteShareCount;
    const backLabel = recoverReturnTarget === 'dashboard' ? 'Back to Dashboard' : 'Back to Welcome';
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={RECOVER_FLOW_STEPS} active={0} />
          <PageBackLink label={backLabel} onBack={goToRecoverReturnTarget} />
          <PublicTaskTitle
            title="Collect Shares"
            description="Collect enough existing source packages to recover this key. Once the threshold is met, you can reveal and export the recovered private key."
          />
          <section className="igloo-flow-root">
            <RecoverCollectSharesPanel
              sources={sources.map((source, index) => ({
                packageText: source.packageText,
                packagePassword: store.draftSecrets.recoverKeySources[index] ?? '',
                duplicateOfLocal: isLocalRecoverSourcePackage(source.packageText),
              }))}
              deviceShareLabel={
                recoverSourceProfile
                  ? `This Device Share (#${recoverSourceProfile.member_idx})`
                  : undefined
              }
              deviceShareState={localDeviceShareUnlocked ? 'validated' : 'locked'}
              localPassphrase={store.unlockPassphrase}
              threshold={threshold}
              collectedCount={collectedCount}
              onLocalPassphraseChange={(value) => {
                localSourceUnlockRequestRef.current += 1;
                setRecoverCollectError(null);
                setLocalSourceUnlockError(null);
                store.setUnlockPassphrase(value);
              }}
              onSubmitLocalPassphrase={() => {
                const profileId = recoverSourceProfile?.id;
                const passphrase = store.unlockPassphrase;
                if (!profileId || !passphrase.trim()) return;
                const requestId = localSourceUnlockRequestRef.current + 1;
                localSourceUnlockRequestRef.current = requestId;
                setUiError(null);
                setRecoverCollectError(null);
                setLocalSourceUnlockError(null);
                setPendingActionId('recover.local-source');
                void store
                  .unlockLocalSourceShare(profileId, passphrase)
                  .catch((error) => {
                    if (localSourceUnlockRequestRef.current !== requestId) return;
                    setLocalSourceUnlockError(formatUiError(error) || 'Profile passphrase could not unlock this share.');
                  })
                  .finally(() => {
                    if (localSourceUnlockRequestRef.current !== requestId) return;
                    setPendingActionId((current) => (current === 'recover.local-source' ? null : current));
                  });
              }}
              localPassphraseActionBusy={actionBusy('recover.local-source')}
              localPassphraseError={localSourceUnlockError}
              onChangeSource={(index, field, value) => {
                setRecoverCollectError(null);
                store.updateRecoverSource(index, field === 'packagePassword' ? 'password' : 'packageText', value);
              }}
              onAddSource={() => {
                setRecoverCollectError(null);
                store.addRecoverSource();
              }}
              onRemoveSource={(index) => {
                setRecoverCollectError(null);
                store.removeRecoverSource(index);
              }}
              sourceControls="fixed"
              error={recoverCollectError}
              onNext={() => void runRecoverCollect()}
              actionBusy={actionBusy('recover.collect')}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderRecoverKey() {
    if (!recoveredKey) return null;
    return <RecoverPrivateKeyView recovered={recoveredKey} onClear={goToRecoverReturnTarget} />;
  }

  function renderDashboardLoading() {
    if (!dashboardLoadingProfile) return null;
    return (
      <div className="w-full px-5 pb-5 sm:px-10 lg:px-20">
        <div className="mx-auto w-full max-w-[1000px]">
          <DashboardLoadingState profile={dashboardLoadingProfile} />
        </div>
      </div>
    );
  }

  function renderDashboardNav() {
    if (!dashboardHeaderActive) return undefined;
    const isDashboardView = store.activeView === 'dashboard';
    const dashboardTabActive = isDashboardView && !settingsSidebarOpen;
    return (
      <DashboardHeaderActions
        dashboard={{
          label: 'Dashboard',
          active: dashboardTabActive && store.activeDashboardTab === 'signer',
          testId: CRITICAL_E2E_TEST_IDS.dashboardTabSigner,
          onClick: () => requestDashboardTab('signer'),
        }}
        permissions={{
          id: 'operator-tab-permissions',
          label: 'Permissions',
          active: dashboardTabActive && store.activeDashboardTab === 'permissions',
          testId: CRITICAL_E2E_TEST_IDS.dashboardTabPermissions,
          onClick: () => requestDashboardTab('permissions'),
        }}
        settings={{
          id: 'operator-tab-settings',
          label: 'Settings',
          active: isDashboardView && settingsSidebarOpen,
          testId: CRITICAL_E2E_TEST_IDS.dashboardTabSettings,
          onClick: () => requestDashboardTab('settings'),
        }}
      />
    );
  }

  function renderDashboard() {
    const dashboardRuntimeSnapshot = visualPermissionsState?.runtimeSnapshot ?? store.runtimeSnapshot;
    const dashboardPeerPermissionStates =
      visualPermissionsState?.peerPermissionStates ?? store.peerPermissionStates;
    const runtimeState = dashboardRuntimeSnapshot?.active ? 'running' : 'stopped';
    const dashboardRuntimeActive = Boolean(dashboardRuntimeSnapshot?.active);
    const storeRuntimeActive = Boolean(store.runtimeSnapshot?.active);
    const runtimeControlLabel = runtimeState === 'running' ? 'Stop Signer' : 'Start Signer';
    const signerView = deriveSignerDashboardView(
      selectedProfile,
      dashboardRuntimeSnapshot,
      dashboardPeerPermissionStates,
    );
    const policyView = derivePolicyDashboardView(
      Boolean(dashboardRuntimeSnapshot?.active),
      dashboardPeerPermissionStates,
    );
    const groupSummary = selectedProfile
      ? deriveGroupSummary(selectedProfile.group_package_json)
      : {};
    const groupProfile = selectedProfile
      ? {
          keysetName: groupSummary.keysetName ?? selectedProfile.label,
          keyNpub: signerView?.groupKey?.display ?? signerView?.publicKeyLabel,
          thresholdLabel: formatGroupThresholdLabel(groupSummary) ?? signerView?.thresholdLabel,
          createdLabel: formatDateLabel(selectedProfile.created_at),
          updatedLabel: formatDateLabel(selectedProfile.updated_at ?? selectedProfile.created_at),
        }
      : undefined;
    const clearDashboardLogs = storeRuntimeActive
      ? () => void run(() => store.clearLogs(), 'signer.clear-logs')
      : visualPermissionsState?.runtimeSnapshot?.active
        ? () =>
            setVisualPermissionsState((current) =>
              current
                ? {
                    ...current,
                    runtimeSnapshot: current.runtimeSnapshot
                      ? {
                          ...current.runtimeSnapshot,
                          events: [],
                          runtime_log_lines: [],
                        }
                      : current.runtimeSnapshot,
                  }
                : current,
            )
        : undefined;

    return (
      <div className="w-full px-5 pb-5 sm:px-10 lg:px-20">
        <div data-testid={CRITICAL_E2E_TEST_IDS.dashboardRoot} className="mx-auto w-full max-w-[1000px] space-y-6">
        {store.activeDashboardTab === 'permissions' && !settingsSidebarOpen ? (
          <div role="tabpanel" id="operator-panel-permissions" aria-labelledby="operator-tab-permissions">
            <OperatorPermissionsPanel
              view={policyView}
              refreshLoading={actionBusy('permissions.refresh')}
              clearAllPeerPermissionsLoading={actionBusy('permissions.clear-overrides')}
              onRefresh={() => void run(() => store.refreshSigner(), 'permissions.refresh')}
              onClearAllPeerPermissions={() => void run(() => store.clearPeerPolicies(), 'permissions.clear-overrides')}
              onPeerPolicyOverrideChange={(pubkey, direction, method, value) =>
                void run(() => store.updatePeerPolicy(pubkey, direction, method, value))
              }
              peerClearAllLabel="Remove Overrides"
              peerDescription="Live outbound and inbound peer policy state for the active browser signer."
              peerEmptyText={
                dashboardRuntimeSnapshot?.active
                  ? 'No peer policy state is currently available from the active runtime.'
                  : 'Start the signer to inspect and edit live peer policy state.'
              }
            />
          </div>
        ) : (
          <OperatorSignerPanel
            view={signerView}
            introMessage="The browser signer runs locally inside the PWA workbench. This dashboard mirrors the operator workflow used by igloo-chrome."
            emptyDescription="Load or onboard a device profile before opening the signer dashboard."
            runtimeControlLabel={runtimeControlLabel}
            copiedField={dashboardCopiedField}
            onCopyGroupKey={(format) => copyDashboardKey('group', signerView?.groupKey, format)}
            onPrimaryAction={() =>
              void run(
                () => (storeRuntimeActive ? store.stopSigner() : store.startSigner()),
                storeRuntimeActive ? 'signer.stop' : 'signer.start',
              )
            }
            primaryActionLoading={actionBusy('signer.start') || actionBusy('signer.stop')}
            primaryActionLoadingLabel={dashboardRuntimeActive ? 'Stopping...' : 'Starting...'}
            primaryActionVariant={dashboardRuntimeActive ? 'destructive' : 'success'}
            onRefreshPeers={() => void run(() => store.refreshSigner(), 'signer.refresh-peers')}
            refreshPeersLoading={actionBusy('signer.refresh-peers')}
            refreshPeersDisabled={!dashboardRuntimeActive}
            onPingPeer={(pubkey) => store.pingPeer(pubkey)}
            pingPeerDisabled={!dashboardRuntimeActive}
            // Real clears go through the active session. Visual test snapshots
            // clear their injected event buffer locally so the Paper state can
            // still exercise the control without booting a signer.
            onClearLogs={clearDashboardLogs}
            clearLogsLoading={actionBusy('signer.clear-logs')}
          />
        )}

          <OperatorSettingsSidebar
            open={settingsSidebarOpen}
            onClose={requestSettingsSidebarClose}
            hasProfile={Boolean(selectedProfile)}
            signerName={operatorSettingsDraft.signerName}
            onSignerNameChange={(value) =>
              setOperatorSettingsDraft((current) => ({ ...current, signerName: value }))
            }
            memberLabel={signerView?.memberLabel}
            relays={operatorSettingsDraft.relays}
            newRelayUrl={operatorSettingsDraft.newRelayUrl}
            onNewRelayUrlChange={(value) =>
              setOperatorSettingsDraft((current) => ({ ...current, newRelayUrl: value }))
            }
            onAddRelay={() =>
              setOperatorSettingsDraft((current) => {
                const normalized = current.newRelayUrl.trim();
                if (!normalized || current.relays.includes(normalized)) return current;
                return {
                  ...current,
                  relays: [...current.relays, normalized],
                  newRelayUrl: '',
                };
              })
            }
            onRemoveRelay={(relay) =>
              setOperatorSettingsDraft((current) => ({
                ...current,
                relays: current.relays.filter((item) => item !== relay),
              }))
            }
            profilePasswordAction={{
              title: 'Profile Password',
              description: 'Change the local password used to unlock this profile.',
              actionLabel: 'Change',
              testId: CRITICAL_E2E_TEST_IDS.settingsProfilePassword,
              disabled: !selectedProfile,
              onAction: () => {
                setSettingsPasswordError(null);
                setSettingsPasswordOpen(true);
              },
            }}
            groupProfile={groupProfile}
            signerSettings={operatorSettingsDraft.signerSettings}
            onSignerSettingNumberChange={(field, value) =>
              setOperatorSettingsDraft((current) => ({
                ...current,
                signerSettings: {
                  ...current.signerSettings,
                  [field]: Number.parseInt(value, 10) || current.signerSettings[field],
                },
              }))
            }
            onPeerSelectionStrategyChange={(value) =>
              setOperatorSettingsDraft((current) => ({
                ...current,
                signerSettings: {
                  ...current.signerSettings,
                  peer_selection_strategy: value,
                },
              }))
            }
            onSave={() =>
              void run(async () => {
                await store.saveOperatorSettings({
                  label: operatorSettingsDraft.signerName,
                  relays: operatorSettingsDraft.relays,
                  signerSettings: operatorSettingsDraft.signerSettings,
                });
                setSettingsSidebarOpen(false);
                syncDashboardRoute('signer');
                store.setDashboardTab('signer');
              }, 'settings.save')
            }
            saving={actionBusy('settings.save')}
            showSaveControls={settingsDirty}
            showAdvancedSettings={false}
            saveDisabled={!selectedProfile || !store.runtimeSnapshot?.active || !settingsDirty}
            message={
              settingsDirty && !store.runtimeSnapshot?.active
                ? 'Start the signer to apply settings live.'
                : null
            }
            browserPreferences={
              <div className="igloo-settings-grid">
                <label className="igloo-toggle-row">
                  <input
                    type="checkbox"
                    checked={store.settings.remember_browser_state}
                    onChange={(event) => store.updateSettings('remember_browser_state', event.target.checked)}
                  />
                  <span>
                    <strong>Remember browser state</strong>
                    <small>Persist profiles, drafts, and the last active workspace in this browser.</small>
                  </span>
                </label>
                <label className="igloo-toggle-row">
                  <input
                    type="checkbox"
                    data-testid={CRITICAL_E2E_TEST_IDS.settingsAutoOpenToggle}
                    checked={store.settings.auto_open_signer}
                    onChange={(event) => store.updateSettings('auto_open_signer', event.target.checked)}
                  />
                  <span>
                    <strong>Open signer after import</strong>
                    <small>Jump straight into the signer workspace after a successful setup action.</small>
                  </span>
                </label>
                <label className="igloo-toggle-row">
                  <input
                    type="checkbox"
                    checked={store.settings.prefer_install_prompt}
                    onChange={(event) => store.updateSettings('prefer_install_prompt', event.target.checked)}
                  />
                  <span>
                    <strong>Prefer install prompt</strong>
                    <small>Keep the PWA install affordance visible when the browser makes it available.</small>
                  </span>
                </label>
              </div>
            }
            onboardAction={{
              title: 'Onboard a Device',
              description:
                'Sponsor a new device to join this keyset with an encrypted bfonboard package.',
              actionLabel: 'Onboard a Device',
              testId: CRITICAL_E2E_TEST_IDS.settingsOnboardDevice,
              disabled: !selectedProfile,
              onAction: openSettingsOnboardDialog,
            }}
            replaceShareAction={{
              title: 'Replace Share',
              description:
                "Import a bfonboard package to replace only this device's local share while keeping the same group public key and profile.",
              actionLabel: 'Replace Share',
              testId: CRITICAL_E2E_TEST_IDS.maintenanceRotateShare,
              variant: 'secondary',
              disabled: !selectedProfile,
              onAction: openReplaceShareFlow,
            }}
            exportProfileAction={{
              title: 'Export Profile',
              description: 'Encrypted backup of your share and configuration',
              actionLabel: 'Export',
              testId: CRITICAL_E2E_TEST_IDS.settingsCopyProfile,
              variant: 'secondary',
              disabled: !selectedProfile,
              onAction: () => openDashboardExportModal('bfprofile'),
            }}
            exportShareAction={{
              title: 'Export Share',
              description: 'Password-protected bfshare package',
              actionLabel: 'Export',
              testId: CRITICAL_E2E_TEST_IDS.settingsCopyShare,
              variant: 'secondary',
              disabled: !selectedProfile,
              onAction: () => openDashboardExportModal('bfshare'),
            }}
            lockProfileAction={{
              title: 'Logout',
              description: 'Return to profile list to open another profile',
              actionLabel: 'Logout',
              testId: CRITICAL_E2E_TEST_IDS.settingsLogout,
              variant: 'destructive',
              disabled: !selectedProfile,
              onAction: () => {
                setSettingsSidebarOpen(false);
                void run(() => store.logout());
              },
            }}
            clearCredentialsAction={{
              title: 'Clear Credentials',
              description:
                "Delete this device's saved profile, share, password, and relay configuration",
              actionLabel: 'Clear',
              testId: CRITICAL_E2E_TEST_IDS.settingsClearCredentials,
              variant: 'destructive',
              disabled: !selectedProfile,
              onAction: () => setSettingsClearCredentialsOpen(true),
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <PageLayout
      surface={
        isPaperWelcomeSurface(store)
          ? 'welcome'
          : dashboardHeaderActive
            ? 'dashboard'
            : 'default'
      }
      maxWidth={isPaperWelcomeSurface(store) || dashboardHeaderActive ? 'max-w-none' : undefined}
      header={
        <AppHeader
          mode={dashboardHeaderActive ? 'dashboard' : deriveHeaderMode(store.activeView)}
          logoSrc="/igloo-paper-mark.png"
          taskLabel={deriveHeaderTaskLabel(store)}
          profileName={selectedProfile?.label}
          brandAction={
            dashboardHeaderActive
              ? {
                  ariaLabel: 'Dashboard',
                  onClick: () => requestDashboardTab('signer'),
                }
              : undefined
          }
          actions={renderDashboardNav()}
        />
      }
    >
      {renderError()}
      {renderRuntimeWarning()}
      <WelcomeUnlockModal
        open={Boolean(welcomeUnlockProfileId) && !dashboardLoadingProfile}
        profile={welcomeUnlockProfile}
        password={welcomeUnlockPassword}
        error={welcomeUnlockError}
        submitting={welcomeUnlockSubmitting}
        onPasswordChange={(value) => {
          setWelcomeUnlockPassword(value);
          setWelcomeUnlockError(null);
        }}
        onSubmit={(event) => void submitWelcomeUnlock(event)}
        onClose={closeWelcomeUnlock}
      />
      <WelcomeDeleteModal
        open={Boolean(welcomeDeleteProfileId)}
        profile={welcomeDeleteProfile}
        onConfirm={confirmWelcomeDelete}
        onClose={closeWelcomeDelete}
      />
      <ExportPackageModal
        open={Boolean(exportModalFormat)}
        onClose={closeExportModal}
        title={exportModalFormat === 'bfshare' ? 'Export Share' : 'Export Profile'}
        description={
          exportModalFormat === 'bfshare'
            ? "Create a password-protected bfshare package. You'll need this password to restore on another device."
            : "Create an encrypted backup of your share and configuration. You'll need this password to restore on another device."
        }
        summary={deriveExportSummary(selectedProfile)}
        result={exportResult}
        busy={exportBusy}
        error={exportError}
        onExport={runExport}
        onCopy={(value) => {
          if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(value);
        }}
        onDownload={(value) => {
          const filename = exportModalFormat === 'bfshare' ? 'igloo-share.bfshare.txt' : 'igloo-profile.bfprofile.txt';
          // Route through the confirmed-write save helper (File System Access API
          // with an anchor-download fallback), matching the distribution flow.
          void saveTextToFile(filename, value);
        }}
      />
      <ProfilePasswordChangeDialog
        open={settingsPasswordOpen}
        currentPassword={settingsPasswordCurrent}
        nextPassword={settingsPasswordNext}
        confirmPassword={settingsPasswordConfirm}
        error={settingsPasswordError}
        busy={settingsPasswordBusy}
        onCurrentPasswordChange={(value) => {
          setSettingsPasswordCurrent(value);
          setSettingsPasswordError(null);
        }}
        onNextPasswordChange={(value) => {
          setSettingsPasswordNext(value);
          setSettingsPasswordError(null);
        }}
        onConfirmPasswordChange={(value) => {
          setSettingsPasswordConfirm(value);
          setSettingsPasswordError(null);
        }}
        onSubmit={(event) => void submitSettingsPasswordChange(event)}
        onCancel={closeSettingsPasswordDialog}
        testIds={{
          current: CRITICAL_E2E_TEST_IDS.settingsPasswordCurrent,
          next: CRITICAL_E2E_TEST_IDS.settingsPasswordNext,
          confirm: CRITICAL_E2E_TEST_IDS.settingsPasswordConfirm,
          submit: CRITICAL_E2E_TEST_IDS.settingsPasswordSubmit,
        }}
      />
      <OnboardDeviceSponsorDialog
        open={settingsOnboardOpen}
        draft={settingsOnboardDraft}
        result={settingsOnboardResult}
        error={settingsOnboardError}
        errorFields={settingsOnboardErrorFields}
        busy={settingsOnboardBusy}
        signerActive={Boolean(settingsOnboardSignerPubkey)}
        handoffStatus={settingsOnboardHandoffStatus}
        handoffStatusTone={settingsOnboardHandoffTone}
        handoffAction={settingsOnboardHandoffAction}
        cancelRequiresConfirmation={settingsOnboardCancelRequiresConfirmation}
        onDraftChange={(field, value) => {
          setSettingsOnboardDraft((current) => ({ ...current, [field]: value }));
          setSettingsOnboardError(null);
          setSettingsOnboardErrorFields([]);
          setSettingsOnboardHandoffStatus(null);
          setSettingsOnboardHandoffTone('success');
          setSettingsOnboardHandoffAction(null);
        }}
        onCreatePackage={(event) => void submitSettingsOnboardPackage(event)}
        onCopyPackage={settingsOnboardResult ? copySettingsOnboardPackage : undefined}
        onSavePackage={settingsOnboardResult ? saveSettingsOnboardPackage : undefined}
        onShowQrPackage={
          settingsOnboardResult
            ? () => {
                setSettingsOnboardHandoffAction('qr');
                setSettingsOnboardHandoffTone('success');
                setSettingsOnboardQrOpen(true);
                setSettingsOnboardHandoffStatus('QR code opened.');
                window.setTimeout(() => setSettingsOnboardHandoffAction(null), 250);
              }
            : undefined
        }
        onCreateAnother={createAnotherSettingsOnboardPackage}
        onClose={closeSettingsOnboardDialog}
      />
      <QrPayloadModal
        open={Boolean(settingsOnboardResult && settingsOnboardQrOpen)}
        onClose={() => setSettingsOnboardQrOpen(false)}
        title="Onboarding Package"
        payload={settingsOnboardResult?.packageText ?? ''}
        label="Scan to import this bfonboard package on the new device"
      />
      <Modal
        open={replaceShareQrOpen}
        onClose={() => setReplaceShareQrOpen(false)}
        title="Scan QR"
        className="max-w-md"
      >
        <div className="igloo-stack">
          <p className="text-sm text-igloo-muted">
            QR scanning for replacement packages needs the camera scanner bridge. Paste the
            bfonboard1 package directly for now.
          </p>
          <div className="igloo-button-row">
            <Button type="button" onClick={() => setReplaceShareQrOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
      <SettingsUnsavedChangesDialog
        open={Boolean(pendingSettingsExit)}
        onDiscard={discardSettingsSidebarChanges}
        onKeepEditing={closeSettingsDiscardDialog}
      />
      <ClearCredentialsDialog
        open={settingsClearCredentialsOpen}
        profileSummary={clearCredentialsSummary}
        onConfirm={() => {
          const profileId = selectedProfile?.id;
          setSettingsClearCredentialsOpen(false);
          setSettingsSidebarOpen(false);
          if (!profileId) return;
          void run(async () => {
            await store.logout();
            store.deleteProfile(profileId);
            store.setUnlockPassphrase('');
            store.setActiveView('landing');
          });
        }}
        onCancel={() => setSettingsClearCredentialsOpen(false)}
      />
      <DashboardSigningFailedDialog
        open={Boolean(signingFailure)}
        failure={signingFailure}
        retryBusy={actionBusy('signer.retry-signing-failure')}
        onDismiss={() => dismissSigningFailure(signingFailure?.id)}
        onRetry={() => {
          const failureId = signingFailure?.id;
          dismissSigningFailure(failureId);
          void run(() => store.refreshSigner(), 'signer.retry-signing-failure');
        }}
      />
      {dashboardLoadingProfile ? renderDashboardLoading() : null}
      {!dashboardLoadingProfile && store.activeView === 'landing' ? renderLanding() : null}
      {store.activeView === 'create-generate' ? renderCreateGenerate() : null}
      {store.activeView === 'create-select-share' ? renderCreateSelectShare() : null}
      {store.activeView === 'create-save-profile' ? renderCreateSaveProfile() : null}
      {store.activeView === 'create-distribute' ? renderCreateDistribute() : null}
      {store.activeView === 'load-import' ? renderLoadImport() : null}
      {store.activeView === 'load-confirm' ? renderLoadConfirm() : null}
      {store.activeView === 'load-error' ? renderLoadError() : null}
      {store.activeView === 'onboard-connect' ? renderOnboardConnect() : null}
      {store.activeView === 'onboard-handshake' ? renderOnboardHandshake() : null}
      {store.activeView === 'onboard-failed' ? renderOnboardFailed() : null}
      {store.activeView === 'onboard-save' ? renderOnboardSave() : null}
      {store.activeView === 'rotate-connect' ? renderRotateConnect() : null}
      {store.activeView === 'rotate-save' ? renderRotateSave() : null}
      {store.activeView === 'rotate-complete' ? renderRotateComplete() : null}
      {store.activeView === 'recover-collect' ? renderRecoverCollect() : null}
      {store.activeView === 'recover-key' ? renderRecoverKey() : null}
      {store.activeView === 'dashboard' ? (
        <>
          {renderDashboard()}
          <PublicFocusFooter variant="dashboard" />
        </>
      ) : null}
    </PageLayout>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
