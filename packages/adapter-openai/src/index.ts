/**
 * @agent-arcade/adapter-openai
 *
 * Auto-instruments OpenAI SDK calls to emit Agent Arcade telemetry.
 * Wraps chat completions, image generation, audio, and embeddings.
 *
 * Usage:
 *   import OpenAI from 'openai'
 *   import { wrapOpenAI } from '@agent-arcade/adapter-openai'
 *
 *   const client = wrapOpenAI(new OpenAI(), {
 *     gatewayUrl: 'http://localhost:47890',
 *     sessionId: 'my-session',
 *   })
 *   // Now use client normally -- all calls are automatically visualized
 *   const response = await client.chat.completions.create({ ... })
 */

import { AgentArcade } from '@agent-arcade/sdk-node'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcadeOpenAIOptions {
  /** Gateway URL, e.g. http://localhost:47890 */
  gatewayUrl: string
  /** Session identifier */
  sessionId: string
  /** Optional arcade auth token */
  apiKey?: string
  /** Override model label displayed in the Arcade (default: uses model from request) */
  modelLabel?: string
  /** Auto-end session when the wrapper is disconnected (default: false) */
  autoEndSession?: boolean
}

let counter = 0
function uid(): string {
  return `oai_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an OpenAI client instance to emit Agent Arcade telemetry.
 *
 * This monkey-patches the following methods:
 * - `chat.completions.create` -- thinking/writing/done states, token tracking
 * - `images.generate` -- tool state with "dall-e" tool name
 * - `audio.transcriptions.create` -- reading state
 * - `audio.speech.create` -- writing state
 * - `embeddings.create` -- reading state
 *
 * @param client - An OpenAI SDK client instance
 * @param options - Arcade configuration
 * @returns The same client instance (mutated with instrumentation)
 */
export function wrapOpenAI<T extends Record<string, any>>(client: T, options: ArcadeOpenAIOptions): T & { arcadeDisconnect: () => void } {
  const arcade = new AgentArcade({
    url: options.gatewayUrl,
    sessionId: options.sessionId,
    apiKey: options.apiKey,
  })

  const modelLabel = options.modelLabel

  // ── Chat Completions ─────────────────────────────────────────────────
  if (client.chat?.completions?.create) {
    const originalCreate = client.chat.completions.create.bind(client.chat.completions)

    client.chat.completions.create = async function arcadeWrappedCreate(params: any, reqOpts?: any) {
      const agentId = uid()
      const model = modelLabel || params.model || 'GPT'
      const isStreaming = params.stream === true

      arcade.spawn({ name: model, role: 'chat', id: agentId })
      arcade.state(agentId, 'thinking', { label: `Processing ${params.messages?.length || 0} messages` })

      try {
        if (isStreaming) {
          const stream = await originalCreate(params, reqOpts)
          let tokenCount = 0

          // Wrap the async iterator (guard against SDKs that don't expose it)
          const originalIterator = stream[Symbol.asyncIterator]?.bind(stream)
          if (!originalIterator) {
            arcade.state(agentId, 'writing', { label: 'Streaming...' })
            return stream
          }
          stream[Symbol.asyncIterator] = function () {
            const iter = originalIterator()
            return {
              async next() {
                const result = await iter.next()
                if (!result.done) {
                  tokenCount++
                  if (tokenCount === 1) {
                    arcade.state(agentId, 'writing', { label: 'Generating...' })
                  } else if (tokenCount % 20 === 0) {
                    arcade.state(agentId, 'writing', {
                      label: `Streaming... (${tokenCount} chunks)`,
                      progress: Math.min(0.95, tokenCount / 500),
                    })
                  }
                } else {
                  arcade.end(agentId, { reason: `Streamed ${tokenCount} chunks`, success: true })
                }
                return result
              },
              return: iter.return?.bind(iter),
              throw: iter.throw?.bind(iter),
            }
          }
          return stream
        } else {
          const result = await originalCreate(params, reqOpts)
          const usage = (result as any).usage
          const tokenInfo = usage
            ? `${usage.total_tokens} tokens (prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens})`
            : 'complete'
          arcade.state(agentId, 'writing', { label: 'Generating response' })
          arcade.end(agentId, { reason: tokenInfo, success: true })
          return result
        }
      } catch (error: any) {
        arcade.state(agentId, 'error', { label: error.message?.slice(0, 200) || 'Unknown error' })
        arcade.end(agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
        throw error
      }
    }
  }

  // ── Images ───────────────────────────────────────────────────────────
  if (client.images?.generate) {
    const originalGenerate = client.images.generate.bind(client.images)

    client.images.generate = async function arcadeWrappedImageGen(params: any, reqOpts?: any) {
      const agentId = uid()
      const model = modelLabel || params.model || 'DALL-E'

      arcade.spawn({ name: model, role: 'image-gen', id: agentId })
      arcade.tool(agentId, 'dall-e', { label: params.prompt?.slice(0, 200) || 'Generating image' })
      arcade.state(agentId, 'tool', { label: `Generating ${params.n || 1} image(s)` })

      try {
        const result = await originalGenerate(params, reqOpts)
        arcade.end(agentId, { reason: `Generated ${(result as any).data?.length || 1} image(s)`, success: true })
        return result
      } catch (error: any) {
        arcade.state(agentId, 'error', { label: error.message?.slice(0, 200) || 'Image generation failed' })
        arcade.end(agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
        throw error
      }
    }
  }

  // ── Audio Transcription ──────────────────────────────────────────────
  if (client.audio?.transcriptions?.create) {
    const originalTranscribe = client.audio.transcriptions.create.bind(client.audio.transcriptions)

    client.audio.transcriptions.create = async function arcadeWrappedTranscribe(params: any, reqOpts?: any) {
      const agentId = uid()

      arcade.spawn({ name: 'Whisper', role: 'stt', id: agentId })
      arcade.state(agentId, 'reading', { label: 'Transcribing audio...' })

      try {
        const result = await originalTranscribe(params, reqOpts)
        const textLen = typeof (result as any).text === 'string' ? (result as any).text.length : 0
        arcade.end(agentId, { reason: `Transcribed ${textLen} characters`, success: true })
        return result
      } catch (error: any) {
        arcade.state(agentId, 'error', { label: error.message?.slice(0, 200) || 'Transcription failed' })
        arcade.end(agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
        throw error
      }
    }
  }

  // ── Audio Speech ─────────────────────────────────────────────────────
  if (client.audio?.speech?.create) {
    const originalSpeech = client.audio.speech.create.bind(client.audio.speech)

    client.audio.speech.create = async function arcadeWrappedSpeech(params: any, reqOpts?: any) {
      const agentId = uid()

      arcade.spawn({ name: 'TTS', role: 'tts', id: agentId })
      arcade.state(agentId, 'writing', { label: `Generating speech (${params.voice || 'default'} voice)` })

      try {
        const result = await originalSpeech(params, reqOpts)
        arcade.end(agentId, { reason: 'Speech generated', success: true })
        return result
      } catch (error: any) {
        arcade.state(agentId, 'error', { label: error.message?.slice(0, 200) || 'TTS failed' })
        arcade.end(agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
        throw error
      }
    }
  }

  // ── Embeddings ───────────────────────────────────────────────────────
  if (client.embeddings?.create) {
    const originalEmbed = client.embeddings.create.bind(client.embeddings)

    client.embeddings.create = async function arcadeWrappedEmbed(params: any, reqOpts?: any) {
      const agentId = uid()
      const model = modelLabel || params.model || 'Embeddings'
      const inputCount = Array.isArray(params.input) ? params.input.length : 1

      arcade.spawn({ name: model, role: 'embeddings', id: agentId })
      arcade.state(agentId, 'reading', { label: `Embedding ${inputCount} input(s)` })

      try {
        const result = await originalEmbed(params, reqOpts)
        arcade.end(agentId, { reason: `Embedded ${inputCount} input(s)`, success: true })
        return result
      } catch (error: any) {
        arcade.state(agentId, 'error', { label: error.message?.slice(0, 200) || 'Embedding failed' })
        arcade.end(agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
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
 * Create a pre-wrapped OpenAI client with Arcade telemetry built in.
 *
 * @example
 * ```typescript
 * import { createOpenAIProxy } from '@agent-arcade/adapter-openai'
 *
 * const client = createOpenAIProxy('sk-...', {
 *   gatewayUrl: 'http://localhost:47890',
 *   sessionId: 'demo',
 * })
 *
 * const res = await client.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 * ```
 */
export function createOpenAIProxy(openaiApiKey: string, arcadeOptions: ArcadeOpenAIOptions): any {
  // Dynamic import to avoid hard dependency
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require('openai').default || require('openai')
    const client = new OpenAI({ apiKey: openaiApiKey })
    return wrapOpenAI(client, arcadeOptions)
  } catch (e) {
    throw new Error('OpenAI SDK not installed. Run: npm install openai')
  }
}

export default wrapOpenAI
