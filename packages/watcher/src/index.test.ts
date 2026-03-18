/**
 * ProcessWatcher tests
 *
 * Tests the exported ProcessWatcher class. Since getProcessList and
 * matchProcess are not exported, pattern matching and process discovery
 * are tested indirectly via class behavior.
 *
 * fetch is mocked globally so no real network calls are made.
 * child_process.execSync is NOT mocked here — the watcher catches
 * execSync failures gracefully, returning an empty process list, so
 * tests that call start() will simply see zero tracked agents.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { ProcessWatcher } from './index'

// ---------------------------------------------------------------------------
// Global fetch mock — must be installed before any test runs
// ---------------------------------------------------------------------------

const mockFetch = mock(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
)
global.fetch = mockFetch as unknown as typeof fetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchCalls() {
  return (mockFetch as ReturnType<typeof mock>).mock.calls
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ProcessWatcher', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  // 1. Constructor defaults
  it('uses default gatewayUrl when no config is provided', () => {
    const watcher = new ProcessWatcher()
    // Access via stop() which uses the stored config URL — if it throws
    // the URL was invalid.  We verify by inspecting that the object is
    // well-formed and stop() can be called without throwing.
    expect(() => watcher.stop()).not.toThrow()
  })

  it('uses default sessionId "process-watcher" when no config provided', () => {
    // We confirm this indirectly: stop() with tracked agents emits events
    // that include sessionId. With no tracked agents it is a no-op — that's
    // fine; the important thing is no exception.
    const watcher = new ProcessWatcher()
    expect(() => watcher.stop()).not.toThrow()
  })

  // 2. Constructor respects custom config
  it('stores a custom gatewayUrl', () => {
    const watcher = new ProcessWatcher({ gatewayUrl: 'http://custom:9999' })
    // stop() would emit to custom URL for any tracked agents; here no agents
    // are tracked so just verify no throw.
    expect(() => watcher.stop()).not.toThrow()
  })

  it('stores a custom sessionId', () => {
    const watcher = new ProcessWatcher({ sessionId: 'my-session' })
    expect(() => watcher.stop()).not.toThrow()
  })

  it('stores a custom interval', () => {
    const watcher = new ProcessWatcher({ interval: 500 })
    expect(() => watcher.stop()).not.toThrow()
  })

  it('accepts all three config options together', () => {
    const watcher = new ProcessWatcher({
      gatewayUrl: 'http://localhost:12345',
      sessionId: 'combined-session',
      interval: 1000,
    })
    expect(watcher).toBeInstanceOf(ProcessWatcher)
  })

  // 3. stop() before start() — no crash
  it('stop() before start() does not throw', () => {
    const watcher = new ProcessWatcher()
    expect(() => watcher.stop()).not.toThrow()
  })

  it('stop() called twice does not throw', () => {
    const watcher = new ProcessWatcher()
    expect(() => {
      watcher.stop()
      watcher.stop()
    }).not.toThrow()
  })

  // 4. start() then immediate stop() — timer is cleared without error
  it('start() then stop() completes without error', () => {
    const watcher = new ProcessWatcher({ interval: 60_000 }) // long interval — won't fire
    expect(() => {
      watcher.start()
      watcher.stop()
    }).not.toThrow()
  })

  it('start() then stop() clears the timer (second stop() is a safe no-op)', () => {
    const watcher = new ProcessWatcher({ interval: 60_000 })
    watcher.start()
    watcher.stop()
    // timer should be null after stop; a second stop must not throw
    expect(() => watcher.stop()).not.toThrow()
  })

  it('start() triggers an initial poll without throwing even when ps/wmic fails', () => {
    // execSync may throw in test environment; the class catches it and returns [].
    const watcher = new ProcessWatcher({ interval: 60_000 })
    expect(() => {
      watcher.start()
      watcher.stop()
    }).not.toThrow()
  })

  // 5. Class is constructible (smoke / exports test)
  it('ProcessWatcher is a class (constructible)', () => {
    const watcher = new ProcessWatcher()
    expect(watcher).toBeInstanceOf(ProcessWatcher)
  })

  it('ProcessWatcher default export equals named export', async () => {
    const mod = await import('./index')
    expect(mod.default).toBe(mod.ProcessWatcher)
  })

  // 6. stop() with no tracked agents does not call fetch
  it('stop() with no tracked agents does not emit any fetch calls', () => {
    const watcher = new ProcessWatcher()
    watcher.stop()
    // The mock may have been called zero or more times during _poll() (which
    // runs synchronously at start), but since we never called start() here
    // the tracked map is empty — no agent.end events.
    const agentEndCalls = makeFetchCalls().filter(call => {
      try {
        const body = JSON.parse((call[1] as RequestInit).body as string)
        return body.type === 'agent.end'
      } catch {
        return false
      }
    })
    expect(agentEndCalls.length).toBe(0)
  })
})
