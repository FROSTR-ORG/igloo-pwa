import { useEffect, useState }       from 'react'
import { nip19 }          from 'nostr-tools'
import { useBifrostNode } from '@/hooks/useNode.js'
import { sleep } from '@vbyte/micro-lib/util'

export function NodeInfoView () {
  const node   = useBifrostNode()
  const pubkey = node.data.pubkey
  const status = node.data.status

  const [ password, setPassword ]       = useState('')
  const [ error, setError ]             = useState<string | null>(null)
  const [ showHex, setShowHex ]         = useState(false)
  const [ copySuccess, setCopySuccess ] = useState(false)

  const handleCopy = async () => {
    const valueToCopy = get_npub(pubkey, showHex)
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
    const res = await node.unlock(password)
    if (!res.ok) {
      setError(res.error)
      return
    } else {
      setError(null)
      setPassword('')
    }
  }

  useEffect(() => {
    (async () => {
      // Wait for 500ms.
      await sleep(500)
      // Fetch data from the store.
      node.fetch()
    })()
  }, [])

  // If client is locked, show locked state
  if (status === 'locked') {
    return (
      <div className="dashboard-container">
        <h2 className="section-header">Node Info</h2>
        <div className="node-inline-row locked">
          <span className="node-label">Status</span>
          <span className="status-pill locked">Locked</span>
        </div>
        <form onSubmit={handleUnlock} className="unlock-form">
          <div className="input-with-button">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password to unlock..."
              className="nsec-input password-masked"
              autoComplete="off"
            />
          </div>
          <div className="action-buttons">
            <button 
              type="submit"
              className="button button-primary"
              disabled={!password}
            >
              Unlock
            </button>
          </div>
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
        <span className={`status-pill ${status}`}>{status}</span>
      </div>
      <div className="node-inline-row">
        <span className="node-label">Pubkey</span>
        { pubkey === null && <pre>no pubkey set</pre>}
        {pubkey !== null &&
          <div className="pubkey-container">
            <span 
              className="node-npub" 
              onClick={() => setShowHex(!showHex)}
              title={`Click to show ${showHex ? 'npub' : 'hex'} format`}
            >
              { truncate(get_npub(pubkey, showHex))}
            </span>
            <button
              onClick={handleCopy}
              className={`button button-small copy-button ${copySuccess ? 'copied' : ''}`}
              title="Copy to clipboard"
            >
              {copySuccess ? '✓' : '📋'}
            </button>
          </div>
        }
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

function get_npub (
  pubkey  : string | null,
  showHex : boolean
) {
  if (pubkey === null) return ''
  if (showHex)         return pubkey
  return nip19.npubEncode(pubkey)
}

function truncate (str: string) {
  if (str.length <= 27) return str
  return str.slice(0, 12) + '...' + str.slice(-12)
}