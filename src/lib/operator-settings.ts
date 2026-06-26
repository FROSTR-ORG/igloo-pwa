import type { PwaSignerSettings } from './types';

export type OperatorSettingsComparable = {
  signerName: string;
  relays: readonly string[];
  signerSettings: PwaSignerSettings;
};

export function areOperatorSettingsEqual(
  left: OperatorSettingsComparable,
  right: OperatorSettingsComparable,
) {
  return (
    left.signerName === right.signerName &&
    sameStringList(left.relays, right.relays) &&
    sameSignerSettings(left.signerSettings, right.signerSettings)
  );
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameSignerSettings(left: PwaSignerSettings, right: PwaSignerSettings) {
  return (
    left.sign_timeout_secs === right.sign_timeout_secs &&
    left.ping_timeout_secs === right.ping_timeout_secs &&
    left.request_ttl_secs === right.request_ttl_secs &&
    left.state_save_interval_secs === right.state_save_interval_secs &&
    left.peer_selection_strategy === right.peer_selection_strategy
  );
}
