import { useEffect, useState } from 'react'

import { MessageClient } from '@/bus/client.js'
import { MESSAGE }       from '@/const.js'

import './styles/global.css'

export default function App() {
  const [connected, setConnected] = useState(false)

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
      <h1>Service Worker Status</h1>
      <p>Status: {connected ? 'Connected' : 'disconnected'}</p>
      {connected && (
        <button onClick={handleDisconnect}>
          Disconnect
        </button>
      )}
    </div>
  )
}