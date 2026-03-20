/**
 * Store Cleanup Unit Tests
 *
 * Tests cleanupStaleAgents, loadState normalization, and processEvent behavior
 * for error/recovery state transitions.
 *
 * Run with: bun test packages/web/src/lib/agent-arcade/store/cleanup.test.ts
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import type { Agent } from '../types'
import { useAgentArcadeStore } from './index'
import type { TelemetryEvent } from '../types'

function makeEvent(
  overrides: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'type' | 'agentId'>
): TelemetryEvent {
  return {
    v: 1,
    ts: Date.now(),
    sessionId: 'cleanup-test-session',
    payload: {},
    ...overrides,
  }
}

/** Directly inject an agent with a specific lastUpdate timestamp into the store */
function injectAgentWithAge(agentId: string, state: string, ageMs: number) {
  const store = useAgentArcadeStore.getState()
  // Spawn the agent normally first
  store.processEvent(makeEvent({
    type: 'agent.spawn',
    agentId,
    payload: { name: `Bot-${agentId}`, role: 'tester' },
  }))
  if (state !== 'idle') {
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId,
      payload: { state },
    }))
  }
  // Now backdoor the lastUpdate timestamp by using loadState to normalize
  // We manipulate via the store's internal agent map
  const current = useAgentArcadeStore.getState().agents.get(agentId)
  if (!current) throw new Error(`Agent ${agentId} not found after spawn`)

  // Use loadState to replace just this agent with the backdated timestamp
  const allAgents = Array.from(useAgentArcadeStore.getState().agents.values())
  const patched = allAgents.map(a =>
    a.id === agentId ? { ...a, state: state as Parameters<typeof store.loadState>[0][0]['state'], lastUpdate: Date.now() - ageMs } : a
  )
  store.loadState(patched, [])
}

beforeEach(() => {
  useAgentArcadeStore.getState().reset()
})

// ── cleanupStaleAgents ────────────────────────────────────────────────────

describe('cleanupStaleAgents', () => {
  test('removes done agents after 30s', () => {
    injectAgentWithAge('done-stale', 'done', 31_000) // 31s old > 30s threshold

    expect(useAgentArcadeStore.getState().agents.has('done-stale')).toBe(true)
    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('done-stale')).toBe(false)
  })

  test('does NOT remove done agent that is only 20s old', () => {
    injectAgentWithAge('done-fresh', 'done', 20_000) // 20s old < 30s threshold

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('done-fresh')).toBe(true)
  })

  test('removes error agents after 60s', () => {
    injectAgentWithAge('error-stale', 'error', 61_000) // 61s old > 60s threshold

    expect(useAgentArcadeStore.getState().agents.has('error-stale')).toBe(true)
    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('error-stale')).toBe(false)
  })

  test('does NOT remove error agent that is only 50s old', () => {
    injectAgentWithAge('error-fresh', 'error', 50_000) // 50s old < 60s threshold

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('error-fresh')).toBe(true)
  })

  test('does NOT remove thinking agent regardless of age', () => {
    injectAgentWithAge('thinking-old', 'thinking', 120_000) // 2 min old — still active

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('thinking-old')).toBe(true)
  })

  test('does NOT remove tool-state agent regardless of age', () => {
    injectAgentWithAge('tool-old', 'tool', 90_000) // 1.5 min old — still active

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('tool-old')).toBe(true)
  })

  test('does NOT remove writing-state agent regardless of age', () => {
    injectAgentWithAge('writing-old', 'writing', 60_000)

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('writing-old')).toBe(true)
  })

  test('does NOT remove idle agents regardless of age (prevents flicker)', () => {
    injectAgentWithAge('idle-stale', 'idle', 300_000) // 5 min old — idle agents persist

    useAgentArcadeStore.getState().cleanupStaleAgents()
    expect(useAgentArcadeStore.getState().agents.has('idle-stale')).toBe(true)
  })

  test('does NOT remove idle agents even with custom staleMs', () => {
    injectAgentWithAge('idle-custom', 'idle', 600_000) // 10 min old

    useAgentArcadeStore.getState().cleanupStaleAgents(5_000) // custom threshold — still shouldn't remove idle
    expect(useAgentArcadeStore.getState().agents.has('idle-custom')).toBe(true)
  })

  test('selectively removes only stale agents, preserving active ones', () => {
    injectAgentWithAge('will-be-removed', 'done', 35_000) // stale (> 30s threshold)
    injectAgentWithAge('must-stay', 'thinking', 60_000)   // active — never removed

    useAgentArcadeStore.getState().cleanupStaleAgents()

    expect(useAgentArcadeStore.getState().agents.has('will-be-removed')).toBe(false)
    expect(useAgentArcadeStore.getState().agents.has('must-stay')).toBe(true)
  })

  test('agentsList is updated after cleanup', () => {
    injectAgentWithAge('list-gone', 'done', 35_000) // > 30s threshold
    injectAgentWithAge('list-stays', 'thinking', 5_000)

    useAgentArcadeStore.getState().cleanupStaleAgents()

    const list = useAgentArcadeStore.getState().agentsList
    const ids = list.map(a => a.id)
    expect(ids).not.toContain('list-gone')
    expect(ids).toContain('list-stays')
  })
})

// ── loadState normalization ───────────────────────────────────────────────

describe('loadState normalizes agents', () => {
  test('adds missing errorCount field (defaults to 0)', () => {
    const store = useAgentArcadeStore.getState()
    store.loadState(
      [{
        id: 'norm-1',
        sessionId: 's',
        name: 'Bot',
        role: 'worker',
        state: 'idle',
        label: '',
        progress: 0,
        tools: [],
        messages: [],
        lastUpdate: Date.now(),
        // errorCount intentionally omitted — loadState should normalize it
      } as Agent],
      [],
    )

    const agent = useAgentArcadeStore.getState().agents.get('norm-1')
    expect(agent).toBeDefined()
    expect(agent!.errorCount).toBe(0)
  })

  test('adds missing recoveryCount field (defaults to 0)', () => {
    const store = useAgentArcadeStore.getState()
    store.loadState(
      [{
        id: 'norm-2',
        sessionId: 's',
        name: 'Bot',
        role: 'worker',
        state: 'idle',
        label: '',
        progress: 0,
        tools: [],
        messages: [],
        lastUpdate: Date.now(),
        // recoveryCount intentionally omitted — loadState should normalize it
      } as Agent],
      [],
    )

    const agent = useAgentArcadeStore.getState().agents.get('norm-2')
    expect(agent).toBeDefined()
    expect(agent!.recoveryCount).toBe(0)
  })

  test('preserves existing errorCount and recoveryCount values', () => {
    const store = useAgentArcadeStore.getState()
    store.loadState(
      [{
        id: 'norm-3',
        sessionId: 's',
        name: 'Bot',
        role: 'worker',
        state: 'error',
        label: 'crashed',
        progress: 0.5,
        tools: ['bash'],
        messages: ['oops'],
        lastUpdate: Date.now(),
        errorCount: 3,
        recoveryCount: 2,
      } as Agent],
      [],
    )

    const agent = useAgentArcadeStore.getState().agents.get('norm-3')
    expect(agent).toBeDefined()
    expect(agent!.errorCount).toBe(3)
    expect(agent!.recoveryCount).toBe(2)
  })

  test('replaces all existing agents on loadState call', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'old-agent', payload: { name: 'OldBot' } }))
    expect(useAgentArcadeStore.getState().agents.has('old-agent')).toBe(true)

    store.loadState(
      [{
        id: 'new-agent',
        sessionId: 's',
        name: 'NewBot',
        role: 'worker',
        state: 'idle',
        label: '',
        progress: 0,
        tools: [],
        messages: [],
        lastUpdate: Date.now(),
      } as Agent],
      [],
    )

    expect(useAgentArcadeStore.getState().agents.has('old-agent')).toBe(false)
    expect(useAgentArcadeStore.getState().agents.has('new-agent')).toBe(true)
  })
})

// ── processEvent: agent.end ───────────────────────────────────────────────

describe('processEvent: agent.end sets correct fields', () => {
  test('agent.end sets state=done, progress=1, label=reason', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'end-test', payload: { name: 'EndBot' } }))
    store.processEvent(makeEvent({
      type: 'agent.end',
      agentId: 'end-test',
      payload: { reason: 'Mission accomplished' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('end-test')
    expect(agent).toBeDefined()
    expect(agent!.state).toBe('done')
    expect(agent!.progress).toBe(1)
    expect(agent!.label).toBe('Mission accomplished')
  })

  test('agent.end without reason defaults label to "Completed"', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'end-no-reason', payload: { name: 'Bot' } }))
    store.processEvent(makeEvent({
      type: 'agent.end',
      agentId: 'end-no-reason',
      payload: {},
    }))

    const agent = useAgentArcadeStore.getState().agents.get('end-no-reason')
    expect(agent!.label).toBe('Completed')
    expect(agent!.state).toBe('done')
    expect(agent!.progress).toBe(1)
  })
})

// ── processEvent: error state increments errorCount ──────────────────────

describe('processEvent: agent.state with error increments errorCount', () => {
  test('first error sets errorCount to 1', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'err-count-1', payload: { name: 'ErrorBot' } }))
    store.processEvent(makeEvent({
      type: 'agent.state',
      agentId: 'err-count-1',
      payload: { state: 'error', label: 'Network timeout' },
    }))

    const agent = useAgentArcadeStore.getState().agents.get('err-count-1')
    expect(agent).toBeDefined()
    expect(agent!.state).toBe('error')
    expect(agent!.errorCount).toBe(1)
  })

  test('multiple errors accumulate errorCount', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'err-count-2', payload: { name: 'ErrorBot' } }))
    // First error
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'err-count-2', payload: { state: 'error', label: 'Fail 1' } }))
    // Recover
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'err-count-2', payload: { state: 'thinking', label: 'Retrying' } }))
    // Second error
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'err-count-2', payload: { state: 'error', label: 'Fail 2' } }))

    const agent = useAgentArcadeStore.getState().agents.get('err-count-2')
    expect(agent!.errorCount).toBe(2)
  })

  test('non-error state transition does NOT increment errorCount', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'no-err', payload: { name: 'CleanBot' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'no-err', payload: { state: 'thinking', label: 'Working' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'no-err', payload: { state: 'writing', label: 'Writing' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'no-err', payload: { state: 'done', label: 'Done' } }))

    const agent = useAgentArcadeStore.getState().agents.get('no-err')
    expect(agent!.errorCount).toBe(0)
  })
})

// ── processEvent: recovery increments recoveryCount ──────────────────────

describe('processEvent: recovery from error increments recoveryCount', () => {
  test('transition from error to thinking increments recoveryCount', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'recovery-1', payload: { name: 'RecoveryBot' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-1', payload: { state: 'error', label: 'Failed' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-1', payload: { state: 'thinking', label: 'Retrying...' } }))

    const agent = useAgentArcadeStore.getState().agents.get('recovery-1')
    expect(agent).toBeDefined()
    expect(agent!.state).toBe('thinking')
    expect(agent!.recoveryCount).toBe(1)
  })

  test('transition from error to reading also counts as recovery', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'recovery-2', payload: { name: 'RecoveryBot' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-2', payload: { state: 'error', label: 'Failed' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-2', payload: { state: 'reading', label: 'Re-reading docs' } }))

    const agent = useAgentArcadeStore.getState().agents.get('recovery-2')
    expect(agent!.recoveryCount).toBe(1)
  })

  test('multiple recovery cycles accumulate recoveryCount correctly', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'recovery-3', payload: { name: 'ResilientBot' } }))
    // Cycle 1
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'error', label: 'Fail 1' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'thinking', label: 'Retry 1' } }))
    // Cycle 2
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'error', label: 'Fail 2' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'writing', label: 'Retry 2' } }))
    // Cycle 3
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'error', label: 'Fail 3' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'recovery-3', payload: { state: 'tool', label: 'Retry 3' } }))

    const agent = useAgentArcadeStore.getState().agents.get('recovery-3')
    expect(agent!.errorCount).toBe(3)
    expect(agent!.recoveryCount).toBe(3)
  })

  test('non-error → non-error transition does NOT increment recoveryCount', () => {
    const store = useAgentArcadeStore.getState()
    store.processEvent(makeEvent({ type: 'agent.spawn', agentId: 'no-recovery', payload: { name: 'StableBot' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'no-recovery', payload: { state: 'thinking', label: 'Step 1' } }))
    store.processEvent(makeEvent({ type: 'agent.state', agentId: 'no-recovery', payload: { state: 'writing', label: 'Step 2' } }))

    const agent = useAgentArcadeStore.getState().agents.get('no-recovery')
    expect(agent!.recoveryCount).toBe(0)
  })
})
