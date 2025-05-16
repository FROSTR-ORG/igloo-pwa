import { useEffect, useState } from 'react'

import { MessageClient } from './bus/client.js'
import { MESSAGE }       from './const.js'
import Console from './components/console.js'
import { SettingsIcon, NodeIcon, ConsoleIcon, PermissionsIcon } from './components/icons'

import './styles/global.css'
import './styles/connected.css'
import './styles/options.css'

export default function App() {
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState('console')

  useEffect(() => {
    // Check if service worker is running by sending a ping
    const checkConnection = async () => {
      try {
        const response = await MessageClient.send({
          type: MESSAGE.CONNECT
        })
        
        if (response && response.type === MESSAGE.CONNECT) {
          console.log('App: Service worker is running')
          setConnected(true)
        } else {
          console.log('App: Service worker is not responding correctly')
          setConnected(false)
        }
      } catch (error) {
        console.error('App: Error checking service worker status', error)
        setConnected(false)
      }
    }
    
    checkConnection()
    
    // Subscribe to connection status updates
    const connectSub = MessageClient.subscribe(MESSAGE.CONNECT, () => {
      console.log('App: Received CONNECT message')
      setConnected(true)
    })
    
    const disconnectSub = MessageClient.subscribe(MESSAGE.DISCONNECT, () => {
      console.log('App: Received DISCONNECT message')
      setConnected(false)
    })
    
    const errorSub = MessageClient.subscribe(MESSAGE.ERROR, (payload) => {
      console.error('App: Received ERROR message', payload)
    })

    return () => {
      connectSub()
      disconnectSub()
      errorSub()
    }
  }, [])

  const handleDisconnect = async () => {
    try {
      console.log('App: Disconnecting from service worker')
      await MessageClient.send({
        type: MESSAGE.DISCONNECT
      })
      setConnected(false)
    } catch (error) {
      console.error('App: Error during disconnect', error)
    }
  }

  return (
    <div className="app">
      <div className="page-header">
        <img 
          src="/assets/frostr-icon.png" 
          alt="Frost Logo" 
          className="frost-logo"
        />
        <div className="title-container">
          <h1>Igloo PWA</h1>
        </div>
        <p>Frostr Remote Signer</p>
        <a 
          href="https://frostr.org" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          https://frostr.org
        </a>
        <div className="alpha-pill alpha-pill-standalone">alpha edition</div>
      </div>

      {/* Tab Navigation */}
      <div className="tabs-container">
        <div className="tabs-nav-wrapper">
          <div className="tabs-navigation">
            <button 
              className={`tab-button ${activeTab === 'console' ? 'active' : ''}`}
              onClick={() => setActiveTab('console')}
            >
              <ConsoleIcon />
              <span>Console</span>
            </button>
            <button 
              className={`tab-button ${activeTab === 'node' ? 'active' : ''}`}
              onClick={() => setActiveTab('node')}
            >
              <NodeIcon />
              <span>Node</span>
            </button>
            <button 
              className={`tab-button ${activeTab === 'permissions' ? 'active' : ''}`}
              onClick={() => setActiveTab('permissions')}
            >
              <PermissionsIcon />
              <span>Permissions</span>
            </button>
            <button 
              className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
          </div>
        </div>

        <div className="tab-content">
          {/* Console Tab */}
          {activeTab === 'console' && (
            <div className="tab-panel">
              <Console />
            </div>
          )}

          {/* Node Tab */}
          {activeTab === 'node' && (
            <div className="tab-panel">
              <div className="content-section">
                <h2 className="section-header">Share Package</h2>
                <p className="description">Paste your encoded share package (starts with bfshare). It contains secret information required for signing. Do not share it with anyone.</p>
                <textarea rows={3} placeholder="Enter your share package..."></textarea>
                <div className="action-buttons">
                  <button className="button">Show</button>
                  <button className="button button-primary">Save</button>
                </div>

                <div className="content-section mt-2">
                  <h2 className="section-header">Group Package</h2>
                  <p className="description">Paste your encoded group package (starts with bfgroup). It contains information about the members of your signing group.</p>
                  <textarea rows={3} placeholder="Enter your group package..."></textarea>
                  <div className="action-buttons">
                    <button className="button">Show</button>
                    <button className="button button-primary">Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Permissions Tab */}
          {activeTab === 'permissions' && (
            <div className="tab-panel">
              <div className="content-section">
                <h2 className="section-header">Peer Connections</h2>
                <p className="description">Configure how you communicate with other peers in your signing group. "Request" will send signature requests to that peer, and "Respond" will co-sign requests from that peer.</p>
                
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Peer Public Key</th>
                        <th>Request</th>
                        <th>Respond</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="pubkey-cell">95c958b32af447bacc488f76072b6feba175b76a95c7d4402614792aca0a74f</td>
                        <td className="checkbox-cell"><input type="checkbox" checked /></td>
                        <td className="checkbox-cell"><input type="checkbox" checked /></td>
                      </tr>
                      <tr>
                        <td className="pubkey-cell">6e688e49bbe09469fea7682d91e3b1afe8e25c3ad497c367443bf11b5227f61c</td>
                        <td className="checkbox-cell"><input type="checkbox" /></td>
                        <td className="checkbox-cell"><input type="checkbox" checked /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                <div className="action-buttons mt-2">
                  <button className="button button-primary">Save</button>
                </div>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="tab-panel">
              <div className="settings-section">
                <h2>General Settings</h2>
                <div className="form-row">
                  <label className="form-label">Default Relay</label>
                  <p className="field-description">Specify the relay server to use for Nostr communication</p>
                  <input type="text" className="form-input" placeholder="wss://relay.example.com" />
                </div>
                <div className="settings-actions">
                  <button className="button button-primary">Save Settings</button>
                  <div className="notification-container"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="status-container">
        <div className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
        <span className="status-text">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </div>
  )
}