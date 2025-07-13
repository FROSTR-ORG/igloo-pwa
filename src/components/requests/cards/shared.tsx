// Shared components for request cards
import type { PermissionRequest } from '@cmdcode/nostr-connect'

export function RequestCardHeader({ 
  request
}: { 
  request: PermissionRequest
}) {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <div className="request-header">
      <div className="request-header-content">
        <div className="request-header-text">
          <div className="request-header-top">
            <span className="request-method">{request.method}</span>
            <span className="request-timestamp">
              {formatTimestamp(Date.now())}
            </span>
          </div>
          <div className="request-origin-info">
            <span className="request-origin-name">
              Request ID: {request.id}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RequestCardBody({ 
  request, 
  isExpanded, 
  onToggleExpanded 
}: { 
  request: PermissionRequest
  isExpanded: boolean
  onToggleExpanded: () => void
}) {
  const formatContent = (content: unknown): string => {
    if (content === null || content === undefined) return 'N/A'
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  }

  const getContentPreview = (content: unknown): string => {
    const formatted = formatContent(content)
    if (formatted.length > 100) {
      return formatted.substring(0, 100) + '...'
    }
    return formatted
  }

  return (
    <div className="request-body">
      <div className="request-basic-info">
        <div className="request-info-row">
          <span className="request-info-label">Method:</span>
          <span className="request-info-value">{request.method}</span>
        </div>
        <div className="request-info-row">
          <span className="request-info-label">ID:</span>
          <span className="request-info-value">{request.id}</span>
        </div>
        {request.params && (
          <div className="request-info-row">
            <span className="request-info-label">Parameters:</span>
            <span className="request-info-value">
              {isExpanded ? formatContent(request.params) : getContentPreview(request.params)}
            </span>
          </div>
        )}
      </div>
      
      <button 
        onClick={onToggleExpanded}
        className="request-toggle-btn"
      >
        {isExpanded ? 'Show Less' : 'Show More'}
      </button>
    </div>
  )
} 