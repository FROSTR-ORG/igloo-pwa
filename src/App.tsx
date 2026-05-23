import * as React from 'react';

import {
  AppHeader,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentCard,
  CreateFlowDistributionSection,
  CreateFlowGenerateCard,
  CreateFlowProfileSetup,
  CreateFlowReviewPanel,
  OnboardCompletePanel,
  OnboardFailedPanel,
  OnboardHandshakePanel,
  OnboardPackageEntry,
  RotateKeysetPanel,
  HostEntryTile,
  HostFlowShell,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  PageBackLink,
  ProfileConfirmationCard,
  PublicFocusFooter,
  PublicTaskShell,
  PublicTaskTitle,
  QrPayloadModal,
  StepProgress,
  Textarea,
  WelcomeEntryHero,
  WelcomeReturningHero,
  WelcomeUnlockModal,
  CRITICAL_E2E_TEST_IDS,
  type EventLogRowModel,
  type PeerPolicy,
  type PolicyDashboardViewModel,
  type SignerDashboardViewModel,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';
import { shortProfileId } from 'igloo-shared';

import { StoreProvider, useStore } from './lib/store';

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
      state: peer.can_sign ? 'warning' : peer.online ? 'online' : peer.known ? 'idle' : 'offline',
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
    publicKeyLabel: profile.group_public_key,
    shareLabel: profile.share_public_key,
    readinessLabel: deriveRuntimeSummaryLabel(runtimeSnapshot),
    relaySummary: runtimeSnapshot?.active ? 'Browser runtime connected' : 'Runtime stopped',
    peerRows: derivePwaPeers(peerPermissionStates, runtimeSnapshot?.runtime_status).map((peer) => ({
      id: peer.pubkey,
      alias: peer.alias,
      pubkey: peer.pubkey,
      state: peer.state,
      statusLabel: peer.statusLabel ?? peer.state,
      incomingAvailable: peer.incomingAvailable,
      outgoingAvailable: peer.outgoingAvailable,
      outgoingSpent: peer.outgoingSpent,
    })),
    pendingOperationRows: derivePendingOperations(runtimeSnapshot?.runtime_status),
    eventRows: toPwaEventRows(runtimeSnapshot?.runtime_log_lines),
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

function derivePaperCreatePeerPermissions(shares: Array<{ name: string; share_public_key: string }>) {
  return shares.map((share, index) => ({
    label: `Peer #${index}`,
    detail: formatWelcomeKey(share.share_public_key),
    enabled: ['sign', 'ecdh', 'ping', 'onboard'] as Array<'sign' | 'ecdh' | 'ping' | 'onboard'>,
  }));
}

function derivePaperOnboardSummary(preview: {
  label: string;
  group_package_json: string;
  share_package_json: string;
  relays: string[];
}) {
  const groupPackage = parseJsonObject(preview.group_package_json);
  const sharePackage = parseJsonObject(preview.share_package_json);
  const threshold = readNumber(groupPackage?.threshold, 2);
  const memberCount = Array.isArray(groupPackage?.members) ? groupPackage.members.length : 3;
  const shareIdx = readNumber(sharePackage?.idx, 0);
  const groupName = typeof groupPackage?.group_name === 'string' && groupPackage.group_name
    ? groupPackage.group_name
    : 'My Signing Key';

  return {
    groupName,
    thresholdLabel: `${threshold} of ${memberCount}`,
    shareLabel: `#${shareIdx} (Index ${shareIdx})`,
    peerPolicyCount: memberCount,
  };
}

function deriveWelcomeReturningLayout(profileCount: number) {
  if (profileCount === 1) return 'single';
  if (profileCount <= 3) return 'multi';
  return 'many';
}

function AppShell() {
  const store = useStore();
  const [uiError, setUiError] = React.useState<string | null>(null);
  const [welcomeUnlockProfileId, setWelcomeUnlockProfileId] = React.useState<string | null>(null);
  const [welcomeUnlockPassword, setWelcomeUnlockPassword] = React.useState('');
  const [welcomeUnlockError, setWelcomeUnlockError] = React.useState<string | null>(null);
  const [welcomeUnlockSubmitting, setWelcomeUnlockSubmitting] = React.useState(false);

  const selectedProfile = store.profiles.find((profile) => profile.id === store.selectedProfileId) ?? null;
  const welcomeUnlockProfile = React.useMemo<WelcomeReturningProfileModel | null>(() => {
    const profile = store.profiles.find((entry) => entry.id === welcomeUnlockProfileId);
    return profile ? deriveWelcomeReturningProfile(profile) : null;
  }, [store.profiles, welcomeUnlockProfileId]);
  const selectedShare =
    store.generatedKeyset?.shares.find((share) => share.member_idx === store.selectedGeneratedShareIdx) ?? null;
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
    return <div className="igloo-shell-alert">{uiError}</div>;
  }

  function renderRuntimeWarning() {
    if (!store.runtimeWarning) return null;
    return <div className="igloo-shell-alert">{store.runtimeWarning}</div>;
  }

  function renderLanding() {
    if (store.profiles.length === 0) {
      return (
        <WelcomeEntryHero
          logoSrc="/igloo-paper-mark.png"
          onNewKeyset={() => store.setActiveView('create-generate')}
          onImportProfile={() => store.startLoadChoice()}
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
        onNewKeyset={() => store.setActiveView('create-generate')}
        onImportProfile={() => store.startLoadChoice()}
        onOnboard={() => store.setActiveView('onboard-connect')}
      />
    );
  }

  function renderCreateGenerate() {
    return (
      <>
        <PublicTaskShell>
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <StepProgress steps={['Create Keyset', 'Setup Profile', 'Onboard Devices']} active={0} />
          <PublicTaskTitle
            title="Create New Keyset"
            description="Define the group profile for a new keyset. After generation, choose which share stays on this device, then distribute the rest."
          />
          {store.drafts.createForm.mode === 'new' ? (
            <CreateFlowGenerateCard
              groupName={store.drafts.createForm.groupName}
              threshold={store.drafts.createForm.threshold}
              count={store.drafts.createForm.count}
              onChangeForm={(field, value) => store.updateCreateForm(field, value)}
              onGenerate={() => void run(() => store.generateKeyset())}
            />
          ) : null}
          {store.profiles.length > 0 ? (
            <div className="igloo-button-row igloo-button-row-tight" role="group" aria-label="Keyset action mode">
              <Button
                type="button"
                size="sm"
                variant={store.drafts.createForm.mode === 'new' ? 'default' : 'secondary'}
                onClick={() => store.updateCreateForm('mode', 'new')}
              >
                New Keyset
              </Button>
              <Button
                type="button"
                size="sm"
                variant={store.drafts.createForm.mode === 'rotate' ? 'default' : 'secondary'}
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

  function renderCreateProfile() {
    if (!store.generatedKeyset) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={['Create Keyset', 'Setup Profile', 'Onboard Devices']} active={1} />
          <PageBackLink label="Back" onBack={() => store.setActiveView('create-generate')} />
          <PublicTaskTitle
            title="Create Profile"
            description="Choose which share stays on this device, then configure the local profile before distributing the rest."
          />
          <CreateFlowProfileSetup
            shares={store.generatedKeyset.shares}
            selectedMemberIdx={store.selectedGeneratedShareIdx}
            keysetName={store.generatedKeyset.group_name}
            peerPermissions={derivePaperCreatePeerPermissions(store.generatedKeyset.shares)}
            draft={{
              label: store.drafts.profileForm.label,
              relayUrls: store.drafts.profileForm.relayUrls,
              primarySecret: store.drafts.profileForm.password,
              secondarySecret: store.drafts.profileForm.confirmPassword,
            }}
            actionLabel="Continue to Review"
            onSelectShare={(memberIdx) => store.selectGeneratedShare(memberIdx)}
            onLabelChange={(value) => store.updateProfileForm('label', value)}
            onPrimarySecretChange={(value) => store.updateProfileForm('password', value)}
            onSecondarySecretChange={(value) => store.updateProfileForm('confirmPassword', value)}
            onRelayUrlsChange={(value) => store.updateProfileForm('relayUrls', value)}
            onAction={() => void run(() => store.reviewGeneratedProfile())}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateConfirm() {
    if (!store.generatedKeyset) return null;
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={['Create Keyset', 'Setup Profile', 'Onboard Devices']} active={1} />
          <PageBackLink label="Back" onBack={() => store.setActiveView('create-profile')} />
          <PublicTaskTitle
            title="Review Device Profile"
            description="Confirm the local profile details before this browser initializes the signer and prepares remote bfonboard packages."
          />
          <CreateFlowReviewPanel
            profileName={store.drafts.profileForm.label || selectedShare?.name || 'Device Profile'}
            sharePublicKey={selectedShare?.share_public_key ?? 'n/a'}
            groupPublicKey={store.generatedKeyset.group_public_key}
            relays={store.drafts.profileForm.relayUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)}
            actionLabel="Accept and Continue"
            onAccept={() => void run(() => store.acceptGeneratedProfile())}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderCreateDistribute() {
    if (!store.generatedKeyset || !store.distributionSession || !selectedProfile) return null;
    const remainingShares = store.generatedKeyset.shares.filter((share) =>
      store.distributionSession?.remaining_member_indices.includes(share.member_idx),
    );
    const distributionResults = Object.fromEntries(
      Object.entries(store.distributionSession?.results ?? {}).map(([memberIdx, result]) => [
        Number(memberIdx),
        {
          kind: result.kind,
          label: result.label,
          packageText: result.package_text,
        },
      ]),
    ) as Record<number, { kind: 'package_ready' | 'handoff_pending' | 'completed'; label: string; packageText?: string }>;
    const allDistributed = remainingShares.length > 0 && remainingShares.every((share) => distributionResults[share.member_idx]?.kind === 'completed');
    return (
      <>
        <PublicTaskShell>
          <StepProgress steps={['Create Keyset', 'Setup Profile', 'Onboard Devices']} active={1} />
          <PageBackLink label="Back" onBack={() => store.setActiveView('create-confirm')} />
          <PublicTaskTitle
            title={allDistributed ? 'Distribution Completion' : 'Distribute Shares'}
            description={
              allDistributed
                ? 'Track remote bfonboard packages as they are handed off. Finish once each target device is ready to adopt its fresh share.'
                : 'Create each remote bfonboard package by setting its password, then hand off the package and password by copy or QR.'
            }
          />
          <CreateFlowDistributionSection
            bannerKicker="How this step works"
            bannerDescription=""
            bannerPoints={[
              'Set password Saving a password creates the bfonboard package for that device.',
              'Distribute Copy package/password or show QR once the package exists.',
              'Complete Echo turns the row green, or mark distributed manually when handoff is done.',
            ]}
            sectionTitle="Remaining Shares"
            sectionDescription="Each share can be copied, shown as a QR package, or downloaded as a `bfonboard` file."
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
            onChangeDraft={(memberIdx, field, value) =>
              store.updateDistributionForm(
                memberIdx,
                field === 'packagePassword' ? 'password' : field,
                value,
              )
            }
            onDistribute={(memberIdx, kind) => void run(() => store.distributeShare(memberIdx, kind))}
            onFinish={() => store.finishDistribution()}
            localShare={selectedShare}
            localProfileName={selectedProfile.label || 'Igloo Web'}
          />
          <QrPayloadModal
            open={Boolean(store.distributionSession.qr_package)}
            onClose={() => store.closeQrPackage()}
            title="Onboarding Package QR"
            label={store.distributionSession.qr_package?.label}
            payload={store.distributionSession.qr_package?.package_text ?? ''}
          />
        </PublicTaskShell>
        <PublicFocusFooter />
      </>
    );
  }

  function renderLoadChoice() {
    return (
      <HostFlowShell
        title="Load Profile"
        description="Choose whether to import a full device profile or recover one from your protected share."
        onBack={goToLanding}
        backTooltip="Back to landing"
      >
        <section className="igloo-flow-root igloo-pwa-entry-shell">
          <div className="igloo-pwa-entry-grid igloo-pwa-entry-grid-two">
            <HostEntryTile
              kicker="Local Import"
              title="Import Profile"
              description="Load an existing device profile from a password-protected `bfprofile` string."
              actionLabel="Import Profile"
              tone="primary"
              onAction={() => store.startLoadImport()}
              icon={(
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M12 3 4 7v5c0 4.97 3.06 8.77 8 10 4.94-1.23 8-5.03 8-10V7l-8-4Z" />
                  <path d="M12 8v6m0 0 3-3m-3 3-3-3" />
                </svg>
              )}
            />
            <HostEntryTile
              kicker="Remote Recovery"
              title="Recover from Share"
              description="Use a password-protected `bfshare` string to download and decrypt the profile from its relays."
              actionLabel="Recover from Share"
              onAction={() => store.startRecoverFromShare()}
              icon={(
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M6 12a6 6 0 1 1 12 0c0 2.7-1.8 5-4.25 5.75L12 21l-1.75-3.25C7.8 17 6 14.7 6 12Z" />
                  <path d="M9.5 11.5h5M12 9v5" />
                </svg>
              )}
            />
          </div>
        </section>
      </HostFlowShell>
    );
  }

  function renderLoadImport() {
    return (
      <HostFlowShell
        title="Import Profile"
        description="Paste a password-protected `bfprofile` string and confirm the decoded device profile."
        onBack={() => store.startLoadChoice()}
        backTooltip="Back to load profile"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Import or recover', 'Review', 'Load device']} active={0} />
          <Card>
            <CardHeader>
              <CardTitle>Import a bfprofile</CardTitle>
              <CardDescription>Provide the encoded profile string and the password that decrypts it.</CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <label>
                bfprofile
                <Textarea
                  className="min-h-[112px]"
                  value={store.drafts.importProfileForm.profileString}
                  onChange={(event) => store.updateImportProfileForm('profileString', event.target.value)}
                  placeholder="Paste bfprofile1..."
                />
              </label>
              <label>
                Decryption Password
                <input
                  type="password"
                  value={store.drafts.importProfileForm.password}
                  onChange={(event) => store.updateImportProfileForm('password', event.target.value)}
                />
              </label>
              <div className="igloo-button-row">
                <Button type="button" size="sm" onClick={() => void run(() => store.loadBfProfile())}>
                  Inspect Profile
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
    );
  }

  function renderLoadRecover() {
    return (
      <HostFlowShell
        title="Recover from Share"
        description="Use a protected `bfshare` string and password to fetch and decrypt the remote profile."
        onBack={() => store.startLoadChoice()}
        backTooltip="Back to load profile"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Import or recover', 'Review', 'Load device']} active={0} />
          <Card>
            <CardHeader>
              <CardTitle>Recover a bfshare</CardTitle>
              <CardDescription>The share includes suggested relays that will be used to recover the profile.</CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <label>
                bfshare
                <Textarea
                  className="min-h-[112px]"
                  value={store.drafts.recoverProfileForm.shareString}
                  onChange={(event) => store.updateRecoverProfileForm('shareString', event.target.value)}
                  placeholder="Paste bfshare1..."
                />
              </label>
              <label>
                Decryption Password
                <input
                  type="password"
                  value={store.drafts.recoverProfileForm.password}
                  onChange={(event) => store.updateRecoverProfileForm('password', event.target.value)}
                />
              </label>
              <div className="igloo-button-row">
                <Button type="button" size="sm" onClick={() => void run(() => store.recoverProfileFromShare())}>
                  Recover Profile
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
    );
  }

  function renderLoadConfirm() {
    if (!store.pendingLoadConfirmation) return null;
    return (
      <HostFlowShell
        title="Confirm Profile"
        description="Review the decoded profile information before loading this device."
        onBack={() => store.setActiveView(store.pendingLoadConfirmation?.kind === 'bfprofile' ? 'load-import' : 'load-recover')}
        backTooltip="Back"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Import or recover', 'Review', 'Load device']} active={1} />
          <ProfileConfirmationCard
            title="Review Loaded Profile"
            profileName={store.pendingLoadConfirmation.preview.label}
            sharePublicKey={store.pendingLoadConfirmation.preview.share_public_key}
            groupPublicKey={store.pendingLoadConfirmation.preview.group_public_key}
            relays={store.pendingLoadConfirmation.preview.relays}
          />
          <section className="igloo-task-banner">
            <span className="igloo-task-kicker">Load device</span>
            <p>
              If these details are correct, accept the profile and move directly into the device dashboard.
            </p>
          </section>
          <div className="igloo-button-row">
            <Button type="button" size="sm" onClick={() => void run(() => store.acceptPendingLoadConfirmation())}>
              Accept and Load Device
            </Button>
          </div>
        </section>
      </HostFlowShell>
    );
  }

  function renderOnboardConnect() {
    return (
      <>
        <PublicTaskShell>
          <PageBackLink label="Back to Welcome" onBack={goToLanding} />
          <PublicTaskTitle
            title="Enter Onboarding Package"
            description="Import a valid onboarding package to receive this device's share."
          />
          <section className="igloo-flow-root">
            <OnboardPackageEntry
              packageText={store.drafts.onboardConnectForm.packageText}
              password={store.drafts.onboardConnectForm.password}
              onPackageTextChange={(value) => store.updateOnboardConnectForm('packageText', value)}
              onPasswordChange={(value) => store.updateOnboardConnectForm('password', value)}
              onConnect={() => void run(() => store.connectOnboardingPackage())}
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
          <section className="igloo-flow-root">
            <OnboardHandshakePanel
              packageText={store.drafts.onboardConnectForm.packageText}
              keysetName="My Signing Key"
              thresholdLabel="2/3"
              activeStep="applying"
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
          <PublicTaskTitle
            title="Onboarding Failed"
            description={null}
          />
          <section className="igloo-flow-root">
            <OnboardFailedPanel
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
    const preview = store.pendingOnboardConnection.preview;
    const paperSummary = derivePaperOnboardSummary(preview);
    return (
      <>
        <PublicTaskShell>
          <section className="igloo-flow-root">
            <OnboardCompletePanel
              preview={{
                label: preview.label,
                sharePublicKey: preview.share_public_key,
                groupPublicKey: preview.group_public_key,
                relays: preview.relays,
              }}
              groupName={paperSummary.groupName}
              thresholdLabel={paperSummary.thresholdLabel}
              shareLabel={paperSummary.shareLabel}
              peerPolicyCount={paperSummary.peerPolicyCount}
              draft={store.drafts.onboardSaveForm}
              onLabelChange={(value) => store.updateOnboardSaveForm('label', value)}
              onPasswordChange={(value) => store.updateOnboardSaveForm('password', value)}
              onConfirmPasswordChange={(value) => store.updateOnboardSaveForm('confirmPassword', value)}
              onSave={() => void run(() => store.finalizeOnboardedDevice())}
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
                  value={store.drafts.rotateConnectForm.packageText}
                  onChange={(event) => store.updateRotateConnectForm('packageText', event.target.value)}
                  placeholder="Paste bfonboard1..."
                />
              </label>
              <label>
                Package Password
                <input
                  type="password"
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

  function renderDashboard() {
    const runtimeState = store.runtimeSnapshot?.active ? 'running' : 'stopped';
    const runtimeControlLabel = runtimeState === 'running' ? 'Stop Signer' : 'Start Signer';
    const signerView = deriveSignerDashboardView(selectedProfile, store.runtimeSnapshot, store.peerPermissionStates);
    const policyView = derivePolicyDashboardView(Boolean(store.runtimeSnapshot?.active), store.peerPermissionStates);

    return (
      <ContentCard
        title={selectedProfile ? `Device Dashboard · ${selectedProfile.label} (${shortProfileId(selectedProfile.id)})` : 'Device Dashboard'}
        description="Chrome-style operator console for the active browser signer profile."
      >
        <div className="space-y-6">
          <OperatorDashboardTabs
            tabs={[
              { key: 'signer', label: 'Signer', description: 'runtime console' },
              { key: 'permissions', label: 'Permissions', description: 'peer policies' },
              { key: 'settings', label: 'Settings', description: 'operator controls' },
            ]}
            activeTab={store.activeDashboardTab}
            onChangeTab={store.setDashboardTab}
          />

          {store.activeDashboardTab === 'signer' ? (
            <div role="tabpanel" id="operator-panel-signer" aria-labelledby="operator-tab-signer">
              <OperatorSignerPanel
                view={signerView}
                introMessage="The browser signer runs locally inside the PWA workbench. This dashboard mirrors the operator workflow used by igloo-chrome."
                emptyDescription="Load or onboard a device profile before opening the signer dashboard."
                runtimeControlLabel={runtimeControlLabel}
                onPrimaryAction={() =>
                  void run(() => (store.runtimeSnapshot?.active ? store.stopSigner() : store.startSigner()))
                }
                primaryActionVariant={store.runtimeSnapshot?.active ? 'destructive' : 'success'}
                onRefreshPeers={() => void run(() => store.refreshSigner())}
                refreshPeersDisabled={!store.runtimeSnapshot?.active}
              />
            </div>
          ) : null}

          {store.activeDashboardTab === 'permissions' ? (
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
                maintenanceDescription="Browser package export, share rotation, and session controls."
                maintenanceActions={[
                  {
                    label: 'copy profile',
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onClick: () =>
                      void run(async () => {
                        if (!selectedProfile) return;
                        await store.copyProfilePackage(selectedProfile.id, 'bfprofile');
                      }),
                  },
                  {
                    label: 'copy share',
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onClick: () =>
                      void run(async () => {
                        if (!selectedProfile) return;
                        await store.copyProfilePackage(selectedProfile.id, 'bfshare');
                      }),
                  },
                  {
                    label: 'rotate share',
                    testId: CRITICAL_E2E_TEST_IDS.maintenanceRotateShare,
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onClick: () =>
                      void run(() => {
                        store.startRotateKey();
                      }),
                  },
                  {
                    label: 'logout',
                    variant: 'outline',
                    disabled: !selectedProfile,
                    onClick: () => void run(() => store.logout()),
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
      </ContentCard>
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
      {store.activeView === 'landing' ? renderLanding() : null}
      {store.activeView === 'create-generate' ? renderCreateGenerate() : null}
      {store.activeView === 'create-profile' ? renderCreateProfile() : null}
      {store.activeView === 'create-confirm' ? renderCreateConfirm() : null}
      {store.activeView === 'create-distribute' ? renderCreateDistribute() : null}
      {store.activeView === 'load-choice' ? renderLoadChoice() : null}
      {store.activeView === 'load-import' ? renderLoadImport() : null}
      {store.activeView === 'load-recover' ? renderLoadRecover() : null}
      {store.activeView === 'load-confirm' ? renderLoadConfirm() : null}
      {store.activeView === 'onboard-connect' ? renderOnboardConnect() : null}
      {store.activeView === 'onboard-handshake' ? renderOnboardHandshake() : null}
      {store.activeView === 'onboard-failed' ? renderOnboardFailed() : null}
      {store.activeView === 'onboard-save' ? renderOnboardSave() : null}
      {store.activeView === 'rotate-connect' ? renderRotateConnect() : null}
      {store.activeView === 'rotate-save' ? renderRotateSave() : null}
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
