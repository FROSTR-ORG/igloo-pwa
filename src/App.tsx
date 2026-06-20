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
  type DashboardKeyModel,
  type EventLogRowModel,
  type OnboardDeviceSponsorDraft,
  type OnboardDeviceSponsorResult,
  type PeerPolicy,
  type SharedDistributionResult,
  type PolicyDashboardViewModel,
  type SignerDashboardViewModel,
  type WelcomeReturningProfileModel,
  type WelcomeResumableDeviceModel,
} from 'igloo-ui';
import {
  buildProfileDownloadFilename,
  pingRelay,
  shortProfileId,
  type RuntimeReadiness,
  type RuntimeStatusSummary,
} from 'igloo-shared';
import * as nip49 from 'nostr-tools/nip49';
import { deriveExportSummary, deriveGroupSummary, toDashboardKey } from './lib/dashboard-view';
import { saveTextToFile } from './lib/file-save';
import { adoptInstanceId, getInstanceId, readInstanceRegistry } from './lib/instance';
import { createSettingsOnboardingPackageFromBfshare } from './lib/local-adapter';

import { StoreProvider, useStore } from './lib/store';
import type { PwaDistributionActionResult, PwaGeneratedShare, PwaOnboardConnection } from './lib/types';

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const CREATE_FLOW_STEPS = ['Create Keyset', 'Select Share', 'Save Profile', 'Distribute Shares'];
const IMPORT_FLOW_STEPS = ['Import Profile', 'Save Profile'];
const ONBOARD_FLOW_STEPS = ['Input Package', 'Onboard Device', 'Save Profile'];
const RECOVER_FLOW_STEPS = ['Collect Shares', 'Recover Key'];

function toPwaEventRows(lines: string[] = []): EventLogRowModel[] {
  return lines.map((line, index) => ({
    id: `pwa-log-${index}-${line}`,
    badgeLabel: line.startsWith('[error]') ? 'error' : line.startsWith('[warn]') ? 'warn' : 'info',
    badgeTone: line.startsWith('[error]') ? 'danger' : line.startsWith('[warn]') ? 'warning' : 'info',
    message: line.replace(/^\[[^\]]+\]\s*/, ''),
    timestampLabel: 'live',
  }));
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

function formatUiError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string' && message.trim()) return message;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the generic message below.
    }
  }
  return 'Unexpected error.';
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

type PwaRuntimePeerStatus = {
  idx: number;
  pubkey: string;
  known: boolean;
  last_seen: number | null;
  online: boolean;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  can_sign: boolean;
  should_send_nonces: boolean;
};

type PwaRuntimePendingOperation = {
  request_id: string;
  op_type: string;
  threshold: number;
  started_at: number | null;
  timeout_at: number | null;
  collected_responses: unknown[];
  target_peers: string[];
};

type PwaRuntimeReadiness = {
  runtime_ready: boolean;
  restore_complete: boolean;
  sign_ready: boolean;
  ecdh_ready: boolean;
  last_refresh_at: number | null;
};

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

function derivePwaPeers(
  policies: Array<{
    pubkey: string;
    effective_policy: {
      request: { sign: boolean };
      respond: { sign: boolean };
    };
  }>,
  runtimeStatus: RuntimeStatusSummary | null | undefined,
): PeerPolicy[] {
  const base = new Map<string, PeerPolicy>();

  for (const [index, policy] of policies.entries()) {
    base.set(policy.pubkey.toLowerCase(), {
      alias: `Peer ${index + 1}`,
      pubkey: policy.pubkey.toLowerCase(),
      send: policy.effective_policy.request.sign,
      receive: policy.effective_policy.respond.sign,
      state: 'offline',
      statusLabel: 'offline',
      lastSeen: null,
      incomingAvailable: 0,
      outgoingAvailable: 0,
      outgoingSpent: 0,
      shouldSendNonces: false,
    });
  }

  const summary = runtimeStatus;
  for (const [index, peer] of (summary?.metadata?.peers ?? []).entries()) {
    const normalized = peer.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      alias: existing?.alias ?? `Peer ${index + 1}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      state: 'idle',
      statusLabel: 'known',
      lastSeen: existing?.lastSeen ?? null,
      incomingAvailable: existing?.incomingAvailable ?? 0,
      outgoingAvailable: existing?.outgoingAvailable ?? 0,
      outgoingSpent: existing?.outgoingSpent ?? 0,
      shouldSendNonces: existing?.shouldSendNonces ?? false,
    });
  }

  for (const peer of summary?.peers ?? []) {
    const normalized = peer.pubkey.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      alias: existing?.alias ?? `Peer ${peer.idx}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      // Match the igloo-ui runtime adapter: a reachable peer is online/idle, a
      // known-but-unreachable peer warns, everything else is offline. (The prior
      // mapping flagged sign-ready peers as 'warning', contradicting the
      // 'sign-ready' status label and the shared adapter.)
      state: peer.online ? (peer.can_sign ? 'online' : 'idle') : peer.known ? 'warning' : 'offline',
      statusLabel: peer.can_sign ? 'sign-ready' : peer.online ? 'online' : peer.known ? 'known' : 'offline',
      lastSeen: peer.last_seen,
      incomingAvailable: peer.incoming_available,
      outgoingAvailable: peer.outgoing_available,
      outgoingSpent: peer.outgoing_spent,
      shouldSendNonces: peer.should_send_nonces,
    });
  }

  return Array.from(base.values()).sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

function derivePendingOperations(runtimeStatus: unknown) {
  const summary = (runtimeStatus ?? null) as PwaRuntimeStatus | null;
  return (summary?.pending_operations ?? []).map((operation) => ({
    id: operation.request_id,
    operationLabel: operation.op_type,
    thresholdLabel: `threshold ${operation.threshold}`,
    startedLabel: formatRuntimeTimestamp(operation.started_at),
    timeoutLabel: formatRuntimeTimestamp(operation.timeout_at),
    responseLabel: `${Array.isArray(operation.collected_responses) ? operation.collected_responses.length : 0} responses`,
  }));
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
    relaySummary: runtimeSnapshot?.active ? 'Browser runtime connected' : 'Runtime stopped',
    pendingApprovalRows: [],
    peerRows: derivePwaPeers(peerPermissionStates, runtimeSnapshot?.runtime_status).map((peer) => ({
      id: peer.pubkey,
      alias: peer.alias,
      pubkey: peer.pubkey,
      state: peer.state,
      statusLabel: peer.statusLabel ?? peer.state,
      lastSeenLabel: peer.lastSeen ? `last seen ${formatRuntimeTimestamp(peer.lastSeen)}` : undefined,
      incomingAvailable: peer.incomingAvailable,
      outgoingAvailable: peer.outgoingAvailable,
      outgoingSpent: peer.outgoingSpent,
    })),
    pendingOperationRows: derivePendingOperations(runtimeSnapshot?.runtime_status),
    // Prefer structured events (domain/event tags + filter); fall back to the
    // formatted log lines for sessions that only surface plain strings.
    eventRows: runtimeSnapshot?.events?.length
      ? observabilityEventsToEventRows(runtimeSnapshot.events)
      : toPwaEventRows(runtimeSnapshot?.runtime_log_lines),
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

function deriveHeaderTaskLabel(activeView: ReturnType<typeof useStore>['activeView']) {
  if (activeView.startsWith('create')) return 'Create';
  if (activeView.startsWith('rotate')) return 'Replace';
  if (activeView.startsWith('onboard')) return 'Onboard';
  if (activeView.startsWith('load')) return 'Import';
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

export function RecoverPrivateKeyView({
  recovered,
  onClear,
}: {
  recovered: { nsec: string; signingKeyHex: string };
  onClear: () => void;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
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
  const passwordError = encrypt && confirmPassword.length > 0 && !passwordsMatch
    ? 'Passwords do not match.'
    : null;
  const fieldLabel = encrypt ? 'Encrypted Key (ncryptsec)' : 'Recovered NSEC';
  const displayValue = exportValue ?? recovered.nsec;
  const masked = `${displayValue.slice(0, 10)}${'•'.repeat(32)}`;

  function copyKey() {
    if (!exportValue) return;
    void navigator.clipboard?.writeText(exportValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function saveKey() {
    if (!exportValue) return;
    const blob = new Blob([exportValue], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = encrypt ? 'recovered-key.ncryptsec' : 'recovered-nsec.txt';
    anchor.click();
    URL.revokeObjectURL(url);
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
            <Button type="button" size="sm" onClick={copyKey} disabled={exportsDisabled}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={saveKey} disabled={exportsDisabled}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setQrOpen(true)}
              disabled={exportsDisabled}
            >
              QR code
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setRevealed((value) => !value)}>
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClear}>
              Clear
            </Button>
          </div>

          <label className="igloo-recover-encrypt-toggle">
            <input type="checkbox" checked={encrypt} onChange={(event) => setEncrypt(event.target.checked)} />
            <span>
              <strong>Encrypt Key</strong>
              <small>Protect the exported key with a password before saving or sharing.</small>
            </span>
          </label>
          {encrypt ? (
            <div className="igloo-stack">
              <label>
                Password
                <PasswordField value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label>
                Confirm Password
                <PasswordField
                  value={confirmPassword}
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
  const [dashboardCopiedField, setDashboardCopiedField] = React.useState<'group' | 'share' | null>(null);
  const [settingsSidebarOpen, setSettingsSidebarOpen] = React.useState(false);
  const [settingsClearCredentialsOpen, setSettingsClearCredentialsOpen] = React.useState(false);
  const [settingsOnboardOpen, setSettingsOnboardOpen] = React.useState(false);
  const [settingsOnboardDraft, setSettingsOnboardDraft] =
    React.useState<OnboardDeviceSponsorDraft>(() => buildSettingsOnboardDraft(null));
  const [settingsOnboardResult, setSettingsOnboardResult] =
    React.useState<OnboardDeviceSponsorResult | null>(null);
  const [settingsOnboardError, setSettingsOnboardError] = React.useState<string | null>(null);
  const [settingsOnboardBusy, setSettingsOnboardBusy] = React.useState(false);
  const [settingsOnboardQrOpen, setSettingsOnboardQrOpen] = React.useState(false);
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
  const visualReplaceShareAppliedRef = React.useRef(false);
  const autoApplyReplaceShareKeyRef = React.useRef<string | null>(null);

  const copyDashboardKey = React.useCallback(
    (field: 'group' | 'share', keyModel: DashboardKeyModel | undefined, format?: 'npub' | 'hex') => {
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
  const closeExportModal = React.useCallback(() => {
    setExportModalFormat(null);
    setExportResult(null);
    setExportError(null);
  }, []);

  // Unsaved-changes guard for the Settings sidebar: closing the sidebar with
  // edited profile/relay/runtime fields asks before discarding the draft.
  const [pendingSettingsExit, setPendingSettingsExit] = React.useState<'signer' | 'permissions' | 'close' | null>(null);

  // DEV-only seam: lets the visual harness render the recover-success screen with a
  // FAKE nsec injected on the window. Stripped from production builds (guarded on
  // import.meta.env.DEV) and never touches persistence or the real reconstruction path.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const injected = window.__IGLOO_TEST_RECOVERED_KEY__;
    if (injected && !recoveredKey) {
      setRecoveredKey(injected);
    }
  }, [recoveredKey]);

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

  const selectedProfile = store.profiles.find((profile) => profile.id === store.selectedProfileId) ?? null;
  const runExport = React.useCallback(
    (exportPassword: string) => {
      if (!selectedProfile || !exportModalFormat) return;
      setExportBusy(true);
      setExportError(null);
      void store
        .exportEncryptedPackage(selectedProfile.id, exportModalFormat, exportPassword)
        .then((value) => setExportResult(value))
        .catch((error: unknown) =>
          setExportError(error instanceof Error ? error.message : 'Export failed.'),
        )
        .finally(() => setExportBusy(false));
    },
    [selectedProfile, exportModalFormat, store],
  );

  const settingsOnboardSignerPubkey =
    store.runtimeSnapshot?.active && store.runtimeSnapshot.runtime_host?.signer_pubkey
      ? store.runtimeSnapshot.runtime_host.signer_pubkey
      : null;

  const openSettingsOnboardDialog = React.useCallback(() => {
    setSettingsOnboardDraft(buildSettingsOnboardDraft(selectedProfile));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardQrOpen(false);
    setSettingsOnboardOpen(true);
  }, [selectedProfile]);

  const closeSettingsOnboardDialog = React.useCallback(() => {
    setSettingsOnboardOpen(false);
    setSettingsOnboardDraft(buildSettingsOnboardDraft(null));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardBusy(false);
    setSettingsOnboardQrOpen(false);
  }, []);

  const createAnotherSettingsOnboardPackage = React.useCallback(() => {
    setSettingsOnboardDraft(buildSettingsOnboardDraft(selectedProfile));
    setSettingsOnboardResult(null);
    setSettingsOnboardError(null);
    setSettingsOnboardQrOpen(false);
  }, [selectedProfile]);

  const submitSettingsOnboardPackage = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProfile) {
        setSettingsOnboardError('Select a profile before creating an onboarding package.');
        return;
      }
      if (!settingsOnboardSignerPubkey) {
        setSettingsOnboardError('Start the signer before creating an onboarding package.');
        return;
      }
      if (settingsOnboardDraft.packagePassword !== settingsOnboardDraft.confirmPackagePassword) {
        setSettingsOnboardError('Package passwords do not match.');
        return;
      }

      setSettingsOnboardBusy(true);
      setSettingsOnboardError(null);
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
        });
        setSettingsOnboardDraft((current) => ({
          ...current,
          sourcePackageText: '',
          sourcePackagePassword: '',
          packagePassword: '',
          confirmPackagePassword: '',
        }));
      } catch (error) {
        setSettingsOnboardError(formatUiError(error));
      } finally {
        setSettingsOnboardBusy(false);
      }
    },
    [selectedProfile, settingsOnboardDraft, settingsOnboardSignerPubkey],
  );

  const copySettingsOnboardPackage = React.useCallback(() => {
    if (!settingsOnboardResult?.packageText) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(settingsOnboardResult.packageText);
    }
  }, [settingsOnboardResult]);

  const saveSettingsOnboardPackage = React.useCallback(() => {
    if (!settingsOnboardResult?.packageText) return;
    const filename = buildProfileDownloadFilename(
      settingsOnboardResult.label,
      settingsOnboardResult.sharePublicKey ?? selectedProfile?.id ?? 'bfonboard',
      'bfonboard.txt',
    );
    void saveTextToFile(filename, settingsOnboardResult.packageText);
  }, [selectedProfile?.id, settingsOnboardResult]);

  const welcomeUnlockProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeUnlockProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeUnlockProfileId]);
  const welcomeDeleteProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeDeleteProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeDeleteProfileId]);
  // Other stored device partitions (from earlier browser sessions / closed
  // tabs) that hold profiles, excluding this tab's own instance. Computed once
  // per mount — the registry only changes via this tab's own writes.
  const resumeDevices = React.useMemo<WelcomeResumableDeviceModel[]>(() => {
    const currentId = getInstanceId();
    return readInstanceRegistry()
      .filter((record) => record.id !== currentId && record.profileCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => ({
        id: record.id,
        label: record.label ?? `Device ${record.id.slice(0, 8)}`,
        metaLabel: `${record.profileCount} profile${record.profileCount === 1 ? '' : 's'}`,
      }));
  }, []);

  // Adopt the selected partition's instance id into this tab, then reload so the
  // store re-hydrates from it.
  const resumeDevice = React.useCallback((deviceId: string) => {
    adoptInstanceId(deviceId);
    window.location.reload();
  }, []);
  const [operatorSettingsDraft, setOperatorSettingsDraft] = React.useState<OperatorSettingsDraft>(() =>
    buildOperatorSettingsDraft(selectedProfile),
  );

  React.useEffect(() => {
    setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
  }, [
    selectedProfile?.id,
    selectedProfile?.label,
    selectedProfile?.relays,
    selectedProfile?.signer_settings,
  ]);

  // The Settings form is dirty when the draft diverges from the saved profile
  // (transient newRelayUrl is ignored).
  const settingsDirty = React.useMemo(() => {
    const saved = buildOperatorSettingsDraft(selectedProfile);
    return (
      operatorSettingsDraft.signerName !== saved.signerName ||
      JSON.stringify(operatorSettingsDraft.relays) !== JSON.stringify(saved.relays) ||
      JSON.stringify(operatorSettingsDraft.signerSettings) !== JSON.stringify(saved.signerSettings)
    );
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

  // Dashboard navigation is now Paper-aligned: Dashboard and Permissions remain
  // routed panels, while Settings opens as a right-side sidebar.
  const requestDashboardTab = React.useCallback(
    (tab: 'signer' | 'permissions' | 'settings') => {
      if (tab === 'settings') {
        setSettingsSidebarOpen(true);
        store.setDashboardTab('settings');
        return;
      }
      if (settingsSidebarOpen && settingsDirty) {
        setPendingSettingsExit(tab);
        return;
      }
      setSettingsSidebarOpen(false);
      store.setDashboardTab(tab);
    },
    [store, settingsDirty, settingsSidebarOpen],
  );

  const requestSettingsSidebarClose = React.useCallback(() => {
    if (settingsDirty) {
      setPendingSettingsExit('close');
      return;
    }
    setSettingsSidebarOpen(false);
    if (store.activeDashboardTab === 'settings') {
      store.setDashboardTab('signer');
    }
  }, [settingsDirty, store]);

  const discardSettingsSidebarChanges = React.useCallback(() => {
    setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
    setSettingsSidebarOpen(false);
    const target = pendingSettingsExit;
    setPendingSettingsExit(null);
    store.setDashboardTab(target && target !== 'close' ? target : 'signer');
  }, [pendingSettingsExit, selectedProfile, store]);

  const closeSettingsDiscardDialog = React.useCallback(
    () => setPendingSettingsExit(null),
    [],
  );

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

  const run = React.useCallback(async (action: () => Promise<void> | void) => {
    try {
      setUiError(null);
      await action();
    } catch (error) {
      setUiError(formatUiError(error));
    }
  }, []);

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
      setReplaceShareError(formatUiError(error));
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
      store.startRotateKey();
    });
  }, [run, store]);

  const goToLanding = React.useCallback(() => {
    setUiError(null);
    setRecoveredKey(null);
    store.setActiveView('landing');
  }, [store]);

  const goToDashboard = React.useCallback(() => {
    setUiError(null);
    store.setActiveView('dashboard');
  }, [store]);

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
      } catch {
        setWelcomeUnlockError('Incorrect password. Please try again.');
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
          onNewKeyset={() => store.setActiveView('create-generate')}
          onImportProfile={() => store.startLoadImport()}
          onOnboard={() => store.setActiveView('onboard-connect')}
          resumeDevices={resumeDevices}
          onResumeDevice={resumeDevice}
        />
      );
    }

    return (
      <WelcomeReturningHero
        logoSrc="/igloo-paper-mark.png"
        layout={deriveWelcomeReturningLayout(store.profiles.length)}
        profiles={store.profiles.map(deriveWelcomeReturningProfile)}
        onUnlock={openWelcomeUnlock}
        onRotate={(profileId) => {
          store.selectProfile(profileId);
          store.setActiveView('rotate-connect');
        }}
        onRecover={(profileId) => {
          setRecoveredKey(null);
          store.startRecoverKey(profileId);
        }}
        onDelete={openWelcomeDelete}
        onNewKeyset={() => store.setActiveView('create-generate')}
        onImportProfile={() => store.startLoadImport()}
        onOnboard={() => store.setActiveView('onboard-connect')}
        resumeDevices={resumeDevices}
        onResumeDevice={resumeDevice}
      />
    );
  }

  function renderCreateGenerate() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={CREATE_FLOW_STEPS} active={0} />
          <PublicTaskTitle
            title="Create Keyset"
            description="Define the group profile for a new keyset. After generation, choose which share stays on this device, then distribute the rest."
          />
          {store.drafts.createForm.mode === 'new' ? (
            <CreateFlowGenerateCard
              groupName={store.drafts.createForm.groupName}
              threshold={store.drafts.createForm.threshold}
              count={store.drafts.createForm.count}
              privateKey={store.draftSecrets.createFormPrivateKey}
              onChangeForm={(field, value) => store.updateCreateForm(field, value)}
              onGenerate={() => void run(() => store.generateKeyset())}
              onBack={goToLanding}
            />
          ) : null}
          {store.profiles.length > 0 ? (
            <div className="igloo-button-row igloo-button-row-tight" role="group" aria-label="Keyset action mode">
              <Button
                type="button"
                size="sm"
                variant={store.drafts.createForm.mode === 'new' ? 'default' : 'secondary'}
                data-testid={CRITICAL_E2E_TEST_IDS.createModeNew}
                onClick={() => store.updateCreateForm('mode', 'new')}
              >
                New Keyset
              </Button>
              <Button
                type="button"
                size="sm"
                variant={store.drafts.createForm.mode === 'rotate' ? 'default' : 'secondary'}
                data-testid={CRITICAL_E2E_TEST_IDS.createModeRotate}
                onClick={() => store.updateCreateForm('mode', 'rotate')}
              >
                Rotate Existing
              </Button>
            </div>
          ) : null}
          {store.drafts.createForm.mode === 'rotate' ? (
            <RotateKeysetPanel
              sourceProfileId={store.drafts.rotationForm.sourceProfileId}
              availableProfiles={store.profiles.map((profile) => ({
                id: profile.id,
                label: `${profile.label || 'Unnamed device'} (${shortProfileId(profile.id)})`,
              }))}
              rotationSources={store.drafts.rotationForm.sources.map((source, index) => ({
                packageText: source.packageText,
                packagePassword: store.draftSecrets.rotationSources[index] ?? '',
              }))}
              onChangeSourceProfile={(profileId) => store.updateRotationForm('sourceProfileId', profileId)}
              onChangeRotationSource={(index, field, value) =>
                store.updateRotationSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
              }
              onAddRotationSource={() => store.addRotationSource()}
              onRemoveRotationSource={(index) => store.removeRotationSource(index)}
              onRotate={() => void run(() => store.generateKeyset())}
            />
          ) : null}
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateSelectShare() {
    if (!store.pendingKeyset) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={CREATE_FLOW_STEPS} active={1} />
          <PublicTaskTitle
            title="Select Share"
            description="Choose which share stays on this device. The group public key identifies the shared signer for every device."
          />
          <CreateFlowShareSelection
            shares={store.pendingKeyset.shares}
            selectedMemberIdx={store.selectedGeneratedShareIdx}
            keysetName={store.pendingKeyset.group_name}
            groupPublicKey={store.pendingKeyset.group_public_key}
            onSelectShare={(memberIdx) => store.selectGeneratedShare(memberIdx)}
            onCopyGroupPublicKey={() => {
              if (navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(store.pendingKeyset?.group_public_key ?? '');
              }
            }}
            onAction={() => void run(() => store.continueToSaveProfile())}
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
          <StepProgress steps={CREATE_FLOW_STEPS} active={2} />
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
            onAction={() => void run(() => store.acceptGeneratedProfile())}
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
      void run(() => store.finishSetup());
    };

    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={CREATE_FLOW_STEPS} active={3} />
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
                onStart={() => void run(() => store.startDistributionClient())}
                onStop={() => void run(() => store.stopDistributionClient())}
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
            onDistribute={(memberIdx, kind) => void run(() => store.distributeShare(memberIdx, kind))}
            onFinish={handleFinishSetup}
            onBack={() => store.setActiveView('create-save-profile')}
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
            title="Import Device Profile"
            description="Import an existing signing device using an encrypted backup."
          />
          <section className="igloo-flow-root">
            <ImportProfileEntry
              profileString={store.drafts.importProfileForm.profileString}
              password={store.draftSecrets.importProfileFormPassword}
              onProfileStringChange={(value) => store.updateImportProfileForm('profileString', value)}
              onPasswordChange={(value) => store.updateImportProfilePassword(value)}
              onNext={() => void run(() => store.loadBfProfile())}
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderLoadError() {
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={IMPORT_FLOW_STEPS} active={0} />
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Import Error"
            description="We couldn't import this profile backup. Resolve the issue below and try again."
          />
          <section className="igloo-flow-root">
            <div className="igloo-onboard-form">
              <WarningCard
                title="Import Failed"
                message={store.pendingLoadError ?? 'We couldn’t import this profile backup.'}
              />
              <div className="igloo-onboard-action-row">
                <Button type="button" onClick={() => store.clearLoadError()}>
                  Try Again
                </Button>
                <Button type="button" variant="secondary" onClick={goToLanding}>
                  Back to Welcome
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
    if (!store.pendingLoadConfirmation) return null;
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
              draft={{
                label: store.drafts.importSaveForm.label,
                relayUrls: store.drafts.importSaveForm.relayUrls,
                primarySecret: store.draftSecrets.importSaveFormPassword,
                secondarySecret: store.draftSecrets.importSaveFormConfirm,
              }}
              lockIdentity
              actionLabel="Launch Signer"
              onLabelChange={(value) => store.updateImportSaveForm('label', value)}
              onPrimarySecretChange={(value) => store.updateImportSavePassword('password', value)}
              onSecondarySecretChange={(value) => store.updateImportSavePassword('confirmPassword', value)}
              onRelaysChange={(relays) => store.updateImportSaveForm('relayUrls', relays.join('\n'))}
              onPingRelay={(url) => pingRelay(url)}
              onAction={() => void run(() => store.acceptPendingLoadConfirmation())}
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
              onConnect={() => void run(() => store.connectOnboardingPackage())}
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
    if (!store.pendingOnboardConnection) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={ONBOARD_FLOW_STEPS} active={2} />
          <PublicTaskTitle
            title="Save Profile"
            description="Name and protect this profile on the device before launching the signer."
          />
          <section className="igloo-flow-root">
            <CreateFlowProfileSetup
              draft={{
                label: store.drafts.onboardSaveForm.label,
                relayUrls: store.drafts.onboardSaveForm.relayUrls,
                primarySecret: store.draftSecrets.onboardSaveFormPassword,
                secondarySecret: store.draftSecrets.onboardSaveFormConfirm,
              }}
              lockIdentity
              lockName={false}
              actionLabel="Launch Signer"
              onLabelChange={(value) => store.updateOnboardSaveForm('label', value)}
              onPrimarySecretChange={(value) => store.updateOnboardSavePassword('password', value)}
              onSecondarySecretChange={(value) => store.updateOnboardSavePassword('confirmPassword', value)}
              onRelaysChange={(relays) => store.updateOnboardSaveForm('relayUrls', relays.join('\n'))}
              onPingRelay={(url) => pingRelay(url)}
              onAction={() => void run(() => store.finalizeOnboardedDevice())}
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
        title="Enter Onboarding Package"
        description="Import a valid onboarding package to replace this device's local share while keeping the same group public key and Group Profile."
        onBack={goToDashboard}
        backTooltip="Back to Settings"
        variant="bare"
      >
        <ReplaceSharePackageEntry
          packageText={store.drafts.rotateConnectForm.packageText}
          packagePassword={store.draftSecrets.rotateConnectFormPassword}
          onPackageTextChange={(value) => store.updateRotateConnectForm('packageText', value)}
          onPackagePasswordChange={(value) => store.updateRotateConnectPassword(value)}
          onScanQr={() => setReplaceShareQrOpen(true)}
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
            });
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
          description="The onboarding package could not be applied. Your current local share, group public key, and Group Profile were not changed."
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
        description="Validating the onboarding package and replacing this device's local share. The group public key and Group Profile stay the same."
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
            store.setDashboardTab('signer');
          }}
        />
      </HostFlowShell>
    );
  }

  function renderRecoverCollect() {
    const threshold = (() => {
      try {
        const group = selectedProfile?.group_package_json
          ? (JSON.parse(selectedProfile.group_package_json) as { threshold?: unknown })
          : null;
        return typeof group?.threshold === 'number' && group.threshold > 0 ? group.threshold : 2;
      } catch {
        return 2;
      }
    })();
    const sources = store.drafts.recoverKeyForm.sources;
    const collectedCount = 1 + sources.filter((source) => source.packageText.trim().length > 0).length;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={RECOVER_FLOW_STEPS} active={0} />
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Collect Shares"
            description="Collect enough existing source packages to recover this key. Once the threshold is met, you can reveal and export the recovered private key."
          />
          <section className="igloo-flow-root">
            <RecoverCollectSharesPanel
              sources={sources.map((source, index) => ({
                packageText: source.packageText,
                packagePassword: store.draftSecrets.recoverKeySources[index] ?? '',
              }))}
              threshold={threshold}
              collectedCount={collectedCount}
              onChangeSource={(index, field, value) =>
                store.updateRecoverSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
              }
              onAddSource={() => store.addRecoverSource()}
              onRemoveSource={(index) => store.removeRecoverSource(index)}
              onNext={() =>
                void run(async () => {
                  const recovered = await store.recoverKeyFromShares();
                  setRecoveredKey(recovered);
                })
              }
            />
          </section>
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderRecoverKey() {
    if (!recoveredKey) return null;
    return <RecoverPrivateKeyView recovered={recoveredKey} onClear={goToLanding} />;
  }

  function renderDashboardNav() {
    if (store.activeView !== 'dashboard') return undefined;
    const items: Array<{ key: 'signer' | 'permissions' | 'settings'; label: string; testId: string }> = [
      { key: 'signer', label: 'Dashboard', testId: CRITICAL_E2E_TEST_IDS.dashboardTabSigner },
      { key: 'permissions', label: 'Permissions', testId: CRITICAL_E2E_TEST_IDS.dashboardTabPermissions },
      { key: 'settings', label: 'Settings', testId: CRITICAL_E2E_TEST_IDS.dashboardTabSettings },
    ];
    return (
      <nav className="igloo-dashboard-nav" aria-label="Dashboard actions">
        {items.map((item) => {
          const active =
            item.key === 'settings'
              ? settingsSidebarOpen
              : !settingsSidebarOpen && store.activeDashboardTab === item.key;
          return (
            <button
              key={item.key}
              id={`operator-tab-${item.key}`}
              type="button"
              aria-pressed={active}
              data-testid={item.testId}
              className={active ? 'igloo-dashboard-nav-link is-active' : 'igloo-dashboard-nav-link'}
              onClick={() => requestDashboardTab(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    );
  }

  function renderDashboard() {
    const runtimeState = store.runtimeSnapshot?.active ? 'running' : 'stopped';
    const runtimeControlLabel = runtimeState === 'running' ? 'Stop Signer' : 'Start Signer';
    const signerView = deriveSignerDashboardView(selectedProfile, store.runtimeSnapshot, store.peerPermissionStates);
    const policyView = derivePolicyDashboardView(Boolean(store.runtimeSnapshot?.active), store.peerPermissionStates);
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

    return (
      <div data-testid={CRITICAL_E2E_TEST_IDS.dashboardRoot} className="space-y-6">
        {store.activeDashboardTab === 'permissions' && !settingsSidebarOpen ? (
          <div role="tabpanel" id="operator-panel-permissions" aria-labelledby="operator-tab-permissions">
            <OperatorPermissionsPanel
              view={policyView}
              onRefresh={() => void run(() => store.refreshSigner())}
              onClearAllPeerPermissions={() => void run(() => store.clearPeerPolicies())}
              onPeerPolicyOverrideChange={(pubkey, direction, method, value) =>
                void run(() => store.updatePeerPolicy(pubkey, direction, method, value === 'allow'))
              }
              peerClearAllLabel="Remove Overrides"
              peerDescription="Live outbound and inbound peer policy state for the active browser signer."
              peerEmptyText={
                store.runtimeSnapshot?.active
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
            onCopyShareKey={(format) => copyDashboardKey('share', signerView?.shareKey, format)}
            onPrimaryAction={() =>
              void run(() => (store.runtimeSnapshot?.active ? store.stopSigner() : store.startSigner()))
            }
            primaryActionVariant={store.runtimeSnapshot?.active ? 'destructive' : 'success'}
            onRefreshPeers={() => void run(() => store.refreshSigner())}
            refreshPeersDisabled={!store.runtimeSnapshot?.active}
            // Clearing the host-side log buffer requires an active session, so
            // only expose the control while the signer is running.
            onClearLogs={
              store.runtimeSnapshot?.active ? () => void run(() => store.clearLogs()) : undefined
            }
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
              store.setDashboardTab('signer');
            })
          }
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
            onAction: () => {
              setSettingsSidebarOpen(false);
              openExportModal('bfprofile');
            },
          }}
          exportShareAction={{
            title: 'Export Share',
            description: 'Password-protected bfshare package',
            actionLabel: 'Export',
            testId: CRITICAL_E2E_TEST_IDS.settingsCopyShare,
            variant: 'secondary',
            disabled: !selectedProfile,
            onAction: () => {
              setSettingsSidebarOpen(false);
              openExportModal('bfshare');
            },
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
    );
  }

  return (
    <PageLayout
      surface={isPaperWelcomeSurface(store) ? 'welcome' : 'default'}
      maxWidth={isPaperWelcomeSurface(store) ? 'max-w-none' : undefined}
      header={
        <AppHeader
          mode={deriveHeaderMode(store.activeView)}
          logoSrc="/igloo-paper-mark.png"
          taskLabel={deriveHeaderTaskLabel(store.activeView)}
          profileName={selectedProfile?.label}
          actions={renderDashboardNav()}
        />
      }
    >
      {renderError()}
      {renderRuntimeWarning()}
      <WelcomeUnlockModal
        open={Boolean(welcomeUnlockProfileId)}
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
        busy={settingsOnboardBusy}
        signerActive={Boolean(settingsOnboardSignerPubkey)}
        onDraftChange={(field, value) => {
          setSettingsOnboardDraft((current) => ({ ...current, [field]: value }));
          setSettingsOnboardError(null);
        }}
        onCreatePackage={(event) => void submitSettingsOnboardPackage(event)}
        onCopyPackage={settingsOnboardResult ? copySettingsOnboardPackage : undefined}
        onSavePackage={settingsOnboardResult ? saveSettingsOnboardPackage : undefined}
        onShowQrPackage={
          settingsOnboardResult ? () => setSettingsOnboardQrOpen(true) : undefined
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
      {store.activeView === 'landing' ? renderLanding() : null}
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
      {store.activeView === 'dashboard' ? renderDashboard() : null}
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
