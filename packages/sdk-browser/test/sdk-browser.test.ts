import { describe, expect, test } from 'bun:test'
import { AgentArcadeBrowser } from '../src/index'

describe('sdk-browser', () => {
  test('falls back to HTTP emit payload', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    try {
      const sdk = AgentArcadeBrowser.init({
        url: 'http://localhost:8787',
        sessionId: 'browser-test',
        authToken: 'token-123',
        sessionSignature: 'sig-xyz',
      })
      sdk.disconnect()
      const id = sdk.spawn({ name: 'Browser Bot' })
      expect(id).toContain('agent_')

      await new Promise(r => setTimeout(r, 5))
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe('http://localhost:8787/v1/ingest')
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer token-123')
      expect((calls[0].init?.headers as Record<string, string>)['x-session-signature']).toBe('sig-xyz')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
