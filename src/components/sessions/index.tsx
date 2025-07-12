import { useState }            from 'react'
import { ConnectToken }        from '@cmdcode/nostr-connect'
import { useSession }     from '@/hooks/useSession.js'
import { PermissionsDropdown } from '@/components/sessions/permissions.js'

import type { PermissionMap } from '@cmdcode/nostr-connect'

export function SessionsView() {
  const client = useSession()

  const [ connectStr, setConnectStr ] = useState('')
  const [ error, setError           ] = useState<string | null>(null)
  const [ expanded, setExpanded     ] = useState<Set<string>>(new Set())
  const [ editing, setEditing       ] = useState<Record<string, PermissionMap>>({})
  const [ newKind, setNewKind       ] = useState<Record<string, string>>({})
  const [ copied, setCopied         ] = useState<string | null>(null)

  const connect = async () => {
    try {
      setError(null)
      const token = ConnectToken.decode(connectStr)
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
          [pubkey]: { ...(session.perms || {}) }
        }))
      }
    }
    setExpanded(newExpanded)
  }

  const handle_permission_change = (pubkey: string, permissions: PermissionMap) => {
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

  // Combine active and pending sessions
  const allSessions = [
    ...client.data.active.map(s  => ({ ...s, status: 'active'  as const  })),
    ...client.data.pending.map(s => ({ ...s, status: 'pending' as const }))
  ]

  return (
    <div className="sessions-container">
      <h2 className="section-header">Client Sessions</h2>

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
                        {session.image && (
                          <img 
                            src={session.image} 
                            alt={`${session.name || 'Unknown'} icon`}
                            className="session-icon"
                          />
                        )}
                        <span className="session-name">{session.name ?? 'unknown'}</span>
                      </div>
                      {session.url && (
                        <a 
                          href={session.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="session-url"
                        >
                          {new URL(session.url).hostname}
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
                      editingPermissions={editing[session.pubkey] || session.perms || {}}
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
          <button
            onClick={connect}
            className="session-btn-primary"
          >
            Connect
          </button>
        </div>
        {error && <p className="session-error">{error}</p>}
      </div>
    </div>
  )
} 