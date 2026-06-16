import * as React from 'react';
import { flushSync } from 'react-dom';
import {
  buildProfileDownloadFilename,
  DEFAULT_RELAYS,
  groupPublicKeyFromPackage,
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
  type PolicyOverrideValue,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { saveTextToFile } from './file-save';
import { importLegacyProfilesOnce } from './migrate-global';
import { toPersistableGlobal, toPersistableSession } from './persist-allowlist';
import { SessionController } from './session-controller';
import {
  clearGlobalState,
  clearSessionState,
  createDebouncedPersistor,
  deleteProfileGlobal,
  loadGlobalState,
  loadSessionState,
  saveGlobalState,
  saveSessionState,
  subscribeGlobalState,
} from './storage';
import type {
  PwaDashboardTab,
  PwaDistributionActionResult,
  PwaDraftSecrets,
  PwaDraftState,
  PwaLoadConfirmation,
  PwaOnboardConnection,
  PwaPeerPermissionState,
  PwaPersistedState,
  PwaProfile,
  PwaRuntimeSnapshot,
  PwaSignerSettings,
  PwaSettings,
  PwaView,
} from './types';

const ONBOARD_HANDSHAKE_MINIMUM_MS = 350;

type AppState = PwaPersistedState & {
  setActiveView: (view: PwaView) => void;
  setDashboardTab: (tab: PwaDashboardTab) => void;
  setUnlockPassphrase: (value: string) => void;
  selectProfile: (profileId: string) => void;
  loadStoredProfile: (profileId: string, passphrase: string) => Promise<void>;
  updateCreateForm: (field: keyof PwaDraftState['createForm'] | 'privateKey', value: string) => void;
  updateRotationForm: (field: 'sourceProfileId', value: string) => void;
  updateRotationSource: (
    index: number,
    field: 'packageText' | 'password',
    value: string,
  ) => void;
  addRotationSource: () => void;
  removeRotationSource: (index: number) => void;
  /** Passphrase that unlocks this device's own share for auto-include during rotation. */
  setRotateDevicePassphrase: (value: string) => void;
  /** Verify the entered rotate device passphrase actually unlocks this device's share. */
  verifyRotateDeviceUnlock: () => Promise<void>;
  generateKeyset: () => Promise<void>;
  selectGeneratedShare: (memberIdx: number) => void;
  updateProfileForm: (field: keyof PwaDraftState['profileForm'], value: string) => void;
  updateProfileFormPassword: (field: 'password' | 'confirmPassword', value: string) => void;
  continueToSaveProfile: () => void;
  acceptGeneratedProfile: () => Promise<void>;
  updateDistributionForm: (
    memberIdx: number,
    field: 'label',
    value: string,
  ) => void;
  updateDistributionPassword: (
    memberIdx: number,
    field: 'password' | 'confirmPassword',
    value: string,
  ) => void;
  distributeShare: (
    memberIdx: number,
    kind: 'prepare' | 'copy' | 'qr' | 'save' | 'mark' | 'cancel' | 'revert',
  ) => Promise<void>;
  updateDistributionPermission: (memberIdx: number, permission: 'sign' | 'ecdh' | 'ping' | 'onboard', enabled: boolean) => Promise<void>;
  closeQrPackage: () => void;
  startDistributionClient: () => Promise<void>;
  stopDistributionClient: () => Promise<void>;
  finishSetup: () => Promise<void>;
  startLoadImport: () => void;
  updateImportProfileForm: (field: keyof PwaDraftState['importProfileForm'], value: string) => void;
  updateImportProfilePassword: (value: string) => void;
  updateImportSaveForm: (field: keyof PwaDraftState['importSaveForm'], value: string) => void;
  updateImportSavePassword: (field: 'password' | 'confirmPassword', value: string) => void;
  loadBfProfile: () => Promise<void>;
  clearLoadError: () => void;
  acceptPendingLoadConfirmation: () => Promise<void>;
  updateOnboardConnectForm: (field: 'packageText', value: string) => void;
  updateOnboardConnectPassword: (value: string) => void;
  connectOnboardingPackage: () => Promise<void>;
  updateOnboardSaveForm: (field: 'label' | 'relayUrls', value: string) => void;
  updateOnboardSavePassword: (field: 'password' | 'confirmPassword', value: string) => void;
  finalizeOnboardedDevice: () => Promise<void>;
  cancelOnboarding: () => void;
  startRotateKey: () => void;
  updateRotateConnectForm: (field: 'packageText', value: string) => void;
  updateRotateConnectPassword: (value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: () => Promise<void>;
  startRecoverKey: (profileId: string) => void;
  setRecoverDevicePassphrase: (value: string) => void;
  /** Verify the entered device passphrase actually unlocks this device's share. */
  verifyRecoverDeviceUnlock: () => Promise<void>;
  /** Toggle lost-device recovery: reconstruct from pasted shares with no device. */
  setRecoverLostDevice: (value: boolean) => void;
  updateRecoverSource: (
    index: number,
    field: 'packageText' | 'password',
    value: string,
  ) => void;
  addRecoverSource: () => void;
  removeRecoverSource: (index: number) => void;
  recoverKeyFromShares: () => Promise<{ nsec: string; signingKeyHex: string }>;
  copyProfilePackage: (profileId: string, format: 'bfprofile' | 'bfshare') => Promise<void>;
  exportEncryptedPackage: (
    profileId: string,
    format: 'bfprofile' | 'bfshare',
    exportPassword: string,
  ) => Promise<string>;
  deleteProfile: (profileId: string) => void;
  updatePeerPolicy: (
    pubkey: string,
    direction: 'request' | 'respond',
    method: 'ping' | 'onboard' | 'sign' | 'ecdh',
    value: PolicyOverrideValue
  ) => Promise<void>;
  /** Resolve a parked approval (the `ask` disposition): true approves, false denies. */
  resolveApproval: (requestId: string, approved: boolean) => Promise<void>;
  clearPeerPolicies: () => Promise<void>;
  clearLogs: () => Promise<void>;
  startSigner: () => Promise<void>;
  stopSigner: () => Promise<void>;
  refreshSigner: () => Promise<void>;
  saveOperatorSettings: (input: {
    label: string;
    relays: string[];
    signerSettings: PwaSignerSettings;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Destructive: stop the signer, tear down every runtime session, erase this
   * device/partition's persisted credentials, and reset to a clean landing.
   */
  clearDeviceCredentials: () => Promise<void>;
  updateSettings: (field: keyof PwaSettings, checked: boolean) => void;
};

const AppStore = React.createContext<AppState | null>(null);

/**
 * Per-PwaStore SessionController. Exposed via context so tests and any
 * future UI path can reach the same controller instance the adapter
 * helpers were bound to. Replaces the module-global singleton that
 * used to live in `profile-runtime.ts` (PR17 / D.4).
 */
const SessionControllerContext = React.createContext<SessionController | null>(null);

export function useSessionController(): SessionController {
  const controller = React.useContext(SessionControllerContext);
  if (!controller) {
    throw new Error('SessionControllerContext missing; wrap tree in <StoreProvider>.');
  }
  return controller;
}

const defaultDrafts: PwaDraftState = {
  createForm: {
    mode: 'new',
    groupName: '',
    threshold: '2',
    count: '3',
  },
  rotationForm: {
    sourceProfileId: '',
    sources: [{ packageText: '' }],
  },
  recoverKeyForm: {
    sourceProfileId: '',
    sources: [{ packageText: '' }],
  },
  profileForm: {
    label: '',
    relayUrls: DEFAULT_RELAYS.join('\n'),
  },
  distributionForms: {},
  distributionPermissions: {},
  importProfileForm: {
    profileString: '',
  },
  importSaveForm: {
    label: '',
    relayUrls: '',
  },
  onboardConnectForm: {
    packageText: '',
  },
  onboardSaveForm: {
    label: '',
    relayUrls: '',
  },
  rotateConnectForm: {
    packageText: '',
  },
};

function createDefaultDraftSecrets(): PwaDraftSecrets {
  return {
    createFormPrivateKey: '',
    rotationSources: {},
    rotateDevicePassphrase: '',
    rotateDeviceUnlockVerified: false,
    recoverKeySources: {},
    recoverDevicePassphrase: '',
    recoverDeviceUnlockVerified: false,
    recoverLostDevice: false,
    profileFormPassword: '',
    profileFormConfirm: '',
    distributionPasswords: {},
    importProfileFormPassword: '',
    importSaveFormPassword: '',
    importSaveFormConfirm: '',
    onboardConnectFormPassword: '',
    onboardSaveFormPassword: '',
    onboardSaveFormConfirm: '',
    rotateConnectFormPassword: '',
  };
}

const defaultSettings: PwaSettings = {
  remember_browser_state: true,
  auto_open_signer: true,
  prefer_install_prompt: true,
};

const ACTIVE_RUNTIME_POLL_INTERVAL_MS = 1_000;

// Normalize a pubkey for comparison: lowercase and drop a compressed-point
// prefix so an x-only key and a 33-byte key compare equal.
function normalizePeerKey(value: string) {
  const lower = value.trim().toLowerCase();
  return lower.length === 66 && (lower.startsWith('02') || lower.startsWith('03'))
    ? lower.slice(2)
    : lower;
}

function readProfileGroupName(profile: PwaProfile | null) {
  if (!profile) return '';
  try {
    const parsed = JSON.parse(profile.group_package_json) as { group_name?: unknown };
    return typeof parsed.group_name === 'string' ? parsed.group_name.trim() : '';
  } catch {
    return '';
  }
}

function createDefaultState(): PwaPersistedState {
  return {
    profiles: [],
    peerPermissionStates: adapter.defaultPeerPermissionStates(),
    runtimeWarning: null,
    selectedProfileId: '',
    activeView: 'landing',
    activeDashboardTab: 'signer',
    unlockPassphrase: '',
    pendingKeyset: null,
    selectedGeneratedShareIdx: null,
    pendingLoadConfirmation: null,
    pendingLoadError: null,
    dashboardLoadError: null,
    pendingOnboardConnection: null,
    pendingRotationConnection: null,
    distributionSession: null,
    runtimeSnapshot: null,
    // In-memory only. Populated on each `startSession` call; reset on load.
    sharePackageJsonByProfileId: {},
    settings: defaultSettings,
    drafts: defaultDrafts,
    draftSecrets: createDefaultDraftSecrets(),
  };
}

function ensureDistributionForm(
  current: PwaDraftState['distributionForms'],
  memberIdx: number,
  fallbackLabel: string,
) {
  return (
    current[memberIdx] ?? {
      label: fallbackLabel,
    }
  );
}

function ensureDistributionPasswordSlot(
  current: PwaDraftSecrets['distributionPasswords'],
  memberIdx: number,
): { password: string; confirmPassword: string } {
  return current[memberIdx] ?? { password: '', confirmPassword: '' };
}

function normalizeLoadedState(): PwaPersistedState {
  try {
    return normalizeLoadedStateFromStorage();
  } catch {
    // Defense in depth: a structurally-plausible blob that still trips
    // normalization (a wrong-typed nested field that slipped past the storage
    // guard) must never crash hydrate. Reset this tab's session to a clean
    // slate (the shared profile list is left intact).
    clearSessionState();
    return createDefaultState();
  }
}

function normalizeLoadedStateFromStorage(): PwaPersistedState {
  // Lift any pre-split partitioned profiles into the shared global store first
  // (self-cleaning, no-op once done), then hydrate from the two stores: profiles
  // + settings are GLOBAL (shared across tabs); the selection/view/drafts are
  // this tab's SESSION state.
  importLegacyProfilesOnce();
  const global = loadGlobalState();
  const session = loadSessionState();
  if (!global && !session) return createDefaultState();

  const base = createDefaultState();
  const loaded = {
    // Persisted profiles carry only the non-secret allow-list keys; the
    // transient `profile_string`/`share_string` are intentionally absent after a
    // reload (they are never persisted), so this is the same shape the app has
    // always hydrated.
    profiles: (global?.profiles ?? base.profiles) as PwaProfile[],
    settings: { ...base.settings, ...global?.settings },
    selectedProfileId: session?.selectedProfileId ?? base.selectedProfileId,
    activeView: session?.activeView ?? base.activeView,
    activeDashboardTab: session?.activeDashboardTab ?? base.activeDashboardTab,
    drafts: session?.drafts,
  };
  // Typed as a loose string: a persisted blob may carry a legacy/intermediate
  // view name (e.g. 'onboard-confirm') that is no longer in the `PwaView` union
  // but still needs the sanitization rules below.
  const loadedActiveView = session?.activeView as string | undefined;

  // All runtime-only / secret-bearing fields come straight from
  // `createDefaultState()` — they are never persisted. `peerPermissionStates`
  // is runtime state of this tab's signer, so it always starts at the default
  // and is repopulated on `startSession`.
  const normalized: PwaPersistedState = {
    ...base,
    profiles: loaded.profiles,
    settings: loaded.settings,
    selectedProfileId: loaded.selectedProfileId,
    activeView: loaded.activeView,
    activeDashboardTab: loaded.activeDashboardTab,
    peerPermissionStates: adapter.defaultPeerPermissionStates(),
    drafts: {
      ...defaultDrafts,
      ...loaded.drafts,
      createForm: { ...defaultDrafts.createForm, ...loaded.drafts?.createForm },
      rotationForm: {
        ...defaultDrafts.rotationForm,
        ...loaded.drafts?.rotationForm,
        sources:
          Array.isArray(loaded.drafts?.rotationForm?.sources) && loaded.drafts.rotationForm.sources.length
            ? loaded.drafts.rotationForm.sources.map((entry) => ({ packageText: entry?.packageText ?? '' }))
            : defaultDrafts.rotationForm.sources,
      },
      recoverKeyForm: {
        ...defaultDrafts.recoverKeyForm,
        ...loaded.drafts?.recoverKeyForm,
        sources:
          Array.isArray(loaded.drafts?.recoverKeyForm?.sources) && loaded.drafts.recoverKeyForm.sources.length
            ? loaded.drafts.recoverKeyForm.sources
            : defaultDrafts.recoverKeyForm.sources,
      },
      profileForm: { ...defaultDrafts.profileForm, ...loaded.drafts?.profileForm },
      distributionForms: loaded.drafts?.distributionForms ?? {},
      distributionPermissions: loaded.drafts?.distributionPermissions ?? {},
      importProfileForm: {
        ...defaultDrafts.importProfileForm,
        ...loaded.drafts?.importProfileForm,
      },
      importSaveForm: {
        ...defaultDrafts.importSaveForm,
        ...loaded.drafts?.importSaveForm,
      },
      onboardConnectForm: {
        ...defaultDrafts.onboardConnectForm,
        ...loaded.drafts?.onboardConnectForm,
      },
      onboardSaveForm: {
        ...defaultDrafts.onboardSaveForm,
        ...loaded.drafts?.onboardSaveForm,
      },
      rotateConnectForm: {
        ...defaultDrafts.rotateConnectForm,
        ...loaded.drafts?.rotateConnectForm,
      },
    },
  };

  // The selected profile is per-tab session state but the profile list is
  // global: another tab may have deleted the device this tab had selected.
  // Drop a dangling selection and bounce off the dashboard.
  if (
    normalized.selectedProfileId &&
    !normalized.profiles.some((profile) => profile.id === normalized.selectedProfileId)
  ) {
    normalized.selectedProfileId = '';
  }
  if (
    normalized.activeView === 'dashboard' &&
    (!normalized.profiles.length || !normalized.selectedProfileId)
  ) {
    normalized.activeView = 'landing';
  }

  if (loadedActiveView === 'onboard-confirm') {
    normalized.activeView = normalized.pendingOnboardConnection ? 'onboard-save' : 'onboard-connect';
  }
  if (loadedActiveView === 'onboard-handshake') {
    normalized.activeView = 'onboard-connect';
  }
  if (loadedActiveView === 'load-error' && !normalized.pendingLoadError) {
    normalized.activeView = 'load-import';
  }
  if (
    (loadedActiveView === 'create-generate' ||
      loadedActiveView === 'create-select-share' ||
      loadedActiveView === 'create-save-profile' ||
      loadedActiveView === 'create-distribute') &&
    !normalized.pendingKeyset
  ) {
    // The in-flight keyset is in-memory only (it holds share secrets) and is
    // never persisted, so a reload can't resume mid-create. Bounce back to the
    // landing entry point instead of stranding the user on a keyset-less step.
    normalized.activeView = 'landing';
  }

  return normalized;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PwaPersistedState>(() => normalizeLoadedState());
  const runtimeSnapshotRef = React.useRef<PwaRuntimeSnapshot | null>(state.runtimeSnapshot);

  React.useEffect(() => {
    runtimeSnapshotRef.current = state.runtimeSnapshot;
  }, [state.runtimeSnapshot]);

  // D.4: one SessionController per PwaStore instance. Created lazily
  // via `useRef` so re-renders don't re-instantiate it, but the React
  // tree keeps a stable reference for the lifetime of the provider.
  // StrictMode double-mount cleans up via the effect below, which
  // calls `controller.stop()` — idempotent on a fresh controller.
  const controllerRef = React.useRef<SessionController | null>(null);
  if (controllerRef.current == null) {
    controllerRef.current = new SessionController();
  }
  const controller = controllerRef.current;

  React.useEffect(
    () => () => {
      // Stop on unmount. Idempotent: a second stop returns false
      // without throwing. StrictMode's simulated unmount/remount
      // becomes start -> stop -> start, which is now safe.
      void controller.stop();
    },
    [controller],
  );

  // Two debounced persistors that write ONLY the allow-list fields produced by
  // `toPersistableGlobal`/`toPersistableSession`: the GLOBAL store (profiles +
  // settings, shared across tabs) and this tab's SESSION store (selection, view,
  // drafts). Secrets, runtime snapshots, and draft passwords never reach disk.
  const globalPersistorRef = React.useRef(createDebouncedPersistor(saveGlobalState));
  const sessionPersistorRef = React.useRef(createDebouncedPersistor(saveSessionState));
  React.useEffect(
    () => () => {
      globalPersistorRef.current.flush();
      sessionPersistorRef.current.flush();
    },
    [],
  );

  React.useEffect(() => {
    if (!state.settings.remember_browser_state) {
      globalPersistorRef.current.cancel();
      sessionPersistorRef.current.cancel();
      // "Forget this browser" is a deliberate wipe: drop both the shared device
      // list and this tab's session.
      clearGlobalState();
      clearSessionState();
      return;
    }
    globalPersistorRef.current.schedule(toPersistableGlobal(state));
    sessionPersistorRef.current.schedule(toPersistableSession(state));
  }, [state]);

  // Live cross-tab sync of the shared device list: when another tab adds, edits,
  // or removes a profile, reflect it here — without disturbing the profile this
  // tab's signer is actively running (its in-memory copy stays authoritative).
  React.useEffect(
    () =>
      subscribeGlobalState((next) => {
        setState((current) => {
          const incoming = (next?.profiles ?? []) as PwaProfile[];
          const activeId = current.runtimeSnapshot?.active
            ? current.runtimeSnapshot.profile?.id ?? null
            : null;
          const merged = incoming.map((profile) =>
            profile.id === activeId
              ? current.profiles.find((entry) => entry.id === activeId) ?? profile
              : profile,
          );
          // Keep the running profile listed even if another tab deleted it, so
          // the active signer isn't yanked out from under this tab.
          if (activeId && !merged.some((profile) => profile.id === activeId)) {
            const local = current.profiles.find((entry) => entry.id === activeId);
            if (local) merged.push(local);
          }
          return {
            ...current,
            profiles: merged,
            settings: { ...current.settings, ...next?.settings },
          };
        });
      }),
    [],
  );

  // Force the given dashboard state to localStorage synchronously, bypassing the
  // debounce. The reactive effect above only *schedules* a write (250/500ms), and
  // `pendingOnboardConnection` is reset on load for security — so a device created
  // or onboarded just before an immediate reload would otherwise be lost. Callers
  // that create a durable profile flush through this. Respects the
  // remember-browser-state toggle, matching the reactive effect.
  const persistImmediately = React.useCallback((snapshot: PwaPersistedState) => {
    if (!snapshot.settings.remember_browser_state) return;
    globalPersistorRef.current.schedule(toPersistableGlobal(snapshot));
    globalPersistorRef.current.flush();
    sessionPersistorRef.current.schedule(toPersistableSession(snapshot));
    sessionPersistorRef.current.flush();
  }, []);

  const selectedProfile = React.useMemo(
    () => state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null,
    [state.profiles, state.selectedProfileId],
  );

  React.useEffect(() => {
    const activeProfileId = state.runtimeSnapshot?.active ? state.runtimeSnapshot.profile?.id ?? null : null;
    if (!activeProfileId) return;

    let cancelled = false;

    const syncRuntimeSnapshot = async () => {
      const currentSnapshot = runtimeSnapshotRef.current;
      if (!currentSnapshot?.active || currentSnapshot.profile?.id !== activeProfileId) return;

      try {
        const runtimeSnapshot = await adapter.readSession(currentSnapshot, controller);
        if (!runtimeSnapshot || cancelled) return;
        setState((current) => {
          if (!current.runtimeSnapshot?.active || current.runtimeSnapshot.profile?.id !== activeProfileId) {
            return current;
          }
          return {
            ...current,
            profiles:
              runtimeSnapshot.profile == null
                ? current.profiles
                : current.profiles.map((profile) =>
                    profile.id === activeProfileId ? runtimeSnapshot.profile ?? profile : profile,
                  ),
            peerPermissionStates:
              runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
            runtimeSnapshot,
          };
        });
      } catch {
        // Ignore transient read failures while the runtime is stopping or being replaced.
      }
    };

    void syncRuntimeSnapshot();
    const interval = window.setInterval(() => {
      void syncRuntimeSnapshot();
    }, ACTIVE_RUNTIME_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [controller, state.runtimeSnapshot?.active, state.runtimeSnapshot?.profile?.id]);

  // Mark a share onboarded when the live runtime serves an onboard response to
  // the matching peer (the real onboard-complete signal from bifrost-rs).
  React.useEffect(() => {
    adapter.setOnboardCompleteListener((peerPubkey) => {
      const normalized = normalizePeerKey(peerPubkey);
      setState((current) => {
        if (!current.distributionSession || !current.pendingKeyset) return current;
        const share = current.pendingKeyset.shares.find(
          (entry) => normalizePeerKey(entry.share_public_key) === normalized,
        );
        if (!share) return current;
        const existing = current.distributionSession.results[share.member_idx];
        if (existing?.status === 'onboarded') return current;
        return {
          ...current,
          distributionSession: {
            ...current.distributionSession,
            results: {
              ...current.distributionSession.results,
              [share.member_idx]: {
                status: 'onboarded',
                member_idx: share.member_idx,
                label: existing?.label ?? share.name,
                package_text: existing?.package_text ?? '',
              },
            },
          },
        };
      });
    });
    return () => adapter.setOnboardCompleteListener(null);
  }, []);

  const ensureProfileIdAvailable = React.useCallback(
    (profile: Pick<PwaProfile, 'id' | 'label'>) => {
      if (state.profiles.some((entry) => entry.id === profile.id)) {
        throw new Error(`Device profile ${profile.label} (${shortProfileId(profile.id)}) already exists.`);
      }
    },
    [state.profiles],
  );

  const persistProfileToDashboard = React.useCallback(
    async (
      profile: PwaProfile,
      passphrase: string,
      runtimeSnapshot?: PwaRuntimeSnapshot | null,
      // When true (the onboard flow), the just-finalized device adopts the live
      // staged onboarding session as its durable signer — preserving the exchanged
      // nonce pool so it can co-sign immediately — instead of starting a fresh
      // node. Only consulted when auto-open triggers activation.
      adoptStaged?: boolean,
    ) => {
      ensureProfileIdAvailable(profile);
      const saved =
        runtimeSnapshot != null
          ? {
              profile: runtimeSnapshot.profile ?? profile,
              runtime: runtimeSnapshot,
              runtimeWarning: null,
            }
          : await saveBrowserProfileAndMaybeActivate({
              profile,
              autoStart: state.settings.auto_open_signer,
              activate: async () =>
                adoptStaged
                  ? await adapter.adoptStagedOnboardSession(profile, passphrase, controller)
                  : await adapter.startSession(profile, passphrase, controller),
            });
      const snapshot = saved.runtime;
      const storedProfile = (snapshot?.profile ?? saved.profile) as PwaProfile;

      // `flushSync` so the updater runs and commits synchronously — we need the
      // computed `next` state in hand to persist it before this call returns
      // (a plain setState defers the updater, leaving nothing to flush).
      let committed: PwaPersistedState | null = null;
      flushSync(() => {
        setState((current) => {
          const next: PwaPersistedState = {
            ...current,
            profiles: [storedProfile, ...current.profiles.filter((entry) => entry.id !== storedProfile.id)],
            peerPermissionStates:
              snapshot?.peer_permission_states ?? current.peerPermissionStates ?? adapter.defaultPeerPermissionStates(),
            runtimeWarning: saved.runtimeWarning?.message ?? null,
            selectedProfileId: storedProfile.id,
            activeView: 'dashboard',
            activeDashboardTab: 'signer',
            runtimeSnapshot: snapshot,
            unlockPassphrase: passphrase,
          };
          committed = next;
          return next;
        });
      });
      // Persist the new device now — a reload inside the debounce window must not
      // lose a just-created/onboarded/imported profile (see `persistImmediately`).
      if (committed) {
        persistImmediately(committed);
      }
    },
    [controller, ensureProfileIdAvailable, persistImmediately, state.settings.auto_open_signer],
  );

  const value = React.useMemo<AppState>(
    () => ({
      ...state,
      setActiveView(view) {
        // Universal disposal choke point: navigating to any non-onboard view
        // releases a staged onboarding node that was never adopted. Idempotent —
        // a no-op once the node has been adopted as the active session or when
        // nothing is staged. Onboard-flow views (`onboard-*`) keep it alive.
        if (!view.startsWith('onboard')) {
          controller.discardStagedSession();
        }
        setState((current) => ({ ...current, activeView: view }));
      },
      setDashboardTab(tab) {
        setState((current) => ({ ...current, activeDashboardTab: tab, activeView: 'dashboard' }));
      },
      setUnlockPassphrase(value) {
        setState((current) => ({ ...current, unlockPassphrase: value }));
      },
      selectProfile(profileId) {
        setState((current) => ({ ...current, selectedProfileId: profileId }));
      },
      async loadStoredProfile(profileId, passphrase) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Profile not found.');
        }
        const runtimeSnapshot = await adapter.startSession(profile, passphrase, controller);
        setState((current) => ({
          ...current,
          selectedProfileId: profile.id,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
          unlockPassphrase: passphrase,
          runtimeSnapshot,
          runtimeWarning: null,
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          profiles: current.profiles.map((entry) =>
            entry.id === profile.id && runtimeSnapshot.profile ? runtimeSnapshot.profile : entry,
          ),
        }));
      },
      updateCreateForm(field, value) {
        setState((current) => {
          if (field === 'privateKey') {
            // The raw nsec is a secret: it lives only in draftSecrets, never in
            // the persistable drafts partition.
            return {
              ...current,
              draftSecrets: { ...current.draftSecrets, createFormPrivateKey: value },
            };
          }
          return {
            ...current,
            drafts: {
              ...current.drafts,
              createForm: {
                ...current.drafts.createForm,
                [field]: value,
              },
            },
          };
        });
      },
      updateRotationForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            rotationForm: {
              ...current.drafts.rotationForm,
              [field]: value,
            },
          },
        }));
      },
      updateRotationSource(index, field, value) {
        setState((current) => {
          if (field === 'password') {
            return {
              ...current,
              draftSecrets: {
                ...current.draftSecrets,
                rotationSources: {
                  ...current.draftSecrets.rotationSources,
                  [index]: value,
                },
              },
            };
          }
          return {
            ...current,
            drafts: {
              ...current.drafts,
              rotationForm: {
                ...current.drafts.rotationForm,
                sources: current.drafts.rotationForm.sources.map((entry, sourceIndex) =>
                  sourceIndex === index ? { ...entry, [field]: value } : entry,
                ),
              },
            },
          };
        });
      },
      addRotationSource() {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            rotationForm: {
              ...current.drafts.rotationForm,
              sources: [...current.drafts.rotationForm.sources, { packageText: '' }],
            },
          },
        }));
      },
      removeRotationSource(index) {
        setState((current) => {
          const nextRotationSecrets = { ...current.draftSecrets.rotationSources };
          delete nextRotationSecrets[index];
          return {
            ...current,
            drafts: {
              ...current.drafts,
              rotationForm: {
                ...current.drafts.rotationForm,
                sources:
                  current.drafts.rotationForm.sources.length > 1
                    ? current.drafts.rotationForm.sources.filter((_, sourceIndex) => sourceIndex !== index)
                    : current.drafts.rotationForm.sources,
              },
            },
            draftSecrets: {
              ...current.draftSecrets,
              rotationSources: nextRotationSecrets,
            },
          };
        });
      },
      setRotateDevicePassphrase(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            rotateDevicePassphrase: value,
            // A changed passphrase must be re-verified before it counts again.
            rotateDeviceUnlockVerified: false,
          },
        }));
      },
      async verifyRotateDeviceUnlock() {
        const sourceProfile = state.profiles.find(
          (profile) => profile.id === state.drafts.rotationForm.sourceProfileId,
        );
        if (!sourceProfile) {
          return;
        }
        const verified = await adapter.verifyDeviceShareUnlock({
          encryptedShareArtifact: sourceProfile.encrypted_bfshare_artifact,
          devicePassphrase: state.draftSecrets.rotateDevicePassphrase,
        });
        setState((current) => ({
          ...current,
          draftSecrets: { ...current.draftSecrets, rotateDeviceUnlockVerified: verified },
        }));
      },
      startRecoverKey(profileId) {
        setState((current) => ({
          ...current,
          selectedProfileId: profileId,
          activeView: 'recover-collect',
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              sourceProfileId: profileId,
              sources: [{ packageText: '' }],
            },
          },
          draftSecrets: {
            ...current.draftSecrets,
            recoverKeySources: {},
            recoverDevicePassphrase: '',
            recoverDeviceUnlockVerified: false,
            recoverLostDevice: false,
          },
        }));
      },
      setRecoverDevicePassphrase(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            recoverDevicePassphrase: value,
            // A changed passphrase must be re-verified before it counts again.
            recoverDeviceUnlockVerified: false,
          },
        }));
      },
      async verifyRecoverDeviceUnlock() {
        if (!selectedProfile) {
          return;
        }
        const verified = await adapter.verifyDeviceShareUnlock({
          encryptedShareArtifact: selectedProfile.encrypted_bfshare_artifact,
          devicePassphrase: state.draftSecrets.recoverDevicePassphrase,
        });
        setState((current) => ({
          ...current,
          draftSecrets: { ...current.draftSecrets, recoverDeviceUnlockVerified: verified },
        }));
      },
      setRecoverLostDevice(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            recoverLostDevice: value,
            // Entering lost-device mode drops the device passphrase + its verified
            // state; the device share is not used on that path.
            recoverDevicePassphrase: value ? '' : current.draftSecrets.recoverDevicePassphrase,
            recoverDeviceUnlockVerified: value ? false : current.draftSecrets.recoverDeviceUnlockVerified,
          },
        }));
      },
      updateRecoverSource(index, field, value) {
        setState((current) => {
          if (field === 'password') {
            // Per-source passphrases are secrets: keep them out of the
            // persistable recoverKeyForm and in draftSecrets instead.
            return {
              ...current,
              draftSecrets: {
                ...current.draftSecrets,
                recoverKeySources: {
                  ...current.draftSecrets.recoverKeySources,
                  [index]: value,
                },
              },
            };
          }
          return {
            ...current,
            drafts: {
              ...current.drafts,
              recoverKeyForm: {
                ...current.drafts.recoverKeyForm,
                sources: current.drafts.recoverKeyForm.sources.map((entry, sourceIndex) =>
                  sourceIndex === index ? { ...entry, [field]: value } : entry,
                ),
              },
            },
          };
        });
      },
      addRecoverSource() {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              ...current.drafts.recoverKeyForm,
              sources: [...current.drafts.recoverKeyForm.sources, { packageText: '' }],
            },
          },
        }));
      },
      removeRecoverSource(index) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              ...current.drafts.recoverKeyForm,
              sources:
                current.drafts.recoverKeyForm.sources.length > 1
                  ? current.drafts.recoverKeyForm.sources.filter((_, sourceIndex) => sourceIndex !== index)
                  : current.drafts.recoverKeyForm.sources,
            },
          },
        }));
      },
      async recoverKeyFromShares() {
        if (!selectedProfile) {
          throw new Error('Select a device profile to recover its key.');
        }
        const lostDevice = state.draftSecrets.recoverLostDevice;
        // Normal path: the recovering device is a group member, so its profile
        // supplies the group package (public) and its own share (unlocked with the
        // device passphrase), which counts toward the threshold; the rest are pasted.
        // Lost-device path: the device share/passphrase are omitted and the full
        // threshold is met from pasted shares alone.
        const recovered = await adapter.recoverNsecFromShares({
          groupPackageJson: selectedProfile.group_package_json,
          encryptedShareArtifact: lostDevice ? null : selectedProfile.encrypted_bfshare_artifact,
          devicePassphrase: lostDevice ? null : state.draftSecrets.recoverDevicePassphrase,
          sources: state.drafts.recoverKeyForm.sources
            .map((source, index) => ({
              packageText: source.packageText.trim(),
              password: state.draftSecrets.recoverKeySources[index] ?? '',
            }))
            .filter((source) => source.packageText && source.password),
        });
        // The reconstructed key is never persisted; it is returned to the caller for
        // in-memory display and the source inputs/passphrase are cleared immediately.
        setState((current) => ({
          ...current,
          activeView: 'recover-key',
          drafts: {
            ...current.drafts,
            recoverKeyForm: defaultDrafts.recoverKeyForm,
          },
          draftSecrets: {
            ...current.draftSecrets,
            recoverKeySources: {},
            recoverDevicePassphrase: '',
            recoverDeviceUnlockVerified: false,
            recoverLostDevice: false,
          },
        }));
        return recovered;
      },
      async generateKeyset() {
        const threshold = Number.parseInt(state.drafts.createForm.threshold, 10);
        const count = Number.parseInt(state.drafts.createForm.count, 10);
        const sourceProfile =
          state.drafts.createForm.mode === 'rotate'
            ? state.profiles.find((profile) => profile.id === state.drafts.rotationForm.sourceProfileId) ?? null
            : null;
        const rotationGroupName =
          state.drafts.createForm.groupName.trim()
          || readProfileGroupName(sourceProfile)
          || sourceProfile?.label
          || '';
        if (state.drafts.createForm.mode === 'rotate' && !sourceProfile) {
          throw new Error('Select the device profile to rotate.');
        }
        const keyset =
          state.drafts.createForm.mode === 'rotate' && sourceProfile
            ? await adapter.createRotatedKeyset({
                groupPackageJson: sourceProfile.group_package_json,
                groupName: rotationGroupName,
                threshold,
                count,
                // Auto-include the rotating device's own current share so the
                // operator only pastes the other members' bfshares.
                encryptedShareArtifact: sourceProfile.encrypted_bfshare_artifact,
                devicePassphrase: state.draftSecrets.rotateDevicePassphrase,
                sources: state.drafts.rotationForm.sources
                  .map((source, index) => ({
                    packageText: source.packageText.trim(),
                    password: state.draftSecrets.rotationSources[index] ?? '',
                  }))
                  .filter((source) => source.packageText && source.password),
              })
            : await adapter.createGeneratedKeyset({
                groupName: state.drafts.createForm.groupName,
                threshold,
                count,
                privateKey: state.draftSecrets.createFormPrivateKey,
              });
        // D.1/PR16b: `share_package_json` no longer lives on persisted
        // profiles. Use the public `member_idx` field to pick the
        // matching slot in the rotated keyset.
        const preferredMemberIdx =
          sourceProfile && typeof sourceProfile.member_idx === 'number' && sourceProfile.member_idx > 0
            ? sourceProfile.member_idx
            : NaN;
        const selectedShare =
          keyset.shares.find((share) => share.member_idx === preferredMemberIdx) ?? keyset.shares[0];
        setState((current) => ({
          ...current,
          pendingKeyset: keyset,
          selectedGeneratedShareIdx: selectedShare?.member_idx ?? null,
          activeView: 'create-select-share',
          drafts: {
            ...current.drafts,
            profileForm: {
              ...current.drafts.profileForm,
              label: sourceProfile?.label ?? selectedShare?.name ?? `${keyset.group_name} Device`,
              relayUrls: sourceProfile?.relays?.join('\n') ?? current.drafts.profileForm.relayUrls,
            },
          },
          // The rotate device passphrase has served its purpose; do not retain it.
          draftSecrets: {
            ...current.draftSecrets,
            rotateDevicePassphrase: '',
            rotateDeviceUnlockVerified: false,
          },
        }));
      },
      selectGeneratedShare(memberIdx) {
        setState((current) => ({
          ...current,
          selectedGeneratedShareIdx: memberIdx,
          drafts: {
            ...current.drafts,
            profileForm: {
              ...current.drafts.profileForm,
              label:
                current.pendingKeyset?.shares.find((share) => share.member_idx === memberIdx)?.name ??
                current.drafts.profileForm.label,
            },
          },
        }));
      },
      updateProfileForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            profileForm: {
              ...current.drafts.profileForm,
              [field]: value,
            },
          },
        }));
      },
      continueToSaveProfile() {
        if (!state.pendingKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        setState((current) => ({ ...current, activeView: 'create-save-profile' }));
      },
      updateProfileFormPassword(field, value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            [field === 'password' ? 'profileFormPassword' : 'profileFormConfirm']: value,
          },
        }));
      },
      async acceptGeneratedProfile() {
        if (!state.pendingKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        if (!state.drafts.profileForm.label.trim()) {
          throw new Error('Device profile name is required.');
        }
        if (!state.draftSecrets.profileFormPassword) {
          throw new Error('Device password is required.');
        }
        if (state.draftSecrets.profileFormPassword !== state.draftSecrets.profileFormConfirm) {
          throw new Error('Device password confirmation does not match.');
        }
        if (!state.drafts.profileForm.relayUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).length) {
          throw new Error('At least one relay is required.');
        }

        const password = state.draftSecrets.profileFormPassword;
        const profile = await adapter.createDeviceProfileFromGeneratedShare({
          keyset: state.pendingKeyset,
          shareMemberIdx: state.selectedGeneratedShareIdx,
          label: state.drafts.profileForm.label,
          password,
          relayUrls: state.drafts.profileForm.relayUrls,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        const saved = await saveBrowserProfileAndMaybeActivate({
          profile,
          autoStart: true,
          activate: async () => await adapter.startSession(profile, password, controller),
        });
        const runtimeSnapshot = saved.runtime;
        const remaining = state.pendingKeyset.shares
          .map((share) => share.member_idx)
          .filter((memberIdx) => memberIdx !== state.selectedGeneratedShareIdx);

        setState((current) => ({
          ...current,
          profiles: [profile, ...current.profiles.filter((entry) => entry.id !== profile.id)],
          selectedProfileId: profile.id,
          activeView: 'create-distribute',
          activeDashboardTab: 'signer',
          unlockPassphrase: password,
          runtimeSnapshot,
          runtimeWarning: saved.runtimeWarning?.message ?? null,
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          distributionSession: {
            profile_id: profile.id,
            signer_pubkey: runtimeSnapshot?.runtime_host?.signer_pubkey ?? profile.share_public_key,
            remaining_member_indices: remaining,
            results: {},
            qr_package: null,
          },
          drafts: {
            ...current.drafts,
            distributionForms: Object.fromEntries(
              remaining.map((memberIdx) => {
                const share = state.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
                return [
                  memberIdx,
                  {
                    label: share?.name ?? `Member ${memberIdx}`,
                  },
                ];
              }),
            ),
            distributionPermissions: Object.fromEntries(
              remaining.map((memberIdx) => [memberIdx, ['sign', 'ecdh', 'ping', 'onboard']]),
            ),
          },
          draftSecrets: {
            ...current.draftSecrets,
            distributionPasswords: {},
            profileFormPassword: '',
            profileFormConfirm: '',
          },
        }));
      },
      updateDistributionForm(memberIdx, field, value) {
        setState((current) => {
          const share = current.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
          return {
            ...current,
            drafts: {
              ...current.drafts,
              distributionForms: {
                ...current.drafts.distributionForms,
                [memberIdx]: {
                  ...ensureDistributionForm(
                    current.drafts.distributionForms,
                    memberIdx,
                    share?.name ?? `Member ${memberIdx}`,
                  ),
                  [field]: value,
                },
              },
            },
          };
        });
      },
      updateDistributionPassword(memberIdx, field, value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            distributionPasswords: {
              ...current.draftSecrets.distributionPasswords,
              [memberIdx]: {
                ...ensureDistributionPasswordSlot(current.draftSecrets.distributionPasswords, memberIdx),
                [field]: value,
              },
            },
          },
        }));
      },
      async distributeShare(memberIdx, kind) {
        if (!state.pendingKeyset || !state.distributionSession || !selectedProfile) {
          throw new Error('Create the primary device profile before distributing shares.');
        }
        const existing = state.distributionSession.results[memberIdx];

        const writeResult = (next: PwaDistributionActionResult | null) => {
          setState((current) => {
            if (!current.distributionSession) return current;
            const results = { ...current.distributionSession.results };
            if (next) {
              results[memberIdx] = next;
            } else {
              delete results[memberIdx];
            }
            // Discarding the package also clears any QR still showing it.
            const qr_package =
              next == null && current.distributionSession.qr_package?.member_idx === memberIdx
                ? null
                : current.distributionSession.qr_package;
            return {
              ...current,
              distributionSession: { ...current.distributionSession, results, qr_package },
            };
          });
        };

        // Status-only transitions that operate on the already-created package.
        if (kind === 'mark') {
          if (!existing) {
            throw new Error('Create the onboarding package before marking it delivered.');
          }
          writeResult({ ...existing, status: 'delivered' });
          return;
        }
        if (kind === 'revert') {
          if (!existing) {
            throw new Error('No distributed share to revert.');
          }
          writeResult({ ...existing, status: 'packaged' });
          return;
        }
        if (kind === 'cancel') {
          writeResult(null);
          return;
        }

        if (kind === 'prepare') {
          const form = ensureDistributionForm(
            state.drafts.distributionForms,
            memberIdx,
            state.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.name ?? `Member ${memberIdx}`,
          );
          // Share password lives in the segregated draftSecrets partition, not
          // on the persistable distribution form.
          const passwordSlot = ensureDistributionPasswordSlot(
            state.draftSecrets.distributionPasswords,
            memberIdx,
          );
          if (passwordSlot.password !== passwordSlot.confirmPassword) {
            throw new Error('Share password confirmation does not match.');
          }
          if (!form.label.trim()) {
            throw new Error('Share name is required.');
          }

          const result = await adapter.createOnboardingPackageForShare({
            keyset: state.pendingKeyset,
            shareMemberIdx: memberIdx,
            label: form.label,
            password: passwordSlot.password,
            relayUrls: selectedProfile.relays.join('\n'),
            signerPubkey: state.distributionSession.signer_pubkey,
          });

          writeResult({
            status: 'packaged',
            member_idx: memberIdx,
            label: form.label,
            package_text: result.package_text,
          });
          return;
        }

        // copy / qr / save operate on the package built by `prepare`.
        if (!existing?.package_text) {
          throw new Error('Create the onboarding package before sharing it.');
        }
        if (kind === 'copy') {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(existing.package_text);
          }
          return;
        }
        if (kind === 'qr') {
          setState((current) => ({
            ...current,
            distributionSession: current.distributionSession
              ? {
                  ...current.distributionSession,
                  qr_package: {
                    member_idx: memberIdx,
                    label: existing.label,
                    package_text: existing.package_text,
                  },
                }
              : current.distributionSession,
          }));
          return;
        }
        if (kind === 'save') {
          const sharePublicKey =
            state.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.share_public_key ?? '';
          const saved = await saveTextToFile(
            buildProfileDownloadFilename(existing.label, sharePublicKey, 'bfonboard.txt'),
            existing.package_text,
          );
          if (saved) {
            writeResult({ ...existing, status: 'saved' });
          }
          return;
        }
      },
      async updateDistributionPermission(memberIdx, permission, enabled) {
        const nextPermissions = enabled
          ? Array.from(new Set([...(state.drafts.distributionPermissions[memberIdx] ?? []), permission]))
          : (state.drafts.distributionPermissions[memberIdx] ?? []).filter((entry) => entry !== permission);

        let runtimeSnapshot = state.runtimeSnapshot;
        const share = state.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
        if (share && runtimeSnapshot) {
          const distributionValue: PolicyOverrideValue = enabled ? 'allow' : 'deny';
          runtimeSnapshot = await adapter.applyPeerPolicy(runtimeSnapshot, share.share_public_key, 'request', permission, distributionValue);
          runtimeSnapshot = await adapter.applyPeerPolicy(runtimeSnapshot, share.share_public_key, 'respond', permission, distributionValue);
        }

        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            distributionPermissions: {
              ...current.drafts.distributionPermissions,
              [memberIdx]: nextPermissions,
            },
          },
          runtimeSnapshot,
          peerPermissionStates: runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
        }));
      },
      closeQrPackage() {
        setState((current) => ({
          ...current,
          distributionSession: current.distributionSession
            ? { ...current.distributionSession, qr_package: null }
            : null,
        }));
      },
      async startDistributionClient() {
        if (!selectedProfile) {
          throw new Error('Save the device profile before starting the onboarding client.');
        }
        if (state.runtimeSnapshot?.active) return;
        const runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPassphrase, controller);
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
      },
      async stopDistributionClient() {
        if (!state.runtimeSnapshot?.active) return;
        const runtimeSnapshot = await adapter.stopSession(state.runtimeSnapshot);
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot?.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
      },
      async finishSetup() {
        // Capture the latest runtime snapshot (peer pubkey + nonce pool negotiated
        // during distribution) so it persists into the already-stored profile before
        // we lock the device.
        let latestSnapshot = state.runtimeSnapshot;
        if (latestSnapshot?.active) {
          try {
            latestSnapshot = (await adapter.readSession(latestSnapshot)) ?? latestSnapshot;
          } catch {
            // Fall back to the last known snapshot if the live read fails.
          }
        }
        const persistedProfile = latestSnapshot?.profile ?? null;

        // Stop the live runtime session before returning to the lock screen.
        if (state.runtimeSnapshot?.active) {
          try {
            await adapter.stopSession(state.runtimeSnapshot);
          } catch {
            // Ignore stop failures while tearing down the setup session.
          }
        }

        setState((current) => ({
          ...current,
          profiles: persistedProfile
            ? current.profiles.map((entry) =>
                entry.id === persistedProfile.id
                  ? {
                      ...entry,
                      // Persisted runtime snapshots were dropped (they serialized
                      // the share seckey at rest); only carry the non-secret peer
                      // pubkey negotiated during distribution.
                      peer_pubkey: persistedProfile.peer_pubkey ?? entry.peer_pubkey ?? null,
                    }
                  : entry,
              )
            : current.profiles,
          // Purge in-memory setup secrets and return to the locked Welcome.
          pendingKeyset: null,
          selectedGeneratedShareIdx: null,
          distributionSession: null,
          runtimeSnapshot: null,
          unlockPassphrase: '',
          activeView: 'landing',
          activeDashboardTab: 'signer',
          drafts: {
            ...current.drafts,
            profileForm: { ...defaultDrafts.profileForm },
            distributionForms: {},
            distributionPermissions: {},
          },
        }));
      },
      startLoadImport() {
        setState((current) => ({ ...current, activeView: 'load-import' }));
      },
      updateImportProfileForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            importProfileForm: {
              ...current.drafts.importProfileForm,
              [field]: value,
            },
          },
        }));
      },
      updateImportProfilePassword(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            importProfileFormPassword: value,
          },
        }));
      },
      updateImportSaveForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            importSaveForm: {
              ...current.drafts.importSaveForm,
              [field]: value,
            },
          },
        }));
      },
      updateImportSavePassword(field, value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            [field === 'password' ? 'importSaveFormPassword' : 'importSaveFormConfirm']: value,
          },
        }));
      },
      async loadBfProfile() {
        let confirmation: PwaLoadConfirmation;
        try {
          confirmation = await adapter.importBfProfile({
            profileString: state.drafts.importProfileForm.profileString,
            password: state.draftSecrets.importProfileFormPassword,
          });
        } catch (error) {
          // Import failures land on the dedicated Import Error screen rather than the
          // global alert banner, matching the Paper design.
          const message = error instanceof Error && error.message.trim()
            ? error.message
            : 'We couldn’t import this profile backup.';
          setState((current) => ({
            ...current,
            pendingLoadError: message,
            activeView: 'load-error',
          }));
          return;
        }
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: confirmation,
          pendingLoadError: null,
          activeView: 'load-confirm',
          drafts: {
            ...current.drafts,
            importSaveForm: {
              ...current.drafts.importSaveForm,
              label: confirmation.preview.label,
              relayUrls: confirmation.preview.relays.join('\n'),
            },
          },
          draftSecrets: {
            ...current.draftSecrets,
            importSaveFormPassword: '',
            importSaveFormConfirm: '',
          },
        }));
      },
      clearLoadError() {
        setState((current) => ({ ...current, pendingLoadError: null, activeView: 'load-import' }));
      },
      async acceptPendingLoadConfirmation() {
        if (!state.pendingLoadConfirmation) {
          throw new Error('No confirmed profile is waiting to be loaded.');
        }
        // The local-save password is a secret: read it from draftSecrets, not
        // the persistable importSaveForm.
        const password = state.draftSecrets.importSaveFormPassword;
        const confirmPassword = state.draftSecrets.importSaveFormConfirm;
        if (!password) {
          throw new Error('Enter a password to protect this profile on the device.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        const localPassword = password;
        const profile = await adapter.finalizeLoadedProfile(
          state.pendingLoadConfirmation,
          state.profiles.map((entry) => entry.id),
          localPassword,
        );
        // The stored profile is re-encrypted under the new local password, so
        // the session must be started with that password, not the import
        // package's passphrase.
        await persistProfileToDashboard(profile, localPassword);
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: null,
          drafts: {
            ...current.drafts,
            importSaveForm: { ...defaultDrafts.importSaveForm },
          },
          peerPermissionStates:
            current.peerPermissionStates.length
              ? current.peerPermissionStates
              : adapter.defaultPeerPermissionStates(),
          draftSecrets: {
            ...current.draftSecrets,
            importProfileFormPassword: '',
            importSaveFormPassword: '',
            importSaveFormConfirm: '',
          },
        }));
      },
      updateOnboardConnectForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            onboardConnectForm: {
              ...current.drafts.onboardConnectForm,
              [field]: value,
            },
          },
        }));
      },
      updateOnboardConnectPassword(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            onboardConnectFormPassword: value,
          },
        }));
      },
      async connectOnboardingPackage() {
        // Fresh entry: release any node staged by a prior (abandoned) handshake
        // before starting a new one.
        controller.discardStagedSession();
        setState((current) => ({
          ...current,
          activeView: 'onboard-handshake',
          pendingOnboardConnection: null,
        }));
        try {
          await new Promise((resolve) => window.setTimeout(resolve, ONBOARD_HANDSHAKE_MINIMUM_MS));
          const { connection, stagedSession } = await adapter.connectOnboardingPackage({
            packageText: state.drafts.onboardConnectForm.packageText,
            password: state.draftSecrets.onboardConnectFormPassword,
            // Keep the live onboarding node alive so finalize can adopt it as the
            // durable signer (no capture-then-relaunch seam).
            keepAlive: true,
          });
          // Park the live node until the device profile is finalized + saved.
          if (stagedSession) {
            controller.stageOnboardSession(stagedSession);
          }
          setState((current) => ({
            ...current,
            pendingOnboardConnection: connection,
            activeView: 'onboard-save',
            drafts: {
              ...current.drafts,
              onboardSaveForm: {
                ...current.drafts.onboardSaveForm,
                label: connection.preview.label,
                relayUrls: connection.preview.relays.join('\n'),
              },
            },
          }));
        } catch (error) {
          setState((current) => ({
            ...current,
            activeView: 'onboard-failed',
          }));
          throw error;
        }
      },
      updateOnboardSaveForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            onboardSaveForm: {
              ...current.drafts.onboardSaveForm,
              [field]: value,
            },
          },
        }));
      },
      updateOnboardSavePassword(field, value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            [field === 'password' ? 'onboardSaveFormPassword' : 'onboardSaveFormConfirm']: value,
          },
        }));
      },
      async finalizeOnboardedDevice() {
        if (!state.pendingOnboardConnection) {
          throw new Error('Connect an onboarding package first.');
        }
        if (state.draftSecrets.onboardSaveFormPassword !== state.draftSecrets.onboardSaveFormConfirm) {
          throw new Error('Device password confirmation does not match.');
        }
        const password = state.draftSecrets.onboardSaveFormPassword;
        const profile = await adapter.finalizeOnboardedDevice({
          connection: state.pendingOnboardConnection,
          label: state.drafts.onboardSaveForm.label,
          password,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        try {
          // Adopt the live staged onboarding node as the durable signer (when
          // auto-open is enabled) instead of relaunching from a snapshot — the
          // exchanged nonce pool is already live in that node, so the device can
          // co-sign immediately with no capture-then-relaunch seam.
          await persistProfileToDashboard(profile, password, null, /* adoptStaged */ true);
        } finally {
          // Release the staged node if it was not adopted (auto-open disabled, or
          // an activation error). No-op once adopted as the active session.
          controller.discardStagedSession();
        }
        setState((current) => ({
          ...current,
          pendingOnboardConnection: null,
          pendingRotationConnection: null,
          peerPermissionStates:
            current.peerPermissionStates.length
              ? current.peerPermissionStates
              : adapter.defaultPeerPermissionStates(),
          draftSecrets: {
            ...current.draftSecrets,
            onboardConnectFormPassword: '',
            onboardSaveFormPassword: '',
            onboardSaveFormConfirm: '',
          },
        }));
      },
      cancelOnboarding() {
        // Abandon the onboard flow: tear down the staged (never-adopted) node and
        // clear the in-memory connection + device-password drafts before leaving.
        controller.discardStagedSession();
        setState((current) => ({
          ...current,
          pendingOnboardConnection: null,
          activeView: 'landing',
          draftSecrets: {
            ...current.draftSecrets,
            onboardConnectFormPassword: '',
            onboardSaveFormPassword: '',
            onboardSaveFormConfirm: '',
          },
        }));
      },
      startRotateKey() {
        if (!selectedProfile) {
          throw new Error('Select a profile first.');
        }
        setState((current) => ({
          ...current,
          activeView: 'rotate-connect',
          drafts: {
            ...current.drafts,
            rotateConnectForm: {
              packageText: '',
            },
          },
          draftSecrets: {
            ...current.draftSecrets,
            rotateConnectFormPassword: '',
          },
        }));
      },
      updateRotateConnectForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            rotateConnectForm: {
              ...current.drafts.rotateConnectForm,
              [field]: value,
            },
          },
        }));
      },
      updateRotateConnectPassword(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            rotateConnectFormPassword: value,
          },
        }));
      },
      async connectRotationPackage() {
        if (!selectedProfile) {
          throw new Error('Select a profile first.');
        }
        // Rotation derives a new keyset and starts a fresh node, so it does NOT
        // keep the onboarding node alive (no `keepAlive`); today's capture-then-
        // shutdown behavior is preserved and there is no staged session to adopt.
        const { connection } = await adapter.connectOnboardingPackage({
          packageText: state.drafts.rotateConnectForm.packageText,
          password: state.draftSecrets.rotateConnectFormPassword,
        });
        if (
          connection.profile_payload &&
          groupPublicKeyFromPackage(connection.profile_payload.groupPackage) !== selectedProfile.group_public_key
        ) {
          throw new Error('Rotation package does not match the selected profile group public key.');
        }
        if (connection.profile_payload?.profileId === selectedProfile.id) {
          throw new Error('Rotation package did not produce a new device profile id.');
        }
        setState((current) => ({
          ...current,
          pendingRotationConnection: connection,
          activeView: 'rotate-save',
        }));
      },
      async finalizeRotationUpdate() {
        if (!selectedProfile || !state.pendingRotationConnection) {
          throw new Error('Connect a rotation package first.');
        }
        // The profile being rotated is the active, unlocked one, so its
        // passphrase is the current in-memory unlock passphrase.
        const targetPassphrase = state.unlockPassphrase;
        if (!targetPassphrase.trim()) {
          throw new Error('Target profile passphrase is required to rotate.');
        }
        if (state.runtimeSnapshot?.active) {
          await adapter.stopSession(state.runtimeSnapshot, controller);
        }
        const profile = await adapter.finalizeRotationUpdateFromConnection({
          targetProfile: selectedProfile,
          targetPassphrase,
          connection: state.pendingRotationConnection,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        const newPassphrase = state.pendingRotationConnection.passphrase;
        const saved = await saveBrowserProfileAndMaybeActivate({
          profile,
          autoStart: true,
          activate: async () => await adapter.startSession(profile, newPassphrase, controller),
        });
        const runtimeSnapshot = saved.runtime;
        setState((current) => ({
          ...current,
          profiles: [
            profile,
            ...current.profiles.filter((entry) => entry.id !== selectedProfile.id && entry.id !== profile.id),
          ],
          selectedProfileId: profile.id,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
          runtimeSnapshot,
          runtimeWarning: saved.runtimeWarning?.message ?? null,
          unlockPassphrase: newPassphrase,
          pendingRotationConnection: null,
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          draftSecrets: {
            ...current.draftSecrets,
            rotateConnectFormPassword: '',
          },
        }));
      },
      async copyProfilePackage(profileId, format) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) return;
        const packageText = format === 'bfprofile' ? profile.profile_string : profile.share_string;
        if (!packageText.trim()) {
          throw new Error(`No ${format} package is available for this profile.`);
        }
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard access is unavailable in this browser.');
        }
        await navigator.clipboard.writeText(packageText);
      },
      async exportEncryptedPackage(profileId, format, exportPassword) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Select a profile first.');
        }
        if (!profile.profile_string.trim()) {
          throw new Error('No package is available to export for this profile.');
        }
        return await adapter.exportEncryptedPackage({
          profileString: profile.profile_string,
          storedPassword: state.unlockPassphrase,
          exportPassword,
          format,
        });
      },
      deleteProfile(profileId) {
        void adapter.disposeRuntimeSessionForProfile(profileId, controller);
        // Remove from the shared store explicitly (read-filter-write): the
        // debounced global persistor merges by id and would otherwise resurrect
        // a profile that is still on disk but absent from the new state.
        deleteProfileGlobal(profileId);
        setState((current) => ({
          ...current,
          profiles: current.profiles.filter((entry) => entry.id !== profileId),
          runtimeWarning:
            current.selectedProfileId === profileId ? null : current.runtimeWarning,
          selectedProfileId:
            current.selectedProfileId === profileId
              ? current.profiles.find((entry) => entry.id !== profileId)?.id ?? ''
              : current.selectedProfileId,
          runtimeSnapshot:
            current.runtimeSnapshot?.profile?.id === profileId ? null : current.runtimeSnapshot,
        }));
      },
      async updatePeerPolicy(pubkey, direction, method, value) {
        const runtimeSnapshot = await adapter.applyPeerPolicy(
          state.runtimeSnapshot,
          pubkey,
          direction,
          method,
          value,
          controller,
        );
        // D.4: null return = session drift. Leave state untouched —
        // the UI retains whatever runtimeSnapshot it last saw rather
        // than surfacing a thrown error.
        if (!runtimeSnapshot) return;
        setState((current) => ({
          ...current,
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          runtimeWarning: null,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          runtimeSnapshot,
        }));
      },
      async resolveApproval(requestId, approved) {
        await adapter.resolveApproval(state.runtimeSnapshot, requestId, approved, controller);
      },
      async clearPeerPolicies() {
        const runtimeSnapshot = await adapter.clearPeerPolicies(state.runtimeSnapshot, controller);
        if (!runtimeSnapshot) return;
        setState((current) => ({
          ...current,
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          runtimeWarning: null,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          runtimeSnapshot,
        }));
      },
      async clearLogs() {
        const runtimeSnapshot = await adapter.clearSessionLogs(state.runtimeSnapshot, controller);
        // Idempotent on snapshot/live-session drift: leave state untouched.
        if (!runtimeSnapshot) return;
        setState((current) => ({
          ...current,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
      },
      async startSigner() {
        if (!selectedProfile) return;
        if (!state.unlockPassphrase.trim()) {
          throw new Error('Enter the device passphrase to start the signer.');
        }
        let runtimeSnapshot: PwaRuntimeSnapshot;
        try {
          runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPassphrase, controller);
        } catch (error) {
          // A hard start/restore failure leaves no runtime to query, so surface
          // it as the full-panel load-failed screen on the dashboard (Retry /
          // Clear) rather than only a transient toast.
          const message = error instanceof Error && error.message.trim() ? error.message : 'Failed to start the signer.';
          setState((current) => ({
            ...current,
            dashboardLoadError: { message, at: Math.floor(Date.now() / 1000) },
            activeView: 'dashboard',
            activeDashboardTab: 'signer',
          }));
          throw error;
        }
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          runtimeWarning: null,
          dashboardLoadError: null,
          runtimeSnapshot,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
        }));
      },
      async stopSigner() {
        const runtimeSnapshot = await adapter.stopSession(state.runtimeSnapshot, controller);
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot?.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          dashboardLoadError: null,
          runtimeSnapshot,
          unlockPassphrase: '',
        }));
      },
      async refreshSigner() {
        const runtimeSnapshot = await adapter.refreshSession(state.runtimeSnapshot, controller);
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot?.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          dashboardLoadError: null,
          runtimeSnapshot,
        }));
      },
      async saveOperatorSettings(input) {
        if (!selectedProfile) return;
        const runtimeSnapshot = await adapter.applyOperatorSettings(
          selectedProfile,
          state.runtimeSnapshot,
          input,
          controller,
        );
        // D.4: null return = session drift. UI keeps its current view.
        if (!runtimeSnapshot) return;
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          runtimeSnapshot,
          activeView: 'dashboard',
          activeDashboardTab: 'settings',
        }));
      },
      async logout() {
        const stoppedSnapshot = state.runtimeSnapshot?.active
          ? await adapter.stopSession(state.runtimeSnapshot, controller)
          : null;
        setState((current) => ({
          ...current,
          profiles:
            stoppedSnapshot?.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === stoppedSnapshot.profile?.id ? stoppedSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates: adapter.defaultPeerPermissionStates(),
          runtimeWarning: null,
          runtimeSnapshot: null,
          activeView: 'landing',
          activeDashboardTab: 'signer',
          unlockPassphrase: '',
          draftSecrets: createDefaultDraftSecrets(),
        }));
      },
      async clearDeviceCredentials() {
        // Stop the live signer, then tear down every profile's runtime session.
        if (state.runtimeSnapshot?.active) {
          await adapter.stopSession(state.runtimeSnapshot, controller).catch(() => null);
        }
        for (const profile of state.profiles) {
          void adapter.disposeRuntimeSessionForProfile(profile.id, controller);
        }
        // Erase the shared device list and this tab's session, then reset to a
        // clean default in-memory state so a reload also starts fresh.
        clearGlobalState();
        clearSessionState();
        setState(() => createDefaultState());
      },
      updateSettings(field, checked) {
        setState((current) => ({
          ...current,
          settings: {
            ...current.settings,
            [field]: checked,
          },
        }));
      },
    }),
    [controller, persistProfileToDashboard, selectedProfile, state],
  );

  return (
    <SessionControllerContext.Provider value={controller}>
      <AppStore.Provider value={value}>{children}</AppStore.Provider>
    </SessionControllerContext.Provider>
  );
}

export function useStore() {
  const value = React.useContext(AppStore);
  if (!value) {
    throw new Error('StoreProvider missing');
  }
  return value;
}
