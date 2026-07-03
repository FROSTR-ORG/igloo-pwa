import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __setInstanceIdForTests } from '@/lib/instance';
import * as adapter from '@/lib/local-adapter';
import { GLOBAL_STORE_KEY } from '@/lib/storage';
import { StoreProvider, useStore } from '@/lib/store';
import type { PwaProfile, PwaRuntimeSnapshot } from '@/lib/types';

function StoreHarness({ onReady }: { onReady: (store: ReturnType<typeof useStore>) => void }) {
  const store = useStore();
  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);
  return null;
}

function testProfile(): PwaProfile {
  return {
    id: 'aa'.repeat(32),
    label: 'Dashboard Device',
    share_public_key: '44'.repeat(32),
    group_public_key: '55'.repeat(32),
    relays: ['wss://relay.primal.net'],
    group_package_json:
      '{"group_name":"Dashboard Device","group_pk":"55","threshold":2,"members":[{"idx":1}]}',
    member_idx: 1,
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'group-ref',
    encrypted_profile_ref: 'encrypted-profile-ref',
    encrypted_bfshare_artifact: 'bfshare1demo',
    state_path: '/tmp/igloo-pwa/dashboard-device',
    created_at: 1700000000000,
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
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

function activeSnapshot(profile: PwaProfile): PwaRuntimeSnapshot {
  return {
    active: true,
    profile,
    runtime_status: null,
    readiness: null,
    peer_permission_states: [],
    runtime_log_lines: [],
    runtime_host: null,
  };
}

function seedGlobalProfile(profile: PwaProfile) {
  window.localStorage.setItem(
    GLOBAL_STORE_KEY,
    JSON.stringify({ schemaVersion: 1, profiles: [profile] }),
  );
}

async function createRunningDashboardStore() {
  const profile = testProfile();
  seedGlobalProfile(profile);
  const startSpy = vi.spyOn(adapter, 'startSession').mockResolvedValue(activeSnapshot(profile));
  let latestStore: ReturnType<typeof useStore> | undefined;

  render(
    <StoreProvider>
      <StoreHarness onReady={(store) => (latestStore = store)} />
    </StoreProvider>,
  );

  await waitFor(() => expect(latestStore?.profiles).toHaveLength(1));
  await act(async () => {
    await latestStore!.loadStoredProfile(profile.id, 'device-passphrase');
  });
  await waitFor(() => expect(latestStore?.runtimeSnapshot?.active).toBe(true));

  return {
    profile,
    startSpy,
    get store() {
      if (!latestStore) throw new Error('store not ready');
      return latestStore;
    },
  };
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  __setInstanceIdForTests('test');
  vi.restoreAllMocks();
});

async function createDistributionStore() {
  let latestStore: ReturnType<typeof useStore> | undefined;
  render(
    <StoreProvider>
      <StoreHarness onReady={(store) => (latestStore = store)} />
    </StoreProvider>,
  );

  await waitFor(() => expect(latestStore).toBeDefined());

  act(() => {
    latestStore!.updateCreateForm('groupName', 'Distribution Key');
  });
  await waitFor(() => expect(latestStore!.drafts.createForm.groupName).toBe('Distribution Key'));

  await act(async () => {
    await latestStore!.generateKeyset();
  });
  await waitFor(() => expect(latestStore!.activeView).toBe('create-select-share'));

  act(() => {
    latestStore!.continueToSaveProfile();
    latestStore!.updateProfileFormPassword('password', 'device-passphrase');
    latestStore!.updateProfileFormPassword('confirmPassword', 'device-passphrase');
  });
  await waitFor(() =>
    expect(latestStore!.draftSecrets.profileFormConfirm).toBe('device-passphrase'),
  );

  await act(async () => {
    await latestStore!.acceptGeneratedProfile();
  });
  await waitFor(() => expect(latestStore!.activeView).toBe('create-distribute'));
  await waitFor(() => expect(latestStore!.runtimeSnapshot?.active).toBe(true));

  return {
    get store() {
      if (!latestStore) throw new Error('store not ready');
      return latestStore;
    },
  };
}

describe('store actions', () => {
  it('keeps action identities stable across state-only updates', async () => {
    const snapshots: ReturnType<typeof useStore>[] = [];
    render(
      <StoreProvider>
        <StoreHarness onReady={(store) => snapshots.push(store)} />
      </StoreProvider>,
    );

    await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    const first = snapshots[snapshots.length - 1];
    if (!first) throw new Error('store not ready');

    const setUnlockPassphrase = first.setUnlockPassphrase;
    const startLoadImport = first.startLoadImport;

    act(() => {
      first.setUnlockPassphrase('device-passphrase');
    });

    await waitFor(() =>
      expect(snapshots[snapshots.length - 1]?.unlockPassphrase).toBe('device-passphrase'),
    );
    const latest = snapshots[snapshots.length - 1];
    if (!latest) throw new Error('store not ready');

    expect(latest.setUnlockPassphrase).toBe(setUnlockPassphrase);
    expect(latest.startLoadImport).toBe(startLoadImport);
  });

  it('keeps the distribution runtime when a permission write reports session drift', async () => {
    const harness = await createDistributionStore();
    const before = harness.store.runtimeSnapshot;
    expect(before?.active).toBe(true);

    const applySpy = vi.spyOn(adapter, 'applyPeerPolicy').mockResolvedValueOnce(null);

    await act(async () => {
      await harness.store.updateDistributionPermission(2, 'ecdh', false);
    });

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0][5]).toBeDefined();
    expect(harness.store.runtimeSnapshot).toBe(before);
    expect(harness.store.drafts.distributionPermissions[2]).not.toContain('ecdh');
  });

  it('restarts the onboarding client while the create flow is distributing shares', async () => {
    const harness = await createDistributionStore();
    const restartSpy = vi.spyOn(adapter, 'startSession');

    await act(async () => {
      await harness.store.stopDistributionClient();
    });

    await waitFor(() => expect(restartSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(harness.store.runtimeSnapshot?.active).toBe(true));
    expect(harness.store.activeView).toBe('create-distribute');
    expect(harness.store.distributionSession).not.toBeNull();
  });

  it('routes home even when stopping the signer cannot capture a final snapshot', async () => {
    const harness = await createRunningDashboardStore();
    vi.spyOn(adapter, 'stopSession').mockRejectedValueOnce(new Error('snapshot capture failed'));

    await act(async () => {
      await harness.store.stopSigner();
    });

    expect(harness.store.activeView).toBe('landing');
    expect(harness.store.runtimeSnapshot).toBeNull();
    expect(harness.store.unlockPassphrase).toBe('');
    expect(harness.store.activeDashboardTab).toBe('signer');
    harness.startSpy.mockRestore();
  });

  it('routes home when a dashboard refresh finds no live signer session', async () => {
    const harness = await createRunningDashboardStore();
    vi.spyOn(adapter, 'refreshSession').mockResolvedValueOnce(null);

    await act(async () => {
      await harness.store.refreshSigner();
    });

    expect(harness.store.activeView).toBe('landing');
    expect(harness.store.runtimeSnapshot).toBeNull();
    expect(harness.store.unlockPassphrase).toBe('');
    expect(harness.store.activeDashboardTab).toBe('signer');
    harness.startSpy.mockRestore();
  });
});
