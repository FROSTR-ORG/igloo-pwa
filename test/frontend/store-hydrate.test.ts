import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDefaultDraftSecrets,
  createDefaultState,
  defaultDrafts,
  ensureDistributionForm,
  ensureDistributionPasswordSlot,
  normalizeLoadedStateFromStorage,
} from '@/lib/store-hydrate';
import { clearGlobalState, clearSessionState, saveGlobalState, saveSessionState } from '@/lib/storage';
import { toPersistableSession } from '@/lib/persist-allowlist';
import type { PersistableProfile } from '@/lib/persist-allowlist';
import type { PwaDashboardTab, PwaProfile, PwaView } from '@/lib/types';

function prof(id: string): PersistableProfile {
  return { id } as unknown as PersistableProfile;
}

// Persist a session blob via the real allow-list + storage path so the
// normalization under test sees exactly what a reload would surface. The
// `activeView`/`tab` casts let us seed legacy/intermediate view names that the
// sanitizer is responsible for rewriting.
function seedSession(overrides: { selectedProfileId?: string; activeView?: string; activeDashboardTab?: string }) {
  const base = createDefaultState();
  saveSessionState(
    toPersistableSession({
      ...base,
      selectedProfileId: overrides.selectedProfileId ?? base.selectedProfileId,
      activeView: (overrides.activeView ?? base.activeView) as PwaView,
      activeDashboardTab: (overrides.activeDashboardTab ?? base.activeDashboardTab) as PwaDashboardTab,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  clearSessionState();
  clearGlobalState();
});

describe('createDefaultState', () => {
  it('boots to the landing view with no profiles or selection', () => {
    const state = createDefaultState();
    expect(state.activeView).toBe('landing');
    expect(state.profiles).toEqual([]);
    expect(state.selectedProfileId).toBe('');
    expect(state.runtimeSnapshot).toBeNull();
    expect(state.drafts).toBe(defaultDrafts);
    expect(state.draftSecrets).toEqual(createDefaultDraftSecrets());
    expect(state.settings.remember_browser_state).toBe(true);
  });

  it('hands out fresh draft-secret objects each call (no shared mutable refs)', () => {
    const a = createDefaultDraftSecrets();
    const b = createDefaultDraftSecrets();
    expect(a).not.toBe(b);
    expect(a.distributionPasswords).not.toBe(b.distributionPasswords);
  });
});

describe('ensureDistributionForm / ensureDistributionPasswordSlot', () => {
  it('returns the existing entry when present', () => {
    const existing = { label: 'Existing' };
    expect(ensureDistributionForm({ 1: existing }, 1, 'Fallback')).toBe(existing);
    const slot = { password: 'pw', confirmPassword: 'pw' };
    expect(ensureDistributionPasswordSlot({ 2: slot }, 2)).toBe(slot);
  });

  it('falls back to a default entry when missing', () => {
    expect(ensureDistributionForm({}, 0, 'Member 0')).toEqual({ label: 'Member 0' });
    expect(ensureDistributionPasswordSlot({}, 0)).toEqual({ password: '', confirmPassword: '' });
  });
});

describe('normalizeLoadedStateFromStorage', () => {
  it('returns the default state when nothing is persisted', () => {
    expect(normalizeLoadedStateFromStorage().activeView).toBe('landing');
  });

  it('drops a dangling selected profile and bounces the dashboard to landing', () => {
    saveGlobalState({ profiles: [prof('keep')] as unknown as PwaProfile[] });
    seedSession({ selectedProfileId: 'ghost', activeView: 'dashboard' });

    const state = normalizeLoadedStateFromStorage();
    expect(state.selectedProfileId).toBe('');
    expect(state.activeView).toBe('landing');
  });

  it('keeps a valid selection on the dashboard', () => {
    saveGlobalState({ profiles: [prof('keep')] as unknown as PwaProfile[] });
    seedSession({ selectedProfileId: 'keep', activeView: 'dashboard' });

    const state = normalizeLoadedStateFromStorage();
    expect(state.selectedProfileId).toBe('keep');
    expect(state.activeView).toBe('dashboard');
  });

  it('bounces a mid-create view to landing (the in-flight keyset is never persisted)', () => {
    seedSession({ activeView: 'create-generate' });
    expect(normalizeLoadedStateFromStorage().activeView).toBe('landing');
  });

  it('remaps the legacy onboard-handshake view back to onboard-connect', () => {
    seedSession({ activeView: 'onboard-handshake' });
    expect(normalizeLoadedStateFromStorage().activeView).toBe('onboard-connect');
  });

  it('remaps load-error to load-import when there is no pending load error', () => {
    seedSession({ activeView: 'load-error' });
    expect(normalizeLoadedStateFromStorage().activeView).toBe('load-import');
  });
});
