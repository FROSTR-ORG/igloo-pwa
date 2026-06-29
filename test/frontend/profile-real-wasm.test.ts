import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configureWasmProfileLoader,
  createProfilePackagePair,
  deriveProfileIdFromShareSecret,
  Secret,
  setInjectedWasmProfileModuleForTests,
  type BrowserProfilePackagePayload,
} from 'igloo-shared';

import * as adapter from '@/lib/local-adapter';

const wasmDir = resolve(process.cwd(), 'public/wasm');
const loaderUrl = pathToFileURL(resolve(wasmDir, 'bifrost_profile_wasm.js')).href;
const wasmBytes = readFileSync(
  fileURLToPath(pathToFileURL(resolve(wasmDir, 'bifrost_profile_wasm_bg.wasm'))),
);

function injectProfileWasmStub() {
  setInjectedWasmProfileModuleForTests({
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
    decode_bfprofile_package: () =>
      JSON.stringify({
        profileId: '77'.repeat(32),
        version: 1,
        device: {
          name: 'Onboarded Device',
          shareSecret: '11'.repeat(32),
          manualPeerPolicyOverrides: [],
          relays: ['wss://relay.primal.net'],
        },
        groupPackage: {
          groupName: 'Onboarded Device',
          groupPk: '22'.repeat(32),
          threshold: 2,
          members: [
            { idx: 1, pubkey: `02${'33'.repeat(32)}` },
            { idx: 2, pubkey: `02${'44'.repeat(32)}` },
            { idx: 3, pubkey: `02${'55'.repeat(32)}` },
          ],
        },
      }),
    create_profile_package_pair: () =>
      JSON.stringify({ profileString: 'bfprofile1test', shareString: 'bfshare1test' }),
  } as never);
}

function useRealProfileWasm() {
  setInjectedWasmProfileModuleForTests(null);
  configureWasmProfileLoader({
    loaderImportUrl: loaderUrl,
    wasmBinaryUrl: wasmBytes as unknown as string,
  });
}

async function fixturePayload(): Promise<BrowserProfilePackagePayload> {
  const shareSecret = '11'.repeat(32);
  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: 'PWA Real WASM Test Device',
      shareSecret,
      manualPeerPolicyOverrides: [],
      relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
    },
    groupPackage: {
      groupName: 'PWA Real WASM Test Group',
      groupPk: '22'.repeat(32),
      threshold: 2,
      members: [
        { idx: 1, pubkey: `02${'33'.repeat(32)}` },
        { idx: 2, pubkey: `02${'44'.repeat(32)}` },
        { idx: 3, pubkey: `02${'55'.repeat(32)}` },
      ],
    },
  };
}

function corruptPackage(value: string): string {
  const chars = [...value];
  const mid = Math.floor(chars.length / 2);
  chars[mid] = chars[mid] === 'q' ? 'p' : 'q';
  return chars.join('');
}

async function createRealPackagePair() {
  const pair = await createProfilePackagePair(await fixturePayload(), Secret.of('correct horse'));
  expect(pair.profileString.startsWith('bfprofile1')).toBe(true);
  expect(pair.shareString.startsWith('bfshare1')).toBe(true);
  expect(pair.profileString).not.toBe('bfprofile1test');
  expect(pair.shareString).not.toBe('bfshare1test');
  return pair;
}

beforeEach(() => {
  useRealProfileWasm();
});

afterEach(() => {
  injectProfileWasmStub();
});

describe('pwa profile packages with real WASM', () => {
  it('rejects bfprofile import under the wrong password', async () => {
    const pair = await createRealPackagePair();

    await expect(
      adapter.importBfProfile({ profileString: pair.profileString, password: 'battery staple' }),
    ).rejects.toThrow();
  });

  it('rejects a corrupted bfprofile import package', async () => {
    const pair = await createRealPackagePair();

    await expect(
      adapter.importBfProfile({
        profileString: corruptPackage(pair.profileString),
        password: 'correct horse',
      }),
    ).rejects.toThrow();
  });

  it('maps a real bfshare wrong password to the stable unlock error', async () => {
    const pair = await createRealPackagePair();

    await expect(
      adapter.unlockShareFromArtifact(
        { encrypted_bfshare_artifact: pair.shareString, member_idx: 1 },
        'battery staple',
      ),
    ).rejects.toThrow('Incorrect passphrase.');
  });

  it('maps a corrupted real bfshare package to the stable unlock error', async () => {
    const pair = await createRealPackagePair();

    await expect(
      adapter.unlockShareFromArtifact(
        { encrypted_bfshare_artifact: corruptPackage(pair.shareString), member_idx: 1 },
        'correct horse',
      ),
    ).rejects.toThrow('Incorrect passphrase.');
  });

  it('exports a durable profile after transient package strings are gone', async () => {
    const pair = await createRealPackagePair();
    const confirmation = await adapter.importBfProfile({
      profileString: pair.profileString,
      password: 'correct horse',
    });
    const profile = await adapter.finalizeLoadedProfile(confirmation, [], 'correct horse');
    delete profile.profile_string;
    delete profile.share_string;

    const exported = await adapter.exportEncryptedPackage({
      profile,
      storedPassword: 'correct horse',
      exportPassword: 'fresh export password',
      format: 'bfprofile',
    });

    expect(exported.startsWith('bfprofile1')).toBe(true);
    await expect(
      adapter.importBfProfile({
        profileString: exported,
        password: 'fresh export password',
      }),
    ).resolves.toMatchObject({
      kind: 'bfprofile',
      preview: expect.objectContaining({
        label: 'PWA Real WASM Test Device',
      }),
    });
  });
});
