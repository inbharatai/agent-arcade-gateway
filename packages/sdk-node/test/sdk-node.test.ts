import { describe, expect, test } from 'bun:test'
import { AgentArcade } from '../src/index'

describe('sdk-node', () => {
  test('spawn emits HTTP fallback with auth headers when disconnected', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    try {
      const sdk = new AgentArcade({
        url: 'http://localhost:47890',
        sessionId: 'sdk-test',
        authToken: 'token-123',
        sessionSignature: 'sig-xyz',
        autoConnect: false,
      })

      const id = sdk.spawn({ name: 'Tester' })
      expect(id).toContain('agent_')

      await new Promise(r => setTimeout(r, 5))
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe('http://localhost:47890/v1/ingest')
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer token-123')
      expect((calls[0].init?.headers as Record<string, string>)['x-session-signature']).toBe('sig-xyz')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
