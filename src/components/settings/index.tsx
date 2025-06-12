import { GroupConfig }       from './group.js'
import { PeerConfig }        from './peers.js'
import { RelayConfig }       from './relays.js'
import { ResetStore }        from './reset.js'
import { ShareConfig }       from './share.js'

export function Settings () {
  return (
    <>
      <GroupConfig       />
      <ShareConfig       />
      <PeerConfig        />
      <RelayConfig       />
      <ResetStore        />
    </>
  )
}
