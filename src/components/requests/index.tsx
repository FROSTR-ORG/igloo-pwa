import { useState } from 'react'
import { BaseRequestCard, NoteSignatureRequestCard } from '@/components/requests/cards/index.js'

// TODO: Replace with actual hook when implemented
// import { usePermissionRequests } from '@/hooks/usePermissionRequests.js'

// Mock data structure for development - will be replaced by actual hook
interface EnhancedPermRequest {
  id: string
  method: string
  source: string
  content?: unknown
  timestamp: number
  session_origin?: {
    name?: string
    image?: string
    pubkey: string
    url?: string
  }
  request_type: 'base' | 'note_signature'
  status: 'pending' | 'approved' | 'denied'
}

interface PermissionRequestState {
  pending: EnhancedPermRequest[]
  status: string
}

// Mock hook for development - replace with actual implementation
function usePermissionRequests() {
  // Mock data with examples of both request types
  const mockData: PermissionRequestState = {
    pending: [
      {
        id: 'req_123456789abcdef',
        method: 'nip04_decrypt',
        source: 'nostr-client-app',
        content: {
          peer_pubkey: '02a1b2c3d4e5f6...',
          ciphertext: 'encrypted_content_here'
        },
        timestamp: Date.now() - 300000, // 5 minutes ago
        session_origin: {
          name: 'Damus',
          image: '/icons/damus.png',
          pubkey: '02a1b2c3d4e5f6789abcdef123456789abcdef123456789abcdef123456789abcdef',
          url: 'https://damus.io'
        },
        request_type: 'base',
        status: 'pending'
      },
      {
        id: 'req_abcdef123456789',
        method: 'sign_event',
        source: 'note-signing-app',
        content: {
          kind: 1,
          content: 'Hello Nostr! This is a test note.',
          tags: [],
          created_at: Math.floor(Date.now() / 1000)
        },
        timestamp: Date.now() - 120000, // 2 minutes ago
        session_origin: {
          name: 'Iris',
          pubkey: '03b2c3d4e5f6789abcdef123456789abcdef123456789abcdef123456789abcdef12',
          url: 'https://iris.to'
        },
        request_type: 'note_signature',
        status: 'pending'
      }
    ],
    status: 'loaded'
  }
  
  return {
    data: mockData,
    isLoading: false,
    error: null,
    approve: (id: string) => console.log('Approve:', id),
    deny: (id: string) => console.log('Deny:', id),
    approveAll: () => console.log('Approve All'),
    denyAll: () => console.log('Deny All'),
    approveAllKinds: (kind: number) => console.log('Approve All Kinds:', kind),
    denyAllKinds: (kind: number) => console.log('Deny All Kinds:', kind)
  }
}

export function RequestsView() {
  const client = usePermissionRequests()
  
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (requestId: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(requestId)) {
      newExpanded.delete(requestId)
    } else {
      newExpanded.add(requestId)
    }
    setExpanded(newExpanded)
  }

  const handleApprove = (requestId: string) => {
    client.approve(requestId)
  }

  const handleDeny = (requestId: string) => {
    client.deny(requestId)
  }

  const handleApproveAll = () => {
    client.approveAll()
  }

  const handleDenyAll = () => {
    client.denyAll()
  }

  const handleApproveAllKinds = (kind: number) => {
    client.approveAllKinds(kind)
  }

  const handleDenyAllKinds = (kind: number) => {
    client.denyAllKinds(kind)
  }

  if (client.isLoading) {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-loading">Loading requests...</p>
      </div>
    )
  }

  if (client.error) {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-error">Error loading requests: {client.error}</p>
      </div>
    )
  }

  return (
    <div className="requests-container">
      <h2 className="section-header">Permission Requests</h2>

      {/* Pending Requests */}
      <div className="requests-section">
        {client.data.pending.length === 0 ? (
          <p className="requests-empty">No pending requests</p>
        ) : (
          <div className="requests-list">
            {client.data.pending.map((request) => {
              const isExpanded = expanded.has(request.id)
              
              if (request.request_type === 'note_signature') {
                return (
                  <NoteSignatureRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                    onToggleExpanded={() => toggleExpanded(request.id)}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    onApproveAll={handleApproveAll}
                    onDenyAll={handleDenyAll}
                    onApproveAllKinds={handleApproveAllKinds}
                    onDenyAllKinds={handleDenyAllKinds}
                  />
                )
              } else {
                return (
                  <BaseRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                    onToggleExpanded={() => toggleExpanded(request.id)}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    onApproveAll={handleApproveAll}
                    onDenyAll={handleDenyAll}
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
