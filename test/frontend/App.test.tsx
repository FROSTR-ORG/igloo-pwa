import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

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
import { INSTANCE_ID_KEY, INSTANCE_REGISTRY_KEY, __setInstanceIdForTests } from '@/lib/instance';
import { CRITICAL_E2E_TEST_IDS } from 'igloo-ui';
import { toPersistable } from '@/lib/persist-allowlist';
import type { PwaPeerPermissionState, PwaPersistedState, PwaProfile } from '@/lib/types';
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

function expectHeaderLabel(label: string) {
  const header = document.querySelector('header');
  expect(header).toBeTruthy();
  expect(within(header as HTMLElement).getByText(label)).toBeInTheDocument();
}

function buildRuntimeProfile(profileId = '97'.repeat(32)): PwaProfile {
  return {
    id: profileId,
    label: 'Runtime Key',
    share_public_key: '66'.repeat(32),
    group_public_key: '77'.repeat(32),
    relays: ['wss://relay.primal.net'],
    group_package_json:
      '{"group_name":"Runtime Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'group-ref',
    encrypted_profile_ref: 'encrypted-profile-ref',
    encrypted_bfshare_artifact: 'bfshare1demo',
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
    member_idx: 1,
    state_path: '/tmp/igloo-pwa/runtime-key',
    created_at: 1700000000000,
    signer_settings: {
      sign_timeout_secs: 30,
      ping_timeout_secs: 15,
      request_ttl_secs: 300,
      state_save_interval_secs: 30,
      peer_selection_strategy: 'deterministic_sorted',
    },
    manual_peer_policy_overrides: [],
    peer_pubkey: null,
    onboarding_package: null,
  };
}

function seedResumePartition(deviceId: string, profiles: Array<{ id: string }> = [{ id: `${deviceId}-profile` }]) {
  window.localStorage.setItem(
    partitionKeyFor(deviceId),
    JSON.stringify({
      schemaVersion: 2,
      profiles,
      selectedProfileId: profiles[0]?.id ?? '',
      activeView: 'landing',
      activeDashboardTab: 'signer',
      peerPermissionStates: [],
    }),
  );
}

function seedStoredProfile(profile: PwaProfile, activeView: 'landing' | 'dashboard' = 'landing') {
  window.localStorage.setItem(
    partitionKeyFor(),
    JSON.stringify({
      profiles: [profile],
      selectedProfileId: profile.id,
      activeView,
      activeDashboardTab: 'signer',
      peerPermissionStates: [],
      settings: {
        remember_browser_state: true,
        auto_open_signer: true,
        prefer_install_prompt: true,
      },
    }),
  );
}

function mockStartSession(
  profile: PwaProfile,
  active = true,
  overrides: Partial<Awaited<ReturnType<typeof adapter.startSession>>> = {},
) {
  return vi.spyOn(adapter, 'startSession').mockResolvedValueOnce({
    active,
    profile,
    runtime_status: null,
    readiness: null,
    peer_permission_states: [],
    events: [],
    runtime_log_lines: active ? ['[info] attached live browser signer session'] : [],
    runtime_host: {
      profile_id: profile.id,
      mode: 'browser',
      log_source: 'In-memory session logs',
      started_at: 1700000000,
      signer_pubkey: profile.share_public_key,
    },
    ...overrides,
  });
}

async function unlockStoredProfile(passphrase = 'runtime-pass') {
  fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileUnlock));
  fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockPassword), {
    target: { value: passphrase },
  });
  fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockSubmit));
  await waitFor(() => {
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: undefined,
  });
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
    seedResumePartition('laptop-instance', [{ id: 'laptop-profile-1' }, { id: 'laptop-profile-2' }]);

    render(<App />);

    // Rendered in the entry hero (no profiles in this partition), as a device
    // card carrying the shared Paper test-id.
    expect(screen.getByRole('heading', { name: 'Generate New Keyset' })).toBeInTheDocument();
    const card = screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeResumeDevice);
    expect(card).toHaveAttribute('data-device-id', 'laptop-instance');
    expect(screen.getByText('Laptop Signer')).toBeInTheDocument();
    expect(screen.getByText('2 profiles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forget Laptop Signer' })).toBeInTheDocument();
  });

  it('hides stale resume records without a profile-backed partition', () => {
    cleanup();
    window.localStorage.clear();
    const now = 1700000000000;
    window.localStorage.setItem(
      INSTANCE_REGISTRY_KEY,
      JSON.stringify([
        { id: 'missing-instance', label: 'Missing Device', createdAt: now, updatedAt: now, profileCount: 1 },
        { id: 'empty-instance', label: 'Empty Device', createdAt: now, updatedAt: now, profileCount: 1 },
        { id: 'valid-instance', label: 'Valid Device', createdAt: now, updatedAt: now + 1, profileCount: 1 },
      ]),
    );
    window.localStorage.setItem(partitionKeyFor('empty-instance'), JSON.stringify({ schemaVersion: 2, profiles: [] }));
    seedResumePartition('valid-instance', [{ id: 'valid-profile' }]);

    render(<App />);

    expect(screen.queryByText('Missing Device')).not.toBeInTheDocument();
    expect(screen.queryByText('Empty Device')).not.toBeInTheDocument();
    expect(screen.getByText('Valid Device')).toBeInTheDocument();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeResumeDevice)).toHaveAttribute(
      'data-device-id',
      'valid-instance',
    );
  });

  it('adopts the selected resume partition and resets navigation before reload', () => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/dashboard/recover');
    const now = 1700000000000;
    window.localStorage.setItem(
      INSTANCE_REGISTRY_KEY,
      JSON.stringify([
        { id: 'resume-instance', label: 'Resume Device', createdAt: now, updatedAt: now, profileCount: 1 },
      ]),
    );
    seedResumePartition('resume-instance', [{ id: 'resume-profile' }]);

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeResumeDeviceButton));

    expect(window.sessionStorage.getItem(INSTANCE_ID_KEY)).toBe('resume-instance');
    expect(window.location.pathname).toBe('/');
  });

  it('forgets a resumable device and removes its saved partition', async () => {
    cleanup();
    window.localStorage.clear();
    const now = 1700000000000;
    window.localStorage.setItem(
      INSTANCE_REGISTRY_KEY,
      JSON.stringify([
        { id: 'resume-instance', label: 'Resume Device', createdAt: now, updatedAt: now, profileCount: 1 },
      ]),
    );
    seedResumePartition('resume-instance', [{ id: 'resume-profile' }]);

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeResumeDeviceForget));

    await waitFor(() => {
      expect(screen.queryByText('Resume Device')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(partitionKeyFor('resume-instance'))).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(INSTANCE_REGISTRY_KEY) ?? '[]')).toEqual([]);
  });

  it.each([
    ['/create', 'Create New Keyset', 'Create'],
    ['/import', 'Import Existing Device', 'Import Existing Device'],
    ['/onboard', 'Input Package', 'Onboard Device'],
  ] as const)('hydrates %s into its public task flow', (path, heading, headerLabel) => {
    cleanup();
    window.history.replaceState(null, '', path);

    render(<App />);

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expectHeaderLabel(headerLabel);
    expect(window.location.pathname).toBe(path);
  });

  it('restores reload-safe public-flow state from the index URL and syncs the route', async () => {
    cleanup();
    window.history.replaceState(null, '', '/');
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [],
        selectedProfileId: '',
        activeView: 'load-import',
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          importProfileForm: { profileString: 'bfprofile1stale' },
        },
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Import Existing Device' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Igloo Web' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/import');
  });

  it.each([
    ['Generate Keyset', '/create', 'Create New Keyset'],
    ['Import Existing Device', '/import', 'Import Existing Device'],
    ['Onboard New Device', '/onboard', 'Input Package'],
  ] as const)('routes %s from Welcome to %s', (button, path, heading) => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: button }));

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
  });

  it('starts Generate Keyset as a new keyset even when a stale rotate draft was persisted', () => {
    cleanup();
    const profile = buildRuntimeProfile('72'.repeat(32));
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [profile],
        selectedProfileId: profile.id,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: {
            mode: 'rotate',
            groupName: 'Onboarded Device',
            threshold: '2',
            count: '2',
          },
          rotationForm: {
            sourceProfileId: profile.id,
            sources: [{ packageText: '' }],
          },
        },
        peerPermissionStates: [],
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));

    expect(screen.getByRole('heading', { name: 'Create New Keyset' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Group Name')).toHaveValue('');
    expect(window.location.pathname).toBe('/create');
  });

  it('hydrates /create as a new keyset even when stale storage points at rotate', () => {
    cleanup();
    const profile = buildRuntimeProfile('73'.repeat(32));
    window.history.replaceState(null, '', '/create');
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [profile],
        selectedProfileId: profile.id,
        activeView: 'create-generate',
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: {
            mode: 'rotate',
            groupName: 'Onboarded Device',
            threshold: '2',
            count: '2',
          },
          rotationForm: {
            sourceProfileId: profile.id,
            sources: [{ packageText: '' }],
          },
        },
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Create New Keyset' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Group Name')).toHaveValue('');
    expect(window.location.pathname).toBe('/create');
  });

  it('clears the public task route when returning to Welcome', () => {
    window.history.replaceState(null, '', '/create');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to Welcome' }));

    expect(screen.getByRole('heading', { name: 'Igloo Web' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('returns from a public task route to Welcome on browser navigation', async () => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));

    expect(screen.getByRole('heading', { name: 'Create New Keyset' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/create');

    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Igloo Web' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Create New Keyset' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
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
    expectHeaderLabel('Recover');
    expect(screen.getByText('Recover Key')).toBeInTheDocument();
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument();
  });

  it('labels keyset rotation with the source profile context', async () => {
    cleanup();
    const profile = {
      ...buildRuntimeProfile('71'.repeat(32)),
      label: 'Rotatable Header Key',
    };
    seedStoredProfile(profile);
    const unlockSpy = vi
      .spyOn(adapter, 'unlockShareFromArtifact')
      .mockRejectedValueOnce(new Error('Incorrect passphrase.'))
      .mockResolvedValueOnce(sharePackageToWireJson(profile.member_idx, '11'.repeat(32)));

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileMenuTrigger));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileMenuRotate));

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expectHeaderLabel('Rotate');
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
    expect(screen.getByLabelText('Profile Passphrase')).toBeInTheDocument();
    expect(screen.getByText('Remote Source #1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Profile Passphrase'), {
      target: { value: 'wrong-pass' },
    });
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeDisabled();
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotateLocalPassphraseSubmit));
    await waitFor(() => {
      expect(unlockSpy).toHaveBeenLastCalledWith(profile, 'wrong-pass');
      expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotateLocalPassphrase), {
      target: { value: 'local-device-pass' },
    });
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.rotateLocalPassphraseSubmit));
    await waitFor(() => {
      expect(unlockSpy).toHaveBeenLastCalledWith(profile, 'local-device-pass');
      expect(screen.getByText('1 of 2 required')).toBeInTheDocument();
    });
  });

  it('keeps rotation collection stable when local package metadata is missing', () => {
    cleanup();
    const profile = {
      ...buildRuntimeProfile('72'.repeat(32)),
      label: 'Partial Rotation Key',
      profile_string: undefined,
      share_string: undefined,
    } as unknown as PwaProfile;
    seedStoredProfile(profile);

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileMenuTrigger));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileMenuRotate));
    fireEvent.change(screen.getByLabelText('Source Package'), {
      target: { value: 'bfshare1remote' },
    });

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByText('Remote Source #1')).toBeInTheDocument();
    expect(screen.queryByText('Local share')).not.toBeInTheDocument();
  });

  it('keeps locked recover collection blocked until enough remote source packages are present', () => {
    cleanup();
    seedStoredProfile({
      ...buildRuntimeProfile('91'.repeat(32)),
      label: 'Recoverable Key',
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));

    expect(screen.getByRole('group', { name: 'This Device Share (#1): Passphrase required' })).toBeInTheDocument();
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Old devices do not need to be online. Provide enough source packages and passwords to meet the threshold.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Add another source package and password to continue.',
    );
    const nextButton = screen.getByRole('button', { name: 'Next Step' });
    expect(nextButton).toBeDisabled();

    const sourcePackages = screen.getAllByLabelText('Source Package');
    const sourcePasswords = screen.getAllByLabelText('Package Password');
    expect(sourcePackages).toHaveLength(2);
    expect(sourcePasswords).toHaveLength(2);

    fireEvent.change(sourcePackages[0], { target: { value: 'bfshare1remote' } });
    fireEvent.change(sourcePasswords[0], { target: { value: 'remote-share-pass' } });
    expect(screen.getByText('1 of 2 required')).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    fireEvent.change(sourcePackages[1], { target: { value: 'bfshare1backup' } });
    fireEvent.change(sourcePasswords[1], { target: { value: 'backup-share-pass' } });
    expect(screen.getByText('2 of 2 required')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Threshold met. Continue to recover the private key.',
    );
    expect(screen.getByRole('button', { name: 'Next Step' })).not.toBeDisabled();
  });

  it('keeps the recover local device share locked until its passphrase unlock succeeds', async () => {
    cleanup();
    const profile = buildRuntimeProfile('94'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Recoverable Key',
      group_package_json:
        '{"group_name":"Recoverable Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
    });
    const unlockSpy = vi
      .spyOn(adapter, 'unlockShareFromArtifact')
      .mockRejectedValueOnce(new Error('Incorrect passphrase.'))
      .mockResolvedValueOnce(sharePackageToWireJson(profile.member_idx, '22'.repeat(32)));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));

    expect(screen.getByRole('group', { name: 'This Device Share (#1): Passphrase required' })).toBeInTheDocument();
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.recoverLocalPassphrase), {
      target: { value: 'wrong-pass' },
    });
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeDisabled();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.recoverLocalPassphraseSubmit));
    await waitFor(() => {
      expect(unlockSpy).toHaveBeenLastCalledWith(expect.objectContaining({ id: profile.id }), 'wrong-pass');
      expect(screen.getByText('0 of 2 required')).toBeInTheDocument();
    });

    const sourcePackages = screen.getAllByLabelText('Source Package');
    const sourcePasswords = screen.getAllByLabelText('Package Password');
    fireEvent.change(sourcePackages[0], { target: { value: profile.encrypted_bfshare_artifact } });
    fireEvent.change(sourcePasswords[0], { target: { value: 'local-pass' } });

    expect(screen.getByText('Local share')).toBeInTheDocument();
    expect(screen.getByText(/matches this device/i)).toBeInTheDocument();
    expect(screen.getByText('0 of 2 required')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.recoverLocalPassphrase), {
      target: { value: 'local-device-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.recoverLocalPassphraseSubmit));
    await waitFor(() => {
      expect(unlockSpy).toHaveBeenLastCalledWith(expect.objectContaining({ id: profile.id }), 'local-device-pass');
      expect(screen.getByRole('group', { name: 'This Device Share (#1): Validated' })).toBeInTheDocument();
      expect(screen.getByText('1 of 2 required')).toBeInTheDocument();
    });
  });

  it('locks recover collection inputs while recovery is running', async () => {
    cleanup();
    const profile = buildRuntimeProfile('93'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Recoverable Key',
      group_package_json:
        '{"group_name":"Recoverable Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
    });
    let resolveRecovery: (value: { nsec: string; signingKeyHex: string }) => void = () => {};
    vi.spyOn(adapter, 'recoverNsecFromShares').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));
    const sourcePackages = screen.getAllByLabelText('Source Package');
    const sourcePasswords = screen.getAllByLabelText('Package Password');
    fireEvent.change(sourcePackages[0], { target: { value: 'bfshare1remote' } });
    fireEvent.change(sourcePasswords[0], { target: { value: 'remote-share-pass' } });
    fireEvent.change(sourcePackages[1], { target: { value: 'bfshare1backup' } });
    fireEvent.change(sourcePasswords[1], { target: { value: 'backup-share-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Recovering private key from collected shares...',
      );
    });
    screen.getAllByLabelText('Source Package').forEach((input) => expect(input).toBeDisabled());
    screen.getAllByLabelText('Package Password').forEach((input) => expect(input).toBeDisabled());
    const recovering = screen.getByRole('button', { name: 'Recovering...' });
    expect(recovering).toBeDisabled();
    expect(recovering).toHaveAttribute('aria-busy', 'true');

    resolveRecovery({ nsec: `nsec1${'q'.repeat(58)}`, signingKeyHex: '11'.repeat(32) });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Recover Private Key' })).toBeInTheDocument();
    });
  });

  it('shows a local recovery error and clears it when source material changes', async () => {
    cleanup();
    const profile = buildRuntimeProfile('90'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Recoverable Key',
      group_package_json:
        '{"group_name":"Recoverable Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
    });
    vi.spyOn(adapter, 'recoverNsecFromShares').mockRejectedValueOnce(
      new Error('Unable to decrypt source package.'),
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));
    const sourcePackages = screen.getAllByLabelText('Source Package');
    const sourcePasswords = screen.getAllByLabelText('Package Password');
    fireEvent.change(sourcePackages[0], { target: { value: 'bfshare1remote' } });
    fireEvent.change(sourcePasswords[0], { target: { value: 'remote-share-pass' } });
    fireEvent.change(sourcePackages[1], { target: { value: 'bfshare1backup' } });
    fireEvent.change(sourcePasswords[1], { target: { value: 'backup-share-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Recovery failed. Check the source package and package password, then try again.',
      );
    });
    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /recovery source: Review required/ })).toHaveLength(2);
    expect(screen.getByText('Check Share #2 source package and password, then try again.')).toBeInTheDocument();
    expect(screen.getByText('Check Share #3 source package and password, then try again.')).toBeInTheDocument();
    screen.getAllByLabelText('Source Package').forEach((input) => expect(input).toHaveAttribute('aria-invalid', 'true'));
    screen.getAllByLabelText('Package Password').forEach((input) => expect(input).toHaveAttribute('aria-invalid', 'true'));

    fireEvent.change(screen.getAllByLabelText('Source Package')[0], { target: { value: 'bfshare1remote-updated' } });

    expect(
      screen.queryByText('Recovery failed. Check the source package and package password, then try again.'),
    ).not.toBeInTheDocument();
  });

  it('opens recover with the fixed Paper source count required by the keyset threshold', () => {
    cleanup();
    const profile = buildRuntimeProfile('92'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Three of Five Key',
      group_package_json:
        '{"group_name":"Three of Five Key","group_pk":"77","threshold":3,"members":[{"idx":0},{"idx":1},{"idx":2},{"idx":3},{"idx":4}]}',
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recover' }));

    expect(screen.getByRole('group', { name: 'This Device Share (#1): Passphrase required' })).toBeInTheDocument();
    expect(screen.getByText('0 of 3 required')).toBeInTheDocument();
    expect(screen.getByText('Share #2')).toBeInTheDocument();
    expect(screen.getByText('Share #3')).toBeInTheDocument();
    expect(screen.getByText('Share #4')).toBeInTheDocument();
    expect(screen.queryByText('Share #5')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Source Package')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Add Source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('normalizes a reloaded dashboard route back to locked landing', () => {
    cleanup();
    const profile = buildRuntimeProfile('98'.repeat(32));
    seedStoredProfile(profile, 'dashboard');
    window.history.replaceState(null, '', '/dashboard/settings');

    render(<App />);

    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.getByText('Runtime Key')).toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).not.toBeInTheDocument();
    expect(screen.queryByText('Enter the device passphrase to start the signer.')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('does not let browser history reopen dashboard settings while the profile is locked', async () => {
    cleanup();
    const profile = buildRuntimeProfile('97'.repeat(32));
    seedStoredProfile(profile, 'landing');

    render(<App />);

    expect(screen.getByText('Welcome back.')).toBeInTheDocument();

    act(() => {
      window.history.pushState({ iglooDashboardTab: 'settings' }, '', '/dashboard/settings');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { iglooDashboardTab: 'settings' } }));
    });

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).not.toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardSettingsSidebar)).not.toBeInTheDocument();
  });

  it('returns to the locked welcome when stopping clears the signer passphrase', async () => {
    cleanup();
    const profile = buildRuntimeProfile('99'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile);
    const stopSessionSpy = vi.spyOn(adapter, 'stopSession').mockResolvedValueOnce({
      active: false,
      profile,
      runtime_status: null,
      readiness: null,
      peer_permission_states: [],
      events: [],
      runtime_log_lines: ['[info] signer stopped'],
      runtime_host: {
        profile_id: profile.id,
        mode: 'browser',
        log_source: 'In-memory session logs',
        started_at: 1700000000,
        signer_pubkey: profile.share_public_key,
      },
    });

    render(<App />);
    await unlockStoredProfile();

    fireEvent.click(screen.getByRole('button', { name: 'Stop Signer' }));

    await waitFor(() => expect(stopSessionSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    });
    expect(screen.getByText('Runtime Key')).toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Signer' })).not.toBeInTheDocument();
  });

  it('keeps dashboard navigation aligned with the Paper header actions', async () => {
    cleanup();
    const profile = buildRuntimeProfile();
    seedStoredProfile(profile);
    mockStartSession(profile);

    render(<App />);

    await unlockStoredProfile();

    expect(window.location.pathname).toBe('/dashboard');
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSigner)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabPermissions)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Recover' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabPermissions));
    expect(window.location.pathname).toBe('/dashboard/permissions');
    expect(screen.getByRole('heading', { name: 'Peer Permissions' })).toBeInTheDocument();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSigner)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabPermissions)).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      window.history.replaceState({ iglooDashboardTab: 'signer' }, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Peer Permissions' })).not.toBeInTheDocument();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSigner)).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardSettingsSidebar)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard/settings');
  });

  it('updates peer permission overrides from the dashboard permissions tab', async () => {
    cleanup();
    const profile = buildRuntimeProfile();
    const peerPubkey = '44'.repeat(32);
    const peerPermissionStates: PwaPeerPermissionState[] = [
      {
        pubkey: peerPubkey,
        manual_override: {
          request: { ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
          respond: { ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
        },
        remote_observation: null,
        effective_policy: {
          request: { ping: true, onboard: true, sign: true, ecdh: true },
          respond: { ping: true, onboard: true, sign: true, ecdh: true },
        },
      },
    ];
    seedStoredProfile(profile);
    mockStartSession(profile, true, { peer_permission_states: peerPermissionStates });
    vi.spyOn(adapter, 'applyPeerPolicy').mockResolvedValueOnce(null);

    render(<App />);

    await unlockStoredProfile();
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabPermissions));
    expect(screen.getByRole('button', { name: 'request sign: allow' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'request sign: allow' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'request sign: deny' })).toBeInTheDocument();
    });
    expect(adapter.applyPeerPolicy).toHaveBeenCalledWith(
      expect.anything(),
      peerPubkey,
      'request',
      'sign',
      'deny',
      expect.anything(),
    );
  });

  it('surfaces a dashboard attention state when the unlocked signer has no relays', async () => {
    cleanup();
    const profile = { ...buildRuntimeProfile('95'.repeat(32)), relays: [] };
    seedStoredProfile(profile);
    mockStartSession(profile);

    render(<App />);
    await unlockStoredProfile();

    const attention = screen.getByRole('status');
    expect(attention).toHaveTextContent('No relays configured');
    expect(attention).toHaveTextContent('Add at least one relay in Settings before this signer can find peers.');
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('surfaces a signing-blocked attention state when runtime readiness is degraded', async () => {
    cleanup();
    const profile = buildRuntimeProfile('94'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: false,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 1,
        ecdh_peer_count: 2,
        last_refresh_at: 1700000000,
        degraded_reasons: ['insufficient_signing_peers'],
      },
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const commonCauses = screen.getByRole('region', { name: 'Common Causes' });
    expect(commonCauses).toHaveTextContent('Signing Blocked');
    expect(commonCauses).toHaveTextContent('Requests held pending clearance.');
    expect(commonCauses).toHaveTextContent('Policy decision pending');
    expect(commonCauses).toHaveTextContent('Not enough ready peers');
    expect(commonCauses).toHaveTextContent('Pool imbalance');
    const operatorAction = screen.getByRole('region', { name: 'Operator Action' });
    expect(operatorAction).toHaveTextContent('Clear via permissions or approvals.');
    expect(operatorAction).toHaveTextContent(
      '1 of 2 signing peers are ready. Bring another signing peer online before approving signatures.',
    );
    expect(screen.getByText('Signer Running (Degraded)')).toBeInTheDocument();
    expect(screen.getByText('Policy or readiness gate active.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Peers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pending Approvals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event Log' })).not.toBeInTheDocument();
  });

  it('projects runtime peer method capabilities into dashboard method badges', async () => {
    cleanup();
    const profile = buildRuntimeProfile('93'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      runtime_status: {
        status: {
          device_id: profile.id,
          pending_ops: 0,
          last_active: 1700000000,
          known_peers: 1,
          request_seq: 1,
        },
        metadata: {
          device_id: profile.id,
          member_idx: profile.member_idx,
          share_public_key: profile.share_public_key,
          group_public_key: profile.group_public_key,
          peers: ['44'.repeat(32)],
        },
        readiness: {
          runtime_ready: true,
          restore_complete: true,
          sign_ready: false,
          ecdh_ready: true,
          threshold: 2,
          signing_peer_count: 0,
          ecdh_peer_count: 1,
          last_refresh_at: 1700000000,
          degraded_reasons: [],
        },
        peers: [
          {
            idx: 2,
            pubkey: '44'.repeat(32),
            known: true,
            last_seen: 1700000000,
            online: true,
            incoming_available: 0,
            outgoing_available: 12,
            outgoing_spent: 0,
            latency_ms: 38,
            nonce_inventory_history: [
              { updated_at: 1700000000, held_count: 5 },
              { updated_at: 1700000001, held_count: 12 },
            ],
            can_sign: false,
            can_ecdh: true,
            can_ping: true,
            can_onboard: false,
            should_send_nonces: false,
          },
        ],
        peer_permission_states: [],
        pending_operations: [],
      },
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.getByText('ECDH')).toBeInTheDocument();
    expect(screen.getByText('PING')).toBeInTheDocument();
    expect(screen.getByText('38ms')).toBeInTheDocument();
    expect(screen.getByText('Avg: 38ms')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Peer #2 signing capacity: 0 incoming, 12 outgoing, 0 spent'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/nonce availability/i)).not.toBeInTheDocument();
    expect(screen.queryByText('SIGN')).not.toBeInTheDocument();
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument();
  });

  it('renders known but unreachable signer peers as offline', async () => {
    cleanup();
    const profile = buildRuntimeProfile('94'.repeat(32));
    const offlinePeer = '55'.repeat(32);
    const readiness = {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 2,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 1700000000,
      degraded_reasons: [],
    };

    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      readiness,
      runtime_status: {
        status: {
          device_id: profile.id,
          pending_ops: 0,
          last_active: 1700000000,
          known_peers: 2,
          request_seq: 1,
        },
        metadata: {
          device_id: profile.id,
          member_idx: profile.member_idx,
          share_public_key: profile.share_public_key,
          group_public_key: profile.group_public_key,
          peers: ['44'.repeat(32), offlinePeer],
        },
        readiness,
        peers: [
          {
            idx: 3,
            pubkey: offlinePeer,
            known: true,
            last_seen: null,
            online: false,
            incoming_available: 0,
            outgoing_available: 70,
            outgoing_spent: 0,
            nonce_inventory_history: [],
            can_sign: false,
            can_ecdh: true,
            can_ping: true,
            can_onboard: true,
            should_send_nonces: false,
          },
        ],
        peer_permission_states: [],
        pending_operations: [],
      },
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.getByLabelText('Peer #3 telemetry: Offline')).toBeInTheDocument();
    expect(screen.queryByText('Known')).not.toBeInTheDocument();
  });

  it('projects ordinary runtime pending operations without turning them into approvals', async () => {
    cleanup();
    const profile = buildRuntimeProfile('86'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      runtime_status: {
        status: {
          device_id: profile.id,
          pending_ops: 1,
          last_active: 1700000000,
          known_peers: 1,
          request_seq: 1,
        },
        metadata: {
          device_id: profile.id,
          member_idx: profile.member_idx,
          share_public_key: profile.share_public_key,
          group_public_key: profile.group_public_key,
          peers: ['44'.repeat(32)],
        },
        readiness: {
          runtime_ready: true,
          restore_complete: false,
          sign_ready: false,
          ecdh_ready: true,
          threshold: 2,
          signing_peer_count: 0,
          ecdh_peer_count: 1,
          last_refresh_at: 1700000000,
          degraded_reasons: [],
        },
        peers: [],
        peer_permission_states: [],
        pending_operations: [
          {
            op_type: 'sign',
            request_id: 'req-sign',
            started_at: 1700000000,
            timeout_at: 1700000060,
            target_peers: ['44'.repeat(32)],
            threshold: 2,
            collected_responses: [],
            context: 'SignSession',
          },
        ],
      },
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.getByRole('button', { name: 'Open sign operation for threshold 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open sign approval/i })).not.toBeInTheDocument();
  });

  it('surfaces the Paper all-relays-offline state with a retry action', async () => {
    cleanup();
    const profile = {
      ...buildRuntimeProfile('92'.repeat(32)),
      relays: ['wss://relay-one.example', 'wss://relay-two.example'],
    };
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      readiness: {
        runtime_ready: true,
        restore_complete: false,
        sign_ready: false,
        ecdh_ready: false,
        threshold: 2,
        signing_peer_count: 0,
        ecdh_peer_count: 0,
        last_refresh_at: 1700000000,
        degraded_reasons: ['No connected relays available (wss://relay-one.example; wss://relay-two.example)'],
      },
    });
    const refreshSpy = vi.spyOn(adapter, 'refreshSession').mockImplementation(async (snapshot) => snapshot);

    render(<App />);
    await unlockStoredProfile();

    const readiness = screen.getByRole('region', { name: 'Readiness' });
    expect(readiness).toHaveTextContent('All Relays Offline');
    expect(readiness).toHaveTextContent('No relay route to peers.');
    expect(readiness).toHaveTextContent('0 / 2 relays reachable');
    expect(readiness).toHaveTextContent('Ready count degraded');
    const recovery = screen.getByRole('region', { name: 'Recovery' });
    expect(recovery).toHaveTextContent('Check network, DNS, and firewall.');
    expect(recovery).toHaveTextContent('Blocked until a relay connects.');
    expect(screen.queryByRole('heading', { name: 'Peers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pending Approvals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event Log' })).not.toBeInTheDocument();
    expect(screen.getByText('All relays unreachable · signing degraded.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Connections' }));
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
  });

  it('filters fallback runtime log lines by inferred Event Log domains', async () => {
    cleanup();
    const profile = buildRuntimeProfile('89'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      events: [],
      runtime_log_lines: [
        '[info] [sync] peer roster synced',
        '[info] [relay] inbound relay event received',
        '[info] [onboarding] peer onboarded',
        '[warn] [sign] insufficient partial signatures',
        '[debug] [bridge] command dispatched',
        '[info] attached live browser signer session',
      ],
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.getByText('peer roster synced')).toBeInTheDocument();
    expect(screen.queryByText('[sync] peer roster synced')).not.toBeInTheDocument();
    expect(screen.getByText('inbound relay event received')).toBeInTheDocument();
    expect(screen.queryByText('[relay] inbound relay event received')).not.toBeInTheDocument();
    expect(screen.getByText('peer onboarded')).toBeInTheDocument();
    expect(screen.queryByText('[onboarding] peer onboarded')).not.toBeInTheDocument();
    expect(screen.getByText('insufficient partial signatures')).toBeInTheDocument();
    expect(screen.queryByText('[sign] insufficient partial signatures')).not.toBeInTheDocument();
    expect(screen.getByText('command dispatched')).toBeInTheDocument();
    expect(screen.queryByText('[bridge] command dispatched')).not.toBeInTheDocument();
    expect(screen.getByText('attached live browser signer session')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'warn', pressed: false })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filter/i }));
    expect(screen.getByRole('button', { name: 'sync', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'relay', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'onboard', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bridge', pressed: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sign', pressed: false }));

    expect(screen.getByText('insufficient partial signatures')).toBeInTheDocument();
    expect(screen.queryByText('peer roster synced')).not.toBeInTheDocument();
    expect(screen.queryByText('inbound relay event received')).not.toBeInTheDocument();
    expect(screen.queryByText('peer onboarded')).not.toBeInTheDocument();
    expect(screen.queryByText('attached live browser signer session')).not.toBeInTheDocument();
  });

  it('renders structured runtime operation events in the Event Log', async () => {
    cleanup();
    const profile = buildRuntimeProfile('91'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      events: [
        {
          ts: 1700000007000,
          level: 'info',
          component: 'igloo.runtime',
          domain: 'sign',
          event: 'complete',
          request_id: 'req-sign',
          signature_count: 1,
          message: 'Sign request completed',
        },
        {
          ts: 1700000008000,
          level: 'info',
          component: 'igloo.runtime',
          domain: 'relay',
          event: 'inbound_event',
          event_id: 'relay-event',
          message: 'Inbound relay event received',
        },
        {
          ts: 1700000009000,
          level: 'info',
          component: 'igloo.runtime',
          domain: 'onboarding',
          event: 'peer_onboarded',
          peer_pubkey: 'peer-pubkey',
          message: 'Peer onboarded',
        },
      ],
      runtime_log_lines: [
        '[info] relay.inbound_event event_id=relay-event',
        '[info] attached live browser signer session',
        '[warn] [profile] persisted profile fallback restored',
        '[info] session refresh completed',
      ],
    });

    render(<App />);
    await unlockStoredProfile();

    expect(screen.getByText('Sign request completed')).toBeInTheDocument();
    expect(screen.getByText('Inbound relay event received')).toBeInTheDocument();
    expect(screen.getByText('Peer onboarded')).toBeInTheDocument();
    expect(screen.queryByText('attached live browser signer session')).not.toBeInTheDocument();
    expect(screen.queryByText('relay.inbound_event event_id=relay-event')).not.toBeInTheDocument();
    expect(screen.getByText('persisted profile fallback restored')).toBeInTheDocument();
    expect(screen.getByText('session refresh completed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filter/i }));
    expect(screen.getByRole('button', { name: 'sign', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'relay', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'profile', pressed: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'onboard', pressed: false }));

    expect(screen.getByText('Peer onboarded')).toBeInTheDocument();
    expect(screen.queryByText('Sign request completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Inbound relay event received')).not.toBeInTheDocument();
    expect(screen.queryByText('persisted profile fallback restored')).not.toBeInTheDocument();
    expect(screen.queryByText('session refresh completed')).not.toBeInTheDocument();
  });

  it('surfaces the Paper signing-failed dialog with retry recovery', async () => {
    cleanup();
    const profile = buildRuntimeProfile('90'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile, true, {
      events: [
        {
          ts: 1700000007000,
          level: 'warn',
          component: 'runtime',
          domain: 'runtime',
          event: 'failure',
          op_type: 'sign',
          request_id: 'r-0x4f2a',
          event_kind: 1,
          retry_attempts: 3,
          peers_responded: 1,
          peers_required: 2,
          message: 'insufficient partial signatures',
        },
      ],
    });
    const refreshSpy = vi.spyOn(adapter, 'refreshSession').mockImplementation(async (snapshot) => snapshot);

    render(<App />);
    await unlockStoredProfile();

    const dialog = screen.getByRole('dialog', { name: 'Signing Failed' });
    expect(
      within(dialog).getByText('Unable to complete signature for event kind:1. All 3 retry attempts exhausted.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Round: r-0x4f2a/)).toHaveTextContent(
      'Round: r-0x4f2a · Peers responded: 1/2 · Error: insufficient partial signatures',
    );
    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Signing Failed' })).not.toBeInTheDocument();
  });

  it('shows the Paper loading-profile state while a saved profile starts', async () => {
    cleanup();
    const profile = buildRuntimeProfile('91'.repeat(32));
    seedStoredProfile(profile);

    let resolveStartSession!: (snapshot: Awaited<ReturnType<typeof adapter.startSession>>) => void;
    const startSession = new Promise<Awaited<ReturnType<typeof adapter.startSession>>>((resolve) => {
      resolveStartSession = resolve;
    });
    vi.spyOn(adapter, 'startSession').mockReturnValueOnce(startSession);

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileUnlock));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockPassword), {
      target: { value: 'runtime-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockSubmit));

    expect(await screen.findByText('Loading profile...')).toBeInTheDocument();
    expect(screen.getByText('Preparing your dashboard.')).toBeInTheDocument();
    expect(screen.getByText('Runtime Key')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Unlock Profile' })).not.toBeInTheDocument();

    await act(async () => {
      resolveStartSession({
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
          signer_pubkey: profile.share_public_key,
        },
      });
      await startSession;
    });

    await waitFor(() => {
      expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading profile...')).not.toBeInTheDocument();
  });

  it('shows the Paper profile-load-failed state when a saved profile cannot start', async () => {
    cleanup();
    const profile = buildRuntimeProfile('93'.repeat(32));
    seedStoredProfile(profile);
    vi.spyOn(adapter, 'startSession').mockRejectedValueOnce(
      new Error('This profile is missing its encrypted share artifact.'),
    );

    render(<App />);

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeProfileUnlock));
    fireEvent.change(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockPassword), {
      target: { value: 'runtime-pass' },
    });
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.welcomeUnlockSubmit));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: "Couldn't load profile" })).toHaveLength(2);
    });
    expect(screen.getByText('Try again, or return to your profiles.')).toBeInTheDocument();
    expect(screen.getByText('This profile is missing its encrypted share artifact.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Unlock Profile' })).not.toBeInTheDocument();

    const backToProfilesActions = screen.getAllByRole('button', { name: 'Back to Profiles' });
    fireEvent.click(backToProfilesActions[backToProfilesActions.length - 1]);
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
  });

  it('normalizes a reloaded recovered-key route back to recovery collection', () => {
    cleanup();
    const profileId = '96'.repeat(32);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: profileId,
            label: 'Runtime Key',
            share_public_key: '66'.repeat(32),
            group_public_key: '77'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Runtime Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1demo',
            member_idx: 1,
            state_path: '/tmp/igloo-pwa/runtime-key',
            created_at: 1700000000000,
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        ],
        selectedProfileId: profileId,
        activeView: 'recover-key',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
        drafts: {
          recoverKeyForm: {
            sourceProfileId: profileId,
            returnView: 'dashboard',
            sources: [{ packageText: '' }],
          },
        },
      }),
    );
    window.history.replaceState(null, '', '/recover');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
    expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardRoot)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recover Private Key' })).not.toBeInTheDocument();
  });

  it('normalizes an empty reloaded recovery collection back to its launcher', () => {
    cleanup();
    const profileId = '95'.repeat(32);
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
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1demo',
            member_idx: 1,
            state_path: '/tmp/igloo-pwa/recoverable-key',
            created_at: 1700000000000,
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        ],
        selectedProfileId: profileId,
        activeView: 'recover-collect',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
        drafts: {
          recoverKeyForm: {
            sourceProfileId: profileId,
            returnView: 'landing',
            sources: [{ packageText: '' }],
          },
        },
      }),
    );

    render(<App />);

    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
  });

  it('keeps a reloaded recovery collection when package text can be resumed', () => {
    cleanup();
    const profileId = '94'.repeat(32);
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
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1demo',
            member_idx: 1,
            state_path: '/tmp/igloo-pwa/recoverable-key',
            created_at: 1700000000000,
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        ],
        selectedProfileId: profileId,
        activeView: 'recover-collect',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
        drafts: {
          recoverKeyForm: {
            sourceProfileId: profileId,
            returnView: 'landing',
            sources: [{ packageText: 'bfshare1resume' }],
          },
        },
      }),
    );
    window.history.replaceState(null, '', '/recover');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('bfshare1resume')).toBeInTheDocument();
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
  });

  it('keeps a dashboard-launched recovery draft on reload but returns to welcome while locked', async () => {
    cleanup();
    const profileId = '93'.repeat(32);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [
          {
            id: profileId,
            label: 'Recoverable Dashboard Key',
            share_public_key: '66'.repeat(32),
            group_public_key: '77'.repeat(32),
            relays: ['wss://relay.primal.net'],
            group_package_json:
              '{"group_name":"Recoverable Dashboard Key","group_pk":"77","threshold":2,"members":[{"idx":0},{"idx":1},{"idx":2}]}',
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1demo',
            member_idx: 1,
            state_path: '/tmp/igloo-pwa/recoverable-dashboard-key',
            created_at: 1700000000000,
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        ],
        selectedProfileId: profileId,
        activeView: 'recover-collect',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
        drafts: {
          recoverKeyForm: {
            sourceProfileId: profileId,
            returnView: 'dashboard',
            sources: [{ packageText: 'bfshare1resume' }],
          },
        },
      }),
    );
    window.history.replaceState({ iglooDashboardTab: 'signer' }, '', '/dashboard');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('bfshare1resume')).toBeInTheDocument();
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/'));

    fireEvent.click(screen.getByText('Back to Welcome'));

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
  });

  it('normalizes a stale dashboard recover URL for welcome-launched recovery collection', async () => {
    cleanup();
    const profileId = '97'.repeat(32);
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
            source: 'generated',
            relay_profile: 'browser',
            group_ref: 'group-ref',
            encrypted_profile_ref: 'encrypted-profile-ref',
            encrypted_bfshare_artifact: 'bfshare1demo',
            member_idx: 1,
            state_path: '/tmp/igloo-pwa/recoverable-key',
            created_at: 1700000000000,
            signer_settings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        ],
        selectedProfileId: profileId,
        activeView: 'recover-collect',
        activeDashboardTab: 'signer',
        peerPermissionStates: [],
        drafts: {
          recoverKeyForm: {
            sourceProfileId: profileId,
            returnView: 'landing',
            sources: [{ packageText: 'bfshare1resume' }],
          },
        },
      }),
    );
    window.history.replaceState(null, '', '/dashboard/recover');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Collect Shares' })).toBeInTheDocument();
    expect(screen.getByText('Back to Welcome')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/recover'));
  });

  it('reveals, masks, and clears the recovered private key', () => {
    cleanup();
    const onClear = vi.fn();
    const recovered = { nsec: `nsec1${'q'.repeat(58)}`, signingKeyHex: '11'.repeat(32) };
    const createObjectURL = vi.fn().mockReturnValue('blob:recovered-key');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
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
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'export-passphrase' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'export-passphrase' } });
    expect(screen.getByText((text) => text.startsWith('ncryptsec1'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(anchorClick).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recovered-key');
    expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('locks recovered key export controls while copying to the clipboard', async () => {
    cleanup();
    const onClear = vi.fn();
    const recovered = { nsec: `nsec1${'q'.repeat(58)}`, signingKeyHex: '11'.repeat(32) };
    let resolveCopy: () => void = () => {};
    const clipboardWrite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });

    render(<RecoverPrivateKeyView recovered={recovered} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(clipboardWrite).toHaveBeenCalledWith(recovered.nsec);
    const copying = await screen.findByRole('button', { name: 'Copying...' });
    expect(copying).toBeDisabled();
    expect(copying).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'QR code' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByLabelText(/Encrypt Key/i)).toBeDisabled();

    resolveCopy();
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('routes Import Existing Device directly into the 2-step Import Existing Device flow', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Import Existing Device' }));

    expect(screen.getByRole('heading', { name: 'Import Existing Device' })).toBeInTheDocument();
    // 2-step progress bar: Import Existing Device -> Save Profile
    const progress = screen.getByRole('list', { name: 'Flow progress' });
    expect(within(progress).getByText('Import Existing Device')).toBeInTheDocument();
    expect(within(progress).getByText('Save Profile')).toBeInTheDocument();
    expect(screen.getByLabelText('Profile Backup')).toBeInTheDocument();
    expect(screen.getByLabelText('Backup Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument();
  });

  it('shows friendly copy instead of raw runtime text when import parsing fails', async () => {
    vi.spyOn(adapter, 'importBfProfile').mockRejectedValueOnce(
      new TypeError("undefined is not an object (evaluating 'profile.profile_string.trim')"),
    );
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Import Existing Device' }));

    fireEvent.change(screen.getByLabelText('Profile Backup'), {
      target: { value: 'bfprofile1broken' },
    });
    fireEvent.change(screen.getByLabelText('Backup Password'), {
      target: { value: 'profile-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Import Error' })).toBeInTheDocument();
    });
    expect(
      screen.getByText("We couldn't import this profile backup. Check the backup text and password, then try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/undefined is not an object/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/profile\.profile_string\.trim/i)).not.toBeInTheDocument();
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
      expect(screen.getByText('Keyset npub')).toBeInTheDocument();
      expect(screen.getByText('Raw hex')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copy group public key' })).not.toBeInTheDocument();
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

  it('keeps the onboarding client running while editing distribution package details', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Playwright Treasury' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Share' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Save Profile' })).toBeInTheDocument();
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
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    const firstCard = screen.getAllByTestId(CRITICAL_E2E_TEST_IDS.distributionCard)[0];
    fireEvent.change(within(firstCard).getByLabelText('Package password'), {
      target: { value: 'remote-share-pass' },
    });
    expect(screen.getByText('Running')).toBeInTheDocument();

    fireEvent.click(within(firstCard).getByRole('button', { name: /sign permission: enabled/i }));

    await waitFor(() => {
      expect(within(firstCard).getByRole('button', { name: /sign permission: disabled/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('validates relays before adding them on the create save-profile step', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Keyset' }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Relay Guard Treasury' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Share' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Save Profile' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Add relay'), { target: { value: 'not-a-relay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Relay' }));

    expect(screen.getByText('Invalid relay URL: not-a-relay')).toBeInTheDocument();
    const relayRows = screen.getAllByTestId(CRITICAL_E2E_TEST_IDS.relayRow);
    expect(relayRows.map((row) => row.getAttribute('data-relay-url'))).not.toContain('not-a-relay');
  });

  it.each(['create-select-share', 'create-save-profile', 'create-distribute'] as const)(
    'normalizes a reloaded %s setup state back to the create form',
    async (activeView) => {
      cleanup();
      window.history.replaceState(null, '', '/create');
      window.localStorage.setItem(
        partitionKeyFor(),
        JSON.stringify({
          profiles: [],
          selectedProfileId: '',
          activeView,
          activeDashboardTab: 'signer',
          settings: {
            remember_browser_state: true,
            auto_open_signer: true,
            prefer_install_prompt: true,
          },
          drafts: {
            createForm: { mode: 'new', groupName: 'Recovered Treasury', threshold: '2', count: '3' },
            rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
            profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
            distributionForms: {},
            importProfileForm: { profileString: '' },
            onboardConnectForm: { packageText: '' },
            onboardSaveForm: { label: '' },
            rotateConnectForm: { packageText: '' },
          },
          peerPermissionStates: [],
        }),
      );

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Create New Keyset' })).toBeInTheDocument();
        expect(screen.getByLabelText('Group Name')).toHaveValue('Recovered Treasury');
        expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: 'Select Share' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Save Profile' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Distribute Shares' })).not.toBeInTheDocument();
    },
  );

  it.each([
    ['load-confirm', '/import', 'Import Existing Device', 'Save Profile'],
    ['onboard-save', '/onboard', 'Input Package', 'Save Profile'],
  ] as const)('normalizes a reloaded %s state back to its resumable input step', async (
    activeView,
    route,
    expectedHeading,
    missingHeading,
  ) => {
    cleanup();
    window.history.replaceState(null, '', route);
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [],
        selectedProfileId: '',
        activeView,
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
          rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
          recoverKeyForm: { sourceProfileId: '', returnView: 'landing', sources: [{ packageText: '' }] },
          profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
          distributionForms: {},
          distributionPermissions: {},
          importProfileForm: { profileString: '' },
          importSaveForm: { label: '', relayUrls: '' },
          onboardConnectForm: { packageText: '' },
          onboardSaveForm: { label: '' },
          rotateConnectForm: { packageText: '' },
        },
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: expectedHeading })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: missingHeading })).not.toBeInTheDocument();
  });

  it('normalizes stale load-recover storage back to the import entry screen', async () => {
    cleanup();
    window.history.replaceState(null, '', '/import');
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({
        profiles: [],
        selectedProfileId: '',
        activeView: 'load-recover',
        activeDashboardTab: 'signer',
        settings: {
          remember_browser_state: true,
          auto_open_signer: true,
          prefer_install_prompt: true,
        },
        drafts: {
          createForm: { mode: 'new', groupName: '', threshold: '2', count: '3' },
          rotationForm: { sourceProfileId: '', sources: [{ packageText: '' }] },
          recoverKeyForm: { sourceProfileId: '', returnView: 'landing', sources: [{ packageText: '' }] },
          profileForm: { label: '', relayUrls: 'wss://relay.primal.net' },
          distributionForms: {},
          distributionPermissions: {},
          importProfileForm: { profileString: 'bfprofile1old-recover' },
          importSaveForm: { label: '', relayUrls: '' },
          onboardConnectForm: { packageText: '' },
          onboardSaveForm: { label: '' },
          rotateConnectForm: { packageText: '' },
        },
        peerPermissionStates: [],
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Import Existing Device' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Profile Backup')).toHaveValue('bfprofile1old-recover');
    expect(screen.queryByRole('heading', { name: 'Collect Shares' })).not.toBeInTheDocument();
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

  it('returns from onboard save to welcome and resets the onboard entry draft', async () => {
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
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back to Welcome' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Igloo Web' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Save Profile' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Onboard New Device' }));

    expect(screen.getByRole('heading', { name: 'Input Package' })).toBeInTheDocument();
    expect(screen.getByLabelText('bfonboard')).toHaveValue('');
    expect(screen.getByLabelText('Encryption Password')).toHaveValue('');
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
    window.history.replaceState(null, '', '/onboard');
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
    window.history.replaceState(null, '', '/onboard');
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

  it('auto-includes the unlocked local share when rotating an existing keyset', async () => {
    cleanup();
    const profile = buildRuntimeProfile('77'.repeat(32));
    seedStoredProfile(profile);
    const unlockSpy = vi
      .spyOn(adapter, 'unlockShareFromArtifact')
      .mockResolvedValueOnce(sharePackageToWireJson(profile.member_idx, '22'.repeat(32)));
    const rotateSpy = vi.spyOn(adapter, 'createRotatedKeyset').mockResolvedValueOnce({
      group_name: 'Runtime Key',
      threshold: 2,
      count: 3,
      group_public_key: profile.group_public_key,
      group_package_json: profile.group_package_json,
      shares: [
        {
          name: 'Runtime Key Device 1',
          member_idx: 1,
          share_public_key: profile.share_public_key,
          share_package_json: sharePackageToWireJson(1, '11'.repeat(32)),
        },
      ],
    });
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    await act(async () => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
      await latestStore?.unlockLocalSourceShare(profile.id, 'local-device-pass');
      latestStore?.setActiveView('create-generate');
      latestStore?.updateCreateForm('mode', 'rotate');
      latestStore?.updateRotationForm('sourceProfileId', profile.id);
      latestStore?.updateRotationSource(0, 'packageText', 'bfshare1remote');
      latestStore?.updateRotationSource(0, 'password', 'remote-pass');
    });

    await waitFor(() => {
      expect(unlockSpy).toHaveBeenCalledWith(profile, 'local-device-pass');
      expect(latestStore?.unlockPassphrase).toBe('local-device-pass');
      expect(latestStore?.drafts.createForm.mode).toBe('rotate');
      expect(latestStore?.drafts.rotationForm.sourceProfileId).toBe(profile.id);
    });

    await act(async () => {
      await latestStore?.generateKeyset();
    });

    expect(rotateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          { packageText: profile.encrypted_bfshare_artifact, password: 'local-device-pass' },
          { packageText: 'bfshare1remote', password: 'remote-pass' },
        ],
      }),
    );
    expect(latestStore?.activeView).toBe('create-select-share');
  });

  it('does not submit the selected local profile again as a remote rotate source', async () => {
    cleanup();
    const profile = buildRuntimeProfile('78'.repeat(32));
    seedStoredProfile(profile);
    vi.spyOn(adapter, 'unlockShareFromArtifact').mockResolvedValueOnce(
      sharePackageToWireJson(profile.member_idx, '22'.repeat(32)),
    );
    const rotateSpy = vi.spyOn(adapter, 'createRotatedKeyset').mockResolvedValueOnce({
      group_name: 'Runtime Key',
      threshold: 2,
      count: 3,
      group_public_key: profile.group_public_key,
      group_package_json: profile.group_package_json,
      shares: [
        {
          name: 'Runtime Key Device 1',
          member_idx: 1,
          share_public_key: profile.share_public_key,
          share_package_json: sharePackageToWireJson(1, '11'.repeat(32)),
        },
      ],
    });
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    await act(async () => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
      await latestStore?.unlockLocalSourceShare(profile.id, 'local-device-pass');
      latestStore?.setActiveView('create-generate');
      latestStore?.updateCreateForm('mode', 'rotate');
      latestStore?.updateRotationForm('sourceProfileId', profile.id);
      latestStore?.updateRotationSource(0, 'packageText', profile.profile_string);
      latestStore?.updateRotationSource(0, 'password', 'local-profile-pass');
      latestStore?.addRotationSource();
      latestStore?.updateRotationSource(1, 'packageText', 'bfshare1remote');
      latestStore?.updateRotationSource(1, 'password', 'remote-pass');
    });

    await act(async () => {
      await latestStore?.generateKeyset();
    });

    expect(rotateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          { packageText: profile.encrypted_bfshare_artifact, password: 'local-device-pass' },
          { packageText: 'bfshare1remote', password: 'remote-pass' },
        ],
      }),
    );
  });

  it('auto-includes the unlocked local share when recovering an existing keyset', async () => {
    cleanup();
    const profile = buildRuntimeProfile('76'.repeat(32));
    seedStoredProfile(profile);
    vi.spyOn(adapter, 'unlockShareFromArtifact').mockResolvedValueOnce(
      sharePackageToWireJson(profile.member_idx, '22'.repeat(32)),
    );
    const recoverSpy = vi.spyOn(adapter, 'recoverNsecFromShares').mockResolvedValueOnce({
      nsec: `nsec1${'q'.repeat(58)}`,
      signingKeyHex: '11'.repeat(32),
    });
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    await act(async () => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
      await latestStore?.unlockLocalSourceShare(profile.id, 'local-device-pass');
      latestStore?.startRecoverKey(profile.id, 'dashboard');
      latestStore?.updateRecoverSource(0, 'packageText', 'bfshare1remote');
      latestStore?.updateRecoverSource(0, 'password', 'remote-pass');
    });

    await act(async () => {
      await latestStore?.recoverKeyFromShares();
    });

    expect(recoverSpy).toHaveBeenCalledWith({
      sources: [
        { packageText: profile.encrypted_bfshare_artifact, password: 'local-device-pass' },
        { packageText: 'bfshare1remote', password: 'remote-pass' },
      ],
    });
    expect(latestStore?.activeView).toBe('recover-key');
  });

  it('does not include the local recovery share when the device passphrase is locked', async () => {
    cleanup();
    const profile = buildRuntimeProfile('75'.repeat(32));
    seedStoredProfile(profile);
    const recoverSpy = vi.spyOn(adapter, 'recoverNsecFromShares').mockResolvedValueOnce({
      nsec: `nsec1${'q'.repeat(58)}`,
      signingKeyHex: '11'.repeat(32),
    });
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    act(() => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
      latestStore?.startRecoverKey(profile.id, 'landing');
      latestStore?.updateRecoverSource(0, 'packageText', 'bfshare1remote');
      latestStore?.updateRecoverSource(0, 'password', 'remote-pass');
      latestStore?.updateRecoverSource(1, 'packageText', 'bfshare1backup');
      latestStore?.updateRecoverSource(1, 'password', 'backup-pass');
    });

    await act(async () => {
      await latestStore?.recoverKeyFromShares();
    });

    expect(recoverSpy).toHaveBeenCalledWith({
      sources: [
        { packageText: 'bfshare1remote', password: 'remote-pass' },
        { packageText: 'bfshare1backup', password: 'backup-pass' },
      ],
    });
    expect(latestStore?.activeView).toBe('recover-key');
  });

  it('exports the persisted bfshare artifact when full package strings are absent after reload', async () => {
    cleanup();
    const profile = buildRuntimeProfile('76'.repeat(32));
    const persistedProfile = { ...profile } as Partial<PwaProfile>;
    delete persistedProfile.profile_string;
    delete persistedProfile.share_string;
    seedStoredProfile(persistedProfile as PwaProfile);
    const exportSpy = vi.spyOn(adapter, 'exportEncryptedPackage').mockResolvedValueOnce('bfshare1exported');
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    act(() => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
    });

    let exported = '';
    await act(async () => {
      exported = await latestStore!.exportEncryptedPackage(profile.id, 'bfshare', 'export-pass');
    });

    expect(exported).toBe('bfshare1exported');
    expect(exportSpy).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        id: profile.id,
        encrypted_bfshare_artifact: 'bfshare1demo',
      }),
      profileString: '',
      shareString: 'bfshare1demo',
      storedPassword: 'local-device-pass',
      exportPassword: 'export-pass',
      format: 'bfshare',
    });
  });

  it('rebuilds a bfprofile export from the persisted share artifact after reload', async () => {
    cleanup();
    const profile = buildRuntimeProfile('76'.repeat(32));
    const persistedProfile = { ...profile } as Partial<PwaProfile>;
    delete persistedProfile.profile_string;
    delete persistedProfile.share_string;
    seedStoredProfile(persistedProfile as PwaProfile);
    const exportSpy = vi.spyOn(adapter, 'exportEncryptedPackage').mockResolvedValueOnce('bfprofile1exported');
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => (latestStore = store)} />
      </StoreProvider>,
    );

    await waitFor(() => {
      expect(latestStore?.profiles).toHaveLength(1);
    });

    act(() => {
      latestStore?.selectProfile(profile.id);
      latestStore?.setUnlockPassphrase('local-device-pass');
    });

    let exported = '';
    await act(async () => {
      exported = await latestStore!.exportEncryptedPackage(profile.id, 'bfprofile', 'export-pass');
    });

    expect(exported).toBe('bfprofile1exported');
    expect(exportSpy).toHaveBeenCalledWith({
      profile: expect.objectContaining({
        id: profile.id,
        encrypted_bfshare_artifact: 'bfshare1demo',
      }),
      profileString: '',
      shareString: 'bfshare1demo',
      storedPassword: 'local-device-pass',
      exportPassword: 'export-pass',
      format: 'bfprofile',
    });
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
    const storedState = JSON.parse(window.localStorage.getItem(partitionKeyFor()) ?? '{}') as {
      profiles?: PwaProfile[];
    };
    mockStartSession(storedState.profiles?.[0] ?? buildRuntimeProfile('77'.repeat(32)), false);

    render(<App />);
    await unlockStoredProfile();

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
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsCopyShare));
    const exportShareDialog = screen.getByRole('dialog', { name: 'Export Share' });
    await waitFor(() =>
      expect(screen.queryByTestId(CRITICAL_E2E_TEST_IDS.dashboardSettingsSidebar)).not.toBeInTheDocument(),
    );
    const exportPassword = within(exportShareDialog).getByLabelText('Export Password');
    exportPassword.focus();
    fireEvent.input(exportPassword, { target: { value: 'a' } });
    expect(exportPassword).toHaveFocus();
    fireEvent.click(within(exportShareDialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
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
    expect(within(onboardDialog).getByText('Start the signer before creating the package.')).toBeVisible();
    expect(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePackage)).toBeVisible();
    expect(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCreate)).toBeDisabled();
    expect(within(onboardDialog).queryByRole('heading', { name: 'Package Producer Required' })).not.toBeInTheDocument();
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
    expect(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCreate)).toBeDisabled();
    fireEvent.click(within(onboardDialog).getByRole('button', { name: 'Cancel' }));
    const cancelOnboardDialog = screen.getByRole('dialog', { name: 'Cancel onboarding setup?' });
    expect(cancelOnboardDialog).toBeInTheDocument();
    expect(within(cancelOnboardDialog).getByText('Discard this onboarding package draft?')).toBeVisible();
    fireEvent.click(within(cancelOnboardDialog).getByRole('button', { name: 'Keep Editing' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cancel onboarding setup?' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Onboard a Device' })).toBeInTheDocument();
    fireEvent.click(within(onboardDialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Setup' }));
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

  it('shows friendly copy instead of raw runtime text when profile export fails', async () => {
    cleanup();
    const profile = buildRuntimeProfile('78'.repeat(32));
    seedStoredProfile(profile);
    mockStartSession(profile);
    vi.spyOn(adapter, 'exportEncryptedPackage').mockRejectedValueOnce(
      new TypeError("undefined is not an object (evaluating 'profile.profile_string.trim')"),
    );

    render(<App />);
    await unlockStoredProfile('local-device-pass');

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsCopyProfile));

    const exportDialog = screen.getByRole('dialog', { name: 'Export Profile' });
    fireEvent.change(within(exportDialog).getByLabelText('Export Password'), {
      target: { value: 'export-pass' },
    });
    fireEvent.change(within(exportDialog).getByLabelText('Confirm Password'), {
      target: { value: 'export-pass' },
    });
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(
        within(exportDialog).getByText("We couldn't create this export package. Check the export password and try again."),
      ).toBeInTheDocument();
    });
    expect(within(exportDialog).queryByText(/undefined is not an object/i)).not.toBeInTheDocument();
    expect(within(exportDialog).queryByText(/profile\.profile_string\.trim/i)).not.toBeInTheDocument();
  });

  it('creates a Settings onboarding package from an explicit bfshare while signer is running', async () => {
    cleanup();
    let resolveClipboardWrite: () => void = () => {};
    const clipboardWrite = vi
      .fn()
      .mockRejectedValueOnce(new Error('clipboard denied'))
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClipboardWrite = resolve;
          }),
      );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    let resolveFileWrite: () => void = () => {};
    const fileWrite = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFileWrite = resolve;
        }),
    );
    const fileClose = vi.fn().mockResolvedValue(undefined);
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: fileWrite, close: fileClose }),
    });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: showSaveFilePicker,
    });
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
    const sourceShareNpub = nip19.npubEncode(sourceSharePublicKey);
    const sourceShareDisplay = `${sourceShareNpub.slice(0, 8)}...${sourceShareNpub.slice(-4)}`;
    expect(screen.getByDisplayValue('bfonboard1test')).toBeInTheDocument();
    expect(screen.getByText('Share #2')).toBeInTheDocument();
    expect(screen.getByText(sourceShareDisplay)).toBeInTheDocument();
    expect(screen.getByText(sourceSharePublicKey)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCopy));
    expect(clipboardWrite).toHaveBeenCalledWith('bfonboard1test');
    await waitFor(() =>
      expect(screen.getByRole('alert', { name: 'Onboard package handoff status' })).toHaveTextContent(
        'Copy failed. Copy the package manually.',
      ),
    );
    expect(screen.getByRole('alert', { name: 'Onboard package handoff status' })).toHaveAttribute(
      'data-tone',
      'warning',
    );

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCopy));
    expect(clipboardWrite).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Copying...' })).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSave)).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardQr)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Copying package...');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
    await act(async () => {
      resolveClipboardWrite();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Package copied.'));
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSave));
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: `remote-device-${sourceSharePublicKey.slice(0, 8)}.bfonboard.txt`,
      }),
    );
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardCopy)).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardQr)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving package...');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
    await waitFor(() => expect(fileWrite).toHaveBeenCalledWith('bfonboard1test'));
    await act(async () => {
      resolveFileWrite();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Package saved.'));
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardQr));
    expect(screen.getByRole('dialog', { name: 'Onboarding Package' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('QR code opened.');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');

    startSessionSpy.mockRestore();
  });

  it('marks Settings onboarding source material invalid after package creation fails', async () => {
    cleanup();
    const profile = buildRuntimeProfile('79'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Primary Browser Device',
      group_package_json: JSON.stringify({
        group_name: 'Test Group',
        group_pk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${profile.share_public_key}` },
          { idx: 2, pubkey: `02${'44'.repeat(32)}` },
        ],
      }),
    });
    mockStartSession(profile, true, {
      runtime_host: {
        profile_id: profile.id,
        mode: 'browser',
        log_source: 'In-memory session logs',
        started_at: 1700000000,
        signer_pubkey: profile.share_public_key,
      },
    });
    const createPackageSpy = vi
      .spyOn(adapter, 'createSettingsOnboardingPackageFromBfshare')
      .mockRejectedValueOnce(new Error('Source bfshare does not match any member in this keyset.'));

    render(<App />);
    await unlockStoredProfile('current-device-pass');

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDevice));

    const onboardDialog = screen.getByRole('dialog', { name: 'Onboard a Device' });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDeviceLabel), {
      target: { value: 'Remote Device' },
    });
    fireEvent.change(within(onboardDialog).getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePackage), {
      target: { value: 'bfshare1wrong' },
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

    const sourceError = await screen.findByRole('alert', { name: 'Onboard package creation failed' });
    expect(sourceError).toHaveTextContent('Source bfshare does not match any member in this keyset.');
    expect(screen.getByLabelText('Source bfshare')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Source bfshare')).toHaveAccessibleDescription(
      'Source bfshare does not match any member in this keyset.',
    );
    expect(screen.getByLabelText('Source Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Source Password')).toHaveAccessibleDescription(
      'Source bfshare does not match any member in this keyset.',
    );

    fireEvent.change(screen.getByLabelText('Source bfshare'), {
      target: { value: 'bfshare1fixed' },
    });
    expect(screen.queryByRole('alert', { name: 'Onboard package creation failed' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Source bfshare')).not.toHaveAttribute('aria-invalid');

    createPackageSpy.mockRestore();
  });

  it('locks the Settings onboarding form while package creation is running', async () => {
    cleanup();
    const profile = buildRuntimeProfile('78'.repeat(32));
    seedStoredProfile({
      ...profile,
      label: 'Primary Browser Device',
      group_package_json: JSON.stringify({
        group_name: 'Test Group',
        group_pk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${profile.share_public_key}` },
          { idx: 2, pubkey: `02${'33'.repeat(32)}` },
        ],
      }),
    });
    mockStartSession(profile, true, {
      runtime_host: {
        profile_id: profile.id,
        mode: 'browser',
        log_source: 'In-memory session logs',
        started_at: 1700000000,
        signer_pubkey: profile.share_public_key,
      },
    });
    let resolvePackage: (value: Awaited<ReturnType<typeof adapter.createSettingsOnboardingPackageFromBfshare>>) => void =
      () => {};
    vi.spyOn(adapter, 'createSettingsOnboardingPackageFromBfshare').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePackage = resolve;
        }),
    );

    render(<App />);
    await unlockStoredProfile('current-device-pass');

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
      expect(screen.getByRole('status')).toHaveTextContent('Creating onboarding package...');
    });
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardDeviceLabel)).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePackage)).toBeDisabled();
    expect(screen.getByTestId(CRITICAL_E2E_TEST_IDS.settingsOnboardSourcePassword)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Creating...' })).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('dialog', { name: 'Onboard a Device' })).toBeInTheDocument();

    await act(async () => {
      resolvePackage({
        package_text: 'bfonboard1pending',
        preview: {
          label: 'Remote Device',
          share_public_key: '33'.repeat(32),
          group_public_key: profile.group_public_key,
          relays: profile.relays,
          group_package_json: profile.group_package_json,
          member_idx: 2,
          source: 'bfonboard',
        },
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Package Handoff' })).toBeInTheDocument();
    });
  });

  it('launches the Settings Replace Share flow with Paper terminology', async () => {
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
    const storedState = JSON.parse(window.localStorage.getItem(partitionKeyFor()) ?? '{}') as {
      profiles?: PwaProfile[];
    };
    mockStartSession(storedState.profiles?.[0] ?? buildRuntimeProfile('77'.repeat(32)));

    render(<App />);
    await unlockStoredProfile();

    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.dashboardTabSettings));
    fireEvent.click(screen.getByTestId(CRITICAL_E2E_TEST_IDS.maintenanceRotateShare));

    expect(screen.getByRole('heading', { name: 'Enter Replacement Package' })).toBeInTheDocument();
    expectHeaderLabel('Replace Share');
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
      pendingLoadErrorKind: null,
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
        recoverKeyForm: { sourceProfileId: '', returnView: 'landing', sources: [{ packageText: '' }] },
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
      pendingLoadErrorKind: null,
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
        recoverKeyForm: { sourceProfileId: '', returnView: 'landing', sources: [{ packageText: '' }] },
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
