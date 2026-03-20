/**
 * Gateway Integration Tests
 *
 * Run with: bun test packages/gateway/test/gateway.test.ts
 * Requires the gateway to be running on localhost:47890
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { createHmac } from 'crypto'

let BASE = process.env.GATEWAY_URL || 'http://localhost:47890'
const TEST_SESSION = `test-session-${Date.now()}`
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN || ''
const API_KEY = process.env.GATEWAY_API_KEY || ''
const SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || process.env.GATEWAY_SESSION_SIGNING_SECRET || ''

/** Compute HMAC-SHA256 signature matching gateway checkSessionSignature() */
function sign(sessionId: string): string {
  if (!SIGNING_SECRET) return ''
  return createHmac('sha256', SIGNING_SECRET).update(sessionId).digest('hex')
}

async function canReach(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`)
    return res.ok
  } catch {
    return false
  }
}

function authHeaders(sessionId = TEST_SESSION): Record<string, string> {
  const sig = sign(sessionId)
  return {
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    ...(sig ? { 'x-session-signature': sig } : {}),
  }
}

function streamUrl(sessionId: string): string {
  const sig = sign(sessionId)
  let out = `${BASE}/v1/stream?sessionId=${encodeURIComponent(sessionId)}`
  if (AUTH_TOKEN) out += `&token=${encodeURIComponent(AUTH_TOKEN)}`
  if (API_KEY) out += `&apiKey=${encodeURIComponent(API_KEY)}`
  if (sig) out += `&sig=${encodeURIComponent(sig)}`
  return out
}

async function ingest(event: Record<string, unknown>) {
  // Use the sessionId from the event if provided; fall back to TEST_SESSION
  const sessionId = (typeof event.sessionId === 'string' ? event.sessionId : null) ?? TEST_SESSION
  const res = await fetch(`${BASE}/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(sessionId) },
    body: JSON.stringify({ sessionId, ...event }),
  })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeAll(async () => {
  if (await canReach(BASE)) return
  const fallback = 'http://localhost:47890'
  if (BASE !== fallback && await canReach(fallback)) {
    BASE = fallback
  }
})

// ── Health ────────────────────────────────────────────────────────────────────

describe('Health endpoint', () => {
  test('GET /health returns status ok', async () => {
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('ok')
  })
})

// ── CORS ──────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await fetch(`${BASE}/v1/ingest`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

// ── HTTP Ingest ──────────────────────────────────────────────────────────────

describe('HTTP Ingest', () => {
  test('POST /v1/ingest — valid agent.spawn', async () => {
    const { status, body } = await ingest({
      agentId: 'test-agent-1',
      type: 'agent.spawn',
      payload: { name: 'TestBot', role: 'tester' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('POST /v1/ingest — valid agent.state', async () => {
    const { status, body } = await ingest({
      agentId: 'test-agent-1',
      type: 'agent.state',
      payload: { state: 'thinking', label: 'Analyzing tests' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('POST /v1/ingest — valid agent.tool', async () => {
    const { status, body } = await ingest({
      agentId: 'test-agent-1',
      type: 'agent.tool',
      payload: { name: 'grep', label: 'Searching files' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('POST /v1/ingest — valid agent.message', async () => {
    const { status, body } = await ingest({
      agentId: 'test-agent-1',
      type: 'agent.message',
      payload: { text: 'Found 3 matches' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('POST /v1/ingest — valid agent.end', async () => {
    const { status, body } = await ingest({
      agentId: 'test-agent-1',
      type: 'agent.end',
      payload: { reason: 'Tests passed' },
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('rejects missing sessionId', async () => {
    const res = await fetch(`${BASE}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ agentId: 'x', type: 'agent.spawn', payload: {} }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('sessionId')
  })

  test('rejects missing agentId', async () => {
    const res = await fetch(`${BASE}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sessionId: 'x', type: 'agent.spawn', payload: {} }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects invalid event type', async () => {
    const { status, body } = await ingest({
      agentId: 'x',
      type: 'invalid.type',
      payload: {},
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Invalid event type')
  })

  test('rejects invalid JSON body', async () => {
    const res = await fetch(`${BASE}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('Invalid JSON')
  })
})

// ── SSE Stream ──────────────────────────────────────────────────────────────

describe('SSE Stream', () => {
  test('GET /v1/stream requires sessionId', async () => {
    const res = await fetch(`${BASE}/v1/stream`)
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('sessionId')
  })

  test('GET /v1/stream returns event-stream', async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      // Session signature must be in the ?sig= query param for SSE (not request header)
      const res = await fetch(streamUrl(TEST_SESSION), {
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    } finally {
      controller.abort()
      clearTimeout(timeout)
    }
  })

  test('SSE receives ingested events', async () => {
    const sseSession = `sse-test-${Date.now()}`
    const controller = new AbortController()

    // Start SSE connection — signature in ?sig= query param
    const res = await fetch(streamUrl(sseSession), {
      signal: controller.signal,
    })
    expect(res.status).toBe(200)

    // Give SSE time to establish
    await new Promise(r => setTimeout(r, 200))

    // Ingest an event — signature in x-session-signature header, signed for sseSession
    await fetch(`${BASE}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(sseSession) },
      body: JSON.stringify({
        sessionId: sseSession,
        agentId: 'sse-agent',
        type: 'agent.spawn',
        payload: { name: 'SSE Test' },
      }),
    })

    // Read some data from the stream
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No reader')

    const chunks: string[] = []
    const readTimeout = setTimeout(() => controller.abort(), 2000)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(new TextDecoder().decode(value))
        // We got data, stop reading
        if (chunks.join('').includes('agent.spawn')) break
      }
    } catch {
      // AbortError is expected
    } finally {
      clearTimeout(readTimeout)
      controller.abort()
    }

    const allData = chunks.join('')
    expect(allData).toContain('event:')
  })
})

// ── 404 ──────────────────────────────────────────────────────────────────────

describe('404 handling', () => {
  test('unknown paths return 404', async () => {
    const res = await fetch(`${BASE}/nonexistent`)
    expect(res.status).toBe(404)
  })
})

// ── Agent state validation via debug ─────────────────────────────────────────

describe('Agent state tracking', () => {
  const stateSession = `state-test-${Date.now()}`

  beforeAll(async () => {
    // Spawn an agent
    await ingest({ ...{ sessionId: stateSession }, agentId: 'state-agent', type: 'agent.spawn', payload: { name: 'StateBot', role: 'tester' } })
    // Change state
    await ingest({ ...{ sessionId: stateSession }, agentId: 'state-agent', type: 'agent.state', payload: { state: 'thinking', label: 'Pondering' } })
    // Use a tool
    await ingest({ ...{ sessionId: stateSession }, agentId: 'state-agent', type: 'agent.tool', payload: { name: 'search', label: 'Searching...' } })
    // End agent
    await ingest({ ...{ sessionId: stateSession }, agentId: 'state-agent', type: 'agent.end', payload: { reason: 'Done' } })
  })

  test('debug endpoint shows session data', async () => {
    const res = await fetch(`${BASE}/debug`, { headers: authHeaders() })
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      expect([401, 403, 404]).toContain(res.status)
      return
    }
    expect(res.status).toBe(200)
    const body = await res.json() as { sessions: Array<{ id: string }> }
    const session = body.sessions.find(s => s.id === stateSession)
    expect(session).toBeDefined()
  })
})

// ── All event types ─────────────────────────────────────────────────────────

describe('All valid event types accepted', () => {
  const allTypesSession = `all-types-${Date.now()}`

  const eventTypes = [
    { type: 'agent.spawn', payload: { name: 'Bot', role: 'helper' } },
    { type: 'agent.state', payload: { state: 'reading', label: 'Reading docs' } },
    { type: 'agent.tool', payload: { name: 'fetch', label: 'Fetching URL' } },
    { type: 'agent.message', payload: { text: 'Hello!' } },
    { type: 'agent.link', payload: { parentAgentId: 'parent-1', childAgentId: 'child-1' } },
    { type: 'agent.position', payload: { x: 5, y: 3 } },
    { type: 'agent.end', payload: { reason: 'Finished' } },
    { type: 'session.start', payload: {} },
    { type: 'session.end', payload: {} },
  ] as const

  for (const ev of eventTypes) {
    test(`accepts ${ev.type}`, async () => {
      const res = await fetch(`${BASE}/v1/ingest`, {
        method: 'POST',
        // Signature must match allTypesSession — not TEST_SESSION
        headers: { 'Content-Type': 'application/json', ...authHeaders(allTypesSession) },
        body: JSON.stringify({
          sessionId: allTypesSession,
          agentId: 'type-test-agent',
          type: ev.type,
          payload: ev.payload,
        }),
      })
      expect(res.status).toBe(200)
    })
  }
})
