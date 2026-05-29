import { describe, expect, it } from 'vitest';

import { SessionController } from '@/lib/session-controller';
import * as adapter from '@/lib/local-adapter';
import type { PwaProfile, PwaRuntimeSnapshot } from '@/lib/types';

function buildProfile(id = '77'.repeat(32)): PwaProfile {
  return {
    id,
    label: 'Primary Browser Device',
    share_public_key: '33'.repeat(32),
    group_public_key: '22'.repeat(32),
    relays: ['wss://relay.primal.net'],
    group_package_json: JSON.stringify({
      group_name: 'Test Group',
      group_pk: '22'.repeat(32),
      threshold: 2,
      members: [
        { idx: 1, pubkey: `02${'33'.repeat(32)}` },
        { idx: 2, pubkey: `02${'44'.repeat(32)}` },
      ],
    }),
    member_idx: 1,
    source: 'generated',
    relay_profile: 'browser',
    group_ref: 'group-ref',
    encrypted_profile_ref: 'encrypted-profile-ref',
    state_path: '/tmp/igloo-pwa/profile',
    created_at: 1700000000,
    encrypted_bfshare_artifact: 'bfshare1demo',
    profile_string: 'bfprofile1demo',
    share_string: 'bfshare1demo',
    signer_settings: {
      sign_timeout_secs: 30,
      ping_timeout_secs: 15,
      request_ttl_secs: 300,
      state_save_interval_secs: 30,
      peer_selection_strategy: 'deterministic_sorted' as const,
    },
    peer_pubkey: null,
    manual_peer_policy_overrides: [],
    onboarding_package: null,
  };
}

function buildRuntimeSnapshot(profile: PwaProfile): PwaRuntimeSnapshot {
  return {
    active: true,
    profile,
    runtime_status: {
      status: {
        device_id: profile.id,
        pending_ops: 0,
        last_active: 0,
        known_peers: 0,
        request_seq: 0,
      },
      metadata: {
        device_id: profile.id,
        member_idx: profile.member_idx,
        share_public_key: profile.share_public_key,
        group_public_key: profile.group_public_key,
        peers: [],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 0,
        ecdh_peer_count: 0,
        last_refresh_at: null,
        degraded_reasons: [],
      },
      peers: [],
      peer_permission_states: [],
      pending_operations: [],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 2,
      signing_peer_count: 0,
      ecdh_peer_count: 0,
      last_refresh_at: null,
      degraded_reasons: [],
    },
    peer_permission_states: [],
    runtime_log_lines: [],
    runtime_host: {
      profile_id: profile.id,
      mode: 'browser',
      log_source: 'In-memory session logs',
      started_at: 0,
      signer_pubkey: profile.share_public_key,
    },
  };
}

describe('SessionController idempotent lifecycle (D.4)', () => {
  it('starts bump the epoch monotonically', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    expect(controller.currentEpoch()).toBe(0);
    expect(controller.isActive()).toBe(false);

    await adapter.startSession(profile, 'test-passphrase', controller);
    const firstEpoch = controller.currentEpoch();
    expect(firstEpoch).toBe(1);
    expect(controller.isActive()).toBe(true);
    expect(controller.getActiveProfileId()).toBe(profile.id);

    // A second start (e.g., StrictMode double-mount) stops the prior
    // session and bumps the epoch again.
    await adapter.startSession(profile, 'test-passphrase', controller);
    expect(controller.currentEpoch()).toBe(2);
    expect(controller.isFresh(profile.id, firstEpoch)).toBe(false);
    expect(controller.isFresh(profile.id, controller.currentEpoch())).toBe(true);

    await controller.stop();
  });

  it('stop is idempotent: a second stop returns false without throwing', async () => {
    const controller = new SessionController();

    // Stop on a fresh controller returns false, does not throw.
    await expect(controller.stop()).resolves.toBe(false);

    const profile = buildProfile();
    await adapter.startSession(profile, 'test-passphrase', controller);

    await expect(controller.stop()).resolves.toBe(true);
    await expect(controller.stop()).resolves.toBe(false);
    expect(controller.isActive()).toBe(false);
  });

  it('read on a stopped session returns null instead of throwing', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    await adapter.startSession(profile, 'test-passphrase', controller);
    const epoch = controller.currentEpoch();

    await controller.stop();

    expect(controller.read(profile.id, epoch)).toBeNull();
    await expect(controller.refresh(profile.id, epoch)).resolves.toBeNull();
    await expect(
      controller.applyPeerPolicy(profile.id, epoch, {
        pubkey: '99'.repeat(32),
        direction: 'request',
        method: 'sign',
        value: 'deny',
      }),
    ).resolves.toBeNull();
    await expect(controller.clearPeerPolicies(profile.id, epoch)).resolves.toBeNull();
  });

  it('stale-epoch read returns null after a restart bumps the epoch', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    await adapter.startSession(profile, 'test-passphrase', controller);
    const oldEpoch = controller.currentEpoch();

    // Restart: stop + start under the hood, new epoch.
    await controller.stop();
    await adapter.startSession(profile, 'test-passphrase', controller);
    const newEpoch = controller.currentEpoch();
    expect(newEpoch).not.toBe(oldEpoch);

    // Read with the stale epoch silently returns null.
    expect(controller.read(profile.id, oldEpoch)).toBeNull();
    await expect(controller.refresh(profile.id, oldEpoch)).resolves.toBeNull();
    await expect(
      controller.applyPeerPolicy(profile.id, oldEpoch, {
        pubkey: '99'.repeat(32),
        direction: 'request',
        method: 'sign',
        value: 'allow',
      }),
    ).resolves.toBeNull();
    await expect(controller.clearPeerPolicies(profile.id, oldEpoch)).resolves.toBeNull();

    // Fresh epoch still reads cleanly.
    expect(controller.read(profile.id, newEpoch)).not.toBeNull();

    await controller.stop();
  });

  it('StrictMode double-mount sequence (start -> stop -> start) never throws', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    const sequence = async () => {
      await adapter.startSession(profile, 'test-passphrase', controller);
      await controller.stop();
      await adapter.startSession(profile, 'test-passphrase', controller);
      await controller.stop();
    };

    await expect(sequence()).resolves.toBeUndefined();
    expect(controller.isActive()).toBe(false);
  });

  it('adapter.stopSession is idempotent via the controller', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    const snapshotBeforeStart = buildRuntimeSnapshot(profile);

    // No active session: stopSession returns null, does not throw.
    await expect(adapter.stopSession(snapshotBeforeStart, controller)).resolves.toBeNull();

    await adapter.startSession(profile, 'test-passphrase', controller);
    const stopped = await adapter.stopSession(snapshotBeforeStart, controller);
    expect(stopped).not.toBeNull();
    expect(stopped?.active).toBe(false);

    // Second stop is a null no-op.
    await expect(adapter.stopSession(snapshotBeforeStart, controller)).resolves.toBeNull();
  });

  it('adapter.applyPeerPolicy returns null on drift instead of throwing', async () => {
    const controller = new SessionController();
    const profile = buildProfile();

    // Session never started: drift case. The old contract threw
    // "No active browser signer session is attached to this profile" —
    // D.4 returns null.
    const snapshot = { ...buildRuntimeSnapshot(profile), active: false };
    await expect(
      adapter.applyPeerPolicy(
        snapshot,
        '99'.repeat(32),
        'request',
        'sign',
        true,
        controller,
      ),
    ).resolves.toBeNull();
    await expect(adapter.clearPeerPolicies(snapshot, controller)).resolves.toBeNull();
  });

  it('different controllers isolate session state per instance', async () => {
    const a = new SessionController();
    const b = new SessionController();
    const profile = buildProfile();

    await adapter.startSession(profile, 'test-passphrase', a);
    expect(a.isActive()).toBe(true);
    expect(b.isActive()).toBe(false);

    // Stopping b doesn't touch a.
    await expect(b.stop()).resolves.toBe(false);
    expect(a.isActive()).toBe(true);

    await a.stop();
    expect(a.isActive()).toBe(false);
  });
});
