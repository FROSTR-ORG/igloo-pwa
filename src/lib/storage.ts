import type { PwaPersistedState } from './types';

export const STORAGE_KEY = 'igloo-pwa.state.v1';

export function loadPersistedState(): PwaPersistedState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PwaPersistedState;
  } catch {
    return null;
  }
}

export function savePersistedState(state: PwaPersistedState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedState() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
