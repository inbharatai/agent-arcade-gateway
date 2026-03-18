/**
 * @agent-arcade/adapter-langchain — unit tests
 *
 * Tests AgentArcadeCallbackHandler without making real API calls or
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
const { AgentArcadeCallbackHandler, createArcadeCallback } = await import('./index')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const arcadeOpts = { gatewayUrl: 'http://localhost:47890', sessionId: 'test-session' }

function resetMocks() {
  Object.values(mockArcade).forEach(m => m.mockClear())
}

function makeHandler() {
  return new AgentArcadeCallbackHandler(arcadeOpts)
}

// ---------------------------------------------------------------------------
// LLM lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — LLM lifecycle', () => {
  beforeEach(resetMocks)

  it('handleLLMStart → handleLLMEnd: spawns agent, emits thinking state, ends successfully', () => {
    const handler = makeHandler()
    const runId = 'run-llm-1'

    handler.handleLLMStart({ name: 'gpt-4o' }, ['Hello'], runId)

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.spawn.mock.calls[0][0]).toMatchObject({ role: 'llm' })

    const statesAfterStart = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(statesAfterStart).toContain('thinking')

    handler.handleLLMEnd({ generations: [] }, runId)

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// LLM token streaming
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — LLM token streaming', () => {
  beforeEach(resetMocks)

  it('emits writing state after every 10th token', () => {
    const handler = makeHandler()
    const runId = 'run-stream-1'

    handler.handleLLMStart({ name: 'gpt-4o' }, ['Prompt'], runId)
    mockArcade.state.mockClear()

    // Fire 10 tokens — 10th should trigger a writing state
    for (let i = 1; i <= 10; i++) {
      handler.handleLLMNewToken('tok', i, runId)
    }

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('writing')
  })

  it('does NOT emit writing state before 10 tokens', () => {
    const handler = makeHandler()
    const runId = 'run-stream-2'

    handler.handleLLMStart({ name: 'gpt-4o' }, ['Prompt'], runId)
    mockArcade.state.mockClear()

    // Fire only 9 tokens — no writing event should have been emitted
    for (let i = 1; i <= 9; i++) {
      handler.handleLLMNewToken('tok', i, runId)
    }

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).not.toContain('writing')
  })
})

// ---------------------------------------------------------------------------
// LLM error
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — LLM error', () => {
  beforeEach(resetMocks)

  it('handleLLMStart → handleLLMError: emits error state and ends with success:false', () => {
    const handler = makeHandler()
    const runId = 'run-llm-err-1'

    handler.handleLLMStart({ name: 'gpt-4o' }, ['Hello'], runId)
    handler.handleLLMError(new Error('Rate limit exceeded'), runId)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// Chain lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Chain lifecycle', () => {
  beforeEach(resetMocks)

  it('handleChainStart → handleChainEnd: spawns agent, emits thinking, ends successfully', () => {
    const handler = makeHandler()
    const runId = 'run-chain-1'

    handler.handleChainStart({ name: 'MyChain' }, { input: 'test' }, runId)

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    const statesAfterStart = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(statesAfterStart).toContain('thinking')

    handler.handleChainEnd({ output: 'result' }, runId)

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Chain error
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Chain error', () => {
  beforeEach(resetMocks)

  it('handleChainStart → handleChainError: emits error state and ends with success:false', () => {
    const handler = makeHandler()
    const runId = 'run-chain-err-1'

    handler.handleChainStart({ name: 'FailChain' }, { input: 'bad' }, runId)
    handler.handleChainError(new Error('Chain exploded'), runId)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// Tool lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Tool lifecycle', () => {
  beforeEach(resetMocks)

  it('handleToolStart → handleToolEnd: spawns agent, calls arcade.tool() with tool name, ends successfully', () => {
    const handler = makeHandler()
    const runId = 'run-tool-1'

    handler.handleToolStart({ name: 'search_web' }, 'query text', runId)

    expect(mockArcade.spawn).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('search_web')

    handler.handleToolEnd('{"results": []}', runId)

    expect(mockArcade.message).toHaveBeenCalledTimes(1)
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Tool error
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Tool error', () => {
  beforeEach(resetMocks)

  it('handleToolStart → handleToolError: emits error state and ends with success:false', () => {
    const handler = makeHandler()
    const runId = 'run-tool-err-1'

    handler.handleToolStart({ name: 'broken_tool' }, 'input', runId)
    handler.handleToolError(new Error('Tool failed'), runId)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('error')

    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// Retriever lifecycle
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Retriever lifecycle', () => {
  beforeEach(resetMocks)

  it('handleRetrieverStart → handleRetrieverEnd: emits reading state and tool=retriever', () => {
    const handler = makeHandler()
    const runId = 'run-ret-1'

    handler.handleRetrieverStart({ name: 'VectorStore' }, 'find documents', runId)

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('reading')

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('retriever')

    handler.handleRetrieverEnd([{ id: 'doc1' }, { id: 'doc2' }], runId)

    expect(mockArcade.message).toHaveBeenCalledTimes(1)
    expect(mockArcade.end).toHaveBeenCalledTimes(1)
    expect(mockArcade.end.mock.calls[0][1]).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// Agent action
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Agent action', () => {
  beforeEach(resetMocks)

  it('handleAgentAction: calls arcade.tool() with action.tool name', () => {
    const handler = makeHandler()
    const runId = 'run-agent-1'

    // Must have an existing run for the agent action to be attributed
    handler.handleChainStart({ name: 'AgentChain' }, { input: 'go' }, runId)
    mockArcade.tool.mockClear()
    mockArcade.state.mockClear()

    handler.handleAgentAction(
      { tool: 'calculator', toolInput: '2 + 2', log: 'Using calculator' },
      runId,
    )

    expect(mockArcade.tool).toHaveBeenCalledTimes(1)
    expect(mockArcade.tool.mock.calls[0][1]).toBe('calculator')

    const states = mockArcade.state.mock.calls.map((c: any[]) => c[1])
    expect(states).toContain('tool')
  })
})

// ---------------------------------------------------------------------------
// Parent-child linking
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — Parent-child linking', () => {
  beforeEach(resetMocks)

  it('handleLLMStart with parentRunId: calls arcade.link() when parent run exists', () => {
    const handler = makeHandler()
    const parentRunId = 'run-parent-1'
    const childRunId = 'run-child-1'

    // Establish a parent run first
    handler.handleChainStart({ name: 'ParentChain' }, { input: 'x' }, parentRunId)

    // Now spawn a child LLM that references the parent
    handler.handleLLMStart({ name: 'gpt-4o' }, ['prompt'], childRunId, parentRunId)

    expect(mockArcade.link).toHaveBeenCalledTimes(1)
  })

  it('does NOT call arcade.link() when parentRunId is absent', () => {
    const handler = makeHandler()

    handler.handleLLMStart({ name: 'gpt-4o' }, ['prompt'], 'run-no-parent')

    expect(mockArcade.link).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('AgentArcadeCallbackHandler — disconnect', () => {
  beforeEach(resetMocks)

  it('calls arcade.disconnect()', () => {
    const handler = makeHandler()
    handler.disconnect()
    expect(mockArcade.disconnect).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// createArcadeCallback factory
// ---------------------------------------------------------------------------

describe('createArcadeCallback factory', () => {
  beforeEach(resetMocks)

  it('returns an AgentArcadeCallbackHandler instance', () => {
    const handler = createArcadeCallback(arcadeOpts)
    expect(handler).toBeInstanceOf(AgentArcadeCallbackHandler)
  })
})
