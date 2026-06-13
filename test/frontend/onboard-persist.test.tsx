import * as React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadPersistedState } from '@/lib/storage';
import { __setInstanceIdForTests } from '@/lib/instance';
import { StoreProvider, useStore } from '@/lib/store';

// Captures the live store value so a test can drive store actions directly,
// mirroring the harness used in App.test.tsx.
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

// Regression for the onboard-persist data-loss bug: `finalizeOnboardedDevice`
// renders the dashboard in-memory, but persistence runs through a *debounced*
// localStorage write (250/500ms). Because `pendingOnboardConnection` is reset
// on load for security, a reload inside that debounce window used to drop the
// onboarded device entirely (persisted partition still at `onboard-save`,
// `profiles: []`). `persistProfileToDashboard` now flushes synchronously, so
// the device is durable the instant onboarding completes.
describe('onboarded profile persistence (data-loss regression)', () => {
  it('writes the onboarded device to localStorage synchronously — no debounce wait', async () => {
    let store: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(s) => (store = s)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(store).toBeDefined());

    // Drive the onboard flow exactly as the UI does, through the store. The
    // captured `store` value embeds its render's state, and `onReady` swaps it
    // on every render — so gate on the latest `store` reflecting each step
    // before driving the next (otherwise we act on a stale pre-connect closure).
    store!.updateOnboardConnectForm('packageText', `bfonboard1${'q'.repeat(96)}`);
    store!.updateOnboardConnectPassword('playwright-onboard-pass');
    await store!.connectOnboardingPackage();
    await waitFor(() => expect(store!.pendingOnboardConnection).not.toBeNull());

    store!.updateOnboardSaveForm('label', 'Onboarded Device');
    store!.updateOnboardSavePassword('password', 'playwright-onboard-pass');
    store!.updateOnboardSavePassword('confirmPassword', 'playwright-onboard-pass');
    await waitFor(() =>
      expect(store!.draftSecrets.onboardSaveFormConfirm).toBe('playwright-onboard-pass'),
    );

    await store!.finalizeOnboardedDevice();

    // No timer advance: the debounced persist effect has NOT fired, so the only
    // path to localStorage is the synchronous flush. Read the partition blob
    // exactly as a fresh page load would (`loadPersistedState`).
    const persisted = loadPersistedState();
    expect(persisted).not.toBeNull();
    expect(persisted?.profiles.map((profile) => profile.id)).toContain('77'.repeat(32));
    expect(persisted?.activeView).toBe('dashboard');
  });
});
