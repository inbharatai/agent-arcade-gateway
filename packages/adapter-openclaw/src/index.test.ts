import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockArcade = {
  spawn: mock(() => 'test-agent-id'),
  state: mock(() => {}),
  tool: mock(() => {}),
  end: mock(() => {}),
  message: mock(() => {}),
  disconnect: mock(() => {}),
  link: mock(() => {}),
}

mock.module('@agent-arcade/sdk-node', () => ({
  AgentArcade: class {
    constructor() {}
    spawn = mockArcade.spawn
    state = mockArcade.state
    tool = mockArcade.tool
    end = mockArcade.end
    message = mockArcade.message
    disconnect = mockArcade.disconnect
    link = mockArcade.link
  },
}))

const { createOpenClawHooks, wrapOpenClaw } = await import('./index')

function resetMocks() {
  Object.values(mockArcade).forEach((m: any) => m.mockClear())
}

const BASE_OPTS = {
  gatewayUrl: 'http://localhost:47890',
  sessionId: 'test-session',
}

// ---------------------------------------------------------------------------
// createOpenClawHooks — structure
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — structure', () => {
  beforeEach(resetMocks)

  it('returns an object with the expected hook functions', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    expect(typeof hooks.onThink).toBe('function')
    expect(typeof hooks.onPlan).toBe('function')
    expect(typeof hooks.onAct).toBe('function')
    expect(typeof hooks.onObserve).toBe('function')
    expect(typeof hooks.onRespond).toBe('function')
    expect(typeof hooks.onBrainError).toBe('function')
    expect(typeof hooks.onSkillStart).toBe('function')
    expect(typeof hooks.onSkillEnd).toBe('function')
    expect(typeof hooks.onSkillError).toBe('function')
    expect(typeof hooks.onMemoryRead).toBe('function')
    expect(typeof hooks.onMemoryWrite).toBe('function')
    expect(typeof hooks.onMemorySearch).toBe('function')
    expect(typeof hooks.onHeartbeatStart).toBe('function')
    expect(typeof hooks.onHeartbeatEnd).toBe('function')
    expect(typeof hooks.onChannelReceive).toBe('function')
    expect(typeof hooks.onChannelSend).toBe('function')
    expect(typeof hooks.onEnd).toBe('function')
    expect(typeof hooks.disconnect).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// onThink
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — onThink', () => {
  beforeEach(resetMocks)

  it('calls arcade.spawn (lazy) and arcade.state("thinking") with the query label', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onThink({ query: 'What is the capital of France?' })

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.state).toHaveBeenCalledTimes(1)
    expect(mockArcade.state.mock.calls[0][1]).toBe('thinking')
  })

  it('truncates long queries to 120 chars + ellipsis', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)
    const longQuery = 'A'.repeat(200)

    hooks.onThink({ query: longQuery })

    const labelArg = mockArcade.state.mock.calls[0][2]?.label as string
    expect(labelArg.length).toBeLessThanOrEqual(123) // 120 + '...'
    expect(labelArg.endsWith('...')).toBe(true)
  })

  it('only spawns once across multiple calls', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onThink({ query: 'first' })
    hooks.onThink({ query: 'second' })

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// onSkillStart / onSkillEnd
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — onSkillStart', () => {
  beforeEach(resetMocks)

  it('calls arcade.spawn for the skill agent and arcade.state("tool")', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onSkillStart({ name: 'web_search', input: { q: 'bun test' } })

    // spawn is called: once for the skill (brain may not be spawned yet via onSkillStart alone
    // but a skill agent is always spawned)
    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    const spawnArgs = mockArcade.spawn.mock.calls[0][0]
    expect(spawnArgs.name).toBe('Skill: web_search')

    const stateNames = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateNames).toContain('tool')
  })

  it('does nothing when trackSkills is false', () => {
    const hooks = createOpenClawHooks({ ...BASE_OPTS, trackSkills: false })

    hooks.onSkillStart({ name: 'web_search' })

    expect(mockArcade.spawn).not.toHaveBeenCalled()
  })
})

describe('createOpenClawHooks — onSkillEnd', () => {
  beforeEach(resetMocks)

  it('calls arcade.end with success:true when skill succeeds', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onSkillStart({ name: 'calculator' })
    resetMocks() // clear spawn/state calls so we can focus on end
    hooks.onSkillEnd({ name: 'calculator', output: 42, success: true })

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })

  it('calls arcade.end with success:false when skill fails', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onSkillStart({ name: 'buggy_skill' })
    resetMocks()
    hooks.onSkillEnd({ name: 'buggy_skill', success: false })

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })

  it('does not call arcade.end for unknown skill name', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    // Never called onSkillStart for 'ghost_skill'
    hooks.onSkillEnd({ name: 'ghost_skill', success: true })

    expect(mockArcade.end).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// onMemoryRead / onMemoryWrite
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — onMemoryRead', () => {
  beforeEach(resetMocks)

  it('calls arcade.tool with "memory:read" and the key label', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onMemoryRead({ key: 'user_profile' })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('memory:read')
    expect(mockArcade.tool.mock.calls[0][2]?.label).toContain('user_profile')
  })

  it('does nothing when trackMemory is false', () => {
    const hooks = createOpenClawHooks({ ...BASE_OPTS, trackMemory: false })

    hooks.onMemoryRead({ key: 'user_profile' })

    expect(mockArcade.tool).not.toHaveBeenCalled()
  })
})

describe('createOpenClawHooks — onMemoryWrite', () => {
  beforeEach(resetMocks)

  it('calls arcade.tool with "memory:write" and includes key in label', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onMemoryWrite({ key: 'session_data', size: 512 })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('memory:write')
    const label = mockArcade.tool.mock.calls[0][2]?.label as string
    expect(label).toContain('session_data')
    expect(label).toContain('512')
  })
})

// ---------------------------------------------------------------------------
// onHeartbeatStart
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — onHeartbeatStart', () => {
  beforeEach(resetMocks)

  it('spawns a heartbeat agent and calls arcade.state("thinking")', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onHeartbeatStart({ task: 'daily_digest', schedule: '0 9 * * *' })

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    const spawnArgs = mockArcade.spawn.mock.calls[0][0]
    expect(spawnArgs.name).toBe('Heartbeat: daily_digest')
    expect(spawnArgs.role).toBe('heartbeat')

    const stateNames = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateNames).toContain('thinking')
  })

  it('does nothing when trackHeartbeat is false', () => {
    const hooks = createOpenClawHooks({ ...BASE_OPTS, trackHeartbeat: false })

    hooks.onHeartbeatStart({ task: 'daily_digest' })

    expect(mockArcade.spawn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// onChannelReceive
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — onChannelReceive', () => {
  beforeEach(resetMocks)

  it('calls arcade.state("reading") with a label containing the channel name', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.onChannelReceive({ channel: 'slack', from: 'alice' })

    expect(mockArcade.state).toHaveBeenCalledTimes(1)
    expect(mockArcade.state.mock.calls[0][1]).toBe('reading')
    const label = mockArcade.state.mock.calls[0][2]?.label as string
    expect(label).toContain('slack')
  })

  it('works without the optional "from" field', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    expect(() => hooks.onChannelReceive({ channel: 'whatsapp' })).not.toThrow()
    expect(mockArcade.state.mock.calls[0][1]).toBe('reading')
  })
})

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('createOpenClawHooks — disconnect', () => {
  beforeEach(resetMocks)

  it('calls arcade.disconnect()', () => {
    const hooks = createOpenClawHooks(BASE_OPTS)

    hooks.disconnect()

    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// wrapOpenClaw
// ---------------------------------------------------------------------------

describe('wrapOpenClaw', () => {
  beforeEach(resetMocks)

  it('registers event listeners on an instance with an on() method', () => {
    const registeredEvents: string[] = []
    const instance = {
      on(event: string, _handler: (...args: any[]) => void) {
        registeredEvents.push(event)
      },
    }

    wrapOpenClaw(instance, BASE_OPTS)

    // Should have registered at least the core brain/skill/memory/channel events
    expect(registeredEvents).toContain('brain:think')
    expect(registeredEvents).toContain('skill:start')
    expect(registeredEvents).toContain('memory:read')
    expect(registeredEvents).toContain('channel:receive')
  })

  it('attaches arcadeDisconnect and arcadeHooks to the returned instance', () => {
    const instance = {
      on(_event: string, _handler: (...args: any[]) => void) {},
    }

    const wrapped = wrapOpenClaw(instance, BASE_OPTS)

    expect(typeof wrapped.arcadeDisconnect).toBe('function')
    expect(typeof wrapped.arcadeHooks).toBe('object')
  })

  it('arcadeDisconnect calls disconnect on the hooks', () => {
    const instance = {
      on(_event: string, _handler: (...args: any[]) => void) {},
    }

    const wrapped = wrapOpenClaw(instance, BASE_OPTS)
    wrapped.arcadeDisconnect()

    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })

  it('spawns the brain agent when brain:think is emitted via registered handler', () => {
    const listeners: Record<string, (data: any) => void> = {}
    const instance = {
      on(event: string, handler: (data: any) => void) {
        listeners[event] = handler
      },
    }

    wrapOpenClaw(instance, BASE_OPTS)
    resetMocks() // clear any spawn that happened during setup

    // Simulate the event being fired
    listeners['brain:think']?.({ query: 'test query' })

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.state.mock.calls[0][1]).toBe('thinking')
  })

  it('monkey-patches brain.think when there is no brain.on event emitter', async () => {
    const instance = {
      brain: {
        think: async (_q: string) => 'result',
        // no .on method — forces monkey-patch path
      },
    }

    const wrapped = wrapOpenClaw(instance, BASE_OPTS)
    await wrapped.brain!.think!('hello')

    const stateNames = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateNames).toContain('thinking')
    expect(stateNames).toContain('writing')
  })

  it('monkey-patches skills.execute when there is no skills.on event emitter', async () => {
    const instance = {
      skills: {
        execute: async (_name: string) => ({ ok: true }),
        // no .on method — forces monkey-patch path
      },
    }

    const wrapped = wrapOpenClaw(instance, BASE_OPTS)
    await wrapped.skills!.execute!('my_skill')

    // onSkillStart → spawn; onSkillEnd → end(success:true)
    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})
