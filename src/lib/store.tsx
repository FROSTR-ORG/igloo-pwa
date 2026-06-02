import * as React from 'react';
import {
  buildProfileDownloadFilename,
  DEFAULT_RELAYS,
  groupPublicKeyFromPackage,
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { saveTextToFile } from './file-save';
import { clearPersistedState, loadPersistedState, savePersistedState } from './storage';
import type {
  PwaDashboardTab,
  PwaDistributionActionResult,
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
  setUnlockPhrase: (value: string) => void;
  selectProfile: (profileId: string) => void;
  loadStoredProfile: (profileId: string, unlockPhrase?: string) => Promise<void>;
  startCreateChoice: () => void;
  updateCreateForm: (field: keyof PwaDraftState['createForm'], value: string) => void;
  updateRotationForm: (field: keyof PwaDraftState['rotationForm'], value: string) => void;
  updateRotationSource: (
    index: number,
    field: keyof PwaDraftState['rotationForm']['sources'][number],
    value: string,
  ) => void;
  addRotationSource: () => void;
  removeRotationSource: (index: number) => void;
  generateKeyset: () => Promise<void>;
  selectGeneratedShare: (memberIdx: number) => void;
  updateProfileForm: (field: keyof PwaDraftState['profileForm'], value: string) => void;
  continueToSaveProfile: () => void;
  acceptGeneratedProfile: () => Promise<void>;
  updateDistributionForm: (
    memberIdx: number,
    field: keyof PwaDraftState['distributionForms'][number],
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
  updateImportSaveForm: (field: keyof PwaDraftState['importSaveForm'], value: string) => void;
  loadBfProfile: () => Promise<void>;
  clearLoadError: () => void;
  acceptPendingLoadConfirmation: () => Promise<void>;
  updateOnboardConnectForm: (field: keyof PwaDraftState['onboardConnectForm'], value: string) => void;
  connectOnboardingPackage: () => Promise<void>;
  updateOnboardSaveForm: (field: keyof PwaDraftState['onboardSaveForm'], value: string) => void;
  finalizeOnboardedDevice: () => Promise<void>;
  startRotateKey: () => void;
  updateRotateConnectForm: (field: keyof PwaDraftState['rotateConnectForm'], value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: () => Promise<void>;
  startRecoverKey: (profileId: string) => void;
  updateRecoverSource: (
    index: number,
    field: keyof PwaDraftState['recoverKeyForm']['sources'][number],
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
    value: boolean
  ) => Promise<void>;
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
  updateSettings: (field: keyof PwaSettings, checked: boolean) => void;
};

const AppStore = React.createContext<AppState | null>(null);

const defaultDrafts: PwaDraftState = {
  createForm: {
    mode: 'new',
    groupName: '',
    threshold: '2',
    count: '3',
    privateKey: '',
  },
  rotationForm: {
    sourceProfileId: '',
    sources: [{ packageText: '', password: '' }],
  },
  recoverKeyForm: {
    sourceProfileId: '',
    sources: [{ packageText: '', password: '' }],
  },
  profileForm: {
    label: '',
    password: '',
    confirmPassword: '',
    relayUrls: DEFAULT_RELAYS.join('\n'),
  },
  distributionForms: {},
  distributionPermissions: {},
  importProfileForm: {
    profileString: '',
    password: '',
  },
  importSaveForm: {
    label: '',
    password: '',
    confirmPassword: '',
    relayUrls: '',
  },
  onboardConnectForm: {
    packageText: '',
    password: '',
  },
  onboardSaveForm: {
    label: '',
    password: '',
    confirmPassword: '',
    relayUrls: '',
  },
  rotateConnectForm: {
    packageText: '',
    password: '',
  },
};

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
    unlockPhrase: '',
    generatedKeyset: null,
    selectedGeneratedShareIdx: null,
    pendingLoadConfirmation: null,
    pendingLoadError: null,
    pendingOnboardConnection: null,
    pendingRotationConnection: null,
    distributionSession: null,
    runtimeSnapshot: null,
    settings: defaultSettings,
    drafts: defaultDrafts,
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
      password: '',
      confirmPassword: '',
    }
  );
}

function normalizeLoadedState(): PwaPersistedState {
  const loaded = loadPersistedState();
  if (!loaded) return createDefaultState();
  const loadedActiveView = (loaded as { activeView?: string }).activeView;

  const normalized: PwaPersistedState = {
      ...createDefaultState(),
      ...loaded,
      peerPermissionStates:
        loaded.peerPermissionStates?.length ? loaded.peerPermissionStates : adapter.defaultPeerPermissionStates(),
    drafts: {
      ...defaultDrafts,
      ...loaded.drafts,
      createForm: { ...defaultDrafts.createForm, ...loaded.drafts?.createForm },
      rotationForm: {
        ...defaultDrafts.rotationForm,
        ...loaded.drafts?.rotationForm,
        sources:
          loaded.drafts?.rotationForm?.sources?.length
            ? loaded.drafts.rotationForm.sources
            : defaultDrafts.rotationForm.sources,
      },
      recoverKeyForm: {
        ...defaultDrafts.recoverKeyForm,
        ...loaded.drafts?.recoverKeyForm,
        sources:
          loaded.drafts?.recoverKeyForm?.sources?.length
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

  if (!normalized.profiles.length && normalized.activeView === 'dashboard') {
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
  if ((loadedActiveView === 'create-profile' || loadedActiveView === 'create-confirm') && normalized.generatedKeyset) {
    normalized.activeView = 'create-select-share';
  }

  return normalized;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PwaPersistedState>(() => normalizeLoadedState());
  const restoredRuntimeProfileRef = React.useRef<string | null>(null);
  const runtimeSnapshotRef = React.useRef<PwaRuntimeSnapshot | null>(state.runtimeSnapshot);
  const shouldRestorePersistedRuntimeRef = React.useRef(Boolean(state.runtimeSnapshot?.active));

  React.useEffect(() => {
    runtimeSnapshotRef.current = state.runtimeSnapshot;
  }, [state.runtimeSnapshot]);

  React.useEffect(() => {
    if (state.settings.remember_browser_state) {
      savePersistedState(state);
    } else {
      clearPersistedState();
    }
  }, [state]);

  const selectedProfile = React.useMemo(
    () => state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null,
    [state.profiles, state.selectedProfileId],
  );

  React.useEffect(() => {
    if (!shouldRestorePersistedRuntimeRef.current) {
      restoredRuntimeProfileRef.current = null;
      return;
    }
    const profile = selectedProfile;
    if (!profile?.runtime_snapshot_json || !state.runtimeSnapshot?.active) {
      restoredRuntimeProfileRef.current = null;
      return;
    }
    if (restoredRuntimeProfileRef.current === profile.id) return;
    shouldRestorePersistedRuntimeRef.current = false;
    restoredRuntimeProfileRef.current = profile.id;
    void adapter
      .startSession(profile, state.unlockPhrase || profile.stored_password)
      .then((runtimeSnapshot) => {
        setState((current) => ({
          ...current,
          runtimeSnapshot,
          runtimeWarning: null,
          profiles: current.profiles.map((entry) =>
            entry.id === profile.id && runtimeSnapshot.profile
              ? {
                  ...entry,
                  runtime_snapshot_json:
                    runtimeSnapshot.profile.runtime_snapshot_json ?? entry.runtime_snapshot_json ?? null,
                }
              : entry,
          ),
        }));
      })
      .catch(() => undefined);
  }, [selectedProfile, state.runtimeSnapshot?.active, state.unlockPhrase]);

  React.useEffect(() => {
    const activeProfileId = state.runtimeSnapshot?.active ? state.runtimeSnapshot.profile?.id ?? null : null;
    if (!activeProfileId) return;

    let cancelled = false;

    const syncRuntimeSnapshot = async () => {
      const currentSnapshot = runtimeSnapshotRef.current;
      if (!currentSnapshot?.active || currentSnapshot.profile?.id !== activeProfileId) return;

      try {
        const runtimeSnapshot = await adapter.readSession(currentSnapshot);
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
  }, [state.runtimeSnapshot?.active, state.runtimeSnapshot?.profile?.id]);

  // Mark a share onboarded when the live runtime serves an onboard response to
  // the matching peer (the real onboard-complete signal from bifrost-rs).
  React.useEffect(() => {
    adapter.setOnboardCompleteListener((peerPubkey) => {
      const normalized = normalizePeerKey(peerPubkey);
      setState((current) => {
        if (!current.distributionSession || !current.generatedKeyset) return current;
        const share = current.generatedKeyset.shares.find(
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
    async (profile: PwaProfile, password: string, runtimeSnapshot?: PwaRuntimeSnapshot | null) => {
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
              activate: async () => await adapter.startSession(profile, password),
            });
      const snapshot = saved.runtime;
      const storedProfile = (snapshot?.profile ?? saved.profile) as PwaProfile;

      setState((current) => ({
        ...current,
        profiles: [storedProfile, ...current.profiles.filter((entry) => entry.id !== storedProfile.id)],
        peerPermissionStates:
          snapshot?.peer_permission_states ?? current.peerPermissionStates ?? adapter.defaultPeerPermissionStates(),
        runtimeWarning: saved.runtimeWarning?.message ?? null,
        selectedProfileId: storedProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: snapshot,
        unlockPhrase: password,
      }));
    },
    [ensureProfileIdAvailable, state.settings.auto_open_signer],
  );

  const value = React.useMemo<AppState>(
    () => ({
      ...state,
      setActiveView(view) {
        setState((current) => ({ ...current, activeView: view }));
      },
      setDashboardTab(tab) {
        setState((current) => ({ ...current, activeDashboardTab: tab, activeView: 'dashboard' }));
      },
      setUnlockPhrase(value) {
        setState((current) => ({ ...current, unlockPhrase: value }));
      },
      selectProfile(profileId) {
        setState((current) => ({ ...current, selectedProfileId: profileId }));
      },
      async loadStoredProfile(profileId, unlockPhrase) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Profile not found.');
        }
        const password = unlockPhrase ?? profile.stored_password;
        const runtimeSnapshot = await adapter.startSession(profile, password);
        setState((current) => ({
          ...current,
          selectedProfileId: profile.id,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
          unlockPhrase: password,
          runtimeSnapshot,
          runtimeWarning: null,
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          profiles: current.profiles.map((entry) =>
            entry.id === profile.id && runtimeSnapshot.profile ? runtimeSnapshot.profile : entry,
          ),
        }));
      },
      startCreateChoice() {
        setState((current) => ({ ...current, activeView: 'create-choice' }));
      },
      updateCreateForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            createForm: {
              ...current.drafts.createForm,
              [field]: value,
            },
          },
        }));
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
        setState((current) => ({
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
        }));
      },
      addRotationSource() {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            rotationForm: {
              ...current.drafts.rotationForm,
              sources: [...current.drafts.rotationForm.sources, { packageText: '', password: '' }],
            },
          },
        }));
      },
      removeRotationSource(index) {
        setState((current) => ({
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
              sources: [{ packageText: '', password: '' }],
            },
          },
        }));
      },
      updateRecoverSource(index, field, value) {
        setState((current) => ({
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
        }));
      },
      addRecoverSource() {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              ...current.drafts.recoverKeyForm,
              sources: [...current.drafts.recoverKeyForm.sources, { packageText: '', password: '' }],
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
        const recovered = await adapter.recoverNsecFromShares({
          sources: state.drafts.recoverKeyForm.sources
            .map((source) => ({
              packageText: source.packageText.trim(),
              password: source.password,
            }))
            .filter((source) => source.packageText && source.password),
        });
        // The reconstructed key is never persisted; it is returned to the caller for
        // in-memory display and the source inputs are cleared immediately.
        setState((current) => ({
          ...current,
          activeView: 'recover-key',
          drafts: {
            ...current.drafts,
            recoverKeyForm: defaultDrafts.recoverKeyForm,
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
        const keyset =
          state.drafts.createForm.mode === 'rotate'
            ? await adapter.createRotatedKeyset({
                groupName: rotationGroupName,
                threshold,
                count,
                sources: state.drafts.rotationForm.sources
                  .map((source) => ({
                    packageText: source.packageText.trim(),
                    password: source.password,
                  }))
                  .filter((source) => source.packageText && source.password),
              })
            : await adapter.createGeneratedKeyset({
                groupName: state.drafts.createForm.groupName,
                threshold,
                count,
                privateKey: state.drafts.createForm.privateKey,
              });
        const preferredMemberIdx =
          sourceProfile && typeof sourceProfile.share_package_json === 'string'
            ? Number.parseInt(
                String((JSON.parse(sourceProfile.share_package_json) as { idx?: number | string }).idx ?? ''),
                10,
              )
            : NaN;
        const selectedShare =
          keyset.shares.find((share) => share.member_idx === preferredMemberIdx) ?? keyset.shares[0];
        setState((current) => ({
          ...current,
          generatedKeyset: keyset,
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
                current.generatedKeyset?.shares.find((share) => share.member_idx === memberIdx)?.name ??
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
        if (!state.generatedKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        setState((current) => ({ ...current, activeView: 'create-save-profile' }));
      },
      async acceptGeneratedProfile() {
        if (!state.generatedKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        if (!state.drafts.profileForm.label.trim()) {
          throw new Error('Device profile name is required.');
        }
        if (!state.drafts.profileForm.password) {
          throw new Error('Device password is required.');
        }
        if (state.drafts.profileForm.password !== state.drafts.profileForm.confirmPassword) {
          throw new Error('Device password confirmation does not match.');
        }
        if (!state.drafts.profileForm.relayUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).length) {
          throw new Error('At least one relay is required.');
        }

        const profile = await adapter.createDeviceProfileFromGeneratedShare({
          keyset: state.generatedKeyset,
          shareMemberIdx: state.selectedGeneratedShareIdx,
          label: state.drafts.profileForm.label,
          password: state.drafts.profileForm.password,
          relayUrls: state.drafts.profileForm.relayUrls,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        const saved = await saveBrowserProfileAndMaybeActivate({
          profile,
          autoStart: true,
          activate: async () => await adapter.startSession(profile, state.drafts.profileForm.password),
        });
        const runtimeSnapshot = saved.runtime;
        const remaining = state.generatedKeyset.shares
          .map((share) => share.member_idx)
          .filter((memberIdx) => memberIdx !== state.selectedGeneratedShareIdx);

        setState((current) => ({
          ...current,
          profiles: [profile, ...current.profiles.filter((entry) => entry.id !== profile.id)],
          selectedProfileId: profile.id,
          activeView: 'create-distribute',
          activeDashboardTab: 'signer',
          unlockPhrase: state.drafts.profileForm.password,
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
                const share = state.generatedKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
                return [
                  memberIdx,
                  {
                    label: share?.name ?? `Member ${memberIdx}`,
                    password: '',
                    confirmPassword: '',
                  },
                ];
              }),
            ),
            distributionPermissions: Object.fromEntries(
              remaining.map((memberIdx) => [memberIdx, ['sign', 'ecdh', 'ping', 'onboard']]),
            ),
          },
        }));
      },
      updateDistributionForm(memberIdx, field, value) {
        setState((current) => {
          const share = current.generatedKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
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
      async distributeShare(memberIdx, kind) {
        if (!state.generatedKeyset || !state.distributionSession || !selectedProfile) {
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
            state.generatedKeyset.shares.find((share) => share.member_idx === memberIdx)?.name ?? `Member ${memberIdx}`,
          );
          if (form.password !== form.confirmPassword) {
            throw new Error('Share password confirmation does not match.');
          }
          if (!form.label.trim()) {
            throw new Error('Share name is required.');
          }

          const result = await adapter.createOnboardingPackageForShare({
            keyset: state.generatedKeyset,
            shareMemberIdx: memberIdx,
            label: form.label,
            password: form.password,
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
            state.generatedKeyset.shares.find((share) => share.member_idx === memberIdx)?.share_public_key ?? '';
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
        const share = state.generatedKeyset?.shares.find((entry) => entry.member_idx === memberIdx);
        if (share && runtimeSnapshot) {
          runtimeSnapshot = await adapter.applyPeerPolicy(runtimeSnapshot, share.share_public_key, 'request', permission, enabled);
          runtimeSnapshot = await adapter.applyPeerPolicy(runtimeSnapshot, share.share_public_key, 'respond', permission, enabled);
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
        const runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPhrase);
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
                      runtime_snapshot_json:
                        persistedProfile.runtime_snapshot_json ?? entry.runtime_snapshot_json ?? null,
                      peer_pubkey: persistedProfile.peer_pubkey ?? entry.peer_pubkey ?? null,
                    }
                  : entry,
              )
            : current.profiles,
          // Purge in-memory setup secrets and return to the locked Welcome.
          generatedKeyset: null,
          selectedGeneratedShareIdx: null,
          distributionSession: null,
          runtimeSnapshot: null,
          unlockPhrase: '',
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
      async loadBfProfile() {
        let confirmation: PwaLoadConfirmation;
        try {
          confirmation = await adapter.importBfProfile(state.drafts.importProfileForm);
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
              password: '',
              confirmPassword: '',
            },
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
        const { password, confirmPassword } = state.drafts.importSaveForm;
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
      async connectOnboardingPackage() {
        setState((current) => ({
          ...current,
          activeView: 'onboard-handshake',
          pendingOnboardConnection: null,
        }));
        try {
          await new Promise((resolve) => window.setTimeout(resolve, ONBOARD_HANDSHAKE_MINIMUM_MS));
          const connection = await adapter.connectOnboardingPackage(state.drafts.onboardConnectForm);
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
      async finalizeOnboardedDevice() {
        if (!state.pendingOnboardConnection) {
          throw new Error('Connect an onboarding package first.');
        }
        if (state.drafts.onboardSaveForm.password !== state.drafts.onboardSaveForm.confirmPassword) {
          throw new Error('Device password confirmation does not match.');
        }
        const profile = await adapter.finalizeOnboardedDevice({
          connection: state.pendingOnboardConnection,
          label: state.drafts.onboardSaveForm.label,
          password: state.drafts.onboardSaveForm.password,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        await persistProfileToDashboard(profile, state.drafts.onboardSaveForm.password);
        setState((current) => ({
          ...current,
          pendingOnboardConnection: null,
          pendingRotationConnection: null,
          peerPermissionStates:
            current.peerPermissionStates.length
              ? current.peerPermissionStates
              : adapter.defaultPeerPermissionStates(),
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
              password: '',
            },
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
      async connectRotationPackage() {
        if (!selectedProfile) {
          throw new Error('Select a profile first.');
        }
        const connection = await adapter.connectOnboardingPackage({
          packageText: state.drafts.rotateConnectForm.packageText,
          password: state.drafts.rotateConnectForm.password,
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
        if (state.runtimeSnapshot?.active) {
          await adapter.stopSession(state.runtimeSnapshot);
        }
        const profile = await adapter.finalizeRotationUpdateFromConnection({
          targetProfile: selectedProfile,
          connection: state.pendingRotationConnection,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        const saved = await saveBrowserProfileAndMaybeActivate({
          profile,
          autoStart: true,
          activate: async () => await adapter.startSession(profile, profile.stored_password),
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
          unlockPhrase: profile.stored_password,
          pendingRotationConnection: null,
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
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
          storedPassword: profile.stored_password,
          exportPassword,
          format,
        });
      },
      deleteProfile(profileId) {
        void adapter.disposeRuntimeSessionForProfile(profileId);
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
        );
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
      async clearPeerPolicies() {
        const runtimeSnapshot = await adapter.clearPeerPolicies(state.runtimeSnapshot);
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
        const runtimeSnapshot = await adapter.clearSessionLogs(state.runtimeSnapshot);
        setState((current) => ({
          ...current,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
      },
      async startSigner() {
        if (!selectedProfile) return;
        const runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPhrase);
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
          runtimeSnapshot,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
        }));
      },
      async stopSigner() {
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
      async refreshSigner() {
        const runtimeSnapshot = await adapter.refreshSession(state.runtimeSnapshot);
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
      async saveOperatorSettings(input) {
        if (!selectedProfile) return;
        const runtimeSnapshot = await adapter.applyOperatorSettings(selectedProfile, state.runtimeSnapshot, input);
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
          ? await adapter.stopSession(state.runtimeSnapshot)
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
          unlockPhrase: '',
        }));
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
    [persistProfileToDashboard, selectedProfile, state],
  );

  return <AppStore.Provider value={value}>{children}</AppStore.Provider>;
}

export function useStore() {
  const value = React.useContext(AppStore);
  if (!value) {
    throw new Error('StoreProvider missing');
  }
  return value;
}
