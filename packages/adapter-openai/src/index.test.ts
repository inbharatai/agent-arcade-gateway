/**
 * @agent-arcade/adapter-openai — unit tests
 *
 * Tests the wrapOpenAI instrumentation without making real API calls or
 * connecting to the gateway. AgentArcade is mocked in-memory.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock AgentArcade SDK (no gateway connection)
// ---------------------------------------------------------------------------

const mockArcade = {
  spawn: mock(() => {}),
  state: mock(() => {}),
  tool: mock(() => {}),
  end: mock(() => {}),
  message: mock(() => {}),
  disconnect: mock(() => {}),
}

// Patch the module by overriding require cache before importing the adapter
mock.module('@agent-arcade/sdk-node', () => ({
  AgentArcade: class {
    constructor() {}
    spawn = mockArcade.spawn
    state = mockArcade.state
    tool = mockArcade.tool
    end = mockArcade.end
    message = mockArcade.message
    disconnect = mockArcade.disconnect
  },
}))

// Import AFTER mocking so the constructor picks up the mock
const { wrapOpenAI } = await import('./index')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockArcade.spawn.mockClear()
  mockArcade.state.mockClear()
  mockArcade.tool.mockClear()
  mockArcade.end.mockClear()
  mockArcade.message.mockClear()
  mockArcade.disconnect.mockClear()
}

function makeClient(createImpl: (params: any) => any) {
  return {
    chat: {
      completions: {
        create: createImpl,
      },
    },
  }
}

const arcadeOpts = { gatewayUrl: 'http://localhost:47890', sessionId: 'test-session' }

// ---------------------------------------------------------------------------
// Non-streaming: normal completion (no tool calls)
// ---------------------------------------------------------------------------

describe('wrapOpenAI — non-streaming chat completion', () => {
  beforeEach(resetMocks)

  it('spawns agent and emits writing + end for a normal completion', async () => {
    const client = makeClient(async (_params: any) => ({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello!' } }],
      usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] })

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ name: 'gpt-4o', role: 'chat' })

    // Should NOT emit tool — finish_reason is 'stop'
    expect(mockArcade.tool).not.toHaveBeenCalled()

    // Should emit writing state
    const stateArgs = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateArgs).toContain('writing')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })

  it('uses modelLabel override in spawn name', async () => {
    const client = makeClient(async () => ({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { total_tokens: 1, prompt_tokens: 1, completion_tokens: 0 },
    }))

    const wrapped = wrapOpenAI(client, { ...arcadeOpts, modelLabel: 'MyBot' })
    await wrapped.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [] })

    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ name: 'MyBot' })
  })
})

// ---------------------------------------------------------------------------
// Non-streaming: tool_calls finish_reason (modern tools API)
// ---------------------------------------------------------------------------

describe('wrapOpenAI — non-streaming tool_calls', () => {
  beforeEach(resetMocks)

  it('emits arcade.tool() for each tool call in response', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'search_web', arguments: '{}' } },
          ],
        },
      }],
      usage: { total_tokens: 20, prompt_tokens: 15, completion_tokens: 5 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], tools: [] })

    expect(mockArcade.tool).toHaveBeenCalledTimes(2)
    const toolNames = mockArcade.tool.mock.calls.map((c: any[]) => c[1])
    expect(toolNames).toContain('get_weather')
    expect(toolNames).toContain('search_web')

    // Label should include the tool name
    expect(mockArcade.tool.mock.calls[0][2]).toMatchObject({ label: 'Calling get_weather' })
  })

  it('emits tool state after tool calls', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [
            { type: 'function', function: { name: 'run_code', arguments: '{}' } },
          ],
        },
      }],
      usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] })

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('tool')
    // Should NOT emit writing state when tool calls present
    expect(states).not.toContain('writing')
  })

  it('shows plural label for multiple tool calls', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [
            { type: 'function', function: { name: 'fn_a', arguments: '{}' } },
            { type: 'function', function: { name: 'fn_b', arguments: '{}' } },
            { type: 'function', function: { name: 'fn_c', arguments: '{}' } },
          ],
        },
      }],
      usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] })

    // state('tool', { label: 'Tool calls (3)' })
    const toolStateCall = mockArcade.state.mock.calls.find((c: any[]) => c[1] === 'tool')
    expect(toolStateCall?.[2]?.label).toBe('Tool calls (3)')
  })

  it('still ends the agent after tool calls', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{ type: 'function', function: { name: 'noop', arguments: '{}' } }],
        },
      }],
      usage: { total_tokens: 3, prompt_tokens: 2, completion_tokens: 1 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] })

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Non-streaming: legacy function_call format
// ---------------------------------------------------------------------------

describe('wrapOpenAI — non-streaming legacy function_call', () => {
  beforeEach(resetMocks)

  it('emits arcade.tool() for legacy function_call finish_reason', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'function_call',
        message: {
          role: 'assistant',
          function_call: { name: 'send_email', arguments: '{"to":"a@b.com"}' },
        },
      }],
      usage: { total_tokens: 8, prompt_tokens: 6, completion_tokens: 2 },
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [] })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('send_email')
  })

  it('falls back to "function" name when function_call.name is missing', async () => {
    const client = makeClient(async () => ({
      choices: [{
        finish_reason: 'function_call',
        message: { function_call: {} }, // no name
      }],
      usage: null,
    }))

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await wrapped.chat.completions.create({ model: 'gpt-4', messages: [] })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Non-streaming: error path
// ---------------------------------------------------------------------------

describe('wrapOpenAI — non-streaming error handling', () => {
  beforeEach(resetMocks)

  it('emits error state + end(success:false) on API error', async () => {
    const client = makeClient(async () => {
      throw new Error('Rate limit exceeded')
    })

    const wrapped = wrapOpenAI(client, arcadeOpts)
    await expect(wrapped.chat.completions.create({ model: 'gpt-4o', messages: [] })).rejects.toThrow('Rate limit exceeded')

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// Streaming: tool call accumulation
// ---------------------------------------------------------------------------

describe('wrapOpenAI — streaming tool call detection', () => {
  beforeEach(resetMocks)

  function makeStreamingClient(chunks: any[]) {
    return makeClient(async () => {
      // Build an async iterable from the plain array
      async function* gen() { yield* chunks }
      return { [Symbol.asyncIterator]: () => gen() }
    })
  }

  it('accumulates tool names from streaming deltas and emits at stream end', async () => {
    const chunks = [
      // First chunk: tool call starts (name arrives here in delta)
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null }] },
      // Second chunk: arguments continue (no new name)
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '', arguments: '{"city":"NYC"}' } }] }, finish_reason: null }] },
      // Final chunk: finish_reason
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]

    const client = makeStreamingClient(chunks)
    const wrapped = wrapOpenAI(client, { ...arcadeOpts })
    const stream = await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true })

    // Consume the stream
    for await (const _chunk of stream) { /* noop */ }

    // Tool event should have been emitted
    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('get_weather')
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
  })

  it('deduplicates tool names that appear across multiple chunks', async () => {
    const chunks = [
      // 'search' appears in two chunks (streaming artifact where name is repeated)
      { choices: [{ delta: { tool_calls: [{ function: { name: 'search' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ function: { name: 'search' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]

    const client = makeStreamingClient(chunks)
    const wrapped = wrapOpenAI(client, arcadeOpts)
    const stream = await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true })
    for await (const _chunk of stream) {}

    // Should only emit once despite appearing in 2 chunks
    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
  })

  it('does NOT emit tool events for regular streaming (finish_reason: stop)', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
      { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]

    const client = makeStreamingClient(chunks)
    const wrapped = wrapOpenAI(client, arcadeOpts)
    const stream = await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true })
    for await (const _chunk of stream) {}

    expect(mockArcade.tool).not.toHaveBeenCalled()
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
  })

  it('handles legacy streaming function_call deltas', async () => {
    const chunks = [
      { choices: [{ delta: { function_call: { name: 'legacy_fn', arguments: '' } }, finish_reason: null }] },
      { choices: [{ delta: { function_call: { arguments: '{}' } }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'function_call' }] },
    ]

    const client = makeStreamingClient(chunks)
    const wrapped = wrapOpenAI(client, arcadeOpts)
    const stream = await wrapped.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true })
    for await (const _chunk of stream) {}

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('legacy_fn')
  })
})

// ---------------------------------------------------------------------------
// arcadeDisconnect
// ---------------------------------------------------------------------------

describe('wrapOpenAI — arcadeDisconnect', () => {
  beforeEach(resetMocks)

  it('exposes arcadeDisconnect that calls arcade.disconnect()', () => {
    const client = makeClient(async () => ({ choices: [], usage: null }))
    const wrapped = wrapOpenAI(client, arcadeOpts)
    ;(wrapped as any).arcadeDisconnect()
    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })
})
