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
  events: Array.from({ length: 24 }, (_, index) => {
    const domains = ['runtime', 'relay', 'sign', 'ecdh', 'ping', 'sync'];
    const domain = domains[index % domains.length];
    return {
      ts: EVENT_BASE_TS + index * 1_000,
      level: 'info' as const,
      component: 'browser',
      domain,
      event: `${domain}_event_${index + 1}`,
    };
  }),
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
