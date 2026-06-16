import * as React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadGlobalState, loadSessionState } from '@/lib/storage';
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

    // Adoption ran end-to-end: the live staged onboarding node was promoted to
    // the active signer (auto-open default), so the device is signing without a
    // second node + snapshot-restore round-trip.
    await waitFor(() => expect(store!.runtimeSnapshot?.active).toBe(true));

    // No timer advance: the debounced persist effect has NOT fired, so the only
    // path to localStorage is the synchronous flush. Read both stores exactly as
    // a fresh page load would: the device lands in the shared global store, the
    // dashboard view in this tab's session store.
    const global = loadGlobalState();
    const session = loadSessionState();
    expect(global).not.toBeNull();
    expect(global?.profiles.map((profile) => profile.id)).toContain('77'.repeat(32));
    expect(session?.activeView).toBe('dashboard');
  });

  it('cancelOnboarding clears the pending connection and leaves the flow', async () => {
    let store: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <StoreHarness onReady={(s) => (store = s)} />
      </StoreProvider>,
    );
    await waitFor(() => expect(store).toBeDefined());

    store!.updateOnboardConnectForm('packageText', `bfonboard1${'q'.repeat(96)}`);
    store!.updateOnboardConnectPassword('playwright-onboard-pass');
    await store!.connectOnboardingPackage();
    await waitFor(() => expect(store!.pendingOnboardConnection).not.toBeNull());

    store!.cancelOnboarding();

    // The staged onboarding node is torn down inside the controller; the store
    // clears the in-memory connection + device-password drafts and leaves the
    // flow. A subsequent finalize is rejected (nothing pending).
    await waitFor(() => expect(store!.pendingOnboardConnection).toBeNull());
    expect(store!.activeView).toBe('landing');
    expect(store!.draftSecrets.onboardSaveFormPassword).toBe('');
    await expect(store!.finalizeOnboardedDevice()).rejects.toThrow(/connect an onboarding package/i);
  });
});
