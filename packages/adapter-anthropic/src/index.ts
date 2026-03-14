/**
 * @agent-arcade/adapter-anthropic
 *
 * Auto-instruments Anthropic Claude SDK calls to emit Agent Arcade telemetry.
 * Handles streaming, tool use blocks, and extended thinking.
 *
 * Usage:
 *   import Anthropic from '@anthropic-ai/sdk'
 *   import { wrapAnthropic } from '@agent-arcade/adapter-anthropic'
 *
 *   const client = wrapAnthropic(new Anthropic(), {
 *     gatewayUrl: 'http://localhost:8787',
 *     sessionId: 'my-session',
 *   })
 *   const msg = await client.messages.create({ model: 'claude-sonnet-4-20250514', ... })
 */

import { AgentArcade } from '@agent-arcade/sdk-node'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcadeAnthropicOptions {
  /** Gateway URL, e.g. http://localhost:8787 */
  gatewayUrl: string
  /** Session identifier */
  sessionId: string
  /** Optional arcade auth token */
  apiKey?: string
  /** Auto-end session on disconnect (default: false) */
  autoEndSession?: boolean
  /** Track tool_use content blocks as agent.tool events (default: true) */
  trackToolUse?: boolean
}

let counter = 0
function uid(): string {
  return `claude_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an Anthropic client instance to emit Agent Arcade telemetry.
 *
 * Patches `messages.create` to track:
 * - Non-streaming: thinking -> writing -> done lifecycle
 * - Streaming: thinking -> writing (on content deltas) -> done
 * - Tool use blocks: emits agent.tool events with tool name and input
 * - Extended thinking: emits "thinking" state with summary label
 * - Token tracking: input_tokens + output_tokens from usage
 * - Stop reasons: end_turn, tool_use, max_tokens, stop_sequence
 */
export function wrapAnthropic<T extends Record<string, any>>(client: T, options: ArcadeAnthropicOptions): T & { arcadeDisconnect: () => void } {
  const arcade = new AgentArcade({
    url: options.gatewayUrl,
    sessionId: options.sessionId,
    apiKey: options.apiKey,
  })

  const trackToolUse = options.trackToolUse !== false

  if (client.messages?.create) {
    const originalCreate = client.messages.create.bind(client.messages)

    client.messages.create = async function arcadeWrappedCreate(params: any, reqOpts?: any) {
      const agentId = uid()
      const model = params.model || 'Claude'
      const isStreaming = params.stream === true

      arcade.spawn({ name: model, role: 'assistant', id: agentId })
      arcade.state(agentId, 'thinking', {
        label: `Processing ${params.messages?.length || 0} messages`,
      })

      try {
        if (isStreaming) {
          const stream = await originalCreate(params, reqOpts)
          let chunkCount = 0
          let inputTokens = 0
          let outputTokens = 0
          let currentToolName = ''
          let hasThinking = false

          // Wrap the stream's async iterator
          const originalIterator = stream[Symbol.asyncIterator]?.bind(stream)
          if (originalIterator) {
            stream[Symbol.asyncIterator] = function () {
              const iter = originalIterator()
              return {
                async next() {
                  const result = await iter.next()
                  if (!result.done) {
                    const event = result.value

                    switch (event.type) {
                      case 'message_start':
                        if (event.message?.usage) {
                          inputTokens = event.message.usage.input_tokens || 0
                        }
                        break

                      case 'content_block_start':
                        if (event.content_block?.type === 'thinking') {
                          hasThinking = true
                          arcade.state(agentId, 'thinking', { label: 'Extended thinking...' })
                        } else if (event.content_block?.type === 'tool_use' && trackToolUse) {
                          currentToolName = event.content_block.name || 'tool'
                          arcade.tool(agentId, currentToolName, {
                            label: `Calling ${currentToolName}`,
                          })
                          arcade.state(agentId, 'tool', { label: `Using ${currentToolName}` })
                        } else if (event.content_block?.type === 'text') {
                          arcade.state(agentId, 'writing', { label: 'Generating response...' })
                        }
                        break

                      case 'content_block_delta':
                        chunkCount++
                        if (event.delta?.type === 'text_delta') {
                          if (chunkCount % 20 === 0) {
                            arcade.state(agentId, 'writing', {
                              label: `Writing... (${chunkCount} chunks)`,
                              progress: Math.min(0.95, chunkCount / 300),
                            })
                          }
                        } else if (event.delta?.type === 'thinking_delta') {
                          if (chunkCount % 20 === 0) {
                            arcade.state(agentId, 'thinking', {
                              label: `Reasoning... (${chunkCount} chunks)`,
                            })
                          }
                        }
                        break

                      case 'content_block_stop':
                        if (currentToolName) {
                          arcade.state(agentId, 'thinking', { label: `${currentToolName} complete` })
                          currentToolName = ''
                        }
                        break

                      case 'message_delta':
                        if (event.usage) {
                          outputTokens = event.usage.output_tokens || 0
                        }
                        break

                      case 'message_stop': {
                        const tokenInfo = `${inputTokens + outputTokens} tokens (in: ${inputTokens}, out: ${outputTokens})`
                        const stopReason = event.message?.stop_reason || 'end_turn'
                        arcade.end(agentId, {
                          reason: `${stopReason} -- ${tokenInfo}`,
                          success: true,
                        })
                        break
                      }
                    }
                  } else {
                    // Stream ended without message_stop (edge case)
                    if (chunkCount > 0) {
                      arcade.end(agentId, {
                        reason: `Streamed ${chunkCount} chunks`,
                        success: true,
                      })
                    }
                  }
                  return result
                },
                return: iter.return?.bind(iter),
                throw: iter.throw?.bind(iter),
              }
            }
          }

          // Also handle the .on() event-based stream API if available
          if (typeof stream.on === 'function') {
            const originalOn = stream.on.bind(stream)
            stream.on = function (eventName: string, handler: Function) {
              if (eventName === 'text') {
                return originalOn(eventName, (text: string) => {
                  chunkCount++
                  if (chunkCount === 1) {
                    arcade.state(agentId, 'writing', { label: 'Generating...' })
                  }
                  handler(text)
                })
              }
              if (eventName === 'end' || eventName === 'finalMessage') {
                return originalOn(eventName, (...args: any[]) => {
                  arcade.end(agentId, { reason: `Completed (${chunkCount} chunks)`, success: true })
                  handler(...args)
                })
              }
              return originalOn(eventName, handler)
            }
          }

          return stream
        } else {
          // Non-streaming
          const result = await originalCreate(params, reqOpts)
          const msg = result as any

          // Track tool usage
          if (trackToolUse && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                arcade.tool(agentId, block.name, {
                  label: JSON.stringify(block.input).slice(0, 200),
                })
              }
            }
          }

          arcade.state(agentId, 'writing', { label: 'Response generated' })

          const usage = msg.usage
          const tokenInfo = usage
            ? `${(usage.input_tokens || 0) + (usage.output_tokens || 0)} tokens (in: ${usage.input_tokens || 0}, out: ${usage.output_tokens || 0})`
            : 'complete'
          const stopReason = msg.stop_reason || 'end_turn'

          arcade.end(agentId, {
            reason: `${stopReason} -- ${tokenInfo}`,
            success: true,
          })

          return result
        }
      } catch (error: any) {
        arcade.state(agentId, 'error', {
          label: error.message?.slice(0, 200) || 'Unknown error',
        })
        arcade.end(agentId, {
          reason: `Error: ${error.message?.slice(0, 100)}`,
          success: false,
        })
        throw error
      }
    }
  }

  // ── Disconnect helper ────────────────────────────────────────────────
  ;(client as any).arcadeDisconnect = () => {
    arcade.disconnect()
  }

  return client as T & { arcadeDisconnect: () => void }
}

/**
 * Create a pre-wrapped Anthropic client with Arcade telemetry built in.
 *
 * @example
 * ```typescript
 * import { createAnthropicProxy } from '@agent-arcade/adapter-anthropic'
 *
 * const client = createAnthropicProxy('sk-ant-...', {
 *   gatewayUrl: 'http://localhost:8787',
 *   sessionId: 'demo',
 * })
 *
 * const msg = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 * ```
 */
export function createAnthropicProxy(anthropicApiKey: string, arcadeOptions: ArcadeAnthropicOptions): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: anthropicApiKey })
    return wrapAnthropic(client, arcadeOptions)
  } catch (e) {
    throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk')
  }
}

export default wrapAnthropic
