// Dev/test-only scenario seam. When the page is loaded with a `?__frostr_dev=<name>`
// query param, the store hydrates a fixed in-memory scenario instead of the
// persisted state — including a *running* runtimeSnapshot, which is normally
// in-memory only and cannot be seeded from storage. This lets `make screenshot`
// (and agents) render states like the running signer dashboard headlessly.
//
// It is inert in production: nothing reads it unless the query param is present,
// and it never writes to storage. Mirrors igloo-home's resolveVisualScenario.

import type { PwaPersistedState, PwaProfile, PwaRuntimeSnapshot } from './types';
import {
  FIXTURE_PROFILE_ID, FIXTURE_PROFILE_LABEL, FIXTURE_GROUP_PK, FIXTURE_SHARE_PK,
  FIXTURE_RELAY, FIXTURE_MEMBER_IDX, FIXTURE_SIGNER_SETTINGS,
  createFixtureRuntimeStatusSummary,
} from 'igloo-shared/testing/dev-fixtures';

const DEV_SCENARIO_PARAM = '__frostr_dev';

const GROUP_PACKAGE_JSON = JSON.stringify({
  group_name: FIXTURE_PROFILE_LABEL,
  group_pk: FIXTURE_GROUP_PK,
  threshold: 2,
  members: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
});

const fixtureProfile: PwaProfile = {
  id: FIXTURE_PROFILE_ID,
  label: FIXTURE_PROFILE_LABEL,
  share_public_key: FIXTURE_SHARE_PK,
  group_public_key: FIXTURE_GROUP_PK,
  relays: [FIXTURE_RELAY],
  group_package_json: GROUP_PACKAGE_JSON,
  member_idx: FIXTURE_MEMBER_IDX,
  source: 'generated',
  relay_profile: 'browser',
  group_ref: 'group-ref',
  encrypted_profile_ref: 'enc-ref',
  state_path: 'state-path',
  created_at: 1_700_000_000_000,
  encrypted_bfshare_artifact: 'bfshare1devscenario',
  profile_string: '',
  share_string: '',
  signer_settings: { ...FIXTURE_SIGNER_SETTINGS },
  manual_peer_policy_overrides: [],
  peer_pubkey: null,
  onboarding_package: null,
};

// A representative running runtime snapshot: signer online with two peers (one
// online, one offline) so the dashboard renders the Peers card with content.
const _fixtureRuntimeStatus = createFixtureRuntimeStatusSummary();
const EVENT_BASE_TS = 1_700_000_000_000;
const runningSnapshot: PwaRuntimeSnapshot = {
  active: true,
  profile: fixtureProfile,
  runtime_status: _fixtureRuntimeStatus,
  readiness: _fixtureRuntimeStatus.readiness,
  peer_permission_states: [],
  events: [
    {
      ts: EVENT_BASE_TS,
      level: 'info',
      component: 'browser',
      domain: 'runtime',
      event: 'wasm_runtime_init_begin',
    },
    {
      ts: EVENT_BASE_TS + 1_000,
      level: 'info',
      component: 'browser',
      domain: 'runtime',
      event: 'wasm_runtime_init_ok',
    },
    {
      ts: EVENT_BASE_TS + 2_000,
      level: 'info',
      component: 'browser',
      domain: 'relay',
      event: 'bootstrap_begin',
    },
    {
      ts: EVENT_BASE_TS + 3_000,
      level: 'info',
      component: 'browser',
      domain: 'relay',
      event: 'connected',
    },
  ],
  runtime_log_lines: ['[info] signer online', '[info] 2 peers known'],
  runtime_host: {
    profile_id: fixtureProfile.id,
    mode: 'browser',
    log_source: 'dev-scenario',
    started_at: 1_700_000_000,
    signer_pubkey: FIXTURE_SHARE_PK,
  },
};

const longLogSnapshot: PwaRuntimeSnapshot = {
  ...runningSnapshot,
  events: [
    {
      ts: EVENT_BASE_TS,
      level: 'info',
      component: 'browser',
      domain: 'runtime',
      event: 'wasm_runtime_init_ok',
      message: 'Signer runtime ready',
    },
    {
      ts: EVENT_BASE_TS + 1_000,
      level: 'info',
      component: 'browser',
      domain: 'relay',
      event: 'relay_ack',
      message: 'Relay wss://relay.primal.net acknowledged event',
    },
    {
      ts: EVENT_BASE_TS + 2_000,
      level: 'warn',
      component: 'browser',
      domain: 'relay',
      event: 'connection_lost',
      message: 'Connection to wss://purplepag.es lost - retrying in 30s',
    },
    {
      ts: EVENT_BASE_TS + 3_000,
      level: 'info',
      component: 'browser',
      domain: 'sign',
      event: 'signature_request_received',
      message: 'Signed event kind:1 for npub1qe3...7k4m',
    },
    {
      ts: EVENT_BASE_TS + 4_000,
      level: 'info',
      component: 'browser',
      domain: 'ecdh',
      event: 'ecdh_request_processed',
      message: 'Encrypted DM key exchange with 02e8f4a1...d9c2',
    },
    {
      ts: EVENT_BASE_TS + 5_000,
      level: 'info',
      component: 'browser',
      domain: 'ping',
      event: 'ping_sweep',
      message: 'Ping sweep - 2/3 online (avg 31ms) - pools balanced',
    },
    {
      ts: EVENT_BASE_TS + 6_000,
      level: 'info',
      component: 'browser',
      domain: 'echo',
      event: 'round_echoed',
      message: 'Round broadcast echoed by peer 2',
    },
    {
      ts: EVENT_BASE_TS + 7_000,
      level: 'info',
      component: 'browser',
      domain: 'sync',
      event: 'pool_sync',
      message: 'Pool sync with peer #0 - 50 received - 50 sent',
    },
    {
      ts: EVENT_BASE_TS + 8_000,
      level: 'info',
      component: 'browser',
      domain: 'policy',
      event: 'signer_policy_required',
      message: 'ECDH request from peer #2 - signer policy required',
    },
    {
      ts: EVENT_BASE_TS + 9_000,
      level: 'info',
      component: 'browser',
      domain: 'peer_policy',
      event: 'peer_policy_override',
      message: 'Peer policy allowed sign requests for peer #1',
    },
  ],
};

const loadingSnapshot: PwaRuntimeSnapshot = {
  ...runningSnapshot,
  runtime_status: null,
  readiness: null,
  events: [],
  runtime_log_lines: ['[info] restoring signer profile'],
};

const signingBlockedStatus = {
  ..._fixtureRuntimeStatus,
  readiness: {
    ..._fixtureRuntimeStatus.readiness,
    sign_ready: false,
    ecdh_ready: false,
    signing_peer_count: 0,
    ecdh_peer_count: 0,
    degraded_reasons: ['not_enough_ready_peers'],
  },
  peers: _fixtureRuntimeStatus.peers.map((peer) => ({
    ...peer,
    online: false,
    incoming_available: 0,
    outgoing_available: 0,
    outgoing_spent: 0,
    can_sign: false,
    can_ecdh: false,
    can_ping: false,
    last_response_latency_ms: null,
    avg_latency_ms: null,
  })),
};

const signingBlockedSnapshot: PwaRuntimeSnapshot = {
  ...runningSnapshot,
  runtime_status: signingBlockedStatus,
  readiness: signingBlockedStatus.readiness,
};

const allRelaysOfflineStatus = {
  ...signingBlockedStatus,
  connected_relays: [],
  configured_relays: [FIXTURE_RELAY],
};

const allRelaysOfflineSnapshot: PwaRuntimeSnapshot = {
  ...runningSnapshot,
  runtime_status: allRelaysOfflineStatus,
  readiness: allRelaysOfflineStatus.readiness,
};

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
    case 'dashboard-running-long-log':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: longLogSnapshot,
      };
    case 'dashboard-loading':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: loadingSnapshot,
        dashboardLoadError: null,
      };
    case 'dashboard-load-failed':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: null,
        dashboardLoadError: {
          message: 'Unable to restore the saved signer session.',
          at: EVENT_BASE_TS,
        },
      };
    case 'dashboard-signing-blocked':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: signingBlockedSnapshot,
      };
    case 'dashboard-all-relays-offline':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
        runtimeSnapshot: allRelaysOfflineSnapshot,
      };
    case 'dashboard-settings':
      return {
        profiles: [fixtureProfile],
        selectedProfileId: fixtureProfile.id,
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
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
