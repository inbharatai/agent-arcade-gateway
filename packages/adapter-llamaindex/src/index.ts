/**
 * @agent-arcade/adapter-llamaindex
 *
 * Auto-instruments LlamaIndex applications to emit Agent Arcade telemetry.
 * Captures query, retrieval, synthesis, embedding, and LLM events.
 *
 * Usage:
 *   import { createLlamaIndexHandler } from '@agent-arcade/adapter-llamaindex'
 *   const handler = createLlamaIndexHandler({
 *     gatewayUrl: 'http://localhost:8787',
 *     sessionId: 'my-rag-app',
 *   })
 *   // Set as callback manager in your LlamaIndex service context
 */

import { AgentArcade } from '@agent-arcade/sdk-node'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlamaIndexHandlerOptions {
  gatewayUrl: string
  sessionId: string
  apiKey?: string
  agentNamePrefix?: string
}

interface RunInfo {
  agentId: string
  name: string
  startTime: number
  parentRunId?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * LlamaIndex callback handler that emits Agent Arcade telemetry.
 *
 * Maps LlamaIndex lifecycle events to the Agent Arcade protocol:
 * - Query start/end -> agent spawn/end
 * - Retriever start/end -> reading state + tool events
 * - Synthesize start/end -> writing state
 * - LLM start/end -> thinking/writing states
 * - Embedding start/end -> reading state
 */
export class AgentArcadeLlamaIndexHandler {
  name = 'AgentArcadeLlamaIndexHandler'
  private arcade: AgentArcade
  private runs = new Map<string, RunInfo>()
  private prefix: string

  constructor(options: LlamaIndexHandlerOptions) {
    this.arcade = new AgentArcade({
      url: options.gatewayUrl,
      sessionId: options.sessionId,
      apiKey: options.apiKey,
    })
    this.prefix = options.agentNamePrefix ?? 'LI'
  }

  disconnect(): void {
    for (const [, run] of this.runs) {
      this.arcade.end(run.agentId, { reason: 'Session ended', success: true })
    }
    this.runs.clear()
    this.arcade.disconnect()
  }

  getArcade(): AgentArcade { return this.arcade }

  private _getOrCreateRun(runId: string, name: string, role: string, parentRunId?: string): RunInfo {
    let run = this.runs.get(runId)
    if (!run) {
      const agentId = this.arcade.spawn({ name: `${this.prefix}:${name}`, role })
      run = { agentId, name, startTime: Date.now(), parentRunId }
      this.runs.set(runId, run)
      if (parentRunId) {
        const parent = this.runs.get(parentRunId)
        if (parent) this.arcade.link(parent.agentId, run.agentId)
      }
    }
    return run
  }

  private _endRun(runId: string, success: boolean, reason?: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    const elapsed = Date.now() - run.startTime
    this.arcade.end(run.agentId, { reason: reason || `Completed in ${elapsed}ms`, success })
    this.runs.delete(runId)
  }

  // ── Query Events ────────────────────────────────────────────────────

  onQueryStart(queryId: string, query: string): void {
    const run = this._getOrCreateRun(queryId, 'Query Engine', 'query')
    this.arcade.state(run.agentId, 'thinking', { label: `Query: "${query.slice(0, 100)}"` })
  }

  onQueryEnd(queryId: string, response: string): void {
    const run = this.runs.get(queryId)
    if (run) {
      this.arcade.message(run.agentId, response.slice(0, 500))
    }
    this._endRun(queryId, true, 'Query complete')
  }

  // ── Retriever Events ────────────────────────────────────────────────

  onRetrieveStart(retrieveId: string, query: string, parentId?: string): void {
    const run = this._getOrCreateRun(retrieveId, 'Retriever', 'retriever', parentId)
    this.arcade.state(run.agentId, 'reading', { label: `Searching: "${query.slice(0, 100)}"` })
    this.arcade.tool(run.agentId, 'vector_search', { label: query.slice(0, 200) })
  }

  onRetrieveEnd(retrieveId: string, docCount: number): void {
    const run = this.runs.get(retrieveId)
    if (run) {
      this.arcade.message(run.agentId, `Retrieved ${docCount} document(s)`)
    }
    this._endRun(retrieveId, true, `Retrieved ${docCount} docs`)
  }

  // ── Synthesis Events ────────────────────────────────────────────────

  onSynthesizeStart(synthId: string, parentId?: string): void {
    const run = this._getOrCreateRun(synthId, 'Synthesizer', 'synthesizer', parentId)
    this.arcade.state(run.agentId, 'writing', { label: 'Synthesizing response...' })
  }

  onSynthesizeEnd(synthId: string): void {
    this._endRun(synthId, true, 'Synthesis complete')
  }

  // ── LLM Events ──────────────────────────────────────────────────────

  onLLMStart(llmId: string, model: string, parentId?: string): void {
    const run = this._getOrCreateRun(llmId, model || 'LLM', 'llm', parentId)
    this.arcade.state(run.agentId, 'thinking', { label: `Processing with ${model}` })
  }

  onLLMStream(llmId: string, tokenCount: number): void {
    const run = this.runs.get(llmId)
    if (run && tokenCount % 10 === 0) {
      this.arcade.state(run.agentId, 'writing', {
        label: `Generating... (${tokenCount} tokens)`,
        progress: Math.min(0.95, tokenCount / 500),
      })
    }
  }

  onLLMEnd(llmId: string, tokenCount: number): void {
    this._endRun(llmId, true, `Generated ${tokenCount} tokens`)
  }

  onLLMError(llmId: string, error: string): void {
    const run = this.runs.get(llmId)
    if (run) this.arcade.state(run.agentId, 'error', { label: error.slice(0, 200) })
    this._endRun(llmId, false, `Error: ${error.slice(0, 100)}`)
  }

  // ── Embedding Events ────────────────────────────────────────────────

  onEmbeddingStart(embedId: string, inputCount: number, parentId?: string): void {
    const run = this._getOrCreateRun(embedId, 'Embeddings', 'embeddings', parentId)
    this.arcade.state(run.agentId, 'reading', { label: `Embedding ${inputCount} input(s)` })
  }

  onEmbeddingEnd(embedId: string): void {
    this._endRun(embedId, true, 'Embeddings complete')
  }
}

/** Factory function */
export function createLlamaIndexHandler(options: LlamaIndexHandlerOptions): AgentArcadeLlamaIndexHandler {
  return new AgentArcadeLlamaIndexHandler(options)
}

export default AgentArcadeLlamaIndexHandler
