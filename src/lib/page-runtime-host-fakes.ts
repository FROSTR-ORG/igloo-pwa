import type { BrowserRuntimeSession, BrowserRuntimeSessionSnapshot } from './page-runtime-host';

// Type-driven test double for the browser runtime session. It lives in src/ (not
// the test setup) so it is covered by the igloo-pwa tsc project: the explicit
// `: BrowserRuntimeSession` return annotation makes the unit-test fake fail to
// compile the moment a method is added to the session interface, instead of
// drifting silently in a hand-rolled object literal inside the setup file.
export function createFakeBrowserRuntimeSession(
  snapshot: BrowserRuntimeSessionSnapshot,
  overrides: Partial<BrowserRuntimeSession> = {},
): BrowserRuntimeSession {
  const session = {
    collectLogs: () => ['[info] attached live browser signer session'],
    clearLogs: () => {},
    read: () => snapshot,
    refreshPeers: async () => snapshot,
    pingPeer: async () => ({ success: true, latency: 1 }),
    updatePeerPolicyOverride: async () => snapshot,
    clearPeerPolicyOverrides: async () => snapshot,
    updateConfig: () => snapshot,
    onOnboardComplete: () => () => {},
    stop: () => snapshot,
    ...overrides,
  };
  return session;
}
