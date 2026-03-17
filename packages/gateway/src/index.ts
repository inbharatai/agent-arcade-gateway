import { createHmac, randomUUID } from 'crypto'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { SignJWT, jwtVerify } from 'jose'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient, RedisClientType } from 'redis'
import { Server, Socket } from 'socket.io'
import { NotificationRouter, NotificationConfig } from '../../notifications/src/index'

interface SSEClient {
  id: string
  sessionId: string
  res: ServerResponse
}

// ---- Config -----------------------------------------------------------------
const PORT = Number.parseInt(process.env.PORT || '47890', 10)
const NODE_ENV = process.env.NODE_ENV || 'development'
const PROTOCOL_VERSION = 1
const REDIS_URL = process.env.REDIS_URL || ''
const REQUIRE_AUTH = process.env.REQUIRE_AUTH
  ? process.env.REQUIRE_AUTH === '1'
  : NODE_ENV === 'production'
const JWT_SECRET = process.env.JWT_SECRET || ''
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || JWT_SECRET

// ── AI Chat Proxy ─────────────────────────────────────────────────────────────
// Zero-config: the gateway inherits API keys from the shell environment.
// When you run `agent-arcade start` alongside your AI tool, the Console
// automatically picks up ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
//
// Auto-detection priority for Anthropic key:
//   1. ANTHROPIC_API_KEY env var (explicit key)
//   2. Claude Code OAuth credentials (~/.claude/.credentials.json)
//      — uses the accessToken from a paid Claude subscription (Max/Pro)
//   3. Inline key entry from the Console UI
function detectAnthropicKey(): string {
  // 1. Explicit env var
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY

  // 2. Claude Code OAuth credentials file
  try {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    if (home) {
      const credPath = resolve(home, '.claude', '.credentials.json')
      if (existsSync(credPath)) {
        const raw = require('fs').readFileSync(credPath, 'utf-8')
        const creds = JSON.parse(raw)
        const oauth = creds?.claudeAiOauth
        if (oauth?.accessToken && typeof oauth.expiresAt === 'number') {
          // Check token isn't expired (with 5 min buffer)
          if (oauth.expiresAt > Date.now() + 300_000) {
            console.log('[chat] Auto-detected Claude Code OAuth token (subscription: %s)', oauth.subscriptionType || 'unknown')
            return oauth.accessToken
          } else {
            console.log('[chat] Claude Code OAuth token found but expired — skipping')
          }
        }
      }
    }
  } catch (e) {
    console.log('[chat] Could not read Claude Code credentials:', (e as Error).message)
  }

  return ''
}

const CHAT_ANTHROPIC_KEY  = detectAnthropicKey()
const CHAT_ANTHROPIC_URL  = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const CHAT_OPENAI_KEY     = process.env.OPENAI_API_KEY     || ''
const CHAT_GEMINI_KEY     = process.env.GEMINI_API_KEY     || ''
const CHAT_MISTRAL_KEY    = process.env.MISTRAL_API_KEY    || ''

const CHAT_SYSTEM_PROMPT = `You are an expert assistant inside Agent Arcade — a universal AI agent cockpit.
Help the user understand and direct the AI agents visible in the current session.
Be concise and helpful. When writing code use markdown code blocks.`
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (NODE_ENV === 'production' ? '' : '*'))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const MAX_SSE_CLIENTS = Number.parseInt(process.env.MAX_SSE_CLIENTS || '1000', 10)
const MAX_EVENTS = Number.parseInt(process.env.MAX_EVENTS || '500', 10)
const REPLAY_COUNT = Number.parseInt(process.env.REPLAY_COUNT || '50', 10)
const RETENTION_SECONDS = Number.parseInt(process.env.RETENTION_SECONDS || '86400', 10)

const RATE_WINDOW_MS = Number.parseInt(process.env.RATE_WINDOW_MS || '1000', 10)
const RATE_MAX_IP = Number.parseInt(process.env.RATE_MAX_IP || '120', 10)
const RATE_MAX_TOKEN = Number.parseInt(process.env.RATE_MAX_TOKEN || '240', 10)
const SESSION_FLOOD_MAX = Number.parseInt(process.env.SESSION_FLOOD_MAX || '600', 10)

const ENABLE_INTERNAL_ROUTES = (process.env.ENABLE_INTERNAL_ROUTES || (NODE_ENV === 'production' ? '0' : '1')) === '1'
const ENABLE_REDIS_ADAPTER = (process.env.ENABLE_REDIS_ADAPTER || '1') === '1'
// Only honour X-Forwarded-For when explicitly running behind a trusted reverse proxy.
// Without this, any client can spoof their IP and trivially bypass IP-based rate limiting.
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

// ── WhatsApp QR auto-start ────────────────────────────────────────────────────
// Auto-spawn the whatsapp-client process so QR codes are available immediately.
// Enable with WHATSAPP_QR_MODE=1, or auto-enabled in development mode.
const WHATSAPP_QR_MODE = (process.env.WHATSAPP_QR_MODE || (NODE_ENV === 'development' ? '1' : '0')) === '1'
const WHATSAPP_CLIENT_PORT = process.env.WHATSAPP_CLIENT_PORT || '47891'
let whatsappChild: ChildProcess | null = null

// ── Directives Queue (in-memory) ─────────────────────────────────────────
// Commands from Console/WhatsApp that connected tools poll and execute.
interface Directive {
  id: string
  agentId: string
  instruction: string
  source: string
  ts: number
  status: 'pending' | 'ack' | 'done'
}
const directivesQueue: Directive[] = []
let whatsappRestarts = 0
const WHATSAPP_MAX_RESTARTS = 5

// API_KEYS format: keyId:keyValue:role:sessionRegex,keyId2:keyValue2:role:sessionRegex
const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// ── Notification Router ───────────────────────────────────────────────────────
// Fires Slack / Discord / Email alerts for agent errors, cost thresholds, and
// "waiting" events. WhatsApp alerts are delivered via the QR-code client
// (packages/whatsapp-client) which connects via Baileys — no Twilio needed.
function buildNotificationRouter(): NotificationRouter {
  const channels: NotificationConfig['channels'] = []

  if (process.env.SLACK_WEBHOOK_URL)
    channels.push({ type: 'slack', enabled: true, webhookUrl: process.env.SLACK_WEBHOOK_URL })

  if (process.env.DISCORD_WEBHOOK_URL)
    channels.push({ type: 'discord', enabled: true, discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL })

  if (process.env.SMTP_USER && process.env.NOTIFY_EMAIL_TO)
    channels.push({
      type: 'email', enabled: true,
      smtpHost:  process.env.SMTP_HOST || 'smtp.gmail.com',
      smtpPort:  Number(process.env.SMTP_PORT || '587'),
      smtpUser:  process.env.SMTP_USER,
      smtpPass:  process.env.SMTP_PASS,
      emailTo:   process.env.NOTIFY_EMAIL_TO,
    })

  const costThreshold = Number(process.env.NOTIFY_COST_THRESHOLD || '5')

  return new NotificationRouter({
    channels,
    rules: [
      { type: 'agent_error',      threshold: undefined,     channels: ['slack', 'discord', 'email'], enabled: true },
      { type: 'cost_threshold',   threshold: costThreshold, channels: ['slack', 'email'],            enabled: true },
      { type: 'agent_waiting',    threshold: undefined,     channels: ['slack'],                     enabled: true },
      { type: 'session_complete', threshold: undefined,     channels: ['slack'],                     enabled: false },
    ],
    rateLimitMs: 60_000,
  })
}

const notificationRouter = buildNotificationRouter()

// ---- Types ------------------------------------------------------------------
type EventType =
  | 'agent.spawn' | 'agent.state' | 'agent.tool' | 'agent.message'
  | 'agent.link' | 'agent.position' | 'agent.end' | 'agent.span'
  | 'session.start' | 'session.end'

type AgentState =
  | 'idle' | 'thinking' | 'reading' | 'writing' | 'tool'
  | 'waiting' | 'moving' | 'error' | 'done'

const VALID_STATES: AgentState[] = [
  'idle', 'thinking', 'reading', 'writing', 'tool',
  'waiting', 'moving', 'error', 'done',
]

const VALID_EVENT_TYPES: EventType[] = [
  'agent.spawn', 'agent.state', 'agent.tool', 'agent.message',
  'agent.link', 'agent.position', 'agent.end', 'agent.span',
  'session.start', 'session.end',
]

interface TelemetryEvent {
  v: number
  ts: number
  sessionId: string
  agentId: string
  type: EventType
  payload: Record<string, unknown>
}

interface AgentRecord {
  id: string
  sessionId: string
  name: string
  role: string
  state: AgentState
  label: string
  progress: number
  tools: string[]
  messages: string[]
  lastUpdate: number
  parentAgentId?: string
  position?: { x: number; y: number }
  aiModel?: string
  task?: string
}

interface GoalRecord {
  id: string
  sessionId: string
  originalGoal: string
  status: 'planning' | 'review' | 'executing' | 'phase-review' | 'paused' | 'complete' | 'stopped' | 'failed'
  taskTree: Record<string, unknown>
  tasks: Record<string, { status: string; agentId?: string; progress: number; cost: number; tokens: number; output?: string; error?: string }>
  currentPhase: number
  approvedPhases: number[]
  totalCost: number
  totalTokens: number
  startedAt?: number
  completedAt?: number
}

interface SessionMeta {
  id: string
  createdAt: number
  lastActivity: number
  owner: string
}

interface ClientConnectMeta {
  clientName?: string
  aiModel?: string
  agentMap?: Record<string, string>
  taskMap?: Record<string, string>
}

type PrincipalRole = 'viewer' | 'publisher' | 'admin'
interface Principal {
  sub: string
  role: PrincipalRole
  tokenId: string
  sessions: string[]
  tokenType: 'jwt' | 'apiKey' | 'none'
  exp?: number
}

// ---- Logging ----------------------------------------------------------------
function log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'agent-arcade-gateway',
    msg,
    ...data,
  }
  console.log(JSON.stringify(entry))
}

// ---- Metrics ----------------------------------------------------------------
const metrics = {
  startedAt: Date.now(),
  httpRequests: 0,
  wsConnections: 0,
  wsConnectedNow: 0,
  sseConnectedNow: 0,
  authFailures: 0,
  publishAccepted: 0,
  publishRejected: 0,
  droppedEvents: 0,
  sessionsTouched: 0,
}

const sseClients = new Map<string, Set<SSEClient>>()

function broadcastSseEvent(sessionId: string, ev: TelemetryEvent) {
  const clients = sseClients.get(sessionId)
  if (!clients) return
  const payload = `event: event\ndata: ${JSON.stringify(ev)}\n\n`
  for (const c of clients) {
    try {
      c.res.write(payload)
    } catch {
      clients.delete(c)
      try { c.res.destroy() } catch { /* already closed */ }
    }
  }
}

function metricsPrometheus(): string {
  const uptime = Math.floor((Date.now() - metrics.startedAt) / 1000)
  return [
    '# HELP agent_arcade_uptime_seconds Gateway uptime in seconds',
    '# TYPE agent_arcade_uptime_seconds gauge',
    `agent_arcade_uptime_seconds ${uptime}`,
    '# HELP agent_arcade_http_requests_total HTTP requests total',
    '# TYPE agent_arcade_http_requests_total counter',
    `agent_arcade_http_requests_total ${metrics.httpRequests}`,
    '# HELP agent_arcade_ws_connections_total WebSocket connection count total',
    '# TYPE agent_arcade_ws_connections_total counter',
    `agent_arcade_ws_connections_total ${metrics.wsConnections}`,
    '# HELP agent_arcade_ws_connected_now Current WebSocket connections',
    '# TYPE agent_arcade_ws_connected_now gauge',
    `agent_arcade_ws_connected_now ${metrics.wsConnectedNow}`,
    '# HELP agent_arcade_sse_connected_now Current SSE connections',
    '# TYPE agent_arcade_sse_connected_now gauge',
    `agent_arcade_sse_connected_now ${metrics.sseConnectedNow}`,
    '# HELP agent_arcade_auth_failures_total Authentication failures total',
    '# TYPE agent_arcade_auth_failures_total counter',
    `agent_arcade_auth_failures_total ${metrics.authFailures}`,
    '# HELP agent_arcade_publish_accepted_total Accepted published events',
    '# TYPE agent_arcade_publish_accepted_total counter',
    `agent_arcade_publish_accepted_total ${metrics.publishAccepted}`,
    '# HELP agent_arcade_publish_rejected_total Rejected publish attempts',
    '# TYPE agent_arcade_publish_rejected_total counter',
    `agent_arcade_publish_rejected_total ${metrics.publishRejected}`,
    '# HELP agent_arcade_dropped_events_total Dropped events',
    '# TYPE agent_arcade_dropped_events_total counter',
    `agent_arcade_dropped_events_total ${metrics.droppedEvents}`,
  ].join('\n') + '\n'
}

// ---- CORS / network helpers -------------------------------------------------
function getClientIp(req: IncomingMessage): string {
  // Only trust X-Forwarded-For when TRUST_PROXY=1 is explicitly set.
  // Without the guard a client can send X-Forwarded-For: 127.0.0.1 and
  // appear as localhost, bypassing IP-based rate limits entirely.
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
    if (xff) return xff
  }
  return req.socket.remoteAddress || 'unknown'
}

function originAllowed(origin?: string): boolean {
  if (!origin) return true
  if (ALLOWED_ORIGINS.length === 0) return NODE_ENV !== 'production'
  if (ALLOWED_ORIGINS.includes('*')) return true
  for (const rule of ALLOWED_ORIGINS) {
    if (rule === origin) return true
    if (rule.startsWith('regex:')) {
      try {
        const pattern = rule.slice('regex:'.length)
        // Guard against ReDoS:
        //   1. Hard length cap
        //   2. Only allow a safe character set — no raw regex quantifier soup
        //      Permitted: alphanumeric, . - : / _ ~ % # @ ! = ? * (glob wildcard)
        //      Anything outside that set (parentheses, braces, +, {, |, $, ^…) is rejected
        //   3. Explicit rejection of nested-quantifier patterns that cause exponential backtracking
        const SAFE_CORS_CHARS = /^[a-zA-Z0-9.\-:/_~%#@!=?*]+$/
        const NESTED_QUANTIFIER = /([+*}])[+*{]|[)][+*{?]|\(\?[^:=!<]/
        if (
          pattern.length > 200 ||
          !SAFE_CORS_CHARS.test(pattern) ||
          NESTED_QUANTIFIER.test(pattern)
        ) {
          log('warn', `Skipping suspicious CORS regex pattern: ${pattern.slice(0, 60)}`)
          continue
        }
        const re: RegExp = new RegExp(pattern)
        if (re.test(origin)) return true
      } catch {
        // Ignore invalid regex rules.
      }
    }
  }
  return false
}

function setCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin?.toString()
  if (origin && !originAllowed(origin)) {
    return false
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Signature')
  return true
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

function jsonRes(res: ServerResponse, status: number, body: unknown) {
  setSecurityHeaders(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function textRes(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8') {
  setSecurityHeaders(res)
  res.writeHead(status, { 'Content-Type': contentType })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function validSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9:_\-.]{3,120}$/.test(sessionId)
}

function isValidRole(role: string): role is PrincipalRole {
  return role === 'viewer' || role === 'publisher' || role === 'admin'
}

function canAccessSession(principal: Principal, sessionId: string): boolean {
  if (principal.role === 'admin') return true
  if (principal.sessions.includes('*')) return true
  return principal.sessions.some(pattern => {
    if (pattern === sessionId) return true
    try {
      // Anchor the regex so partial matches don't grant unintended access
      const anchored = pattern.startsWith('^') ? pattern : `^(?:${pattern})$`
      return new RegExp(anchored).test(sessionId)
    } catch {
      return false
    }
  })
}

function requiresRole(principal: Principal, allowed: PrincipalRole[]): boolean {
  return allowed.includes(principal.role) || principal.role === 'admin'
}

function checkSessionSignature(sessionId: string, signature?: string): boolean {
  if (!SESSION_SIGNING_SECRET) {
    if (NODE_ENV === 'production') {
      log('error', 'SESSION_SIGNING_SECRET not set in production — rejecting session signature check')
      return false
    }
    return true // Allow in dev when secret is not configured
  }
  if (!signature) return false
  const expected = createHmac('sha256', SESSION_SIGNING_SECRET).update(sessionId).digest('hex')
  return signature === expected
}

function makeSessionSignature(sessionId: string): string {
  return createHmac('sha256', SESSION_SIGNING_SECRET).update(sessionId).digest('hex')
}

// ---- Auth -------------------------------------------------------------------
const apiKeyIndex = new Map<string, { sub: string; role: PrincipalRole; sessionPattern: string }>()
for (const row of API_KEYS) {
  const [sub, keyValue, roleRaw, sessionPattern = '.*'] = row.split(':')
  if (!sub || !keyValue || !isValidRole(roleRaw || '')) continue
  apiKeyIndex.set(keyValue, { sub, role: roleRaw as PrincipalRole, sessionPattern })
}

let redis: RedisClientType | null = null
let redisPub: RedisClientType | null = null
let redisSub: RedisClientType | null = null

async function verifyJwt(token: string): Promise<Principal | null> {
  if (!JWT_SECRET) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET), { algorithms: ['HS256'] })
    const role = String(payload.role || '')
    if (!isValidRole(role)) return null
    const sessionsRaw = payload.sessions
    const sessions = Array.isArray(sessionsRaw)
      ? sessionsRaw.map(v => String(v))
      : sessionsRaw ? [String(sessionsRaw)] : ['*']

    const tokenId = String(payload.jti || `jwt-${payload.sub || 'unknown'}`)

    if (redis && payload.jti) {
      const revoked = await redis.get(`aa:revoked:${String(payload.jti)}`)
      if (revoked) return null
    }

    return {
      sub: String(payload.sub || 'unknown'),
      role,
      tokenId,
      sessions,
      tokenType: 'jwt',
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    }
  } catch {
    return null
  }
}

async function authenticate(req: IncomingMessage, required: PrincipalRole[] = ['viewer']): Promise<Principal | null> {
  if (!REQUIRE_AUTH) return { sub: 'anonymous', role: 'admin', tokenId: 'dev-anon', sessions: ['*'], tokenType: 'none' }

  const authHeader = req.headers.authorization?.toString() || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const apiKey = req.headers['x-api-key']?.toString() || ''
  const candidate = bearer || apiKey

  if (!candidate) return null

  const api = apiKeyIndex.get(candidate)
  if (api) {
    const p: Principal = {
      sub: api.sub,
      role: api.role,
      tokenId: `api-${api.sub}`,
      sessions: [api.sessionPattern],
      tokenType: 'apiKey',
    }
    return requiresRole(p, required) ? p : null
  }

  const jwtPrincipal = await verifyJwt(candidate)
  if (!jwtPrincipal) return null
  if (!requiresRole(jwtPrincipal, required)) return null
  return jwtPrincipal
}

async function authenticateRawToken(rawToken: string, required: PrincipalRole[] = ['viewer']): Promise<Principal | null> {
  if (!rawToken) return null
  const api = apiKeyIndex.get(rawToken)
  if (api) {
    const p: Principal = {
      sub: api.sub,
      role: api.role,
      tokenId: `api-${api.sub}`,
      sessions: [api.sessionPattern],
      tokenType: 'apiKey',
    }
    return requiresRole(p, required) ? p : null
  }
  const jwtPrincipal = await verifyJwt(rawToken)
  if (!jwtPrincipal) return null
  if (!requiresRole(jwtPrincipal, required)) return null
  return jwtPrincipal
}

async function authenticateSocket(socket: Socket): Promise<Principal | null> {
  if (!REQUIRE_AUTH) return { sub: 'anonymous', role: 'admin', tokenId: 'dev-anon', sessions: ['*'], tokenType: 'none' }

  const token = String(socket.handshake.auth?.token || '')
    || String(socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || String(socket.handshake.headers['x-api-key'] || '')

  if (!token) return null

  const api = apiKeyIndex.get(token)
  if (api) {
    return {
      sub: api.sub,
      role: api.role,
      tokenId: `api-${api.sub}`,
      sessions: [api.sessionPattern],
      tokenType: 'apiKey',
    }
  }
  return await verifyJwt(token)
}

// ---- Storage ----------------------------------------------------------------

/** Minimal span record stored in-memory for the /traces endpoint */
interface SpanRecord {
  spanId: string
  agentId: string
  sessionId: string
  parentSpanId?: string
  name: string
  kind: string
  status: string
  startTs: number
  endTs?: number
  durationMs?: number
  input?: unknown
  output?: unknown
  error?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  cost?: number
  tokens?: Array<{ ts: number; text: string }>
  metadata?: Record<string, unknown>
}

const MAX_SPANS_PER_SESSION = 1000

class InMemoryStorage {
  private sessions = new Map<string, SessionMeta>()
  private agents = new Map<string, Map<string, AgentRecord>>()
  private events = new Map<string, TelemetryEvent[]>()
  private spans = new Map<string, Map<string, SpanRecord>>()
  goals = new Map<string, GoalRecord>()

  getGoal(goalId: string): GoalRecord | null {
    return this.goals.get(goalId) || null
  }

  setGoal(goal: GoalRecord): void {
    this.goals.set(goal.id, goal)
  }

  getGoalsBySession(sessionId: string): GoalRecord[] {
    return Array.from(this.goals.values()).filter(g => g.sessionId === sessionId)
  }

  async touchSession(sessionId: string, owner: string) {
    const now = Date.now()
    const existing = this.sessions.get(sessionId)
    if (!existing) {
      this.sessions.set(sessionId, { id: sessionId, createdAt: now, lastActivity: now, owner })
    } else {
      existing.lastActivity = now
    }
  }

  async saveEvent(sessionId: string, ev: TelemetryEvent) {
    const list = this.events.get(sessionId) || []
    list.push(ev)
    if (list.length > MAX_EVENTS) list.shift()
    this.events.set(sessionId, list)
  }

  async getReplay(sessionId: string, count: number): Promise<TelemetryEvent[]> {
    const list = this.events.get(sessionId) || []
    return list.slice(-count)
  }

  async getAgents(sessionId: string): Promise<AgentRecord[]> {
    return Array.from((this.agents.get(sessionId) || new Map()).values())
  }

  async getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null> {
    return (this.agents.get(sessionId) || new Map()).get(agentId) || null
  }

  async upsertAgent(sessionId: string, agent: AgentRecord) {
    const map = this.agents.get(sessionId) || new Map<string, AgentRecord>()
    map.set(agent.id, agent)
    this.agents.set(sessionId, map)
  }

  async deleteAgent(sessionId: string, agentId: string) {
    const map = this.agents.get(sessionId)
    if (map) {
      map.delete(agentId)
      if (map.size === 0) this.agents.delete(sessionId)
    }
  }

  /** Upsert a span (by spanId) for a session */
  saveSpan(sessionId: string, span: SpanRecord): void {
    const map = this.spans.get(sessionId) || new Map<string, SpanRecord>()
    map.set(span.spanId, span)
    // Cap to prevent unbounded growth
    if (map.size > MAX_SPANS_PER_SESSION) {
      const firstKey = map.keys().next().value
      if (firstKey) map.delete(firstKey)
    }
    this.spans.set(sessionId, map)
  }

  /** Get all spans for a session, sorted by startTs */
  getSpans(sessionId: string): SpanRecord[] {
    const map = this.spans.get(sessionId)
    if (!map) return []
    return Array.from(map.values()).sort((a, b) => a.startTs - b.startTs)
  }

  /** Remove done/error agents older than maxAgeMs, and sessions with no agents older than maxAgeMs */
  async pruneStaleAgents(maxAgeMs: number) {
    const now = Date.now()
    let pruned = 0
    for (const [sessionId, agentMap] of this.agents) {
      for (const [agentId, agent] of agentMap) {
        const stale = (agent.state === 'done' || agent.state === 'error') && now - agent.lastUpdate > maxAgeMs
        if (stale) { agentMap.delete(agentId); pruned++ }
      }
      if (agentMap.size === 0) this.agents.delete(sessionId)
    }
    // Prune sessions with no activity
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > maxAgeMs && !this.agents.has(sessionId)) {
        this.sessions.delete(sessionId)
        this.events.delete(sessionId)
      }
    }
    if (pruned > 0) console.log(`[storage] pruned ${pruned} stale agents`)
  }

  async listSessions(): Promise<SessionMeta[]> {
    return Array.from(this.sessions.values())
  }
}

class RedisStorage {
  constructor(private readonly client: RedisClientType) {}

  private sessionMetaKey(sessionId: string) { return `aa:session:${sessionId}:meta` }
  private sessionAgentsKey(sessionId: string) { return `aa:session:${sessionId}:agents` }
  private sessionEventsKey(sessionId: string) { return `aa:session:${sessionId}:events` }

  async touchSession(sessionId: string, owner: string) {
    const key = this.sessionMetaKey(sessionId)
    const now = Date.now().toString()
    const existing = await this.client.hGet(key, 'id')
    if (!existing) {
      await this.client.hSet(key, {
        id: sessionId,
        owner,
        createdAt: now,
        lastActivity: now,
      })
      metrics.sessionsTouched++
    } else {
      await this.client.hSet(key, { lastActivity: now })
    }
    await this.client.expire(key, RETENTION_SECONDS)
  }

  async saveEvent(sessionId: string, ev: TelemetryEvent) {
    const key = this.sessionEventsKey(sessionId)
    await this.client.rPush(key, JSON.stringify(ev))
    await this.client.lTrim(key, -MAX_EVENTS, -1)
    await this.client.expire(key, RETENTION_SECONDS)
  }

  async getReplay(sessionId: string, count: number): Promise<TelemetryEvent[]> {
    const key = this.sessionEventsKey(sessionId)
    const raw = await this.client.lRange(key, -count, -1)
    return raw.map(v => JSON.parse(v) as TelemetryEvent)
  }

  async getAgents(sessionId: string): Promise<AgentRecord[]> {
    const key = this.sessionAgentsKey(sessionId)
    const hash = await this.client.hGetAll(key)
    return Object.values(hash).map(v => JSON.parse(v) as AgentRecord)
  }

  async getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null> {
    const key = this.sessionAgentsKey(sessionId)
    const raw = await this.client.hGet(key, agentId)
    if (!raw) return null
    return JSON.parse(raw) as AgentRecord
  }

  async upsertAgent(sessionId: string, agent: AgentRecord) {
    const key = this.sessionAgentsKey(sessionId)
    await this.client.hSet(key, { [agent.id]: JSON.stringify(agent) })
    await this.client.expire(key, RETENTION_SECONDS)
  }

  async listSessions(): Promise<SessionMeta[]> {
    const out: SessionMeta[] = []
    let cursor = '0'
    do {
      const page = await this.client.scan(cursor, { MATCH: 'aa:session:*:meta', COUNT: 200 })
      cursor = page.cursor
      if (page.keys.length > 0) {
        const values = await Promise.all(page.keys.map(k => this.client.hGetAll(k)))
        for (const v of values) {
          if (!v.id) continue
          out.push({
            id: v.id,
            owner: v.owner || 'unknown',
            createdAt: Number.parseInt(v.createdAt || '0', 10) || 0,
            lastActivity: Number.parseInt(v.lastActivity || '0', 10) || 0,
          })
        }
      }
    } while (cursor !== '0')
    return out
  }

  async pruneStaleAgents(maxAgeMs: number) {
    const now = Date.now()
    let cursor = 0
    let pruned = 0
    do {
      const result = await this.client.scan(cursor, { MATCH: 'aa:session:*:agents', COUNT: 100 })
      cursor = result.cursor
      for (const key of result.keys) {
        const agentsHash = await this.client.hGetAll(key)
        for (const [agentId, raw] of Object.entries(agentsHash)) {
          try {
            const agent = JSON.parse(raw) as AgentRecord
            if ((agent.state === 'done' || agent.state === 'error') && now - agent.lastUpdate > maxAgeMs) {
              await this.client.hDel(key, agentId)
              pruned++
            }
          } catch { /* skip malformed */ }
        }
      }
    } while (cursor !== 0)
    if (pruned > 0) console.log(`[redis-storage] pruned ${pruned} stale agents`)
  }

  getGoal(goalId: string): GoalRecord | null {
    // For Redis, goals are stored in-memory on the gateway instance.
    // A production deployment would use Redis hashes, but for now we
    // delegate to a module-level Map shared with InMemoryStorage.
    return goalStore.get(goalId) || null
  }

  setGoal(goal: GoalRecord): void {
    goalStore.set(goal.id, goal)
  }

  getGoalsBySession(sessionId: string): GoalRecord[] {
    return Array.from(goalStore.values()).filter(g => g.sessionId === sessionId)
  }
}

// Shared goal store used by RedisStorage (InMemoryStorage has its own)
const goalStore = new Map<string, GoalRecord>()

type Storage = InMemoryStorage | RedisStorage
let storage: Storage = new InMemoryStorage()

// ---- Rate limiting ----------------------------------------------------------
const localRate = new Map<string, { count: number; startedAt: number }>()

async function allowRate(kind: string, key: string, max: number, windowMs: number): Promise<boolean> {
  const bucket = `${kind}:${key}:${Math.floor(Date.now() / windowMs)}`

  if (redis) {
    const redisKey = `aa:rl:${bucket}`
    const count = await redis.incr(redisKey)
    if (count === 1) await redis.pExpire(redisKey, windowMs + 2000)
    return count <= max
  }

  const now = Date.now()
  const entry = localRate.get(bucket)
  if (!entry || now - entry.startedAt > windowMs) {
    localRate.set(bucket, { count: 1, startedAt: now })
    return true
  }
  entry.count++
  return entry.count <= max
}

// Purge stale rate-limit buckets every 60s to prevent memory leak
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of localRate) {
    if (now - entry.startedAt > 60_000) localRate.delete(key)
  }
}, 60_000).unref()

// Prune done/error agents every 30s (works for both InMemoryStorage and RedisStorage)
setInterval(() => {
  storage.pruneStaleAgents(30_000).catch((e: unknown) => {
    console.warn('[storage] pruneStaleAgents error:', e)
  })
}, 30_000).unref()

// ---- Event processing -------------------------------------------------------
async function processEvent(ev: TelemetryEvent, principal: Principal) {
  await storage.touchSession(ev.sessionId, principal.sub)
  await storage.saveEvent(ev.sessionId, ev)

  let agent = await storage.getAgent(ev.sessionId, ev.agentId)
  const ensureAgent = async (): Promise<AgentRecord> => {
    if (agent) return agent
    const p = ev.payload as Record<string, unknown>
    agent = {
      id: ev.agentId,
      sessionId: ev.sessionId,
      name: typeof p.name === 'string' && p.name.trim() ? p.name : ev.agentId,
      role: typeof p.role === 'string' && p.role.trim() ? p.role : 'assistant',
      state: 'idle',
      label: '',
      progress: 0,
      tools: [],
      messages: [],
      lastUpdate: ev.ts,
      aiModel: typeof p.aiModel === 'string' ? p.aiModel : undefined,
      task: typeof p.task === 'string' ? p.task : undefined,
    }
    await storage.upsertAgent(ev.sessionId, agent)
    return agent
  }

  switch (ev.type) {
    case 'agent.spawn': {
      const p = ev.payload as Record<string, string>
      agent = {
        id: ev.agentId,
        sessionId: ev.sessionId,
        name: String(p.name || 'Agent').slice(0, 200),
        role: String(p.role || 'assistant').slice(0, 100),
        state: 'idle',
        label: 'Starting...',
        progress: 0,
        tools: [],
        messages: [],
        lastUpdate: ev.ts,
        aiModel: p.aiModel || undefined,
        task: p.task || undefined,
      }
      await storage.upsertAgent(ev.sessionId, agent)
      break
    }
    case 'agent.state': {
      agent = await ensureAgent()
      const p = ev.payload as Record<string, unknown>
      const nextState = String(p.state || '')
      agent.state = VALID_STATES.includes(nextState as AgentState) ? (nextState as AgentState) : agent.state
      if (typeof p.label === 'string') agent.label = p.label.slice(0, 500)
      if (typeof p.progress === 'number' && !Number.isNaN(p.progress)) agent.progress = Math.max(0, Math.min(1, p.progress))
      if (typeof p.aiModel === 'string') agent.aiModel = p.aiModel
      if (typeof p.task === 'string') agent.task = p.task
      agent.lastUpdate = ev.ts
      await storage.upsertAgent(ev.sessionId, agent)
      // Fire WhatsApp/Slack/Discord/Email alert when agent enters error state
      if (nextState === 'error') {
        const errorMsg = typeof p.label === 'string' ? p.label : 'Unknown error'
        notificationRouter.alertAgentError(agent.id, agent.name, ev.sessionId, errorMsg).catch(() => {})
      }
      break
    }
    case 'agent.tool': {
      agent = await ensureAgent()
      const p = ev.payload as Record<string, string>
      agent.state = 'tool'
      agent.label = String(p.label || `Using ${p.name || 'tool'}`).slice(0, 500)
      if (p.name) {
        const toolName = String(p.name).slice(0, 200)
        agent.tools.push(toolName)
        // Cap tools array to prevent unbounded growth
        if (agent.tools.length > 500) agent.tools = agent.tools.slice(-250)
      }
      agent.lastUpdate = ev.ts
      await storage.upsertAgent(ev.sessionId, agent)
      break
    }
    case 'agent.message': {
      agent = await ensureAgent()
      const p = ev.payload as Record<string, unknown>
      const needsInput = p.level === 'waiting' || p.requiresInput
      if (needsInput) agent.state = 'waiting'
      const msgText = String(p.text || '').slice(0, 4000)
      agent.messages.push(msgText)
      // Cap messages to prevent unbounded memory growth
      if (agent.messages.length > 1000) agent.messages = agent.messages.slice(-500)
      agent.lastUpdate = ev.ts
      await storage.upsertAgent(ev.sessionId, agent)
      // Fire WhatsApp/Slack alert when agent is waiting for human input
      if (needsInput) {
        notificationRouter.alertAgentWaiting(agent.id, agent.name, ev.sessionId).catch(() => {})
      }
      break
    }
    case 'agent.link': {
      const p = ev.payload as Record<string, string>
      const child = await storage.getAgent(ev.sessionId, p.childAgentId)
      if (child) {
        child.parentAgentId = p.parentAgentId
        await storage.upsertAgent(ev.sessionId, child)
      }
      break
    }
    case 'agent.position': {
      agent = await ensureAgent()
      const p = ev.payload as Record<string, unknown>
      agent.position = { x: Number(p.x || 0), y: Number(p.y || 0) }
      agent.lastUpdate = ev.ts
      await storage.upsertAgent(ev.sessionId, agent)
      break
    }
    case 'agent.end': {
      agent = await ensureAgent()
      const p = ev.payload as Record<string, unknown>
      agent.state = 'done'
      agent.label = String(p.reason || 'Completed')
      agent.progress = 1
      agent.lastUpdate = ev.ts
      await storage.upsertAgent(ev.sessionId, agent)
      break
    }
    case 'agent.span': {
      // Store span record — no agent state mutation needed
      const p = ev.payload as Record<string, unknown>
      const spanId = typeof p.spanId === 'string' ? p.spanId : randomUUID()
      const existing = storage.getSpans(ev.sessionId).find(s => s.spanId === spanId)
      const span: SpanRecord = {
        spanId,
        agentId: ev.agentId,
        sessionId: ev.sessionId,
        parentSpanId: typeof p.parentSpanId === 'string' ? p.parentSpanId : undefined,
        name: typeof p.name === 'string' ? p.name.slice(0, 200) : 'unknown',
        kind: typeof p.kind === 'string' ? p.kind : 'custom',
        status: typeof p.status === 'string' ? p.status : 'ok',
        startTs: typeof p.startTs === 'number' ? p.startTs : ev.ts,
        endTs: typeof p.endTs === 'number' ? p.endTs : undefined,
        durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
        input: p.input,
        output: p.output,
        error: typeof p.error === 'string' ? p.error.slice(0, 2000) : undefined,
        model: typeof p.model === 'string' ? p.model : undefined,
        promptTokens: typeof p.promptTokens === 'number' ? p.promptTokens : undefined,
        completionTokens: typeof p.completionTokens === 'number' ? p.completionTokens : undefined,
        cost: typeof p.cost === 'number' ? p.cost : undefined,
        tokens: Array.isArray(p.tokens) ? (p.tokens as Array<{ ts: number; text: string }>).slice(0, 500) : undefined,
        metadata: typeof p.metadata === 'object' && p.metadata !== null ? p.metadata as Record<string, unknown> : undefined,
      }
      // Merge with existing span so started→ok transitions update in-place
      if (existing) {
        Object.assign(existing, span)
        storage.saveSpan(ev.sessionId, existing)
      } else {
        storage.saveSpan(ev.sessionId, span)
      }
      // Accumulate cost on agent record
      if (span.cost && span.cost > 0) {
        const a = await storage.getAgent(ev.sessionId, ev.agentId)
        if (a) {
          (a as AgentRecord & { totalCost?: number }).totalCost = ((a as AgentRecord & { totalCost?: number }).totalCost || 0) + span.cost
          await storage.upsertAgent(ev.sessionId, a)
        }
      }
      break
    }
    default:
      break
  }
}

async function sessionSnapshot(sessionId: string) {
  const [allAgents, events] = await Promise.all([
    storage.getAgents(sessionId),
    storage.getReplay(sessionId, REPLAY_COUNT),
  ])
  // Filter out done/error agents older than 30s — they cause ghost agent replays on reconnect
  const now = Date.now()
  const agents = allAgents.filter(a => {
    if (a.state === 'done' || a.state === 'error') return now - a.lastUpdate < 30_000
    return true
  })
  return { agents, events }
}

function normalizeConnectMeta(input: unknown): ClientConnectMeta {
  const meta: ClientConnectMeta = {}
  if (!input || typeof input !== 'object') return meta
  const rec = input as Record<string, unknown>

  if (typeof rec.clientName === 'string') meta.clientName = rec.clientName.slice(0, 120)
  if (typeof rec.aiModel === 'string') meta.aiModel = rec.aiModel.slice(0, 200)

  if (rec.agentMap && typeof rec.agentMap === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec.agentMap as Record<string, unknown>)) {
      if (typeof v === 'string') out[String(k).slice(0, 80)] = v.slice(0, 200)
    }
    if (Object.keys(out).length) meta.agentMap = out
  }

  if (rec.taskMap && typeof rec.taskMap === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec.taskMap as Record<string, unknown>)) {
      if (typeof v === 'string') out[String(k).slice(0, 80)] = v.slice(0, 300)
    }
    if (Object.keys(out).length) meta.taskMap = out
  }

  return meta
}

async function announceClientConnection(sessionId: string, principal: Principal, meta: ClientConnectMeta) {
  const connectorId = `connector-${randomUUID().slice(0, 8)}`
  const name = meta.clientName || principal.sub || 'External Client'

  const events: TelemetryEvent[] = [
    {
      v: PROTOCOL_VERSION,
      ts: Date.now(),
      sessionId,
      agentId: connectorId,
      type: 'agent.spawn',
      payload: {
        name,
        role: 'connector',
        characterClass: 'operator',
      },
    },
    {
      v: PROTOCOL_VERSION,
      ts: Date.now(),
      sessionId,
      agentId: connectorId,
      type: 'agent.message',
      payload: {
        text: meta.aiModel
          ? `Connected: ${name} | AI: ${meta.aiModel}`
          : `Connected: ${name} | AI: not specified`,
        level: 'info',
      },
    },
  ]

  if (meta.agentMap && Object.keys(meta.agentMap).length > 0) {
    events.push({
      v: PROTOCOL_VERSION,
      ts: Date.now(),
      sessionId,
      agentId: connectorId,
      type: 'agent.message',
      payload: {
        text: `Agent map: ${Object.entries(meta.agentMap).map(([a, m]) => `${a}=>${m}`).join(' | ')}`,
        level: 'info',
      },
    })
  }

  if (meta.taskMap && Object.keys(meta.taskMap).length > 0) {
    events.push({
      v: PROTOCOL_VERSION,
      ts: Date.now(),
      sessionId,
      agentId: connectorId,
      type: 'agent.message',
      payload: {
        text: `Task map: ${Object.entries(meta.taskMap).map(([a, t]) => `${a}=>${t}`).join(' | ')}`,
        level: 'info',
      },
    })
  }

  for (const ev of events) {
    await processEvent(ev, principal)
    io.to(`session:${sessionId}`).emit('event', ev)
    broadcastSseEvent(sessionId, ev)
    metrics.publishAccepted++
  }
}

// ---- HTTP + Socket server ---------------------------------------------------
const httpServer = createServer(async (req, res) => {
  metrics.httpRequests++

  if (!setCors(req, res)) {
    metrics.authFailures++
    return jsonRes(res, 403, { error: 'Origin not allowed' })
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  if (url.pathname === '/health') {
    const sessions = await storage.listSessions()
    const uptimeSeconds = Math.floor((Date.now() - metrics.startedAt) / 1000)
    return jsonRes(res, 200, {
      status: 'ok',
      service: 'agent-arcade-gateway',
      protocolVersion: PROTOCOL_VERSION,
      env: NODE_ENV,
      startedAt: metrics.startedAt,
      uptimeSeconds,
      sessions: sessions.length,
      totalEvents: metrics.publishAccepted,
      connected: {
        websocket: metrics.wsConnectedNow,
        sse: metrics.sseConnectedNow,
      },
      auth: {
        required: REQUIRE_AUTH,
      },
    })
  }

  if (url.pathname === '/ready') {
    return jsonRes(res, 200, { status: redis ? 'ready' : 'degraded' })
  }

  if (url.pathname === '/v1/capabilities') {
    const authModes = REQUIRE_AUTH
      ? [
          ...(JWT_SECRET ? ['jwt'] : []),
          ...(apiKeyIndex.size > 0 ? ['apiKey'] : []),
        ]
      : ['none']

    return jsonRes(res, 200, {
      name: 'agent-arcade-gateway',
      protocolVersion: PROTOCOL_VERSION,
      transports: {
        ingestHttp: '/v1/ingest',
        streamSse: '/v1/stream',
        connectHttp: '/v1/connect',
        socketIoPath: '/socket.io',
        directivesHttp: '/v1/directives',
        chatHttp: '/v1/chat',
        chatSyncHttp: '/v1/chat/sync',
        chatProviders: '/v1/chat/providers',
      },
      auth: {
        required: REQUIRE_AUTH,
        modes: authModes,
        sessionSignature: Boolean(SESSION_SIGNING_SECRET),
      },
      cors: {
        wildcardEnabled: ALLOWED_ORIGINS.includes('*'),
        allowedOrigins: ALLOWED_ORIGINS,
      },
    })
  }

  if (req.method === 'POST' && url.pathname === '/v1/connect') {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }

    try {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      const sessionId = String(body.sessionId || '')
      const sig = typeof body.sig === 'string' ? body.sig : undefined
      const meta = normalizeConnectMeta(body.meta)

      if (!validSessionId(sessionId)) {
        return jsonRes(res, 400, { error: 'Invalid sessionId' })
      }
      if (!canAccessSession(principal, sessionId)) {
        metrics.authFailures++
        return jsonRes(res, 403, { error: 'Forbidden for session' })
      }
      if (!checkSessionSignature(sessionId, sig)) {
        metrics.authFailures++
        return jsonRes(res, 403, { error: 'Invalid session signature' })
      }

      await storage.touchSession(sessionId, principal.sub)
      await announceClientConnection(sessionId, principal, meta)
      return jsonRes(res, 200, { ok: true, sessionId, announced: true })
    } catch {
      return jsonRes(res, 400, { error: 'Invalid payload' })
    }
  }

  if (url.pathname === '/metrics') {
    const principal = await authenticate(req, ['admin'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    return textRes(res, 200, metricsPrometheus(), 'text/plain; version=0.0.4; charset=utf-8')
  }

  if (url.pathname === '/debug') {
    if (!ENABLE_INTERNAL_ROUTES) return jsonRes(res, 404, { error: 'Not found' })
    const principal = await authenticate(req, ['admin'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    const sessions = await storage.listSessions()
    return jsonRes(res, 200, {
      sessions,
      metrics,
      protocolVersion: PROTOCOL_VERSION,
      env: NODE_ENV,
    })
  }

  if (req.method === 'POST' && url.pathname === '/v1/session-token') {
    const principal = await authenticate(req, ['admin'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!JWT_SECRET) return jsonRes(res, 500, { error: 'JWT secret not configured' })

    try {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      const sessionId = String(body.sessionId || '')
      const role = String(body.role || 'viewer')
      const ttlSec = Number(body.ttlSec || 3600)

      if (!validSessionId(sessionId) || !isValidRole(role)) {
        return jsonRes(res, 400, { error: 'Invalid sessionId or role' })
      }

      const token = await new SignJWT({
        role,
        sessions: [sessionId],
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(body.sub || `session-${sessionId}`))
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${Math.max(60, ttlSec)}s`)
        .sign(new TextEncoder().encode(JWT_SECRET))

      return jsonRes(res, 200, {
        token,
        sessionId,
        sessionSignature: makeSessionSignature(sessionId),
      })
    } catch (err) {
      log('warn', 'token issue failed', { error: String(err) })
      return jsonRes(res, 400, { error: 'Invalid payload' })
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/revoke') {
    const principal = await authenticate(req, ['admin'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!redis) return jsonRes(res, 503, { error: 'Revocation store unavailable' })

    try {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      const jti = String(body.jti || '')
      const ttlSec = Number(body.ttlSec || 86400)
      if (!jti) return jsonRes(res, 400, { error: 'jti required' })

      await redis.set(`aa:revoked:${jti}`, '1', { EX: Math.max(60, ttlSec) })
      return jsonRes(res, 200, { ok: true })
    } catch {
      return jsonRes(res, 400, { error: 'Invalid payload' })
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/ingest') {
    const principal = await authenticate(req, ['publisher'])
    if (!principal) {
      metrics.authFailures++
      metrics.publishRejected++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }

    const ip = getClientIp(req)
    const ipAllowed = await allowRate('ip', ip, RATE_MAX_IP, RATE_WINDOW_MS)
    const tokenAllowed = await allowRate('token', principal.tokenId, RATE_MAX_TOKEN, RATE_WINDOW_MS)
    if (!ipAllowed || !tokenAllowed) {
      metrics.publishRejected++
      metrics.droppedEvents++
      return jsonRes(res, 429, { error: 'Rate limited' })
    }

    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw) as TelemetryEvent
      if (!body.sessionId || !body.agentId || !body.type) {
        metrics.publishRejected++
        return jsonRes(res, 400, { error: 'Missing required fields: sessionId, agentId, type' })
      }
      if (!validSessionId(body.sessionId)) {
        metrics.publishRejected++
        return jsonRes(res, 400, { error: 'Invalid sessionId format' })
      }
      if (!VALID_EVENT_TYPES.includes(body.type)) {
        metrics.publishRejected++
        return jsonRes(res, 400, { error: `Invalid event type: ${body.type}` })
      }
      if (!canAccessSession(principal, body.sessionId)) {
        metrics.publishRejected++
        metrics.authFailures++
        return jsonRes(res, 403, { error: 'Forbidden for session' })
      }

      const sig = req.headers['x-session-signature']?.toString()
      if (!checkSessionSignature(body.sessionId, sig)) {
        metrics.publishRejected++
        metrics.authFailures++
        return jsonRes(res, 403, { error: 'Invalid session signature' })
      }

      const floodAllowed = await allowRate('session', body.sessionId, SESSION_FLOOD_MAX, RATE_WINDOW_MS)
      if (!floodAllowed) {
        metrics.publishRejected++
        metrics.droppedEvents++
        return jsonRes(res, 429, { error: 'Session flood protection triggered' })
      }

      const ev: TelemetryEvent = {
        v: body.v || PROTOCOL_VERSION,
        ts: body.ts || Date.now(),
        sessionId: body.sessionId,
        agentId: body.agentId,
        type: body.type,
        payload: body.payload || {},
      }

      await processEvent(ev, principal)
      io.to(`session:${ev.sessionId}`).emit('event', ev)
      broadcastSseEvent(ev.sessionId, ev)
      metrics.publishAccepted++
      return jsonRes(res, 200, { ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message === 'body too large' ? 'Request body too large' : 'Invalid JSON body'
      return jsonRes(res, e instanceof Error && e.message === 'body too large' ? 413 : 400, { error: msg })
    }
  }

  if (url.pathname === '/v1/stream') {
    const sessionId = url.searchParams.get('sessionId') || ''
    const signature = url.searchParams.get('sig') || undefined
    const queryToken = url.searchParams.get('token') || ''
    const queryApiKey = url.searchParams.get('apiKey') || ''

    if (!sessionId || !validSessionId(sessionId)) {
      return jsonRes(res, 400, { error: 'sessionId required and must be valid' })
    }

    const principal = await authenticate(req, ['viewer'])
      || await authenticateRawToken(queryToken || queryApiKey, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, sessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    if (!checkSessionSignature(sessionId, signature)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Invalid session signature' })
    }

    // Enforce SSE client cap to prevent resource exhaustion
    let totalSseClients = 0
    for (const s of sseClients.values()) totalSseClients += s.size
    if (totalSseClients >= MAX_SSE_CLIENTS) {
      return jsonRes(res, 503, { error: 'Too many SSE connections' })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    metrics.sseConnectedNow++

    const snap = await sessionSnapshot(sessionId)
    res.write(`event: state\ndata: ${JSON.stringify(snap)}\n\n`)

    const hb = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        // no-op
      }
    }, 25_000)

    const client: SSEClient = { id: randomUUID(), sessionId, res }
    const set = sseClients.get(sessionId) || new Set<SSEClient>()
    set.add(client)
    sseClients.set(sessionId, set)

    req.on('close', () => {
      clearInterval(hb)
      metrics.sseConnectedNow = Math.max(0, metrics.sseConnectedNow - 1)
      set.delete(client)
      if (set.size === 0) sseClients.delete(sessionId)
    })
    return
  }

  // ---- Agent & session management endpoints ----------------------------------

  // Helper: parse /v1/agents/:sessionId/:agentId[/:action] paths
  const agentRouteMatch = url.pathname.match(
    /^\/v1\/agents\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/
  )

  if (agentRouteMatch) {
    const [, routeSessionId, rawAgentId, routeAction] = agentRouteMatch
    const routeAgentId = decodeURIComponent(rawAgentId)

    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, routeSessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }

    // GET /v1/agents/:sessionId/:agentId/state
    if (req.method === 'GET' && routeAction === 'state') {
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })
      return jsonRes(res, 200, {
        agentId: agent.id,
        state: agent.state,
        label: agent.label,
        progress: agent.progress,
        isPaused: agent.state === 'waiting',
        lastUpdate: agent.lastUpdate,
      })
    }

    // GET /v1/agents/:sessionId/:agentId/history
    if (req.method === 'GET' && routeAction === 'history') {
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })
      return jsonRes(res, 200, { agentId: agent.id, actions: agent.messages })
    }

    // POST /v1/agents/:sessionId/:agentId/pause
    if (req.method === 'POST' && routeAction === 'pause') {
      if (!requiresRole(principal, ['publisher'])) {
        return jsonRes(res, 403, { error: 'Forbidden' })
      }
      const rlKey = `${routeSessionId}:${routeAgentId}:pause`
      if (!(await allowRate('agent-action', rlKey, 10, 60_000))) {
        return jsonRes(res, 429, { error: 'Rate limited' })
      }
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })
      agent.state = 'waiting'
      agent.lastUpdate = Date.now()
      await storage.upsertAgent(routeSessionId, agent)
      const ev: TelemetryEvent = {
        v: PROTOCOL_VERSION,
        ts: Date.now(),
        sessionId: routeSessionId,
        agentId: routeAgentId,
        type: 'agent.state',
        payload: { state: 'waiting' },
      }
      io.to(`session:${routeSessionId}`).emit('event', ev)
      broadcastSseEvent(routeSessionId, ev)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /v1/agents/:sessionId/:agentId/resume
    if (req.method === 'POST' && routeAction === 'resume') {
      if (!requiresRole(principal, ['publisher'])) {
        return jsonRes(res, 403, { error: 'Forbidden' })
      }
      const rlKey = `${routeSessionId}:${routeAgentId}:resume`
      if (!(await allowRate('agent-action', rlKey, 10, 60_000))) {
        return jsonRes(res, 429, { error: 'Rate limited' })
      }
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })
      agent.state = 'thinking'
      agent.lastUpdate = Date.now()
      await storage.upsertAgent(routeSessionId, agent)
      const ev: TelemetryEvent = {
        v: PROTOCOL_VERSION,
        ts: Date.now(),
        sessionId: routeSessionId,
        agentId: routeAgentId,
        type: 'agent.state',
        payload: { state: 'thinking' },
      }
      io.to(`session:${routeSessionId}`).emit('event', ev)
      broadcastSseEvent(routeSessionId, ev)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /v1/agents/:sessionId/:agentId/stop
    if (req.method === 'POST' && routeAction === 'stop') {
      if (!requiresRole(principal, ['publisher'])) {
        return jsonRes(res, 403, { error: 'Forbidden' })
      }
      const rlKey = `${routeSessionId}:${routeAgentId}:stop`
      if (!(await allowRate('agent-action', rlKey, 10, 60_000))) {
        return jsonRes(res, 429, { error: 'Rate limited' })
      }
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })
      agent.state = 'done'
      agent.lastUpdate = Date.now()
      await storage.upsertAgent(routeSessionId, agent)
      const ev: TelemetryEvent = {
        v: PROTOCOL_VERSION,
        ts: Date.now(),
        sessionId: routeSessionId,
        agentId: routeAgentId,
        type: 'agent.end',
        payload: { reason: 'Stopped via API' },
      }
      io.to(`session:${routeSessionId}`).emit('event', ev)
      broadcastSseEvent(routeSessionId, ev)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /v1/agents/:sessionId/:agentId/redirect
    if (req.method === 'POST' && routeAction === 'redirect') {
      if (!requiresRole(principal, ['publisher'])) {
        return jsonRes(res, 403, { error: 'Forbidden' })
      }
      const rlKey = `${routeSessionId}:${routeAgentId}:redirect`
      if (!(await allowRate('agent-action', rlKey, 10, 60_000))) {
        return jsonRes(res, 429, { error: 'Rate limited' })
      }
      const agent = await storage.getAgent(routeSessionId, routeAgentId)
      if (!agent) return jsonRes(res, 404, { error: 'Not found' })

      let instruction = ''
      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>
        instruction = typeof body.instruction === 'string' ? body.instruction.slice(0, 4000) : ''
      } catch {
        return jsonRes(res, 400, { error: 'Invalid payload' })
      }
      if (!instruction) return jsonRes(res, 400, { error: 'instruction is required' })

      agent.state = 'thinking'
      agent.messages.push(instruction)
      if (agent.messages.length > 1000) agent.messages = agent.messages.slice(-500)
      agent.lastUpdate = Date.now()
      await storage.upsertAgent(routeSessionId, agent)

      const stateEv: TelemetryEvent = {
        v: PROTOCOL_VERSION,
        ts: Date.now(),
        sessionId: routeSessionId,
        agentId: routeAgentId,
        type: 'agent.state',
        payload: { state: 'thinking' },
      }
      const msgEv: TelemetryEvent = {
        v: PROTOCOL_VERSION,
        ts: Date.now(),
        sessionId: routeSessionId,
        agentId: routeAgentId,
        type: 'agent.message',
        payload: { text: instruction, level: 'redirect' },
      }
      io.to(`session:${routeSessionId}`).emit('event', stateEv)
      io.to(`session:${routeSessionId}`).emit('event', msgEv)
      broadcastSseEvent(routeSessionId, stateEv)
      broadcastSseEvent(routeSessionId, msgEv)

      // Also queue as a directive so the connected tool (Claude Code) can execute it
      directivesQueue.push({
        id: randomUUID(),
        agentId: routeAgentId,
        instruction,
        source: 'redirect',
        ts: Date.now(),
        status: 'pending',
      })
      if (directivesQueue.length > 100) directivesQueue.splice(0, directivesQueue.length - 50)

      return jsonRes(res, 200, { ok: true })
    }

    // No sub-action matched within agent route
    return jsonRes(res, 404, { error: 'Not found' })
  }

  // ── Directives Queue ──────────────────────────────────────────────────────
  // Commands from Console/WhatsApp that connected tools (Claude Code, etc.) can
  // poll and execute. This is the bridge between the UI and the real agent.
  //
  // POST /v1/directives          — push a new directive (from Console/WhatsApp)
  // GET  /v1/directives          — poll pending directives (from connected tool)
  // POST /v1/directives/:id/ack  — acknowledge completion

  if (url.pathname === '/v1/directives' && req.method === 'POST') {
    let body: { agentId?: string; instruction: string; source?: string }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return jsonRes(res, 400, { error: 'Invalid JSON' })
    }
    if (!body.instruction || typeof body.instruction !== 'string') {
      return jsonRes(res, 400, { error: 'instruction is required' })
    }
    const directive = {
      id: randomUUID(),
      agentId: body.agentId || 'claude-code-main',
      instruction: body.instruction.slice(0, 8000),
      source: body.source || 'console',
      ts: Date.now(),
      status: 'pending' as 'pending' | 'ack' | 'done',
    }
    directivesQueue.push(directive)
    // Keep queue bounded
    if (directivesQueue.length > 100) directivesQueue.splice(0, directivesQueue.length - 50)
    log('info', 'directive queued', { id: directive.id, source: directive.source, instruction: directive.instruction.slice(0, 80) })

    // Broadcast directive via Socket.IO so all connected tools get real-time notification
    io.emit('directive', directive)

    // Also emit a telemetry event so the Arcade panel shows the directive as activity
    const directiveEvent: TelemetryEvent = {
      v: PROTOCOL_VERSION,
      ts: Date.now(),
      sessionId: 'copilot-live',
      agentId: directive.agentId,
      type: 'agent.message',
      payload: { text: `Directive from ${directive.source}: ${directive.instruction.slice(0, 120)}` },
    }
    const devPrincipal: Principal = { sub: 'system', role: 'admin', tokenId: 'system', sessions: ['*'], tokenType: 'none' }
    await processEvent(directiveEvent, devPrincipal)
    io.to('session:copilot-live').emit('event', directiveEvent)
    broadcastSseEvent('copilot-live', directiveEvent)

    return jsonRes(res, 200, { ok: true, id: directive.id })
  }

  if (url.pathname === '/v1/directives' && req.method === 'GET') {
    const pending = directivesQueue.filter(d => d.status === 'pending')
    return jsonRes(res, 200, { directives: pending })
  }

  if (url.pathname.startsWith('/v1/directives/') && req.method === 'POST') {
    const parts = url.pathname.split('/')
    const directiveId = parts[3]
    const action = parts[4] // 'ack' or 'done'
    const directive = directivesQueue.find(d => d.id === directiveId)
    if (!directive) return jsonRes(res, 404, { error: 'Directive not found' })

    let body: { response?: string } = {}
    try { body = JSON.parse(await readBody(req)) } catch { /* no body is fine */ }

    if (action === 'ack') {
      directive.status = 'ack'
    } else if (action === 'done') {
      directive.status = 'done'
      // Broadcast the response text so Console and Arcade feed show it
      if (body.response && typeof body.response === 'string') {
        const respEv: TelemetryEvent = {
          v: PROTOCOL_VERSION, ts: Date.now(), sessionId: 'copilot-live',
          agentId: directive.agentId,
          type: 'agent.message',
          payload: { text: body.response.slice(0, 4000), source: 'directive-response' },
        }
        const sysPrincipal: Principal = { sub: 'system', role: 'admin', tokenId: 'system', sessions: ['*'], tokenType: 'none' }
        void processEvent(respEv, sysPrincipal)
        io.to('session:copilot-live').emit('event', respEv)
        broadcastSseEvent('copilot-live', respEv)
      }
    }
    return jsonRes(res, 200, { ok: true })
  }

  // ── QR-code WhatsApp client status endpoints ──────────────────────────────
  // These proxy status from the standalone @agent-arcade/whatsapp-client process
  // which runs on port 47891 by default (or WHATSAPP_CLIENT_PORT).
  // The web dashboard polls GET /v1/whatsapp/status to render the QR code
  // or "Connected" badge in the Settings → WhatsApp tab.

  if (url.pathname === '/v1/whatsapp/status' && req.method === 'GET') {
    try {
      const resp = await fetch(`http://localhost:${WHATSAPP_CLIENT_PORT}/status`, { signal: AbortSignal.timeout(2000) })
      const data = await resp.json()
      return jsonRes(res, 200, data)
    } catch {
      if (WHATSAPP_QR_MODE && whatsappChild && !whatsappChild.killed) {
        return jsonRes(res, 200, { status: 'starting', message: 'WhatsApp client is starting — QR code will appear shortly...' })
      }
      return jsonRes(res, 200, { status: 'disconnected', message: 'whatsapp-client not running — start with: bun run packages/whatsapp-client/src/index.ts' })
    }
  }

  if (url.pathname === '/v1/whatsapp/qr.png' && req.method === 'GET') {
    try {
      const resp = await fetch(`http://localhost:${WHATSAPP_CLIENT_PORT}/qr.png`, { signal: AbortSignal.timeout(2000) })
      if (!resp.ok) { res.writeHead(204); res.end(); return }
      const buf = Buffer.from(await resp.arrayBuffer())
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length) })
      res.end(buf)
    } catch {
      res.writeHead(204); res.end()
    }
    return
  }

  // ── Goal Mode endpoints ───────────────────────────────────────────────────

  // POST /v1/goals/start
  if (url.pathname === '/v1/goals/start' && req.method === 'POST') {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const body = JSON.parse(await readBody(req))
    const goalId = body.goalId || randomUUID()
    const sessionId = String(body.sessionId || '')
    if (!sessionId) return jsonRes(res, 400, { error: 'sessionId required' })
    if (!canAccessSession(principal, sessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    const goal: GoalRecord = {
      id: goalId,
      sessionId,
      originalGoal: body.originalGoal || '',
      status: 'executing',
      taskTree: body.taskTree || {},
      tasks: {},
      currentPhase: 0,
      approvedPhases: [],
      totalCost: 0,
      totalTokens: 0,
      startedAt: Date.now(),
    }
    storage.setGoal(goal)
    io.to(`session:${sessionId}`).emit('goal.started', { goalId, sessionId })
    return jsonRes(res, 200, { goalId, status: 'executing' })
  }

  // GET /v1/goals/:id/status
  const goalStatusMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/status$/)
  if (req.method === 'GET' && goalStatusMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const goal = storage.getGoal(goalStatusMatch[1])
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    return jsonRes(res, 200, goal)
  }

  // POST /v1/goals/:id/pause-all
  const goalPauseMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/pause-all$/)
  if (req.method === 'POST' && goalPauseMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const goal = storage.getGoal(goalPauseMatch[1])
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    goal.status = 'paused'
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.paused', { goalId: goal.id })
    return jsonRes(res, 200, { ok: true, status: 'paused' })
  }

  // POST /v1/goals/:id/resume-all
  const goalResumeMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/resume-all$/)
  if (req.method === 'POST' && goalResumeMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const goal = storage.getGoal(goalResumeMatch[1])
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    goal.status = 'executing'
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.resumed', { goalId: goal.id })
    return jsonRes(res, 200, { ok: true, status: 'executing' })
  }

  // POST /v1/goals/:id/stop-all
  const goalStopMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/stop-all$/)
  if (req.method === 'POST' && goalStopMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const goal = storage.getGoal(goalStopMatch[1])
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    goal.status = 'stopped'
    goal.completedAt = Date.now()
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.stopped', { goalId: goal.id })
    return jsonRes(res, 200, { ok: true, status: 'stopped' })
  }

  // POST /v1/goals/:id/approve-phase
  const goalApproveMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/approve-phase$/)
  if (req.method === 'POST' && goalApproveMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const goal = storage.getGoal(goalApproveMatch[1])
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    const body = JSON.parse(await readBody(req))
    const phaseIndex = Number(body.phaseIndex)
    if (Number.isNaN(phaseIndex)) return jsonRes(res, 400, { error: 'phaseIndex required' })
    if (phaseIndex < 0 || phaseIndex > goal.currentPhase) return jsonRes(res, 400, { error: 'phaseIndex out of bounds' })
    if (!goal.approvedPhases.includes(phaseIndex)) goal.approvedPhases.push(phaseIndex)
    goal.currentPhase = phaseIndex + 1
    goal.status = 'executing'
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.phase.approved', { goalId: goal.id, phaseIndex })
    return jsonRes(res, 200, { ok: true, currentPhase: goal.currentPhase, approvedPhases: goal.approvedPhases })
  }

  // POST /v1/goals/:id/tasks/:taskId/update
  const goalTaskUpdateMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/tasks\/([^/]+)\/update$/)
  if (req.method === 'POST' && goalTaskUpdateMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const [, goalId, taskId] = goalTaskUpdateMatch
    const goal = storage.getGoal(goalId)
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    const body = JSON.parse(await readBody(req))
    const existing = goal.tasks[taskId] || { status: 'pending', progress: 0, cost: 0, tokens: 0 }
    if (body.status !== undefined) existing.status = body.status
    if (body.progress !== undefined) existing.progress = body.progress
    if (body.cost !== undefined) existing.cost = body.cost
    if (body.tokens !== undefined) existing.tokens = body.tokens
    if (body.output !== undefined) existing.output = body.output
    if (body.error !== undefined) existing.error = body.error
    if (body.agentId !== undefined) existing.agentId = body.agentId
    goal.tasks[taskId] = existing
    // Recalculate totals
    goal.totalCost = Object.values(goal.tasks).reduce((s, t) => s + t.cost, 0)
    goal.totalTokens = Object.values(goal.tasks).reduce((s, t) => s + t.tokens, 0)
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.updated', { goalId, taskId, task: existing })
    return jsonRes(res, 200, { ok: true, task: existing })
  }

  // POST /v1/goals/:id/tasks/:taskId/retry
  const goalTaskRetryMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/tasks\/([^/]+)\/retry$/)
  if (req.method === 'POST' && goalTaskRetryMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const [, goalId, taskId] = goalTaskRetryMatch
    const goal = storage.getGoal(goalId)
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    const task = goal.tasks[taskId]
    if (!task) return jsonRes(res, 404, { error: 'Task not found' })
    task.status = 'pending'
    task.progress = 0
    task.error = undefined
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.retry', { goalId, taskId })
    return jsonRes(res, 200, { ok: true })
  }

  // POST /v1/goals/:id/tasks/:taskId/skip
  const goalTaskSkipMatch = url.pathname.match(/^\/v1\/goals\/([^/]+)\/tasks\/([^/]+)\/skip$/)
  if (req.method === 'POST' && goalTaskSkipMatch) {
    const principal = await authenticate(req, ['viewer'])
    if (!principal) { metrics.authFailures++; return jsonRes(res, 401, { error: 'Unauthorized' }) }
    const [, goalId, taskId] = goalTaskSkipMatch
    const goal = storage.getGoal(goalId)
    if (!goal) return jsonRes(res, 404, { error: 'Goal not found' })
    if (!canAccessSession(principal, goal.sessionId)) { metrics.authFailures++; return jsonRes(res, 403, { error: 'Forbidden for session' }) }
    const task = goal.tasks[taskId]
    if (!task) return jsonRes(res, 404, { error: 'Task not found' })
    task.status = 'skipped'
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.skipped', { goalId, taskId })
    return jsonRes(res, 200, { ok: true })
  }

  // GET /v1/session/:sessionId/agents
  const sessionAgentsMatch = url.pathname.match(/^\/v1\/session\/([^/]+)\/agents$/)
  if (req.method === 'GET' && sessionAgentsMatch) {
    const [, routeSessionId] = sessionAgentsMatch
    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, routeSessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    const agents = await storage.getAgents(routeSessionId)
    return jsonRes(res, 200, {
      sessionId: routeSessionId,
      agents,
      count: agents.length,
    })
  }

  // GET /v1/session/:sessionId/cost
  const sessionCostMatch = url.pathname.match(/^\/v1\/session\/([^/]+)\/cost$/)
  if (req.method === 'GET' && sessionCostMatch) {
    const [, routeSessionId] = sessionCostMatch
    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, routeSessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    const agents = await storage.getAgents(routeSessionId)
    const events = await storage.getReplay(routeSessionId, MAX_EVENTS)
    let totalCost = 0
    const agentCostMap = new Map<string, number>()
    for (const ev of events) {
      const p = ev.payload as Record<string, unknown>
      const cost = typeof p.cost === 'number' ? p.cost : 0
      if (cost > 0) {
        totalCost += cost
        agentCostMap.set(ev.agentId, (agentCostMap.get(ev.agentId) || 0) + cost)
      }
    }
    const agentBreakdown = agents.map(a => ({
      agentId: a.id,
      name: a.name,
      cost: agentCostMap.get(a.id) || 0,
    }))
    return jsonRes(res, 200, {
      sessionId: routeSessionId,
      totalCost,
      agentBreakdown,
    })
  }

  // GET /v1/session/:sessionId/traces — execution span tree for LangSmith-grade tracing
  const sessionTracesMatch = url.pathname.match(/^\/v1\/session\/([^/]+)\/traces$/)
  if (req.method === 'GET' && sessionTracesMatch) {
    const [, routeSessionId] = sessionTracesMatch
    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, routeSessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    const spans = storage.getSpans(routeSessionId)
    const agentId = url.searchParams.get('agentId')
    const filtered = agentId ? spans.filter(s => s.agentId === agentId) : spans
    return jsonRes(res, 200, {
      sessionId: routeSessionId,
      spans: filtered,
      count: filtered.length,
    })
  }

  // GET /v1/state — session snapshot (used by SSE fallback for periodic refresh)
  if (req.method === 'GET' && url.pathname === '/v1/state') {
    const sessionId = url.searchParams.get('sessionId') || ''
    if (!sessionId) return jsonRes(res, 400, { error: 'sessionId required' })
    const principal = await authenticate(req, ['viewer'])
    if (!principal) {
      metrics.authFailures++
      return jsonRes(res, 401, { error: 'Unauthorized' })
    }
    if (!canAccessSession(principal, sessionId)) {
      metrics.authFailures++
      return jsonRes(res, 403, { error: 'Forbidden for session' })
    }
    const snap = await sessionSnapshot(sessionId)
    return jsonRes(res, 200, snap)
  }

  // GET /v1/chat/providers — which AI providers are configured on this gateway
  if (req.method === 'GET' && url.pathname === '/v1/chat/providers') {
    // Re-detect on each request so OAuth token refresh is picked up
    const anthropicAvailable = !!detectAnthropicKey()
    return jsonRes(res, 200, {
      providers: {
        claude:  anthropicAvailable,
        openai:  !!CHAT_OPENAI_KEY,
        gemini:  !!CHAT_GEMINI_KEY,
        mistral: !!CHAT_MISTRAL_KEY,
      },
      // Tell the client HOW claude auth works so it knows no manual key is needed
      authMode: anthropicAvailable ? (detectAnthropicKey().startsWith('sk-ant-oat01-') ? 'oauth-subscription' : 'api-key') : 'none',
    })
  }

  // POST /v1/chat — proxy AI chat requests so clients don't need their own API keys
  if (req.method === 'POST' && url.pathname === '/v1/chat') {
    let body: { messages: Array<{ role: string; content: string }>; model: string; provider: string }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return jsonRes(res, 400, { error: 'Invalid JSON' })
    }

    const { messages, model, provider } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonRes(res, 400, { error: 'messages array is required and must not be empty' })
    }
    if (!model || typeof model !== 'string') {
      return jsonRes(res, 400, { error: 'model is required' })
    }

    // Sanitize upstream error messages before returning to the client.
    // Upstream providers may echo request headers (including API keys) in their
    // error bodies; we extract only the human-readable message string and never
    // forward raw upstream objects.
    function sanitizeChatError(raw: Record<string, unknown>, httpStatus: number): string {
      const errObj = raw?.error
      if (errObj && typeof errObj === 'object') {
        const msg = (errObj as Record<string, unknown>).message
        if (typeof msg === 'string' && msg.length > 0) {
          // Strip anything that looks like an API key (long alphanumeric tokens)
          return msg.replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '[REDACTED]').slice(0, 400)
        }
      }
      return `Upstream API error (HTTP ${httpStatus})`
    }

    try {
    if (provider === 'claude') {
      // Re-detect key on each request (OAuth tokens can refresh)
      const anthropicKey = detectAnthropicKey()
      if (!anthropicKey) return jsonRes(res, 401, { error: 'ANTHROPIC_API_KEY not configured. Add your key in Settings → Providers, or set ANTHROPIC_API_KEY in your environment.' })

      const isOAuth = anthropicKey.startsWith('sk-ant-oat01-')

      // ── OAuth path: use `claude -p` CLI (uses subscription auth) ──────────
      if (isOAuth) {
        const lastMsg = messages[messages.length - 1]?.content || ''
        const contextMsgs = messages.slice(0, -1)
        const contextStr = contextMsgs.length > 0
          ? contextMsgs.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n') + '\n\nUser: ' + lastMsg
          : lastMsg
        const cliModel = model || 'claude-sonnet-4-6'
        const fullPrompt = `${CHAT_SYSTEM_PROMPT}\n\nRespond concisely and helpfully.\n\n${contextStr}`

        log('info', `[chat] Using claude CLI (OAuth subscription) model=${cliModel}`)

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        })

        // Plain text mode — stdout streams the response as it's generated
        const child = spawn('claude', ['-p', '--model', cliModel], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          shell: true,
        })

        child.stdin.write(fullPrompt)
        child.stdin.end()

        let chatFullText = ''
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          if (text) {
            chatFullText += text
            const sseData = JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text },
            })
            res.write(`event: content_block_delta\ndata: ${sseData}\n\n`)
          }
        })

        child.stderr.on('data', (chunk: Buffer) => {
          const err = chunk.toString().trim()
          if (err && !err.includes('warning') && !err.includes('deprecated')) {
            log('warn', `[chat] claude CLI stderr: ${err.slice(0, 200)}`)
          }
        })

        child.on('close', (code) => {
          res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`)
          res.end()
          if (code !== 0) log('warn', `[chat] claude CLI exited with code ${code}`)
          // Broadcast the full chat response as a telemetry event so all listeners
          // (Arcade feed, other Console panels, etc.) see what was said
          if (chatFullText.trim()) {
            const chatEv: TelemetryEvent = {
              v: PROTOCOL_VERSION, ts: Date.now(), sessionId: 'copilot-live',
              agentId: `chat-${provider}-proxy`, type: 'agent.message',
              payload: { text: chatFullText.slice(0, 2000), model: cliModel, source: 'chat-proxy' },
            }
            void processEvent(chatEv, devPrincipal)
            io.to('session:copilot-live').emit('event', chatEv)
            broadcastSseEvent('copilot-live', chatEv)
          }
        })

        child.on('error', (err) => {
          log('error', `[chat] claude CLI spawn error: ${err.message}`)
          if (!res.headersSent) {
            return jsonRes(res, 500, { error: 'Failed to start claude CLI' })
          }
          res.end()
        })

        return
      }

      // ── Standard API key path ─────────────────────────────────────────────
      const upstream = await fetch(`${CHAT_ANTHROPIC_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 4096,
          stream: true,
          system: CHAT_SYSTEM_PROMPT,
          messages: messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
        }),
      }).catch((err: Error) => { throw new Error(`Upstream fetch failed: ${err.message}`) })

      if (!upstream.ok) {
        const errBody = await upstream.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
        return jsonRes(res, upstream.status, { error: sanitizeChatError(errBody, upstream.status) })
      }

      // Only forward safe, known response headers — never forward Authorization,
      // x-api-key, or any header that could expose gateway credentials.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })
      // Collect streamed text for telemetry broadcast
      let apiFullText = ''
      upstream.body?.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk)
          // Parse SSE chunks to extract text deltas for broadcast
          try {
            const str = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
            for (const line of str.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const d = JSON.parse(line.slice(6))
              const delta = d?.delta?.text
              if (typeof delta === 'string') apiFullText += delta
            }
          } catch { /* ignore parse errors in stream */ }
        },
        close() {
          res.end()
          if (apiFullText.trim()) {
            const chatEv: TelemetryEvent = {
              v: PROTOCOL_VERSION, ts: Date.now(), sessionId: 'copilot-live',
              agentId: `chat-${provider}-proxy`, type: 'agent.message',
              payload: { text: apiFullText.slice(0, 2000), model: model || 'claude-sonnet-4-6', source: 'chat-proxy' },
            }
            void processEvent(chatEv, devPrincipal)
            io.to('session:copilot-live').emit('event', chatEv)
            broadcastSseEvent('copilot-live', chatEv)
          }
        },
        abort() { res.end() },
      })).catch(() => res.end())
      return
    }

    if (provider === 'openai' || provider === 'mistral') {
      const key = provider === 'openai' ? CHAT_OPENAI_KEY : CHAT_MISTRAL_KEY
      const baseUrl = provider === 'openai' ? 'https://api.openai.com' : 'https://api.mistral.ai'
      if (!key) return jsonRes(res, 401, { error: `${provider.toUpperCase()}_API_KEY not detected. Start the gateway in the same shell where your AI tool runs — keys are inherited automatically.` })
      const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: model,
          stream: true,
          messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...messages],
        }),
      }).catch((err: Error) => { throw new Error(`Upstream fetch failed: ${err.message}`) })

      if (!upstream.ok) {
        const errBody = await upstream.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
        return jsonRes(res, upstream.status, { error: sanitizeChatError(errBody, upstream.status) })
      }

      // Only forward safe, known response headers.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })
      // Collect streamed text for telemetry broadcast (OpenAI format: choices[0].delta.content)
      let oaiFullText = ''
      upstream.body?.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk)
          try {
            const str = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
            for (const line of str.split('\n')) {
              if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
              const d = JSON.parse(line.slice(6))
              const content = d?.choices?.[0]?.delta?.content
              if (typeof content === 'string') oaiFullText += content
            }
          } catch { /* ignore */ }
        },
        close() {
          res.end()
          if (oaiFullText.trim()) {
            const chatEv: TelemetryEvent = {
              v: PROTOCOL_VERSION, ts: Date.now(), sessionId: 'copilot-live',
              agentId: `chat-${provider}-proxy`, type: 'agent.message',
              payload: { text: oaiFullText.slice(0, 2000), model, source: 'chat-proxy' },
            }
            void processEvent(chatEv, devPrincipal)
            io.to('session:copilot-live').emit('event', chatEv)
            broadcastSseEvent('copilot-live', chatEv)
          }
        },
        abort() { res.end() },
      })).catch(() => res.end())
      return
    }

    return jsonRes(res, 400, { error: `Provider '${provider}' not supported for chat.` })
    } catch (e) {
      log('error', 'Chat streaming error', { error: String(e).slice(0, 500), provider })
      return jsonRes(res, 500, { error: `Chat error: ${String(e).slice(0, 200)}` })
    }
  }

  // POST /v1/chat/sync — non-streaming AI chat (for WhatsApp relay, bots, scripts)
  // Returns { reply: string } with the complete response text.
  if (req.method === 'POST' && url.pathname === '/v1/chat/sync') {
    let body: { messages: Array<{ role: string; content: string }>; model?: string; provider?: string }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return jsonRes(res, 400, { error: 'Invalid JSON' })
    }

    const { messages, model, provider } = body
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonRes(res, 400, { error: 'messages array is required' })
    }

    // Auto-detect provider: prefer claude, fallback to openai, then gemini
    const syncAnthropicKey = detectAnthropicKey()
    const prov = provider || (syncAnthropicKey ? 'claude' : CHAT_OPENAI_KEY ? 'openai' : CHAT_GEMINI_KEY ? 'gemini' : '')
    if (!prov) return jsonRes(res, 401, { error: 'No AI provider configured' })

    try {
      if (prov === 'claude') {
        if (!syncAnthropicKey) return jsonRes(res, 401, { error: 'ANTHROPIC_API_KEY not configured' })
        const isOAuthSync = syncAnthropicKey.startsWith('sk-ant-oat01-')

        // ── OAuth: use claude CLI for sync chat ──────────────────────────────
        if (isOAuthSync) {
          const lastMsg = messages[messages.length - 1]?.content || ''
          const contextMsgs = messages.slice(0, -1)
          const contextStr = contextMsgs.length > 0
            ? contextMsgs.map(m => `${m.role}: ${m.content}`).join('\n') + '\n\nUser: ' + lastMsg
            : lastMsg
          const cliModel = model || 'claude-sonnet-4-6'
          const fullPrompt = `${CHAT_SYSTEM_PROMPT}\n\n${contextStr}`

          return new Promise<void>((resolve) => {
            const child = spawn('claude', ['-p', '--model', cliModel], {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { ...process.env },
              shell: true,
            })
            let stdout = ''
            let stderr = ''
            child.stdin.write(fullPrompt)
            child.stdin.end()
            child.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
            child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
            child.on('close', (code) => {
              if (code !== 0 || !stdout.trim()) {
                log('warn', `[chat/sync] claude CLI error: ${stderr.slice(0, 200)}`)
                jsonRes(res, 500, { error: `Claude CLI error: ${stderr.slice(0, 100) || 'no output'}` })
              } else {
                jsonRes(res, 200, { reply: stdout.trim(), provider: 'claude', model: cliModel })
              }
              resolve()
            })
            child.on('error', (err) => {
              jsonRes(res, 500, { error: `Failed to start claude CLI: ${err.message}` })
              resolve()
            })
          })
        }

        // ── Standard API key path ────────────────────────────────────────────
        const upstream = await fetch(`${CHAT_ANTHROPIC_URL}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': syncAnthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model || 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: CHAT_SYSTEM_PROMPT,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
          }),
        })
        if (!upstream.ok) {
          const errBody = await upstream.json().catch(() => ({})) as Record<string, unknown>
          const errMsg = (errBody as any)?.error?.message || `HTTP ${upstream.status}`
          return jsonRes(res, upstream.status, { error: String(errMsg).slice(0, 200) })
        }
        const data = await upstream.json() as { content: Array<{ type: string; text: string }> }
        const reply = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || ''
        return jsonRes(res, 200, { reply, provider: 'claude', model: model || 'claude-sonnet-4-6' })
      }

      if (prov === 'openai' || prov === 'mistral') {
        const key = prov === 'openai' ? CHAT_OPENAI_KEY : CHAT_MISTRAL_KEY
        const baseUrl = prov === 'openai' ? 'https://api.openai.com' : 'https://api.mistral.ai'
        if (!key) return jsonRes(res, 401, { error: `${prov} key not configured` })
        const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: model || (prov === 'openai' ? 'gpt-4o' : 'mistral-large-latest'),
            messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...messages],
          }),
        })
        if (!upstream.ok) {
          return jsonRes(res, upstream.status, { error: `Upstream ${prov} error (HTTP ${upstream.status})` })
        }
        const data = await upstream.json() as { choices: Array<{ message: { content: string } }> }
        const reply = data.choices?.[0]?.message?.content || ''
        return jsonRes(res, 200, { reply, provider: prov, model })
      }

      // Gemini via OpenAI-compat endpoint
      if (prov === 'gemini') {
        if (!CHAT_GEMINI_KEY) return jsonRes(res, 401, { error: 'GEMINI_API_KEY not configured' })
        const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAT_GEMINI_KEY}` },
          body: JSON.stringify({
            model: model || 'gemini-2.0-flash',
            messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...messages],
          }),
        })
        if (!upstream.ok) {
          return jsonRes(res, upstream.status, { error: `Upstream gemini error (HTTP ${upstream.status})` })
        }
        const data = await upstream.json() as { choices: Array<{ message: { content: string } }> }
        const reply = data.choices?.[0]?.message?.content || ''
        return jsonRes(res, 200, { reply, provider: 'gemini', model: model || 'gemini-2.0-flash' })
      }

      return jsonRes(res, 400, { error: `Provider '${prov}' not supported` })
    } catch (e) {
      log('error', 'Chat sync error', { error: String(e).slice(0, 500) })
      return jsonRes(res, 500, { error: `Chat sync error: ${String(e).slice(0, 200)}` })
    }
  }

  return jsonRes(res, 404, { error: 'Not found' })
})

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: (origin, cb) => cb(null, originAllowed(origin || undefined)),
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 1_000_000,
})

io.use(async (socket, next) => {
  try {
    const origin = socket.handshake.headers.origin?.toString()
    if (!originAllowed(origin)) return next(new Error('Origin not allowed'))

    const principal = await authenticateSocket(socket)
    if (!principal) {
      metrics.authFailures++
      return next(new Error('Unauthorized'))
    }
    ;(socket.data as { principal?: Principal }).principal = principal
    return next()
  } catch {
    metrics.authFailures++
    return next(new Error('Unauthorized'))
  }
})

io.on('connection', async (socket: Socket) => {
  metrics.wsConnections++
  metrics.wsConnectedNow++

  const principal = (socket.data as { principal: Principal }).principal
  await redis?.hSet(`aa:conn:${socket.id}`, {
    socketId: socket.id,
    sub: principal.sub,
    role: principal.role,
    connectedAt: String(Date.now()),
  })
  await redis?.expire(`aa:conn:${socket.id}`, 3600)

  let activeSessionId: string | null = null

  socket.on('subscribe', async (data: { sessionId: string; sig?: string; clientName?: string; aiModel?: string; agentMap?: Record<string, string>; taskMap?: Record<string, string> }) => {
    try {
      const sessionId = String(data?.sessionId || '')
      if (!validSessionId(sessionId)) {
        socket.emit('error', { message: 'Invalid sessionId' })
        return
      }
      if (!canAccessSession(principal, sessionId)) {
        metrics.authFailures++
        socket.emit('error', { message: 'Forbidden for session' })
        return
      }
      if (!checkSessionSignature(sessionId, data?.sig)) {
        metrics.authFailures++
        socket.emit('error', { message: 'Invalid session signature' })
        return
      }

      activeSessionId = sessionId
      socket.join(`session:${sessionId}`)
      await storage.touchSession(sessionId, principal.sub)
      socket.emit('state', await sessionSnapshot(sessionId))
      const meta = normalizeConnectMeta(data)
      if (meta.clientName || meta.aiModel || meta.agentMap || meta.taskMap) {
        await announceClientConnection(sessionId, principal, meta)
      }
      log('info', 'socket subscribed', { socketId: socket.id, sessionId, sub: principal.sub })
    } catch {
      socket.emit('error', { message: 'Subscription failed' })
    }
  })

  socket.on('event', async (data: TelemetryEvent) => {
    try {
      if (!requiresRole(principal, ['publisher'])) {
        metrics.publishRejected++
        socket.emit('error', { message: 'Forbidden' })
        return
      }
      // Re-check JWT expiry on every event. The token was verified once at
      // connect time; a long-lived WebSocket can survive token expiry otherwise.
      if (principal.tokenType === 'jwt' && principal.exp !== undefined) {
        if (Math.floor(Date.now() / 1000) > principal.exp) {
          metrics.publishRejected++
          metrics.authFailures++
          socket.emit('error', { message: 'Token expired' })
          socket.disconnect(true)
          return
        }
      }
      if (!activeSessionId) {
        metrics.publishRejected++
        socket.emit('error', { message: 'Subscribe first' })
        return
      }

      const ipAllowed = await allowRate('socket', socket.id, RATE_MAX_IP, RATE_WINDOW_MS)
      const tokenAllowed = await allowRate('token', principal.tokenId, RATE_MAX_TOKEN, RATE_WINDOW_MS)
      if (!ipAllowed || !tokenAllowed) {
        metrics.publishRejected++
        metrics.droppedEvents++
        socket.emit('error', { message: 'Rate limited' })
        return
      }

      if (!VALID_EVENT_TYPES.includes(data.type)) {
        metrics.publishRejected++
        socket.emit('error', { message: `Invalid event type: ${data.type}` })
        return
      }

      const ev: TelemetryEvent = {
        v: data.v || PROTOCOL_VERSION,
        ts: data.ts || Date.now(),
        sessionId: activeSessionId,
        agentId: data.agentId,
        type: data.type,
        payload: data.payload || {},
      }

      await processEvent(ev, principal)
      io.to(`session:${activeSessionId}`).emit('event', ev)
      broadcastSseEvent(activeSessionId, ev)
      metrics.publishAccepted++
    } catch {
      metrics.publishRejected++
      socket.emit('error', { message: 'Event rejected' })
    }
  })

  // refresh — client requests a fresh session snapshot (every 10s keepalive)
  socket.on('refresh', async (data: { sessionId?: string }) => {
    const sid = data?.sessionId || activeSessionId
    if (!sid) return
    if (!canAccessSession(principal, sid)) return
    try {
      const snap = await sessionSnapshot(sid)
      socket.emit('state', snap)
    } catch {
      // Non-fatal — client will retry
    }
  })

  // ── Goal Mode socket events ──────────────────────────────────────────────
  socket.on('goal.task.started', (data: { goalId: string; taskId: string; agentId?: string }) => {
    const goal = storage.getGoal(data.goalId)
    if (!goal) { socket.emit('error', { message: 'Goal not found' }); return }
    const task = goal.tasks[data.taskId] || { status: 'pending', progress: 0, cost: 0, tokens: 0 }
    task.status = 'running'
    if (data.agentId) task.agentId = data.agentId
    goal.tasks[data.taskId] = task
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.updated', { goalId: data.goalId, taskId: data.taskId, task })
  })

  socket.on('goal.task.progress', (data: { goalId: string; taskId: string; progress: number; cost?: number; tokens?: number }) => {
    const goal = storage.getGoal(data.goalId)
    if (!goal) { socket.emit('error', { message: 'Goal not found' }); return }
    const task = goal.tasks[data.taskId]
    if (!task) { socket.emit('error', { message: 'Task not found' }); return }
    task.progress = data.progress
    if (data.cost !== undefined) task.cost = data.cost
    if (data.tokens !== undefined) task.tokens = data.tokens
    goal.totalCost = Object.values(goal.tasks).reduce((s, t) => s + t.cost, 0)
    goal.totalTokens = Object.values(goal.tasks).reduce((s, t) => s + t.tokens, 0)
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.updated', { goalId: data.goalId, taskId: data.taskId, task })
  })

  socket.on('goal.task.complete', (data: { goalId: string; taskId: string; output?: string; cost?: number; tokens?: number }) => {
    const goal = storage.getGoal(data.goalId)
    if (!goal) { socket.emit('error', { message: 'Goal not found' }); return }
    const task = goal.tasks[data.taskId]
    if (!task) { socket.emit('error', { message: 'Task not found' }); return }
    task.status = 'complete'
    task.progress = 100
    if (data.output !== undefined) task.output = data.output
    if (data.cost !== undefined) task.cost = data.cost
    if (data.tokens !== undefined) task.tokens = data.tokens
    goal.totalCost = Object.values(goal.tasks).reduce((s, t) => s + t.cost, 0)
    goal.totalTokens = Object.values(goal.tasks).reduce((s, t) => s + t.tokens, 0)
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.updated', { goalId: data.goalId, taskId: data.taskId, task })
  })

  socket.on('goal.task.failed', (data: { goalId: string; taskId: string; error?: string }) => {
    const goal = storage.getGoal(data.goalId)
    if (!goal) { socket.emit('error', { message: 'Goal not found' }); return }
    const task = goal.tasks[data.taskId]
    if (!task) { socket.emit('error', { message: 'Task not found' }); return }
    task.status = 'failed'
    if (data.error !== undefined) task.error = data.error
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.task.updated', { goalId: data.goalId, taskId: data.taskId, task })
  })

  socket.on('goal.phase.complete', (data: { goalId: string; phaseIndex: number }) => {
    const goal = storage.getGoal(data.goalId)
    if (!goal) { socket.emit('error', { message: 'Goal not found' }); return }
    goal.status = 'phase-review'
    storage.setGoal(goal)
    io.to(`session:${goal.sessionId}`).emit('goal.phase.complete', { goalId: data.goalId, phaseIndex: data.phaseIndex })
  })

  socket.on('disconnect', async () => {
    metrics.wsConnectedNow = Math.max(0, metrics.wsConnectedNow - 1)
    await redis?.del(`aa:conn:${socket.id}`)
  })
})

// ── WhatsApp auto-spawn ──────────────────────────────────────────────────────
function spawnWhatsAppClient() {
  // Resolve the whatsapp-client entry relative to the gateway package
  const candidates = [
    resolve(__dirname, '../../whatsapp-client/src/index.ts'),
    resolve(process.cwd(), '../whatsapp-client/src/index.ts'),
    resolve(process.cwd(), 'packages/whatsapp-client/src/index.ts'),
  ]
  const entry = candidates.find(p => existsSync(p))
  if (!entry) {
    log('warn', 'whatsapp-client entry not found, skipping auto-start', { searched: candidates })
    return
  }

  // Check if already running on the expected port
  fetch(`http://localhost:${WHATSAPP_CLIENT_PORT}/status`, { signal: AbortSignal.timeout(1000) })
    .then(r => {
      if (r.ok) {
        log('info', 'whatsapp-client already running', { port: WHATSAPP_CLIENT_PORT })
        return
      }
      doSpawn(entry)
    })
    .catch(() => doSpawn(entry))

  function doSpawn(entryPath: string) {
    log('info', 'auto-starting whatsapp-client', { entry: entryPath, port: WHATSAPP_CLIENT_PORT })
    const runtime = process.execPath // bun or node — whatever started the gateway
    whatsappChild = spawn(runtime, ['run', entryPath], {
      env: {
        ...process.env,
        GATEWAY_URL: `http://localhost:${PORT}`,
        WHATSAPP_CLIENT_PORT: WHATSAPP_CLIENT_PORT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    whatsappChild.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) log('info', `[whatsapp] ${msg}`)
    })
    whatsappChild.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) log('warn', `[whatsapp] ${msg}`)
    })
    whatsappChild.on('exit', (code) => {
      log('info', 'whatsapp-client exited', { code })
      whatsappChild = null
      // Auto-restart after 5s (with limit)
      if (WHATSAPP_QR_MODE && code !== 0 && whatsappRestarts < WHATSAPP_MAX_RESTARTS) {
        whatsappRestarts++
        log('info', 'whatsapp-client will restart', { attempt: whatsappRestarts, maxRestarts: WHATSAPP_MAX_RESTARTS })
        setTimeout(() => spawnWhatsAppClient(), 5000)
      } else if (whatsappRestarts >= WHATSAPP_MAX_RESTARTS) {
        log('warn', 'whatsapp-client max restarts reached — install dependencies with: cd packages/whatsapp-client && bun install')
      }
    })
  }
}

async function bootstrap() {
  if (REQUIRE_AUTH && !JWT_SECRET && apiKeyIndex.size === 0) {
    throw new Error('Auth is required but neither JWT_SECRET nor API_KEYS are configured')
  }

  if (NODE_ENV === 'production') {
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes('*')) {
      log('warn', 'ALLOWED_ORIGINS is empty or wildcard in production — restrict to specific domains')
    }
    if (!SESSION_SIGNING_SECRET) {
      log('warn', 'SESSION_SIGNING_SECRET not set — session signatures will not be validated')
    }
  }

  if (REDIS_URL) {
    redis = createClient({ url: REDIS_URL })
    redis.on('error', (err) => log('error', 'redis error', { error: String(err) }))
    await redis.connect()
    storage = new RedisStorage(redis)
    log('info', 'redis storage enabled', { url: REDIS_URL.replace(/:[^:@/]+@/, ':***@') })

    if (ENABLE_REDIS_ADAPTER) {
      redisPub = createClient({ url: REDIS_URL })
      redisSub = createClient({ url: REDIS_URL })
      await redisPub.connect()
      await redisSub.connect()
      io.adapter(createAdapter(redisPub, redisSub))
      log('info', 'socket.io redis adapter enabled')
    }
  } else {
    log('warn', 'redis disabled, running degraded in-memory mode')
    if (NODE_ENV === 'production') {
      throw new Error('REDIS_URL is required in production mode')
    }
  }

  httpServer.listen(PORT, () => {
    log('info', 'gateway started', {
      port: PORT,
      env: NODE_ENV,
      requireAuth: REQUIRE_AUTH,
      allowedOrigins: ALLOWED_ORIGINS,
      redisEnabled: Boolean(redis),
      redisAdapterEnabled: Boolean(redisPub && redisSub),
      protocolVersion: PROTOCOL_VERSION,
      whatsappQrMode: WHATSAPP_QR_MODE,
    })

    // Auto-spawn whatsapp-client for QR code generation
    if (WHATSAPP_QR_MODE) {
      spawnWhatsAppClient()
    }
  })
}

function shutdown(signal: string) {
  log('info', 'shutdown requested', { signal })
  // Stop auto-spawned whatsapp-client
  if (whatsappChild && !whatsappChild.killed) {
    whatsappChild.kill('SIGTERM')
    whatsappChild = null
  }
  httpServer.close(async () => {
    await Promise.allSettled([
      redis?.quit(),
      redisPub?.quit(),
      redisSub?.quit(),
    ])
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (err) => log('error', 'uncaughtException', { error: err.message }))
process.on('unhandledRejection', (reason) => log('error', 'unhandledRejection', { reason: String(reason) }))

bootstrap().catch((err) => {
  log('error', 'failed to start', { error: String(err) })
  process.exit(1)
})
