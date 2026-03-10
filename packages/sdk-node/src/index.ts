/**
 * @agent-arcade/sdk-node
 *
 * TypeScript SDK for emitting Agent Arcade telemetry from any Node.js process.
 * Connects to the gateway via Socket.IO (WebSocket) with HTTP POST fallback.
 *
 * Usage:
 *   import { AgentArcade } from '@agent-arcade/sdk-node'
 *   const arcade = new AgentArcade({ url: 'http://localhost:8787', sessionId: 'my-session' })
 *   const agentId = arcade.spawn({ name: 'Coder' })
 *   arcade.state(agentId, 'thinking', { label: 'Planning…' })
 *   arcade.tool(agentId, 'read_file', { label: 'Reading config.ts' })
 *   arcade.state(agentId, 'writing', { label: 'Generating code' })
 *   arcade.end(agentId, { reason: 'Task complete', success: true })
 *   arcade.disconnect()
 */

import { io, Socket } from 'socket.io-client'

const PROTOCOL_VERSION = 1

type AgentState =
  | 'idle' | 'thinking' | 'reading' | 'writing' | 'tool'
  | 'waiting' | 'moving' | 'error' | 'done'

type EventType =
  | 'agent.spawn' | 'agent.state' | 'agent.tool' | 'agent.message'
  | 'agent.link' | 'agent.position' | 'agent.end'
  | 'session.start' | 'session.end'

interface TelemetryEvent {
  v: number
  ts: number
  sessionId: string
  agentId: string
  type: EventType
  payload: Record<string, unknown>
}

export interface ArcadeOptions {
  /** Gateway URL, e.g. http://localhost:8787 */
  url: string
  /** Session identifier — multiple agents can share a session */
  sessionId: string
  /** Optional auth token */
  authToken?: string
  /** Optional API key (alternative to authToken) */
  apiKey?: string
  /** Optional session signature from gateway */
  sessionSignature?: string
  /** Auto-connect on construction (default true) */
  autoConnect?: boolean
}

let counter = 0
function generateId(): string {
  return `agent_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

export class AgentArcade {
  private socket: Socket | null = null
  private sessionId: string
  private url: string
  private authToken?: string
  private apiKey?: string
  private sessionSignature?: string
  private connected = false

  constructor(opts: ArcadeOptions) {
    this.url = opts.url
    this.sessionId = opts.sessionId
    this.authToken = opts.authToken
    this.apiKey = opts.apiKey
    this.sessionSignature = opts.sessionSignature
    if (opts.autoConnect !== false) this.connect()
  }

  /** Connect to the gateway */
  connect(): void {
    if (this.socket) return
    this.socket = io(this.url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      auth: { token: this.authToken || this.apiKey || undefined },
      extraHeaders: this.authToken
        ? { Authorization: `Bearer ${this.authToken}` }
        : this.apiKey ? { 'x-api-key': this.apiKey } : undefined,
    })
    this.socket.on('connect', () => {
      this.connected = true
      this.socket!.emit('subscribe', { sessionId: this.sessionId, sig: this.sessionSignature })
    })
    this.socket.on('disconnect', () => { this.connected = false })
  }

  /** Disconnect from the gateway */
  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.connected = false
  }

  private emit(ev: TelemetryEvent): void {
    if (this.socket && this.connected) {
      this.socket.emit('event', ev)
    } else {
      // HTTP fallback
      fetch(`${this.url}/v1/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
          ...(this.sessionSignature ? { 'x-session-signature': this.sessionSignature } : {}),
        },
        body: JSON.stringify(ev),
      }).catch(() => {})
    }
  }

  /** Spawn a new agent and return its id */
  spawn(opts: { name?: string; role?: string; id?: string } = {}): string {
    const agentId = opts.id || generateId()
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.spawn',
      payload: { name: opts.name || 'Agent', role: opts.role || 'assistant' },
    })
    return agentId
  }

  /** Update agent state */
  state(agentId: string, state: AgentState, opts: { label?: string; progress?: number } = {}): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.state',
      payload: { state, ...opts },
    })
  }

  /** Record tool usage */
  tool(agentId: string, toolName: string, opts: { path?: string; label?: string } = {}): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.tool',
      payload: { name: toolName, ...opts },
    })
  }

  /** Send a message / speech bubble */
  message(agentId: string, text: string, opts: { level?: 'info' | 'warning' | 'waiting'; requiresInput?: boolean } = {}): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.message',
      payload: { text, ...opts },
    })
  }

  /** Link a child agent to a parent */
  link(parentAgentId: string, childAgentId: string): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId: childAgentId, type: 'agent.link',
      payload: { parentAgentId, childAgentId },
    })
  }

  /** Update agent grid position */
  position(agentId: string, x: number, y: number): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.position',
      payload: { x, y },
    })
  }

  /** End agent session */
  end(agentId: string, opts: { reason?: string; success?: boolean } = {}): void {
    this.emit({
      v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId,
      agentId, type: 'agent.end',
      payload: { reason: opts.reason || 'Completed', success: opts.success ?? true },
    })
  }
}

export default AgentArcade
