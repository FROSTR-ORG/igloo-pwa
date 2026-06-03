import * as React from 'react';

import {
  Alert,
  AppHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentCard,
  CreateFlowDistributionSection,
  ConfirmModal,
  CreateFlowGenerateCard,
  CreateFlowProfileSetup,
  CreateFlowShareSelection,
  ImportProfileEntry,
  OnboardFailedPanel,
  OnboardHandshakePanel,
  OnboardingClientCard,
  OnboardPackageEntry,
  RecoverCollectSharesPanel,
  RotateKeysetPanel,
  WarningCard,
  HostFlowShell,
  OperatorPermissionsPanel,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  PageBackLink,
  PasswordField,
  ProfileConfirmationCard,
  ExportPackageModal,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  QrPayloadModal,
  StepProgress,
  Textarea,
  WelcomeEntryHero,
  WelcomeReturningHero,
  WelcomeDeleteModal,
  WelcomeUnlockModal,
  CRITICAL_E2E_TEST_IDS,
  observabilityEventsToEventRows,
  passwordManagerOptOutProps,
  type DashboardKeyModel,
  type EventLogRowModel,
  type PeerPolicy,
  type SharedDistributionResult,
  type PolicyDashboardViewModel,
  type SignerDashboardViewModel,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';
import { pingRelay, shortProfileId } from 'igloo-shared';
import * as nip49 from 'nostr-tools/nip49';
import { deriveExportSummary, deriveMemberLabel, toDashboardKey } from './lib/dashboard-view';
import { saveTextToFile } from './lib/file-save';

import { StoreProvider, useStore } from './lib/store';

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
  runtimeStatus: unknown,
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

  const summary = (runtimeStatus ?? null) as PwaRuntimeStatus | null;
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
  const readiness = (runtimeSnapshot.readiness ?? null) as PwaRuntimeReadiness | null;
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
    memberLabel: deriveMemberLabel(profile.share_package_json),
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
  if (activeView.startsWith('rotate')) return 'Rotate';
  if (activeView.startsWith('onboard')) return 'Onboard';
  if (activeView.startsWith('load')) return 'Import';
  return 'Installable browser workspace';
}

function deriveWelcomeReturningProfile(profile: ReturnType<typeof useStore>['profiles'][number]) {
  const groupPackage = parseJsonObject(profile.group_package_json);
  const sharePackage = parseJsonObject(profile.share_package_json);
  const threshold = typeof groupPackage?.threshold === 'number' ? groupPackage.threshold : 2;
  const memberCount = Array.isArray(groupPackage?.members) ? groupPackage.members.length : 3;
  const memberIdx =
    typeof sharePackage?.idx === 'number'
      ? sharePackage.idx
      : typeof sharePackage?.idx === 'string'
        ? Number.parseInt(sharePackage.idx, 10)
        : 0;

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

function deriveWelcomeReturningLayout(profileCount: number) {
  if (profileCount === 1) return 'single';
  if (profileCount <= 3) return 'multi';
  return 'many';
}

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

  // Unsaved-changes guard for the Settings tab: tracks the pending nav target while
  // the confirm modal is open.
  const [pendingSettingsNav, setPendingSettingsNav] = React.useState<'signer' | 'permissions' | 'settings' | null>(null);

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

  const welcomeUnlockProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeUnlockProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeUnlockProfileId]);
  const welcomeDeleteProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeDeleteProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeDeleteProfileId]);
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

  // Guarded dashboard-tab nav: leaving the Settings tab with unsaved edits opens
  // the Unsaved-Changes confirm modal instead of navigating immediately.
  const requestDashboardTab = React.useCallback(
    (tab: 'signer' | 'permissions' | 'settings') => {
      if (store.activeDashboardTab === 'settings' && tab !== 'settings' && settingsDirty) {
        setPendingSettingsNav(tab);
        return;
      }
      store.setDashboardTab(tab);
    },
    [store, settingsDirty],
  );

  const run = React.useCallback(async (action: () => Promise<void> | void) => {
    try {
      setUiError(null);
      await action();
    } catch (error) {
      setUiError(formatUiError(error));
    }
  }, []);

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

  function renderLanding() {
    if (store.profiles.length === 0) {
      return (
        <WelcomeEntryHero
          logoSrc="/igloo-paper-mark.png"
          onNewKeyset={() => store.setActiveView('create-generate')}
          onImportProfile={() => store.startLoadImport()}
          onOnboard={() => store.setActiveView('onboard-connect')}
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
              privateKey={store.drafts.createForm.privateKey}
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
              rotationSources={store.drafts.rotationForm.sources.map((source) => ({
                packageText: source.packageText,
                packagePassword: source.password,
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
    if (!store.generatedKeyset) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={CREATE_FLOW_STEPS} active={1} />
          <PublicTaskTitle
            title="Select Share"
            description="Choose which share stays on this device. The group public key identifies the shared signer for every device."
          />
          <CreateFlowShareSelection
            shares={store.generatedKeyset.shares}
            selectedMemberIdx={store.selectedGeneratedShareIdx}
            keysetName={store.generatedKeyset.group_name}
            groupPublicKey={store.generatedKeyset.group_public_key}
            onSelectShare={(memberIdx) => store.selectGeneratedShare(memberIdx)}
            onCopyGroupPublicKey={() => {
              if (navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(store.generatedKeyset?.group_public_key ?? '');
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
    if (!store.generatedKeyset) return null;
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
              primarySecret: store.drafts.profileForm.password,
              secondarySecret: store.drafts.profileForm.confirmPassword,
            }}
            actionLabel="Next Step"
            onLabelChange={(value) => store.updateProfileForm('label', value)}
            onPrimarySecretChange={(value) => store.updateProfileForm('password', value)}
            onSecondarySecretChange={(value) => store.updateProfileForm('confirmPassword', value)}
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
    if (!store.generatedKeyset || !store.distributionSession || !selectedProfile) return null;
    const session = store.distributionSession;
    const remainingShares = store.generatedKeyset.shares.filter((share) =>
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
              Object.entries(store.drafts.distributionForms).map(([memberIdx, form]) => [
                Number(memberIdx),
                {
                  label: form.label,
                  packagePassword: form.password,
                  confirmPassword: form.confirmPassword,
                },
              ]),
            )}
            results={distributionResults}
            permissions={store.drafts.distributionPermissions}
            onTogglePermission={(memberIdx, permission, enabled) =>
              void run(() => store.updateDistributionPermission(memberIdx, permission, enabled))
            }
            onChangeDraft={(memberIdx, field, value) =>
              store.updateDistributionForm(
                memberIdx,
                field === 'packagePassword' ? 'password' : field,
                value,
              )
            }
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
              password={store.drafts.importProfileForm.password}
              onProfileStringChange={(value) => store.updateImportProfileForm('profileString', value)}
              onPasswordChange={(value) => store.updateImportProfileForm('password', value)}
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
                primarySecret: store.drafts.importSaveForm.password,
                secondarySecret: store.drafts.importSaveForm.confirmPassword,
              }}
              lockIdentity
              actionLabel="Launch Signer"
              onLabelChange={(value) => store.updateImportSaveForm('label', value)}
              onPrimarySecretChange={(value) => store.updateImportSaveForm('password', value)}
              onSecondarySecretChange={(value) => store.updateImportSaveForm('confirmPassword', value)}
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
              password={store.drafts.onboardConnectForm.password}
              onPackageTextChange={(value) => store.updateOnboardConnectForm('packageText', value)}
              onPasswordChange={(value) => store.updateOnboardConnectForm('password', value)}
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
                primarySecret: store.drafts.onboardSaveForm.password,
                secondarySecret: store.drafts.onboardSaveForm.confirmPassword,
              }}
              lockIdentity
              lockName={false}
              actionLabel="Launch Signer"
              onLabelChange={(value) => store.updateOnboardSaveForm('label', value)}
              onPrimarySecretChange={(value) => store.updateOnboardSaveForm('password', value)}
              onSecondarySecretChange={(value) => store.updateOnboardSaveForm('confirmPassword', value)}
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
        title="Rotate Key"
        description="Connect with a rotated onboarding package and prepare to replace the active device share."
        onBack={goToDashboard}
        backTooltip="Back to dashboard"
      >
        <section className="igloo-flow-root igloo-stack">
          <ProfileConfirmationCard
            title="Current Device"
            profileName={selectedProfile.label}
            sharePublicKey={selectedProfile.share_public_key}
            groupPublicKey={selectedProfile.group_public_key}
            relays={selectedProfile.relays}
          />
          <Card>
            <CardHeader>
              <CardTitle>Connect Rotated bfonboard</CardTitle>
              <CardDescription>Use a rotated onboarding package to replace this device while keeping the same keyset identity.</CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <label>
                bfonboard
                <Textarea
                  className="min-h-[112px]"
                  data-testid={CRITICAL_E2E_TEST_IDS.rotationPackageInput}
                  value={store.drafts.rotateConnectForm.packageText}
                  onChange={(event) => store.updateRotateConnectForm('packageText', event.target.value)}
                  placeholder="Paste bfonboard1..."
                />
              </label>
              <label>
                Package Password
                <input
                  type="password"
                  {...passwordManagerOptOutProps}
                  data-testid={CRITICAL_E2E_TEST_IDS.rotationPasswordInput}
                  value={store.drafts.rotateConnectForm.password}
                  onChange={(event) => store.updateRotateConnectForm('password', event.target.value)}
                />
              </label>
              <div className="igloo-button-row">
                <Button
                  type="button"
                  size="sm"
                  data-testid={CRITICAL_E2E_TEST_IDS.rotationConnectSubmit}
                  onClick={() => void run(() => store.connectRotationPackage())}
                >
                  Connect Rotation Package
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
    );
  }

  function renderRotateSave() {
    if (!store.pendingRotationConnection || !selectedProfile) return null;
    return (
      <HostFlowShell
        title="Confirm Rotated Device"
        description="Review the replacement device details before replacing the active local profile."
        onBack={() => store.setActiveView('rotate-connect')}
        backTooltip="Back to connect"
      >
        <section className="igloo-flow-root igloo-stack">
          <ProfileConfirmationCard
            title="Replacement Preview"
            profileName={selectedProfile.label}
            sharePublicKey={store.pendingRotationConnection.preview.share_public_key}
            groupPublicKey={store.pendingRotationConnection.preview.group_public_key}
            relays={store.pendingRotationConnection.preview.relays}
          />
          <section className="igloo-task-banner">
            <span className="igloo-task-kicker">Same keyset, fresh device share</span>
            <p>This replacement keeps the same group public key and replaces this device with a new share and profile id.</p>
          </section>
          <div className="igloo-button-row">
            <Button
              type="button"
              size="sm"
              data-testid={CRITICAL_E2E_TEST_IDS.rotationConfirmSubmit}
              onClick={() => void run(() => store.finalizeRotationUpdate())}
            >
              Replace Active Device
            </Button>
          </div>
        </section>
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
              sources={sources.map((source) => ({
                packageText: source.packageText,
                packagePassword: source.password,
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
      <nav className="igloo-dashboard-nav" aria-label="Dashboard sections">
        {items.map((item) => {
          const active = store.activeDashboardTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
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

    return (
      <div data-testid={CRITICAL_E2E_TEST_IDS.dashboardRoot} className="space-y-6">
          {store.activeDashboardTab === 'signer' ? (
            <div role="tabpanel" id="operator-panel-signer" aria-labelledby="operator-tab-signer">
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
            </div>
          ) : null}

          {store.activeDashboardTab === 'permissions' ? (
            <div role="tabpanel" id="operator-panel-permissions" aria-labelledby="operator-tab-permissions">
              <OperatorPermissionsPanel
                view={policyView}
                showPeerSummary={false}
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
          ) : null}

          {store.activeDashboardTab === 'settings' ? (
            <div role="tabpanel" id="operator-panel-settings" aria-labelledby="operator-tab-settings">
              <OperatorSettingsPanel
                hasProfile={Boolean(selectedProfile)}
                signerName={operatorSettingsDraft.signerName}
                onSignerNameChange={(value) =>
                  setOperatorSettingsDraft((current) => ({ ...current, signerName: value }))
                }
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
                  void run(() =>
                    store.saveOperatorSettings({
                      label: operatorSettingsDraft.signerName,
                      relays: operatorSettingsDraft.relays,
                      signerSettings: operatorSettingsDraft.signerSettings,
                    }),
                  )
                }
                saveDisabled={!selectedProfile || !store.runtimeSnapshot?.active}
                message={
                  store.runtimeSnapshot?.active ? null : 'Start the signer to apply settings live.'
                }
                sections={[
                  {
                    title: 'Replace Share',
                    description:
                      "Import a bfonboard package to replace only this device's local share while keeping the same group public key and profile.",
                    actionLabel: 'Replace Share',
                    testId: CRITICAL_E2E_TEST_IDS.maintenanceRotateShare,
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onAction: () =>
                      void run(() => {
                        store.startRotateKey();
                      }),
                  },
                  {
                    title: 'Export Profile',
                    description: 'Encrypted backup of your share and configuration.',
                    actionLabel: 'Export Profile',
                    testId: CRITICAL_E2E_TEST_IDS.settingsCopyProfile,
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onAction: () => openExportModal('bfprofile'),
                  },
                  {
                    title: 'Export Share',
                    description: 'Password-protected bfshare package.',
                    actionLabel: 'Export Share',
                    testId: CRITICAL_E2E_TEST_IDS.settingsCopyShare,
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onAction: () => openExportModal('bfshare'),
                  },
                  {
                    title: 'Logout',
                    description: 'Return to the profile list to open another profile.',
                    actionLabel: 'Logout',
                    testId: CRITICAL_E2E_TEST_IDS.settingsLogout,
                    variant: 'outline',
                    disabled: !selectedProfile,
                    onAction: () => void run(() => store.logout()),
                  },
                ]}
                extraSections={
                  <ContentCard
                    title="Browser Settings"
                    description="PWA-specific preferences for persistence, routing, and install prompting."
                  >
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
                  </ContentCard>
                }
              />
            </div>
          ) : null}
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
      <ConfirmModal
        isOpen={Boolean(pendingSettingsNav)}
        variant="warning"
        title="Discard unsaved changes?"
        message="You have unsaved changes in Settings. Close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
          if (pendingSettingsNav) store.setDashboardTab(pendingSettingsNav);
          setPendingSettingsNav(null);
        }}
        onCancel={() => setPendingSettingsNav(null)}
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
