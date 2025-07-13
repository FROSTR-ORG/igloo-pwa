// Base request card component
import { useState }   from 'react'
import { useRequest } from '@/hooks/useRequest.js'

import {
  RequestCardHeader,
  RequestCardBody
} from './shared.js'

import type { BaseCardProps } from './types.js'

import type {
  PermissionRequest,
  PermissionPolicy
} from '@cmdcode/nostr-connect'

interface BaseRequestActionsProps {
  request: PermissionRequest
}

function BaseRequestActions({ request }: BaseRequestActionsProps) {
  const requests = useRequest()
  
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
    
    requests.approve(request, policy)
  }
  
  const handleDenyAll = () => {
    // Create a permission policy that auto-denies all future requests of this method type  
    const policy : Partial<PermissionPolicy> = {
      methods : { [ request.method ]: false }
    }
    
    requests.deny(request, 'User denied all requests of this type', policy)
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
    </div>
  )
}

export function BaseRequestCard(props: BaseCardProps) {
  const { request, isExpanded } = props
  const [expanded, setExpanded] = useState(isExpanded)

  const toggleExpanded = () => {
    setExpanded(!expanded)
  }

  return (
    <div className="request-card">
      <RequestCardHeader 
        request={request}
      />
      <RequestCardBody 
        request={request} 
        isExpanded={expanded} 
        onToggleExpanded={toggleExpanded} 
      />
      <BaseRequestActions 
        request={request}
      />
    </div>
  )
} 