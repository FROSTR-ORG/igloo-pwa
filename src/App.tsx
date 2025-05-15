import { useEffect, useState } from 'react'

import { MessageClient } from './bus/client.js'
import { MESSAGE }       from './const.js'
import Console from './components/console.js'
import { SettingsIcon, NodeIcon, ConsoleIcon } from './components/icons.js'

import './styles/global.css'
import './styles/Connected.css'
import './styles/Status.css'
import './styles/options.css'

export default function App() {
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState('status')

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
      <header className="app-header">
        <img src="/assets/frostr-icon.png" alt="Frost Logo" className="frost-logo" />
        <h1>frost2x</h1>
        <div className="app-subtitle">Frostr Signer Extension</div>
        <a href="https://frostr.org" className="app-url">https://frostr.org</a>
        <span className="alpha-pill">alpha edition</span>
      </header>

      <div className="nav-tabs">
        <button 
          className={`tab-button ${activeTab === 'console' ? 'active' : ''}`}
          onClick={() => setActiveTab('console')}
        >
          <div className="tab-icon-wrapper"><ConsoleIcon /></div> <span>Console</span>
        </button>
        <button 
          className={`tab-button ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          <div className="tab-icon-wrapper"><NodeIcon /></div> <span>Node</span>
        </button>
        <button 
          className={`tab-button ${activeTab === 'permissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('permissions')}
        >
          <div className="tab-icon-wrapper"><SettingsIcon /></div> <span>Permissions</span>
        </button>
      </div>

      <main className="app-content">
        {activeTab === 'status' && (
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
        )}

        {activeTab === 'console' && <Console />}
        
        {activeTab === 'permissions' && (
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
        )}
      </main>

      <div className="status-container">
        <div className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
        <span className="status-text">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </div>
  )
}