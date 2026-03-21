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
import { createHmac } from 'crypto'
import pino from 'pino'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GATEWAY_URL    = process.env.GATEWAY_URL    || 'http://localhost:47890'
const AUTH_DIR       = process.env.WHATSAPP_AUTH_DIR || join(process.cwd(), '.whatsapp-auth')
const HTTP_PORT      = Number(process.env.WHATSAPP_CLIENT_PORT || '47891')
const GATEWAY_TOKEN  = process.env.WHATSAPP_GATEWAY_TOKEN || ''  // optional auth token
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || '' // HMAC-SHA256 session signing

/** Phone numbers allowed to send control commands. Empty = allow all. */
const ALLOWED_NUMBERS = (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

/** Enable self-chat AI relay: message yourself → AI response → reply back */
const SELF_CHAT_ENABLED = process.env.WHATSAPP_SELF_CHAT !== '0'  // enabled by default

/** Max conversation history kept per self-chat session */
const SELF_CHAT_MAX_HISTORY = 20

/** Max number of concurrent self-chat conversations kept in memory */
const SELF_CHAT_MAX_CONVERSATIONS = 50

const logger = pino({ level: 'warn' })

/** Compute HMAC-SHA256 session signature matching gateway checkSessionSignature() */
function signSession(sessionId: string): string {
  if (!SESSION_SIGNING_SECRET) return ''
  return createHmac('sha256', SESSION_SIGNING_SECRET).update(sessionId).digest('hex')
}

/** Build gateway request headers with auth token + session signature */
function gwHeaders(sessionId = 'copilot-live'): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (GATEWAY_TOKEN) h['Authorization'] = `Bearer ${GATEWAY_TOKEN}`
  const sig = signSession(sessionId)
  if (sig) h['x-session-signature'] = sig
  return h
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type WAStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error'

let currentStatus: WAStatus = 'starting'
let currentQrDataUrl = ''   // base64 PNG data URL (for dashboard rendering)
let currentQrSvg     = ''   // SVG string (for terminal display)
let sock: WASocket | null = null

/** Per-JID conversation history for self-chat AI relay */
const selfChatHistory = new Map<string, Array<{ role: string; content: string }>>()

/** Message IDs sent by the bot — used to suppress echo in messages.upsert */
const outgoingMessageIds = new Set<string>()

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
    const normalized = from.replace('@s.whatsapp.net', '').replace('whatsapp:', '').replace('+', '')
    if (!ALLOWED_NUMBERS.some(n => normalized === n.replace('+', ''))) {
      return '🚫 Your number is not authorized to control this Arcade session.'
    }
  }

  if (cmd === 'help' || trimmed === '') {
    return (
      '🎮 Agent Arcade — WhatsApp Control\n\n' +
      '💬 *Self-Chat AI*: Message yourself to chat with AI!\n' +
      '  Just type anything — it goes straight to your AI.\n' +
      '  /clear — reset conversation\n\n' +
      'Agent Commands (from any chat):\n' +
      '  pause SESSION AGENT\n' +
      '  resume SESSION AGENT\n' +
      '  stop SESSION AGENT\n' +
      '  redirect SESSION AGENT: instruction\n' +
      '  list SESSION\n' +
      '  status SESSION\n' +
      '  help'
    )
  }

  // ── list / status ──────────────────────────────────────────────────────────
  if (cmd === 'list' || cmd === 'status') {
    const sessionId = rest.split(/\s+/)[0]
    if (!sessionId) return 'Usage: list SESSION or status SESSION'
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/session/${encodeURIComponent(sessionId)}/agents`, { headers: gwHeaders(sessionId) })
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
        { method: 'POST', headers: gwHeaders() }
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
        { method: 'POST', headers: gwHeaders(), body: JSON.stringify({ instruction }) }
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
// Self-chat AI relay — message yourself to chat with AI
// ---------------------------------------------------------------------------

async function handleSelfChat(jid: string, text: string): Promise<string> {
  // Special commands still work in self-chat
  const lower = text.trim().toLowerCase()
  if (lower === 'help' || lower === '/help') {
    return handleCommand(jid, 'help')
  }
  if (lower === '/clear' || lower === '/reset') {
    selfChatHistory.delete(jid)
    return '🗑️ Conversation cleared. Send any message to start fresh.'
  }
  if (lower.startsWith('pause ') || lower.startsWith('resume ') || lower.startsWith('stop ') ||
      lower.startsWith('redirect ') || lower.startsWith('list ') || lower.startsWith('status ')) {
    return handleCommand(jid, text)
  }

  // Build conversation history
  let history = selfChatHistory.get(jid) || []
  history.push({ role: 'user', content: text })

  // Trim to max history
  if (history.length > SELF_CHAT_MAX_HISTORY) {
    history = history.slice(history.length - SELF_CHAT_MAX_HISTORY)
  }
  selfChatHistory.set(jid, history)
  if (selfChatHistory.size > SELF_CHAT_MAX_CONVERSATIONS) {
    const oldest = selfChatHistory.keys().next().value
    if (oldest && oldest !== jid) selfChatHistory.delete(oldest)
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/sync`, {
      method: 'POST',
      headers: gwHeaders(),
      body: JSON.stringify({ messages: history }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
      return `⚠️ AI error: ${errBody.error || `HTTP ${res.status}`}`
    }

    const data = await res.json() as { reply: string; provider?: string; model?: string }
    const reply = data.reply?.trim()

    if (!reply) return '⚠️ Empty response from AI'

    // Save assistant response to history
    history.push({ role: 'assistant', content: reply })
    if (history.length > SELF_CHAT_MAX_HISTORY) {
      history = history.slice(history.length - SELF_CHAT_MAX_HISTORY)
    }
    selfChatHistory.set(jid, history)
    if (selfChatHistory.size > SELF_CHAT_MAX_CONVERSATIONS) {
      const oldest = selfChatHistory.keys().next().value
      if (oldest && oldest !== jid) selfChatHistory.delete(oldest)
    }

    return reply
  } catch (e) {
    const msg = String(e)
    if (msg.includes('timeout') || msg.includes('Timeout')) {
      return '⏱️ AI response timed out. Try a shorter question.'
    }
    return `⚠️ Error reaching AI: ${msg.slice(0, 150)}`
  }
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
      try {
        const b64 = currentQrDataUrl.replace(/^data:image\/png;base64,/, '')
        const buf = Buffer.from(b64, 'base64')
        res.writeHead(200, { ...cors, 'Content-Type': 'image/png', 'Content-Length': String(buf.length) })
        res.end(buf)
      } catch {
        res.writeHead(500, cors)
        res.end('QR generation error')
      }
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
      console.log('[whatsapp-client] ✅ WhatsApp connected! Message yourself to chat with AI, or send "help" for commands.')

      // Register WhatsApp relay agent in the Arcade
      fetch(`${GATEWAY_URL}/v1/ingest`, {
        method: 'POST', headers: gwHeaders(),
        body: JSON.stringify({ v: 1, ts: Date.now(), sessionId: 'copilot-live', agentId: 'whatsapp-relay',
          type: 'agent.spawn', payload: { name: '📱 WhatsApp', role: 'relay', characterClass: 'healer',
            task: 'WhatsApp message relay — self-chat AI', aiModel: 'Claude (via gateway)' } }),
      }).catch(() => {})

      // Start SSE listener to forward Console messages to WhatsApp
      startSSEListener()
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
    console.log(`[whatsapp-client] messages.upsert type=${type} count=${messages.length}`)
    // Accept both 'notify' (real-time) and 'append' (self-chat on newer WhatsApp)
    if (type !== 'notify' && type !== 'append') return

    for (const msg of messages) {
      if (!msg.message) continue

      const from = msg.key.remoteJid || ''
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''
      ).trim()

      if (!text) continue

      // ── Early echo guard ─────────────────────────────────────────────────
      // Catches bot-sent messages before isSelfChat detection runs, so Baileys
      // fromMe=false edge cases (some WA versions) cannot cause echo loops.
      // outgoingMessageIds is checked here (not just inside the isSelfChat block)
      // to avoid a race: Baileys fires messages.upsert before the sendMessage
      // Promise resolves, so the ID might not be in the set yet at line 474.
      if (
        outgoingMessageIds.has(msg.key.id || '') ||
        text.startsWith('🎮 Console:') ||
        text.startsWith('⏱️ AI response timed out') ||
        text.startsWith('⚠️ AI error:') ||
        text.startsWith('⚠️ Error reaching AI:') ||
        text.startsWith('⚠️ Empty response from AI')
      ) {
        console.log(`[whatsapp-client] Skipping bot-generated message (early echo guard): ${text.slice(0, 60)}`)
        continue
      }

      // ── Self-chat detection ──────────────────────────────────────────────
      // In WhatsApp, messaging yourself shows remoteJid === your own JID
      // and fromMe is true for messages you send to yourself.
      // Some WhatsApp versions set participant instead of remoteJid for self-chat.
      const rawJid = sock?.user?.id
      if (!rawJid) continue  // socket not ready yet
      const myJid = rawJid.replace(/:.*@/, '@')
      const myNumber = rawJid.split(':')[0].split('@')[0]
      const fromNumber = from.split(':')[0].split('@')[0]
      // Also check the LID (Linked ID) — newer WhatsApp uses @lid JIDs for self-chat
      const myLid = (sock?.user as any)?.lid || ''

      // Debug: log all incoming messages so we can diagnose routing
      console.log(`[whatsapp-client] MSG: from=${from} fromMe=${msg.key.fromMe} myJid=${myJid} rawJid=${rawJid} myNum=${myNumber} fromNum=${fromNumber} myLid=${myLid} text=${text.slice(0, 60)}`)

      // Self-chat detection: match by JID, phone number, or LID
      const jidMatch = from === myJid || from === rawJid || fromNumber === myNumber
      const lidMatch = from.endsWith('@lid') && (from === myLid || msg.key.fromMe === true)
      const isSelfChat = (jidMatch || lidMatch)
        && (msg.key.fromMe !== false) // fromMe can be true or undefined for self-chat

      if (msg.key.fromMe && !isSelfChat) continue  // ignore own messages to others

      if (isSelfChat && SELF_CHAT_ENABLED) {
        // Skip messages sent by the BOT itself to prevent echo loops.
        // We rely on outgoingMessageIds (tracks IDs of messages the bot sends)
        // and known bot text prefixes. We do NOT use fromMe here because in
        // self-chat, both user-typed AND bot-sent messages have fromMe=true.
        if (outgoingMessageIds.has(msg.key.id || '')) {
          console.log(`[whatsapp-client] Skipping bot-sent message (ID matched outgoingMessageIds)`)
          continue
        }
        // Text-prefix guard for bot responses that slipped past the ID check
        // (e.g., if Baileys fires upsert before sendMessage resolves)
        if (
          text.startsWith('🎮 Console:') ||
          text.startsWith('⏱️ AI response timed out') ||
          text.startsWith('⚠️ AI error:') ||
          text.startsWith('⚠️ Error reaching AI:') ||
          text.startsWith('⚠️ Empty response from AI')
        ) {
          console.log(`[whatsapp-client] Skipping bot-prefixed message to prevent echo loop`)
          continue
        }

        console.log(`[whatsapp-client] Self-chat from ${fromNumber}: ${text.slice(0, 100)}`)

        // Fire telemetry so the Arcade shows WhatsApp activity
        const ts = Date.now()
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers: gwHeaders(),
          body: JSON.stringify({ v: 1, ts, sessionId: 'copilot-live', agentId: 'whatsapp-relay',
            type: 'agent.state', payload: { state: 'thinking', label: `WhatsApp: ${text.slice(0, 80)}` } }),
        }).catch(() => {})
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers: gwHeaders(),
          body: JSON.stringify({ v: 1, ts: ts + 50, sessionId: 'copilot-live', agentId: 'whatsapp-relay',
            type: 'agent.message', payload: { text: `WhatsApp command: ${text.slice(0, 120)}` } }),
        }).catch(() => {})

        // Also push as a directive so connected tools can execute it
        fetch(`${GATEWAY_URL}/v1/directives`, {
          method: 'POST', headers: gwHeaders(),
          body: JSON.stringify({ instruction: text, source: 'whatsapp-self-chat' }),
        }).catch(() => {})

        const reply = await handleSelfChat(from, text)

        // Fire done telemetry
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers: gwHeaders(),
          body: JSON.stringify({ v: 1, ts: Date.now(), sessionId: 'copilot-live', agentId: 'whatsapp-relay',
            type: 'agent.state', payload: { state: 'idle', label: 'Response sent' } }),
        }).catch(() => {})

        // Broadcast the AI reply to the Console via SSE so it appears in chat
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers: gwHeaders(),
          body: JSON.stringify({ v: 1, ts: Date.now(), sessionId: 'copilot-live', agentId: 'whatsapp-relay',
            type: 'agent.message', payload: { text: reply.slice(0, 2000), source: 'whatsapp-ai-response' } }),
        }).catch(() => {})

        try {
          const sentMsg = await sock!.sendMessage(from, { text: reply })
          if (sentMsg?.key?.id) {
            outgoingMessageIds.add(sentMsg.key.id)
            // Clean up after 60s to avoid unbounded growth
            setTimeout(() => outgoingMessageIds.delete(sentMsg!.key.id!), 60_000)
          }
          console.log(`[whatsapp-client] Reply sent to ${from.slice(0,6)}...`)
        } catch (e: any) {
          const errMsg = e?.message || String(e)
          if (errMsg.includes('rate')) {
            console.warn(`[whatsapp-client] Rate limited, will retry: ${errMsg}`)
          } else if (errMsg.includes('not connected') || errMsg.includes('Connection')) {
            console.error(`[whatsapp-client] Connection lost: ${errMsg}`)
          } else {
            console.warn(`[whatsapp-client] Failed to send self-chat reply: ${errMsg}`)
          }
        }
        continue
      }

      // ── Regular incoming messages (from others) ──────────────────────────
      if (msg.key.fromMe) continue

      console.log(`[whatsapp-client] Message from ${from}: ${text.slice(0, 100)}`)

      const reply = await handleCommand(from, text)

      try {
        await sock!.sendMessage(from, { text: reply })
        console.log(`[whatsapp-client] Reply sent to ${from.slice(0,6)}...`)
      } catch (e: any) {
        const errMsg = e?.message || String(e)
        if (errMsg.includes('rate')) {
          console.warn(`[whatsapp-client] Rate limited, will retry: ${errMsg}`)
        } else if (errMsg.includes('not connected') || errMsg.includes('Connection')) {
          console.error(`[whatsapp-client] Connection lost: ${errMsg}`)
        } else {
          console.warn(`[whatsapp-client] Failed to send reply: ${errMsg}`)
        }
      }
    }
  })
}

// ---------------------------------------------------------------------------
// SSE listener — forward Console/tool responses to WhatsApp self-chat
// ---------------------------------------------------------------------------

let sseAbortController: AbortController | null = null

function startSSEListener() {
  if (sseAbortController) sseAbortController.abort()
  sseAbortController = new AbortController()

  const sseSig = signSession('copilot-live')
  const sseUrl = `${GATEWAY_URL}/v1/stream?sessionId=copilot-live${sseSig ? `&sig=${sseSig}` : ''}`
  console.log(`[whatsapp-client] Connecting SSE listener to ${sseUrl.replace(/sig=[^&]+/, 'sig=***')}`)

  const sseHeaders: Record<string, string> = { Accept: 'text/event-stream' }
  if (GATEWAY_TOKEN) sseHeaders['Authorization'] = `Bearer ${GATEWAY_TOKEN}`

  fetch(sseUrl, { headers: sseHeaders, signal: sseAbortController.signal })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        console.warn(`[whatsapp-client] SSE connection failed: HTTP ${res.status}`)
        setTimeout(startSSEListener, 5000) // retry
        return
      }
      console.log(`[whatsapp-client] SSE connected — forwarding Console messages to WhatsApp`)

      const decoder = new TextDecoder()
      let buffer = ''

      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            // Only forward chat-proxy messages (Console chat responses) to WhatsApp
            // Skip messages originating from WhatsApp to avoid echo loops
            if (ev.type === 'agent.message' &&
                ev.payload?.source === 'chat-proxy' &&
                ev.payload?.text &&
                !ev.payload.text.startsWith('WhatsApp command:')) {
              forwardToWhatsApp(ev.payload.text)
            }
          } catch {
            // ignore parse errors for heartbeats etc.
          }
        }
      }
      // Stream ended — reconnect
      console.log(`[whatsapp-client] SSE stream ended, reconnecting...`)
      setTimeout(startSSEListener, 3000)
    })
    .catch((err: Error) => {
      if (err.name === 'AbortError') return // intentional abort
      console.warn(`[whatsapp-client] SSE error: ${err.message}, reconnecting...`)
      setTimeout(startSSEListener, 5000)
    })
}

/** Forward a Console/tool response to the user's WhatsApp self-chat */
function forwardToWhatsApp(text: string) {
  if (!sock || currentStatus !== 'connected') return
  const rawJid = sock.user?.id
  if (!rawJid) return

  const myJid = rawJid.replace(/:.*@/, '@')
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '…' : text
  const formatted = `🎮 Console:\n${truncated}`

  sock.sendMessage(myJid, { text: formatted }).then((sentMsg) => {
    if (sentMsg?.key?.id) {
      outgoingMessageIds.add(sentMsg.key.id)
      setTimeout(() => outgoingMessageIds.delete(sentMsg!.key.id!), 60_000)
    }
    console.log(`[whatsapp-client] Forwarded Console message to WhatsApp self-chat (${text.slice(0, 60)}...)`)
  }).catch((e: Error) => {
    console.warn(`[whatsapp-client] Failed to forward to WhatsApp: ${e.message}`)
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
