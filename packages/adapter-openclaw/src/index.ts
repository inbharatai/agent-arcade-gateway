/**
 * @agent-arcade/adapter-openclaw
 *
 * Auto-instruments OpenClaw agents to emit Agent Arcade telemetry.
 * Hooks into OpenClaw's Gateway, Brain (ReAct loop), Skills, Memory,
 * and Heartbeat to provide full observability in the Arcade dashboard.
 *
 * Usage:
 *   import { wrapOpenClaw } from '@agent-arcade/adapter-openclaw'
 *
 *   const claw = wrapOpenClaw(openClawInstance, {
 *     gatewayUrl: 'http://localhost:8787',
 *     sessionId: 'my-session',
 *   })
 *   // OpenClaw runs normally -- all activity is automatically visualized
 *
 * Hook-based usage (if using OpenClaw's event emitter directly):
 *   import { createOpenClawHooks } from '@agent-arcade/adapter-openclaw'
 *
 *   const hooks = createOpenClawHooks({
 *     gatewayUrl: 'http://localhost:8787',
 *     sessionId: 'my-session',
 *   })
 *   openClaw.on('brain:think', hooks.onThink)
 *   openClaw.on('skill:start', hooks.onSkillStart)
 *   // etc.
 */

import { AgentArcade } from '@agent-arcade/sdk-node'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcadeOpenClawOptions {
  /** Gateway URL, e.g. http://localhost:8787 */
  gatewayUrl: string
  /** Session identifier */
  sessionId: string
  /** Optional arcade auth token */
  apiKey?: string
  /** Override agent name displayed in the Arcade (default: 'OpenClaw') */
  agentName?: string
  /** Track memory operations (default: true) */
  trackMemory?: boolean
  /** Track heartbeat/scheduled tasks (default: true) */
  trackHeartbeat?: boolean
  /** Track skill executions (default: true) */
  trackSkills?: boolean
}

/** OpenClaw event types we hook into */
export interface OpenClawEvents {
  'brain:think': { query: string; context?: string }
  'brain:plan': { steps: string[] }
  'brain:act': { action: string; input?: unknown }
  'brain:observe': { result: unknown }
  'brain:respond': { response: string }
  'brain:error': { error: string }
  'skill:start': { name: string; input?: unknown }
  'skill:end': { name: string; output?: unknown; success: boolean }
  'skill:error': { name: string; error: string }
  'memory:read': { key: string }
  'memory:write': { key: string; size?: number }
  'memory:search': { query: string; results: number }
  'heartbeat:start': { task: string; schedule?: string }
  'heartbeat:end': { task: string; success: boolean }
  'channel:receive': { channel: string; from?: string }
  'channel:send': { channel: string; to?: string }
}

type OpenClawEventName = keyof OpenClawEvents

/** Minimal OpenClaw instance interface (duck-typed for compatibility) */
interface OpenClawLike {
  on?(event: string, handler: (...args: any[]) => void): void
  addListener?(event: string, handler: (...args: any[]) => void): void
  emit?(event: string, ...args: any[]): void
  // Gateway hooks
  gateway?: {
    on?(event: string, handler: (...args: any[]) => void): void
    use?(middleware: (ctx: any, next: () => Promise<void>) => Promise<void>): void
  }
  // Brain hooks
  brain?: {
    on?(event: string, handler: (...args: any[]) => void): void
    think?: (...args: any[]) => Promise<any>
  }
  // Skills registry
  skills?: {
    on?(event: string, handler: (...args: any[]) => void): void
    execute?: (name: string, ...args: any[]) => Promise<any>
    list?: () => string[]
  }
  // Memory system
  memory?: {
    on?(event: string, handler: (...args: any[]) => void): void
    read?: (key: string) => Promise<any>
    write?: (key: string, value: any) => Promise<void>
    search?: (query: string) => Promise<any[]>
  }
  // Heartbeat scheduler
  heartbeat?: {
    on?(event: string, handler: (...args: any[]) => void): void
  }
}

let counter = 0
function uid(): string {
  return `oclaw_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

// ---------------------------------------------------------------------------
// Event-based hooks (preferred approach)
// ---------------------------------------------------------------------------

/**
 * Create event hooks that can be attached to an OpenClaw instance.
 * This is the most flexible approach — works with any OpenClaw version.
 */
export function createOpenClawHooks(options: ArcadeOpenClawOptions) {
  const arcade = new AgentArcade({
    url: options.gatewayUrl,
    sessionId: options.sessionId,
    apiKey: options.apiKey,
  })

  const agentName = options.agentName || 'OpenClaw'
  const brainAgentId = uid()
  let spawned = false
  const skillAgents = new Map<string, string>() // skillName -> agentId
  const heartbeatAgents = new Map<string, string>() // taskName -> agentId

  function ensureSpawned(): string {
    if (!spawned) {
      arcade.spawn({ name: agentName, role: 'brain', id: brainAgentId })
      spawned = true
    }
    return brainAgentId
  }

  return {
    /** Brain starts thinking about a query */
    onThink(data: OpenClawEvents['brain:think']) {
      const id = ensureSpawned()
      arcade.state(id, 'thinking', {
        label: data.query.length > 120 ? data.query.slice(0, 120) + '...' : data.query,
      })
    },

    /** Brain creates an action plan */
    onPlan(data: OpenClawEvents['brain:plan']) {
      const id = ensureSpawned()
      arcade.state(id, 'thinking', {
        label: `Planning ${data.steps.length} steps`,
      })
      arcade.message(id, `Plan: ${data.steps.join(' → ')}`)
    },

    /** Brain executes a ReAct action */
    onAct(data: OpenClawEvents['brain:act']) {
      const id = ensureSpawned()
      arcade.tool(id, data.action, {
        label: typeof data.input === 'string'
          ? data.input.slice(0, 200)
          : `Executing ${data.action}`,
      })
      arcade.state(id, 'tool', { label: data.action })
    },

    /** Brain observes action result */
    onObserve(_data: OpenClawEvents['brain:observe']) {
      const id = ensureSpawned()
      arcade.state(id, 'reading', { label: 'Observing result' })
    },

    /** Brain produces final response */
    onRespond(data: OpenClawEvents['brain:respond']) {
      const id = ensureSpawned()
      arcade.state(id, 'writing', {
        label: data.response.length > 100 ? data.response.slice(0, 100) + '...' : data.response,
      })
    },

    /** Brain encounters an error */
    onBrainError(data: OpenClawEvents['brain:error']) {
      const id = ensureSpawned()
      arcade.state(id, 'error', { label: data.error.slice(0, 200) })
    },

    /** Skill starts executing */
    onSkillStart(data: OpenClawEvents['skill:start']) {
      if (options.trackSkills === false) return
      const skillAgentId = uid()
      skillAgents.set(data.name, skillAgentId)
      arcade.spawn({ name: `Skill: ${data.name}`, role: 'skill', id: skillAgentId })
      arcade.link(brainAgentId, skillAgentId)
      arcade.state(skillAgentId, 'tool', { label: `Running ${data.name}` })
    },

    /** Skill finishes */
    onSkillEnd(data: OpenClawEvents['skill:end']) {
      if (options.trackSkills === false) return
      const skillAgentId = skillAgents.get(data.name)
      if (skillAgentId) {
        arcade.end(skillAgentId, {
          reason: data.success ? `${data.name} complete` : `${data.name} failed`,
          success: data.success,
        })
        skillAgents.delete(data.name)
      }
    },

    /** Skill errors */
    onSkillError(data: OpenClawEvents['skill:error']) {
      if (options.trackSkills === false) return
      const skillAgentId = skillAgents.get(data.name)
      if (skillAgentId) {
        arcade.state(skillAgentId, 'error', { label: data.error.slice(0, 200) })
        arcade.end(skillAgentId, { reason: data.error.slice(0, 100), success: false })
        skillAgents.delete(data.name)
      }
    },

    /** Memory read operation */
    onMemoryRead(data: OpenClawEvents['memory:read']) {
      if (options.trackMemory === false) return
      const id = ensureSpawned()
      arcade.tool(id, 'memory:read', { label: `Reading: ${data.key}` })
    },

    /** Memory write operation */
    onMemoryWrite(data: OpenClawEvents['memory:write']) {
      if (options.trackMemory === false) return
      const id = ensureSpawned()
      const sizeLabel = data.size ? ` (${data.size} bytes)` : ''
      arcade.tool(id, 'memory:write', { label: `Writing: ${data.key}${sizeLabel}` })
    },

    /** Memory search operation */
    onMemorySearch(data: OpenClawEvents['memory:search']) {
      if (options.trackMemory === false) return
      const id = ensureSpawned()
      arcade.tool(id, 'memory:search', {
        label: `Searching: "${data.query}" → ${data.results} results`,
      })
    },

    /** Heartbeat task starts */
    onHeartbeatStart(data: OpenClawEvents['heartbeat:start']) {
      if (options.trackHeartbeat === false) return
      const hbAgentId = uid()
      heartbeatAgents.set(data.task, hbAgentId)
      arcade.spawn({ name: `Heartbeat: ${data.task}`, role: 'heartbeat', id: hbAgentId })
      arcade.link(brainAgentId, hbAgentId)
      arcade.state(hbAgentId, 'thinking', {
        label: data.schedule ? `Scheduled: ${data.schedule}` : `Running: ${data.task}`,
      })
    },

    /** Heartbeat task ends */
    onHeartbeatEnd(data: OpenClawEvents['heartbeat:end']) {
      if (options.trackHeartbeat === false) return
      const hbAgentId = heartbeatAgents.get(data.task)
      if (hbAgentId) {
        arcade.end(hbAgentId, {
          reason: data.success ? `${data.task} complete` : `${data.task} failed`,
          success: data.success,
        })
        heartbeatAgents.delete(data.task)
      }
    },

    /** Channel message received (Slack, WhatsApp, etc.) */
    onChannelReceive(data: OpenClawEvents['channel:receive']) {
      const id = ensureSpawned()
      arcade.state(id, 'reading', {
        label: `Message from ${data.channel}${data.from ? ` (${data.from})` : ''}`,
      })
    },

    /** Channel message sent */
    onChannelSend(data: OpenClawEvents['channel:send']) {
      const id = ensureSpawned()
      arcade.state(id, 'writing', {
        label: `Sending to ${data.channel}${data.to ? ` (${data.to})` : ''}`,
      })
    },

    /** End the brain agent session */
    onEnd(reason = 'Session complete') {
      if (spawned) {
        arcade.end(brainAgentId, { reason, success: true })
        spawned = false
      }
    },

    /** Disconnect from the Arcade gateway */
    disconnect() {
      arcade.disconnect()
    },

    /** Access the underlying AgentArcade instance */
    get arcade() { return arcade },
  }
}

// ---------------------------------------------------------------------------
// Auto-wrap (monkey-patch) approach
// ---------------------------------------------------------------------------

/**
 * Wrap an OpenClaw instance to automatically emit Agent Arcade telemetry.
 * Hooks into all available subsystems: Brain, Skills, Memory, Heartbeat.
 *
 * @param claw - An OpenClaw instance (duck-typed)
 * @param options - Arcade configuration
 * @returns The same instance with instrumentation attached
 */
export function wrapOpenClaw<T extends OpenClawLike>(
  claw: T,
  options: ArcadeOpenClawOptions,
): T & { arcadeDisconnect: () => void; arcadeHooks: ReturnType<typeof createOpenClawHooks> } {
  const hooks = createOpenClawHooks(options)

  // Event-name mapping: OpenClaw event → hook function
  const eventMap: Array<[string, (data: any) => void]> = [
    ['brain:think', hooks.onThink],
    ['brain:plan', hooks.onPlan],
    ['brain:act', hooks.onAct],
    ['brain:observe', hooks.onObserve],
    ['brain:respond', hooks.onRespond],
    ['brain:error', hooks.onBrainError],
    ['skill:start', hooks.onSkillStart],
    ['skill:end', hooks.onSkillEnd],
    ['skill:error', hooks.onSkillError],
    ['memory:read', hooks.onMemoryRead],
    ['memory:write', hooks.onMemoryWrite],
    ['memory:search', hooks.onMemorySearch],
    ['heartbeat:start', hooks.onHeartbeatStart],
    ['heartbeat:end', hooks.onHeartbeatEnd],
    ['channel:receive', hooks.onChannelReceive],
    ['channel:send', hooks.onChannelSend],
  ]

  // Try to attach via event emitter (most OpenClaw versions)
  const emitter = claw.on ? claw : claw.gateway
  if (emitter?.on) {
    for (const [event, handler] of eventMap) {
      try { emitter.on(event, handler) } catch { /* subsystem not available */ }
    }
  }

  // Also try subsystem-specific event emitters
  const subsystems: Array<[string, OpenClawLike[keyof OpenClawLike]]> = [
    ['brain', claw.brain],
    ['skills', claw.skills],
    ['memory', claw.memory],
    ['heartbeat', claw.heartbeat],
  ]

  for (const [prefix, subsystem] of subsystems) {
    if (subsystem && typeof subsystem === 'object' && 'on' in subsystem && typeof subsystem.on === 'function') {
      for (const [event, handler] of eventMap) {
        if (event.startsWith(prefix + ':')) {
          const shortEvent = event.split(':')[1]
          try { subsystem.on(shortEvent, handler) } catch { /* not available */ }
        }
      }
    }
  }

  // Monkey-patch brain.think if available and no event emitter
  if (claw.brain?.think && !claw.brain.on) {
    const originalThink = claw.brain.think.bind(claw.brain)
    claw.brain.think = async function arcadeWrappedThink(...args: any[]) {
      const query = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0])?.slice(0, 200) || ''
      hooks.onThink({ query })
      try {
        const result = await originalThink(...args)
        hooks.onRespond({ response: typeof result === 'string' ? result : 'Complete' })
        return result
      } catch (error: any) {
        hooks.onBrainError({ error: error.message?.slice(0, 200) || 'Unknown error' })
        throw error
      }
    }
  }

  // Monkey-patch skills.execute if available and no event emitter
  if (claw.skills?.execute && !claw.skills.on) {
    const originalExecute = claw.skills.execute.bind(claw.skills)
    claw.skills.execute = async function arcadeWrappedExecute(name: string, ...args: any[]) {
      hooks.onSkillStart({ name })
      try {
        const result = await originalExecute(name, ...args)
        hooks.onSkillEnd({ name, output: result, success: true })
        return result
      } catch (error: any) {
        hooks.onSkillError({ name, error: error.message?.slice(0, 200) || 'Skill failed' })
        throw error
      }
    }
  }

  // Monkey-patch memory if available and no event emitter
  if (claw.memory && !claw.memory.on) {
    if (claw.memory.read) {
      const originalRead = claw.memory.read.bind(claw.memory)
      claw.memory.read = async function arcadeWrappedRead(key: string) {
        hooks.onMemoryRead({ key })
        return originalRead(key)
      }
    }
    if (claw.memory.write) {
      const originalWrite = claw.memory.write.bind(claw.memory)
      claw.memory.write = async function arcadeWrappedWrite(key: string, value: any) {
        const size = typeof value === 'string' ? value.length : JSON.stringify(value)?.length
        hooks.onMemoryWrite({ key, size })
        return originalWrite(key, value)
      }
    }
    if (claw.memory.search) {
      const originalSearch = claw.memory.search.bind(claw.memory)
      claw.memory.search = async function arcadeWrappedSearch(query: string) {
        const results = await originalSearch(query)
        hooks.onMemorySearch({ query, results: Array.isArray(results) ? results.length : 0 })
        return results
      }
    }
  }

  // Attach disconnect helper
  const extended = claw as T & { arcadeDisconnect: () => void; arcadeHooks: ReturnType<typeof createOpenClawHooks> }
  extended.arcadeDisconnect = () => {
    hooks.onEnd()
    hooks.disconnect()
  }
  extended.arcadeHooks = hooks

  return extended
}

// ---------------------------------------------------------------------------
// Gateway middleware (for OpenClaw's HTTP gateway)
// ---------------------------------------------------------------------------

/**
 * OpenClaw gateway middleware that instruments all incoming requests.
 * Use with OpenClaw's `gateway.use()` middleware system.
 *
 * @example
 * ```typescript
 * import { openClawMiddleware } from '@agent-arcade/adapter-openclaw'
 *
 * claw.gateway.use(openClawMiddleware({
 *   gatewayUrl: 'http://localhost:8787',
 *   sessionId: 'production',
 * }))
 * ```
 */
export function openClawMiddleware(options: ArcadeOpenClawOptions) {
  const hooks = createOpenClawHooks(options)

  return async (ctx: any, next: () => Promise<void>) => {
    const channel = ctx.channel || ctx.platform || 'unknown'
    hooks.onChannelReceive({
      channel,
      from: ctx.from || ctx.sender || ctx.userId,
    })

    try {
      await next()

      hooks.onChannelSend({
        channel,
        to: ctx.to || ctx.recipient,
      })
    } catch (error: any) {
      hooks.onBrainError({ error: error.message || 'Request failed' })
      throw error
    }
  }
}

export default wrapOpenClaw
