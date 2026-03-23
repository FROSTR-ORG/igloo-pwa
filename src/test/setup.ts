import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';

import { setBrowserRuntimeTestHooks, setInjectedWasmBridgeModuleForTests } from 'igloo-shared';

const mockRuntimeSnapshot = JSON.stringify({
  bootstrap: {
    group: {
      group_pk: '22'.repeat(32),
      threshold: 2,
      members: [
        { idx: 1, pubkey: `02${'33'.repeat(32)}` },
        { idx: 2, pubkey: `03${'44'.repeat(32)}` },
        { idx: 3, pubkey: `02${'55'.repeat(32)}` }
      ]
    },
    share: {
      idx: 1,
      seckey: '11'.repeat(32)
    }
  }
});

class MockWasmBridgeRuntime {
  init_runtime() {}
  restore_runtime() {}
  handle_command() {}
  handle_inbound_event() {}
  tick() {}
  drain_outbound_events() { return '[]'; }
  drain_completions() { return '[]'; }
  drain_failures() { return '[]'; }
  snapshot_state() { return mockRuntimeSnapshot; }
  status() { return '{}'; }
  peer_permission_states() { return '[]'; }
  read_config() { return '{}'; }
  update_config() {}
  peer_status() { return '[]'; }
  readiness() { return '{}'; }
  runtime_status() { return '{}'; }
  runtime_diagnostics() { return '{"logs":[],"runtime":null}'; }
  drain_runtime_events() { return '[]'; }
  wipe_state() {}
  runtime_metadata() { return '{}'; }
  set_policy_override() {}
  clear_policy_overrides() {}
}

beforeEach(() => {
  setInjectedWasmBridgeModuleForTests({
    WasmBridgeRuntime: MockWasmBridgeRuntime,
    bf_package_version: () => 1,
    bfshare_prefix: () => 'bfshare',
    bfonboard_prefix: () => 'bfonboard',
    bfprofile_prefix: () => 'bfprofile',
    profile_backup_event_kind: () => 10000,
    profile_backup_key_domain: () => 'frostr-profile-backup/v1',
    encode_bfshare_package: (_payload, _password) => 'bfshare1test',
    decode_bfshare_package: (_value, _password) =>
      JSON.stringify({
        shareSecret: '11'.repeat(32),
        relays: ['wss://relay.primal.net']
      }),
    encode_bfonboard_package: (_payload, _password) => 'bfonboard1test',
    decode_bfonboard_package: (_value, _password) =>
      JSON.stringify({
        shareSecret: '11'.repeat(32),
        relays: ['wss://relay.primal.net'],
        peerPubkey: '66'.repeat(32)
      }),
    create_onboarding_request_bundle: (_shareSecret, _peerPubkey32Hex, _eventKind, sentAtSeconds) =>
      JSON.stringify({
        request_id: 'req-onboard-test',
        local_pubkey32: '33'.repeat(32),
        request_nonces: [
          {
            binder_pn: '44'.repeat(33),
            hidden_pn: '55'.repeat(33),
            code: '66'.repeat(32)
          }
        ],
        bootstrap_state_hex: 'aa',
        event_json: JSON.stringify({
          kind: 20000,
          created_at: sentAtSeconds ?? Math.floor(Date.now() / 1000),
          pubkey: '33'.repeat(32),
          content: 'test-content',
          tags: [['p', '66'.repeat(32)]],
          id: 'onboard-request',
          sig: 'bb'.repeat(64)
        })
      }),
    build_onboarding_runtime_snapshot: (_groupJson, _shareSecret, _peerPubkey32Hex, _responseNoncesJson, _bootstrapStateHex) =>
      mockRuntimeSnapshot,
    derive_profile_id_from_share_secret: (shareSecret) =>
      shareSecret === '11'.repeat(32) ? '77'.repeat(32) : '88'.repeat(32),
    derive_profile_id_from_share_pubkey: (sharePubkey) =>
      sharePubkey === '33'.repeat(32) ? '77'.repeat(32) : '88'.repeat(32),
    encode_bfprofile_package: (_payload, _password) => 'bfprofile1test',
    decode_bfprofile_package: (value, _password) =>
      JSON.stringify({
        profileId: '77'.repeat(32),
        version: 1,
        device: {
          name: 'Onboarded Device',
          shareSecret: '11'.repeat(32),
          manualPeerPolicyOverrides: [],
          remotePeerPolicyObservations: [],
          relays: ['wss://relay.primal.net']
        },
        group: {
          keysetName: 'Onboarded Device',
          groupPublicKey: '22'.repeat(32),
          threshold: 2,
          totalCount: 3,
          members: [
            { index: 1, sharePublicKey: '33'.repeat(32) },
            { index: 2, sharePublicKey: '44'.repeat(32) },
            { index: 3, sharePublicKey: '55'.repeat(32) }
          ]
        },
        raw: value
      }),
    create_profile_package_pair: (_payload, _password) =>
      JSON.stringify({
        profile_string: 'bfprofile1test',
        share_string: 'bfshare1test'
      }),
    create_encrypted_profile_backup: (_profile) =>
      JSON.stringify({
        version: 1,
        device: {
          name: 'Onboarded Device',
          sharePublicKey: '33'.repeat(32),
          manualPeerPolicyOverrides: [],
          remotePeerPolicyObservations: [],
          relays: ['wss://relay.primal.net']
        },
        group: {
          keysetName: 'Onboarded Device',
          groupPublicKey: '22'.repeat(32),
          threshold: 2,
          totalCount: 3,
          members: [
            { index: 1, sharePublicKey: '33'.repeat(32) },
            { index: 2, sharePublicKey: '44'.repeat(32) },
            { index: 3, sharePublicKey: '55'.repeat(32) }
          ]
        }
      }),
    derive_profile_backup_conversation_key_hex: () => 'aa'.repeat(32),
    encrypt_profile_backup_content: (backupJson, _shareSecret) => backupJson,
    decrypt_profile_backup_content: (ciphertext, _shareSecret) => ciphertext,
    build_profile_backup_event: (_shareSecret, backupJson, createdAtSeconds) =>
      JSON.stringify({
        kind: 10000,
        created_at: createdAtSeconds ?? Math.floor(Date.now() / 1000),
        pubkey: '33'.repeat(32),
        content: backupJson,
        tags: [],
        id: 'test-event',
        sig: 'aa'.repeat(64)
      }),
    parse_profile_backup_event: (eventJson, _shareSecret) => {
      const event = JSON.parse(eventJson) as { content?: string };
      return typeof event.content === 'string' ? event.content : '{}';
    },
    create_keyset_bundle: (_configJson) =>
      JSON.stringify({
        group: {
          group_pk: '22'.repeat(32),
          threshold: 2,
          members: [
            { idx: 1, pubkey: `02${'33'.repeat(32)}` },
            { idx: 2, pubkey: `02${'44'.repeat(32)}` },
            { idx: 3, pubkey: `02${'55'.repeat(32)}` },
          ],
        },
        shares: [
          { idx: 1, seckey: '11'.repeat(32) },
          { idx: 2, seckey: '12'.repeat(32) },
          { idx: 3, seckey: '13'.repeat(32) },
        ],
      }),
    rotate_keyset_bundle: (_inputJson) =>
      JSON.stringify({
        previous_group_id: 'aa'.repeat(32),
        next_group_id: 'bb'.repeat(32),
        next: {
          group: {
            group_pk: '22'.repeat(32),
            threshold: 2,
            members: [
              { idx: 1, pubkey: `02${'63'.repeat(32)}` },
              { idx: 2, pubkey: `02${'64'.repeat(32)}` },
              { idx: 3, pubkey: `02${'65'.repeat(32)}` },
            ],
          },
          shares: [
            { idx: 1, seckey: '21'.repeat(32) },
            { idx: 2, seckey: '22'.repeat(32) },
            { idx: 3, seckey: '23'.repeat(32) },
          ],
        },
      }),
    derive_group_id: (_groupJson) => 'aa'.repeat(32),
  });
  setBrowserRuntimeTestHooks({
    async connectOnboardingPackageAndCaptureProfile() {
      return {
        decoded: {
          publicKey: '33'.repeat(32),
          peerPubkey: '66'.repeat(32),
          relays: ['wss://relay.primal.net']
        },
        profile: {
          keysetName: 'Onboarded Device',
          relays: ['wss://relay.primal.net'],
          groupPublicKey: '22'.repeat(32),
          sharePublicKey: '33'.repeat(32),
          peerPubkey: '66'.repeat(32),
          runtimeSnapshotJson: mockRuntimeSnapshot
        },
        runtimeSnapshotJson: mockRuntimeSnapshot,
        runtimeStatus: {
          status: {
            device_id: 'browser-device',
            pending_ops: 0,
            last_active: Date.now(),
            known_peers: 2,
            request_seq: 1
          },
          metadata: {
            device_id: 'browser-device',
            member_idx: 1,
            share_public_key: '33'.repeat(32),
            group_public_key: '22'.repeat(32),
            peers: ['44'.repeat(32), '55'.repeat(32)]
          },
          readiness: {
            runtime_ready: true,
            restore_complete: true,
            sign_ready: true,
            ecdh_ready: true,
            threshold: 2,
            signing_peer_count: 2,
            ecdh_peer_count: 2,
            last_refresh_at: Date.now(),
            degraded_reasons: []
          },
          peer_permission_states: [],
          peers: [],
          pending_operations: []
        },
        metadata: {
          device_id: 'browser-device',
          member_idx: 1,
          share_public_key: '33'.repeat(32),
          group_public_key: '22'.repeat(32),
          peers: ['44'.repeat(32), '55'.repeat(32)]
        },
        readiness: {
          runtime_ready: true,
          restore_complete: true,
          sign_ready: true,
          ecdh_ready: true,
          threshold: 2,
          signing_peer_count: 2,
          ecdh_peer_count: 2,
          last_refresh_at: Date.now(),
          degraded_reasons: []
        }
      };
    },
    async startBrowserRuntimeSession(profile) {
      const buildSnapshot = () => ({
        runtimeStatus: {
          status: {
            device_id: 'browser-device',
            pending_ops: 0,
            last_active: Date.now(),
            known_peers: 2,
            request_seq: 1
          },
          metadata: {
            device_id: 'browser-device',
            member_idx: 1,
            share_public_key: profile.sharePublicKey ?? '33'.repeat(32),
            group_public_key: profile.groupPublicKey ?? '22'.repeat(32),
            peers: ['44'.repeat(32), '55'.repeat(32)]
          },
          readiness: {
            runtime_ready: true,
            restore_complete: true,
            sign_ready: true,
            ecdh_ready: true,
            threshold: 2,
            signing_peer_count: 2,
            ecdh_peer_count: 2,
            last_refresh_at: Date.now(),
            degraded_reasons: []
          },
          peer_permission_states: [],
          peers: [],
          pending_operations: []
        },
        metadata: {
          device_id: 'browser-device',
          member_idx: 1,
          share_public_key: profile.sharePublicKey ?? '33'.repeat(32),
          group_public_key: profile.groupPublicKey ?? '22'.repeat(32),
          peers: ['44'.repeat(32), '55'.repeat(32)]
        },
        readiness: {
          runtime_ready: true,
          restore_complete: true,
          sign_ready: true,
          ecdh_ready: true,
          threshold: 2,
          signing_peer_count: 2,
          ecdh_peer_count: 2,
          last_refresh_at: Date.now(),
          degraded_reasons: []
        },
        peerPermissionStates: [],
        signerSettings: {
          sign_timeout_secs: 30,
          ping_timeout_secs: 15,
          request_ttl_secs: 300,
          state_save_interval_secs: 30,
          peer_selection_strategy: 'deterministic_sorted' as const
        },
        runtimeSnapshotJson: mockRuntimeSnapshot
      });
      return {
        collectLogs: () => ['[info] attached live browser signer session'],
        read: () => buildSnapshot(),
        refreshPeers: async () => buildSnapshot(),
        updatePeerPolicyOverride: async () => buildSnapshot(),
        clearPeerPolicyOverrides: async () => buildSnapshot(),
        updateConfig: () => buildSnapshot(),
        stop: () => buildSnapshot(),
      };
    },
  });
});

afterEach(() => {
  setBrowserRuntimeTestHooks(null);
  setInjectedWasmBridgeModuleForTests(null);
});
