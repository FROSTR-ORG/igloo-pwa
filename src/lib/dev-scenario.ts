// Dev/test-only scenario seam. When the page is loaded with a `?__frostr_dev=<name>`
// query param, the store hydrates a fixed in-memory scenario instead of the
// persisted state — including a *running* runtimeSnapshot, which is normally
// in-memory only and cannot be seeded from storage. This lets `make screenshot`
// (and agents) render states like the running signer dashboard headlessly.
//
// It is inert in production: nothing reads it unless the query param is present,
// and it never writes to storage. Mirrors igloo-home's resolveVisualScenario.

import type { PwaPersistedState, PwaProfile, PwaRuntimeSnapshot } from './types';

const DEV_SCENARIO_PARAM = '__frostr_dev';

const GROUP_PK = '02'.repeat(32);
const SHARE_PK = '11'.repeat(32);

const GROUP_PACKAGE_JSON = JSON.stringify({
  group_name: 'Dev Signing Key',
  group_pk: GROUP_PK,
  threshold: 2,
  members: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
});

const fixtureProfile: PwaProfile = {
  id: 'dev-scenario-device',
  label: 'Dev Signing Key',
  share_public_key: SHARE_PK,
  group_public_key: GROUP_PK,
  relays: ['ws://127.0.0.1:8194'],
  group_package_json: GROUP_PACKAGE_JSON,
  member_idx: 1,
  source: 'generated',
  relay_profile: 'browser',
  group_ref: 'group-ref',
  encrypted_profile_ref: 'enc-ref',
  state_path: 'state-path',
  created_at: 1_700_000_000_000,
  encrypted_bfshare_artifact: 'bfshare1devscenario',
  profile_string: '',
  share_string: '',
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

function fixturePeer(idx: number, pubkey: string, online: boolean): unknown {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: online ? 1_700_000_000 : null,
    online,
    incoming_available: online ? 92 : 0,
    outgoing_available: online ? 78 : 0,
    outgoing_spent: online ? 14 : 0,
    can_sign: online,
    can_ecdh: online,
    can_ping: online,
    should_send_nonces: online,
    last_response_latency_ms: online ? 24 : null,
    avg_latency_ms: online ? 31 : null,
    nonce_history: [],
  };
}

const PEER_A = '03a3f8c2d1'.padEnd(64, '0');
const PEER_B = '02d7e1b93b'.padEnd(64, '0');

// A representative running runtime snapshot: signer online with two peers (one
// online, one offline) so the dashboard renders the Peers card with content.
const runningSnapshot = {
  active: true,
  profile: fixtureProfile,
  runtime_status: {
    status: { device_id: fixtureProfile.id, pending_ops: 0, last_active: 1_700_000_000, known_peers: 2, request_seq: 7 },
    metadata: {
      device_id: fixtureProfile.id,
      member_idx: 1,
      share_public_key: SHARE_PK,
      group_public_key: GROUP_PK,
      peers: [PEER_A, PEER_B],
    },
    readiness: { runtime_ready: true, restore_complete: true, sign_ready: true, ecdh_ready: true, threshold: 2 },
    peers: [fixturePeer(0, PEER_A, true), fixturePeer(2, PEER_B, false)],
    peer_permission_states: [],
    pending_operations: [],
    pending_approvals: [],
    connected_relays: ['ws://127.0.0.1:8194'],
    configured_relays: ['ws://127.0.0.1:8194'],
  },
  readiness: { runtime_ready: true, restore_complete: true, sign_ready: true, ecdh_ready: true, threshold: 2 },
  events: [],
  runtime_log_lines: ['[info] signer online', '[info] 2 peers known'],
  runtime_host: {
    profile_id: fixtureProfile.id,
    mode: 'browser',
    log_source: 'dev-scenario',
    started_at: 1_700_000_000,
    signer_pubkey: SHARE_PK,
  },
} as unknown as PwaRuntimeSnapshot;

/**
 * If `?__frostr_dev=<name>` is present, return a partial state override applied on
 * top of the hydrated state. Returns null in production (no param).
 */
export function resolveDevScenario(): Partial<PwaPersistedState> | null {
  // Dev/test builds only — `make screenshot` runs the vite dev server (DEV true).
  // A production build sets DEV false, so the seam (and its fixtures) tree-shakes
  // out of the shipped bundle.
  if (!import.meta.env.DEV) return null;
  if (typeof window === 'undefined') return null;
  let name: string | null = null;
  try {
    name = new URLSearchParams(window.location.search).get(DEV_SCENARIO_PARAM);
  } catch {
    return null;
  }
  if (!name) return null;

  switch (name) {
    case 'dashboard-running':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: runningSnapshot,
      };
    case 'dashboard-stopped':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: null,
      };
    case 'welcome-returning':
      return { profiles: [fixtureProfile], selectedProfileId: '', activeView: 'landing' };
    default:
      return null;
  }
}
