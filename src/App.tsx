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
  CreateFlowDistributionCards,
  CreateFlowGenerateCard,
  CreateFlowLocalSaveCard,
  CreateFlowReviewPanel,
  CreateFlowSharePicker,
  CreateFlowTaskBanner,
  HostEntryTile,
  HostFlowShell,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  ProfileConfirmationCard,
  QrPayloadModal,
  StepProgress,
  StoredProfilesLandingCard,
  Textarea,
  type LogEntry,
  type PeerPolicy,
} from 'igloo-ui';
import { shortProfileId } from 'igloo-shared';

import { StoreProvider, useStore } from './lib/store';

function toPwaLogEntries(lines: string[] = []): LogEntry[] {
  return lines.map((line, index) => ({
    id: `pwa-log-${index}-${line}`,
    time: 'live',
    level: line.startsWith('[error]') ? 'ERROR' : line.startsWith('[warn]') ? 'WARN' : 'INFO',
    message: line.replace(/^\[[^\]]+\]\s*/, ''),
    data: { raw: line },
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
    request_id: operation.request_id,
    op_type: operation.op_type,
    threshold: operation.threshold,
    started_at: operation.started_at,
    timeout_at: operation.timeout_at,
    collected_responses: Array.isArray(operation.collected_responses) ? operation.collected_responses.length : 0,
    target_peers: Array.isArray(operation.target_peers) ? operation.target_peers : [],
  }));
}

function deriveActivationStage(runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot']) {
  if (!runtimeSnapshot?.active) return 'idle';
  const readiness = (runtimeSnapshot.readiness ?? null) as PwaRuntimeReadiness | null;
  if (!readiness) return 'running';
  if (!readiness.restore_complete) return 'restoring';
  if (readiness.sign_ready && readiness.ecdh_ready) return 'ready';
  if (readiness.sign_ready) return 'sign-ready';
  if (readiness.ecdh_ready) return 'ecdh-ready';
  if (readiness.runtime_ready) return 'runtime-ready';
  return 'degraded';
}

function deriveActivationUpdatedAt(runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot']) {
  const readiness = (runtimeSnapshot?.readiness ?? null) as PwaRuntimeReadiness | null;
  if (typeof readiness?.last_refresh_at === 'number') {
    return readiness.last_refresh_at > 10_000_000_000
      ? readiness.last_refresh_at
      : readiness.last_refresh_at * 1000;
  }
  const summary = (runtimeSnapshot?.runtime_status ?? null) as PwaRuntimeStatus | null;
  const lastActive = summary?.status?.last_active;
  if (typeof lastActive === 'number') {
    return lastActive > 10_000_000_000 ? lastActive : lastActive * 1000;
  }
  return null;
}

function deriveRuntimeSummaryLabel(runtimeSnapshot: ReturnType<typeof useStore>['runtimeSnapshot']) {
  if (!runtimeSnapshot?.active) return 'Signer Stopped';
  const readiness = (runtimeSnapshot.readiness ?? null) as PwaRuntimeReadiness | null;
  if (readiness && (!readiness.sign_ready || !readiness.ecdh_ready || !readiness.restore_complete)) {
    return 'Signer Running (Degraded)';
  }
  return 'Signer Running';
}

function AppShell() {
  const store = useStore();
  const [uiError, setUiError] = React.useState<string | null>(null);

  const selectedProfile = store.profiles.find((profile) => profile.id === store.selectedProfileId) ?? null;
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

  function renderError() {
    if (!uiError) return null;
    return <div className="igloo-shell-alert">{uiError}</div>;
  }

  function renderLanding() {
    return (
      <ContentCard title="Welcome to Igloo" description="Choose one path to initialize this browser workspace.">
        <section className="igloo-flow-root igloo-pwa-entry-shell">
          <div className="igloo-pwa-entry-intro">
            <p className="igloo-pwa-entry-lead">
              Create or rotate a keyset, load an existing profile, or finish onboarding a device from an accepted package.
            </p>
          </div>
          <StoredProfilesLandingCard
            profiles={store.profiles.map((profile) => ({
              id: profile.id,
              label: profile.label || 'Unnamed device',
              subtitle: shortProfileId(profile.id),
            }))}
            onAction={(profileId) => void run(() => store.loadStoredProfile(profileId))}
          />
          <div className="igloo-pwa-entry-grid">
            <HostEntryTile
              kicker="Fresh Setup"
              title="Create / Rotate Keyset"
              description="Generate a new keyset or rotate an existing one, create one local device profile, and distribute the remaining shares."
              actionLabel="Start"
              tone="primary"
              onAction={() => store.setActiveView('create-generate')}
              icon={(
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M7 10a5 5 0 1 1 9.74 1.58L21 15v2h-2v2h-2v2h-3v-3.17a5 5 0 0 1-7-4.83Z" />
                  <circle cx="10" cy="10" r="1.25" />
                </svg>
              )}
            />
            <HostEntryTile
              kicker="Existing Material"
              title="Load Profile"
              description="Import a `bfprofile` string or recover your device profile from a password-protected `bfshare`."
              actionLabel="Load Profile"
              onAction={() => store.startLoadChoice()}
              icon={(
                <svg viewBox="0 0 24 24" role="presentation">
                  <path d="M12 3 4 7v5c0 4.97 3.06 8.77 8 10 4.94-1.23 8-5.03 8-10V7l-8-4Z" />
                  <path d="M12 8v6m0 0 3-3m-3 3-3-3" />
                </svg>
              )}
            />
            <HostEntryTile
              kicker="Accepted Invite"
              title="Onboard Device"
              description="Connect with a password-protected `bfonboard` package, confirm the profile data, and save this device."
              actionLabel="Continue Onboarding"
              onAction={() => store.setActiveView('onboard-connect')}
              icon={(
                <svg viewBox="0 0 24 24" role="presentation">
                  <rect x="6" y="3" width="12" height="18" rx="2" />
                  <path d="M9 8h6M9 12h6M12 16h.01" />
                </svg>
              )}
            />
          </div>
        </section>
      </ContentCard>
    );
  }

  function renderCreateGenerate() {
    return (
      <HostFlowShell
        title="Create / Rotate Keyset"
        description="Step 1 of 4 · create a new keyset or rotate an existing one before selecting the local device share."
        onBack={goToLanding}
        backTooltip="Back to landing"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={0} />
          <CreateFlowTaskBanner
            kicker="Create or Rotate"
            description="Provide the group name and threshold geometry, then either create fresh shares or rebuild from threshold bfshare inputs."
            points={[
              'Threshold defaults to 2, total keys defaults to 3.',
              'Rotation preserves the same group public key and issues fresh device shares.',
            ]}
          />
          <CreateFlowGenerateCard
            form={{
              ...store.drafts.createForm,
              sourceProfileId: store.drafts.rotationForm.sourceProfileId,
            }}
            availableProfiles={store.profiles.map((profile) => ({
              id: profile.id,
              label: `${profile.label || 'Unnamed device'} (${shortProfileId(profile.id)})`,
            }))}
            rotationSources={store.drafts.rotationForm.sources.map((source) => ({
              packageText: source.packageText,
              packagePassword: source.password,
            }))}
            onChangeForm={(field, value) => {
              if (field === 'sourceProfileId') {
                store.updateRotationForm('sourceProfileId', value);
                return;
              }
              store.updateCreateForm(field, value);
            }}
            onChangeRotationSource={(index, field, value) =>
              store.updateRotationSource(index, field === 'packagePassword' ? 'password' : 'packageText', value)
            }
            onAddRotationSource={() => store.addRotationSource()}
            onRemoveRotationSource={(index) => store.removeRotationSource(index)}
            onGenerate={() => void run(() => store.generateKeyset())}
          />
        </section>
      </HostFlowShell>
    );
  }

  function renderCreateProfile() {
    if (!store.generatedKeyset) return null;
    return (
      <HostFlowShell
        title="Create Device Profile"
        description="Step 2 of 3 · choose one share for this device and enter the local profile details."
        onBack={() => store.setActiveView('create-generate')}
        backTooltip="Back to keyset generation"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={1} />
          <Card>
            <CardHeader>
              <CardTitle>Select the Device Share</CardTitle>
              <CardDescription>Choose which generated share should become the local signing device.</CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <CreateFlowSharePicker
                shares={store.generatedKeyset.shares}
                selectedMemberIdx={store.selectedGeneratedShareIdx}
                onSelect={(memberIdx) => store.selectGeneratedShare(memberIdx)}
              />
              {selectedShare ? (
                <CreateFlowLocalSaveCard
                  share={selectedShare}
                  draft={{
                    label: store.drafts.profileForm.label,
                    relayUrls: store.drafts.profileForm.relayUrls,
                    primarySecret: store.drafts.profileForm.password,
                    secondarySecret: store.drafts.profileForm.confirmPassword,
                  }}
                  title="Local Browser Device"
                  subtitle={`Member ${selectedShare.member_idx}`}
                  labelInputLabel="Device Profile Name"
                  relayLabel="Relays"
                  primarySecretLabel="Device Password"
                  secondarySecretLabel="Confirm Password"
                  actionLabel="Continue to Review"
                  actionVariant="default"
                  onLabelChange={(value) => store.updateProfileForm('label', value)}
                  onPrimarySecretChange={(value) => store.updateProfileForm('password', value)}
                  onSecondarySecretChange={(value) => store.updateProfileForm('confirmPassword', value)}
                  onRelayUrlsChange={(value) => store.updateProfileForm('relayUrls', value)}
                  onAction={() => void run(() => store.reviewGeneratedProfile())}
                />
              ) : null}
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
    );
  }

  function renderCreateConfirm() {
    if (!store.generatedKeyset) return null;
    return (
      <HostFlowShell
        title="Review Device Profile"
        description="Step 3 of 4 · review the read-only profile details before initializing this device."
        onBack={() => store.setActiveView('create-profile')}
        backTooltip="Back to device profile"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={2} />
          <CreateFlowReviewPanel
            profileName={store.drafts.profileForm.label || selectedShare?.name || 'Device Profile'}
            sharePublicKey={selectedShare?.share_public_key ?? 'n/a'}
            groupPublicKey={store.generatedKeyset.group_public_key}
            relays={store.drafts.profileForm.relayUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)}
            actionLabel="Accept and Continue"
            onAccept={() => void run(() => store.acceptGeneratedProfile())}
          />
        </section>
      </HostFlowShell>
    );
  }

  function renderCreateDistribute() {
    if (!store.generatedKeyset || !store.distributionSession || !selectedProfile) return null;
    const remainingShares = store.generatedKeyset.shares.filter((share) =>
      store.distributionSession?.remaining_member_indices.includes(share.member_idx),
    );
    return (
      <HostFlowShell
        title="Distribute the Keyset"
        description="Step 4 of 4 · the signing device is running, and the remaining shares can now be distributed."
        onBack={() => store.setActiveView('create-confirm')}
        backTooltip="Back to review"
      >
        <section className="igloo-flow-root igloo-stack">
          <StepProgress steps={['Generate', 'Create profile', 'Review', 'Distribute']} active={3} />
          <CreateFlowDistributionSection
            bannerKicker="Distribute the Keyset"
            bannerDescription="This device is initialized and connected. The remaining shares can now be distributed as `bfonboard` packages."
            bannerPoints={[
              '`Copy`, `QR`, and `Save` all produce `bfonboard` packages.',
              '`Save` downloads a `bfonboard` text file instead of creating another local profile.',
              'Finish when you are done to reach the device dashboard.',
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
            results={
              Object.fromEntries(
                Object.entries(store.distributionSession?.results ?? {}).map(([memberIdx, result]) => [
                  Number(memberIdx),
                  result,
                ]),
              ) as Record<number, { kind: 'copied' | 'qr' | 'saved'; label: string }>
            }
            onChangeDraft={(memberIdx, field, value) =>
              store.updateDistributionForm(
                memberIdx,
                field === 'packagePassword' ? 'password' : field,
                value,
              )
            }
            onDistribute={(memberIdx, kind) => void run(() => store.distributeShare(memberIdx, kind))}
            onFinish={() => store.finishDistribution()}
            beforeCards={(
              <OperatorSignerPanel
                profile={{
                  name: selectedProfile.label,
                  groupPublicKey: selectedProfile.group_public_key,
                  sharePublicKey: selectedProfile.share_public_key,
                }}
                introMessage="The primary browser signer is initialized and connected so the remaining shares can be distributed."
                runtimeState={store.runtimeSnapshot?.active ? 'running' : 'stopped'}
                runtimeControlLabel={store.runtimeSnapshot?.active ? 'Stop Signer' : 'Start Signer'}
                runtimeSummaryLabel={deriveRuntimeSummaryLabel(store.runtimeSnapshot)}
                sharePublicKey={selectedProfile.share_public_key}
                groupPublicKey={selectedProfile.group_public_key}
                onPrimaryAction={() =>
                  void run(() => (store.runtimeSnapshot?.active ? store.stopSigner() : store.startSigner()))
                }
                primaryActionVariant={store.runtimeSnapshot?.active ? 'destructive' : 'success'}
                onRefreshPeers={() => void run(() => store.refreshSigner())}
                refreshPeersDisabled={!store.runtimeSnapshot?.active}
                peers={derivePwaPeers(store.peerPermissionStates, store.runtimeSnapshot?.runtime_status)}
                pendingOperations={derivePendingOperations(store.runtimeSnapshot?.runtime_status)}
                logs={toPwaLogEntries(store.runtimeSnapshot?.runtime_log_lines)}
              />
            )}
          />
          <QrPayloadModal
            open={Boolean(store.distributionSession.qr_package)}
            onClose={() => store.closeQrPackage()}
            title="Onboarding Package QR"
            label={store.distributionSession.qr_package?.label}
            payload={store.distributionSession.qr_package?.package_text ?? ''}
          />
        </section>
      </HostFlowShell>
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
      <HostFlowShell
        title="Onboard Device"
        description="Connect with a password-protected onboarding package and complete the handshake."
        onBack={goToLanding}
        backTooltip="Back to landing"
      >
        <section className="igloo-flow-root igloo-stack">
          <Card>
            <CardHeader>
              <CardTitle>Connect with bfonboard</CardTitle>
              <CardDescription>
                The onboarding device will dial out to the peer and negotiate the handshake before you save the
                resulting device.
              </CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <label>
                bfonboard
                <Textarea
                  className="min-h-[112px]"
                  value={store.drafts.onboardConnectForm.packageText}
                  onChange={(event) => store.updateOnboardConnectForm('packageText', event.target.value)}
                  placeholder="Paste bfonboard1..."
                />
              </label>
              <label>
                Decryption Password
                <input
                  type="password"
                  value={store.drafts.onboardConnectForm.password}
                  onChange={(event) => store.updateOnboardConnectForm('password', event.target.value)}
                />
              </label>
              <div className="igloo-button-row">
                <Button type="button" size="sm" onClick={() => void run(() => store.connectOnboardingPackage())}>
                  Connect
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
    );
  }

  function renderOnboardSave() {
    if (!store.pendingOnboardConnection) return null;
    return (
      <HostFlowShell
        title="Save Onboarded Device"
        description="Review the resolved profile details and choose the password used to store this device locally."
        onBack={() => store.setActiveView('onboard-connect')}
        backTooltip="Back to connect"
      >
        <section className="igloo-flow-root igloo-stack">
          <ProfileConfirmationCard
            title="Review Onboarded Profile"
            profileName={store.pendingOnboardConnection.preview.label}
            sharePublicKey={store.pendingOnboardConnection.preview.share_public_key}
            groupPublicKey={store.pendingOnboardConnection.preview.group_public_key}
            relays={store.pendingOnboardConnection.preview.relays}
          />
          <section className="igloo-task-banner">
            <span className="igloo-task-kicker">Handshake complete</span>
            <p>
              The onboarding package has been resolved. Confirm the read-only profile details, then save this device locally.
            </p>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Finalize Device</CardTitle>
              <CardDescription>This device name and password are used when storing the profile locally.</CardDescription>
            </CardHeader>
            <CardContent className="igloo-stack">
              <div className="igloo-two-up">
                <label>
                  Device Name
                  <input
                    value={store.drafts.onboardSaveForm.label}
                    onChange={(event) => store.updateOnboardSaveForm('label', event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={store.drafts.onboardSaveForm.password}
                    onChange={(event) => store.updateOnboardSaveForm('password', event.target.value)}
                  />
                </label>
              </div>
              <label>
                Confirm Password
                <input
                  type="password"
                  value={store.drafts.onboardSaveForm.confirmPassword}
                  onChange={(event) => store.updateOnboardSaveForm('confirmPassword', event.target.value)}
                />
              </label>
              <div className="igloo-button-row">
                <Button type="button" size="sm" onClick={() => void run(() => store.finalizeOnboardedDevice())}>
                  Save Device
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </HostFlowShell>
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
                <Button type="button" size="sm" onClick={() => void run(() => store.connectRotationPackage())}>
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
            <Button type="button" size="sm" onClick={() => void run(() => store.finalizeRotationUpdate())}>
              Replace Active Device
            </Button>
          </div>
        </section>
      </HostFlowShell>
    );
  }

  function renderDashboard() {
    const operatorProfile = selectedProfile
      ? {
          name: selectedProfile.label,
          groupPublicKey: selectedProfile.group_public_key,
          sharePublicKey: selectedProfile.share_public_key,
        }
      : null;
    const runtimeState = store.runtimeSnapshot?.active ? 'running' : 'stopped';
    const runtimeControlLabel = runtimeState === 'running' ? 'Stop Signer' : 'Start Signer';

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
                profile={operatorProfile}
                introMessage="The browser signer runs locally inside the PWA workbench. This dashboard mirrors the operator workflow used by igloo-chrome."
                emptyDescription="Load or onboard a device profile before opening the signer dashboard."
                runtimeState={runtimeState}
                runtimeControlLabel={runtimeControlLabel}
                runtimeSummaryLabel={deriveRuntimeSummaryLabel(store.runtimeSnapshot)}
                activationStage={deriveActivationStage(store.runtimeSnapshot)}
                activationUpdatedAt={deriveActivationUpdatedAt(store.runtimeSnapshot)}
                sharePublicKey={selectedProfile?.share_public_key ?? null}
                groupPublicKey={selectedProfile?.group_public_key ?? null}
                onPrimaryAction={() =>
                  void run(() => (store.runtimeSnapshot?.active ? store.stopSigner() : store.startSigner()))
                }
                primaryActionVariant={store.runtimeSnapshot?.active ? 'destructive' : 'success'}
                onRefreshPeers={() => void run(() => store.refreshSigner())}
                refreshPeersDisabled={!store.runtimeSnapshot?.active}
                peers={derivePwaPeers(store.peerPermissionStates, store.runtimeSnapshot?.runtime_status)}
                pendingOperations={derivePendingOperations(store.runtimeSnapshot?.runtime_status)}
                logs={toPwaLogEntries(store.runtimeSnapshot?.runtime_log_lines)}
              />
            </div>
          ) : null}

          {store.activeDashboardTab === 'permissions' ? (
            <div role="tabpanel" id="operator-panel-permissions" aria-labelledby="operator-tab-permissions">
              <OperatorPermissionsPanel
                peerPermissions={[]}
                peerPermissionStates={
                  store.runtimeSnapshot?.active
                    ? store.peerPermissionStates.map((policy) => ({
                        pubkey: policy.pubkey,
                        manualOverride: {
                          request: policy.manual_override.request,
                          respond: policy.manual_override.respond,
                        },
                        remoteObservation: policy.remote_observation
                          ? {
                              request: policy.remote_observation.request,
                              respond: policy.remote_observation.respond,
                              updated: policy.remote_observation.updated,
                              revision: policy.remote_observation.revision,
                            }
                          : null,
                        effectivePolicy: {
                          request: policy.effective_policy.request,
                          respond: policy.effective_policy.respond,
                        },
                      }))
                    : []
                }
                onRefresh={() => void run(() => store.refreshSigner())}
                onClearAllPeerPermissions={() => void run(() => store.clearPeerPolicies())}
                onPeerPermissionOverrideChange={(pubkey, direction, method, value) =>
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
                maintenanceActions={[
                  {
                    label: 'Rotate Key',
                    variant: 'secondary',
                    disabled: !selectedProfile,
                    onClick: () => void run(() => {
                      store.startRotateKey();
                    }),
                  },
                  {
                    label: 'Reset browser workspace',
                    variant: 'destructive',
                    onClick: () => store.resetApp(),
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
      header={
        <AppHeader title="Igloo" centered subtitle="Installable browser workspace for FROSTR V2." />
      }
    >
      {renderError()}
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
