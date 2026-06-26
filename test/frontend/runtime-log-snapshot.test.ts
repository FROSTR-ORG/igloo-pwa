import { describe, expect, it } from 'vitest';

import { toRuntimeSnapshot } from '@/lib/local-adapter/common';
import { refreshSession } from '@/lib/local-adapter/profile-runtime';
import { createFakeBrowserRuntimeSession } from '@/lib/page-runtime-host-fakes';
import type { SessionController } from '@/lib/session-controller';
import type { BrowserRuntimeSessionSnapshot } from '@/lib/page-runtime-host';
import type { PwaProfile } from '@/lib/types';

const GROUP_PUBLIC_KEY = '22'.repeat(32);
const SHARE_PUBLIC_KEY = '33'.repeat(32);
const PEER_PUBLIC_KEY = '44'.repeat(32);
const SHARE_SECRET = '55'.repeat(32);

function fakeSnapshot(): BrowserRuntimeSessionSnapshot {
  return {
    runtimeStatus: {
      status: { device_id: 'device-1', pending_ops: 0, last_active: 0, known_peers: 1, request_seq: 1 },
      metadata: {
        device_id: 'device-1',
        member_idx: 1,
        share_public_key: SHARE_PUBLIC_KEY,
        group_public_key: GROUP_PUBLIC_KEY,
        peers: [PEER_PUBLIC_KEY],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 1,
        signing_peer_count: 1,
        ecdh_peer_count: 1,
        last_refresh_at: 0,
        degraded_reasons: [],
      },
      peer_permission_states: [],
      peers: [],
      pending_operations: [],
    },
    metadata: {
      device_id: 'device-1',
      member_idx: 1,
      share_public_key: SHARE_PUBLIC_KEY,
      group_public_key: GROUP_PUBLIC_KEY,
      peers: [PEER_PUBLIC_KEY],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 1,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 0,
      degraded_reasons: [],
    },
    peerPermissionStates: [
      {
        pubkey: PEER_PUBLIC_KEY,
        manual_override: {
          request: { ping: 'unset', onboard: 'unset', sign: 'allow', ecdh: 'unset' },
          respond: { ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
        },
        remote_observation: {
          request: { ping: true, onboard: true, sign: true, ecdh: true },
          respond: { ping: true, onboard: true, sign: true, ecdh: true },
          updated: 1_700_000_000,
          revision: 1_700_000_000,
        },
        effective_policy: {
          request: { ping: true, onboard: true, sign: true, ecdh: true },
          respond: { ping: true, onboard: true, sign: true, ecdh: true },
        },
      },
    ],
    signerSettings: {
      sign_timeout_secs: 30,
      ping_timeout_secs: 15,
      request_ttl_secs: 300,
      state_save_interval_secs: 30,
      peer_selection_strategy: 'deterministic_sorted',
    },
    events: [
      {
        ts: 1_700_000_000_000,
        level: 'info',
        component: 'igloo.runtime',
        domain: 'relay',
        event: 'inbound_event',
        message: 'Inbound relay event received',
      },
      {
        ts: 1_700_000_000_100,
        level: 'info',
        component: 'igloo.runtime',
        domain: 'runtime',
        event: 'inbound_accepted',
        message: 'Inbound runtime event accepted',
      },
    ],
  };
}

function fakeProfile(): PwaProfile {
  return {
    id: '88'.repeat(32),
    label: 'Log Device',
    share_public_key: SHARE_PUBLIC_KEY,
    group_public_key: GROUP_PUBLIC_KEY,
    relays: ['ws://127.0.0.1:8194'],
    group_package_json: JSON.stringify({
      group_name: 'Log Device',
      group_pk: GROUP_PUBLIC_KEY,
      threshold: 1,
      members: [
        { idx: 1, pubkey: `02${SHARE_PUBLIC_KEY}` },
        { idx: 2, pubkey: `02${PEER_PUBLIC_KEY}` },
      ],
    }),
    member_idx: 1,
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'group-ref',
    encrypted_profile_ref: 'encrypted-ref',
    state_path: '/tmp/log-device',
    created_at: 1_700_000_000_000,
    encrypted_bfshare_artifact: 'bfshare1demo',
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
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
  };
}

describe('runtime log snapshot projection', () => {
  it('preserves structured runtime events alongside fallback log lines', () => {
    const session = createFakeBrowserRuntimeSession(fakeSnapshot(), {
      collectLogs: () => ['[info] relay.inbound_event event_id=relay-event'],
    });

    const snapshot = toRuntimeSnapshot(
      fakeProfile(),
      session,
      true,
      JSON.stringify({ idx: 1, seckey: SHARE_SECRET }),
    );

    expect(snapshot.events?.map((event) => `${event.domain}.${event.event}`)).toEqual([
      'relay.inbound_event',
      'runtime.inbound_accepted',
    ]);
    expect(snapshot.runtime_log_lines).toEqual(['[info] relay.inbound_event event_id=relay-event']);
  });

  it('preserves structured events and permission state across refresh snapshots', async () => {
    const profile = fakeProfile();
    const refreshed = fakeSnapshot();
    const session = createFakeBrowserRuntimeSession(refreshed, {
      collectLogs: () => [
        '[info] relay.inbound_event event_id=relay-event',
        '[warn] runtime.failure request_id=req-failed',
      ],
    });
    const controller = {
      currentEpoch: () => 7,
      getActiveProfileId: () => profile.id,
      getSharePackageJson: () => JSON.stringify({ idx: 1, seckey: SHARE_SECRET }),
      getActiveSession: () => session,
      refresh: async () => refreshed,
    } as unknown as SessionController;

    const snapshot = await refreshSession(
      {
        active: true,
        profile,
        runtime_status: null,
        readiness: null,
        runtime_log_lines: [],
        runtime_host: null,
      },
      controller,
    );

    expect(snapshot?.events?.map((event) => `${event.domain}.${event.event}`)).toEqual([
      'relay.inbound_event',
      'runtime.inbound_accepted',
    ]);
    expect(snapshot?.peer_permission_states?.[0]).toMatchObject({
      pubkey: PEER_PUBLIC_KEY,
      manual_override: { request: { sign: 'allow' } },
      effective_policy: { request: { sign: true } },
    });
    expect(snapshot?.runtime_log_lines).toEqual([
      '[info] relay.inbound_event event_id=relay-event',
      '[warn] runtime.failure request_id=req-failed',
      '[info] session refresh completed',
    ]);
  });
});
