import * as React from 'react';
import { flushSync } from 'react-dom';
import {
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
  type PolicyOverrideValue,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { toPersistableGlobal, toPersistableSession } from './persist-allowlist';
import { SessionController } from './session-controller';
import { createCreateActions } from './store-create';
import { createDashboardActions } from './store-dashboard';
import { createDistributionActions } from './store-distribution';
import { createImportActions } from './store-import';
import { createOnboardActions } from './store-onboard';
import { createRecoverActions } from './store-recover';
import { createRotateActions } from './store-rotate';
import {
  clearGlobalState,
  clearSessionState,
  createDebouncedPersistor,
  saveGlobalState,
  saveSessionState,
  subscribeGlobalState,
} from './storage';
import {
  createDefaultDraftSecrets,
  createDefaultState,
  defaultDrafts,
  ensureDistributionForm,
  ensureDistributionPasswordSlot,
  normalizeLoadedState,
} from './store-hydrate';
import { setDraftFormField, setDraftSecretField } from './store-drafts';
import type {
  PwaDashboardTab,
  PwaDraftState,
  PwaPeerPermissionState,
  PwaPersistedState,
  PwaProfile,
  PwaRuntimeSnapshot,
  PwaSignerSettings,
  PwaSettings,
  PwaView,
} from './types';

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
  pingPeer: (pubkey: string) => Promise<void>;
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

type AppActions = Omit<AppState, keyof PwaPersistedState>;

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

const ACTIVE_RUNTIME_POLL_INTERVAL_MS = 1_000;

// Normalize a pubkey for comparison: lowercase and drop a compressed-point
// prefix so an x-only key and a 33-byte key compare equal.
function normalizePeerKey(value: string) {
  const lower = value.trim().toLowerCase();
  return lower.length === 66 && (lower.startsWith('02') || lower.startsWith('03'))
    ? lower.slice(2)
    : lower;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PwaPersistedState>(() => normalizeLoadedState());
  const stateRef = React.useRef(state);
  const runtimeSnapshotRef = React.useRef<PwaRuntimeSnapshot | null>(state.runtimeSnapshot);
  const distributionRestartInFlightRef = React.useRef(false);
  stateRef.current = state;

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

  const getState = React.useCallback(() => stateRef.current, []);

  const getSelectedProfile = React.useCallback(() => {
    const snapshot = stateRef.current;
    return snapshot.profiles.find((profile) => profile.id === snapshot.selectedProfileId) ?? null;
  }, []);

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

  const hasPendingKeyset = state.pendingKeyset != null;
  const hasDistributionSession = state.distributionSession != null;

  React.useEffect(() => {
    const shouldKeepDistributionClientRunning =
      state.activeView === 'create-distribute' &&
      hasPendingKeyset &&
      hasDistributionSession &&
      state.selectedProfileId.length > 0 &&
      state.unlockPassphrase.length > 0 &&
      !state.runtimeSnapshot?.active;

    if (!shouldKeepDistributionClientRunning || distributionRestartInFlightRef.current) {
      return;
    }

    const selectedProfile = stateRef.current.profiles.find(
      (profile) => profile.id === state.selectedProfileId,
    );
    if (!selectedProfile) return;

    let cancelled = false;
    distributionRestartInFlightRef.current = true;

    void adapter
      .startSession(selectedProfile, state.unlockPassphrase, controller)
      .then((runtimeSnapshot) => {
        if (cancelled) return;
        setState((current) => {
          if (
            current.activeView !== 'create-distribute' ||
            !current.pendingKeyset ||
            !current.distributionSession ||
            current.selectedProfileId !== selectedProfile.id ||
            current.runtimeSnapshot?.active
          ) {
            return current;
          }
          return {
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
          };
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState((current) => {
          if (
            current.activeView !== 'create-distribute' ||
            !current.pendingKeyset ||
            !current.distributionSession ||
            current.selectedProfileId !== selectedProfile.id ||
            current.runtimeSnapshot?.active
          ) {
            return current;
          }
          return {
            ...current,
            runtimeWarning:
              error instanceof Error ? error.message : 'Failed to restart onboarding client.',
          };
        });
      })
      .finally(() => {
        if (!cancelled) {
          distributionRestartInFlightRef.current = false;
        }
      });

    return () => {
      cancelled = true;
      distributionRestartInFlightRef.current = false;
    };
  }, [
    controller,
    state.activeView,
    hasDistributionSession,
    hasPendingKeyset,
    state.runtimeSnapshot?.active,
    state.selectedProfileId,
    state.unlockPassphrase,
  ]);

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
      if (getState().profiles.some((entry) => entry.id === profile.id)) {
        throw new Error(`Device profile ${profile.label} (${shortProfileId(profile.id)}) already exists.`);
      }
    },
    [getState],
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
      const currentState = getState();
      const saved =
        runtimeSnapshot != null
          ? {
              profile: runtimeSnapshot.profile ?? profile,
              runtime: runtimeSnapshot,
              runtimeWarning: null,
            }
          : await saveBrowserProfileAndMaybeActivate({
              profile,
              autoStart: currentState.settings.auto_open_signer,
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
    [controller, ensureProfileIdAvailable, getState, persistImmediately],
  );

  const actions = React.useMemo<AppActions>(
    () => ({
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
        const snapshot = getState();
        const profile = snapshot.profiles.find((entry) => entry.id === profileId);
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
      ...createCreateActions({ controller, getState, setState }),
      ...createRecoverActions({ getState, getSelectedProfile, setState }),
      ...createDistributionActions({ controller, getState, getSelectedProfile, setState }),
      ...createImportActions({ getState, setState, persistProfileToDashboard }),
      ...createOnboardActions({ controller, getState, setState, persistProfileToDashboard }),
      ...createRotateActions({ controller, getState, getSelectedProfile, setState }),
      ...createDashboardActions({ controller, getState, getSelectedProfile, setState }),
    }),
    [controller, getSelectedProfile, getState, persistProfileToDashboard],
  );

  const value = React.useMemo<AppState>(
    () => ({
      ...state,
      ...actions,
    }),
    [actions, state],
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
