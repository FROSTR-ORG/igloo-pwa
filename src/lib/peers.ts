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
