import { BifrostController } from './class.js'
import { JsonUtil }          from '@/util/index.js'
import { convert_pubkey }    from '@frostr/bifrost/util'

import type { PeerConfig }  from '@frostr/bifrost'
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

export function get_peer_configs (settings : AppSettings) {
  // Unpack the store.
  const { group, pubkey } = settings
  // If the group or pubkey is not set, return an empty array.
  if (!group || !pubkey) return []
  // Initialize the peer config array.
  const configs : PeerConfig[] = []
  // For each commit in the group,
  for (const commit of group.commits) {
    // If the commit pubkey is the same as the pubkey, skip.
    if (commit.pubkey === pubkey) continue
    // Find the peer config for the commit.
    const config = settings.peers.find(e => e.pubkey === commit.pubkey)
    // Add the config to the configs array.
    configs.push({
      pubkey : convert_pubkey(commit.pubkey, 'bip340'),
      policy : {
        send : config?.policy.send ?? true,
        recv : config?.policy.recv ?? true
      }
    })
  }
  // Return the configs array.
  return configs
}
