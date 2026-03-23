import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '@/App';
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
    expect(screen.getByText('Choose one path to initialize this browser workspace.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create / Rotate Keyset' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Load Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Onboard Device' })).toBeInTheDocument();
  });

  it('opens the create flow and generates a review workspace', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.change(screen.getByLabelText('Keyset Name'), { target: { value: 'Playwright Treasury' } });
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

  it('accepts a real-looking bfonboard package and advances directly to save', async () => {
    renderApp();

    fireEvent.click(screen.getAllByRole('button', { name: 'Continue Onboarding' })[0]);
    fireEvent.change(screen.getByLabelText('bfonboard'), {
      target: { value: `bfonboard1${'q'.repeat(96)}` },
    });
    fireEvent.change(screen.getByLabelText('Decryption Password'), {
      target: { value: 'playwright-onboard-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Save Onboarded Device')).toBeInTheDocument();
      expect(screen.getByText('Review Onboarded Profile')).toBeInTheDocument();
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
            group_package_json: '{"group":"demo"}',
            share_package_json: '{"share":"demo"}',
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            share_ref: 'share-ref',
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
          createForm: { keysetName: '', threshold: '2', count: '3' },
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
            group_package_json: '{"group_pk":"22","threshold":2,"members":[]}',
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
            keysetName: '',
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
      expect(screen.getByRole('heading', { name: 'Review Onboarded Profile' })).toBeInTheDocument();
      expect(screen.queryByText('Confirm Onboarded Profile')).not.toBeInTheDocument();
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
            group_package_json: '{"group":"demo"}',
            share_package_json: '{"share":"demo"}',
            source: 'bfprofile',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            share_ref: 'share-ref',
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
            keysetName: '',
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
});
