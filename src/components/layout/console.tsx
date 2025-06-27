
import { useState }  from 'react'
import { TrashIcon } from '@/components/util/icons.js'
import { useLogger } from '@/hooks/useLogger.js'

export function ConsoleView () {
  const logger = useLogger()
  
  const [ expandedIdx, setExpandedIdx ] = useState<Record<number, boolean>>({})

  const toggle_expand = (idx: number) => {
    setExpandedIdx(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  // Clear logs handler
  const clear_logs = async () => {
    logger.clear()
    setExpandedIdx({})
  }

  return (
    <div className="container">
      <div className="console-container">

        <div className="console-header-controls">
          <h2 className="section-header">
            Event Log <span className="event-count">({logger.data.length} events)</span>
          </h2>
          <button className="button clear-button" onClick={clear_logs} title="Clear logs">
            <TrashIcon />
          </button>
        </div>

        <p className="description">Monitor events from your node.</p>
        
        <div className="console-output">
          {logger.data.length === 0 ? (
            <div className="console-empty">No events logged yet</div>
          ) : (
            logger.data.map((log, idx) => (
              <div key={idx} className={`console-entry ${log.payload ? 'expandable' : ''}`}>
                <div className="entry-header" onClick={() => log.payload && toggle_expand(idx)}>
                  <div className="entry-prefix">
                    {log.payload && (
                      <span className={`chevron ${expandedIdx[idx] ? 'expanded' : ''}`}>
                        {expandedIdx[idx] ? '▼' : '▶'}
                      </span>
                    )}
                    <span className="console-timestamp">
                      {new Date(log.stamp).toLocaleTimeString()}
                    </span>
                    {log.type && <span className={`console-badge console-type-${log.type.toLowerCase()}`}>{log.type}</span>}
                  </div>
                  <span className={`console-message`}>{log.message}</span>
                </div>
                {log.payload && expandedIdx[idx] && (
                  <div className="console-payload">
                    <pre>{JSON.stringify(log.payload, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
