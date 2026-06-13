import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STORAGE_KEY,
  clearPersistedState,
  loadPersistedState,
  partitionKeyFor,
  savePersistedState,
} from '@/lib/storage';
import {
  __setInstanceIdForTests,
  INSTANCE_REGISTRY_KEY,
  gcEmptyInstances,
  quarantineCorruptState,
  readInstanceRegistry,
} from '@/lib/instance';
import type { PwaPersistedState } from '@/lib/types';

function localStorageKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key) out.push(key);
  }
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  __setInstanceIdForTests(null);
});

describe('per-tab partition load hardening', () => {
  it('quarantines a corrupt (non-JSON) blob and boots clean', () => {
    __setInstanceIdForTests('q');
    window.localStorage.setItem(partitionKeyFor(), 'definitely-not-json{');

    expect(loadPersistedState()).toBeNull();
    // Live key dropped, bad blob copied aside for debugging.
    expect(window.localStorage.getItem(partitionKeyFor())).toBeNull();
    expect(
      localStorageKeys().some((key) => key.startsWith(`${partitionKeyFor()}.corrupt.`)),
    ).toBe(true);
  });

  it('caps quarantine copies at the newest few', () => {
    __setInstanceIdForTests('cap');
    const prefix = `${partitionKeyFor()}.corrupt.`;
    // Seed four older copies with ascending timestamps.
    for (const ts of [1, 2, 3, 4]) {
      window.localStorage.setItem(`${prefix}${ts}`, `old-${ts}`);
    }

    // A fresh quarantine writes a new (now-stamped) copy and prunes the oldest.
    quarantineCorruptState(partitionKeyFor(), 'newest');

    const copies = localStorageKeys()
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .sort((a, b) => a - b);
    // Kept the newest three: the two newest seeds (3, 4) plus the now-stamped one.
    expect(copies).toHaveLength(3);
    expect(copies.slice(0, 2)).toEqual([3, 4]);
    expect(copies[2]).toBeGreaterThan(4);
    // The two oldest were pruned.
    expect(window.localStorage.getItem(`${prefix}1`)).toBeNull();
    expect(window.localStorage.getItem(`${prefix}2`)).toBeNull();
  });

  it('quarantines a schema-version mismatch', () => {
    __setInstanceIdForTests('v');
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({ schemaVersion: 999, profiles: [] }),
    );

    expect(loadPersistedState()).toBeNull();
    expect(window.localStorage.getItem(partitionKeyFor())).toBeNull();
  });

  it('accepts a current-schema blob', () => {
    __setInstanceIdForTests('ok');
    window.localStorage.setItem(
      partitionKeyFor(),
      JSON.stringify({ schemaVersion: 2, profiles: [], drafts: {} }),
    );

    expect(loadPersistedState()).not.toBeNull();
  });

  it('isolates partitions across instance ids', () => {
    __setInstanceIdForTests('A');
    savePersistedState({ schemaVersion: 2, profiles: [{ id: 'a' }] } as unknown as PwaPersistedState);
    expect(loadPersistedState()).not.toBeNull();

    __setInstanceIdForTests('B');
    expect(loadPersistedState()).toBeNull();
  });
});

describe('legacy un-partitioned adoption', () => {
  it('adopts a valid legacy blob into the current partition once', () => {
    __setInstanceIdForTests('adopt');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles: [{ id: 'p1' }] }));

    const loaded = loadPersistedState();
    expect(loaded?.profiles).toHaveLength(1);
    // Migrated: the legacy key is gone and the partition now holds the blob.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(partitionKeyFor())).not.toBeNull();
  });

  it('ignores a corrupt legacy blob and boots fresh', () => {
    __setInstanceIdForTests('adopt2');
    window.localStorage.setItem(STORAGE_KEY, 'nope{');
    expect(loadPersistedState()).toBeNull();
  });
});

describe('instance registry GC', () => {
  it('prunes only empty partitions, never ones holding profiles', () => {
    __setInstanceIdForTests('cur');
    window.localStorage.setItem(
      INSTANCE_REGISTRY_KEY,
      JSON.stringify([
        { id: 'keep', label: null, createdAt: 0, updatedAt: 0, profileCount: 5 },
        { id: 'empty', label: null, createdAt: 0, updatedAt: 0, profileCount: 0 },
      ]),
    );
    window.localStorage.setItem(
      partitionKeyFor('keep'),
      JSON.stringify({ schemaVersion: 2, profiles: [{ id: 'k' }] }),
    );

    gcEmptyInstances({ keepId: 'cur' });

    const ids = readInstanceRegistry().map((record) => record.id);
    expect(ids).toContain('keep');
    expect(ids).not.toContain('empty');
  });
});

describe('clearPersistedState', () => {
  it('removes only the current partition', () => {
    __setInstanceIdForTests('clearme');
    savePersistedState({ schemaVersion: 2, profiles: [{ id: 'x' }] } as unknown as PwaPersistedState);
    expect(window.localStorage.getItem(partitionKeyFor())).not.toBeNull();
    clearPersistedState();
    expect(window.localStorage.getItem(partitionKeyFor())).toBeNull();
  });
});
