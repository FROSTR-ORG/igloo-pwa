import * as React from 'react';
import {
  buildProfileDownloadFilename,
  DEFAULT_RELAYS,
  groupPublicKeyFromPackage,
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { toPersistable } from './persist-allowlist';
import {
  clearPersistedState,
  createDebouncedPersistor,
  loadPersistedState,
  savePersistedState,
} from './storage';
import type {
  PwaDashboardTab,
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

type AppState = PwaPersistedState & {
  setActiveView: (view: PwaView) => void;
  setDashboardTab: (tab: PwaDashboardTab) => void;
  setUnlockPassphrase: (value: string) => void;
  selectProfile: (profileId: string) => void;
  loadStoredProfile: (profileId: string, passphrase: string) => Promise<void>;
  startCreateChoice: () => void;
  updateCreateForm: (field: keyof PwaDraftState['createForm'], value: string) => void;
  updateRotationForm: (field: 'sourceProfileId', value: string) => void;
  updateRotationSource: (
    index: number,
    field: 'packageText' | 'password',
    value: string,
  ) => void;
  addRotationSource: () => void;
  removeRotationSource: (index: number) => void;
  generateKeyset: () => Promise<void>;
  selectGeneratedShare: (memberIdx: number) => void;
  updateProfileForm: (field: 'label' | 'relayUrls', value: string) => void;
  updateProfileFormPassword: (field: 'password' | 'confirmPassword', value: string) => void;
  reviewGeneratedProfile: () => void;
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
  distributeShare: (memberIdx: number, kind: 'copy' | 'qr' | 'save') => Promise<void>;
  closeQrPackage: () => void;
  finishDistribution: () => void;
  startLoadChoice: () => void;
  startLoadImport: () => void;
  startRecoverFromShare: () => void;
  updateImportProfileForm: (field: 'profileString', value: string) => void;
  updateImportProfilePassword: (value: string) => void;
  updateRecoverProfileForm: (field: 'shareString', value: string) => void;
  updateRecoverProfilePassword: (value: string) => void;
  loadBfProfile: () => Promise<void>;
  recoverProfileFromShare: () => Promise<void>;
  acceptPendingLoadConfirmation: () => Promise<void>;
  updateOnboardConnectForm: (field: 'packageText', value: string) => void;
  updateOnboardConnectPassword: (value: string) => void;
  connectOnboardingPackage: () => Promise<void>;
  updateOnboardSaveForm: (field: 'label', value: string) => void;
  updateOnboardSavePassword: (field: 'password' | 'confirmPassword', value: string) => void;
  finalizeOnboardedDevice: () => Promise<void>;
  startRotateKey: () => void;
  updateRotateConnectForm: (field: 'packageText', value: string) => void;
  updateRotateConnectPassword: (value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: (targetPassphrase: string) => Promise<void>;
  copyProfilePackage: (profileId: string, format: 'bfprofile' | 'bfshare') => Promise<void>;
  deleteProfile: (profileId: string) => void;
  updatePeerPolicy: (
    pubkey: string,
    direction: 'request' | 'respond',
    method: 'ping' | 'onboard' | 'sign' | 'ecdh',
    value: boolean
  ) => Promise<void>;
  clearPeerPolicies: () => Promise<void>;
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
  },
  rotationForm: {
    sourceProfileId: '',
    sources: [{ packageText: '' }],
  },
  profileForm: {
    label: '',
    relayUrls: DEFAULT_RELAYS.join('\n'),
  },
  distributionForms: {},
  importProfileForm: {
    profileString: '',
  },
  recoverProfileForm: {
    shareString: '',
  },
  onboardConnectForm: {
    packageText: '',
  },
  onboardSaveForm: {
    label: '',
  },
  rotateConnectForm: {
    packageText: '',
  },
};

function createDefaultDraftSecrets(): PwaDraftSecrets {
  return {
    rotationSources: {},
    profileFormPassword: '',
    profileFormConfirm: '',
    distributionPasswords: {},
    importProfileFormPassword: '',
    recoverProfileFormPassword: '',
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
  const loaded = loadPersistedState();
  if (!loaded) return createDefaultState();
  const loadedActiveView = (loaded as { activeView?: string }).activeView;

  // All runtime-only / secret-bearing fields are intentionally reset on
  // every load — they are never persisted under the v2 schema.
  const normalized: PwaPersistedState = {
    ...createDefaultState(),
    ...loaded,
    unlockPassphrase: '',
    pendingKeyset: null,
    selectedGeneratedShareIdx: null,
    pendingLoadConfirmation: null,
    pendingOnboardConnection: null,
    pendingRotationConnection: null,
    distributionSession: null,
    runtimeSnapshot: null,
    // In-memory only; repopulated on each `startSession` call.
    sharePackageJsonByProfileId: {},
    draftSecrets: createDefaultDraftSecrets(),
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
            ? loaded.drafts.rotationForm.sources.map((entry) => ({ packageText: entry.packageText ?? '' }))
            : defaultDrafts.rotationForm.sources,
      },
      profileForm: { ...defaultDrafts.profileForm, ...loaded.drafts?.profileForm },
      distributionForms: loaded.drafts?.distributionForms ?? {},
      importProfileForm: {
        ...defaultDrafts.importProfileForm,
        ...loaded.drafts?.importProfileForm,
      },
      recoverProfileForm: {
        ...defaultDrafts.recoverProfileForm,
        ...loaded.drafts?.recoverProfileForm,
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

  return normalized;
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<PwaPersistedState>(() => normalizeLoadedState());
  const runtimeSnapshotRef = React.useRef<PwaRuntimeSnapshot | null>(state.runtimeSnapshot);

  React.useEffect(() => {
    runtimeSnapshotRef.current = state.runtimeSnapshot;
  }, [state.runtimeSnapshot]);

  // D.1: the v1 per-tick `savePersistedState(state)` effect is replaced
  // with a debounced persistor that writes ONLY the allow-list fields
  // produced by `toPersistable(state)`. Secrets, runtime snapshots, and
  // draft passwords never reach localStorage.
  const persistorRef = React.useRef(
    createDebouncedPersistor((snapshot) => savePersistedState(snapshot as PwaPersistedState)),
  );
  React.useEffect(
    () => () => {
      persistorRef.current.flush();
    },
    [],
  );

  React.useEffect(() => {
    if (!state.settings.remember_browser_state) {
      persistorRef.current.cancel();
      clearPersistedState();
      return;
    }
    const persistable = toPersistable(state);
    persistorRef.current.schedule(persistable as unknown as PwaPersistedState);
  }, [state]);

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

  const ensureProfileIdAvailable = React.useCallback(
    (profile: Pick<PwaProfile, 'id' | 'label'>) => {
      if (state.profiles.some((entry) => entry.id === profile.id)) {
        throw new Error(`Device profile ${profile.label} (${shortProfileId(profile.id)}) already exists.`);
      }
    },
    [state.profiles],
  );

  const persistProfileToDashboard = React.useCallback(
    async (profile: PwaProfile, passphrase: string, runtimeSnapshot?: PwaRuntimeSnapshot | null) => {
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
              activate: async () => await adapter.startSession(profile, passphrase),
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
        unlockPassphrase: passphrase,
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
        const runtimeSnapshot = await adapter.startSession(profile, passphrase);
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
      async generateKeyset() {
        const threshold = Number.parseInt(state.drafts.createForm.threshold, 10);
        const count = Number.parseInt(state.drafts.createForm.count, 10);
        const sourceProfile =
          state.drafts.createForm.mode === 'rotate'
            ? state.profiles.find((profile) => profile.id === state.drafts.rotationForm.sourceProfileId) ?? null
            : null;
        const keyset =
          state.drafts.createForm.mode === 'rotate'
            ? await adapter.createRotatedKeyset({
                groupName: state.drafts.createForm.groupName,
                threshold,
                count,
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
          activeView: 'create-profile',
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
      updateProfileFormPassword(field, value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            [field === 'password' ? 'profileFormPassword' : 'profileFormConfirm']: value,
          },
        }));
      },
      reviewGeneratedProfile() {
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
        setState((current) => ({ ...current, activeView: 'create-confirm' }));
      },
      async acceptGeneratedProfile() {
        if (!state.pendingKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        if (state.draftSecrets.profileFormPassword !== state.draftSecrets.profileFormConfirm) {
          throw new Error('Device password confirmation does not match.');
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
          activate: async () => await adapter.startSession(profile, password),
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
        const form = ensureDistributionForm(
          state.drafts.distributionForms,
          memberIdx,
          state.pendingKeyset.shares.find((share) => share.member_idx === memberIdx)?.name ?? `Member ${memberIdx}`,
        );
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

        if (kind === 'copy' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(result.package_text);
        }
        if (kind === 'save') {
          downloadText(
            buildProfileDownloadFilename(form.label, result.preview.share_public_key, 'bfonboard.txt'),
            result.package_text,
          );
        }

        setState((current) => ({
          ...current,
          distributionSession: current.distributionSession
            ? {
                ...current.distributionSession,
                results: {
                  ...current.distributionSession.results,
                  [memberIdx]: {
                    kind: kind === 'copy' ? 'copied' : kind === 'save' ? 'saved' : 'qr',
                    member_idx: memberIdx,
                    label: form.label,
                    package_text: result.package_text,
                    target_peer_pubkey: result.preview.share_public_key,
                    tracking: {
                      stage: 'waiting_for_device',
                    },
                  },
                },
                qr_package:
                  kind === 'qr'
                    ? {
                        member_idx: memberIdx,
                        label: form.label,
                        package_text: result.package_text,
                      }
                    : current.distributionSession.qr_package,
              }
            : current.distributionSession,
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
      finishDistribution() {
        setState((current) => ({
          ...current,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
        }));
      },
      startLoadChoice() {
        setState((current) => ({ ...current, activeView: 'load-choice' }));
      },
      startLoadImport() {
        setState((current) => ({ ...current, activeView: 'load-import' }));
      },
      startRecoverFromShare() {
        setState((current) => ({ ...current, activeView: 'load-recover' }));
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
      updateRecoverProfileForm(field, value) {
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            recoverProfileForm: {
              ...current.drafts.recoverProfileForm,
              [field]: value,
            },
          },
        }));
      },
      updateRecoverProfilePassword(value) {
        setState((current) => ({
          ...current,
          draftSecrets: {
            ...current.draftSecrets,
            recoverProfileFormPassword: value,
          },
        }));
      },
      async loadBfProfile() {
        const confirmation = await adapter.importBfProfile({
          profileString: state.drafts.importProfileForm.profileString,
          password: state.draftSecrets.importProfileFormPassword,
        });
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: confirmation,
          activeView: 'load-confirm',
        }));
      },
      async recoverProfileFromShare() {
        const confirmation = await adapter.recoverProfileFromBfShare({
          shareString: state.drafts.recoverProfileForm.shareString,
          password: state.draftSecrets.recoverProfileFormPassword,
        });
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: confirmation,
          activeView: 'load-confirm',
        }));
      },
      async acceptPendingLoadConfirmation() {
        if (!state.pendingLoadConfirmation) {
          throw new Error('No confirmed profile is waiting to be loaded.');
        }
        const profile = await adapter.finalizeLoadedProfile(
          state.pendingLoadConfirmation,
          state.profiles.map((entry) => entry.id),
        );
        await persistProfileToDashboard(profile, state.pendingLoadConfirmation.passphrase);
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: null,
          peerPermissionStates:
            current.peerPermissionStates.length
              ? current.peerPermissionStates
              : adapter.defaultPeerPermissionStates(),
          draftSecrets: {
            ...current.draftSecrets,
            importProfileFormPassword: '',
            recoverProfileFormPassword: '',
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
        const connection = await adapter.connectOnboardingPackage({
          packageText: state.drafts.onboardConnectForm.packageText,
          password: state.draftSecrets.onboardConnectFormPassword,
        });
        setState((current) => ({
          ...current,
          pendingOnboardConnection: connection,
          activeView: 'onboard-save',
          drafts: {
            ...current.drafts,
            onboardSaveForm: {
              ...current.drafts.onboardSaveForm,
              label: connection.preview.label,
            },
          },
        }));
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
        await persistProfileToDashboard(profile, password);
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
        const connection = await adapter.connectOnboardingPackage({
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
      async finalizeRotationUpdate(targetPassphrase) {
        if (!selectedProfile || !state.pendingRotationConnection) {
          throw new Error('Connect a rotation package first.');
        }
        if (!targetPassphrase.trim()) {
          throw new Error('Target profile passphrase is required to rotate.');
        }
        if (state.runtimeSnapshot?.active) {
          await adapter.stopSession(state.runtimeSnapshot);
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
          activate: async () => await adapter.startSession(profile, newPassphrase),
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
      async startSigner() {
        if (!selectedProfile) return;
        if (!state.unlockPassphrase.trim()) {
          throw new Error('Enter the device passphrase to start the signer.');
        }
        const runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPassphrase);
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
          unlockPassphrase: '',
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
          unlockPassphrase: '',
          draftSecrets: createDefaultDraftSecrets(),
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
