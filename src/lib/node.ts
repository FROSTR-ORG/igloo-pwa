import { convert_pubkey } from '@frostr/bifrost/util'

import type { PeerConfig }          from '@frostr/bifrost'
import type { ApplicationSettings } from '@/types/index.js'

export function get_peer_policies (configs : PeerConfig[]) {
  // Initialize the peer permissions.
  return configs.map(e => ({
    pubkey : convert_pubkey(e.pubkey, 'bip340'),
    policy : { send : e.policy.send, recv : e.policy.recv }
  }))
}

export function should_init_peers (
  current : ApplicationSettings,
  changes : Partial<ApplicationSettings>
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

export function init_peer_permissions (settings : ApplicationSettings) {
  // Unpack the store.
  const { group, pubkey } = settings
  // If the group or pubkey is not set, return an empty array.
  if (!group || !pubkey) return []
  // Initialize the peer permissions.
  return group.commits
    .filter((commit) => commit.pubkey !== pubkey)
    .map(commit => ({
      pubkey : commit.pubkey,
      policy : { send : true, recv : true }
    }))
}
