import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';

import {
  derivePolicyDashboardView,
  deriveExportSummary,
  deriveGroupSummary,
  deriveMemberLabel,
  deriveSignerDashboardView,
  toDashboardKey,
} from '../../src/lib/dashboard-view';
import type {
  PwaPeerPermissionState,
  PwaProfile,
  PwaRuntimeSnapshot,
} from '../../src/lib/types';

describe('toDashboardKey', () => {
  it('encodes a valid 64-hex x-only pubkey to npub + truncated display + hex', () => {
    const hex = '11'.repeat(32);
    const result = toDashboardKey(hex);
    expect(result).toBeDefined();
    expect(result?.hex).toBe(hex);
    expect(result?.npub).toBe(nip19.npubEncode(hex));
    expect(result?.npub.startsWith('npub1')).toBe(true);
    // Display is the npub middle-truncated: first 8 + '...' + last 4.
    expect(result?.display).toBe(`${result?.npub.slice(0, 8)}...${result?.npub.slice(-4)}`);
  });

  it('normalizes uppercase/whitespace hex before encoding', () => {
    const hex = '11'.repeat(32);
    expect(toDashboardKey(`  ${hex.toUpperCase()}  `)?.hex).toBe(hex);
  });

  it('returns undefined for malformed keys without throwing', () => {
    expect(toDashboardKey('')).toBeUndefined();
    expect(toDashboardKey('not-hex')).toBeUndefined();
    expect(toDashboardKey('ab'.repeat(20))).toBeUndefined(); // too short
    expect(toDashboardKey(`${'11'.repeat(32)}zz`)).toBeUndefined(); // too long / non-hex
  });
});

describe('deriveMemberLabel', () => {
  it('reads the share index from the share package json', () => {
    expect(deriveMemberLabel(JSON.stringify({ idx: 1, seckey: 'aa' }))).toBe('Share #1');
    expect(deriveMemberLabel(JSON.stringify({ idx: 0 }))).toBe('Share #0');
  });

  it('returns undefined for malformed json or a missing/non-numeric idx', () => {
    expect(deriveMemberLabel('not json')).toBeUndefined();
    expect(deriveMemberLabel(JSON.stringify({ seckey: 'aa' }))).toBeUndefined();
    expect(deriveMemberLabel(JSON.stringify({ idx: 'one' }))).toBeUndefined();
  });
});

describe('deriveGroupSummary', () => {
  it('reads the keyset name and member count from the group package json', () => {
    const json = JSON.stringify({ group_name: 'Treasury', members: [{}, {}, {}] });
    expect(deriveGroupSummary(json)).toEqual({ keysetName: 'Treasury', memberCount: 3 });
  });

  it('degrades to empty fields for malformed json or missing/typed-wrong fields', () => {
    expect(deriveGroupSummary('not json')).toEqual({});
    expect(deriveGroupSummary(JSON.stringify({ group_name: 5, members: 'nope' }))).toEqual({
      keysetName: undefined,
      memberCount: undefined,
    });
  });
});

describe('deriveExportSummary', () => {
  it('joins member, keyset, relays, and peer count into one line', () => {
    const summary = deriveExportSummary({
      member_idx: 1,
      group_package_json: JSON.stringify({ group_name: 'Treasury', members: [{}, {}, {}] }),
      relays: ['wss://a', 'wss://b'],
    });
    expect(summary).toBe('Share #1 · Keyset: Treasury · 2 relays · 3 peers');
  });

  it('singularizes a single relay and omits parts derived from malformed json', () => {
    const summary = deriveExportSummary({
      member_idx: Number.NaN,
      group_package_json: 'not json',
      relays: ['wss://only'],
    });
    expect(summary).toBe('1 relay');
  });

  it('returns an empty string for a null profile', () => {
    expect(deriveExportSummary(null)).toBe('');
  });
});

const allowMethods = {
  ping: true,
  onboard: true,
  sign: true,
  ecdh: true,
};

const unsetMethods = {
  ping: 'unset',
  onboard: 'unset',
  sign: 'unset',
  ecdh: 'unset',
} as const;

function policyState(pubkey: string): PwaPeerPermissionState {
  return {
    pubkey,
    manual_override: {
      request: unsetMethods,
      respond: unsetMethods,
    },
    remote_observation: null,
    effective_policy: {
      request: allowMethods,
      respond: { ...allowMethods, ecdh: false },
    },
  };
}

const profile: PwaProfile = {
  id: 'profile-1',
  label: 'Treasury signer',
  share_public_key: '22'.repeat(32),
  group_public_key: '11'.repeat(32),
  relays: ['wss://relay.example'],
  group_package_json: JSON.stringify({ group_name: 'Treasury', members: ['aa', 'bb'] }),
  member_idx: 2,
  source: 'generated',
  relay_profile: 'relay-profile',
  group_ref: 'group-ref',
  encrypted_profile_ref: 'encrypted-profile-ref',
  state_path: '/tmp/state',
  created_at: 1,
  encrypted_bfshare_artifact: 'bfshare1...',
  profile_string: 'bfprofile1...',
  share_string: 'bfshare1...',
  signer_settings: {
    sign_timeout_secs: 30,
    ping_timeout_secs: 15,
    request_ttl_secs: 300,
    state_save_interval_secs: 30,
    peer_selection_strategy: 'deterministic_sorted',
  },
};

function runtimeSnapshot(
  overrides: Partial<PwaRuntimeSnapshot> = {},
): PwaRuntimeSnapshot {
  const peerPubkey = 'aa'.repeat(32);
  return {
    active: true,
    profile,
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 2,
      signing_peer_count: 2,
      ecdh_peer_count: 2,
      last_refresh_at: 1,
      degraded_reasons: [],
    },
    runtime_status: {
      status: {
        device_id: 'device-1',
        pending_ops: 1,
        last_active: 1,
        known_peers: 1,
        request_seq: 1,
      },
      metadata: {
        device_id: 'device-1',
        member_idx: 2,
        share_public_key: profile.share_public_key,
        group_public_key: profile.group_public_key,
        peers: [peerPubkey],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
        last_refresh_at: 1,
        degraded_reasons: [],
      },
      peers: [
        {
          idx: 1,
          pubkey: peerPubkey.toUpperCase(),
          known: true,
          last_seen: 1,
          online: true,
          incoming_available: 2,
          outgoing_available: 3,
          outgoing_spent: 4,
          can_sign: true,
          can_ecdh: true,
          can_ping: true,
          should_send_nonces: false,
          last_response_latency_ms: 12,
          avg_latency_ms: 15,
          nonce_history: [{ ts: 1, held: 2 }],
        },
      ],
      peer_permission_states: [],
      pending_operations: [
        {
          op_type: 'Sign',
          request_id: 'op-1',
          started_at: 1,
          timeout_at: 2,
          target_peers: [peerPubkey],
          threshold: 2,
          collected_responses: ['a'],
          context: {},
        },
      ],
      pending_approvals: [
        {
          request_id: 'approval-1',
          peer: peerPubkey,
          method: 'sign',
          queued_at: 1,
          expires_at: 2,
        },
      ],
    },
    peer_permission_states: [],
    events: [],
    runtime_log_lines: ['[warn] relay slow'],
    runtime_host: {
      profile_id: profile.id,
      mode: 'browser',
      log_source: 'test',
      started_at: 1,
      signer_pubkey: profile.share_public_key,
    },
    ...overrides,
  };
}

describe('deriveSignerDashboardView', () => {
  it('returns null when there is no selected profile', () => {
    expect(deriveSignerDashboardView(null, runtimeSnapshot(), [])).toBeNull();
  });

  it('builds the signer dashboard model from profile, runtime, policies, and logs', () => {
    const policyPeer = policyState('bb'.repeat(32));
    const view = deriveSignerDashboardView(profile, runtimeSnapshot(), [policyPeer]);

    expect(view?.profileName).toBe('Treasury signer');
    expect(view?.thresholdLabel).toBe('2/2');
    expect(view?.memberLabel).toBe('Share #2');
    expect(view?.groupKey?.hex).toBe(profile.group_public_key);
    expect(view?.shareKey?.hex).toBe(profile.share_public_key);
    expect(view?.running).toBe(true);
    expect(view?.readinessLabel).toBe('Signer Running');
    expect(view?.relaySummary).toBe('Browser runtime connected');
    expect(view?.peerRows.map((row) => row.pubkey)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
    expect(view?.pendingApprovalRows?.[0]).toEqual(expect.objectContaining({
      id: 'approval-1',
      method: 'sign',
      methodLabel: 'SIGN',
      peerLabel: 'Peer #2',
      pubkey: 'aa'.repeat(32),
    }));
    expect(view?.pendingOperationRows[0]).toEqual(expect.objectContaining({
      id: 'op-1',
      operationLabel: 'Sign',
      thresholdLabel: 'threshold 2',
      responseLabel: '1 responses',
    }));
    expect(view?.eventRows[0]).toEqual(expect.objectContaining({
      badgeLabel: 'warn',
      badgeTone: 'warning',
      message: 'relay slow',
    }));
  });

  it('uses stopped and degraded labels without throwing on missing runtime status', () => {
    const stopped = deriveSignerDashboardView(profile, runtimeSnapshot({
      active: false,
      runtime_status: null,
      readiness: null,
    }), []);
    expect(stopped?.thresholdLabel).toBe('threshold n/a');
    expect(stopped?.readinessLabel).toBe('Signer Stopped');
    expect(stopped?.relaySummary).toBe('Runtime stopped');

    const degraded = deriveSignerDashboardView(profile, runtimeSnapshot({
      readiness: {
        runtime_ready: true,
        restore_complete: false,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
        last_refresh_at: 1,
        degraded_reasons: ['restore_pending'],
      },
    }), []);
    expect(degraded?.readinessLabel).toBe('Signer Running (Degraded)');
  });
});

describe('derivePolicyDashboardView', () => {
  it('maps policy state rows when the runtime is active', () => {
    const state = policyState('cc'.repeat(32));
    expect(derivePolicyDashboardView(true, [state])).toEqual({
      peerRows: [
        {
          pubkey: state.pubkey,
          request: state.effective_policy.request,
          respond: state.effective_policy.respond,
          manualOverride: {
            request: state.manual_override.request,
            respond: state.manual_override.respond,
          },
        },
      ],
    });
  });

  it('omits policy rows when the runtime is inactive', () => {
    expect(derivePolicyDashboardView(false, [policyState('cc'.repeat(32))])).toEqual({
      peerRows: [],
    });
  });
});
