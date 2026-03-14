/**
 * @agent-arcade/adapter-langchain
 *
 * Auto-instruments LangChain applications to emit Agent Arcade telemetry.
 * Wrap your chains, agents, and retrievers -- see them come alive in the Arcade.
 *
 * Usage:
 *   import { createArcadeCallback } from '@agent-arcade/adapter-langchain'
 *   const cb = createArcadeCallback({ gatewayUrl: 'http://localhost:8787', sessionId: 'demo' })
 *   const result = await chain.invoke({ input: 'Hello' }, { callbacks: [cb] })
 *   cb.disconnect()
 */

import { AgentArcade } from '@agent-arcade/sdk-node'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcadeCallbackOptions {
  /** Gateway URL, e.g. http://localhost:8787 */
  gatewayUrl: string
  /** Session identifier */
  sessionId: string
  /** Optional auth token or API key */
  apiKey?: string
  /** Prefix for auto-generated agent names (default: "LC") */
  agentNamePrefix?: string
  /** Automatically spawn agents on LLM/Chain/Tool start (default: true) */
  autoSpawn?: boolean
  /** Track token usage from LLM responses (default: true) */
  trackTokens?: boolean
}

interface RunInfo {
  agentId: string
  name: string
  startTime: number
  parentRunId?: string
  tokenCount: number
}

// ---------------------------------------------------------------------------
// LangChain Callback Handler
// ---------------------------------------------------------------------------

/**
 * LangChain BaseCallbackHandler that emits Agent Arcade telemetry events.
 *
 * Intercepts LLM, Chain, Tool, Retriever, and Agent lifecycle events and
 * translates them into the Agent Arcade protocol for real-time visualization.
 */
export class AgentArcadeCallbackHandler {
  name = 'AgentArcadeCallbackHandler'
  private arcade: AgentArcade
  private runs = new Map<string, RunInfo>()
  private prefix: string
  private autoSpawn: boolean
  private trackTokens: boolean

  constructor(options: ArcadeCallbackOptions) {
    this.arcade = new AgentArcade({
      url: options.gatewayUrl,
      sessionId: options.sessionId,
      apiKey: options.apiKey,
    })
    this.prefix = options.agentNamePrefix ?? 'LC'
    this.autoSpawn = options.autoSpawn !== false
    this.trackTokens = options.trackTokens !== false
  }

  /** Gracefully disconnect from the gateway */
  disconnect(): void {
    // End any still-running agents
    for (const [, run] of this.runs) {
      this.arcade.end(run.agentId, { reason: 'Session ended', success: true })
    }
    this.runs.clear()
    this.arcade.disconnect()
  }

  /** Get the underlying AgentArcade SDK instance */
  getArcade(): AgentArcade {
    return this.arcade
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private getOrCreateRun(runId: string, name: string, role: string, parentRunId?: string): RunInfo {
    let run = this.runs.get(runId)
    if (!run) {
      const agentId = this.autoSpawn
        ? this.arcade.spawn({ name: `${this.prefix}:${name}`, role })
        : `${this.prefix}_${runId.slice(0, 8)}`
      run = { agentId, name, startTime: Date.now(), parentRunId, tokenCount: 0 }
      this.runs.set(runId, run)

      // Link child to parent
      if (parentRunId) {
        const parent = this.runs.get(parentRunId)
        if (parent) {
          this.arcade.link(parent.agentId, run.agentId)
        }
      }
    }
    return run
  }

  private endRun(runId: string, success: boolean, reason?: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    const elapsed = Date.now() - run.startTime
    this.arcade.end(run.agentId, {
      reason: reason || `Completed in ${elapsed}ms`,
      success,
    })
    this.runs.delete(runId)
  }

  // ── LLM Callbacks ───────────────────────────────────────────────────

  /** Called when an LLM starts generating */
  handleLLMStart(
    llm: { id?: string[]; name?: string },
    prompts: string[],
    runId: string,
    parentRunId?: string,
  ): void {
    const name = llm.name || llm.id?.join('/') || 'LLM'
    const run = this.getOrCreateRun(runId, name, 'llm', parentRunId)
    this.arcade.state(run.agentId, 'thinking', {
      label: `Processing ${prompts.length} prompt(s)`,
    })
  }

  /** Called on each new token during streaming */
  handleLLMNewToken(token: string, _idx: number, runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.tokenCount++
    // Update every 10 tokens to avoid flooding
    if (run.tokenCount % 10 === 0) {
      this.arcade.state(run.agentId, 'writing', {
        label: `Generating... (${run.tokenCount} tokens)`,
      })
    }
  }

  /** Called when LLM finishes */
  handleLLMEnd(output: { generations?: unknown[][]; llmOutput?: Record<string, unknown> }, runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return

    // Extract token usage if available
    if (this.trackTokens && output.llmOutput) {
      const usage = output.llmOutput.tokenUsage as Record<string, number> | undefined
      if (usage) {
        this.arcade.message(run.agentId, `Tokens: ${usage.totalTokens || 'N/A'} (prompt: ${usage.promptTokens || '?'}, completion: ${usage.completionTokens || '?'})`)
      }
    }

    this.endRun(runId, true, `Generated ${run.tokenCount} tokens`)
  }

  /** Called when LLM encounters an error */
  handleLLMError(error: Error, runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.state(run.agentId, 'error', { label: error.message.slice(0, 200) })
    }
    this.endRun(runId, false, `Error: ${error.message.slice(0, 100)}`)
  }

  // ── Chain Callbacks ─────────────────────────────────────────────────

  /** Called when a chain starts */
  handleChainStart(
    chain: { id?: string[]; name?: string },
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
  ): void {
    const name = chain.name || chain.id?.join('/') || 'Chain'
    const run = this.getOrCreateRun(runId, name, 'chain', parentRunId)
    const inputKeys = Object.keys(inputs).join(', ')
    this.arcade.state(run.agentId, 'thinking', {
      label: `Processing [${inputKeys}]`,
    })
  }

  /** Called when a chain finishes */
  handleChainEnd(_outputs: Record<string, unknown>, runId: string): void {
    this.endRun(runId, true)
  }

  /** Called when a chain encounters an error */
  handleChainError(error: Error, runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.state(run.agentId, 'error', { label: error.message.slice(0, 200) })
    }
    this.endRun(runId, false, `Error: ${error.message.slice(0, 100)}`)
  }

  // ── Tool Callbacks ──────────────────────────────────────────────────

  /** Called when a tool starts execution */
  handleToolStart(
    tool: { id?: string[]; name?: string },
    input: string,
    runId: string,
    parentRunId?: string,
  ): void {
    const name = tool.name || tool.id?.join('/') || 'Tool'
    const run = this.getOrCreateRun(runId, name, 'tool', parentRunId)
    this.arcade.tool(run.agentId, name, { label: input.slice(0, 200) })
    this.arcade.state(run.agentId, 'tool', { label: `Running ${name}` })
  }

  /** Called when a tool finishes */
  handleToolEnd(output: string, runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.message(run.agentId, output.slice(0, 500))
    }
    this.endRun(runId, true)
  }

  /** Called when a tool encounters an error */
  handleToolError(error: Error, runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.state(run.agentId, 'error', { label: error.message.slice(0, 200) })
    }
    this.endRun(runId, false, `Tool error: ${error.message.slice(0, 100)}`)
  }

  // ── Retriever Callbacks ─────────────────────────────────────────────

  /** Called when a retriever starts fetching documents */
  handleRetrieverStart(
    retriever: { id?: string[]; name?: string },
    query: string,
    runId: string,
    parentRunId?: string,
  ): void {
    const name = retriever.name || 'Retriever'
    const run = this.getOrCreateRun(runId, name, 'retriever', parentRunId)
    this.arcade.state(run.agentId, 'reading', {
      label: `Searching: "${query.slice(0, 100)}"`,
    })
    this.arcade.tool(run.agentId, 'retriever', { label: query.slice(0, 200) })
  }

  /** Called when a retriever finishes */
  handleRetrieverEnd(documents: unknown[], runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.message(run.agentId, `Retrieved ${documents.length} document(s)`)
    }
    this.endRun(runId, true, `Retrieved ${documents.length} docs`)
  }

  /** Called when a retriever encounters an error */
  handleRetrieverError(error: Error, runId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.arcade.state(run.agentId, 'error', { label: error.message.slice(0, 200) })
    }
    this.endRun(runId, false, `Retriever error: ${error.message.slice(0, 100)}`)
  }

  // ── Agent Callbacks ─────────────────────────────────────────────────

  /** Called when an agent decides on an action */
  handleAgentAction(
    action: { tool: string; toolInput: string | Record<string, unknown>; log: string },
    runId: string,
  ): void {
    const run = this.runs.get(runId)
    if (!run) return
    const inputStr = typeof action.toolInput === 'string'
      ? action.toolInput
      : JSON.stringify(action.toolInput).slice(0, 200)
    this.arcade.tool(run.agentId, action.tool, { label: inputStr })
    this.arcade.state(run.agentId, 'tool', { label: `Using ${action.tool}` })
  }

  /** Called when an agent finishes */
  handleAgentEnd(output: { returnValues?: Record<string, unknown>; log?: string }, runId: string): void {
    this.endRun(runId, true, 'Agent completed')
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Agent Arcade callback handler for LangChain.
 *
 * @example
 * ```typescript
 * import { createArcadeCallback } from '@agent-arcade/adapter-langchain'
 *
 * const cb = createArcadeCallback({
 *   gatewayUrl: 'http://localhost:8787',
 *   sessionId: 'my-langchain-session',
 * })
 *
 * const result = await chain.invoke(
 *   { input: 'What is the weather?' },
 *   { callbacks: [cb] }
 * )
 *
 * cb.disconnect()
 * ```
 */
export function createArcadeCallback(options: ArcadeCallbackOptions): AgentArcadeCallbackHandler {
  return new AgentArcadeCallbackHandler(options)
}

export default AgentArcadeCallbackHandler
