import { useState }  from 'react'
import { Dashboard } from '@/components/dash/index.js'
import { Sessions }  from '@/components/sessions/index.js'
import { Settings }  from '@/components/settings/index.js'

import type { ReactElement } from 'react'

import * as Icons from '@/components/util/icons.js'

export function Tabs(): ReactElement {
  const [ activeTab, setActiveTab ] = useState('dashboard')

  return (
    <div className="tabs-container">
      <div className="tabs-nav-wrapper">

        <div className="tabs-navigation">
          <button 
            className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Icons.ConsoleIcon />
            <span>Dashboard</span>
          </button>

          <button 
            className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <Icons.SessionsIcon />
            <span>Sessions</span>
          </button>

          <button
            className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Icons.SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>

      <div className="tab-content">
        {activeTab === 'dashboard' && (
          <div className="tab-panel">
            <Dashboard />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="tab-panel">
            <Sessions />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-panel">
            <Settings />
          </div>
        )}
      </div>
    </div>
  )
}
