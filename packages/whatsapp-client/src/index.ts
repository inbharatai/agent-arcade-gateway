/**
 * @agent-arcade/whatsapp-client
 *
 * QR-code–based WhatsApp client for Agent Arcade.
 * Uses @whiskeysockets/baileys to connect your personal WhatsApp — no Twilio
 * account or paid API key needed. Just scan the QR code once and you can
 * control any agent from your phone.
 *
 * How it works:
 *   1. Start this process (or let the gateway start it via WHATSAPP_QR_MODE=1)
 *   2. Scan the QR code printed in the terminal (or shown on the dashboard)
 *   3. Send WhatsApp messages to control agents:
 *        pause SESSION AGENT
 *        resume SESSION AGENT
 *        stop SESSION AGENT
 *        redirect SESSION AGENT: new instruction here
 *        list SESSION
 *        help
 *
 * Usage (standalone):
 *   GATEWAY_URL=http://localhost:47890 bun run packages/whatsapp-client/src/index.ts
 *
 * Usage (gateway-integrated):
 *   Set WHATSAPP_QR_MODE=1 in packages/gateway/.env
 *   The gateway will spawn this process and expose:
 *     GET /v1/whatsapp/qr     → current QR code as a data URL (for dashboard)
 *     GET /v1/whatsapp/status → { status: 'qr' | 'connected' | 'disconnected', qr? }
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { toDataURL, toString as toSvg } from 'qrcode'
import { createServer } from 'http'
import { join } from 'path'
import pino from 'pino'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GATEWAY_URL    = process.env.GATEWAY_URL    || 'http://localhost:47890'
const AUTH_DIR       = process.env.WHATSAPP_AUTH_DIR || join(process.cwd(), '.whatsapp-auth')
const HTTP_PORT      = Number(process.env.WHATSAPP_CLIENT_PORT || '47891')
const GATEWAY_TOKEN  = process.env.WHATSAPP_GATEWAY_TOKEN || ''  // optional auth token

/** Phone numbers allowed to send control commands. Empty = allow all. */
const ALLOWED_NUMBERS = (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

const logger = pino({ level: 'warn' })

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type WAStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error'

let currentStatus: WAStatus = 'starting'
let currentQrDataUrl = ''   // base64 PNG data URL (for dashboard rendering)
let currentQrSvg     = ''   // SVG string (for terminal display)
let sock: WASocket | null = null

// ---------------------------------------------------------------------------
// Command parser — same commands as the Twilio webhook handler
// ---------------------------------------------------------------------------

async function handleCommand(from: string, text: string): Promise<string> {
  const trimmed = text.trim()
  const firstSpace = trimmed.indexOf(' ')
  const cmd  = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase()
  const rest  = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()

  // Auth guard: if WHATSAPP_ALLOWED_NUMBERS is set, only those numbers can control
  if (ALLOWED_NUMBERS.length > 0) {
    const normalized = from.replace('@s.whatsapp.net', '').replace('whatsapp:', '')
    if (!ALLOWED_NUMBERS.some(n => normalized.endsWith(n.replace('+', '')))) {
      return '🚫 Your number is not authorized to control this Arcade session.'
    }
  }

  if (cmd === 'help' || trimmed === '') {
    return (
      '🎮 Agent Arcade — WhatsApp Control\n\n' +
      'Commands:\n' +
      '  pause SESSION AGENT\n' +
      '  resume SESSION AGENT\n' +
      '  stop SESSION AGENT\n' +
      '  redirect SESSION AGENT: instruction\n' +
      '  list SESSION\n' +
      '  status SESSION\n' +
      '  help'
    )
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (GATEWAY_TOKEN) headers['Authorization'] = `Bearer ${GATEWAY_TOKEN}`

  // ── list / status ──────────────────────────────────────────────────────────
  if (cmd === 'list' || cmd === 'status') {
    const sessionId = rest.split(/\s+/)[0]
    if (!sessionId) return 'Usage: list SESSION or status SESSION'
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/session/${encodeURIComponent(sessionId)}/agents`, { headers })
      if (!res.ok) return `Error: gateway returned ${res.status}`
      const data = await res.json() as { agents: Array<{ name: string; id: string; state: string; label?: string }>; count: number }
      if (data.count === 0) return `No agents found in session "${sessionId}"`
      const lines = data.agents.map(a =>
        `• ${a.name} (${a.id.slice(0, 8)}) — ${a.state}${a.label ? `: ${a.label.slice(0, 50)}` : ''}`
      )
      return `📊 Session ${sessionId} — ${data.count} agent(s):\n${lines.join('\n')}`
    } catch (e) {
      return `Error contacting gateway: ${e}`
    }
  }

  // ── pause / resume / stop ──────────────────────────────────────────────────
  if (cmd === 'pause' || cmd === 'resume' || cmd === 'stop') {
    const parts = rest.split(/\s+/)
    const sessionId = parts[0]
    const agentId   = parts[1]
    if (!sessionId || !agentId) return `Usage: ${cmd} SESSION AGENT`

    try {
      const res = await fetch(
        `${GATEWAY_URL}/v1/agents/${encodeURIComponent(sessionId)}/${encodeURIComponent(agentId)}/${cmd}`,
        { method: 'POST', headers }
      )
      if (res.status === 404) return `Agent "${agentId}" not found in session "${sessionId}"`
      if (res.status === 429) return `Rate limited — please wait before sending more commands`
      if (!res.ok) return `Error: gateway returned ${res.status}`
      const emoji = cmd === 'pause' ? '⏸' : cmd === 'resume' ? '▶️' : '⏹'
      return `${emoji} Agent ${agentId} ${cmd}d in session ${sessionId}`
    } catch (e) {
      return `Error contacting gateway: ${e}`
    }
  }

  // ── redirect ───────────────────────────────────────────────────────────────
  if (cmd === 'redirect') {
    const colonIdx = rest.indexOf(':')
    if (colonIdx === -1) return 'Usage: redirect SESSION AGENT: instruction text'
    const agentPart   = rest.slice(0, colonIdx).trim()
    const instruction = rest.slice(colonIdx + 1).trim()
    const parts = agentPart.split(/\s+/)
    const sessionId = parts[0]
    const agentId   = parts[1]
    if (!sessionId || !agentId || !instruction) return 'Usage: redirect SESSION AGENT: instruction text'

    try {
      const res = await fetch(
        `${GATEWAY_URL}/v1/agents/${encodeURIComponent(sessionId)}/${encodeURIComponent(agentId)}/redirect`,
        { method: 'POST', headers, body: JSON.stringify({ instruction }) }
      )
      if (res.status === 404) return `Agent "${agentId}" not found in session "${sessionId}"`
      if (!res.ok) return `Error: gateway returned ${res.status}`
      return `↪️ Redirected agent ${agentId}:\n"${instruction.slice(0, 120)}"`
    } catch (e) {
      return `Error contacting gateway: ${e}`
    }
  }

  return `❓ Unknown command: "${cmd}"\n\nSend *help* for a list of commands.`
}

// ---------------------------------------------------------------------------
// QR HTTP server — serves QR code and status for the dashboard
// ---------------------------------------------------------------------------

function startHttpServer() {
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({
        status: currentStatus,
        qr: currentStatus === 'qr' ? currentQrDataUrl : undefined,
        gatewayUrl: GATEWAY_URL,
      }))
      return
    }

    if (req.method === 'GET' && req.url === '/qr.png') {
      if (currentStatus !== 'qr' || !currentQrDataUrl) {
        res.writeHead(204, cors)
        res.end()
        return
      }
      // Strip "data:image/png;base64," prefix
      const b64 = currentQrDataUrl.replace(/^data:image\/png;base64,/, '')
      const buf = Buffer.from(b64, 'base64')
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length), ...cors })
      res.end(buf)
      return
    }

    if (req.method === 'GET' && req.url === '/qr.svg') {
      if (currentStatus !== 'qr' || !currentQrSvg) {
        res.writeHead(204, cors)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', ...cors })
      res.end(currentQrSvg)
      return
    }

    res.writeHead(404, cors)
    res.end('Not found')
  })

  server.listen(HTTP_PORT, () => {
    console.log(`[whatsapp-client] QR server listening on http://localhost:${HTTP_PORT}`)
    console.log(`[whatsapp-client] Status: GET http://localhost:${HTTP_PORT}/status`)
    console.log(`[whatsapp-client] QR PNG:  GET http://localhost:${HTTP_PORT}/qr.png`)
  })
}

// ---------------------------------------------------------------------------
// Baileys WhatsApp connection
// ---------------------------------------------------------------------------

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,  // Always print to terminal for CLI use
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  })

  // ── QR code event ──────────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      currentStatus = 'qr'
      try {
        currentQrDataUrl = await toDataURL(qr, { width: 300, margin: 2 })
        currentQrSvg     = await toSvg(qr, { type: 'svg', margin: 2 } as any)
      } catch {
        currentQrDataUrl = ''
        currentQrSvg     = ''
      }
      console.log('\n[whatsapp-client] ═══════════════════════════════════════')
      console.log('[whatsapp-client] Scan the QR code above with WhatsApp:')
      console.log('[whatsapp-client]   1. Open WhatsApp on your phone')
      console.log('[whatsapp-client]   2. Go to Settings → Linked Devices')
      console.log('[whatsapp-client]   3. Tap "Link a Device" and scan')
      console.log('[whatsapp-client] Or open the Arcade dashboard Settings →')
      console.log(`[whatsapp-client] WhatsApp tab to scan from the browser.`)
      console.log('[whatsapp-client] ═══════════════════════════════════════\n')
    }

    if (connection === 'open') {
      currentStatus    = 'connected'
      currentQrDataUrl = ''
      currentQrSvg     = ''
      console.log('[whatsapp-client] ✅ WhatsApp connected! Send "help" to start.')
    }

    if (connection === 'close') {
      currentStatus = 'disconnected'
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = reason !== DisconnectReason.loggedOut

      console.log(`[whatsapp-client] Connection closed (reason: ${reason}), reconnecting: ${shouldReconnect}`)

      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(), 3000)
      } else {
        console.log('[whatsapp-client] Logged out — delete .whatsapp-auth/ and restart to re-pair')
        currentStatus = 'error'
      }
    }
  })

  // ── Credential save ────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds)

  // ── Incoming messages ──────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue  // ignore own messages

      const from = msg.key.remoteJid || ''
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''
      ).trim()

      if (!text) continue

      console.log(`[whatsapp-client] Message from ${from}: ${text.slice(0, 100)}`)

      // Compose reply
      const reply = await handleCommand(from, text)

      try {
        await sock!.sendMessage(from, { text: reply })
      } catch (e) {
        console.warn(`[whatsapp-client] Failed to send reply: ${e}`)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Exports (for gateway integration)
// ---------------------------------------------------------------------------

/** Get the current connection status and QR data URL */
export function getStatus(): { status: WAStatus; qr?: string } {
  return {
    status: currentStatus,
    qr: currentStatus === 'qr' ? currentQrDataUrl : undefined,
  }
}

/** Disconnect and clear session */
export async function disconnect(): Promise<void> {
  if (sock) {
    await sock.logout()
    sock = null
  }
  currentStatus    = 'disconnected'
  currentQrDataUrl = ''
}

export { handleCommand }

// ---------------------------------------------------------------------------
// Main — run standalone
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log('[whatsapp-client] Starting Agent Arcade WhatsApp client...')
  console.log(`[whatsapp-client] Gateway: ${GATEWAY_URL}`)
  console.log(`[whatsapp-client] Auth dir: ${AUTH_DIR}`)
  if (ALLOWED_NUMBERS.length > 0) {
    console.log(`[whatsapp-client] Allowed numbers: ${ALLOWED_NUMBERS.join(', ')}`)
  }

  startHttpServer()
  startWhatsApp().catch(e => {
    console.error('[whatsapp-client] Fatal error:', e)
    process.exit(1)
  })
}
