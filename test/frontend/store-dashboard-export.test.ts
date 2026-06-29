import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as adapter from '@/lib/local-adapter';
import { SessionController } from '@/lib/session-controller';
import { createDashboardActions } from '@/lib/store-dashboard';
import { createDefaultState } from '@/lib/store-hydrate';
import type { PwaPersistedState, PwaProfile } from '@/lib/types';

function buildPersistedProfileWithoutTransientPackages(): PwaProfile {
  return {
    id: '77'.repeat(32),
    label: 'Persisted Device',
    share_public_key: '33'.repeat(32),
    group_public_key: '22'.repeat(32),
    relays: ['wss://relay.primal.net'],
    group_package_json: JSON.stringify({
      group_name: 'Persisted Device',
      group_pk: '22'.repeat(32),
      threshold: 2,
      members: [
        { idx: 1, pubkey: `02${'33'.repeat(32)}` },
        { idx: 2, pubkey: `02${'44'.repeat(32)}` },
      ],
    }),
    member_idx: 1,
    source: 'bfonboard',
    relay_profile: 'browser',
    group_ref: 'group-ref',
    encrypted_profile_ref: 'encrypted-profile-ref',
    state_path: '/tmp/igloo-pwa/profile',
    created_at: 1700000000,
    encrypted_bfshare_artifact: 'bfshare1sealed',
    profile_string: undefined,
    share_string: undefined,
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
  } as unknown as PwaProfile;
}

describe('dashboard package export', () => {
  it('exports a hydrated persisted profile without transient profile_string', async () => {
    const profile = buildPersistedProfileWithoutTransientPackages();
    const state: PwaPersistedState = {
      ...createDefaultState(),
      profiles: [profile],
      selectedProfileId: profile.id,
      unlockPassphrase: 'device-passphrase',
    };
    const exportSpy = vi
      .spyOn(adapter, 'exportEncryptedPackage')
      .mockResolvedValueOnce('bfprofile1portable');

    const actions = createDashboardActions({
      controller: new SessionController(),
      getState: () => state,
      getSelectedProfile: () => profile,
      setState: vi.fn() as unknown as Dispatch<SetStateAction<PwaPersistedState>>,
    });

    await expect(
      actions.exportEncryptedPackage(profile.id, 'bfprofile', 'export-passphrase'),
    ).resolves.toBe('bfprofile1portable');
    expect(exportSpy).toHaveBeenCalledWith({
      profile,
      storedPassword: 'device-passphrase',
      exportPassword: 'export-passphrase',
      format: 'bfprofile',
    });

    exportSpy.mockRestore();
  });
});
