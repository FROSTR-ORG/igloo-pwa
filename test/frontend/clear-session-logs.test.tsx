import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSessionLogs,
  disposeRuntimeSessionForProfile,
  startSession,
} from '@/lib/local-adapter';
import { setBrowserRuntimeTestHooks, type BrowserRuntimeSessionSnapshot } from '@/lib/page-runtime-host';
import { createFakeBrowserRuntimeSession } from '@/lib/page-runtime-host-fakes';
import type { PwaProfile } from '@/lib/types';

function fakeSnapshot(): BrowserRuntimeSessionSnapshot {
  return {
    runtimeStatus: {
      status: { device_id: 'd', pending_ops: 0, last_active: 0, known_peers: 0, request_seq: 0 },
      metadata: { device_id: 'd', member_idx: 1, share_public_key: '33'.repeat(32), group_public_key: '22'.repeat(32), peers: [] },
      readiness: {
        runtime_ready: true, restore_complete: true, sign_ready: true, ecdh_ready: true,
        threshold: 2, signing_peer_count: 2, ecdh_peer_count: 2, last_refresh_at: 0, degraded_reasons: [],
      },
      peer_permission_states: [],
      peers: [],
      pending_operations: [],
    },
    metadata: { device_id: 'd', member_idx: 1, share_public_key: '33'.repeat(32), group_public_key: '22'.repeat(32), peers: [] },
    readiness: {
      runtime_ready: true, restore_complete: true, sign_ready: true, ecdh_ready: true,
      threshold: 2, signing_peer_count: 2, ecdh_peer_count: 2, last_refresh_at: 0, degraded_reasons: [],
    },
    peerPermissionStates: [],
    signerSettings: {
      sign_timeout_secs: 30, ping_timeout_secs: 15, request_ttl_secs: 300,
      state_save_interval_secs: 30, peer_selection_strategy: 'deterministic_sorted',
    },
    runtimeSnapshotJson: '{}',
    events: [],
  };
}

function fakeProfile(): PwaProfile {
  return {
    id: '88'.repeat(32),
    label: 'Clear Log Device',
    share_public_key: '33'.repeat(32),
    group_public_key: '22'.repeat(32),
    relays: ['wss://relay.primal.net'],
    group_package_json: `{"group_name":"Clear","group_pk":"${'22'.repeat(32)}","threshold":2,"members":[{"idx":0,"pubkey":"02${'33'.repeat(32)}"},{"idx":1,"pubkey":"02${'44'.repeat(32)}"}]}`,
    share_package_json: `{"idx":1,"seckey":"${'11'.repeat(32)}"}`,
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'g',
    encrypted_profile_ref: 'e',
    state_path: '/tmp/clear',
    created_at: 1_700_000_000_000,
    stored_password: 'pw',
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
    signer_settings: {
      sign_timeout_secs: 30, ping_timeout_secs: 15, request_ttl_secs: 300,
      state_save_interval_secs: 30, peer_selection_strategy: 'deterministic_sorted',
    },
    manual_peer_policy_overrides: [],
    peer_pubkey: null,
    runtime_snapshot_json: null,
    onboarding_package: null,
  };
}

afterEach(async () => {
  await disposeRuntimeSessionForProfile();
  setBrowserRuntimeTestHooks(null);
});

describe('clearSessionLogs adapter', () => {
  it('calls the active session clearLogs and returns a fresh snapshot', async () => {
    const clearLogs = vi.fn();
    setBrowserRuntimeTestHooks({
      startBrowserRuntimeSession: async () =>
        createFakeBrowserRuntimeSession(fakeSnapshot(), { clearLogs }),
    });

    const profile = fakeProfile();
    const started = await startSession(profile, 'pw');
    expect(started.active).toBe(true);

    const cleared = await clearSessionLogs(started);
    expect(clearLogs).toHaveBeenCalledTimes(1);
    expect(cleared.active).toBe(true);
    expect(cleared.profile?.id).toBe(profile.id);
  });

  it('throws when no profile or no active session is attached', async () => {
    await expect(clearSessionLogs(null)).rejects.toThrow(/device profile/i);
    await expect(
      clearSessionLogs({
        active: false,
        profile: null,
        runtime_status: null,
        readiness: null,
        runtime_log_lines: [],
        runtime_host: null,
      }),
    ).rejects.toThrow(/device profile/i);
  });
});
