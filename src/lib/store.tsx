import * as React from 'react';
import {
  buildProfileDownloadFilename,
  DEFAULT_RELAYS,
  groupPublicKeyFromPackage,
  saveBrowserProfileAndMaybeActivate,
  shortProfileId,
  type PingResult,
} from 'igloo-shared';

import * as adapter from './local-adapter';
import { saveTextToFile } from './file-save';
import { gcEmptyInstances, getInstanceId } from './instance';
import { toPersistable } from './persist-allowlist';
import { SessionController } from './session-controller';
import {
  clearPersistedState,
  createDebouncedPersistor,
  loadPersistedState,
  savePersistedState,
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
  PwaPolicyOverrideValue,
  PwaProfile,
  PwaRecoverReturnView,
  PwaRuntimeSnapshot,
  PwaSignerSettings,
  PwaSettings,
  PwaView,
} from './types';

const ONBOARD_HANDSHAKE_MINIMUM_MS = 350;
const IMPORT_PROFILE_FAILURE_MESSAGE =
  "We couldn't import this profile backup. Check the backup text and password, then try again.";

function isRuntimeErrorLeak(message: string) {
  return /undefined is not an object|cannot read propert|can't access property|evaluating |is not a function|typeerror|referenceerror|syntaxerror|\[object object\]|profile\.profile_string\.trim/i.test(
    message,
  );
}

function friendlyStoreError(error: unknown, fallback: string) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : typeof error === 'string' && error.trim()
        ? error.trim()
        : '';
  if (!message || isRuntimeErrorLeak(message)) return fallback;
  return message;
}

type AppState = PwaPersistedState & {
  setActiveView: (view: PwaView) => void;
  setDashboardTab: (tab: PwaDashboardTab) => void;
  setUnlockPassphrase: (value: string) => void;
  unlockLocalSourceShare: (profileId: string, passphrase: string) => Promise<void>;
  selectProfile: (profileId: string) => void;
  startCreateKeyset: () => void;
  loadStoredProfile: (profileId: string, passphrase: string) => Promise<void>;
  reportProfileLoadError: (message: string) => void;
  updateCreateForm: (field: keyof PwaDraftState['createForm'] | 'privateKey', value: string) => void;
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
  cancelOnboarding: () => void;
  finalizeOnboardedDevice: () => Promise<void>;
  startRotateKey: (profileId?: string) => void;
  updateRotateConnectForm: (field: 'packageText', value: string) => void;
  updateRotateConnectPassword: (value: string) => void;
  connectRotationPackage: () => Promise<void>;
  finalizeRotationUpdate: () => Promise<PwaProfile>;
  startRecoverKey: (profileId: string, returnView?: PwaRecoverReturnView) => void;
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
  changeProfilePassword: (
    profileId: string,
    currentPassword: string,
    nextPassword: string,
  ) => Promise<void>;
  deleteProfile: (profileId: string) => void;
  updatePeerPolicy: (
    pubkey: string,
    direction: 'request' | 'respond',
    method: 'ping' | 'onboard' | 'sign' | 'ecdh',
    value: PwaPolicyOverrideValue
  ) => Promise<void>;
  clearPeerPolicies: () => Promise<void>;
  clearLogs: () => Promise<void>;
  startSigner: () => Promise<void>;
  stopSigner: () => Promise<void>;
  refreshSigner: () => Promise<void>;
  pingPeer: (pubkey: string) => Promise<PingResult>;
  saveOperatorSettings: (input: {
    label: string;
    relays: string[];
    signerSettings: PwaSignerSettings;
  }) => Promise<void>;
  logout: () => Promise<void>;
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

type PwaPermissionMethod = 'ping' | 'onboard' | 'sign' | 'ecdh';
type PwaPermissionDirection = 'request' | 'respond';
type PwaManualPeerPolicyOverride = NonNullable<PwaProfile['manual_peer_policy_overrides']>[number];

function createEmptyManualPeerPolicy(): PwaManualPeerPolicyOverride['policy'] {
  return {
    request: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
    respond: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
  };
}

function isEmptyManualPeerPolicy(policy: PwaManualPeerPolicyOverride['policy']) {
  return [...Object.values(policy.request), ...Object.values(policy.respond)].every((value) => value === 'unset');
}

function storedPackageTextFor(profile: PwaProfile, format: 'bfprofile' | 'bfshare') {
  const profileString = typeof profile.profile_string === 'string' ? profile.profile_string : '';
  const shareString =
    typeof profile.share_string === 'string' && profile.share_string.trim().length > 0
      ? profile.share_string
      : typeof profile.encrypted_bfshare_artifact === 'string'
        ? profile.encrypted_bfshare_artifact
        : '';

  return format === 'bfprofile' ? profileString : shareString;
}

function patchManualPeerPolicyOverrides(
  overrides: PwaProfile['manual_peer_policy_overrides'],
  pubkey: string,
  direction: PwaPermissionDirection,
  method: PwaPermissionMethod,
  value: PwaPolicyOverrideValue,
): PwaProfile['manual_peer_policy_overrides'] {
  const existing = overrides?.find((entry) => entry.pubkey === pubkey);
  const policy = {
    request: {
      ...createEmptyManualPeerPolicy().request,
      ...existing?.policy.request,
    },
    respond: {
      ...createEmptyManualPeerPolicy().respond,
      ...existing?.policy.respond,
    },
  };
  policy[direction][method] = value;

  const withoutPeer = (overrides ?? []).filter((entry) => entry.pubkey !== pubkey);
  if (isEmptyManualPeerPolicy(policy)) {
    return withoutPeer;
  }
  return [...withoutPeer, { pubkey, policy }];
}

function deriveEffectivePolicyValue(
  state: PwaPeerPermissionState,
  direction: PwaPermissionDirection,
  method: PwaPermissionMethod,
  value: PwaPolicyOverrideValue,
) {
  if (value === 'allow') return true;
  if (value === 'deny') return false;
  return state.remote_observation?.[direction][method] ?? true;
}

function patchPeerPermissionStates(
  states: PwaPeerPermissionState[],
  pubkey: string,
  direction: PwaPermissionDirection,
  method: PwaPermissionMethod,
  value: PwaPolicyOverrideValue,
) {
  return states.map((state) => {
    if (state.pubkey !== pubkey) return state;
    return {
      ...state,
      manual_override: {
        ...state.manual_override,
        [direction]: {
          ...state.manual_override[direction],
          [method]: value,
        },
      },
      effective_policy: {
        ...state.effective_policy,
        [direction]: {
          ...state.effective_policy[direction],
          [method]: deriveEffectivePolicyValue(state, direction, method, value),
        },
      },
    };
  });
}

function applyManualPeerPolicyOverrides(
  states: PwaPeerPermissionState[],
  overrides: PwaProfile['manual_peer_policy_overrides'],
) {
  return (overrides ?? []).reduce((nextStates, override) => {
    const directions: PwaPermissionDirection[] = ['request', 'respond'];
    return directions.reduce((directionStates, direction) => {
      const methods: PwaPermissionMethod[] = ['ping', 'onboard', 'sign', 'ecdh'];
      return methods.reduce((methodStates, method) => {
        const value = override.policy[direction][method];
        return value === 'unset'
          ? methodStates
          : patchPeerPermissionStates(methodStates, override.pubkey, direction, method, value);
      }, directionStates);
    }, nextStates);
  }, states);
}

function mergeRuntimeSnapshotPeerPolicies(
  runtimeSnapshot: PwaRuntimeSnapshot,
  profile: PwaProfile | null | undefined,
): PwaRuntimeSnapshot {
  const runtimeProfile = runtimeSnapshot.profile ?? profile;
  const overrides = profile?.manual_peer_policy_overrides?.length
    ? profile.manual_peer_policy_overrides
    : runtimeProfile?.manual_peer_policy_overrides;
  const peerPermissionStates = applyManualPeerPolicyOverrides(
    runtimeSnapshot.peer_permission_states ?? [],
    overrides,
  );
  return {
    ...runtimeSnapshot,
    profile:
      runtimeProfile && overrides
        ? { ...runtimeProfile, manual_peer_policy_overrides: overrides }
        : runtimeProfile ?? runtimeSnapshot.profile,
    peer_permission_states: peerPermissionStates,
  };
}

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
    returnView: 'landing',
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

function withoutSharePackageJson(
  values: Record<string, string>,
  profileId: string,
) {
  const next = { ...values };
  delete next[profileId];
  return next;
}

function readUnlockedLocalSharePackageJson(
  profile: PwaProfile | undefined,
  selectedProfileId: string | null,
  sharePackageJsonByProfileId: Record<string, string>,
) {
  if (!profile || profile.id !== selectedProfileId) return null;
  const sharePackageJson = sharePackageJsonByProfileId[profile.id];
  return sharePackageJson?.trim() ? sharePackageJson : null;
}

function hasUnlockedLocalRecoverSource(
  profile: PwaProfile | undefined,
  selectedProfileId: string | null,
  sharePackageJsonByProfileId: Record<string, string>,
) {
  return Boolean(
    profile?.encrypted_bfshare_artifact?.trim() &&
      readUnlockedLocalSharePackageJson(profile, selectedProfileId, sharePackageJsonByProfileId),
  );
}

function isKnownLocalSourcePackage(profile: PwaProfile | undefined | null, packageText: string) {
  const trimmed = packageText.trim();
  if (!profile || !trimmed) return false;
  return [
    profile.encrypted_bfshare_artifact,
    profile.share_string,
    profile.profile_string,
  ].some((candidate) => typeof candidate === 'string' && candidate.trim() === trimmed);
}

function recoverSourcesForProfile(profile: PwaProfile | undefined, localShareAvailable: boolean) {
  const threshold = readRecoverThreshold(profile);
  const remoteSourceCount = Math.max(1, threshold - (localShareAvailable ? 1 : 0));
  return Array.from({ length: remoteSourceCount }, () => ({ packageText: '' }));
}

function readRecoverThreshold(profile: PwaProfile | undefined) {
  if (!profile?.group_package_json) return 2;
  try {
    const group = JSON.parse(profile.group_package_json) as { threshold?: unknown };
    return typeof group.threshold === 'number' && group.threshold > 0 ? group.threshold : 2;
  } catch {
    return 2;
  }
}

function createDefaultDraftSecrets(): PwaDraftSecrets {
  return {
    createFormPrivateKey: '',
    rotationSources: {},
    recoverKeySources: {},
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
    pendingLoadErrorKind: null,
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
    // guard) must never crash hydrate. Reset this partition to a clean slate.
    clearPersistedState();
    return createDefaultState();
  }
}

function normalizeLoadedStateFromStorage(): PwaPersistedState {
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
    pendingLoadErrorKind: null,
    pendingOnboardConnection: null,
    pendingRotationConnection: null,
    distributionSession: null,
    runtimeSnapshot: null,
    // In-memory only; repopulated on each `startSession` call.
    sharePackageJsonByProfileId: {},
    draftSecrets: createDefaultDraftSecrets(),
    peerPermissionStates:
      Array.isArray(loaded.peerPermissionStates) && loaded.peerPermissionStates.length
        ? loaded.peerPermissionStates
        : adapter.defaultPeerPermissionStates(),
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
        returnView:
          loaded.drafts?.recoverKeyForm?.returnView === 'dashboard' ? 'dashboard' : 'landing',
        sources:
          Array.isArray(loaded.drafts?.recoverKeyForm?.sources) && loaded.drafts.recoverKeyForm.sources.length
            ? loaded.drafts.recoverKeyForm.sources.map((entry) => ({ packageText: entry?.packageText ?? '' }))
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

  if (loadedActiveView === 'settings') {
    normalized.activeView = 'dashboard';
    normalized.activeDashboardTab = 'settings';
  }

  if (
    normalized.profiles.length &&
    normalized.activeView === 'dashboard' &&
    !normalized.profiles.some((profile) => profile.id === normalized.selectedProfileId)
  ) {
    normalized.selectedProfileId = normalized.profiles[0]?.id ?? '';
  }

  if (!normalized.profiles.length && normalized.activeView === 'dashboard') {
    normalized.activeView = 'landing';
  }

  if (loadedActiveView === 'recover-collect' || loadedActiveView === 'recover-key') {
    const recoverSourceProfile = normalized.profiles.find(
      (profile) => profile.id === normalized.drafts.recoverKeyForm.sourceProfileId,
    );
    if (!recoverSourceProfile) {
      normalized.activeView = 'landing';
      normalized.drafts.recoverKeyForm = defaultDrafts.recoverKeyForm;
    } else {
      normalized.selectedProfileId = recoverSourceProfile.id;
    }

    if (loadedActiveView === 'recover-collect') {
      const hasRecoverPackage = normalized.drafts.recoverKeyForm.sources.some((source) =>
        source.packageText.trim(),
      );
      if (!hasRecoverPackage) {
        normalized.activeView =
          normalized.drafts.recoverKeyForm.returnView === 'dashboard' && recoverSourceProfile
            ? 'dashboard'
            : 'landing';
        if (normalized.activeView === 'dashboard') {
          normalized.activeDashboardTab = 'signer';
        }
        normalized.drafts.recoverKeyForm = {
          ...defaultDrafts.recoverKeyForm,
          sourceProfileId: recoverSourceProfile?.id ?? '',
          returnView: normalized.drafts.recoverKeyForm.returnView,
        };
      }
    }

    if (loadedActiveView === 'recover-key') {
      // The reconstructed nsec is intentionally in-memory only. If the user
      // reloads the success screen, return to the launcher instead of rendering
      // an empty recover-key page or a locked dashboard that needs a passphrase
      // the browser cannot recover after refresh.
      normalized.activeView = 'landing';
      normalized.activeDashboardTab = 'signer';
      normalized.drafts.recoverKeyForm = {
        ...defaultDrafts.recoverKeyForm,
        sourceProfileId: recoverSourceProfile?.id ?? '',
        returnView: normalized.drafts.recoverKeyForm.returnView,
      };
    }
  }

  if (loadedActiveView === 'onboard-confirm') {
    normalized.activeView = normalized.pendingOnboardConnection ? 'onboard-save' : 'onboard-connect';
  }
  if (loadedActiveView === 'onboard-handshake') {
    normalized.activeView = 'onboard-connect';
  }
  if (loadedActiveView === 'onboard-save' && !normalized.pendingOnboardConnection) {
    normalized.activeView = 'onboard-connect';
  }
  if (loadedActiveView === 'load-confirm' && !normalized.pendingLoadConfirmation) {
    normalized.activeView = 'load-import';
  }
  if (loadedActiveView === 'load-error' && !normalized.pendingLoadError) {
    normalized.activeView = 'load-import';
  }
  if (loadedActiveView === 'load-recover') {
    normalized.activeView = 'load-import';
  }
  if (loadedActiveView === 'rotate-save') {
    normalized.activeView = 'rotate-connect';
  }
  if (loadedActiveView === 'rotate-complete') {
    normalized.activeView = 'dashboard';
    normalized.activeDashboardTab = 'signer';
  }

  if (normalized.activeView === 'dashboard') {
    // Dashboard runtime state cannot survive a reload: the passphrase, share
    // package JSON, and runtime snapshot are all memory-only. Return to the
    // locked profile list instead of showing a dashboard that can only error.
    normalized.activeView = 'landing';
    normalized.activeDashboardTab = 'signer';
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
    // first create form instead of stranding the user on a keyset-less step.
    normalized.activeView = 'create-generate';
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

  // Reclaim empty storage partitions left by closed tabs (never touches a
  // partition that holds profiles, nor this tab's own instance). Ref-gated so
  // StrictMode's double mount doesn't run the sweep twice.
  const gcRanRef = React.useRef(false);
  React.useEffect(() => {
    if (gcRanRef.current) return;
    gcRanRef.current = true;
    gcEmptyInstances({ keepId: getInstanceId() });
  }, []);

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
        const runtimeSnapshot = await adapter.readSession(currentSnapshot, controller);
        if (!runtimeSnapshot || cancelled) return;
        setState((current) => {
          if (!current.runtimeSnapshot?.active || current.runtimeSnapshot.profile?.id !== activeProfileId) {
            return current;
          }
          const currentProfile = current.profiles.find((profile) => profile.id === activeProfileId) ?? null;
          const mergedRuntimeSnapshot = mergeRuntimeSnapshotPeerPolicies(runtimeSnapshot, currentProfile);
          return {
            ...current,
            profiles:
              mergedRuntimeSnapshot.profile == null
                ? current.profiles
                : current.profiles.map((profile) =>
                    profile.id === activeProfileId ? mergedRuntimeSnapshot.profile ?? profile : profile,
                  ),
            peerPermissionStates:
              mergedRuntimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
            runtimeSnapshot: mergedRuntimeSnapshot,
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
      // In-memory onboard handoff snapshot (never persisted) — restores the
      // exchanged nonce pool so a freshly-onboarded signer can co-sign immediately.
      restoreSnapshotJson?: string | null,
    ) => {
      ensureProfileIdAvailable(profile);
      const mergedRuntimeSnapshot = runtimeSnapshot
        ? mergeRuntimeSnapshotPeerPolicies(runtimeSnapshot, profile)
        : null;
      const saved =
        mergedRuntimeSnapshot != null
          ? {
              profile: mergedRuntimeSnapshot.profile ?? profile,
              runtime: mergedRuntimeSnapshot,
              runtimeWarning: null,
            }
          : await saveBrowserProfileAndMaybeActivate({
              profile,
              autoStart: state.settings.auto_open_signer,
              activate: async () =>
                await adapter.startSession(profile, passphrase, controller, restoreSnapshotJson),
            });
      const snapshot = saved.runtime
        ? mergeRuntimeSnapshotPeerPolicies(saved.runtime, saved.profile as PwaProfile)
        : saved.runtime;
      const storedProfile = (snapshot?.profile ?? saved.profile) as PwaProfile;
      const sharePackageJson = adapter.getSharePackageJsonForProfile(storedProfile.id, controller);

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
        sharePackageJsonByProfileId: sharePackageJson
          ? { ...current.sharePackageJsonByProfileId, [storedProfile.id]: sharePackageJson }
          : withoutSharePackageJson(current.sharePackageJsonByProfileId, storedProfile.id),
      }));
    },
    [controller, ensureProfileIdAvailable, state.settings.auto_open_signer],
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
        setState((current) => ({
          ...current,
          unlockPassphrase: value,
          sharePackageJsonByProfileId: {},
        }));
      },
      async unlockLocalSourceShare(profileId, passphrase) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Profile not found.');
        }
        if (!passphrase.trim()) {
          setState((current) => ({
            ...current,
            sharePackageJsonByProfileId: withoutSharePackageJson(current.sharePackageJsonByProfileId, profileId),
          }));
          return;
        }
        try {
          const sharePackageJson = await adapter.unlockShareFromArtifact(profile, passphrase);
          setState((current) => {
            if (current.unlockPassphrase !== passphrase) return current;
            return {
              ...current,
              selectedProfileId: profileId,
              sharePackageJsonByProfileId: {
                ...current.sharePackageJsonByProfileId,
                [profileId]: sharePackageJson,
              },
            };
          });
        } catch (error) {
          setState((current) => {
            if (current.unlockPassphrase !== passphrase) return current;
            return {
              ...current,
              sharePackageJsonByProfileId: withoutSharePackageJson(current.sharePackageJsonByProfileId, profileId),
            };
          });
          throw error;
        }
      },
      selectProfile(profileId) {
        setState((current) => ({ ...current, selectedProfileId: profileId }));
      },
      startCreateKeyset() {
        setState((current) => ({
          ...current,
          activeView: 'create-generate',
          activeDashboardTab: 'signer',
          pendingKeyset: null,
          selectedGeneratedShareIdx: null,
          distributionSession: null,
          pendingLoadError: null,
          pendingLoadErrorKind: null,
          drafts: {
            ...current.drafts,
            createForm: { ...defaultDrafts.createForm },
            rotationForm: {
              sourceProfileId: '',
              sources: [{ packageText: '' }],
            },
            profileForm: { ...defaultDrafts.profileForm },
            distributionForms: {},
            distributionPermissions: {},
          },
          draftSecrets: {
            ...current.draftSecrets,
            createFormPrivateKey: '',
            rotationSources: {},
            profileFormPassword: '',
            profileFormConfirm: '',
            distributionPasswords: {},
          },
        }));
      },
      async loadStoredProfile(profileId, passphrase) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Profile not found.');
        }
	      const runtimeSnapshot = mergeRuntimeSnapshotPeerPolicies(
	        await adapter.startSession(profile, passphrase, controller),
	        profile,
	      );
        const sharePackageJson = adapter.getSharePackageJsonForProfile(profile.id, controller);
        setState((current) => ({
          ...current,
          selectedProfileId: profile.id,
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
          unlockPassphrase: passphrase,
          runtimeSnapshot,
          runtimeWarning: null,
          sharePackageJsonByProfileId: sharePackageJson
            ? { ...current.sharePackageJsonByProfileId, [profile.id]: sharePackageJson }
            : withoutSharePackageJson(current.sharePackageJsonByProfileId, profile.id),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          profiles: current.profiles.map((entry) =>
            entry.id === profile.id && runtimeSnapshot.profile ? runtimeSnapshot.profile : entry,
          ),
        }));
      },
      reportProfileLoadError(message) {
        setState((current) => ({
          ...current,
          pendingLoadError: message,
          pendingLoadErrorKind: 'profile',
          activeView: 'load-error',
          activeDashboardTab: 'signer',
          runtimeSnapshot: null,
          runtimeWarning: null,
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
      startRecoverKey(profileId, returnView = 'landing') {
        setState((current) => {
          const profile = current.profiles.find((entry) => entry.id === profileId);
          const localShareAvailable = hasUnlockedLocalRecoverSource(
            profile,
            current.selectedProfileId,
            current.sharePackageJsonByProfileId,
          );
          return {
            ...current,
            selectedProfileId: profileId,
            activeView: 'recover-collect',
            drafts: {
              ...current.drafts,
              recoverKeyForm: {
                sourceProfileId: profileId,
                returnView,
                sources: recoverSourcesForProfile(profile, localShareAvailable),
              },
            },
            draftSecrets: {
              ...current.draftSecrets,
              recoverKeySources: {},
            },
          };
        });
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
        const sourceProfile =
          state.profiles.find((profile) => profile.id === state.drafts.recoverKeyForm.sourceProfileId) ?? null;
        const pastedSources = state.drafts.recoverKeyForm.sources
          .map((source, index) => ({
            packageText: source.packageText.trim(),
            password: state.draftSecrets.recoverKeySources[index] ?? '',
          }))
          .filter((source) => source.packageText && source.password);
        const unlockedLocalSharePackageJson = readUnlockedLocalSharePackageJson(
          sourceProfile ?? undefined,
          state.selectedProfileId,
          state.sharePackageJsonByProfileId,
        ) ?? (sourceProfile ? adapter.getSharePackageJsonForProfile(sourceProfile.id, controller) : null);
        const unlockedLocalSource =
          sourceProfile?.encrypted_bfshare_artifact.trim() &&
          state.unlockPassphrase.trim() &&
          unlockedLocalSharePackageJson
            ? {
                packageText: sourceProfile.encrypted_bfshare_artifact.trim(),
                password: state.unlockPassphrase,
              }
            : null;
        const recovered = await adapter.recoverNsecFromShares({
          sources: unlockedLocalSource
            ? [
                unlockedLocalSource,
                ...pastedSources.filter((source) => source.packageText !== unlockedLocalSource.packageText),
              ]
            : pastedSources,
        });
        // The reconstructed key is never persisted; it is returned to the caller for
        // in-memory display and the source inputs are cleared immediately.
        setState((current) => ({
          ...current,
          activeView: 'recover-key',
          drafts: {
            ...current.drafts,
            recoverKeyForm: {
              ...defaultDrafts.recoverKeyForm,
              sourceProfileId: current.drafts.recoverKeyForm.sourceProfileId,
              returnView: current.drafts.recoverKeyForm.returnView,
            },
          },
          draftSecrets: {
            ...current.draftSecrets,
            recoverKeySources: {},
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
                sources: (() => {
                  const pastedSources = state.drafts.rotationForm.sources
                    .map((source, index) => ({
                      packageText: source.packageText.trim(),
                      password: state.draftSecrets.rotationSources[index] ?? '',
                    }))
                    .filter(
                      (source) =>
                        source.packageText &&
                        source.password &&
                        !isKnownLocalSourcePackage(sourceProfile, source.packageText),
                    );
                  const unlockedLocalSharePackageJson = readUnlockedLocalSharePackageJson(
                    sourceProfile ?? undefined,
                    state.selectedProfileId,
                    state.sharePackageJsonByProfileId,
                  ) ?? (sourceProfile ? adapter.getSharePackageJsonForProfile(sourceProfile.id, controller) : null);
                  const unlockedLocalSource =
                    sourceProfile?.encrypted_bfshare_artifact.trim() &&
                    state.unlockPassphrase.trim() &&
                    unlockedLocalSharePackageJson
                      ? {
                          packageText: sourceProfile.encrypted_bfshare_artifact.trim(),
                          password: state.unlockPassphrase,
                        }
                      : null;
                  if (!unlockedLocalSource) return pastedSources;
                  return [
                    unlockedLocalSource,
                    ...pastedSources.filter((source) => source.packageText !== unlockedLocalSource.packageText),
                  ];
                })(),
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
        const sharePackageJson = adapter.getSharePackageJsonForProfile(profile.id, controller);
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
          sharePackageJsonByProfileId: sharePackageJson
            ? { ...current.sharePackageJsonByProfileId, [profile.id]: sharePackageJson }
            : withoutSharePackageJson(current.sharePackageJsonByProfileId, profile.id),
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
          runtimeSnapshot =
            (await adapter.applyPeerPolicy(
              runtimeSnapshot,
              share.share_public_key,
              'request',
              permission,
              enabled ? 'allow' : 'deny',
              controller,
            )) ?? runtimeSnapshot;
          runtimeSnapshot =
            (await adapter.applyPeerPolicy(
              runtimeSnapshot,
              share.share_public_key,
              'respond',
              permission,
              enabled ? 'allow' : 'deny',
              controller,
            )) ?? runtimeSnapshot;
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
        const runtimeSnapshot = mergeRuntimeSnapshotPeerPolicies(
          await adapter.startSession(selectedProfile, state.unlockPassphrase, controller),
          selectedProfile,
        );
        const sharePackageJson = adapter.getSharePackageJsonForProfile(selectedProfile.id, controller);
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
          sharePackageJsonByProfileId: sharePackageJson
            ? { ...current.sharePackageJsonByProfileId, [selectedProfile.id]: sharePackageJson }
            : withoutSharePackageJson(current.sharePackageJsonByProfileId, selectedProfile.id),
        }));
      },
      async stopDistributionClient() {
        if (!state.runtimeSnapshot?.active) return;
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
            latestSnapshot = (await adapter.readSession(latestSnapshot, controller)) ?? latestSnapshot;
          } catch {
            // Fall back to the last known snapshot if the live read fails.
          }
        }
        const persistedProfile = latestSnapshot?.profile ?? null;

        // Stop the live runtime session before returning to the lock screen.
        if (state.runtimeSnapshot?.active) {
          try {
            await adapter.stopSession(state.runtimeSnapshot, controller);
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
          const message = friendlyStoreError(error, IMPORT_PROFILE_FAILURE_MESSAGE);
          setState((current) => ({
            ...current,
            pendingLoadError: message,
            pendingLoadErrorKind: 'import',
            activeView: 'load-error',
          }));
          return;
        }
        setState((current) => ({
          ...current,
          pendingLoadConfirmation: confirmation,
          pendingLoadError: null,
          pendingLoadErrorKind: null,
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
        setState((current) => ({
          ...current,
          pendingLoadError: null,
          pendingLoadErrorKind: null,
          activeView: current.pendingLoadErrorKind === 'profile' ? 'landing' : 'load-import',
        }));
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
        setState((current) => ({
          ...current,
          activeView: 'onboard-handshake',
          pendingOnboardConnection: null,
        }));
        try {
          await new Promise((resolve) => window.setTimeout(resolve, ONBOARD_HANDSHAKE_MINIMUM_MS));
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
      cancelOnboarding() {
        setState((current) => ({
          ...current,
          activeView: 'landing',
          pendingOnboardConnection: null,
          drafts: {
            ...current.drafts,
            onboardConnectForm: { ...defaultDrafts.onboardConnectForm },
            onboardSaveForm: { ...defaultDrafts.onboardSaveForm },
          },
          draftSecrets: {
            ...current.draftSecrets,
            onboardConnectFormPassword: '',
            onboardSaveFormPassword: '',
            onboardSaveFormConfirm: '',
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
        // Hand the ephemeral onboard snapshot to the signer launch so it restores the
        // nonce pool exchanged during onboarding (in-memory only; never persisted).
        await persistProfileToDashboard(
          profile,
          password,
          null,
          state.pendingOnboardConnection.runtime_snapshot_json ?? null,
        );
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
      startRotateKey(profileId) {
        const targetProfile =
          (profileId ? state.profiles.find((entry) => entry.id === profileId) : null) ?? selectedProfile;
        if (!targetProfile) {
          throw new Error('Select a profile first.');
        }
        setState((current) => ({
          ...current,
          selectedProfileId: targetProfile.id,
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
          throw new Error('Onboarding package does not match the selected profile group public key.');
        }
        if (connection.profile_payload?.profileId === selectedProfile.id) {
          throw new Error('Onboarding package did not produce a replacement device profile id.');
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
          throw new Error('Current device passphrase is required to replace this share.');
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
        const sharePackageJson = adapter.getSharePackageJsonForProfile(profile.id, controller);
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
          sharePackageJsonByProfileId: sharePackageJson
            ? { ...withoutSharePackageJson(current.sharePackageJsonByProfileId, selectedProfile.id), [profile.id]: sharePackageJson }
            : withoutSharePackageJson(current.sharePackageJsonByProfileId, selectedProfile.id),
          pendingRotationConnection: null,
          peerPermissionStates:
            runtimeSnapshot?.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
          draftSecrets: {
            ...current.draftSecrets,
            rotateConnectFormPassword: '',
          },
        }));
        return profile;
      },
      async copyProfilePackage(profileId, format) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) return;
        const packageText = storedPackageTextFor(profile, format);
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
        const profileString = storedPackageTextFor(profile, 'bfprofile');
        const shareString = storedPackageTextFor(profile, 'bfshare');
        if (format === 'bfprofile' && !profileString.trim() && !shareString.trim()) {
          throw new Error('No encrypted share artifact is available to rebuild this profile export.');
        }
        if (format === 'bfshare' && !shareString.trim()) {
          throw new Error('No bfshare package is available for this profile.');
        }
        return await adapter.exportEncryptedPackage({
          profile,
          profileString,
          shareString,
          storedPassword: state.unlockPassphrase,
          exportPassword,
          format,
        });
      },
      async changeProfilePassword(profileId, currentPassword, nextPassword) {
        const profile = state.profiles.find((entry) => entry.id === profileId);
        if (!profile) {
          throw new Error('Select a profile first.');
        }
        const updatedProfile = await adapter.changeProfilePassword({
          profile,
          currentPassword,
          nextPassword,
        });
        const sharePackageJson = await adapter.unlockShareFromArtifact(updatedProfile, nextPassword);
        setState((current) => ({
          ...current,
          profiles: current.profiles.map((entry) =>
            entry.id === profileId ? updatedProfile : entry,
          ),
          runtimeSnapshot:
            current.runtimeSnapshot?.profile?.id === profileId
              ? { ...current.runtimeSnapshot, profile: updatedProfile }
              : current.runtimeSnapshot,
          unlockPassphrase: nextPassword,
          sharePackageJsonByProfileId: {
            ...current.sharePackageJsonByProfileId,
            [profileId]: sharePackageJson,
          },
        }));
      },
      deleteProfile(profileId) {
        void adapter.disposeRuntimeSessionForProfile(profileId, controller);
        setState((current) => ({
          ...current,
          profiles: current.profiles.filter((entry) => entry.id !== profileId),
          sharePackageJsonByProfileId: withoutSharePackageJson(current.sharePackageJsonByProfileId, profileId),
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
        if (!state.runtimeSnapshot?.active) return;

        setState((current) => {
          if (!current.runtimeSnapshot?.active) return current;
          const baseRuntimeSnapshot = current.runtimeSnapshot;
          const basePeerStates =
            baseRuntimeSnapshot?.peer_permission_states ?? current.peerPermissionStates ?? adapter.defaultPeerPermissionStates();
          const peerPermissionStates = patchPeerPermissionStates(basePeerStates, pubkey, direction, method, value);
          const runtimeProfile = baseRuntimeSnapshot?.profile ?? selectedProfile;
          const patchedRuntimeProfile = runtimeProfile
            ? {
                ...runtimeProfile,
                manual_peer_policy_overrides: patchManualPeerPolicyOverrides(
                  runtimeProfile.manual_peer_policy_overrides,
                  pubkey,
                  direction,
                  method,
                  value,
                ),
              }
            : null;
          const runtimeSnapshot = baseRuntimeSnapshot
            ? {
                ...baseRuntimeSnapshot,
                profile: patchedRuntimeProfile ?? baseRuntimeSnapshot.profile,
                peer_permission_states: peerPermissionStates,
              }
            : baseRuntimeSnapshot;
          const profiles = patchedRuntimeProfile
            ? current.profiles.map((profile) =>
                profile.id === patchedRuntimeProfile.id ? patchedRuntimeProfile : profile,
              )
            : current.profiles;
          const nextState: PwaPersistedState = {
            ...current,
            peerPermissionStates,
            runtimeWarning: null,
            profiles,
            runtimeSnapshot,
          };
          if (nextState.settings.remember_browser_state) {
            savePersistedState(toPersistable(nextState) as unknown as PwaPersistedState);
          }
          return nextState;
        });

        const runtimeSnapshotFromHost = await adapter.applyPeerPolicy(
          state.runtimeSnapshot,
          pubkey,
          direction,
          method,
          value,
          controller,
        );
        // D.4: null return = session drift. The optimistic PWA policy
        // projection above remains in place and is persisted through the
        // profile allow-list.
        if (!runtimeSnapshotFromHost) return;
        setState((current) => {
          const currentProfile =
            runtimeSnapshotFromHost.profile == null
              ? current.profiles.find((profile) => profile.id === state.runtimeSnapshot?.profile?.id) ?? null
              : current.profiles.find((profile) => profile.id === runtimeSnapshotFromHost.profile?.id) ?? null;
          const runtimeSnapshot = mergeRuntimeSnapshotPeerPolicies(runtimeSnapshotFromHost, currentProfile);
          const profiles =
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                );
          const nextState: PwaPersistedState = {
            ...current,
            peerPermissionStates:
              runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
            runtimeWarning: null,
            profiles,
            runtimeSnapshot,
          };
          if (nextState.settings.remember_browser_state) {
            savePersistedState(toPersistable(nextState) as unknown as PwaPersistedState);
          }
          return nextState;
        });
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
          setState((current) => ({
            ...current,
            activeView: 'landing',
            activeDashboardTab: 'signer',
            runtimeSnapshot: null,
            runtimeWarning: null,
          }));
          return;
        }
        const runtimeSnapshot = await adapter.startSession(selectedProfile, state.unlockPassphrase, controller);
        const sharePackageJson = adapter.getSharePackageJsonForProfile(selectedProfile.id, controller);
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
          sharePackageJsonByProfileId: sharePackageJson
            ? { ...current.sharePackageJsonByProfileId, [selectedProfile.id]: sharePackageJson }
            : withoutSharePackageJson(current.sharePackageJsonByProfileId, selectedProfile.id),
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
          runtimeSnapshot: null,
          unlockPassphrase: '',
          activeView: 'landing',
          activeDashboardTab: 'signer',
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
          runtimeSnapshot,
        }));
      },
      async pingPeer(pubkey) {
        const outcome = await adapter.pingPeer(state.runtimeSnapshot, pubkey, controller);
        if (!outcome) {
          return {
            success: false,
            error: 'Start the signer before pinging peers.',
          };
        }
        const runtimeSnapshot = outcome.snapshot;
        setState((current) => ({
          ...current,
          profiles:
            runtimeSnapshot.profile == null
              ? current.profiles
              : current.profiles.map((profile) =>
                  profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
          runtimeWarning: null,
          runtimeSnapshot,
        }));
        return outcome.result;
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
        const nextState: PwaPersistedState = {
          ...state,
          profiles:
            runtimeSnapshot.profile == null
              ? state.profiles
              : state.profiles.map((profile) =>
                  profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
                ),
          peerPermissionStates:
            runtimeSnapshot.peer_permission_states ?? state.peerPermissionStates,
          runtimeWarning: null,
          runtimeSnapshot,
          activeView: 'dashboard',
          activeDashboardTab: 'settings',
        };
        setState(nextState);
        if (nextState.settings.remember_browser_state) {
          savePersistedState(toPersistable(nextState) as unknown as PwaPersistedState);
        }
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
          sharePackageJsonByProfileId: {},
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
