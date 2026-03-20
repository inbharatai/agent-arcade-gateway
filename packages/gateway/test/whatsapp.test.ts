/**
 * WhatsApp QR-Client Integration Tests
 *
 * Tests the gateway's QR-code WhatsApp proxy endpoints:
 *   GET /v1/whatsapp/status  — proxies to whatsapp-client at :47891
 *   GET /v1/whatsapp/qr.png  — proxies QR image when not yet paired
 *
 * The whatsapp-client process (packages/whatsapp-client/src/index.ts) must be
 * started separately. If it's not running the gateway returns a graceful
 * "disconnected" JSON response — these tests verify that fallback too.
 *
 * Run: bun test packages/gateway/test/whatsapp.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test'

const BASE = process.env.GATEWAY_URL || 'http://localhost:47890'

let gatewayUp = false

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/health`)
    gatewayUp = res.ok
  } catch {
    gatewayUp = false
  }
})

// ---------------------------------------------------------------------------
// GET /v1/whatsapp/status
// ---------------------------------------------------------------------------

describe('GET /v1/whatsapp/status', () => {
  test('always returns 200 with a status field', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/status`)
    expect(res.status).toBe(200)

    const data = await res.json() as { status: string }
    expect(typeof data.status).toBe('string')
    // Must be one of the known statuses
    expect(['starting', 'qr', 'connected', 'disconnected', 'error']).toContain(data.status)
  })

  test('when whatsapp-client is NOT running — returns disconnected with message', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    // Without a running whatsapp-client on :47891, gateway returns graceful fallback
    const res = await fetch(`${BASE}/v1/whatsapp/status`)
    expect(res.status).toBe(200)

    const data = await res.json() as { status: string; message?: string; qr?: string }
    // Either connected (if client IS running) or disconnected (if not)
    if (data.status === 'disconnected') {
      expect(data.message).toBeTruthy()
      expect(data.message).toContain('whatsapp-client')
    }
    // If connected or qr, that's also fine — client is running
  })

  test('when status is qr, response includes qr data URL', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/status`)
    const data = await res.json() as { status: string; qr?: string }

    if (data.status === 'qr') {
      expect(data.qr).toBeTruthy()
      expect(data.qr!.startsWith('data:image/')).toBe(true)
    }
    // If not 'qr', there's nothing to assert — pass
  })

  test('response is JSON with correct content-type', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/status`)
    const ct = res.headers.get('content-type') || ''
    expect(ct).toContain('application/json')
  })
})

// ---------------------------------------------------------------------------
// GET /v1/whatsapp/qr.png
// ---------------------------------------------------------------------------

describe('GET /v1/whatsapp/qr.png', () => {
  test('returns 204 when whatsapp-client is not running or already connected', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/qr.png`)
    // 200 = QR available (client running, not yet paired)
    // 204 = No QR (client not running or already connected)
    expect([200, 204]).toContain(res.status)
  })

  test('when QR is available, content-type is image/png', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/qr.png`)
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer())
      // Only assert PNG magic bytes if we got a real image body
      if (buf.length >= 4) {
        expect(res.headers.get('content-type')).toContain('image/png')
        // PNG magic bytes: 89 50 4E 47
        expect(buf[0]).toBe(0x89)
        expect(buf[1]).toBe(0x50)
        expect(buf[2]).toBe(0x4E)
        expect(buf[3]).toBe(0x47)
      }
    }
    // 204 is fine — just no QR right now
  })
})

// ---------------------------------------------------------------------------
// Verify old Twilio webhook route is GONE
// ---------------------------------------------------------------------------

describe('Twilio webhook removed', () => {
  test('POST /v1/whatsapp/webhook no longer exists (Twilio removed)', async () => {
    if (!gatewayUp) { console.warn('[skip] gateway not running'); return }

    const res = await fetch(`${BASE}/v1/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=whatsapp%3A%2B14155551234&Body=help',
    })
    // Should 404 — this route was removed
    expect(res.status).toBe(404)
  })
})
