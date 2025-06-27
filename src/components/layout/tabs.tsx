import { useState }      from 'react'
import { DashboardView } from '@/components/dash/index.js'
import { SessionsView }  from '@/components/sessions/index.js'
import { SettingsView }  from '@/components/settings/index.js'

import type { ReactElement } from 'react'

import * as Icons from '@/components/util/icons.js'
import { RequestsView } from '../requests'

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
            className={`tab-button ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            <Icons.NodeIcon />
            <span>Requests</span>
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
            <DashboardView />
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="tab-panel">
            <RequestsView />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="tab-panel">
            <SessionsView />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-panel">
            <SettingsView />
          </div>
        )}
      </div>
    </div>
  )
}
