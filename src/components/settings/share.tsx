import { useEffect, useState } from 'react'
import { QRScanner }           from '@/components/util/scanner.js'
import { useBifrostStore }     from '@/hooks/useBifrostStore.js'

import {
  decode_share_pkg,
  encode_share_pkg
} from '@frostr/bifrost/encoder'

import type { SharePackage } from '@frostr/bifrost'

export function ShareConfig() {
  const store = useBifrostStore()

  const [ input, setInput ] = useState<string>('')
  const [ error, setError ] = useState<string | null>(null)
  const [ show, setShow   ] = useState<boolean>(false)
  const [ saved, setSaved ] = useState<boolean>(false)
  const [ isScanning, setIsScanning ] = useState<boolean>(false)

  /**
   * Handle the update of the store.
   */
  const update_share = () => {
    // If an error exists, do not update the group.
    if (error !== null) return
    // If the input is empty,
    if (input === '') {
      store.update({ share : null })
    } else {
      try {
        // Parse the input into a group package.
        const share = decode_share_pkg(input)

        // If the credentials package is invalid, return.
        if (share === null) return
        // Update the credentials in the store.
        store.update({ share })
      } catch (err) {
        console.log(err)
        setError('failed to decode package data')
      }
    }
    // Set the saved state, and reset it after a short delay.
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  useEffect(() => {
    try {
      if (store.data.share !== null) {
        setInput(get_share_str(store.data.share))
      } else {
        setInput('')
      }
    } catch {
      setInput('')
    }
  }, [ store.data.share ])

  /**
   * Handle the validation of the input when it changes.
   */
  useEffect(() => {
    // If the input is empty, clear the error.
    if (input === '') {
      setError(null)
    } else if (!input.startsWith('bfshare')) {
      // If the input does not start with "bfshare", set an error.
      setError('input must start with "bfshare"')
    } else if (!is_share_string(input)) {
      // If the input contains invalid characters, set an error.
      setError('input contains invalid characters')
    } else {
      // Parse the input into a credential package.
      const pkg = get_share_pkg(input)
      // If the credential package is valid, clear the error.
      if (pkg !== null) {
        setError(null)
      } else {
        // If the credential package is invalid, set an error.
        setError('failed to decode package data')
      }
    }
  }, [ input ])

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
            <button 
              className="button"
              onClick={() => setShow(!show)}
            >
              {show ? 'hide' : 'show'}
            </button>
            <button
              className="button"
              onClick={() => setIsScanning(!isScanning)}
            >
              {isScanning ? 'stop scan' : 'scan'}
            </button>
            <button
              className={`button action-button ${saved ? 'saved-button' : ''}`} 
              onClick={update_share}
              disabled={!is_share_changed(input, store.data.share) || error !== null}
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
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
            {get_share_json(input) ?? 'invalid share package'}
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
 * Check if the input has changed and is valid.
 */
function is_share_changed (
  input : string,
  share : SharePackage | null
) {
  if (share === null) {
    return input !== ''
  } else {
    // Encode the existing share to a string.
    const share_str = get_share_str(share)
    // Determine if the share input has changed and is valid.
    return input !== share_str
  }
}

/**
 * Get the share string from the package.
 */
function get_share_str (share : SharePackage) {
  try {
    return (share !== null)
      ? encode_share_pkg(share)
      : ''
  } catch {
    return ''
  }
}

/**
 * Get the share package from the input.
 */
function get_share_pkg (input : string) {
  try {
    return (input !== '')
      ? decode_share_pkg(input)
      : null
  } catch {
    return null
  }
}

/**
 * Get the share JSON from the input.
 */
function get_share_json(input : string) {
  try {
    const share = decode_share_pkg(input)
    return JSON.stringify(share, null, 2)
  } catch (err) {
    return null
  }
}
