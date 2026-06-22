import { describe, expect, it } from 'vitest';

import { setInjectedWasmProfileModuleForTests } from 'igloo-shared';

import * as adapter from '@/lib/local-adapter';
import { setBrowserRuntimeTestHooks } from '@/lib/page-runtime-host';
import type { PwaProfile } from '@/lib/types';

// Scope note: the PWA's real package crypto runs in WASM, which the unit
// harness mocks (see `src/test/setup.ts`) — so these tests cover the *adapter
// glue* that maps a decode failure to a stable, non-leaky outcome, not the
// cipher itself. Real browser-path crypto KATs (wrong-password / bit-flip
// against the actual WASM encode/decode) are tracked separately as R6.5 in
// igloo-shared, where the node WASM bridge is available.

// A complete WASM profile module is required (the loader asserts every export
// is present), so build a canned stub mirroring `src/test/setup.ts` and let
// callers override the one method under test to throw.
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

describe('pwa local-adapter decrypt failure paths', () => {
  it('maps a share decode failure to a stable "Incorrect passphrase." message', async () => {
    // A wrong passphrase makes the AEAD decode throw inside the WASM layer;
    // `unlockShareFromArtifact` must surface a fixed, non-leaky message rather
    // than the raw decode error.
    injectProfileWasmStub({
      decode_bfshare_package: () => {
        throw new Error('aead: authentication failed');
      },
    });

    await expect(
      adapter.unlockShareFromArtifact(
        { encrypted_bfshare_artifact: 'bfshare1corrupt', member_idx: 1 },
        'wrong-passphrase',
      ),
    ).rejects.toThrow('Incorrect passphrase.');
  });

  it('refuses to start a session for a legacy profile with no encrypted artifact', async () => {
    // v1 → v2 migration drop: the encrypted share artifact is absent. The guard
    // must force a re-onboard rather than attempting an unlock with nothing.
    const legacyProfile = { encrypted_bfshare_artifact: '' } as PwaProfile;

    await expect(adapter.startSession(legacyProfile, 'any-passphrase')).rejects.toThrow(
      /legacy v1 schema/i,
    );
  });

  it('propagates a profile-package decode failure out of import', async () => {
    // A bad export password (or corrupted bfprofile) makes the profile decode
    // throw; `importBfProfile` must reject rather than yield a partial profile.
    injectProfileWasmStub({
      decode_bfprofile_package: () => {
        throw new Error('aead: authentication failed');
      },
    });

    await expect(
      adapter.importBfProfile({ profileString: 'bfprofile1corrupt', password: 'wrong-pw' }),
    ).rejects.toThrow();
  });

  it('propagates an onboarding connect failure', async () => {
    // The onboarding decode/connect happens behind the runtime host hook; a
    // rejection there (wrong onboarding password, malformed package) must
    // propagate out of `connectOnboardingPackage`.
    setBrowserRuntimeTestHooks({
      async connectOnboardingPackageAndCaptureProfile() {
        throw new Error('invalid onboarding package');
      },
    });

    await expect(
      adapter.connectOnboardingPackage({ packageText: 'bfonboard1corrupt', password: 'wrong-pw' }),
    ).rejects.toThrow(/invalid onboarding package/i);
  });
});
