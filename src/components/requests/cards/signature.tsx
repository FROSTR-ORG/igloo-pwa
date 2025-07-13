// Note signature request card component
import { useState }   from 'react'
import { useRequest } from '@/hooks/useRequest.js'

import { RequestCardHeader, RequestCardBody } from './shared.js'

import type { NoteSignatureCardProps } from './types.js'

import type {
  EventTemplate,
  PermissionPolicy,
  PermissionRequest
} from '@cmdcode/nostr-connect'

interface NoteSignatureActionsProps {
  request: PermissionRequest
}
 
function NoteSignatureActions({ request }: NoteSignatureActionsProps) {
  const requests = useRequest()
  const event    = request.params as unknown as EventTemplate
  
  const handleApprove = () => {
    requests.approve(request)
  }
  
  const handleDeny = () => {
    requests.deny(request, 'User denied')
  }
  
  const handleApproveAll = () => {
    // Create a permission policy that auto-approves all future requests of this method type
    const policy : Partial<PermissionPolicy> = {
      methods : { [ request.method ]: true }
    }
    
    // Apply to all current requests of this method with the policy
    requests.approve(request, policy)
  }
  
  const handleDenyAll = () => {
    // Create a permission policy that auto-denies all future requests of this method type
    const policy : Partial<PermissionPolicy> = {
      methods : { [ request.method ]: false }
    }
    
    // Apply to all current requests of this method with the policy
    requests.deny(request, 'request denied', policy)
  }
  
  const handleApproveAllKinds = () => {
    // Create a permission policy for this specific event kind
    const policy : Partial<PermissionPolicy> = {
      kinds : { [ event.kind ]: true }
    }
    
    // Apply to all current requests with the same event kind
    requests.approve(request, policy)
  }
  
  const handleDenyAllKinds = () => {
    // Create a permission policy for this specific event kind
    const policy : Partial<PermissionPolicy> = {
      kinds : { [ event.kind ]: false }
    }
    
    // Apply to all current requests with the same event kind
    requests.deny(request, 'request denied', policy)
  }

  return (
    <div className="request-actions">
      <div className="request-actions-primary">
        <button
          onClick={handleApprove}
          className="request-btn request-btn-approve"
        >
          Approve
        </button>
        <button
          onClick={handleDeny}
          className="request-btn request-btn-deny"
        >
          Deny
        </button>
      </div>
      <div className="request-actions-bulk">
        <button
          onClick={handleApproveAll}
          className="request-btn request-btn-approve-all"
        >
          Approve All {request.method}
        </button>
        <button
          onClick={handleDenyAll}
          className="request-btn request-btn-deny-all"
        >
          Deny All {request.method}
        </button>
      </div>
      <div className="request-actions-kinds">
        <button
          onClick={handleApproveAllKinds}
          className="request-btn request-btn-approve-kinds"
        >
          Approve All Kind {event.kind}
        </button>
        <button
          onClick={handleDenyAllKinds}
          className="request-btn request-btn-deny-kinds"
        >
          Deny All Kind {event.kind}
        </button>
      </div>
    </div>
  )
}

export function NoteSignatureRequestCard(props: NoteSignatureCardProps) {
  const { request, isExpanded } = props
  const [expanded, setExpanded] = useState(isExpanded)

  const toggleExpanded = () => {
    setExpanded(!expanded)
  }

  return (
    <div className="request-card request-card-signature">
      <RequestCardHeader 
        request={request}
      />
      <RequestCardBody 
        request={request} 
        isExpanded={expanded} 
        onToggleExpanded={toggleExpanded} 
      />
      <NoteSignatureActions 
        request={request}
      />
    </div>
  )
} 