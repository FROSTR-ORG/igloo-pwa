import { nip19 } from 'nostr-tools';

import {
  buildPeerReadinessRows,
  buildPendingApprovalRows,
  observabilityEventsToEventRows,
  type DashboardKeyModel,
  type EventLogRowModel,
  type OperatorSettingsSidebarGroupProfile,
  type PolicyDashboardViewModel,
  type SignerDashboardViewModel,
} from 'igloo-ui';
import type { RuntimeStatusSummary } from 'igloo-shared';
import type { PwaPeerPermissionState, PwaProfile, PwaRuntimeSnapshot } from './types';

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
  memberCount?: number;
  threshold?: number;
} {
  try {
    const group = JSON.parse(groupPackageJson) as { group_name?: unknown; members?: unknown; threshold?: unknown };
    return {
      keysetName: typeof group.group_name === 'string' ? group.group_name : undefined,
      memberCount: Array.isArray(group.members) ? group.members.length : undefined,
      threshold: typeof group.threshold === 'number' ? group.threshold : undefined,
    };
  } catch {
    return {};
  }
}

function formatProfileDate(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = value > 10_000_000_000 ? value : value * 1000;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(normalized));
}

export function deriveSettingsGroupProfile(
  profile: PwaProfile | null,
): OperatorSettingsSidebarGroupProfile | undefined {
  if (!profile) return undefined;
  const { keysetName, memberCount, threshold } = deriveGroupSummary(profile.group_package_json);
  const keyNpub = toDashboardKey(profile.group_public_key)?.display;
  return {
    keysetName: keysetName ?? profile.label,
    keyNpub,
    thresholdLabel:
      typeof threshold === 'number' && typeof memberCount === 'number'
        ? `${threshold} of ${memberCount}`
        : undefined,
    createdLabel: formatProfileDate(profile.created_at),
  };
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

function toPwaEventRows(lines: string[] = []): EventLogRowModel[] {
  return lines.map((line, index) => ({
    id: `pwa-log-${index}-${line}`,
    badgeLabel: line.startsWith('[error]') ? 'error' : line.startsWith('[warn]') ? 'warn' : 'info',
    badgeTone: line.startsWith('[error]') ? 'danger' : line.startsWith('[warn]') ? 'warning' : 'info',
    message: line.replace(/^\[[^\]]+\]\s*/, ''),
    timestampLabel: 'live',
  }));
}

export function formatRuntimeTimestamp(value: number | null) {
  if (typeof value !== 'number') return 'n/a';
  const normalized = value > 10_000_000_000 ? value : value * 1000;
  return new Date(normalized).toLocaleString();
}

function derivePendingOperations(runtimeStatus: RuntimeStatusSummary | null | undefined) {
  const summary = runtimeStatus ?? null;
  return (summary?.pending_operations ?? []).map((operation) => ({
    id: operation.request_id,
    operationLabel: operation.op_type,
    thresholdLabel: `threshold ${operation.threshold}`,
    startedLabel: formatRuntimeTimestamp(operation.started_at),
    timeoutLabel: formatRuntimeTimestamp(operation.timeout_at),
    responseLabel: `${Array.isArray(operation.collected_responses) ? operation.collected_responses.length : 0} responses`,
  }));
}

function deriveRuntimeSummaryLabel(runtimeSnapshot: PwaRuntimeSnapshot | null) {
  if (!runtimeSnapshot?.active) return 'Signer Stopped';
  const readiness = runtimeSnapshot.readiness ?? null;
  if (readiness && (!readiness.sign_ready || !readiness.ecdh_ready || !readiness.restore_complete)) {
    return 'Signer Running (Degraded)';
  }
  return 'Signer Running';
}

function deriveThresholdLabel(
  readiness: PwaRuntimeSnapshot['readiness'] | null | undefined,
  summary: RuntimeStatusSummary | null,
) {
  const peerTotal = summary?.metadata?.peers?.length ? summary.metadata.peers.length + 1 : null;
  return typeof readiness?.threshold === 'number' && peerTotal
    ? `${readiness.threshold} of ${peerTotal}`
    : 'threshold n/a';
}

function deriveRelaySummary(profile: PwaProfile, runtimeSnapshot: PwaRuntimeSnapshot | null) {
  if (!runtimeSnapshot?.active) return 'Runtime stopped';

  const reportedConnected = runtimeSnapshot.runtime_status?.connected_relays;
  if (Array.isArray(reportedConnected)) {
    return reportedConnected.length ? `Connected to ${reportedConnected.join(', ')}` : 'No relays connected';
  }

  const configuredRelays = runtimeSnapshot.runtime_status?.configured_relays?.filter(Boolean) ?? [];
  const profileRelays = profile.relays.filter(Boolean);
  const relays = configuredRelays.length ? configuredRelays : profileRelays;
  return relays.length ? `Connected to ${relays.join(', ')}` : 'Connected';
}

export function deriveSignerDashboardView(
  profile: PwaProfile | null,
  runtimeSnapshot: PwaRuntimeSnapshot | null,
  peerPermissionStates: PwaPeerPermissionState[],
): SignerDashboardViewModel | null {
  if (!profile) return null;

  const summary = runtimeSnapshot?.runtime_status ?? null;
  const readiness = runtimeSnapshot?.readiness ?? null;
  const thresholdLabel = deriveThresholdLabel(readiness, summary);

  const peerRows = buildPeerReadinessRows({
    peers: summary?.peers ?? [],
    rosterPubkeys: summary?.metadata?.peers ?? [],
    policyPubkeys: peerPermissionStates.map((state) => state.pubkey),
  });

  return {
    profileName: profile.label || 'Unnamed device',
    thresholdLabel,
    memberLabel: Number.isFinite(profile.member_idx) ? `Share #${profile.member_idx}` : undefined,
    publicKeyLabel: profile.group_public_key,
    shareLabel: profile.share_public_key,
    groupKey: toDashboardKey(profile.group_public_key),
    shareKey: toDashboardKey(profile.share_public_key),
    running: Boolean(runtimeSnapshot?.active),
    readinessLabel: deriveRuntimeSummaryLabel(runtimeSnapshot),
    relaySummary: deriveRelaySummary(profile, runtimeSnapshot),
    pendingApprovalRows: buildPendingApprovalRows({
      approvals: summary?.pending_approvals ?? [],
      peerAliases: Object.fromEntries(peerRows.map((row) => [row.pubkey, row.alias])),
    }),
    peerRows,
    pendingOperationRows: derivePendingOperations(runtimeSnapshot?.runtime_status),
    // Prefer structured events (domain/event tags + filter); fall back to the
    // formatted log lines for sessions that only surface plain strings.
    eventRows: runtimeSnapshot?.events?.length
      ? observabilityEventsToEventRows(runtimeSnapshot.events)
      : toPwaEventRows(runtimeSnapshot?.runtime_log_lines),
  };
}

export function derivePolicyDashboardView(
  active: boolean,
  peerPermissionStates: PwaPeerPermissionState[],
): PolicyDashboardViewModel {
  return {
    peerRows: active
      ? peerPermissionStates.map((policy) => ({
          pubkey: policy.pubkey,
          request: policy.effective_policy.request,
          respond: policy.effective_policy.respond,
          manualOverride: {
            request: policy.manual_override.request,
            respond: policy.manual_override.respond,
          },
        }))
      : [],
  };
}
