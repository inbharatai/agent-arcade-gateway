import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockArcade = {
  spawn: mock(() => 'test-agent-id'),
  state: mock(() => {}),
  tool: mock(() => {}),
  end: mock(() => {}),
  message: mock(() => {}),
  disconnect: mock(() => {}),
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
  },
}))

const { wrapAnthropic } = await import('./index')

function resetMocks() {
  Object.values(mockArcade).forEach((m: any) => m.mockClear())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(createImpl?: () => any) {
  return {
    messages: {
      create: createImpl ?? (async () => ({
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      })),
    },
  }
}

const BASE_OPTS = {
  gatewayUrl: 'http://localhost:47890',
  sessionId: 'test-session',
}

// ---------------------------------------------------------------------------
// Non-streaming tests
// ---------------------------------------------------------------------------

describe('wrapAnthropic — non-streaming', () => {
  beforeEach(resetMocks)

  it('calls spawn → thinking → writing → end(success:true) for a basic response', async () => {
    const client = makeClient()
    const wrapped = wrapAnthropic(client, BASE_OPTS)

    await wrapped.messages.create({ model: 'claude-test', messages: [{ role: 'user', content: 'Hi' }] })

    // spawn must be called once
    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)

    // state must include 'thinking' then 'writing'
    const stateCalls = mockArcade.state.mock.calls
    const stateNames = stateCalls.map((c: any[]) => c[1])
    expect(stateNames).toContain('thinking')
    expect(stateNames).toContain('writing')
    const thinkingIdx = stateNames.indexOf('thinking')
    const writingIdx = stateNames.indexOf('writing')
    expect(thinkingIdx).toBeLessThan(writingIdx)

    // end must be called with success: true
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })

  it('emits arcade.tool() for tool_use content blocks', async () => {
    const client = makeClient(async () => ({
      content: [
        { type: 'tool_use', name: 'my_tool', input: { query: 'hello' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 5 },
    }))
    const wrapped = wrapAnthropic(client, BASE_OPTS)

    await wrapped.messages.create({ model: 'claude-test', messages: [] })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('my_tool')
  })

  it('emits error state + end(success:false) and re-throws on API error', async () => {
    const apiError = new Error('rate limit exceeded')
    const client = makeClient(async () => { throw apiError })
    const wrapped = wrapAnthropic(client, BASE_OPTS)

    let thrown: Error | null = null
    try {
      await wrapped.messages.create({ model: 'claude-test', messages: [] })
    } catch (e: any) {
      thrown = e
    }

    expect(thrown).toBe(apiError)

    const stateCalls = mockArcade.state.mock.calls
    const stateNames = stateCalls.map((c: any[]) => c[1])
    expect(stateNames).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })

  it('does not crash when usage is null', async () => {
    const client = makeClient(async () => ({
      content: [],
      stop_reason: 'end_turn',
      usage: null,
    }))
    const wrapped = wrapAnthropic(client, BASE_OPTS)

    await expect(
      wrapped.messages.create({ model: 'claude-test', messages: [] }),
    ).resolves.toBeDefined()

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Streaming tests
// ---------------------------------------------------------------------------

describe('wrapAnthropic — streaming', () => {
  beforeEach(resetMocks)

  async function* makeEvents(events: object[]) {
    for (const ev of events) yield ev
  }

  function streamClient(events: object[]) {
    return makeClient(async () => {
      const gen = makeEvents(events)
      return { [Symbol.asyncIterator]: () => gen }
    })
  }

  async function drainStream(wrapped: any, params: object) {
    const stream = await wrapped.messages.create(params)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* consume */ }
  }

  it('emits arcade.state("writing") for content_block_start with type text', async () => {
    const client = streamClient([
      { type: 'content_block_start', content_block: { type: 'text' } },
      { type: 'message_stop' },
    ])
    const wrapped = wrapAnthropic(client, BASE_OPTS)
    await drainStream(wrapped, { model: 'claude-test', messages: [], stream: true })

    const stateNames = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateNames).toContain('writing')
  })

  it('emits arcade.tool() for content_block_start with type tool_use', async () => {
    const client = streamClient([
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'search_tool' } },
      { type: 'message_stop' },
    ])
    const wrapped = wrapAnthropic(client, BASE_OPTS)
    await drainStream(wrapped, { model: 'claude-test', messages: [], stream: true })

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('search_tool')
  })

  it('emits arcade.state("thinking") for content_block_start with type thinking', async () => {
    const client = streamClient([
      { type: 'content_block_start', content_block: { type: 'thinking' } },
      { type: 'message_stop' },
    ])
    const wrapped = wrapAnthropic(client, BASE_OPTS)
    await drainStream(wrapped, { model: 'claude-test', messages: [], stream: true })

    const stateNames = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(stateNames).toContain('thinking')
  })

  it('emits arcade.end(success:true) on message_stop event', async () => {
    const client = streamClient([
      { type: 'message_stop' },
    ])
    const wrapped = wrapAnthropic(client, BASE_OPTS)
    await drainStream(wrapped, { model: 'claude-test', messages: [], stream: true })

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// arcadeDisconnect + edge cases
// ---------------------------------------------------------------------------

describe('wrapAnthropic — arcadeDisconnect and edge cases', () => {
  beforeEach(resetMocks)

  it('arcadeDisconnect calls arcade.disconnect()', () => {
    const client = makeClient()
    const wrapped = wrapAnthropic(client, BASE_OPTS)

    wrapped.arcadeDisconnect()

    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })

  it('client without messages.create is returned unchanged without crashing', () => {
    const bare: Record<string, any> = { someOtherMethod: () => 'untouched' }
    const wrapped = wrapAnthropic(bare, BASE_OPTS)

    // arcadeDisconnect is still attached
    expect(typeof wrapped.arcadeDisconnect).toBe('function')
    // original property preserved
    expect(wrapped.someOtherMethod()).toBe('untouched')
  })
})
