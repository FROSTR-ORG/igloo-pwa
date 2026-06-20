import { nip19 } from 'nostr-tools';

import type { DashboardKeyModel } from 'igloo-ui';

// Pure helpers backing the signer dashboard's merged identity card. Kept out of
// App.tsx so they can be unit-tested in isolation (no React/store dependency).

// Build a copyable key model (truncated npub display + full npub + hex) from a
// 32-byte x-only public key hex. Returns undefined if the key is not encodable,
// so a malformed key never throws on the dashboard (the card falls back to the
// plain single-copy KeyField for an undefined key).
export function toDashboardKey(hex: string): DashboardKeyModel | undefined {
  const normalized = (hex ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return undefined;
  try {
    const npub = nip19.npubEncode(normalized);
    const display = `${npub.slice(0, 8)}...${npub.slice(-4)}`;
    return { display, npub, hex: normalized };
  } catch {
    return undefined;
  }
}

// Derive the "Share #<idx>" member label from a share package json blob. Returns
// undefined for malformed json or a missing/non-numeric idx.
export function deriveMemberLabel(sharePackageJson: string): string | undefined {
  try {
    const share = JSON.parse(sharePackageJson) as { idx?: unknown };
    if (typeof share.idx === 'number') return `Share #${share.idx}`;
  } catch {
    // ignore malformed share package json
  }
  return undefined;
}

// Parse the group package json for its display name + member count. Returns empty
// fields for malformed json so callers never throw on a bad blob.
export function deriveGroupSummary(groupPackageJson: string): {
  keysetName?: string;
  threshold?: number;
  memberCount?: number;
} {
  try {
    const group = JSON.parse(groupPackageJson) as { group_name?: unknown; threshold?: unknown; members?: unknown };
    return {
      keysetName: typeof group.group_name === 'string' ? group.group_name : undefined,
      threshold: typeof group.threshold === 'number' ? group.threshold : undefined,
      memberCount: Array.isArray(group.members) ? group.members.length : undefined,
    };
  } catch {
    return {};
  }
}

type ExportSummaryProfile = {
  member_idx: number;
  group_package_json: string;
  relays: string[];
};

// Build the export-modal summary line: "Share #1 · Keyset: … · N relays · M peers".
// Tolerant of malformed package json (the parse helpers degrade to undefined).
// The member label comes from the public `member_idx`; the raw share package
// json (which carries the secret seckey) is no longer held on the profile.
export function deriveExportSummary(profile: ExportSummaryProfile | null): string {
  if (!profile) return '';
  const member = Number.isFinite(profile.member_idx) ? `Share #${profile.member_idx}` : undefined;
  const { keysetName, memberCount } = deriveGroupSummary(profile.group_package_json);
  const parts = [
    member,
    keysetName ? `Keyset: ${keysetName}` : undefined,
    `${profile.relays.length} ${profile.relays.length === 1 ? 'relay' : 'relays'}`,
    typeof memberCount === 'number' ? `${memberCount} peers` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}
