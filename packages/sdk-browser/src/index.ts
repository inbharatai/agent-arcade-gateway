/**
 * @agent-arcade/sdk-browser
 *
 * Browser-side SDK that can be imported as an ES module OR loaded as a
 * global `<script>` tag.  Exposes `window.AgentArcade` when loaded as a script.
 *
 * Usage (ES module):
 *   import { AgentArcadeBrowser } from '@agent-arcade/sdk-browser'
 *   const arcade = AgentArcadeBrowser.init({
 *     url: 'http://localhost:8787',
 *     sessionId: 'demo',
 *   })
 *   const id = arcade.spawn({ name: 'Frontend Bot' })
 *   arcade.state(id, 'thinking')
 *
 * Usage (script tag):
 *   <script src="agent-arcade-browser.js"></script>
 *   <script>
 *     const arcade = window.AgentArcade.init({ url: '...', sessionId: '...' })
 *   </script>
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
  v: number; ts: number; sessionId: string; agentId: string
  type: EventType; payload: Record<string, unknown>
}

export interface BrowserOptions {
  url: string
  sessionId: string
  authToken?: string
  apiKey?: string
  sessionSignature?: string
}

let counter = 0
function uid(): string { return `agent_${Date.now().toString(36)}_${(counter++).toString(36)}` }

export class AgentArcadeBrowser {
  private socket: Socket | null = null
  private url: string
  private sessionId: string
  private authToken?: string
  private apiKey?: string
  private sessionSignature?: string
  private ready = false

  private constructor(opts: BrowserOptions) {
    this.url = opts.url
    this.sessionId = opts.sessionId
    this.authToken = opts.authToken
    this.apiKey = opts.apiKey
    this.sessionSignature = opts.sessionSignature
    this._connect()
  }

  /** Factory — use this instead of `new` */
  static init(opts: BrowserOptions): AgentArcadeBrowser {
    return new AgentArcadeBrowser(opts)
  }

  private _connect() {
    this.socket = io(this.url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      auth: { token: this.authToken || this.apiKey || undefined },
    })
    this.socket.on('connect', () => {
      this.ready = true
      this.socket!.emit('subscribe', { sessionId: this.sessionId, sig: this.sessionSignature })
    })
    this.socket.on('disconnect', () => { this.ready = false })
  }

  private _emit(ev: TelemetryEvent) {
    if (this.socket && this.ready) {
      this.socket.emit('event', ev)
    } else {
      const attempt = (retries: number) => {
        fetch(`${this.url}/v1/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
            ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
            ...(this.sessionSignature ? { 'x-session-signature': this.sessionSignature } : {}),
          },
          body: JSON.stringify(ev),
        }).catch(() => {
          if (retries > 0) setTimeout(() => attempt(retries - 1), 1000 * (3 - retries))
        })
      }
      attempt(2)
    }
  }

  spawn(opts: { name?: string; role?: string; id?: string } = {}): string {
    const agentId = opts.id || uid()
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.spawn', payload: { name: opts.name || 'Agent', role: opts.role || 'assistant' } })
    return agentId
  }

  state(agentId: string, state: AgentState, opts: { label?: string; progress?: number } = {}) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.state', payload: { state, ...opts } })
  }

  tool(agentId: string, name: string, opts: { label?: string } = {}) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.tool', payload: { name, ...opts } })
  }

  message(agentId: string, text: string, opts: { level?: string; requiresInput?: boolean } = {}) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.message', payload: { text, ...opts } })
  }

  link(parentId: string, childId: string) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId: childId, type: 'agent.link', payload: { parentAgentId: parentId, childAgentId: childId } })
  }

  position(agentId: string, x: number, y: number) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.position', payload: { x, y } })
  }

  end(agentId: string, opts: { reason?: string; success?: boolean } = {}) {
    this._emit({ v: PROTOCOL_VERSION, ts: Date.now(), sessionId: this.sessionId, agentId, type: 'agent.end', payload: { reason: opts.reason || 'Completed', success: opts.success ?? true } })
  }

  disconnect() { this.socket?.disconnect(); this.socket = null; this.ready = false }
}

// Attach to window for <script> tag usage
if (typeof window !== 'undefined') {
  (window as any).AgentArcade = AgentArcadeBrowser
}

export default AgentArcadeBrowser
