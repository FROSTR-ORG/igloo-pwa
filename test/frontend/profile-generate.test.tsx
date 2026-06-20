import { describe, expect, it } from 'vitest';

import {
  groupPackageToWireJson,
  publicKeyFromSecret,
  sharePackageToWireJson,
} from 'igloo-shared';

import {
  createOnboardingPackageForShare,
  createSettingsOnboardingPackageFromBfshare,
} from '@/lib/local-adapter/profile-generate';
import type { PwaGeneratedKeyset, PwaProfile } from '@/lib/types';

describe('profile generation adapter', () => {
  it('creates distribution onboarding packages through the shared sponsorship contract', async () => {
    const shareSecret = '12'.repeat(32);
    const sharePublicKey = publicKeyFromSecret(shareSecret);
    const keyset: PwaGeneratedKeyset = {
      group_name: 'My Signing Key',
      threshold: 2,
      count: 2,
      group_public_key: '22'.repeat(32),
      group_package_json: groupPackageToWireJson({
        groupName: 'My Signing Key',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [{ idx: 2, pubkey: `02${sharePublicKey}` }],
      }),
      shares: [
        {
          name: 'Remote Device',
          member_idx: 2,
          share_public_key: sharePublicKey,
          share_package_json: sharePackageToWireJson(2, shareSecret),
        },
      ],
    };

    const result = await createOnboardingPackageForShare({
      keyset,
      shareMemberIdx: 2,
      label: 'Remote Device',
      password: 'package-pass',
      relayUrls: ' wss://relay.primal.net/ ',
      signerPubkey: 'aa'.repeat(32),
    });

    expect(result.package_text).toBe('bfonboard1test');
    expect(result.preview).toEqual({
      label: 'Remote Device',
      share_public_key: sharePublicKey,
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.primal.net'],
      group_package_json: keyset.group_package_json,
      member_idx: 2,
      source: 'bfonboard',
    });
    expect('share_package_json' in result.preview).toBe(false);
    expect(JSON.stringify(result.preview)).not.toContain(shareSecret);
  });

  it('creates Settings onboarding packages from an explicit bfshare source package', async () => {
    const sourceShareSecret = '11'.repeat(32);
    const sourceSharePublicKey = publicKeyFromSecret(sourceShareSecret);
    const profile: PwaProfile = {
      id: '77'.repeat(32),
      label: 'Primary Browser Device',
      share_public_key: publicKeyFromSecret('22'.repeat(32)),
      group_public_key: '22'.repeat(32),
      relays: [' wss://relay.primal.net/ '],
      group_package_json: groupPackageToWireJson({
        groupName: 'My Signing Key',
        groupPk: '22'.repeat(32),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${publicKeyFromSecret('22'.repeat(32))}` },
          { idx: 2, pubkey: `02${sourceSharePublicKey}` },
        ],
      }),
      member_idx: 1,
      source: 'generated',
      relay_profile: 'browser',
      group_ref: 'group-ref',
      encrypted_profile_ref: 'encrypted-profile-ref',
      state_path: '/tmp/igloo-pwa/profile',
      created_at: 1700000000,
      encrypted_bfshare_artifact: 'bfshare1local',
      profile_string: 'bfprofile1local',
      share_string: 'bfshare1local',
      signer_settings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted',
      },
      onboarding_package: null,
    };

    const result = await createSettingsOnboardingPackageFromBfshare({
      profile,
      label: 'Remote Device',
      sourcePackageText: ' bfshare1remote ',
      sourcePackagePassword: 'source-pass',
      password: 'package-pass',
      signerPubkey: 'aa'.repeat(32),
    });

    expect(result.package_text).toBe('bfonboard1test');
    expect(result.preview).toEqual({
      label: 'Remote Device',
      share_public_key: sourceSharePublicKey,
      group_public_key: '22'.repeat(32),
      relays: ['wss://relay.primal.net'],
      group_package_json: profile.group_package_json,
      member_idx: 2,
      source: 'bfonboard',
    });
    expect('share_package_json' in result.preview).toBe(false);
    expect(JSON.stringify(result.preview)).not.toContain(sourceShareSecret);
  });
});
