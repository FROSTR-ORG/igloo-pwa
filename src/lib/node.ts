import { convert_pubkey } from '@frostr/bifrost/util'

import type { PeerConfig }  from '@frostr/bifrost'
import type { AppSettings } from '@/types/index.js'

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

export function should_reset_node (
  current : AppSettings,
  changes : Partial<AppSettings>
) {
  // If the group or share has changed, return true.
  if (changes.group || changes.pubkey) return true
  // If the group has been reset, return true.
  if (current.group && changes.group === null) return true
  // If the share has been reset, return true.
  if (current.pubkey && changes.pubkey === null) return true
  // If the group and pubkey are set, and the peers are not set, return true.
  if (current.group && current.pubkey && current.peers.length === 0) return true
  // If there is no group set, and the peers are set, return true.
  if (!current.group && !changes.group && current.peers.length > 0) return true
  // If there is no pubkey set, and the peers are set, return true.
  if (!current.pubkey && !changes.pubkey && current.peers.length > 0) return true
  // Otherwise, return false.
  return false
}
