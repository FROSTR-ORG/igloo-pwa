import { NodeInfoView } from './node.js'
import { PeerInfoView } from './peers.js'

export function DashboardView () {
  return (
    <>
      <NodeInfoView />
      <PeerInfoView />
    </>
  )
}
