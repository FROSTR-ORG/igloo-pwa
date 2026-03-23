import type {
  BrowserManualPeerPolicyOverride,
  BrowserProfilePackagePayload,
  BrowserRemotePeerPolicyObservation,
} from 'igloo-shared';

export type PwaView =
  | 'landing'
  | 'create-choice'
  | 'create-generate'
  | 'create-profile'
  | 'create-confirm'
  | 'create-distribute'
  | 'load-choice'
  | 'load-import'
  | 'load-recover'
  | 'load-confirm'
  | 'onboard-connect'
  | 'onboard-save'
  | 'rotate-connect'
  | 'rotate-save'
  | 'dashboard'
  | 'settings';

export type PwaDashboardTab = 'signer' | 'permissions' | 'settings';
export type PwaPeerSelectionStrategy = 'deterministic_sorted' | 'random';

export type PwaSignerSettings = {
  sign_timeout_secs: number;
  ping_timeout_secs: number;
  request_ttl_secs: number;
  state_save_interval_secs: number;
  peer_selection_strategy: PwaPeerSelectionStrategy;
};

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

export type PwaProfilePreview = {
  label: string;
  share_public_key: string;
  group_public_key: string;
  relays: string[];
  group_package_json: string;
  share_package_json: string;
  source: 'generated' | 'bfprofile' | 'bfshare' | 'bfonboard';
};

export type PwaProfile = PwaProfilePreview & {
  id: string;
  relay_profile: string;
  group_ref: string;
  share_ref: string;
  state_path: string;
  created_at: number;
  stored_password: string;
  profile_string: string;
  share_string: string;
  signer_settings: PwaSignerSettings;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  remote_peer_policy_observations?: BrowserRemotePeerPolicyObservation[];
  peer_pubkey?: string | null;
  runtime_snapshot_json?: string | null;
  onboarding_package?: string | null;
};

export type PwaGeneratedShare = {
  name: string;
  member_idx: number;
  share_package_json: string;
  share_public_key: string;
};

export type PwaGeneratedKeyset = {
  keyset_name: string;
  threshold: number;
  count: number;
  group_package_json: string;
  group_public_key: string;
  shares: PwaGeneratedShare[];
};

export type PwaRuntimeSnapshot = {
  active: boolean;
  profile: PwaProfile | null;
  runtime_status: unknown;
  readiness: unknown;
  peer_permission_states?: PwaPeerPermissionState[];
  runtime_log_lines: string[];
  runtime_host: {
    profile_id: string;
    mode: 'browser';
    log_source: string;
    started_at: number;
    signer_pubkey: string;
  } | null;
};

export type PwaLoadConfirmation = {
  kind: 'bfprofile' | 'bfshare';
  preview: PwaProfilePreview;
  stored_password: string;
  profile_string: string;
  share_string: string;
  profile_payload?: BrowserProfilePackagePayload;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  remote_peer_policy_observations?: BrowserRemotePeerPolicyObservation[];
  peer_pubkey?: string | null;
  runtime_snapshot_json?: string | null;
};

export type PwaOnboardConnection = {
  preview: PwaProfilePreview;
  stored_password: string;
  package_text: string;
  profile_string: string;
  share_string: string;
  profile_payload?: BrowserProfilePackagePayload;
  manual_peer_policy_overrides?: BrowserManualPeerPolicyOverride[];
  remote_peer_policy_observations?: BrowserRemotePeerPolicyObservation[];
  peer_pubkey?: string | null;
  runtime_snapshot_json?: string | null;
};

export type PwaDistributionActionResult =
  | {
      kind: 'copied' | 'qr' | 'saved';
      member_idx: number;
      label: string;
      package_text: string;
    };

export type PwaDistributionSession = {
  profile_id: string;
  signer_pubkey: string;
  remaining_member_indices: number[];
  results: Record<number, PwaDistributionActionResult>;
  qr_package: { member_idx: number; label: string; package_text: string } | null;
};

export type PwaDraftState = {
  createForm: {
    mode: 'new' | 'rotate';
    keysetName: string;
    threshold: string;
    count: string;
  };
  rotationForm: {
    sourceProfileId: string;
    sources: Array<{ packageText: string; password: string }>;
  };
  profileForm: {
    label: string;
    password: string;
    confirmPassword: string;
    relayUrls: string;
  };
  distributionForms: Record<number, { label: string; password: string; confirmPassword: string }>;
  importProfileForm: {
    profileString: string;
    password: string;
  };
  recoverProfileForm: {
    shareString: string;
    password: string;
  };
  onboardConnectForm: {
    packageText: string;
    password: string;
  };
  onboardSaveForm: {
    label: string;
    password: string;
    confirmPassword: string;
  };
  rotateConnectForm: {
    packageText: string;
    password: string;
  };
};

export type PwaPersistedState = {
  profiles: PwaProfile[];
  peerPermissionStates: PwaPeerPermissionState[];
  selectedProfileId: string;
  activeView: PwaView;
  activeDashboardTab: PwaDashboardTab;
  unlockPhrase: string;
  generatedKeyset: PwaGeneratedKeyset | null;
  selectedGeneratedShareIdx: number | null;
  pendingLoadConfirmation: PwaLoadConfirmation | null;
  pendingOnboardConnection: PwaOnboardConnection | null;
  pendingRotationConnection: PwaOnboardConnection | null;
  distributionSession: PwaDistributionSession | null;
  runtimeSnapshot: PwaRuntimeSnapshot | null;
  settings: PwaSettings;
  drafts: PwaDraftState;
};
