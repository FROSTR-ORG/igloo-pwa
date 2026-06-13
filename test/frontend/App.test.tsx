import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sharePackageToWireJson } from 'igloo-shared';

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

  it('recovers via the lost-device path without the device share', async () => {
    cleanup();
    const profileId = '99'.repeat(32);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: profileId,
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
            encrypted_bfshare_artifact: 'bfshare1deviceartifact',
            state_path: '/tmp/igloo-pwa/recoverable',
            created_at: 1700000000000,
            stored_password: 'pw',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            onboarding_package: null,
          },
        ],
        selectedProfileId: profileId,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
      }),
    );

    const recoverSpy = vi
      .spyOn(adapter, 'recoverNsecFromShares')
      .mockResolvedValue({ nsec: 'nsec1demo', signingKeyHex: 'ab'.repeat(32) });

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(latestStore?.profiles).toHaveLength(1));

    latestStore!.startRecoverKey(profileId);
    latestStore!.setRecoverLostDevice(true);
    latestStore!.updateRecoverSource(0, 'packageText', 'bfshare1aaa');
    latestStore!.updateRecoverSource(0, 'password', 'pw0');
    latestStore!.addRecoverSource();
    latestStore!.updateRecoverSource(1, 'packageText', 'bfshare1bbb');
    latestStore!.updateRecoverSource(1, 'password', 'pw1');

    // Wait for the store re-render so recoverKeyFromShares reads the latest state.
    await waitFor(() => {
      expect(latestStore?.draftSecrets.recoverLostDevice).toBe(true);
      expect(latestStore?.drafts.recoverKeyForm.sources).toHaveLength(2);
    });

    await latestStore!.recoverKeyFromShares();

    // Lost-device path: the device share/passphrase are omitted; only pasted
    // shares are forwarded, and the threshold check lives downstream.
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    const call = recoverSpy.mock.calls[0][0];
    expect(call.encryptedShareArtifact).toBeNull();
    expect(call.devicePassphrase).toBeNull();
    expect(call.sources).toHaveLength(2);
    recoverSpy.mockRestore();
  });

  it('gates the device-share validated flag on a successful unlock and resets it on passphrase change', async () => {
    cleanup();
    const profileId = '99'.repeat(32);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: profileId,
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
            encrypted_bfshare_artifact: 'bfshare1deviceartifact',
            state_path: '/tmp/igloo-pwa/recoverable',
            created_at: 1700000000000,
            stored_password: 'pw',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            onboarding_package: null,
          },
        ],
        selectedProfileId: profileId,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
      }),
    );

    const verifySpy = vi.spyOn(adapter, 'verifyDeviceShareUnlock').mockResolvedValue(true);

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(latestStore?.profiles).toHaveLength(1));

    latestStore!.startRecoverKey(profileId);
    latestStore!.setRecoverDevicePassphrase('correct-horse');
    await waitFor(() => expect(latestStore?.draftSecrets.recoverDevicePassphrase).toBe('correct-horse'));
    // Not counted until actually verified.
    expect(latestStore?.draftSecrets.recoverDeviceUnlockVerified).toBe(false);

    await latestStore!.verifyRecoverDeviceUnlock();
    await waitFor(() => expect(latestStore?.draftSecrets.recoverDeviceUnlockVerified).toBe(true));
    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedShareArtifact: 'bfshare1deviceartifact', devicePassphrase: 'correct-horse' }),
    );

    // Changing the passphrase invalidates the prior verification.
    latestStore!.setRecoverDevicePassphrase('different');
    await waitFor(() => expect(latestStore?.draftSecrets.recoverDeviceUnlockVerified).toBe(false));
    verifySpy.mockRestore();
  });

  it('auto-includes the device share when rotating the keyset', async () => {
    cleanup();
    const profileId = '99'.repeat(32);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: profileId,
            label: 'Rotatable Key',
            share_public_key: '66'.repeat(32),
            group_public_key: '77'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Rotatable Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
            share_package_json: '{"idx":0}',
            member_idx: 1,
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1deviceartifact',
            state_path: '/tmp/igloo-pwa/rotatable',
            created_at: 1700000000000,
            stored_password: 'pw',
            profile_string: 'bfprofile1demo',
            share_string: 'bfshare1demo',
            onboarding_package: null,
          },
        ],
        selectedProfileId: profileId,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
      }),
    );

    const rotateSpy = vi.spyOn(adapter, 'createRotatedKeyset').mockResolvedValue({
      group_name: 'Rotatable Key',
      threshold: 2,
      count: 3,
      group_public_key: '77'.repeat(32),
      group_package_json:
        '{"group_name":"Rotatable Key","group_pk":"77","threshold":2,"members":[{"idx":1}]}',
      shares: [
        {
          name: 'Rotatable Key Device 1',
          member_idx: 1,
          share_public_key: '66'.repeat(32),
          share_package_json: '{"idx":1}',
        },
      ],
    });

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(latestStore?.profiles).toHaveLength(1));

    latestStore!.updateCreateForm('mode', 'rotate');
    latestStore!.updateCreateForm('groupName', 'Rotatable Key');
    latestStore!.updateCreateForm('threshold', '2');
    latestStore!.updateCreateForm('count', '3');
    latestStore!.updateRotationForm('sourceProfileId', profileId);
    latestStore!.setRotateDevicePassphrase('device-pass');
    latestStore!.updateRotationSource(0, 'packageText', 'bfshare1other');
    latestStore!.updateRotationSource(0, 'password', 'pw0');

    await waitFor(() => {
      expect(latestStore?.draftSecrets.rotateDevicePassphrase).toBe('device-pass');
      expect(latestStore?.drafts.createForm.mode).toBe('rotate');
      expect(latestStore?.drafts.rotationForm.sourceProfileId).toBe(profileId);
    });

    await latestStore!.generateKeyset();

    // The rotating device's own share is auto-included via its passphrase, so the
    // operator only pastes the other members' bfshares.
    expect(rotateSpy).toHaveBeenCalledTimes(1);
    const call = rotateSpy.mock.calls[0][0];
    expect(call.encryptedShareArtifact).toBe('bfshare1deviceartifact');
    expect(call.devicePassphrase).toBe('device-pass');
    rotateSpy.mockRestore();
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
        const stored = window.localStorage.getItem(partitionKeyFor());
        expect(stored).toContain('"auto_open_signer":false');
      },
      { timeout: 2000 },
    );
  });

  it('shows the unified settings actions and no reset control', () => {
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

    expect(screen.getAllByRole('button', { name: 'Export Profile' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Export Share' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Replace Share' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Logout' }).length).toBeGreaterThan(0);
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
        rotateDevicePassphrase: secretMarker,
        rotateDeviceUnlockVerified: false,
        recoverKeySources: { 0: secretMarker },
        recoverDevicePassphrase: secretMarker,
        recoverDeviceUnlockVerified: false,
        recoverLostDevice: false,
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
