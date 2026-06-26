import { describe, expect, it } from 'vitest';

import { areOperatorSettingsEqual } from '@/lib/operator-settings';

describe('operator settings equality', () => {
  it('compares saved settings structurally instead of by object serialization order', () => {
    const saved = {
      signerName: 'Primary Browser Device',
      relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
      signerSettings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted' as const,
      },
    };
    const draft = {
      signerName: 'Primary Browser Device',
      relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
      // Same values, intentionally different insertion order from persisted
      // JSON or future settings migrations.
      signerSettings: {
        peer_selection_strategy: 'deterministic_sorted' as const,
        state_save_interval_secs: 30,
        request_ttl_secs: 300,
        ping_timeout_secs: 15,
        sign_timeout_secs: 30,
      },
      newRelayUrl: 'wss://draft-only.example',
    };

    expect(areOperatorSettingsEqual(draft, saved)).toBe(true);
  });

  it('keeps relay ordering as a real setting change', () => {
    const saved = {
      signerName: 'Primary Browser Device',
      relays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
      signerSettings: {
        sign_timeout_secs: 30,
        ping_timeout_secs: 15,
        request_ttl_secs: 300,
        state_save_interval_secs: 30,
        peer_selection_strategy: 'deterministic_sorted' as const,
      },
    };

    expect(
      areOperatorSettingsEqual(
        { ...saved, relays: ['wss://relay.damus.io', 'wss://relay.primal.net'] },
        saved,
      ),
    ).toBe(false);
  });
});
