import { useState }            from 'react'
import { InviteEncoder }       from '@cmdcode/nostr-connect'
import { useSession }          from '@/hooks/useSession.js'
import { useBifrostNode }      from '@/hooks/useNode.js'
import { PermissionsDropdown } from '@/components/sessions/permissions.js'
import { QRScanner }           from '@/components/util/scanner.js'

import type { PermissionPolicy } from '@cmdcode/nostr-connect'

export function SessionsView() {
  const client = useSession()
  const node = useBifrostNode()

  const [ connectStr, setConnectStr ] = useState('')
  const [ error, setError           ] = useState<string | null>(null)
  const [ expanded, setExpanded     ] = useState<Set<string>>(new Set())
  const [ editing, setEditing       ] = useState<Record<string, PermissionPolicy>>({})
  const [ newKind, setNewKind       ] = useState<Record<string, string>>({})
  const [ copied, setCopied         ] = useState<string | null>(null)
  const [ scannerActive, setScannerActive ] = useState(false)

  // Show locked state if client is locked
  if (node.data.status === 'locked') {
    return (
      <div className="sessions-container">
        <p className="requests-error">🔒 Please unlock your client to view sessions</p>
      </div>
    )
  }

  // Show loading state if client is loading
  if (node.data.status === 'loading') {
    return (
      <div className="sessions-container">
        <p className="requests-empty">Loading...</p>
      </div>
    )
  }

  const connect = async () => {
    try {
      setError(null)
      const token = InviteEncoder.decode(connectStr)
      client.connect(token)
      setConnectStr('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate session')
    }
  }

  const toggle_dropdown = (pubkey: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(pubkey)) {
      newExpanded.delete(pubkey)
      // Clear editing state when closing
      const newEditing = { ...editing }
      delete newEditing[pubkey]
      setEditing(newEditing)
      // Clear new event kind input
      const newKinds = { ...newKind }
      delete newKinds[pubkey]
      setNewKind(newKinds)
    } else {
      newExpanded.add(pubkey)
      // Initialize editing state with current permissions
      const session = [ ...client.data.active ].find(s => s.pubkey === pubkey)
      if (session) {
        setEditing(prev => ({
          ...prev,
          [pubkey]: { ...(session.policy || {}) }
        }))
      }
    }
    setExpanded(newExpanded)
  }

  const handle_permission_change = (pubkey: string, permissions: PermissionPolicy) => {
    setEditing(prev => ({
      ...prev,
      [pubkey]: permissions
    }))
  }

  const handle_event_kind_change = (pubkey: string, eventKind: string) => {
    setNewKind(prev => ({ ...prev, [pubkey]: eventKind }))
  }

  const handle_update_session = async (pubkey: string) => {
    try {
      const session = [ ...client.data.active ].find(s => s.pubkey === pubkey)
      if (!session) return

      const updatedSession = {
        ...session,
        perms: editing[pubkey] || {}
      }

      client.update(updatedSession)
      
      // Close the dropdown after successful update
      const newExpanded = new Set(expanded)
      newExpanded.delete(pubkey)
      setExpanded(newExpanded)
      
      // Clear editing state
      const newEditing = { ...editing }
      delete newEditing[pubkey]
      setEditing(newEditing)
      
      // Clear new event kind input
      const newKinds = { ...newKind }
      delete newKinds[pubkey]
      setNewKind(newKinds)
    } catch (err) {
      console.error('Failed to update session:', err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 2000) // Reset after 2 seconds
  }

  const handleQRScanResult = (result: string) => {
    setConnectStr(result)
    setScannerActive(false)
    setError(null)
  }

  const handleQRScanError = (error: Error) => {
    setError(`QR Scanner Error: ${error.message}`)
    setScannerActive(false)
  }

  const toggleScanner = () => {
    setScannerActive(!scannerActive)
    if (!scannerActive) {
      setError(null) // Clear any existing errors when opening scanner
    }
  }

  const closeScanner = () => {
    setScannerActive(false)
    setError(null)
  }

  // Combine active and pending sessions
  const allSessions = [
    ...client.data.pending.map(s => ({ ...s, status: 'pending' as const })),
    ...client.data.active.map(s  => ({ ...s, status: 'active'  as const  }))
  ]

  return (
    <div className="sessions-container">
      {/* Combined Active and Pending Sessions */}
      <div className="sessions-section">
        {allSessions.length === 0 ? (
          <p className="session-empty">No sessions</p>
        ) : (
          <div className="sessions-list">
            {allSessions.map((session) => {
              const truncatedPubkey = session.pubkey.slice(0, 12) + '...' + session.pubkey.slice(-12)
              
              return (
                <div key={session.pubkey} className="session-card">
                  {/* Badge in top-right */}
                  <span className={`session-badge ${session.status}`}>{session.status}</span>
                  <div className="session-header">
                    <div className="session-info">
                      <div className="session-name-container">
                        {session.profile?.image && (
                          <img 
                            src={session.profile.image} 
                            alt={`${session.profile.name || 'Unknown'} icon`}
                            className="session-icon"
                          />
                        )}
                        <span className="session-name">{session.profile?.name ?? 'unknown'}</span>
                      </div>
                      {session.profile?.url && (
                        <a 
                          href={session.profile.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="session-url"
                        >
                          {new URL(session.profile.url).hostname}
                        </a>
                      )}
                      <div className="session-pubkey-container">
                        <span className="session-pubkey">{truncatedPubkey}</span>
                        <button
                          onClick={() => copyToClipboard(session.pubkey)}
                          className="copy-pubkey-btn"
                          title="Copy full public key"
                        >
                          {copied === session.pubkey ? '✓' : '📋'}
                        </button>
                      </div>
                      <span className="session-created">Created: {new Date(session.created_at * 1000).toLocaleString()}</span>
                    </div>
                  </div>
                  {/* Permissions Toggle */}
                  <div className="session-permissions-toggle">
                    <button
                      onClick={() => toggle_dropdown(session.pubkey)}
                      className="session-permissions-btn"
                    >
                      {expanded.has(session.pubkey) ? 'Hide' : 'Show'} Permissions
                    </button>
                  </div>
                  {/* Permissions Dropdown */}
                  {expanded.has(session.pubkey) && (
                    <PermissionsDropdown
                      session={session}
                      editingPermissions={editing[session.pubkey] || session.policy || {}}
                      newEventKind={newKind[session.pubkey] || ''}
                      onPermissionChange={(permissions) => handle_permission_change(session.pubkey, permissions)}
                      onEventKindChange={(eventKind) => handle_event_kind_change(session.pubkey, eventKind)}
                      onUpdateSession={() => handle_update_session(session.pubkey)}
                    />
                  )}
                  {/* Revoke/Cancel button in bottom-right */}
                  <div className="session-card-actions-bottom">
                    <button
                      onClick={() => client.revoke(session.pubkey)}
                      className="session-revoke-btn"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Register Session */}
      <div className="sessions-section">
        <div className="session-card-row">
          <input
            type="text"
            value={connectStr}
            onChange={(e) => setConnectStr(e.target.value)}
            placeholder="Paste nostrconnect:// string here"
            className="session-input"
          />
          <div className="session-buttons-container">
            <button
              onClick={connect}
              className="session-btn-primary"
              disabled={scannerActive}
            >
              Connect
            </button>
            <button
              onClick={toggleScanner}
              className="session-btn-primary session-btn-qr"
              title={scannerActive ? "Close QR Scanner" : "Scan QR Code"}
            >
              {scannerActive ? (
                "✕"
              ) : (
                <img 
                  src="./icons/qrcode.png" 
                  alt="QR Code" 
                  className="qr-button-icon"
                />
              )}
            </button>
          </div>
        </div>
        {error && <p className="session-error">{error}</p>}
      </div>

      {/* QR Scanner Popup */}
      {scannerActive && (
        <QRScanner
          onResult={handleQRScanResult}
          onError={handleQRScanError}
          onClose={closeScanner}
        />
      )}
    </div>
  )
} 