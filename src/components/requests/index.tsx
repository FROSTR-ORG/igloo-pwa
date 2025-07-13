
import { useState }       from 'react'
import { useRequest }     from '@/hooks/useRequest.js'
import { useBifrostNode } from '@/hooks/useNode.js'
import { useSettings }    from '@/hooks/useSettings.js'

import {
  BaseRequestCard,
  NoteSignatureRequestCard
} from './cards/index.js'

export function RequestsView() {
  const node     = useBifrostNode()
  const requests = useRequest()
  const settings = useSettings()

  const [ expanded, setExpanded ] = useState<Set<string>>(new Set())

  const { data, isLoading, error } = requests

  // Show locked state if client is locked
  if (node.data.status === 'locked') {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-error">🔒 Please unlock your client to view permission requests</p>
      </div>
    )
  }

  // Show loading state if client is null but not locked
  if (isLoading) {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-empty">Loading...</p>
      </div>
    )
  }

  return (
    <div className="requests-container">
      <h2 className="section-header">Permission Requests</h2>
      
      {/* Show notification status */}
      {settings.data.flags.notifications && (
        <div style={{ 
          backgroundColor: '#4CAF50', 
          color: '#fff', 
          padding: '8px 12px', 
          borderRadius: '4px', 
          marginBottom: '10px',
          fontSize: '14px'
        }}>
          🔔 Notifications enabled - you'll be notified of new requests
        </div>
      )}
      
      {/* Show offline warning if client is offline */}
      {node.data.status === 'offline' && (
        <div style={{ 
          backgroundColor: '#ffa500', 
          color: '#000', 
          padding: '10px', 
          borderRadius: '4px', 
          marginBottom: '10px' 
        }}>
          ⚠️ Client is offline. New requests will not appear until connection is restored.
        </div>
      )}

      {/* Permission Requests */}
      <div className="requests-section">
        {data.queue.length === 0 ? (
          <p className="requests-empty">No pending requests</p>
        ) : (
          <div className="requests-list">
            {data.queue.map((request) => {
              const isExpanded = expanded.has(request.id)
              
              if (request.method === 'sign_event') {
                return (
                  <NoteSignatureRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                  />
                )
              } else {
                return (
                  <BaseRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                  />
                )
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
