import * as React from 'react';
import {
  Checkbox,
  CRITICAL_E2E_TEST_IDS,
  DashboardConditionBanner,
  DashboardLoadingScreen,
  DashboardLoadFailedScreen,
  OnboardDeviceSponsorshipDialog,
  OperatorPermissionsPanel,
  OperatorSettingsSidebar,
  OperatorSignerPanel,
  deriveDashboardState,
  type DashboardBanner,
  type DashboardKeyModel,
  type DashboardProfileSummary,
} from 'igloo-ui';
import {
  deriveGroupSummary,
  deriveSettingsGroupProfile,
  derivePolicyDashboardView,
  deriveSignerDashboardView,
  formatRuntimeTimestamp,
} from '../lib/dashboard-view';
import type { useStore } from '../lib/store';
import type { PwaProfile, PwaSignerSettings } from '../lib/types';

type PwaStore = ReturnType<typeof useStore>;
type RunAction = (action: () => Promise<void> | void) => Promise<void>;

function compactDashboardKey(value: string | null | undefined) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > 16 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}` : trimmed;
}

export type OperatorSettingsDraft = {
  signerName: string;
  relays: string[];
  newRelayUrl: string;
  signerSettings: PwaSignerSettings;
};

export function DashboardView({
  store,
  run,
  selectedProfile,
  operatorSettingsDraft,
  setOperatorSettingsDraft,
  requestDashboardTab,
  dashboardCopiedField,
  copyDashboardKey,
  dismissedSignFailureId,
  setDismissedSignFailureId,
  openExportModal,
  setClearCredentialsOpen,
}: {
  store: PwaStore;
  run: RunAction;
  selectedProfile: PwaProfile | null;
  operatorSettingsDraft: OperatorSettingsDraft;
  setOperatorSettingsDraft: React.Dispatch<React.SetStateAction<OperatorSettingsDraft>>;
  requestDashboardTab: (tab: 'signer' | 'permissions' | 'settings') => void;
  dashboardCopiedField: 'group' | 'share' | null;
  copyDashboardKey: (field: 'group' | 'share', keyModel: DashboardKeyModel | undefined, format?: 'npub' | 'hex') => void;
  dismissedSignFailureId: string | null;
  setDismissedSignFailureId: (requestId: string) => void;
  openExportModal: (format: 'bfprofile' | 'bfshare') => void;
  setClearCredentialsOpen: (open: boolean) => void;
}) {
  const runtimeState = store.runtimeSnapshot?.active ? 'running' : 'stopped';
  const runtimeControlLabel = runtimeState === 'running' ? 'Stop Signer' : 'Start Signer';
  const signerView = deriveSignerDashboardView(selectedProfile, store.runtimeSnapshot, store.peerPermissionStates);
  const dashboardProfileSummary = React.useMemo<DashboardProfileSummary | undefined>(() => {
    if (!selectedProfile) return undefined;
    const { memberCount, threshold } = deriveGroupSummary(selectedProfile.group_package_json);
    const thresholdLabel =
      typeof threshold === 'number' && typeof memberCount === 'number'
        ? `${threshold}/${memberCount}`
        : signerView?.thresholdLabel && signerView.thresholdLabel !== 'threshold n/a'
          ? signerView.thresholdLabel
          : undefined;

    return {
      profileName: selectedProfile.label || signerView?.profileName || 'Signing profile',
      thresholdLabel,
      groupKeyLabel: signerView?.groupKey?.display ?? compactDashboardKey(selectedProfile.group_public_key),
      shareLabel: Number.isFinite(selectedProfile.member_idx)
        ? `Share #${selectedProfile.member_idx}`
        : signerView?.memberLabel,
      shareKeyLabel: signerView?.shareKey?.display ?? compactDashboardKey(selectedProfile.share_public_key),
    };
  }, [selectedProfile, signerView]);
  const policyView = derivePolicyDashboardView(Boolean(store.runtimeSnapshot?.active), store.peerPermissionStates);
  const dashboardState = deriveDashboardState({
    active: Boolean(store.runtimeSnapshot?.active),
    status: store.runtimeSnapshot?.runtime_status ?? null,
    // A hard start/restore failure throws out of connect() (no runtime to
    // query), so startSigner captures it into store.dashboardLoadError and
    // routes here to show the full-panel load-failed screen.
    loadError: store.dashboardLoadError,
    dismissedSignFailureId,
  });
  const dashboardBanners = dashboardState.kind === 'ready' ? dashboardState.banners : [];
  const availabilityIssue =
    dashboardBanners.find(
      (banner): banner is Extract<DashboardBanner, { kind: 'all-relays-offline' | 'signing-blocked' }> =>
        banner.kind === 'all-relays-offline' || banner.kind === 'signing-blocked',
    ) ?? null;
  const topBanners = dashboardBanners.filter((banner) => banner.kind === 'signing-failed');

  const [onboardSponsorshipOpen, setOnboardSponsorshipOpen] = React.useState(false);
  const [pingingPeerPubkey, setPingingPeerPubkey] = React.useState<string | null>(null);
  const settingsGroupProfile = React.useMemo(
    () => deriveSettingsGroupProfile(selectedProfile),
    [selectedProfile],
  );
  const settingsMemberLabel = Number.isFinite(selectedProfile?.member_idx)
    ? `Share #${selectedProfile?.member_idx}`
    : undefined;
  const settingsSaveDisabled = !selectedProfile || !store.runtimeSnapshot?.active;

  const renderSignerPanel = () => {
    if (dashboardState.kind === 'loading') {
      return (
        <DashboardLoadingScreen
          detail={dashboardState.detail}
          profileSummary={dashboardProfileSummary}
        />
      );
    }
    if (dashboardState.kind === 'load-failed') {
      return (
        <DashboardLoadFailedScreen
          message={dashboardState.message}
          timestampLabel={dashboardState.at ? formatRuntimeTimestamp(dashboardState.at) : undefined}
          onRetry={() => void run(() => store.startSigner())}
          onClear={() => setClearCredentialsOpen(true)}
          clearLabel="Clear credentials"
          clearVariant="destructive"
          profileSummary={dashboardProfileSummary}
        />
      );
    }
    return (
      <>
        {topBanners.map((banner) => (
          <DashboardConditionBanner
            key={banner.kind}
            banner={banner}
            timestampLabel={
              banner.kind === 'signing-failed' ? formatRuntimeTimestamp(banner.at) : undefined
            }
            onDismiss={
              banner.kind === 'signing-failed'
                ? () => setDismissedSignFailureId(banner.requestId)
                : undefined
            }
          />
        ))}
        <OperatorSignerPanel
          view={signerView}
          emptyDescription="Load or onboard a device profile before opening the signer dashboard."
          runtimeControlLabel={runtimeControlLabel}
          copiedField={dashboardCopiedField}
          onCopyGroupKey={(format) => copyDashboardKey('group', signerView?.groupKey, format)}
          onCopyShareKey={(format) => copyDashboardKey('share', signerView?.shareKey, format)}
          onPrimaryAction={() =>
            void run(() => (store.runtimeSnapshot?.active ? store.stopSigner() : store.startSigner()))
          }
          onRefreshPeers={() => void run(() => store.refreshSigner())}
          refreshPeersDisabled={!store.runtimeSnapshot?.active}
          onPingPeer={(pubkey) => {
            setPingingPeerPubkey(pubkey);
            void run(() => store.pingPeer(pubkey)).finally(() => setPingingPeerPubkey(null));
          }}
          pingPeerDisabled={!store.runtimeSnapshot?.active || pingingPeerPubkey != null}
          pingingPeerPubkey={pingingPeerPubkey}
          availabilityIssue={availabilityIssue}
          // Clearing the host-side log buffer requires an active session, so
          // only expose the control while the signer is running.
          onClearLogs={
            store.runtimeSnapshot?.active ? () => void run(() => store.clearLogs()) : undefined
          }
          onApproveOnce={(id) => void run(() => store.resolveApproval(id, true))}
          onDenyApproval={(id) => void run(() => store.resolveApproval(id, false))}
          onAlwaysAllow={(id) => {
            const row = signerView?.pendingApprovalRows?.find((approval) => approval.id === id);
            if (!row) return;
            // Approve this request, then persist an Allow override so future
            // requests for this peer+method skip the queue.
            void run(async () => {
              await store.resolveApproval(id, true);
              await store.updatePeerPolicy(row.pubkey, 'respond', row.method, 'allow');
            });
          }}
        />
      </>
    );
  };

  return (
    <div data-testid={CRITICAL_E2E_TEST_IDS.dashboardRoot} className="space-y-6 pb-8 sm:pb-10">
      {store.activeDashboardTab === 'signer' || store.activeDashboardTab === 'settings' ? (
        <div role="tabpanel" id="operator-panel-signer" aria-labelledby="operator-tab-signer">
          {renderSignerPanel()}
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
              void run(() => store.updatePeerPolicy(pubkey, direction, method, value))
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
        <>
          <OperatorSettingsSidebar
            open
            onClose={() => requestDashboardTab('signer')}
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
            onSave={() =>
              void run(() =>
                store.saveOperatorSettings({
                  label: operatorSettingsDraft.signerName,
                  relays: operatorSettingsDraft.relays,
                  signerSettings: operatorSettingsDraft.signerSettings,
                }),
              )
            }
            saveDisabled={settingsSaveDisabled}
            message={
              store.runtimeSnapshot?.active ? null : 'Start the signer to apply settings live.'
            }
            memberLabel={settingsMemberLabel}
            profilePasswordAction={{
              title: 'Profile Password',
              description: 'Change the local password.',
              actionLabel: 'Change',
              testId: CRITICAL_E2E_TEST_IDS.settingsProfilePassword,
              disabled: true,
              onAction: () => {},
            }}
            groupProfile={settingsGroupProfile}
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
            onboardAction={{
              title: 'Onboard a Device',
              description: 'Sponsor a new device to join this keyset with an encrypted bfonboard package.',
              actionLabel: 'Onboard a Device',
              testId: CRITICAL_E2E_TEST_IDS.settingsOnboardDevice,
              disabled: !selectedProfile,
              onAction: () => setOnboardSponsorshipOpen(true),
            }}
            replaceShareAction={{
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
            }}
            exportProfileAction={{
              title: 'Export Profile',
              description: 'Encrypted backup of your share and configuration',
              actionLabel: 'Export',
              testId: CRITICAL_E2E_TEST_IDS.settingsCopyProfile,
              variant: 'secondary',
              disabled: !selectedProfile,
              onAction: () => openExportModal('bfprofile'),
            }}
            exportShareAction={{
              title: 'Export Share',
              description: 'Password-protected bfshare package',
              actionLabel: 'Export',
              testId: CRITICAL_E2E_TEST_IDS.settingsCopyShare,
              variant: 'secondary',
              disabled: !selectedProfile,
              onAction: () => openExportModal('bfshare'),
            }}
            lockProfileAction={{
              title: 'Logout',
              description: 'Return to the profile list to open another profile',
              actionLabel: 'Logout',
              testId: CRITICAL_E2E_TEST_IDS.settingsLogout,
              variant: 'destructive',
              disabled: !selectedProfile,
              onAction: () => void run(() => store.logout()),
            }}
            clearCredentialsAction={{
              title: 'Clear Credentials',
              description:
                "Delete this device's saved profile, share, password, and relay configuration",
              actionLabel: 'Clear',
              testId: CRITICAL_E2E_TEST_IDS.settingsClearCredentials,
              variant: 'destructive',
              disabled: store.profiles.length === 0,
              onAction: () => setClearCredentialsOpen(true),
            }}
            browserPreferences={
              <div className="igloo-settings-grid">
                <Checkbox
                  checked={store.settings.remember_browser_state}
                  onCheckedChange={(checked) => store.updateSettings('remember_browser_state', checked)}
                  label="Remember browser state"
                  description="Persist profiles, drafts, and the last active workspace in this browser."
                />
                <Checkbox
                  checked={store.settings.auto_open_signer}
                  onCheckedChange={(checked) => store.updateSettings('auto_open_signer', checked)}
                  label="Open signer after import"
                  description="Jump straight into the signer workspace after a successful setup action."
                  data-testid={CRITICAL_E2E_TEST_IDS.settingsAutoOpenToggle}
                />
                <Checkbox
                  checked={store.settings.prefer_install_prompt}
                  onCheckedChange={(checked) => store.updateSettings('prefer_install_prompt', checked)}
                  label="Prefer install prompt"
                  description="Keep the PWA install affordance visible when the browser makes it available."
                />
              </div>
            }
          />
          <OnboardDeviceSponsorshipDialog
            open={onboardSponsorshipOpen}
            onClose={() => setOnboardSponsorshipOpen(false)}
            onExportShare={() => {
              setOnboardSponsorshipOpen(false);
              openExportModal('bfshare');
            }}
            onReplaceShare={() => {
              setOnboardSponsorshipOpen(false);
              void run(() => {
                store.startRotateKey();
              });
            }}
            exportShareDisabled={!selectedProfile}
            replaceShareDisabled={!selectedProfile}
          />
        </>
      ) : null}
    </div>
  );
}
