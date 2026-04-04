import { useState, useCallback } from 'react'
import { discover } from './pipeline.js'
import styles from './App.module.css'

const EXAMPLE_QUERIES = [
  { label: '☕ Brooklyn', query: 'Top cafes in Brooklyn and the best coffee to order at each' },
  { label: '☕ Boston', query: 'Top specialty coffee shops in Boston and what to order' },
  { label: '☕ Seattle', query: 'Best cafes in Seattle and their signature coffee drinks' },
  { label: '☕ San Francisco', query: 'Best espresso drinks at top-rated cafes in San Francisco' },
  { label: '☕ Portland', query: 'Best cafes in Portland Oregon and the best coffee to order at each' },
  { label: '☕ Chicago', query: 'Top specialty coffee shops in Chicago and what to order' },
]

const PIPELINE_STAGES = [
  { id: 'parse', label: 'Parse query' },
  { id: 'search', label: 'Web search' },
  { id: 'extract', label: 'Extract entities' },
  { id: 'enrich', label: 'Enrich attributes' },
  { id: 'structure', label: 'Structure output' },
]

export default function App() {
  const [query, setQuery] = useState('Top cafes in Brooklyn and the best coffee to order at each')
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [logs, setLogs] = useState([])
  const [entities, setEntities] = useState([])
  const [activeStage, setActiveStage] = useState(null)
  const [completedStages, setCompletedStages] = useState([])
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState(null)
  const [tab, setTab] = useState('table')

  const addLog = (msg, type = 'info') => {
    setLogs((prev) => [...prev, { msg, type, ts: Date.now() }])
  }

  const advanceStage = (stageId) => {
    setActiveStage(stageId)
    setCompletedStages((prev) => {
      const idx = PIPELINE_STAGES.findIndex((s) => s.id === stageId)
      return PIPELINE_STAGES.slice(0, idx).map((s) => s.id)
    })
  }

  const runSearch = useCallback(async () => {
    if (!query.trim() || status === 'running') return

    setStatus('running')
    setLogs([])
    setEntities([])
    setError(null)
    setMeta(null)
    setCompletedStages([])
    setTab('table')

    const start = Date.now()

    try {
      advanceStage('parse')
      addLog(`Parsing query: "${query}"`)
      await new Promise((r) => setTimeout(r, 300))

      advanceStage('search')
      addLog('Initiating multi-stage web search pipeline...')

      const result = await discover(query, ({ stage, message }) => {
        if (stage === 'search') {
          advanceStage('search')
          addLog(message)
        } else if (stage === 'extract') {
          advanceStage('extract')
          addLog(message, 'ok')
        } else if (stage === 'done') {
          advanceStage('structure')
          addLog(message, 'ok')
        }
      })

      advanceStage('structure')
      setCompletedStages(PIPELINE_STAGES.map((s) => s.id))
      setActiveStage(null)

      addLog(`Successfully extracted ${result.entities.length} entities`, 'ok')
      if (result.cached) addLog('Result served from cache', 'warn')

      setEntities(result.entities)
      setMeta({
        count: result.entities.length,
        searches: result.searchCount,
        latencyMs: result.latencyMs || Date.now() - start,
        cached: result.cached,
      })
      setStatus('done')
    } catch (err) {
      console.error(err)
      setError(err.message)
      setStatus('error')
      setActiveStage(null)
    }
  }, [query, status])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(entities, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'entities.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportCsv = () => {
    const headers = ['cafe_name', 'neighborhood', 'website', 'signature_drink', 'drink_type', 'price_range', 'why_known', 'source_url', 'source_snippet', 'confidence']
    const rows = entities.map((e) => headers.map((h) => JSON.stringify(e[h] ?? '')).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'entities.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const stageState = (stageId) => {
    if (completedStages.includes(stageId)) return 'done'
    if (activeStage === stageId) return 'active'
    return 'idle'
  }

  return (
    <div className={styles.root}>
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroEyebrow}>Entity Discovery System</div>
        <h1 className={styles.heroTitle}>
          Find the best <span>cafes</span> &amp; what to order
        </h1>
        <p className={styles.heroSub}>Multi-stage AI pipeline: search → scrape → extract → structure</p>
      </div>

      {/* Search */}
      <div className={styles.searchSection}>
        <div className={styles.searchLabel}>Query</div>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="Top cafes in Brooklyn and the best coffee to order at each"
          />
          <button
            className={styles.searchBtn}
            onClick={runSearch}
            disabled={status === 'running'}
          >
            {status === 'running' ? (
              <><span className={styles.spinner} /> Searching...</>
            ) : 'Discover ↗'}
          </button>
        </div>
        <div className={styles.pillRow}>
          {EXAMPLE_QUERIES.map((ex) => (
            <button key={ex.label} className={styles.pill} onClick={() => setQuery(ex.query)}>
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline bar */}
      {status !== 'idle' && (
        <div className={styles.pipelineBar}>
          {PIPELINE_STAGES.map((stage, i) => (
            <>
              <div key={stage.id} className={`${styles.pipelineStep} ${styles['step-' + stageState(stage.id)]}`}>
                <span className={styles.stepDot} />
                <span>{stage.label}</span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <span key={`arrow-${i}`} className={styles.stepArrow}>›</span>
              )}
            </>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className={styles.main}>
        {/* Logs */}
        {logs.length > 0 && (
          <div className={styles.logCard}>
            <div className={styles.cardTitle}>Pipeline log</div>
            {logs.map((l, i) => (
              <div key={i} className={`${styles.logLine} ${l.type === 'ok' ? styles.logOk : l.type === 'warn' ? styles.logWarn : ''}`}>
                {l.msg}
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={styles.errorBanner}>⚠ {error}</div>
        )}

        {/* Results */}
        {entities.length > 0 && (
          <>
            <div className={styles.resultsHeader}>
              <div className={styles.resultsTitle}>Discovered entities</div>
              <div className={styles.resultsActions}>
                {meta && (
                  <span className={styles.resultsMeta}>
                    {meta.count} cafes · {meta.searches} searches · {(meta.latencyMs / 1000).toFixed(1)}s{meta.cached ? ' · cached' : ''}
                  </span>
                )}
                <button className={styles.exportBtn} onClick={exportJson}>Export JSON</button>
                <button className={styles.exportBtn} onClick={exportCsv}>Export CSV</button>
              </div>
            </div>

            <div className={styles.tabs}>
              <button
                className={`${styles.tabBtn} ${tab === 'table' ? styles.tabActive : ''}`}
                onClick={() => setTab('table')}
              >Table view</button>
              <button
                className={`${styles.tabBtn} ${tab === 'json' ? styles.tabActive : ''}`}
                onClick={() => setTab('json')}
              >JSON</button>
            </div>

            {tab === 'table' && <EntityTable entities={entities} />}
            {tab === 'json' && (
              <pre className={styles.jsonView}>{JSON.stringify(entities, null, 2)}</pre>
            )}
          </>
        )}

        {/* Empty state */}
        {status === 'idle' && entities.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>☕</div>
            <div className={styles.emptyTitle}>Enter a query to discover entities</div>
            <div className={styles.emptyBody}>
              Try: "Top cafes in Brooklyn and the best coffee to order at each"
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EntityTable({ entities }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Cafe</th>
            <th>Signature drink</th>
            <th>Type</th>
            <th>Price</th>
            <th>Why it's known</th>
            <th>Website</th>
            <th>Source &amp; evidence</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e, i) => (
            <tr key={i}>
              <td>
                <div className={styles.cafeName}>{e.cafe_name || '—'}</div>
                <div className={styles.neighborhood}>{e.neighborhood || ''}</div>
              </td>
              <td>
                <div className={styles.drinkBadge}>{e.signature_drink || '—'}</div>
              </td>
              <td>
                <div className={styles.drinkType}>{e.drink_type || '—'}</div>
              </td>
              <td>
                <div className={styles.price}>{e.price_range || '—'}</div>
              </td>
              <td>
                <div className={styles.whyText}>{e.why_known || '—'}</div>
              </td>
              <td>
                {e.website ? (
                  <a className={styles.websiteLink} href={e.website} target="_blank" rel="noopener noreferrer">
                    {e.website.replace(/^https?:\/\//, '').split('/')[0]}
                  </a>
                ) : <span className={styles.nil}>—</span>}
              </td>
              <td>
                {e.source_url && (
                  <a className={styles.sourceLink} href={e.source_url} target="_blank" rel="noopener noreferrer">
                    ↗ {e.source_url.replace(/^https?:\/\//, '').split('/')[0]}
                  </a>
                )}
                {e.source_snippet && (
                  <div className={styles.sourceSnippet}>{e.source_snippet}</div>
                )}
                <ConfidenceBadge level={e.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConfidenceBadge({ level }) {
  const cls = level === 'high' ? styles.confHigh : level === 'medium' ? styles.confMed : styles.confLow
  return <span className={`${styles.confBadge} ${cls}`}>{level || 'unknown'}</span>
}
