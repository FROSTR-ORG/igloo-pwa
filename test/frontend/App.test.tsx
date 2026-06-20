import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicKeyFromSecret, sharePackageToWireJson } from 'igloo-shared';

import App, { RecoverPrivateKeyView } from '@/App';
import * as adapter from '@/lib/local-adapter';
import {
  LEGACY_STORAGE_KEY_V1,
  STORAGE_KEY,
  __resetLegacyCleanupSentinelForTests,
  cleanupLegacyPersistedState,
  createDebouncedPersistor,
  loadPersistedState,
  partitionKeyFor,
} from '@/lib/storage';
import { INSTANCE_REGISTRY_KEY, __setInstanceIdForTests } from '@/lib/instance';
import { CRITICAL_E2E_TEST_IDS } from 'igloo-ui';
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
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Pin a fixed instance id so seeded blobs land in (and are read from) a
  // deterministic partition (`igloo-pwa.state.v2::test`).
  __setInstanceIdForTests('test');
  __resetLegacyCleanupSentinelForTests();
});

describe('igloo-pwa app shell', () => {
  it('renders the landing page by default', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Igloo Web' })).toBeInTheDocument();
    expect(screen.getByText('Split your Nostr key. Sign from anywhere.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Generate New Keyset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Keyset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Existing Device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Onboard New Device' })).toBeInTheDocument();
  });

  it('surfaces a resumable device from another partition as a Paper device card', () => {
    cleanup();
    window.localStorage.clear();
    // A device saved under a different (e.g. pre-restart) instance id. The
    // current tab ('test') has no profiles, so this should render inside the
    // centered welcome hero as a Paper device card with a Resume action —
    // not as an orphaned block below the fold.
    const now = 1700000000000;
    window.localStorage.setItem(
      INSTANCE_REGISTRY_KEY,
      JSON.stringify([
        { id: 'laptop-instance', label: 'Laptop Signer', createdAt: now, updatedAt: now, profileCount: 2 },
      ]),
    );

    render(<App />);

    // Rendered in the entry hero (no profiles in this partition), as a device
    // card carrying the shared Paper test-id.
    expect(screen.getByRole('heading', { name: 'Generate New Keyset' })).toBeInTheDocument();
    const card = screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeResumeDevice);
    expect(card).toHaveAttribute('data-device-id', 'laptop-instance');
    expect(screen.getByText('Laptop Signer')).toBeInTheDocument();
    expect(screen.getByText('2 profiles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('deletes a returning profile via the card menu after confirmation', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: '88'.repeat(32),
            label: 'Disposable Key',
            share_public_key: '44'.repeat(32),
            group_public_key: '55'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Disposable Key","group_pk":"55","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
            share_package_json: '{"idx":0}',
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/disposable',
            created_at: 1700000000000,
            stored_password: 'pw',
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
        selectedProfileId: '88'.repeat(32),
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    expect(screen.getByText('Disposable Key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // Confirmation modal guards the destructive action.
    expect(screen.getByRole('heading', { name: 'Delete Profile' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Profile' }));

    await waitFor(() => {
      expect(screen.queryByText('Disposable Key')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate Keyset' })).toBeInTheDocument();
    });
  });

  it('opens the recover-key Collect Shares flow from the returning card menu', () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: '99'.repeat(32),
            label: 'Recoverable Key',
            share_public_key: '66'.repeat(32),
            group_public_key: '77'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Recoverable Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
            share_package_json: '{"idx":0}',
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/recoverable',
            created_at: 1700000000000,
            stored_password: 'pw',
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
        selectedProfileId: '99'.repeat(32),
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByText('Recover Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument();
  });

  it('reveals, masks, and clears the recovered private key', () => {
    cleanup();
    const onClear = vi.fn();
    const recovered = { nsec: `nsec1${'q'.repeat(58)}`, signingKeyHex: '11'.repeat(32) };
    render(<RecoverPrivateKeyView recovered={recovered} onClear={onClear} />);

    // Masked by default — the full nsec is not shown.
    expect(screen.queryByText(recovered.nsec)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText(recovered.nsec)).toBeInTheDocument();

    // Encrypt Key reveals the password fields.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Encrypt Key/i));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('routes Import Existing Device directly into the 2-step Import Device Profile flow', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Import Existing Device' }));

    expect(screen.getByRole('heading', { name: 'Import Device Profile' })).toBeInTheDocument();
    // 2-step progress bar: Import Profile -> Save Profile
    expect(screen.getByText('Import Profile')).toBeInTheDocument();
    expect(screen.getByText('Save Profile')).toBeInTheDocument();
    expect(screen.getByLabelText('Profile Backup')).toBeInTheDocument();
    expect(screen.getByLabelText('Backup Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument();
  });

  it('opens the hard-cut create flow and finishes setup back to the locked welcome', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Playwright Treasury' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Share' })).toBeInTheDocument();
      expect(screen.getByText('Choose Local Share')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy group public key' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Save Profile' })).toBeInTheDocument();
      expect(screen.queryByText('Peer Permissions')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Distribute Shares' })).toBeInTheDocument();
      expect(screen.getByText('Onboarding Client')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Finish Setup' })).toBeInTheDocument();
      expect(screen.queryByText('Distribution Completion')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finish Setup' }));

    // Finish Setup purges the setup session and returns to the locked returning Welcome.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Distribute Shares' })).not.toBeInTheDocument();
      expect(screen.getByText('Primary Browser Device')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('accepts a real-looking bfonboard package and advances directly to save', async () => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Onboard New Device' }));
    fireEvent.change(screen.getByLabelText('bfonboard'), {
      target: { value: `bfonboard1${'q'.repeat(96)}` },
    });
    fireEvent.change(screen.getByLabelText('Encryption Password'), {
      target: { value: 'playwright-onboard-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Save Profile' })).toBeInTheDocument();
      expect(screen.getByLabelText('Device Profile Name')).toHaveValue('Onboarded Device');
      expect(screen.getByRole('button', { name: 'Launch Signer' })).toBeInTheDocument();
    });
  });

  it('rejects onboarding when the derived profile id already exists locally', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Existing Device',
            share_public_key: '33'.repeat(32),
            group_public_key: '22'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[{"idx":1},{"idx":2},{"idx":3}]}',
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

  it('normalizes legacy onboard-confirm state back to package entry (pending connection does not survive reload)', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [],
        selectedProfileId: '',
        activeView: 'onboard-confirm',
        activeDashboardTab: 'signer',
        unlockPhrase: '',
        generatedKeyset: null,
        selectedGeneratedShareIdx: null,
        pendingLoadConfirmation: null,
        pendingOnboardConnection: {
          preview: {
            label: 'Onboarded Device',
            share_public_key: '33'.repeat(32),
            group_public_key: '22'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json: '{"group_name":"Test Group","group_pk":"22","threshold":2,"members":[]}',
            share_package_json: '{"idx":1,"seckey":"11"}',
            source: 'bfonboard',
          },
          stored_password: 'pw',
          package_text: 'bfonboard1demo',
          profile_string: 'bfprofile1demo',
          share_string: 'bfshare1demo',
        },
        distributionSession: null,
        runtimeSnapshot: null,
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: {
            groupName: '',
            threshold: '2',
            count: '3',
          },
          profileForm: {
            label: '',
            password: '',
            confirmPassword: '',
            relayUrls: 'wss://relay.primal.net',
          },
          distributionForms: {},
          importProfileForm: { profileString: '', password: '' },
          recoverProfileForm: { shareString: '', password: '' },
          onboardConnectForm: { packageText: '', password: '' },
          onboardSaveForm: { label: 'Onboarded Device', password: '', confirmPassword: '' },
        },
      }),
    );

    render(<App />);

    // Under the security model the passphrase-bearing `pendingOnboardConnection`
    // is reset on every load, so a persisted `onboard-confirm`/`onboard-save`
    // view can never resume the save screen — it falls back to package entry
    // and the user re-enters the package + password.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Input Package' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Save Profile' })).not.toBeInTheDocument();
    });
  });

  it('normalizes transient onboarding states back to package entry', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [],
        selectedProfileId: '',
        activeView: 'onboard-handshake',
        activeDashboardTab: 'signer',
        unlockPhrase: '',
        generatedKeyset: null,
        selectedGeneratedShareIdx: null,
        pendingLoadConfirmation: null,
        pendingOnboardConnection: null,
        distributionSession: null,
        runtimeSnapshot: null,
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: {
            groupName: '',
            threshold: '2',
            count: '3',
          },
          profileForm: {
            label: '',
            password: '',
            confirmPassword: '',
            relayUrls: 'wss://relay.primal.net',
          },
          distributionForms: {},
          importProfileForm: { profileString: '', password: '' },
          recoverProfileForm: { shareString: '', password: '' },
          onboardConnectForm: { packageText: 'bfonboard1demo', password: 'package-pass' },
          onboardSaveForm: { label: '', password: '', confirmPassword: '' },
        },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Input Package' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Connecting to Inviter' })).not.toBeInTheDocument();
    });
  });

  it('persists browser settings across reloads', async () => {
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Primary Browser Device',
            share_public_key: 'share-pub-1',
            group_public_key: 'group-pub-1',
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[{"idx":1},{"idx":2},{"idx":3}]}',
            member_idx: 1,
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
            created_at: 1700000000000,
            updated_at: 1700086400000,
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
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.settings.auto_open_signer).toBe(true);
    });

    latestStore?.updateSettings('auto_open_signer', false);
    await waitFor(
      () => {
        const stored = window.localStorage.getItem(partitionKeyFor());
        expect(stored).toContain('"auto_open_signer":false');
      },
      { timeout: 2000 },
    );
  });

  it('shows the unified settings actions and no reset control', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: '77'.repeat(32),
            label: 'Primary Browser Device',
            share_public_key: 'share-pub-1',
            group_public_key: 'group-pub-1',
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[{"idx":1},{"idx":2},{"idx":3}]}',
            member_idx: 1,
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
            created_at: 1700000000000,
            updated_at: 1700086400000,
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

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));

    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardSettingsSidebar)).toBeInTheDocument();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsProfilePassword)).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDevice)).toBeVisible();
    expect(screen.getByText('2 of 3')).toBeVisible();
    expect(screen.getByText('Updated')).toBeVisible();
    expect(screen.getByText('Nov 15, 2023')).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsCopyProfile)).toBeVisible();
    expect(screen.getByText('Encrypted backup of your share and configuration')).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsCopyShare)).toBeVisible();
    expect(screen.getByText('Password-protected bfshare package')).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.maintenanceRotateShare)).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsLogout)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Logout' })).toBeVisible();
    expect(screen.getByText('Return to profile list to open another profile')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsClearCredentials)).toBeVisible();
    expect(
      screen.getByText("Delete this device's saved profile, share, password, and relay configuration"),
    ).toBeVisible();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDevice)).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Start the signer to apply settings live.')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset browser workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Profile Name'), { target: { value: 'Renamed Browser Device' } });
    expect(screen.getByText('Start the signer to apply settings live.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSigner));
    const unsavedDialog = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(unsavedDialog).toBeInTheDocument();
    expect(within(unsavedDialog).getByText('You have unsaved changes in Settings. Close without saving?')).toBeVisible();
    fireEvent.click(within(unsavedDialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDevice));
    const onboardDialog = screen.getByRole('dialog', { name: 'Onboard a Device' });
    expect(onboardDialog).toBeInTheDocument();
    expect(within(onboardDialog).getByRole('heading', { name: 'Configure Device' })).toBeVisible();
    expect(within(onboardDialog).getByText(/remote-member bfshare/i)).toBeVisible();
    expect(within(onboardDialog).queryByText(/Start the signer before creating the package/i)).not.toBeInTheDocument();
    expect(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePackage)).toBeVisible();
    expect(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCreate)).toBeDisabled();
    expect(within(onboardDialog).queryByRole('heading', { name: 'Package Producer Required' })).not.toBeInTheDocument();
    fireEvent.click(within(onboardDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Onboard a Device' })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsProfilePassword));
    expect(screen.getByRole('dialog', { name: 'Change Profile Password' })).toBeInTheDocument();
    const changePasswordSpy = vi
      .spyOn(adapter, 'changeProfilePassword')
      .mockImplementationOnce(async ({ profile }) => ({
        ...profile,
        profile_string: 'bfprofile1changed',
        share_string: 'bfshare1changed',
        encrypted_bfshare_artifact: 'bfshare1changed',
      }));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsPasswordCurrent), {
      target: { value: 'current-pass' },
    });
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsPasswordNext), {
      target: { value: 'next-pass' },
    });
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsPasswordConfirm), {
      target: { value: 'next-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsPasswordSubmit));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Change Profile Password' })).not.toBeInTheDocument(),
    );
    expect(changePasswordSpy).toHaveBeenCalledWith({
      profile: expect.objectContaining({ id: '77'.repeat(32), profile_string: 'bfprofile1demo' }),
      currentPassword: 'current-pass',
      nextPassword: 'next-pass',
    });
    changePasswordSpy.mockRestore();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsClearCredentials));
    const clearDialog = screen.getByRole('dialog', { name: 'Clear Credentials' });
    expect(clearDialog).toBeInTheDocument();
    expect(within(clearDialog).getByText(/This action cannot be undone/i)).toBeVisible();
    expect(within(clearDialog).getByText('Test Group · Share #1 · Primary Browser Device')).toBeVisible();
    expect(within(clearDialog).getByRole('button', { name: 'Clear Credentials' })).toBeVisible();
  });

  it('creates a Settings onboarding package from an explicit bfshare while signer is running', async () => {
    cleanup();
    const sourceSharePublicKey = publicKeyFromSecret('11'.repeat(32));
    const localSharePublicKey = publicKeyFromSecret('22'.repeat(32));
    const profile: PwaProfile = {
      id: '77'.repeat(32),
      label: 'Primary Browser Device',
      share_public_key: localSharePublicKey,
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.primal.net'],
      group_package_json: JSON.stringify({
        group_name: 'Test Group',
        group_pk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${localSharePublicKey}` },
          { idx: 2, pubkey: `02${sourceSharePublicKey}` },
        ],
      }),
      member_idx: 1,
      source: 'bfprofile',
      relay_profile: 'browser',
      group_ref: 'group-ref',
      encrypted_profile_ref: 'encrypted-profile-ref',
      state_path: '/tmp/igloo-pwa/profile-77',
      created_at: 1700000000000,
      updated_at: 1700086400000,
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
    };
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [profile],
        selectedProfileId: profile.id,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
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
    const startSessionSpy = vi.spyOn(adapter, 'startSession').mockResolvedValueOnce({
      active: true,
      profile,
      runtime_status: null,
      readiness: null,
      peer_permission_states: [],
      events: [],
      runtime_log_lines: ['[info] attached live browser signer session'],
      runtime_host: {
        profile_id: profile.id,
        mode: 'browser',
        log_source: 'In-memory session logs',
        started_at: 1700000000,
        signer_pubkey: 'aa'.repeat(32),
      },
    });

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileUnlock));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockPassword), {
      target: { value: 'current-device-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockSubmit));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stop Signer' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDevice));

    const onboardDialog = screen.getByRole('dialog', { name: 'Onboard a Device' });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDeviceLabel), {
      target: { value: 'Remote Device' },
    });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePackage), {
      target: { value: 'bfshare1remote' },
    });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePassword), {
      target: { value: 'source-pass' },
    });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardPackagePassword), {
      target: { value: 'package-pass' },
    });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardPackageConfirm), {
      target: { value: 'package-pass' },
    });
    fireEvent.click(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCreate));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Package Handoff' })).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('bfonboard1test')).toBeInTheDocument();
    expect(screen.getByText('Share #2')).toBeInTheDocument();
    expect(screen.getByText(sourceSharePublicKey)).toBeInTheDocument();

    startSessionSpy.mockRestore();
  });

  it('launches the Settings Replace Share flow with Paper terminology', () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
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

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.maintenanceRotateShare));

    expect(screen.getByRole('heading', { name: 'Enter Onboarding Package' })).toBeInTheDocument();
    expect(screen.getByText(/replace this device's local share/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace Share' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rotate Key' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect Rotated bfonboard/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Scan QR' }));
    expect(screen.getByRole('dialog', { name: 'Scan QR' })).toBeInTheDocument();
  });

  it('shows the Paper applying replacement state after a replacement package connects', async () => {
    cleanup();
    window.localStorage.setItem(
      partitionKeyFor(),
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
        activeView: 'landing',
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
          onboardSaveForm: { label: '' },
          rotateConnectForm: { packageText: '' },
        },
      }),
    );
    type FinalizedRotationProfile = Awaited<ReturnType<typeof adapter.finalizeRotationUpdateFromConnection>>;
    const updatedProfile: FinalizedRotationProfile = {
      id: '88'.repeat(32),
      label: 'Replacement Device',
      share_public_key: 'replacement-share-pub',
      group_public_key: 'group-pub-1',
      relays: ['wss://relay.primal.net'],
      group_package_json:
        '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[]}',
      member_idx: 1,
      source: 'bfonboard',
      relay_profile: 'browser',
      group_ref: 'group-ref',
      encrypted_profile_ref: 'encrypted-profile-ref',
      state_path: '/tmp/igloo-pwa/profile-88',
      created_at: 1700000000000,
      updated_at: 1700000001,
      encrypted_bfshare_artifact: 'bfshare1replacement',
      profile_string: 'bfprofile1replacement',
      share_string: 'bfshare1replacement',
      signer_settings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted',
      },
      onboarding_package: null,
    };
    let resolveFinalize: (value: FinalizedRotationProfile) => void = () => {};
    const finalizePromise = new Promise<FinalizedRotationProfile>((resolve) => {
      resolveFinalize = resolve;
    });
    const connectSpy = vi.spyOn(adapter, 'connectOnboardingPackage').mockResolvedValueOnce({
      preview: {
        label: 'Replacement Device',
        share_public_key: 'replacement-share-pub',
        group_public_key: 'group-pub-1',
        relays: ['wss://relay.primal.net'],
        group_package_json:
          '{"group_name":"Test Group","group_pk":"group-pub-1","threshold":2,"members":[]}',
        share_package_json: '{"idx":1}',
        source: 'bfonboard',
      },
      passphrase: 'package-pass',
      package_text: 'bfonboard1demo-package',
      profile_string: 'bfprofile1replacement',
      share_string: 'bfshare1replacement',
      manual_peer_policy_overrides: [],
      peer_pubkey: null,
      runtime_snapshot_json: null,
    });
    const finalizeSpy = vi.spyOn(adapter, 'finalizeRotationUpdateFromConnection').mockReturnValueOnce(finalizePromise);
    const startSessionSpy = vi
      .spyOn(adapter, 'startSession')
      .mockResolvedValueOnce({
        active: true,
        profile: {
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
        runtime_status: null,
        readiness: null,
        runtime_log_lines: [],
        runtime_host: null,
      })
      .mockResolvedValueOnce({
        active: true,
        profile: updatedProfile,
        runtime_status: null,
        readiness: null,
        runtime_log_lines: [],
        runtime_host: null,
      });

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileUnlock));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockPassword), {
      target: { value: 'current-device-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockSubmit));

    await waitFor(() => {
      expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.maintenanceRotateShare));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotationPackageInput), {
      target: { value: 'bfonboard1demo-package' },
    });
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotationPasswordInput), {
      target: { value: 'package-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotationConnectSubmit));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Applying Replacement' })).toBeInTheDocument();
    });
    expect(screen.getByText('Validated package')).toBeInTheDocument();
    expect(screen.getByText('Matched Group Profile')).toBeInTheDocument();
    expect(screen.getByText('Replacing local share')).toBeInTheDocument();
    expect(screen.getByText('Saving updated local share')).toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.rotationConfirmSubmit)).not.toBeInTheDocument();
    expect(connectSpy).toHaveBeenCalledWith({
      packageText: 'bfonboard1demo-package',
      password: 'package-pass',
    });
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPassphrase: 'current-device-pass',
      }),
    );

    resolveFinalize(updatedProfile);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Share Replaced' })).toBeInTheDocument();
    });
    expect(screen.getByText('Replacement share is active on this device')).toBeInTheDocument();
    expect(startSessionSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: '77'.repeat(32) }),
      'current-device-pass',
      expect.anything(),
    );
    expect(startSessionSpy).toHaveBeenNthCalledWith(
      2,
      updatedProfile,
      'package-pass',
      expect.anything(),
    );

    connectSpy.mockRestore();
    finalizeSpy.mockRestore();
    startSessionSpy.mockRestore();
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
      updated_at: 1700000100,
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
      pendingLoadError: null,
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
        recoverKeyForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
        profileForm: { label: '', relayUrls: '' },
        distributionForms: {},
        distributionPermissions: {},
        importProfileForm: { profileString: '' },
        importSaveForm: { label: '', relayUrls: '' },
        onboardConnectForm: { packageText: '' },
        onboardSaveForm: { label: '', relayUrls: '' },
        rotateConnectForm: { packageText: '' },
      },
      draftSecrets: {
        createFormPrivateKey: secretMarker,
        rotationSources: { 0: secretMarker },
        recoverKeySources: { 0: secretMarker },
        profileFormPassword: secretMarker,
        profileFormConfirm: secretMarker,
        distributionPasswords: {},
        importProfileFormPassword: secretMarker,
        importSaveFormPassword: secretMarker,
        importSaveFormConfirm: secretMarker,
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
    expect(persistedProfile.updated_at).toBe(1700000100);
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
      pendingLoadError: null,
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
        recoverKeyForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
        profileForm: { label: '', relayUrls: '' },
        distributionForms: {},
        distributionPermissions: {},
        importProfileForm: { profileString: '' },
        importSaveForm: { label: '', relayUrls: '' },
        onboardConnectForm: { packageText: '' },
        onboardSaveForm: { label: '', relayUrls: '' },
        rotateConnectForm: { packageText: '' },
      },
      draftSecrets: {
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
