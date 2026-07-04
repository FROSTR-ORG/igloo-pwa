import * as React from 'react';

import {
  Alert,
  AppHeader,
  ClearCredentialsDialog,
  CRITICAL_E2E_TEST_IDS,
  DashboardHeaderActions,
  PageLayout,
  ExportPackageModal,
  SettingsUnsavedChangesDialog,
  WelcomeDeleteModal,
  WelcomeUnlockModal,
  type DashboardKeyModel,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';
import { toErrorMessage } from 'igloo-shared';
import { deriveExportSummary } from './lib/dashboard-view';
import { saveTextToFile } from './lib/file-save';
import { StoreProvider, useStore } from './lib/store';
import {
  CreateDistributeView,
  CreateGenerateView,
  CreateSaveProfileView,
  CreateSelectShareView,
} from './views/create';
import { DashboardView, type OperatorSettingsDraft } from './views/dashboard';
import { LoadConfirmView, LoadErrorView, LoadImportView } from './views/import';
import { LandingView } from './views/landing';
import {
  OnboardConnectView,
  OnboardFailedView,
  OnboardHandshakeView,
  OnboardSaveView,
} from './views/onboard';
import { RecoverCollectView, RecoverKeyView } from './views/recover';
import { RotateConnectView, RotateSaveView } from './views/rotate';

export { RecoverPrivateKeyView } from './views/recover';

function formatUiError(error: unknown) {
  const message = toErrorMessage(error, '');
  if (message) return message;
  if (error && typeof error === 'object') {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the generic message below.
    }
  }
  return 'Unexpected error.';
}

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

function deriveHeaderMode(activeView: ReturnType<typeof useStore>['activeView']) {
  if (activeView === 'landing') return 'welcome';
  if (activeView === 'dashboard') return 'dashboard';
  return 'task';
}

function isPaperWelcomeSurface(store: ReturnType<typeof useStore>) {
  return store.activeView === 'landing' || store.activeView === 'create-generate';
}

function deriveHeaderTaskLabel(store: ReturnType<typeof useStore>) {
  const activeView = store.activeView;
  if (activeView.startsWith('create')) return store.drafts.createForm.mode === 'rotate' ? 'Rotate' : 'Create';
  if (activeView.startsWith('rotate')) return 'Rotate';
  if (activeView.startsWith('recover')) return 'Recover';
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

function formatWelcomeKey(value: string) {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
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
  const [welcomeDeleteProfileId, setWelcomeDeleteProfileId] = React.useState<string | null>(null);
  const [recoveredKey, setRecoveredKey] = React.useState<{ nsec: string; signingKeyHex: string } | null>(null);
  const [dashboardCopiedField, setDashboardCopiedField] = React.useState<'group' | 'share' | null>(null);
  // request_id of a signing-failed banner the operator dismissed.
  const [dismissedSignFailureId, setDismissedSignFailureId] = React.useState<string | null>(null);

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
  const [clearCredentialsOpen, setClearCredentialsOpen] = React.useState(false);

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
      } catch (error) {
        // Only an AEAD decrypt failure means the password was wrong. Anything
        // else (e.g. a legacy-v1 profile missing its encrypted artifact, or a
        // signer-start failure) carries a real message worth surfacing instead
        // of misreporting it as a bad password.
        const message = error instanceof Error ? error.message : '';
        setWelcomeUnlockError(
          /incorrect passphrase/i.test(message)
            ? 'Incorrect password. Please try again.'
            : message || 'Could not unlock this device.',
        );
      } finally {
        setWelcomeUnlockSubmitting(false);
      }
    },
    [closeWelcomeUnlock, store, welcomeUnlockPassword, welcomeUnlockProfileId],
  );

  const landingProfiles = store.profiles.map(deriveWelcomeReturningProfile);
  const isWelcomeSurface = isPaperWelcomeSurface(store);
  const isDashboardSurface = store.activeView === 'dashboard';
  const dashboardHeaderActions = isDashboardSurface ? (
    <DashboardHeaderActions
      dashboard={{
        label: 'Dashboard',
        active: store.activeDashboardTab === 'signer',
        testId: CRITICAL_E2E_TEST_IDS.dashboardTabSigner,
        onClick: () => requestDashboardTab('signer'),
      }}
      permissions={{
        label: 'Permissions',
        active: store.activeDashboardTab === 'permissions',
        testId: CRITICAL_E2E_TEST_IDS.dashboardTabPermissions,
        onClick: () => requestDashboardTab('permissions'),
      }}
      settings={{
        label: 'Settings',
        active: store.activeDashboardTab === 'settings',
        testId: CRITICAL_E2E_TEST_IDS.dashboardTabSettings,
        onClick: () => requestDashboardTab('settings'),
      }}
    />
  ) : null;
  const activeViewContent = (() => {
    switch (store.activeView) {
      case 'landing':
        return (
          <LandingView
            profiles={landingProfiles}
            layout={deriveWelcomeReturningLayout(store.profiles.length)}
            onGenerate={() => store.startCreateKeyset()}
            onImport={() => store.startLoadImport()}
            onOnboard={() => store.setActiveView('onboard-connect')}
            onUnlock={openWelcomeUnlock}
            onRotate={(profileId) => {
              store.selectProfile(profileId);
              store.updateCreateForm('mode', 'rotate');
              store.updateRotationForm('sourceProfileId', profileId);
              store.setActiveView('create-generate');
            }}
            onRecover={(profileId) => {
              setRecoveredKey(null);
              store.startRecoverKey(profileId);
            }}
            onDelete={openWelcomeDelete}
          />
        );
      case 'create-generate':
        return <CreateGenerateView store={store} run={run} onBack={goToLanding} />;
      case 'create-select-share':
        return <CreateSelectShareView store={store} run={run} />;
      case 'create-save-profile':
        return <CreateSaveProfileView store={store} run={run} />;
      case 'create-distribute':
        return <CreateDistributeView store={store} run={run} selectedProfile={selectedProfile} />;
      case 'load-import':
        return <LoadImportView store={store} run={run} onBack={goToLanding} />;
      case 'load-confirm':
        return <LoadConfirmView store={store} run={run} />;
      case 'load-error':
        return <LoadErrorView store={store} onBack={goToLanding} />;
      case 'onboard-connect':
        return <OnboardConnectView store={store} run={run} onBack={goToLanding} />;
      case 'onboard-handshake':
        return <OnboardHandshakeView store={store} />;
      case 'onboard-failed':
        return (
          <OnboardFailedView
            store={store}
            onRetry={() => {
              setUiError(null);
              store.setActiveView('onboard-connect');
            }}
          />
        );
      case 'onboard-save':
        return <OnboardSaveView store={store} run={run} />;
      case 'rotate-connect':
        return <RotateConnectView store={store} run={run} selectedProfile={selectedProfile} onBack={goToDashboard} />;
      case 'rotate-save':
        return <RotateSaveView store={store} run={run} selectedProfile={selectedProfile} />;
      case 'recover-collect':
        return (
          <RecoverCollectView
            store={store}
            run={run}
            selectedProfile={selectedProfile}
            onBack={goToLanding}
            onRecovered={setRecoveredKey}
          />
        );
      case 'recover-key':
        return <RecoverKeyView recoveredKey={recoveredKey} onClear={goToLanding} />;
      case 'dashboard':
        return (
          <DashboardView
            store={store}
            run={run}
            selectedProfile={selectedProfile}
            operatorSettingsDraft={operatorSettingsDraft}
            setOperatorSettingsDraft={setOperatorSettingsDraft}
            requestDashboardTab={requestDashboardTab}
            dashboardCopiedField={dashboardCopiedField}
            copyDashboardKey={copyDashboardKey}
            dismissedSignFailureId={dismissedSignFailureId}
            setDismissedSignFailureId={setDismissedSignFailureId}
            openExportModal={openExportModal}
            setClearCredentialsOpen={setClearCredentialsOpen}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <PageLayout
      surface={isWelcomeSurface ? 'welcome' : isDashboardSurface ? 'dashboard' : 'default'}
      maxWidth={isWelcomeSurface ? 'max-w-none' : isDashboardSurface ? 'max-w-[1000px]' : 'max-w-none'}
      header={
        <AppHeader
          mode={deriveHeaderMode(store.activeView)}
          logoSrc="/igloo-paper-mark.png"
          taskLabel={deriveHeaderTaskLabel(store)}
          profileName={selectedProfile?.label}
          actions={dashboardHeaderActions}
        />
      }
    >
      {uiError && !store.dashboardLoadError ? <Alert tone="danger">{uiError}</Alert> : null}
      {store.runtimeWarning ? <Alert tone="warning">{store.runtimeWarning}</Alert> : null}
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
      <SettingsUnsavedChangesDialog
        open={Boolean(pendingSettingsNav)}
        onDiscard={() => {
          setOperatorSettingsDraft(buildOperatorSettingsDraft(selectedProfile));
          if (pendingSettingsNav) store.setDashboardTab(pendingSettingsNav);
          setPendingSettingsNav(null);
        }}
        onKeepEditing={() => setPendingSettingsNav(null)}
      />
      <ClearCredentialsDialog
        open={clearCredentialsOpen}
        profileSummary={deriveExportSummary(selectedProfile)}
        onConfirm={() => {
          setClearCredentialsOpen(false);
          void run(() => store.clearDeviceCredentials());
        }}
        onCancel={() => setClearCredentialsOpen(false)}
      />
      {activeViewContent}
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
