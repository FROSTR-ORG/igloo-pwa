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
  // Get the pubkeys of the group.
  const group_pks = group.commits.map(e => convert_pubkey(e.pubkey, 'bip340'))
  // For each pubkey in the group,
  for (const peer_pk of group_pks) {
    // If the pubkey is the same as the pubkey, skip.
    if (peer_pk === pubkey) continue
    // Find the peer config for the commit.
    const config = settings.peers.find(e => e.pubkey === peer_pk)
    // Add the config to the configs array.
    configs.push({
      pubkey : peer_pk,
      policy : {
        send : config?.policy.send ?? true,
        recv : config?.policy.recv ?? true
      }
    })
  }
  // Return the configs array.
  return configs
}
