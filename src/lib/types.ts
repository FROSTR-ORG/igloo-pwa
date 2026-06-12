import type {
  BrowserManualPeerPolicyOverride,
  BrowserProfilePackagePayload,
  BrowserProfilePreview,
  ObservabilityEvent,
  RuntimeOnboardingStatus,
  RuntimeReadiness,
  RuntimeStatusSummary,
  SignerSettings as SharedSignerSettings,
} from 'igloo-shared';

export type PwaView =
  | 'landing'
  | 'create-choice'
  | 'create-generate'
  | 'create-select-share'
  | 'create-save-profile'
  | 'create-distribute'
  | 'load-import'
  | 'load-confirm'
  | 'load-error'
  | 'onboard-connect'
  | 'onboard-handshake'
  | 'onboard-failed'
  | 'onboard-save'
  | 'rotate-connect'
  | 'rotate-save'
  | 'recover-collect'
  | 'recover-key'
  | 'dashboard'
  | 'settings';

export type PwaDashboardTab = 'signer' | 'permissions' | 'settings';
export type PwaPeerSelectionStrategy = 'deterministic_sorted' | 'random';

export type PwaSignerSettings = SharedSignerSettings;

export type PwaPolicyOverrideValue = 'unset' | 'allow' | 'deny';

export type PwaMethodPolicy = {
  ping: boolean;
  onboard: boolean;
  sign: boolean;
  ecdh: boolean;
};

export type PwaMethodPolicyOverride = {
  ping: PwaPolicyOverrideValue;
  onboard: PwaPolicyOverrideValue;
  sign: PwaPolicyOverrideValue;
  ecdh: PwaPolicyOverrideValue;
};

export type PwaPeerPermissionState = {
  pubkey: string;
  manual_override: {
    request: PwaMethodPolicyOverride;
    respond: PwaMethodPolicyOverride;
  };
  remote_observation: {
    request: PwaMethodPolicy;
    respond: PwaMethodPolicy;
    updated: number;
    revision: number;
  } | null;
  effective_policy: {
    request: PwaMethodPolicy;
    respond: PwaMethodPolicy;
  };
};

export type PwaSettings = {
  remember_browser_state: boolean;
  auto_open_signer: boolean;
  prefer_install_prompt: boolean;
};

/**
 * Non-secret preview metadata for a profile. `share_package_json` is
 * intentionally NOT on this type: the wire JSON is `{idx, seckey}` and
 * the `seckey` hex is the raw FROST share secret. We only ever hold
 * the share JSON in memory after the session is unlocked; see
 * `PwaPersistedState.sharePackageJsonByProfileId`.
 */
export type PwaProfilePreview = {
  label: string;
  share_public_key: string;
  group_public_key: string;
  relays: string[];
  group_package_json: string;
  /** Member index within the group. Public metadata (also present in the group package). */
  member_idx: number;
  source: 'generated' | 'bfprofile' | 'bfshare' | 'bfonboard';
};

export type PwaProfile = PwaProfilePreview & {
  id: string;
  relay_profile: string;
  group_ref: string;
  encrypted_profile_ref: string;
  state_path: string;
  created_at: number;
  /**
   * Password-encrypted bfshare1 bech32m artifact. Produced by
   * `encode_bfshare_package` (WASM). Decrypting it with the user's
   * passphrase yields the share secret; the passphrase check is AEAD
   * failure, so there is no timing side-channel. Safe at rest in
   * localStorage.
   */
  encrypted_bfshare_artifact: string;
  profile_string: string;
  share_string: string;
  signer_settings: PwaSignerSettings;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  peer_pubkey?: string | null;
  onboarding_package?: string | null;
};

/**
 * In-memory only: a freshly generated share. `share_package_json`
 * carries the raw share `seckey` hex and therefore must never be
 * persisted — `pendingKeyset` (which contains this) is in the
 * non-persistable partition of `PwaPersistedState`.
 */
export type PwaGeneratedShare = {
  name: string;
  member_idx: number;
  share_package_json: string;
  share_public_key: string;
};

export type PwaGeneratedKeyset = {
  group_name: string;
  threshold: number;
  count: number;
  group_package_json: string;
  group_public_key: string;
  shares: PwaGeneratedShare[];
};

export type PwaRuntimeSnapshot = {
  active: boolean;
  profile: PwaProfile | null;
  runtime_status: RuntimeStatusSummary | null;
  readiness: RuntimeReadiness | null;
  peer_permission_states?: PwaPeerPermissionState[];
  /** Structured runtime events (domain/event/level/ts) for the diagnostics log tags + filter. */
  events?: ObservabilityEvent[];
  runtime_log_lines: string[];
  runtime_host: {
    profile_id: string;
    mode: 'browser';
    log_source: string;
    started_at: number;
    signer_pubkey: string;
  } | null;
};

/**
 * Pending load confirmations are IN-MEMORY ONLY. They carry the user's
 * passphrase for the brief interval between decrypt and finalize. They
 * are never persisted to localStorage (D.1). If the page reloads
 * mid-flow, the user re-enters the passphrase.
 *
 * The `preview` here is the shared-SDK-native `BrowserProfilePreview`
 * shape, which carries `share_package_json`. That is fine for this
 * type because `PwaLoadConfirmation` is part of the non-persistable
 * partition of `PwaPersistedState` — it never reaches localStorage.
 */
export type PwaLoadConfirmation = {
  kind: 'bfprofile' | 'bfshare';
  preview: BrowserProfilePreview;
  passphrase: string;
  profile_string: string;
  share_string: string;
  profile_payload?: BrowserProfilePackagePayload;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  peer_pubkey?: string | null;
};

/**
 * Pending onboarding connections are IN-MEMORY ONLY. Same rationale as
 * `PwaLoadConfirmation`: passphrase lives in React state only and the
 * `preview` (which still carries the wire-shape `share_package_json`)
 * never reaches localStorage.
 */
export type PwaOnboardConnection = {
  preview: BrowserProfilePreview;
  passphrase: string;
  package_text: string;
  profile_string: string;
  share_string: string;
  profile_payload?: BrowserProfilePackagePayload;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  peer_pubkey?: string | null;
  // Ephemeral, in-memory ONLY (never persisted — its state_hex embeds the share
  // secret, D.1). The onboard handshake's runtime snapshot, carrying the nonce
  // pool both sides exchanged. Handed straight to the signer launch so it restores
  // from it instead of re-initializing a fresh (empty) pool — which would strand
  // the inviter's nonces and break the first signature until a re-sync.
  runtime_snapshot_json?: string | null;
};

export type PwaDistributionStatus = 'draft' | 'packaged' | 'delivered' | 'saved' | 'onboarded';

export type PwaDistributionActionResult = {
  status: PwaDistributionStatus;
  member_idx: number;
  label: string;
  package_text: string;
};

export type PwaRuntimeOnboardingStatus = RuntimeOnboardingStatus;

export type PwaDistributionSession = {
  profile_id: string;
  signer_pubkey: string;
  remaining_member_indices: number[];
  results: Record<number, PwaDistributionActionResult>;
  qr_package: { member_idx: number; label: string; package_text: string } | null;
};

/**
 * In-memory-and-persistable draft fields. All secret inputs — `password` /
 * `confirmPassword` fields AND the raw `privateKey` (nsec) — are OUT of this
 * shape: they live only in the companion `PwaDraftSecrets` record, which is
 * never sent to localStorage. `toPersistable` serializes `drafts` wholesale,
 * so this shape MUST stay secret-free.
 */
export type PwaDraftState = {
  createForm: {
    mode: 'new' | 'rotate';
    groupName: string;
    threshold: string;
    count: string;
  };
  rotationForm: {
    sourceProfileId: string;
    sources: Array<{ packageText: string }>;
  };
  recoverKeyForm: {
    sourceProfileId: string;
    sources: Array<{ packageText: string }>;
  };
  profileForm: {
    label: string;
    relayUrls: string;
  };
  distributionForms: Record<number, { label: string }>;
  distributionPermissions: Record<number, Array<'sign' | 'ecdh' | 'ping' | 'onboard'>>;
  importProfileForm: {
    profileString: string;
  };
  importSaveForm: {
    label: string;
    relayUrls: string;
  };
  onboardConnectForm: {
    packageText: string;
  };
  onboardSaveForm: {
    label: string;
    relayUrls: string;
  };
  rotateConnectForm: {
    packageText: string;
  };
};

/**
 * Passphrase/password draft fields. IN-MEMORY ONLY. This record is
 * held inside the React store but never included in the persistable
 * state allow-list, so it cannot reach `localStorage`.
 */
export type PwaDraftSecrets = {
  /** Raw nsec pasted into the create/rotate flow. Never persisted. */
  createFormPrivateKey: string;
  rotationSources: Record<number, string>;
  /** Per-source passphrases for the shares-based private-key recovery flow. */
  recoverKeySources: Record<number, string>;
  /** Passphrase that unlocks this device's own share during key recovery. Never persisted. */
  recoverDevicePassphrase: string;
  profileFormPassword: string;
  profileFormConfirm: string;
  distributionPasswords: Record<number, { password: string; confirmPassword: string }>;
  importProfileFormPassword: string;
  importSaveFormPassword: string;
  importSaveFormConfirm: string;
  onboardConnectFormPassword: string;
  onboardSaveFormPassword: string;
  onboardSaveFormConfirm: string;
  rotateConnectFormPassword: string;
};

/**
 * Full in-memory app state. The localStorage persist path goes through
 * `toPersistable(state)` (see `persist-allowlist.ts`) which sifts this
 * shape down to a narrow allow-list of non-secret fields. The passphrase,
 * the draft keyset, pending confirmations, runtime snapshots, and all
 * `draftSecrets` fields are explicitly NOT in the persist allow-list
 * and therefore live only in React state for the lifetime of the tab.
 */
export type PwaPersistedState = {
  profiles: PwaProfile[];
  peerPermissionStates: PwaPeerPermissionState[];
  runtimeWarning: string | null;
  selectedProfileId: string;
  activeView: PwaView;
  activeDashboardTab: PwaDashboardTab;
  /** In-memory only. Re-entered on every session start. */
  unlockPassphrase: string;
  /** In-memory only. Ephemeral keyset in-flight during generation. */
  pendingKeyset: PwaGeneratedKeyset | null;
  selectedGeneratedShareIdx: number | null;
  /** In-memory only. Passphrase-carrying pending flows do not survive reload. */
  pendingLoadConfirmation: PwaLoadConfirmation | null;
  /** In-memory only. Non-secret error string from the last load attempt. */
  pendingLoadError: string | null;
  /** In-memory only. */
  pendingOnboardConnection: PwaOnboardConnection | null;
  /** In-memory only. */
  pendingRotationConnection: PwaOnboardConnection | null;
  distributionSession: PwaDistributionSession | null;
  /** In-memory only. Runtime re-bootstraps fresh on reload. */
  runtimeSnapshot: PwaRuntimeSnapshot | null;
  /**
   * In-memory only. Reconstructed `{idx, seckey}` share package JSON per
   * profile id, produced after the user's passphrase unlocks
   * `encrypted_bfshare_artifact` at session start. Holds the raw share
   * seckey hex — MUST NOT be persisted. Reset on every page load and
   * repopulated on each `startSession` call.
   */
  sharePackageJsonByProfileId: Record<string, string>;
  settings: PwaSettings;
  drafts: PwaDraftState;
  /** In-memory only. Holds every password/passphrase typed into a form. */
  draftSecrets: PwaDraftSecrets;
};
