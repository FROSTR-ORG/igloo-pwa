import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearSessionLogs } from '@/lib/local-adapter';
import { setBrowserRuntimeTestHooks, type BrowserRuntimeSessionSnapshot } from '@/lib/page-runtime-host';
import { createFakeBrowserRuntimeSession } from '@/lib/page-runtime-host-fakes';
import { SessionController } from '@/lib/session-controller';
import type { PwaProfile, PwaRuntimeSnapshot } from '@/lib/types';

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
    member_idx: 1,
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'g',
    encrypted_profile_ref: 'e',
    state_path: '/tmp/clear',
    created_at: 1_700_000_000_000,
    encrypted_bfshare_artifact: 'bfshare1demo',
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
    signer_settings: {
      sign_timeout_secs: 30, ping_timeout_secs: 15, request_ttl_secs: 300,
      state_save_interval_secs: 30, peer_selection_strategy: 'deterministic_sorted',
    },
    manual_peer_policy_overrides: [],
    peer_pubkey: null,
    onboarding_package: null,
  };
}

// Build a runtime snapshot describing the profile as the live, active session.
function activeSnapshot(profile: PwaProfile): PwaRuntimeSnapshot {
  return {
    active: true,
    profile,
    runtime_status: null,
    readiness: null,
    runtime_log_lines: [],
    runtime_host: null,
  };
}

afterEach(() => {
  setBrowserRuntimeTestHooks(null);
});

describe('clearSessionLogs adapter', () => {
  it('calls the active session clearLogs and returns a fresh snapshot', async () => {
    const clearLogs = vi.fn();
    setBrowserRuntimeTestHooks({
      startBrowserRuntimeSession: async () =>
        createFakeBrowserRuntimeSession(fakeSnapshot(), { clearLogs }),
    });

    // Drive the session through the controller directly so the test hook can
    // short-circuit the WASM bridge + artifact decryption that `startSession`
    // would otherwise perform.
    const controller = new SessionController();
    const profile = fakeProfile();
    await controller.start(profile.id, {
      groupName: profile.label,
      relays: profile.relays,
      groupPublicKey: profile.group_public_key,
      sharePublicKey: profile.share_public_key,
      peerPubkey: profile.peer_pubkey ?? undefined,
      signerSettings: profile.signer_settings,
      groupPackageJson: profile.group_package_json,
      sharePackageJson: `{"idx":1,"seckey":"${'11'.repeat(32)}"}`,
    });

    const cleared = await clearSessionLogs(activeSnapshot(profile), controller);
    expect(clearLogs).toHaveBeenCalledTimes(1);
    expect(cleared).not.toBeNull();
    expect(cleared?.active).toBe(true);
    expect(cleared?.profile?.id).toBe(profile.id);

    await controller.stop();
  });

  it('returns null when no profile or no active session is attached', async () => {
    // Security model is idempotent on snapshot/session drift: it returns null
    // (leaving React state untouched) rather than throwing.
    expect(await clearSessionLogs(null)).toBeNull();
    expect(
      await clearSessionLogs({
        active: false,
        profile: null,
        runtime_status: null,
        readiness: null,
        runtime_log_lines: [],
        runtime_host: null,
      }),
    ).toBeNull();
  });
});
