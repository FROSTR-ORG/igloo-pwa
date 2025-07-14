import { useEffect, useState } from 'react'
import { useSettings }         from '@/hooks/useSettings.js'

export function NotificationField() {
  const settings = useSettings()
  
  const [ permission, setPermission ] = useState<NotificationPermission>('default')
  const [ isLoading,  setIsLoading  ] = useState(false)
  const [ error,      setError      ] = useState<string | null>(null)
  const [ isSaving,   setIsSaving   ] = useState(false)
  const [ saveStatus, setSaveStatus ] = useState<string | null>(null)

  // Check current notification permission status
  const checkPermission = () => {
    if ('Notification' in window) {
      setPermission(Notification.permission)
    }
  }

  // Request notification permission
  const requestPermission = async () => {
    if (!('Notification' in window)) {
      setError('This browser does not support notifications')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      
      if (result === 'granted') {
        // Browser permission granted, enable in app settings
        settings.update({ notifications: true })
      } else if (result === 'denied') {
        setError('Notification permission was denied. You can enable it in your browser settings.')
      }
    } catch (err) {
      setError('Failed to request notification permission')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle checkbox change
  const handleToggle = () => {
    const currentAppSetting = settings.data.notifications
    
    if (!currentAppSetting) {
      // User wants to enable notifications
      if (permission === 'granted') {
        // Browser permission already granted, just enable in app
        settings.update({ notifications: true })
      } else if (permission === 'denied') {
        setError('notifications were previously denied in your browser. Please enable them in your browser settings first.')
      } else {
        // Need to request browser permission first
        requestPermission()
      }
    } else {
      // User wants to disable notifications
      settings.update({ notifications: false })
      setError(null) // Clear any existing errors
    }
  }

  // Save settings to store
  const saveSettings = async () => {
    setIsSaving(true)
    setSaveStatus(null)
    setError(null)

    try {
      await settings.update({ notifications: settings.data.notifications })
      setSaveStatus('Settings saved successfully!')
      
      // Clear success message after 3 seconds
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      setError('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // Clear error after some time
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Check permission on mount
  useEffect(() => {
    checkPermission()
  }, [])

  const isChecked = settings.data.notifications
  const isDisabled = isLoading || !('Notification' in window)

  return (
    <div className="container">
      <h2 className="section-header">Notification Permissions</h2>
      <p className="description">
        Enable browser notifications to receive alerts when new requests arrive or when important events occur.
      </p>
      
      <div className="input-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={handleToggle}
            disabled={isDisabled}
            className="notification-checkbox"
          />
          <span className="checkbox-text">
            {isLoading ? 'Requesting permission...' : 'Enable notifications'}
          </span>
        </label>
      </div>

      <div className="permission-status">
        <span className={`status-indicator ${permission}`}>
          {permission === 'granted' && '✓ Browser permission granted'}
          {permission === 'denied'  && '✗ Browser permission denied'}
          {permission === 'default' && '○ Browser permission not configured'}
        </span>
      </div>

      <div className="input-group">
        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="button button-primary"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="notification-container">
        {error && <p className="error-text">{error}</p>}
        {saveStatus && <p className="success-text">{saveStatus}</p>}
      </div>

      {/* Test notification button */}
      {/* {settings.data.notifications && permission === 'granted' && (
        <div className="input-group">
          <button 
            onClick={() => {
              try {
                const testNotification = new Notification('Test Notification', {
                  body: 'This is a test notification from Nostr Connect',
                  icon: '/icon.svg'
                })
                testNotification.onclick = () => {
                  window.focus()
                  testNotification.close()
                }
                setTimeout(() => testNotification.close(), 5000)
              } catch (err) {
                console.error('Test notification failed:', err)
              }
            }}
            className="button button-secondary"
          >
            Test Notification
          </button>
        </div>
      )} */}

      {!('Notification' in window) && (
        <div className="notification-container">
          <p className="error-text">Notifications are not supported in this browser</p>
        </div>
      )}
    </div>
  )
} 