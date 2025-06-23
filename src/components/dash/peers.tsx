import { RefreshIcon } from '@/components/util/icons.js'
import { useBifrostNode }   from '@/hooks/useNode'

export function PeerInfo() {
  const node  = useBifrostNode()
  const peers = node.data.peers

  return (
    <div className="dashboard-container">
      <h2 className="section-header">Peer Status</h2>
      {peers.length === 0 ? (
        <p>waiting for peers...</p>
      ) : (
        <table className="peers-table">
          <thead>
            <tr>
              <th>Pubkey</th>
              <th>Status</th>
              <th>Refresh</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((peer) => (
              <tr key={peer.pubkey}>
                <td className="pubkey-cell">{peer.pubkey}</td>
                <td className="status-cell">
                  <span className={`status-indicator ${peer.status}`}>
                    {peer.status}
                  </span>
                </td>
                <td className="refresh-cell">
                  <button 
                    className="button"
                    onClick={() => node.ping(peer.pubkey)}
                    disabled={node.data.status !== 'online'}
                    title="Refresh peer status"
                  >
                    <RefreshIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
