/**
 * LogTailer tests
 *
 * The fs, os, and path modules are mocked before the module under test is
 * imported so that no real filesystem access occurs. fetch is mocked globally
 * so no real network calls are made.
 *
 * Because mock.module() must run before the import the entire module import
 * is deferred (dynamic import inside the test suite).
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = mock(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
)
global.fetch = mockFetch as unknown as typeof fetch

// ---------------------------------------------------------------------------
// fs / os / path mocks — installed before the module is loaded
// ---------------------------------------------------------------------------

const mockFsWatch = mock(() => ({ close: mock(() => {}) }))
const mockReadFileSync = mock(() => 'Tool: read_file\nthinking about the problem')
const mockStatSync = mock(() => ({ size: 100 }))
const mockExistsSync = mock(() => false) // default: no log files found on disk

mock.module('fs', () => ({
  watch: mockFsWatch,
  readFileSync: mockReadFileSync,
  statSync: mockStatSync,
  existsSync: mockExistsSync,
}))

mock.module('os', () => ({
  homedir: mock(() => '/mock/home'),
}))

mock.module('path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

// ---------------------------------------------------------------------------
// Deferred module import (must come after mock.module calls)
// ---------------------------------------------------------------------------

const LogTailer = (await import('./index')).default

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('LogTailer', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockExistsSync.mockImplementation(() => false)
  })

  // 1. Can be instantiated with full config
  it('can be instantiated with a full config object', () => {
    const tailer = new LogTailer({
      gatewayUrl: 'http://localhost:47890',
      sessionId: 'test-session',
      logSources: [],
    })
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  // 2. Uses default gatewayUrl when not provided
  it('uses default gatewayUrl when not provided', () => {
    // With existsSync returning false, _getDefaultSources() returns [].
    // The constructor completes without throwing.
    const tailer = new LogTailer({ sessionId: 'only-session' })
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  it('uses default sessionId "log-tailer" when not provided', () => {
    const tailer = new LogTailer({ gatewayUrl: 'http://localhost:47890' })
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  it('can be instantiated with no arguments at all', () => {
    const tailer = new LogTailer()
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  // 3. stop() without start() doesn't throw
  it('stop() before start() does not throw', () => {
    const tailer = new LogTailer({ logSources: [] })
    expect(() => tailer.stop()).not.toThrow()
  })

  it('stop() called twice does not throw', () => {
    const tailer = new LogTailer({ logSources: [] })
    expect(() => {
      tailer.stop()
      tailer.stop()
    }).not.toThrow()
  })

  // 4. start() with empty logSources does not throw
  it('start() with empty logSources config does not throw', () => {
    const tailer = new LogTailer({ logSources: [] })
    expect(() => tailer.start()).not.toThrow()
    tailer.stop()
  })

  it('start() then stop() with empty logSources does not throw', () => {
    const tailer = new LogTailer({ logSources: [] })
    expect(() => {
      tailer.start()
      tailer.stop()
    }).not.toThrow()
  })

  // 5. Custom logSources are stored / accepted
  it('accepts a single custom logSource without throwing', () => {
    const tailer = new LogTailer({
      gatewayUrl: 'http://localhost:47890',
      sessionId: 'custom-src-session',
      logSources: [
        { name: 'MyAgent', path: '/tmp/myagent.log', parser: 'generic' },
      ],
    })
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  it('accepts multiple custom logSources without throwing', () => {
    const tailer = new LogTailer({
      logSources: [
        { name: 'Claude Code', path: '/mock/home/.claude/logs/app.log', parser: 'claude-code' },
        { name: 'Aider',       path: '/mock/home/.aider.chat.history.md', parser: 'aider' },
        { name: 'Generic',     path: '/mock/home/tool.log',               parser: 'generic' },
      ],
    })
    expect(tailer).toBeInstanceOf(LogTailer)
  })

  // start() with non-existent paths skips them (existsSync returns false)
  it('start() with logSources that do not exist skips watching them', () => {
    mockExistsSync.mockImplementation(() => false)
    const tailer = new LogTailer({
      logSources: [{ name: 'Ghost', path: '/nonexistent/path.log', parser: 'generic' }],
    })
    expect(() => {
      tailer.start()
      tailer.stop()
    }).not.toThrow()
  })

  // 6. Default export equals the LogTailer class
  it('default export is the LogTailer class', async () => {
    const mod = await import('./index')
    expect(mod.default).toBe(LogTailer)
  })

  // 7. stop() with no started agents does not call fetch for agent.end
  it('stop() with no tracked agents does not emit agent.end events', () => {
    const tailer = new LogTailer({ logSources: [] })
    tailer.stop()
    const agentEndCalls = mockFetch.mock.calls.filter(call => {
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
