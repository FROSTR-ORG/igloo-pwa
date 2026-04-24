import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { sharePackageToWireJson } from 'igloo-shared';

import App from '@/App';
import * as adapter from '@/lib/local-adapter';
import {
  LEGACY_STORAGE_KEY_V1,
  STORAGE_KEY,
  __resetLegacyCleanupSentinelForTests,
  cleanupLegacyPersistedState,
  createDebouncedPersistor,
  loadPersistedState,
} from '@/lib/storage';
import { toPersistable } from '@/lib/persist-allowlist';
import type { PwaPersistedState, PwaProfile } from '@/lib/types';
import { StoreProvider, useStore } from '@/lib/store';

function renderApp() {
  cleanup();
  window.localStorage.clear();
  return render(<App />);
}

function StoreHarness({ onReady }: { onReady: (store: ReturnType<typeof useStore>) => void }) {
  const store = useStore();
  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetLegacyCleanupSentinelForTests();
});

describe('igloo-pwa app shell', () => {
  it('renders the landing page by default', () => {
    renderApp();
    expect(screen.getByText('Choose one path to initialize this browser workspace.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create / Rotate Keyset' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Load Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Onboard Device' })).toBeInTheDocument();
  });

  it('opens the create flow and generates a review workspace', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Playwright Treasury' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));
    await waitFor(() => {
      expect(screen.getByText('Select the Device Share')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Device Profile Name'), {
      target: { value: 'Primary Browser Device' },
    });
    fireEvent.change(screen.getByLabelText('Device Password'), {
      target: { value: 'playwright-browser-pass' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'playwright-browser-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Review' }));
    await waitFor(() => {
      expect(screen.getByText('Preview and Confirm')).toBeInTheDocument();
    });
  });

  it('rejects onboarding when the derived profile id already exists locally', async () => {
    cleanup();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Existing Device',
            share_public_key: '33'.repeat(32),
            group_public_key: '22'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[]}',
            member_idx: 1,
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/existing-device',
            created_at: 1700000000000,
            encrypted_bfshare_artifact: 'bfshare1demo',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
            onboarding_package: null,
          },
        ],
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
          rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
          profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
          distributionForms: {},
          importProfileForm: { profileString: '' },
          recoverProfileForm: { shareString: '' },
          onboardConnectForm: { packageText: '' },
          onboardSaveForm: { label: 'Onboarded Device' },
          rotateConnectForm: { packageText: '' },
        },
        peerPermissionStates: [],
      }),
    );
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    latestStore?.updateOnboardConnectForm('packageText', `bfonboard1${'q'.repeat(96)}`);
    latestStore?.updateOnboardConnectPassword('playwright-onboard-pass');
    await latestStore?.connectOnboardingPackage();
    latestStore?.updateOnboardSaveForm('label', 'Onboarded Device');
    latestStore?.updateOnboardSavePassword('password', 'playwright-onboard-pass');
    latestStore?.updateOnboardSavePassword('confirmPassword', 'playwright-onboard-pass');

    await expect(latestStore?.finalizeOnboardedDevice()).rejects.toThrow(/already exists/i);
  });

  it('persists browser settings across reloads', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Primary Browser Device',
            share_public_key: 'share-pub-1',
            group_public_key: 'group-pub-1',
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[]}',
            member_idx: 1,
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
            created_at: 1700000000000,
            encrypted_bfshare_artifact: 'bfshare1demo',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
            onboarding_package: null,
          },
        ],
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
          rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
          profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
          distributionForms: {},
          importProfileForm: { profileString: '' },
          recoverProfileForm: { shareString: '' },
          onboardConnectForm: { packageText: '' },
          onboardSaveForm: { label: '' },
          rotateConnectForm: { packageText: '' },
        },
      }),
    );
    render(<App />);
    const toggle = screen.getByLabelText(/Open signer after import/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(
      () => {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        expect(stored).toContain('"auto_open_signer":false');
      },
      { timeout: 2000 },
    );
  });

  it('shows the unified settings actions and no reset control', () => {
    cleanup();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Primary Browser Device',
            share_public_key: 'share-pub-1',
            group_public_key: 'group-pub-1',
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[]}',
            member_idx: 1,
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
            created_at: 1700000000000,
            encrypted_bfshare_artifact: 'bfshare1demo',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
            onboarding_package: null,
          },
        ],
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
          rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
          profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
          distributionForms: {},
          importProfileForm: { profileString: '' },
          recoverProfileForm: { shareString: '' },
          onboardConnectForm: { packageText: '' },
          onboardSaveForm: { label: '' },
          rotateConnectForm: { packageText: '' },
        },
      }),
    );

    render(<App />);

    expect(screen.getAllByRole('button', { name: 'copy profile' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'copy share' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'rotate share' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'logout' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /reset browser workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });
});

describe('v1 → v2 localStorage migration (D.1)', () => {
  it('drops the legacy v1 blob on first load and does not migrate secrets', () => {
    const legacyBlob = JSON.stringify({
      profiles: [
        {
          id: '77'.repeat(32),
          label: 'Legacy Device',
          stored_password: 'SECRET-PW-LEAKED',
          runtime_snapshot_json: JSON.stringify({
            bootstrap: { share: { seckey: 'LEAK-SECKEY' } },
          }),
          share_string: 'bfshare1legacy',
          profile_string: 'bfprofile1legacy',
        },
      ],
      unlockPhrase: 'SECRET-PW-LEAKED',
      generatedKeyset: {
        shares: [{ name: 'Legacy Member 1', member_idx: 1, share_package_json: '{"idx":1,"seckey":"LEAK"}', share_public_key: '33'.repeat(32) }],
        group_name: 'Legacy Group',
        threshold: 2,
        count: 3,
        group_public_key: '22'.repeat(32),
        group_package_json: '{}',
      },
    });
    window.localStorage.setItem(LEGACY_STORAGE_KEY_V1, legacyBlob);

    // First load boots through `loadPersistedState`, which deletes the
    // v1 key.
    const loaded = loadPersistedState();
    expect(loaded).toBeNull();

    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY_V1)).toBeNull();

    // A subsequent boot of the app also leaves the v1 key gone.
    window.localStorage.setItem(LEGACY_STORAGE_KEY_V1, legacyBlob);
    __resetLegacyCleanupSentinelForTests();
    cleanupLegacyPersistedState();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY_V1)).toBeNull();
  });

  it('uses the v2 storage key for writes', () => {
    expect(STORAGE_KEY).toBe('igloo-pwa.state.v2');
    expect(LEGACY_STORAGE_KEY_V1).toBe('igloo-pwa.state.v1');
  });
});

describe('toPersistable allow-list (D.1)', () => {
  const secretMarker = 'SECRET-MARKER-DO-NOT-PERSIST';
  // PR16b: the `share_package_json` wire shape is `{idx, seckey}` and
  // the seckey hex is the raw FROST share secret. Seed a distinctive
  // fixture here so tests can assert it never reaches the persisted
  // blob.
  const shareSeckeyFixture = 'deadbeef'.repeat(8);

  function buildStateWithSecrets(): PwaPersistedState {
    const profile = {
      id: '77'.repeat(32),
      label: 'Primary',
      share_public_key: '33'.repeat(32),
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.example'],
      group_package_json: '{}',
      member_idx: 1,
      source: 'generated',
      relay_profile: 'browser',
      group_ref: 'group-ref',
      encrypted_profile_ref: 'encrypted-profile-ref',
      state_path: '/tmp/profile',
      created_at: 1700000000,
      encrypted_bfshare_artifact: 'bfshare1valid',
      profile_string: 'bfprofile1valid',
      share_string: 'bfshare1valid',
      signer_settings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted' as const,
      },
      // Synthesized secret-bearing fields that must NOT appear in persistable.
      // `share_package_json` is deliberately set here to simulate a stale
      // legacy profile with a live seckey leaking through if the allow-list
      // ever regresses — the red-team assertion below catches that.
      share_package_json: `{"idx":1,"seckey":"${shareSeckeyFixture}"}`,
      stored_password: secretMarker,
      runtime_snapshot_json: secretMarker,
      onboarding_package: null,
    } as unknown as PwaProfile;

    return {
      profiles: [profile],
      peerPermissionStates: [],
      runtimeWarning: null,
      selectedProfileId: profile.id,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      unlockPassphrase: secretMarker,
      pendingKeyset: null,
      selectedGeneratedShareIdx: null,
      pendingLoadConfirmation: null,
      pendingOnboardConnection: null,
      pendingRotationConnection: null,
      distributionSession: null,
      runtimeSnapshot: null,
      sharePackageJsonByProfileId: {
        // In-memory-only runtime cache. Must never reach the
        // persisted allow-list.
        [profile.id]: `{"idx":1,"seckey":"${shareSeckeyFixture}"}`,
      },
      settings: {
        remember_browser_state: true,
        auto_open_signer: true,
        prefer_install_prompt: true,
      },
      drafts: {
        createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
        rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
        profileForm: { label: '', relayUrls: '' },
        distributionForms: {},
        importProfileForm: { profileString: '' },
        recoverProfileForm: { shareString: '' },
        onboardConnectForm: { packageText: '' },
        onboardSaveForm: { label: '' },
        rotateConnectForm: { packageText: '' },
      },
      draftSecrets: {
        rotationSources: { 0: secretMarker },
        profileFormPassword: secretMarker,
        profileFormConfirm: secretMarker,
        distributionPasswords: {},
        importProfileFormPassword: secretMarker,
        recoverProfileFormPassword: secretMarker,
        onboardConnectFormPassword: secretMarker,
        onboardSaveFormPassword: secretMarker,
        onboardSaveFormConfirm: secretMarker,
        rotateConnectFormPassword: secretMarker,
      },
    };
  }

  it('omits forbidden secret fields from the persisted shape', () => {
    const state = buildStateWithSecrets();
    const persistable = toPersistable(state);
    const serialized = JSON.stringify(persistable);

    expect(serialized).not.toContain('stored_password');
    expect(serialized).not.toContain('runtime_snapshot_json');
    expect(serialized).not.toContain('unlockPhrase');
    expect(serialized).not.toContain('unlockPassphrase');
    expect(serialized).not.toContain('generatedKeyset');
    expect(serialized).not.toContain('pendingKeyset');
    expect(serialized).not.toContain('pendingLoadConfirmation');
    expect(serialized).not.toContain('pendingOnboardConnection');
    expect(serialized).not.toContain('pendingRotationConnection');
    expect(serialized).not.toContain('runtimeSnapshot');
    expect(serialized).not.toContain('draftSecrets');
    expect(serialized).not.toContain(secretMarker);
  });

  it('persists every allow-listed profile field', () => {
    const state = buildStateWithSecrets();
    const [persistedProfile] = toPersistable(state).profiles;
    expect(persistedProfile.id).toBe(state.profiles[0].id);
    expect(persistedProfile.encrypted_bfshare_artifact).toBe('bfshare1valid');
    expect(persistedProfile.member_idx).toBe(1);
    expect(persistedProfile.signer_settings.sign_timeout_secs).toBe(30);
    // PR16b: `share_package_json` is no longer on the persistable
    // profile shape. Even if something in the in-memory state carries
    // it, the allow-list must drop it before serialization.
    expect(persistedProfile).not.toHaveProperty('share_package_json');
  });

  it('red-team: the persisted blob never contains the share seckey fixture (PR16b)', () => {
    const state = buildStateWithSecrets();
    const persistable = toPersistable(state);
    const serialized = JSON.stringify(persistable);

    // The seckey hex must not leak through either the profile record or
    // the in-memory runtime cache (`sharePackageJsonByProfileId`).
    expect(serialized).not.toContain(shareSeckeyFixture);
    expect(serialized).not.toContain('share_package_json');
    expect(serialized).not.toContain('sharePackageJsonByProfileId');
    expect(serialized).not.toContain('"seckey"');
  });
});

describe('debounced persistor (D.1)', () => {
  it('flush writes the latest scheduled state', () => {
    let writeCount = 0;
    let written: unknown = null;
    const persistor = createDebouncedPersistor(
      (value) => {
        writeCount += 1;
        written = value;
      },
      { wait: 1000, maxWait: 2000 },
    );

    persistor.schedule({ first: true } as unknown as PwaPersistedState);
    persistor.schedule({ second: true } as unknown as PwaPersistedState);
    persistor.flush();

    expect(writeCount).toBe(1);
    expect(written).toEqual({ second: true });
  });

  it('cancel clears pending writes', () => {
    let writeCount = 0;
    const persistor = createDebouncedPersistor(() => {
      writeCount += 1;
    }, { wait: 1000, maxWait: 2000 });

    persistor.schedule({ a: 1 } as unknown as PwaPersistedState);
    persistor.cancel();
    persistor.flush();

    expect(writeCount).toBe(0);
  });
});

describe('share_package_json runtime-only reconstruction (PR16b)', () => {
  // The WASM test hook in `src/test/setup.ts` is wired to return
  // `shareSecret: '11'.repeat(32)` from `decode_bfshare_package`. Use
  // that fixture to drive session start and verify reconstruction.
  const SECKEY_FIXTURE = '11'.repeat(32);
  const MEMBER_IDX = 1;

  function buildProfile(): PwaProfile {
    return {
      id: '77'.repeat(32),
      label: 'Primary Browser Device',
      share_public_key: '33'.repeat(32),
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.primal.net'],
      group_package_json: JSON.stringify({
        group_name: 'Test Group',
        group_pk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${'33'.repeat(32)}` },
          { idx: 2, pubkey: `02${'44'.repeat(32)}` },
        ],
      }),
      member_idx: MEMBER_IDX,
      source: 'generated',
      relay_profile: 'browser',
      group_ref: 'group-ref',
      encrypted_profile_ref: 'encrypted-profile-ref',
      state_path: '/tmp/igloo-pwa/profile',
      created_at: 1700000000,
      encrypted_bfshare_artifact: 'bfshare1demo',
      profile_string: 'bfprofile1demo',
      share_string: 'bfshare1demo',
      signer_settings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted' as const,
      },
      peer_pubkey: null,
      manual_peer_policy_overrides: [],
      onboarding_package: null,
    };
  }

  it('startSession caches a byte-equal share_package_json reconstructed from the encrypted artifact', async () => {
    const profile = buildProfile();

    // Pre-condition: the persisted profile does NOT carry
    // `share_package_json` anywhere.
    expect(profile).not.toHaveProperty('share_package_json');

    await adapter.startSession(profile, 'test-passphrase');

    const cached = adapter.getSharePackageJsonForProfile(profile.id);
    expect(cached).not.toBeNull();
    // Byte-equal to the wire JSON produced by the legacy path.
    expect(cached).toBe(sharePackageToWireJson(MEMBER_IDX, SECKEY_FIXTURE));

    // Clean up the in-memory cache so subsequent tests start fresh.
    await adapter.disposeRuntimeSessionForProfile(profile.id);
    expect(adapter.getSharePackageJsonForProfile(profile.id)).toBeNull();
  });

  it('red-team: persisted v2 blob contains no seckey fixture after a session unlock', async () => {
    const profile = buildProfile();

    await adapter.startSession(profile, 'test-passphrase');
    const cached = adapter.getSharePackageJsonForProfile(profile.id);
    expect(cached).toContain(SECKEY_FIXTURE); // Sanity: cache carries the secret.

    const state: PwaPersistedState = {
      profiles: [profile],
      peerPermissionStates: [],
      runtimeWarning: null,
      selectedProfileId: profile.id,
      activeView: 'dashboard',
      activeDashboardTab: 'signer',
      unlockPassphrase: 'test-passphrase',
      pendingKeyset: null,
      selectedGeneratedShareIdx: null,
      pendingLoadConfirmation: null,
      pendingOnboardConnection: null,
      pendingRotationConnection: null,
      distributionSession: null,
      runtimeSnapshot: null,
      sharePackageJsonByProfileId: { [profile.id]: cached as string },
      settings: {
        remember_browser_state: true,
        auto_open_signer: true,
        prefer_install_prompt: true,
      },
      drafts: {
        createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
        rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
        profileForm: { label: '', relayUrls: '' },
        distributionForms: {},
        importProfileForm: { profileString: '' },
        recoverProfileForm: { shareString: '' },
        onboardConnectForm: { packageText: '' },
        onboardSaveForm: { label: '' },
        rotateConnectForm: { packageText: '' },
      },
      draftSecrets: {
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
      },
    };

    const persistable = toPersistable(state);
    const serialized = JSON.stringify(persistable);

    // Red-team: the raw seckey fixture must not appear anywhere in the
    // blob that would be written to localStorage.
    expect(serialized).not.toContain(SECKEY_FIXTURE);
    expect(serialized).not.toContain('share_package_json');
    expect(serialized).not.toContain('sharePackageJsonByProfileId');
    expect(serialized).not.toContain('"seckey"');

    await adapter.disposeRuntimeSessionForProfile(profile.id);
  });
});
