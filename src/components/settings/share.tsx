import { useEffect, useState } from 'react'
import { get_pubkey }          from '@frostr/bifrost/util'
import { QRScanner }           from '@/components/util/scanner.js'
import { useSettings }         from '@/hooks/useSettings.js'
import { decode_share }        from '@/lib/encoder.js'

import { decrypt_secret, encrypt_secret } from '@/lib/crypto.js'

export function ShareConfigField() {
  const store = useSettings()
  const share = store.data.share

  const [ input, setInput ] = useState<string>('')
  const [ error, setError ] = useState<string | null>(null)
  const [ show, setShow   ] = useState<boolean>(false)
  const [ saved, setSaved ] = useState<boolean>(false)

  const [ password,   setPassword   ] = useState<string>('')
  const [ isScanning, setIsScanning ] = useState<boolean>(false)

  const decrypt = () => {
    const decrypted = decrypt_secret(input, password)
    if (!decrypted) {
      setError('failed to decrypt secret share')
      return
    }
    if (!is_share_string(decrypted)) {
      setError('decrypted secret share is invalid')
      return
    }
    setInput(decrypted)
  }

  const encrypt = () => {
    if (!is_share_string(input)) {
      setError('invalid share string')
      return
    }
    const encrypted = encrypt_secret(input, password)
    if (!encrypted) {
      setError('failed to encrypt secret share')
      return
    }
    setInput(encrypted)
  }

  /**
   * Handle the update of the store.
   */
  const update = () => {
    // If an error exists, do not update the group.
    if (error !== null) return
    // If the input is empty,
    if (input === '') {
      // Update the store and return.
      store.update({ pubkey : null, share : null })
      return
    }
    // If the input has invalid characters,
    if (!is_share_string(input)) {
      // Set an error and return.
      setError('invalid share string')
      return
    }
    // If the password is empty,
    if (password.length < 8) {
      // Set an error and return.
      setError('password must be at least 8 characters')
      return
    }
    // Parse the input into a group package.
    const share = decode_share(input)
    // If the credentials package is invalid,
    if (share == null) {
      // Set an error and return.
      setError('failed to decode secret share')
      return
    }
    // Get the public key from the secret key.
    const pubkey = get_pubkey(share.seckey, 'bip340')
    // Update the credentials in the store.
    const encrypted = encrypt_secret(input, password)
    // If encryption fails,
    if (!encrypted) {
      // Set an error and return.
      setError('failed to encrypt secret share')
      return
    }
    // Set the saved state, and reset it after a short delay.
    store.update({ pubkey, share : encrypted })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  useEffect(() => {
    if (store.data.share === null) {
      setInput('')
    } else {
      setInput(store.data.share)
    }
  }, [ store.data.share ])

  /**
   * Handle the validation of the input when it changes.
   */
  useEffect(() => {
    // Once the input changes, clear any errors from submission.
    if (error !== null) {
      setError(null)
    }
  }, [ input, password ])

  return (
    <div className="container">
      <h2 className="section-header">Share Package</h2>
      <p className="description">Paste your encoded share string (starts with bfshare). It contains secret information about your signing share.</p>
      <div className="content-container">
        <div className="input-with-button">
          <input
            type={show ? "text" : "password"}
            value={input}
            onChange={e => setInput(e.target.value.trim())}
            placeholder="bfshare..."
          />
          <div className="input-actions">
            {input.startsWith('bfshare') && (
            <button 
              className="button"
                onClick={() => setShow(!show)}
              >
                {show ? 'hide' : 'show'}
              </button>
            )}
            {!input.startsWith('bfshare') && (
              <button 
                className="button"
                onClick={() => decrypt()}
               >
                 decrypt
               </button>
            )}
          </div>
        </div>

        <div className="input-with-button">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="enter a password to encrypt your share"
            className="nsec-input flex-input password-masked"
            autoComplete="off"
          />
        </div>
        
        <div className="action-buttons">
          <button
            className="button"
            onClick={() => setIsScanning(!isScanning)}
          >
            {isScanning ? 'stop scan' : 'scan'}
          </button>
          <button
            className={`button action-button ${saved ? 'saved-button' : ''}`} 
            onClick={update}
            disabled={input === share || error !== null}
          >
            {saved ? 'saved' : 'save'}
          </button>
        </div>
        
        {isScanning && (
          <QRScanner
            onResult={(result: string) => {
              setInput(result.trim())
              setIsScanning(false)
            }}
            onError={(error: Error) => {
              console.error('QR scan error:', error)
            }}
          />
        )}
        
        {input !== '' && error === null && show && (
          <pre className="code-display">
            {get_share_json(input) ?? 'share package is encrypted or invalid'}
          </pre>
        )}
        <div className="notification-container">
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  )
}

/**
 * Check if the input is a valid credential string.
 */
function is_share_string(input : string) {
  return /^bfshare1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(input)
}

/**
 * Get the share JSON from the input.
 */
function get_share_json(input : string) {
  try {
    if (!is_share_string(input)) return null
    const share = decode_share(input)
    if (share === null) return null
    return JSON.stringify(share, null, 2)
  } catch (err) {
    return null
  }
}
