import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import App, { RecoverPrivateKeyView } from '@/App';
import { STORAGE_KEY } from '@/lib/storage';
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

  it('deletes a returning profile via the card menu after confirmation', async () => {
    cleanup();
    window.localStorage.setItem(
      STORAGE_KEY,
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
      STORAGE_KEY,
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
            share_package_json: '{"share":"demo"}',
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/existing-device',
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
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
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
          createForm: { groupName: '', threshold: '2', count: '3' },
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
          onboardSaveForm: {
            label: 'Onboarded Device',
            password: 'playwright-onboard-pass',
            confirmPassword: 'playwright-onboard-pass',
          },
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
    latestStore?.updateOnboardConnectForm('password', 'playwright-onboard-pass');
    await latestStore?.connectOnboardingPackage();
    latestStore?.updateOnboardSaveForm('label', 'Onboarded Device');
    latestStore?.updateOnboardSaveForm('password', 'playwright-onboard-pass');
    latestStore?.updateOnboardSaveForm('confirmPassword', 'playwright-onboard-pass');

    await expect(latestStore?.finalizeOnboardedDevice()).rejects.toThrow(/already exists/i);
  });

  it('normalizes legacy onboard-confirm state to the combined save screen', async () => {
    cleanup();
    window.localStorage.setItem(
      STORAGE_KEY,
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

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Save Profile' })).toBeInTheDocument();
      expect(screen.queryByText('Confirm Onboarded Profile')).not.toBeInTheDocument();
    });
  });

  it('normalizes transient onboarding states back to package entry', async () => {
    cleanup();
    window.localStorage.setItem(
      STORAGE_KEY,
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
            share_package_json: '{"share":"demo"}',
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
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
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
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
          onboardConnectForm: { packageText: '', password: '' },
          onboardSaveForm: { label: '', password: '', confirmPassword: '' },
        },
      }),
    );
    render(<App />);
    const toggle = screen.getByLabelText(/Open signer after import/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(stored).toContain('"auto_open_signer":false');
    });
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
            share_package_json: '{"share":"demo"}',
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            state_path: '/tmp/igloo-pwa/profile-77',
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
        selectedProfileId: '77'.repeat(32),
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
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
          createForm: { groupName: '', threshold: '2', count: '3' },
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
          onboardSaveForm: { label: '', password: '', confirmPassword: '' },
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
