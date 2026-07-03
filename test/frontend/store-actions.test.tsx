import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __setInstanceIdForTests } from '@/lib/instance';
import * as adapter from '@/lib/local-adapter';
import { StoreProvider, useStore } from '@/lib/store';

function StoreHarness({ onReady }: { onReady: (store: ReturnType<typeof useStore>) => void }) {
  const store = useStore();
  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);
  return null;
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
});
