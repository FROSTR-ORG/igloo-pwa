import { NodeInfo } from './info.js'
import { PeerInfo } from './peers.js'
import { Console }  from './console.js'

export function Dashboard () {
  return (
    <>
      <NodeInfo />
      <PeerInfo />
      <Console />
    </>
  )
}
