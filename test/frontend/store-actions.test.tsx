import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { __setInstanceIdForTests } from '@/lib/instance';
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
});

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
});
