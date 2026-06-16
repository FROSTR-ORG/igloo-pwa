import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GLOBAL_STORE_KEY,
  clearGlobalState,
  clearSessionState,
  deleteProfileGlobal,
  loadGlobalState,
  loadSessionState,
  saveGlobalState,
  saveSessionState,
  sessionKeyFor,
} from '@/lib/storage';
import { __setInstanceIdForTests, quarantineCorruptState } from '@/lib/instance';
import { importLegacyProfilesOnce } from '@/lib/migrate-global';
import type { PersistableProfile, PersistableSessionState } from '@/lib/persist-allowlist';

function localStorageKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key) out.push(key);
  }
  return out;
}

function prof(id: string, extra: Record<string, unknown> = {}): PersistableProfile {
  return { id, ...extra } as unknown as PersistableProfile;
}

function ids(profiles?: PersistableProfile[] | null): string[] {
  return (profiles ?? []).map((profile) => profile.id);
}

function sessionBlob(selectedProfileId = ''): PersistableSessionState {
  return {
    schemaVersion: 1,
    selectedProfileId,
    activeView: 'landing',
    activeDashboardTab: 'signer',
    drafts: {} as PersistableSessionState['drafts'],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  __setInstanceIdForTests(null);
});

describe('global store load hardening', () => {
  it('quarantines a corrupt (non-JSON) blob and boots clean', () => {
    window.localStorage.setItem(GLOBAL_STORE_KEY, 'definitely-not-json{');

    expect(loadGlobalState()).toBeNull();
    expect(window.localStorage.getItem(GLOBAL_STORE_KEY)).toBeNull();
    expect(
      localStorageKeys().some((key) => key.startsWith(`${GLOBAL_STORE_KEY}.corrupt.`)),
    ).toBe(true);
  });

  it('quarantines a schema-version mismatch', () => {
    window.localStorage.setItem(
      GLOBAL_STORE_KEY,
      JSON.stringify({ schemaVersion: 999, profiles: [] }),
    );

    expect(loadGlobalState()).toBeNull();
    expect(window.localStorage.getItem(GLOBAL_STORE_KEY)).toBeNull();
  });

  it('accepts a current-schema blob', () => {
    window.localStorage.setItem(
      GLOBAL_STORE_KEY,
      JSON.stringify({ schemaVersion: 1, profiles: [], settings: {} }),
    );
    expect(loadGlobalState()).not.toBeNull();
  });

  it('caps quarantine copies at the newest few', () => {
    const prefix = `${GLOBAL_STORE_KEY}.corrupt.`;
    for (const ts of [1, 2, 3, 4]) {
      window.localStorage.setItem(`${prefix}${ts}`, `old-${ts}`);
    }

    quarantineCorruptState(GLOBAL_STORE_KEY, 'newest');

    const copies = localStorageKeys()
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .sort((a, b) => a - b);
    expect(copies).toHaveLength(3);
    expect(copies.slice(0, 2)).toEqual([3, 4]);
    expect(copies[2]).toBeGreaterThan(4);
    expect(window.localStorage.getItem(`${prefix}1`)).toBeNull();
    expect(window.localStorage.getItem(`${prefix}2`)).toBeNull();
  });
});

describe('global profiles are shared across tabs', () => {
  it('a profile saved under one instance id is visible under another', () => {
    __setInstanceIdForTests('A');
    saveGlobalState({ profiles: [prof('a')] });

    __setInstanceIdForTests('B');
    // The global store is not partitioned: tab B sees tab A's device.
    expect(ids(loadGlobalState()?.profiles)).toEqual(['a']);
  });

  it('merge-by-id preserves a concurrent tab\'s added profile', () => {
    saveGlobalState({ profiles: [prof('a'), prof('b'), prof('c')] });
    // A writer that only knew about a + b must not clobber the concurrently
    // added c.
    saveGlobalState({ profiles: [prof('a'), prof('b')] });
    expect(ids(loadGlobalState()?.profiles)).toEqual(['a', 'b', 'c']);
  });

  it('deleteProfileGlobal removes a profile (and is not resurrected by a merge save)', () => {
    saveGlobalState({ profiles: [prof('a'), prof('b')] });
    deleteProfileGlobal('a');
    expect(ids(loadGlobalState()?.profiles)).toEqual(['b']);
    // A subsequent merge save of the remaining list keeps it deleted.
    saveGlobalState({ profiles: [prof('b')] });
    expect(ids(loadGlobalState()?.profiles)).toEqual(['b']);
  });

  it('clearGlobalState removes the shared store', () => {
    saveGlobalState({ profiles: [prof('a')] });
    clearGlobalState();
    expect(loadGlobalState()).toBeNull();
  });
});

describe('per-tab session isolation', () => {
  it('session state is partitioned by instance id', () => {
    __setInstanceIdForTests('A');
    saveSessionState(sessionBlob('pa'));
    expect(loadSessionState()?.selectedProfileId).toBe('pa');

    __setInstanceIdForTests('B');
    expect(loadSessionState()).toBeNull();
  });

  it('clearSessionState removes only the current tab\'s session', () => {
    __setInstanceIdForTests('A');
    saveSessionState(sessionBlob('pa'));
    __setInstanceIdForTests('B');
    saveSessionState(sessionBlob('pb'));

    clearSessionState();
    expect(loadSessionState()).toBeNull();
    __setInstanceIdForTests('A');
    expect(loadSessionState()?.selectedProfileId).toBe('pa');
  });

  it('quarantines a corrupt session blob', () => {
    __setInstanceIdForTests('q');
    window.localStorage.setItem(sessionKeyFor(), 'nope{');
    expect(loadSessionState()).toBeNull();
    expect(window.localStorage.getItem(sessionKeyFor())).toBeNull();
  });
});

describe('legacy import (self-cleaning)', () => {
  it('lifts orphaned partition profiles into the global store, deduped, and deletes legacy keys', () => {
    // Two old per-tab partitions with an overlapping profile id, plus a corrupt
    // one and the instance registry (for newest-wins).
    window.localStorage.setItem(
      'igloo-pwa.state.v2::x',
      JSON.stringify({
        schemaVersion: 2,
        profiles: [prof('p1'), prof('shared', { label: 'old' })],
        settings: { remember_browser_state: true },
      }),
    );
    window.localStorage.setItem(
      'igloo-pwa.state.v2::y',
      JSON.stringify({ schemaVersion: 2, profiles: [prof('p2'), prof('shared', { label: 'new' })] }),
    );
    window.localStorage.setItem('igloo-pwa.state.v2::z', 'corrupt{');
    window.localStorage.setItem(
      'igloo-pwa.instances.v1',
      JSON.stringify([
        { id: 'x', updatedAt: 10 },
        { id: 'y', updatedAt: 20 },
      ]),
    );

    importLegacyProfilesOnce();

    const global = loadGlobalState();
    expect(ids(global?.profiles).sort()).toEqual(['p1', 'p2', 'shared']);
    // newest-wins: y (updatedAt 20) supplies the 'shared' record.
    const shared = global?.profiles.find((profile) => profile.id === 'shared') as
      | (PersistableProfile & { label?: string })
      | undefined;
    expect(shared?.label).toBe('new');

    // Every legacy key (partitions, corrupt copy, registry) is gone.
    expect(window.localStorage.getItem('igloo-pwa.state.v2::x')).toBeNull();
    expect(window.localStorage.getItem('igloo-pwa.state.v2::y')).toBeNull();
    expect(window.localStorage.getItem('igloo-pwa.state.v2::z')).toBeNull();
    expect(window.localStorage.getItem('igloo-pwa.instances.v1')).toBeNull();
  });

  it('deletes the legacy secret-bearing v1 blob without importing it', () => {
    window.localStorage.setItem('igloo-pwa.state.v1', JSON.stringify({ profiles: [prof('secret')] }));
    importLegacyProfilesOnce();
    expect(window.localStorage.getItem('igloo-pwa.state.v1')).toBeNull();
    expect(loadGlobalState()).toBeNull();
  });

  it('is a no-op when there are no legacy keys', () => {
    importLegacyProfilesOnce();
    expect(loadGlobalState()).toBeNull();
  });

  it('is idempotent on a second run', () => {
    window.localStorage.setItem(
      'igloo-pwa.state.v2::x',
      JSON.stringify({ schemaVersion: 2, profiles: [prof('p1')] }),
    );
    importLegacyProfilesOnce();
    const first = ids(loadGlobalState()?.profiles);
    importLegacyProfilesOnce();
    expect(ids(loadGlobalState()?.profiles)).toEqual(first);
  });
});
