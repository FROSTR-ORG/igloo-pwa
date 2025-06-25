import { BifrostController } from './class.js'
import { JsonUtil }          from '@/util/index.js'

import type { AppSettings } from '@/types/index.js'

export function get_node_status (node : BifrostController) : string {
  if (node.is_ready)           return 'online'
  if (node.client)             return 'connecting'
  if (node.has_share)          return 'unlocked'
  if (has_node_settings(node)) return 'locked'
  return 'loading'
}

export function has_node_settings (ctrl : BifrostController) : boolean {
  // Get the settings cache.
  const settings = ctrl.global.scope.settings.data
  // Unpack store object.
  const { group, relays, share } = settings
  // Test if the store has the required data to initialize.
  return !!group && !!share && relays.length > 0
}

export function should_reset_node (
  self    : BifrostController,
  current : AppSettings,
  updated : AppSettings
) {
  // If we can't initialize, then return false.
  if (!self.global.store.private) return false
  // If the share data has changed, return false.
  if (current.share !== updated.share) return false
  // If the group data has changed, return true.
  if (current.group !== updated.group) return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(current.peers,  updated.peers))  return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(current.relays, updated.relays)) return true
  // By default, return false.
  return false
}

