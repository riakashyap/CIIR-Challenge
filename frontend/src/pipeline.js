/**
 pipeline.js
 Entity discovery pipeline, frontend client.
 *alls the FastAPI backend which runs:
 Brave Search (3 queries) and Groq LLM extraction and structured JSON
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

/**
  Calls POST /discover on the backend and returns structured entities.
  @param {string} query - The user's natural language query
  @param {function} onProgress - Optional callback({ stage, message })
  @returns {{ entities, searchQueries, searchCount, cached, latencyMs }}
 */
export async function discover(query, onProgress) {
  onProgress?.({ stage: 'search', message: 'Sending query to pipeline...' })

  const response = await fetch(`${API_BASE}/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, use_cache: true }),
  })

  if (!response.ok) {
    let detail = `Server error ${response.status}`
    try {
      const err = await response.json()
      detail = err.detail || detail
    } catch (_) {}
    throw new Error(detail)
  }

  const data = await response.json()

  onProgress?.({
    stage: 'extract',
    message: `Ran ${data.search_count} Brave searches. Extracting entities with Groq...`,
  })

  onProgress?.({
    stage: 'done',
    message: `Extracted ${data.entities.length} entities${data.cached ? ' (from cache)' : ''}`,
  })

  return {
    entities: data.entities,
    searchQueries: data.search_queries,
    searchCount: data.search_count,
    cached: data.cached,
    latencyMs: data.latency_ms,
  }
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/health`)
  return response.json()
}
