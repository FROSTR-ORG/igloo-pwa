import * as React from 'react';
import { flushSync } from 'react-dom';
import {
  buildProfileDownloadFilename,
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
  type PolicyOverrideValue,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { saveTextToFile } from './file-save';
import { toPersistableGlobal, toPersistableSession } from './persist-allowlist';
import { SessionController } from './session-controller';
import { createCreateActions } from './store-create';
import { createImportActions } from './store-import';
import { createOnboardActions } from './store-onboard';
import { createRotateActions } from './store-rotate';
import {
  clearGlobalState,
  clearSessionState,
  createDebouncedPersistor,
  deleteProfileGlobal,
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
  PwaDistributionActionResult,
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
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!selectedProfile) {
          return;
        }
        const verified = await adapter.verifyDeviceShareUnlock({
          encryptedShareArtifact: selectedProfile.encrypted_bfshare_artifact,
          devicePassphrase: snapshot.draftSecrets.recoverDevicePassphrase,
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
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!selectedProfile) {
          throw new Error('Select a device profile to recover its key.');
        }
        const lostDevice = snapshot.draftSecrets.recoverLostDevice;
        // Normal path: the recovering device is a group member, so its profile
        // supplies the group package (public) and its own share (unlocked with the
        // device passphrase), which counts toward the threshold; the rest are pasted.
        // Lost-device path: the device share/passphrase are omitted and the full
        // threshold is met from pasted shares alone.
        const recovered = await adapter.recoverNsecFromShares({
          groupPackageJson: selectedProfile.group_package_json,
          encryptedShareArtifact: lostDevice ? null : selectedProfile.encrypted_bfshare_artifact,
          devicePassphrase: lostDevice ? null : snapshot.draftSecrets.recoverDevicePassphrase,
          sources: snapshot.drafts.recoverKeyForm.sources
            .map((source, index) => ({
              packageText: source.packageText.trim(),
              password: snapshot.draftSecrets.recoverKeySources[index] ?? '',
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
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!snapshot.pendingKeyset || !snapshot.distributionSession || !selectedProfile) {
          throw new Error('Create the primary device profile before distributing shares.');
        }
        const existing = snapshot.distributionSession.results[memberIdx];

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
            snapshot.drafts.distributionForms,
            memberIdx,
            snapshot.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.name ?? `Member ${memberIdx}`,
          );
          // Share password lives in the segregated draftSecrets partition, not
          // on the persistable distribution form.
          const passwordSlot = ensureDistributionPasswordSlot(
            snapshot.draftSecrets.distributionPasswords,
            memberIdx,
          );
          if (passwordSlot.password !== passwordSlot.confirmPassword) {
            throw new Error('Share password confirmation does not match.');
          }
          if (!form.label.trim()) {
            throw new Error('Share name is required.');
          }

          const result = await adapter.createOnboardingPackageForShare({
            keyset: snapshot.pendingKeyset,
            shareMemberIdx: memberIdx,
            label: form.label,
            password: passwordSlot.password,
            relayUrls: selectedProfile.relays.join('\n'),
            signerPubkey: snapshot.distributionSession.signer_pubkey,
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
            snapshot.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.share_public_key ?? '';
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
        const snapshot = getState();
        const nextPermissions = enabled
          ? Array.from(new Set([...(snapshot.drafts.distributionPermissions[memberIdx] ?? []), permission]))
          : (snapshot.drafts.distributionPermissions[memberIdx] ?? []).filter((entry) => entry !== permission);

        let runtimeSnapshot = snapshot.runtimeSnapshot;
        const share = snapshot.pendingKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
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
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!selectedProfile) {
          throw new Error('Save the device profile before starting the onboarding client.');
        }
        if (snapshot.runtimeSnapshot?.active) return;
        const runtimeSnapshot = await adapter.startSession(selectedProfile, snapshot.unlockPassphrase, controller);
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
        const snapshot = getState();
        if (!snapshot.runtimeSnapshot?.active) return;
        const runtimeSnapshot = await adapter.stopSession(snapshot.runtimeSnapshot);
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
        const snapshot = getState();
        // Capture the latest runtime snapshot (peer pubkey + nonce pool negotiated
        // during distribution) so it persists into the already-stored profile before
        // we lock the device.
        let latestSnapshot = snapshot.runtimeSnapshot;
        if (latestSnapshot?.active) {
          try {
            latestSnapshot = (await adapter.readSession(latestSnapshot)) ?? latestSnapshot;
          } catch {
            // Fall back to the last known snapshot if the live read fails.
          }
        }
        const persistedProfile = latestSnapshot?.profile ?? null;

        // Stop the live runtime session before returning to the lock screen.
        if (snapshot.runtimeSnapshot?.active) {
          try {
            await adapter.stopSession(snapshot.runtimeSnapshot);
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
      ...createImportActions({ getState, setState, persistProfileToDashboard }),
      ...createOnboardActions({ controller, getState, setState, persistProfileToDashboard }),
      ...createRotateActions({ controller, getState, getSelectedProfile, setState }),
      async copyProfilePackage(profileId, format) {
        const snapshot = getState();
        const profile = snapshot.profiles.find((entry) => entry.id === profileId);
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
        const snapshot = getState();
        const profile = snapshot.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Select a profile first.');
        }
        if (!profile.profile_string.trim()) {
          throw new Error('No package is available to export for this profile.');
        }
        return await adapter.exportEncryptedPackage({
          profileString: profile.profile_string,
          storedPassword: snapshot.unlockPassphrase,
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
        const snapshot = getState();
        const runtimeSnapshot = await adapter.applyPeerPolicy(
          snapshot.runtimeSnapshot,
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
        const snapshot = getState();
        await adapter.resolveApproval(snapshot.runtimeSnapshot, requestId, approved, controller);
      },
      async clearPeerPolicies() {
        const snapshot = getState();
        const runtimeSnapshot = await adapter.clearPeerPolicies(snapshot.runtimeSnapshot, controller);
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
        const snapshot = getState();
        const runtimeSnapshot = await adapter.clearSessionLogs(snapshot.runtimeSnapshot, controller);
        // Idempotent on snapshot/live-session drift: leave state untouched.
        if (!runtimeSnapshot) return;
        setState((current) => ({
          ...current,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
      },
      async startSigner() {
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!selectedProfile) return;
        if (!snapshot.unlockPassphrase.trim()) {
          throw new Error('Enter the device passphrase to start the signer.');
        }
        let runtimeSnapshot: PwaRuntimeSnapshot;
        try {
          runtimeSnapshot = await adapter.startSession(selectedProfile, snapshot.unlockPassphrase, controller);
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
        const snapshot = getState();
        const runtimeSnapshot = await adapter.stopSession(snapshot.runtimeSnapshot, controller);
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
        const snapshot = getState();
        const runtimeSnapshot = await adapter.refreshSession(snapshot.runtimeSnapshot, controller);
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
        const snapshot = getState();
        const selectedProfile = getSelectedProfile();
        if (!selectedProfile) return;
        const runtimeSnapshot = await adapter.applyOperatorSettings(
          selectedProfile,
          snapshot.runtimeSnapshot,
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
        const snapshot = getState();
        const stoppedSnapshot = snapshot.runtimeSnapshot?.active
          ? await adapter.stopSession(snapshot.runtimeSnapshot, controller)
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
        const snapshot = getState();
        // Stop the live signer, then tear down every profile's runtime session.
        if (snapshot.runtimeSnapshot?.active) {
          await adapter.stopSession(snapshot.runtimeSnapshot, controller).catch(() => null);
        }
        for (const profile of snapshot.profiles) {
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
