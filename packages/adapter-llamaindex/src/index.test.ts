/**
 * @agent-arcade/adapter-llamaindex — unit tests
 *
 * Tests AgentArcadeLlamaIndexHandler without making real API calls or
 * connecting to the gateway. AgentArcade is mocked in-memory.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock AgentArcade SDK (no gateway connection)
// ---------------------------------------------------------------------------

const mockArcade = {
  spawn: mock(() => 'agent-id-mock'),
  state: mock(() => {}),
  tool: mock(() => {}),
  end: mock(() => {}),
  message: mock(() => {}),
  link: mock(() => {}),
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
    link = mockArcade.link
    disconnect = mockArcade.disconnect
  },
}))

// Import AFTER mocking so the constructor picks up the mock
const { AgentArcadeLlamaIndexHandler, createLlamaIndexHandler } = await import('./index')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const handlerOpts = { gatewayUrl: 'http://localhost:47890', sessionId: 'test-session' }

function resetMocks() {
  Object.values(mockArcade).forEach(m => m.mockClear())
}

function makeHandler() {
  return new AgentArcadeLlamaIndexHandler(handlerOpts)
}

// ---------------------------------------------------------------------------
// Query lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — Query lifecycle', () => {
  beforeEach(resetMocks)

  it('onQueryStart → onQueryEnd: spawns agent, emits thinking state, sends message, ends successfully', () => {
    const handler = makeHandler()
    const queryId = 'query-1'

    handler.onQueryStart(queryId, 'What is the capital of France?')

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ role: 'query' })

    const statesAfterStart = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(statesAfterStart).toContain('thinking')

    handler.onQueryEnd(queryId, 'Paris is the capital of France.')

    expect(mockArcade.message).toHaveBeenCalledTimes(1)
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Retrieve lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — Retrieve lifecycle', () => {
  beforeEach(resetMocks)

  it('onRetrieveStart → onRetrieveEnd: emits reading state and tool=vector_search, ends successfully', () => {
    const handler = makeHandler()
    const retrieveId = 'retrieve-1'

    handler.onRetrieveStart(retrieveId, 'search query')

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('reading')

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('vector_search')

    handler.onRetrieveEnd(retrieveId, 5)

    expect(mockArcade.message).toHaveBeenCalledTimes(1)
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Synthesis lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — Synthesis lifecycle', () => {
  beforeEach(resetMocks)

  it('onSynthesizeStart → onSynthesizeEnd: spawns agent, emits writing state, ends successfully', () => {
    const handler = makeHandler()
    const synthId = 'synth-1'

    handler.onSynthesizeStart(synthId)

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ role: 'synthesizer' })

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('writing')

    handler.onSynthesizeEnd(synthId)

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// LLM lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — LLM lifecycle', () => {
  beforeEach(resetMocks)

  it('onLLMStart → onLLMEnd: spawns agent with model name, emits thinking, ends successfully', () => {
    const handler = makeHandler()
    const llmId = 'llm-1'

    handler.onLLMStart(llmId, 'gpt-4o')

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ role: 'llm' })

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('thinking')

    handler.onLLMEnd(llmId, 42)

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// LLM streaming — emits on multiples of 10
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — LLM streaming', () => {
  beforeEach(resetMocks)

  it('onLLMStream(id, 10): emits writing state because 10 % 10 === 0', () => {
    const handler = makeHandler()
    const llmId = 'llm-stream-1'

    handler.onLLMStart(llmId, 'gpt-4o')
    mockArcade.state.mockClear()

    handler.onLLMStream(llmId, 10)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('writing')
  })

  it('onLLMStream(id, 5): does NOT emit writing state because 5 % 10 !== 0', () => {
    const handler = makeHandler()
    const llmId = 'llm-stream-2'

    handler.onLLMStart(llmId, 'gpt-4o')
    mockArcade.state.mockClear()

    handler.onLLMStream(llmId, 5)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).not.toContain('writing')
  })
})

// ---------------------------------------------------------------------------
// LLM error
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — LLM error', () => {
  beforeEach(resetMocks)

  it('onLLMStart → onLLMError: emits error state and ends with success:false', () => {
    const handler = makeHandler()
    const llmId = 'llm-err-1'

    handler.onLLMStart(llmId, 'gpt-4o')
    handler.onLLMError(llmId, 'Context length exceeded')

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// Embedding lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — Embedding lifecycle', () => {
  beforeEach(resetMocks)

  it('onEmbeddingStart → onEmbeddingEnd: spawns agent, emits reading state, ends successfully', () => {
    const handler = makeHandler()
    const embedId = 'embed-1'

    handler.onEmbeddingStart(embedId, 3)

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ role: 'embeddings' })

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('reading')

    handler.onEmbeddingEnd(embedId)

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// createLlamaIndexHandler factory
// ---------------------------------------------------------------------------

describe('createLlamaIndexHandler factory', () => {
  beforeEach(resetMocks)

  it('returns an AgentArcadeLlamaIndexHandler instance', () => {
    const handler = createLlamaIndexHandler(handlerOpts)
    expect(handler).toBeInstanceOf(AgentArcadeLlamaIndexHandler)
  })
})

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('AgentArcadeLlamaIndexHandler — disconnect', () => {
  beforeEach(resetMocks)

  it('calls arcade.disconnect()', () => {
    const handler = makeHandler()
    handler.disconnect()
    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })
})
