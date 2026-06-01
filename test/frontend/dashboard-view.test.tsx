import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';

import { deriveMemberLabel, toDashboardKey } from '../../src/lib/dashboard-view';

describe('toDashboardKey', () => {
  it('encodes a valid 64-hex x-only pubkey to npub + truncated display + hex', () => {
    const hex = '11'.repeat(32);
    const result = toDashboardKey(hex);
    expect(result).toBeDefined();
    expect(result?.hex).toBe(hex);
    expect(result?.npub).toBe(nip19.npubEncode(hex));
    expect(result?.npub.startsWith('npub1')).toBe(true);
    // Display is the npub middle-truncated: first 8 + '...' + last 4.
    expect(result?.display).toBe(`${result?.npub.slice(0, 8)}...${result?.npub.slice(-4)}`);
  });

  it('normalizes uppercase/whitespace hex before encoding', () => {
    const hex = '11'.repeat(32);
    expect(toDashboardKey(`  ${hex.toUpperCase()}  `)?.hex).toBe(hex);
  });

  it('returns undefined for malformed keys without throwing', () => {
    expect(toDashboardKey('')).toBeUndefined();
    expect(toDashboardKey('not-hex')).toBeUndefined();
    expect(toDashboardKey('ab'.repeat(20))).toBeUndefined(); // too short
    expect(toDashboardKey(`${'11'.repeat(32)}zz`)).toBeUndefined(); // too long / non-hex
  });
});

describe('deriveMemberLabel', () => {
  it('reads the share index from the share package json', () => {
    expect(deriveMemberLabel(JSON.stringify({ idx: 1, seckey: 'aa' }))).toBe('Share #1');
    expect(deriveMemberLabel(JSON.stringify({ idx: 0 }))).toBe('Share #0');
  });

  it('returns undefined for malformed json or a missing/non-numeric idx', () => {
    expect(deriveMemberLabel('not json')).toBeUndefined();
    expect(deriveMemberLabel(JSON.stringify({ seckey: 'aa' }))).toBeUndefined();
    expect(deriveMemberLabel(JSON.stringify({ idx: 'one' }))).toBeUndefined();
  });
});
