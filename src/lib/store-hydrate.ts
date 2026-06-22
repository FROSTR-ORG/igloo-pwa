// React-free hydration + default-state construction for the PWA store.
//
// Lifted out of store.tsx so the default-state shape and the load-time
// normalization rules (view sanitization, dangling-selection cleanup, legacy
// view remaps) can be unit-tested directly without standing up the provider.
import { DEFAULT_RELAYS } from 'igloo-shared';

import * as adapter from './local-adapter';
import { resolveDevScenario } from './dev-scenario';
import { importLegacyProfilesOnce } from './migrate-global';
import { clearSessionState, loadGlobalState, loadSessionState } from './storage';
import type {
  PwaDraftSecrets,
  PwaDraftState,
  PwaPersistedState,
  PwaProfile,
  PwaSettings,
} from './types';

export const defaultDrafts: PwaDraftState = {
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

export function createDefaultDraftSecrets(): PwaDraftSecrets {
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

export function createDefaultState(): PwaPersistedState {
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

export function ensureDistributionForm(
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

export function ensureDistributionPasswordSlot(
  current: PwaDraftSecrets['distributionPasswords'],
  memberIdx: number,
): { password: string; confirmPassword: string } {
  return current[memberIdx] ?? { password: '', confirmPassword: '' };
}

export function normalizeLoadedState(): PwaPersistedState {
  let base: PwaPersistedState;
  try {
    base = normalizeLoadedStateFromStorage();
  } catch {
    // Defense in depth: a structurally-plausible blob that still trips
    // normalization (a wrong-typed nested field that slipped past the storage
    // guard) must never crash hydrate. Reset this tab's session to a clean
    // slate (the shared profile list is left intact).
    clearSessionState();
    base = createDefaultState();
  }
  // Dev/test only: `?__frostr_dev=<scenario>` overrides the hydrated state with a
  // fixed in-memory scenario (incl. a running runtimeSnapshot, which is never
  // persisted). Inert without the query param. See lib/dev-scenario.ts.
  const dev = resolveDevScenario();
  return dev ? { ...base, ...dev } : base;
}

export function normalizeLoadedStateFromStorage(): PwaPersistedState {
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
