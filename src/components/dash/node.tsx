import { useState }       from 'react'
import { nip19 }          from 'nostr-tools'
import { useBifrostNode } from '@/hooks/useBifrostNode.js'

function truncateNpub(npub: string) {
  if (npub.length <= 27) return npub
  return npub.slice(0, 12) + '...' + npub.slice(-12)
}

function truncateHex(hex: string) {
  if (hex.length <= 27) return hex
  return hex.slice(0, 12) + '...' + hex.slice(-12)
}

export function NodeInfo () {
  const node = useBifrostNode()

  const [ password, setPassword ]       = useState('')
  const [ error, setError ]             = useState<string | null>(null)
  const [ showHex, setShowHex ]         = useState(false)
  const [ copySuccess, setCopySuccess ] = useState(false)

  const npub = node.info?.pubkey
    ? nip19.npubEncode(node.info.pubkey)
    : 'unknown'

  const hex = node.info?.pubkey || 'unknown'

  const handleCopy = async () => {
    const valueToCopy = showHex ? hex : npub
    try {
      await navigator.clipboard.writeText(valueToCopy)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 1000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) {
      setError('Password is required')
      return
    }
    try {
      node.unlock(password)
      setError(null)
      setPassword('')
    } catch (err) {
      setError('Invalid password')
    }
  }

  // If client is locked, show locked state
  if (node.info?.status === 'locked') {
    return (
      <div className="dashboard-container">
        <h2 className="section-header">Node Info</h2>
        <div className="node-inline-row locked">
          <span className="node-label">Status</span>
          <span className="status-pill locked">Locked</span>
        </div>
        <form onSubmit={handleUnlock} className="unlock-form">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to unlock..."
            className="nsec-input"
            autoComplete="current-password"
          />
          <button 
            type="submit"
            className="button button-primary"
            disabled={!password}
          >
            Unlock
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>
    )
  }

  // Show normal state when unlocked
  return (
    <div className="dashboard-container">
      <h2 className="section-header">Node Info</h2>
      <div className="node-inline-row locked">
        <span className="node-label">Status</span>
        <span className={`status-pill ${node.info?.status}`}>{node.info?.status}</span>
      </div>
      <div className="node-inline-row">
        <span className="node-label">Pubkey</span>
        <div className="pubkey-container">
          <span 
            className="node-npub" 
            onClick={() => setShowHex(!showHex)}
            title={`Click to show ${showHex ? 'npub' : 'hex'} format`}
          >
            {showHex ? truncateHex(hex) : truncateNpub(npub)}
          </span>
          <button
            onClick={handleCopy}
            className={`button button-small copy-button ${copySuccess ? 'copied' : ''}`}
            title="Copy to clipboard"
          >
            {copySuccess ? '✓' : '📋'}
          </button>
        </div>
      </div>
      <button 
        className="button"
        onClick={() => node.reset()}
      >
        Reset Node
      </button>
    </div>
  )
}
