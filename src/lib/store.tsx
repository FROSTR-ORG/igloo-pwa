import * as React from 'react';
import { buildProfileDownloadFilename, shortProfileId } from 'igloo-shared';

import * as adapter from './local-adapter';
import { clearPersistedState, loadPersistedState, savePersistedState } from './storage';
import type {
  PwaDashboardTab,
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
  setUnlockPhrase: (value: string) => void;
  selectProfile: (profileId: string) => void;
  loadStoredProfile: (profileId: string) => Promise<void>;
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
  reviewGeneratedProfile: () => void;
  acceptGeneratedProfile: () => Promise<void>;
  updateDistributionForm: (
    memberIdx: number,
    field: keyof PwaDraftState['distributionForms'][number],
    value: string,
  ) => void;
  distributeShare: (memberIdx: number, kind: 'copy' | 'qr' | 'save') => Promise<void>;
  closeQrPackage: () => void;
  finishDistribution: () => void;
  startLoadChoice: () => void;
  startLoadImport: () => void;
  startRecoverFromShare: () => void;
  updateImportProfileForm: (field: keyof PwaDraftState['importProfileForm'], value: string) => void;
  updateRecoverProfileForm: (field: keyof PwaDraftState['recoverProfileForm'], value: string) => void;
  loadBfProfile: () => Promise<void>;
  recoverProfileFromShare: () => Promise<void>;
  acceptPendingLoadConfirmation: () => Promise<void>;
  updateOnboardConnectForm: (field: keyof PwaDraftState['onboardConnectForm'], value: string) => void;
  connectOnboardingPackage: () => Promise<void>;
  updateOnboardSaveForm: (field: keyof PwaDraftState['onboardSaveForm'], value: string) => void;
  finalizeOnboardedDevice: () => Promise<void>;
  startRotateKey: () => void;
  updateRotateConnectForm: (field: keyof PwaDraftState['rotateConnectForm'], value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: () => Promise<void>;
  exportProfile: (profileId: string) => Promise<void>;
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
  updateSettings: (field: keyof PwaSettings, checked: boolean) => void;
  resetApp: () => void;
};

const AppStore = React.createContext<AppState | null>(null);

const defaultDrafts: PwaDraftState = {
  createForm: {
    mode: 'new',
    keysetName: '',
    threshold: '2',
    count: '3',
  },
  rotationForm: {
    sourceProfileId: '',
    sources: [{ packageText: '', password: '' }],
  },
  profileForm: {
    label: '',
    password: '',
    confirmPassword: '',
    relayUrls: 'wss://relay.primal.net',
  },
  distributionForms: {},
  importProfileForm: {
    profileString: '',
    password: '',
  },
  recoverProfileForm: {
    shareString: '',
    password: '',
  },
  onboardConnectForm: {
    packageText: '',
    password: '',
  },
  onboardSaveForm: {
    label: '',
    password: '',
    confirmPassword: '',
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

function createDefaultState(): PwaPersistedState {
  return {
    profiles: [],
    peerPermissionStates: adapter.defaultPeerPermissionStates(),
    selectedProfileId: '',
    activeView: 'landing',
    activeDashboardTab: 'signer',
    unlockPhrase: '',
    generatedKeyset: null,
    selectedGeneratedShareIdx: null,
    pendingLoadConfirmation: null,
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
  const restoredRuntimeProfileRef = React.useRef<string | null>(null);

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
    const profile = selectedProfile;
    if (!profile?.runtime_snapshot_json || !state.runtimeSnapshot?.active) {
      restoredRuntimeProfileRef.current = null;
      return;
    }
    if (restoredRuntimeProfileRef.current === profile.id) return;
    restoredRuntimeProfileRef.current = profile.id;
    void adapter
      .startSession(profile, state.unlockPhrase || profile.stored_password)
      .then((runtimeSnapshot) => {
        setState((current) => ({
          ...current,
          runtimeSnapshot,
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
      const snapshot =
        runtimeSnapshot ?? (state.settings.auto_open_signer ? await adapter.startSession(profile, password) : null);
      const storedProfile = snapshot?.profile ?? profile;

      setState((current) => ({
        ...current,
        profiles: [storedProfile, ...current.profiles.filter((entry) => entry.id !== storedProfile.id)],
        peerPermissionStates:
          snapshot?.peer_permission_states ?? current.peerPermissionStates ?? adapter.defaultPeerPermissionStates(),
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
      async loadStoredProfile(profileId) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Profile not found.');
        }
        const runtimeSnapshot = await adapter.startSession(profile, profile.stored_password);
        setState((current) => ({
          ...current,
          selectedProfileId: profile.id,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
          unlockPhrase: profile.stored_password,
          runtimeSnapshot,
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
                keysetName: state.drafts.createForm.keysetName,
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
                keysetName: state.drafts.createForm.keysetName,
                threshold,
                count,
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
          activeView: 'create-profile',
          drafts: {
            ...current.drafts,
            profileForm: {
              ...current.drafts.profileForm,
              label: sourceProfile?.label ?? selectedShare?.name ?? `${keyset.keyset_name} Device`,
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
      reviewGeneratedProfile() {
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
        setState((current) => ({ ...current, activeView: 'create-confirm' }));
      },
      async acceptGeneratedProfile() {
        if (!state.generatedKeyset || state.selectedGeneratedShareIdx == null) {
          throw new Error('Generate a keyset and choose one share first.');
        }
        if (state.drafts.profileForm.password !== state.drafts.profileForm.confirmPassword) {
          throw new Error('Device password confirmation does not match.');
        }

        const profile = await adapter.createDeviceProfileFromGeneratedShare({
          keyset: state.generatedKeyset,
          shareMemberIdx: state.selectedGeneratedShareIdx,
          label: state.drafts.profileForm.label,
          password: state.drafts.profileForm.password,
          relayUrls: state.drafts.profileForm.relayUrls,
          existingProfileIds: state.profiles.map((entry) => entry.id),
        });
        const runtimeSnapshot = await adapter.startSession(profile, state.drafts.profileForm.password);
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
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          distributionSession: {
            profile_id: profile.id,
            signer_pubkey: runtimeSnapshot.runtime_host?.signer_pubkey ?? profile.share_public_key,
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
      async loadBfProfile() {
        const confirmation = await adapter.importBfProfile(state.drafts.importProfileForm);
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: confirmation,
          activeView: 'load-confirm',
        }));
      },
      async recoverProfileFromShare() {
        const confirmation = await adapter.recoverProfileFromBfShare(state.drafts.recoverProfileForm);
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
        await persistProfileToDashboard(profile, state.pendingLoadConfirmation.stored_password);
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: null,
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
        if (connection.profile_payload?.group.groupPublicKey !== selectedProfile.group_public_key) {
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
        const runtimeSnapshot = await adapter.startSession(profile, profile.stored_password);
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
          unlockPhrase: profile.stored_password,
          pendingRotationConnection: null,
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        }));
      },
      async exportProfile(profileId) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) return;
        const payload = await adapter.exportProfile(profile);
        downloadText(buildProfileDownloadFilename(profile.label, profile.id, 'bfprofile.txt'), payload);
      },
      deleteProfile(profileId) {
        void adapter.disposeRuntimeSessionForProfile(profileId);
        setState((current) => ({
          ...current,
          profiles: current.profiles.filter((entry) => entry.id !== profileId),
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
          runtimeSnapshot,
          activeView: 'dashboard',
          activeDashboardTab: 'settings',
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
      resetApp() {
        void adapter.disposeRuntimeSessionForProfile();
        clearPersistedState();
        setState(createDefaultState());
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
