import * as React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { setInjectedWasmProfileModuleForTests } from 'igloo-shared';

import { __setInstanceIdForTests } from '@/lib/instance';
import { setBrowserRuntimeTestHooks } from '@/lib/page-runtime-host';
import { StoreProvider, useStore } from '@/lib/store';

// R6.3 (store slice): a failed import/onboard decrypt must route to the error
// view AND scrub the in-memory decrypt passwords. The adapter-level mapping is
// covered by profile-decrypt.test.ts; this asserts the store's failure routing
// + secret cleanup.

function StoreHarness({ onReady }: { onReady: (store: ReturnType<typeof useStore>) => void }) {
  const store = useStore();
  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);
  return null;
}

// A complete WASM profile module is required (the loader asserts every export);
// build a canned stub and let callers override one method to throw.
function injectProfileWasmStub(overrides: Record<string, unknown>) {
  const stub = {
    bf_package_version: () => 1,
    bfshare_prefix: () => 'bfshare',
    bfonboard_prefix: () => 'bfonboard',
    bfprofile_prefix: () => 'bfprofile',
    encode_bfshare_package: () => 'bfshare1test',
    decode_bfshare_package: () =>
      JSON.stringify({ shareSecret: '11'.repeat(32), relays: ['wss://relay.primal.net'] }),
    encode_bfonboard_package: () => 'bfonboard1test',
    decode_bfonboard_package: () =>
      JSON.stringify({
        shareSecret: '11'.repeat(32),
        relays: ['wss://relay.primal.net'],
        peerPubkey: '66'.repeat(32),
      }),
    derive_profile_id_from_share_secret: () => '77'.repeat(32),
    derive_profile_id_from_share_pubkey: () => '77'.repeat(32),
    encode_bfprofile_package: () => 'bfprofile1test',
    decode_bfprofile_package: () => JSON.stringify({ profileId: '77'.repeat(32), version: 1 }),
    create_profile_package_pair: () =>
      JSON.stringify({ profileString: 'bfprofile1test', shareString: 'bfshare1test' }),
    ...overrides,
  };
  setInjectedWasmProfileModuleForTests(stub as never);
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  __setInstanceIdForTests('test');
});

function renderStore() {
  let store: ReturnType<typeof useStore> | undefined;
  render(
    <StoreProvider>
      <StoreHarness onReady={(s) => (store = s)} />
    </StoreProvider>,
  );
  return () => {
    if (!store) throw new Error('store not ready');
    return store;
  };
}

describe('store routes decrypt failures and scrubs secrets (R6.3)', () => {
  it('loadBfProfile → load-error and clears the import passwords', async () => {
    injectProfileWasmStub({
      decode_bfprofile_package: () => {
        throw new Error('aead: authentication failed');
      },
    });

    const store = renderStore();
    await waitFor(() => expect(store()).toBeDefined());

    store().updateImportProfileForm('profileString', 'bfprofile1corrupt');
    store().updateImportProfilePassword('wrong-import-pass');
    // The password actually landed in draft state before the attempt.
    await waitFor(() =>
      expect(store().draftSecrets.importProfileFormPassword).toBe('wrong-import-pass'),
    );

    await store().loadBfProfile();

    await waitFor(() => expect(store().activeView).toBe('load-error'));
    expect(store().pendingLoadError).toMatch(/aead|authentication/i);
    expect(store().pendingLoadConfirmation).toBeNull();
    // Secrets scrubbed on failure.
    expect(store().draftSecrets.importProfileFormPassword).toBe('');
    expect(store().draftSecrets.importSaveFormPassword).toBe('');
    expect(store().draftSecrets.importSaveFormConfirm).toBe('');
  });

  it('connectOnboardingPackage → onboard-failed and clears the onboard passwords', async () => {
    setBrowserRuntimeTestHooks({
      async connectOnboardingPackageAndCaptureProfile() {
        throw new Error('invalid onboarding package');
      },
    });

    const store = renderStore();
    await waitFor(() => expect(store()).toBeDefined());

    store().updateOnboardConnectForm('packageText', 'bfonboard1corrupt');
    store().updateOnboardConnectPassword('wrong-onboard-pass');
    await waitFor(() =>
      expect(store().draftSecrets.onboardConnectFormPassword).toBe('wrong-onboard-pass'),
    );

    // The store re-throws after routing; the rejection is expected.
    await expect(store().connectOnboardingPackage()).rejects.toThrow(/invalid onboarding package/i);

    await waitFor(() => expect(store().activeView).toBe('onboard-failed'));
    expect(store().pendingOnboardConnection).toBeNull();
    expect(store().draftSecrets.onboardConnectFormPassword).toBe('');
    expect(store().draftSecrets.onboardSaveFormPassword).toBe('');
    expect(store().draftSecrets.onboardSaveFormConfirm).toBe('');
  });
});
