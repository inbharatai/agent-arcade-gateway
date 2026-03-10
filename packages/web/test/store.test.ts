/**
 * Store Unit Tests
 *
 * Tests the Zustand store's processEvent handler for all event types.
 * Run with: bun test packages/web/test/store.test.ts
 *
 * Note: These tests import the store directly. Zustand works in Node/Bun
 * without a browser environment, but settings that use localStorage
 * will fall back to DEFAULT_SETTINGS.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { useAgentArcadeStore } from '../src/lib/agent-arcade/store'
import type { TelemetryEvent } from '../src/lib/agent-arcade/types'

function makeEvent(overrides: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'type' | 'agentId'>): TelemetryEvent {
  return {
    v: 1,
    ts: Date.now(),
    sessionId: 'test-session',
    payload: {},
    ...overrides,
  }
}

beforeEach(() => {
  useAgentArcadeStore.getState().reset()
})

// ── agent.spawn ─────────────────────────────────────────────────────────────

describe('agent.spawn', () => {
  test('creates a new agent with correct fields', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({
      type: 'agent.spawn',
      agentId: 'agent-1',
      payload: { name: 'TestBot', role: 'researcher' },
    }))

    const state = useAgentArcadeStore.getState()
    const agent = state.agents.get('agent-1')
    expect(agent).toBeDefined()
    expect(agent!.name).toBe('TestBot')
    expect(agent!.role).toBe('researcher')
    expect(agent!.state).toBe('idle')
    expect(agent!.progress).toBe(0)
    expect(agent!.tools).toEqual([])
    expect(agent!.messages).toEqual([])
  })

  test('defaults name to "Agent" if not provided', () => {
    useAgentArcadeStore.getState().processEvent(makeEvent({
      type: 'agent.spawn',
      agentId: 'agent-2',
      payload: {},
    }))

    const agent = useAgentArcadeStore.getState().agents.get('agent-2')
    expect(agent!.name).toBe('Agent')
    expect(agent!.role).toBe('assistant')
  })

  test('appears in agentsList', () => {
    useAgentArcadeStore.getState().processEvent(makeEvent({
      type: 'agent.spawn',
      agentId: 'agent-3',
      payload: { name: 'ListBot' },
    }))

    const list = useAgentArcadeStore.getState().agentsList
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('ListBot')
  })
})

// ── agent.state ─────────────────────────────────────────────────────────────

describe('agent.state', () => {
  test('updates agent state and label', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'a1', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'a1',
      payload: { state: 'thinking', label: 'Analyzing code' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('a1')
    expect(agent!.state).toBe('thinking')
    expect(agent!.label).toBe('Analyzing code')
  })

  test('updates progress when provided', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'a2', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'a2',
      payload: { state: 'writing', progress: 0.5 },
    }))

    expect(useAgentArcadeStore.getState().agents.get('a2')!.progress).toBe(0.5)
  })

  test('clamps progress to 0-1 range', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'a3', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'a3',
      payload: { state: 'writing', progress: 2.5 },
    }))
    expect(useAgentArcadeStore.getState().agents.get('a3')!.progress).toBe(1)

    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'a3',
      payload: { state: 'writing', progress: -0.5 },
    }))
    expect(useAgentArcadeStore.getState().agents.get('a3')!.progress).toBe(0)
  })

  test('auto-spawns unknown agent', () => {
    useAgentArcadeStore.getState().processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'unknown-agent',
      payload: { state: 'reading' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('unknown-agent')
    expect(agent).toBeDefined()
    expect(agent!.name).toBe('unknown-agent')
  })

  test('ignores invalid state values', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'a4', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'a4',
      payload: { state: 'invalid_state', label: 'Bad state' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('a4')
    expect(agent!.state).toBe('idle')  // unchanged
    expect(agent!.label).toBe('Bad state')  // label still updates
  })
})

// ── agent.tool ──────────────────────────────────────────────────────────────

describe('agent.tool', () => {
  test('sets state to tool and appends tool name', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'tool-a', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.tool',
      agentId: 'tool-a',
      payload: { name: 'grep', label: 'Searching files' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('tool-a')
    expect(agent!.state).toBe('tool')
    expect(agent!.label).toBe('Searching files')
    expect(agent!.tools).toContain('grep')
  })

  test('accumulates multiple tools', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'tool-b', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({ type: 'agent.tool', agentId: 'tool-b', payload: { name: 'grep' } }))
    store.processEvent(makeEvent({ type: 'agent.tool', agentId: 'tool-b', payload: { name: 'sed' } }))
    store.processEvent(makeEvent({ type: 'agent.tool', agentId: 'tool-b', payload: { name: 'awk' } }))

    expect(useAgentArcadeStore.getState().agents.get('tool-b')!.tools).toEqual(['grep', 'sed', 'awk'])
  })

  test('auto-creates agent for tool event with unknown agentId', () => {
    useAgentArcadeStore.getState().processEvent(makeEvent({
      type: 'agent.tool',
      agentId: 'nonexistent',
      payload: { name: 'ghost-tool' },
    }))
    const agent = useAgentArcadeStore.getState().agents.get('nonexistent')
    expect(agent).toBeDefined()
    expect(agent!.state).toBe('tool')
    expect(agent!.tools).toEqual(['ghost-tool'])
  })
})

// ── agent.message ───────────────────────────────────────────────────────────

describe('agent.message', () => {
  test('appends message text', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'msg-a', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.message',
      agentId: 'msg-a',
      payload: { text: 'Hello world' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('msg-a')
    expect(agent!.messages).toContain('Hello world')
  })

  test('sets waiting state when requiresInput', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'msg-b', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.message',
      agentId: 'msg-b',
      payload: { text: 'Need input', requiresInput: true },
    }))

    expect(useAgentArcadeStore.getState().agents.get('msg-b')!.state).toBe('waiting')
  })

  test('sets waiting state for level=waiting', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'msg-c', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.message',
      agentId: 'msg-c',
      payload: { text: 'Waiting...', level: 'waiting' },
    }))

    expect(useAgentArcadeStore.getState().agents.get('msg-c')!.state).toBe('waiting')
  })

  test('focuses agent when a command-like message is submitted', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'msg-d', payload: { name: 'CmdBot' } }))
    store.processEvent(makeEvent({
      type: 'agent.message',
      agentId: 'msg-d',
      payload: { text: '/run tests', level: 'command' },
    }))

    const state = useAgentArcadeStore.getState()
    expect(state.selectedAgentId).toBe('msg-d')
    expect(state.agents.get('msg-d')!.label).toBe('/run tests')
  })

  test('appends command output as a visible message line', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'msg-e', payload: { name: 'OutputBot' } }))
    store.processEvent(makeEvent({
      type: 'agent.message',
      agentId: 'msg-e',
      payload: { text: 'run build', output: 'Build completed successfully' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('msg-e')!
    expect(agent.messages).toContain('run build')
    expect(agent.messages).toContain('Output: Build completed successfully')
  })
})

// ── agent.link ──────────────────────────────────────────────────────────────

describe('agent.link', () => {
  test('sets parentAgentId on child agent', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'parent-1', payload: { name: 'Parent' } }))
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'child-1', payload: { name: 'Child' } }))
    store.processEvent(makeEvent({
      type: 'agent.link',
      agentId: 'parent-1',
      payload: { parentAgentId: 'parent-1', childAgentId: 'child-1' },
    }))

    expect(useAgentArcadeStore.getState().agents.get('child-1')!.parentAgentId).toBe('parent-1')
  })
})

// ── agent.position ──────────────────────────────────────────────────────────

describe('agent.position', () => {
  test('sets agent position', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'pos-a', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.position',
      agentId: 'pos-a',
      payload: { x: 5, y: 3 },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('pos-a')
    expect(agent!.position).toEqual({ x: 5, y: 3 })
  })
})

// ── agent.end ───────────────────────────────────────────────────────────────

describe('agent.end', () => {
  test('sets done state with reason', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'end-a', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.end',
      agentId: 'end-a',
      payload: { reason: 'All tests passed' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('end-a')
    expect(agent!.state).toBe('done')
    expect(agent!.label).toBe('All tests passed')
    expect(agent!.progress).toBe(1)
  })

  test('defaults reason to "Completed"', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'end-b', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.end',
      agentId: 'end-b',
      payload: {},
    }))

    expect(useAgentArcadeStore.getState().agents.get('end-b')!.label).toBe('Completed')
  })
})

// ── Event buffer ────────────────────────────────────────────────────────────

describe('Event buffer', () => {
  test('stores events up to 200', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'buf-a', payload: { name: 'Bot' } }))

    for (let i = 0; i < 250; i++) {
      store.processEvent(makeEvent({
        type: 'agent.state',
        agentId: 'buf-a',
        payload: { state: 'reading', label: `Event ${i}` },
      }))
    }

    // 1 spawn + 250 state = 251 events, capped at 200
    expect(useAgentArcadeStore.getState().events.length).toBe(200)
  })

  test('keeps most recent events when buffer overflows', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'buf-b', payload: { name: 'Bot' } }))

    for (let i = 0; i < 210; i++) {
      store.processEvent(makeEvent({
        type: 'agent.state',
        agentId: 'buf-b',
        payload: { state: 'reading', label: `Event ${i}` },
      }))
    }

    const events = useAgentArcadeStore.getState().events
    const lastPayload = events[events.length - 1].payload as Record<string, string>
    expect(lastPayload.label).toBe('Event 209')
  })
})

// ── loadState ───────────────────────────────────────────────────────────────

describe('loadState', () => {
  test('replaces all agents wholesale', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'old-a', payload: { name: 'Old' } }))

    store.loadState(
      [
        { id: 'new-1', sessionId: 's', name: 'New1', role: 'r', state: 'idle', label: '', progress: 0, tools: [], messages: [], lastUpdate: 0 },
        { id: 'new-2', sessionId: 's', name: 'New2', role: 'r', state: 'thinking', label: '', progress: 0.5, tools: [], messages: [], lastUpdate: 0 },
      ],
      [],
    )

    const state = useAgentArcadeStore.getState()
    expect(state.agents.size).toBe(2)
    expect(state.agents.has('old-a')).toBe(false)
    expect(state.agents.has('new-1')).toBe(true)
    expect(state.agents.has('new-2')).toBe(true)
  })
})

// ── selectAgent ─────────────────────────────────────────────────────────────

describe('selectAgent', () => {
  test('sets and clears selectedAgentId', () => {
    const store = useAgentArcadeStore.getState()
    store.selectAgent('agent-1')
    expect(useAgentArcadeStore.getState().selectedAgentId).toBe('agent-1')

    store.selectAgent(null)
    expect(useAgentArcadeStore.getState().selectedAgentId).toBeNull()
  })
})

// ── reset ───────────────────────────────────────────────────────────────────

describe('reset', () => {
  test('clears all agents and events but preserves settings', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'r-a', payload: { name: 'Bot' } }))
    expect(useAgentArcadeStore.getState().agents.size).toBe(1)

    store.reset()
    const state = useAgentArcadeStore.getState()
    expect(state.agents.size).toBe(0)
    expect(state.events.length).toBe(0)
    expect(state.settings).toBeDefined()
  })
})
