// Unified AI provider router
import { streamClaude, testClaudeKey } from './claude'
import { streamOpenAI, testOpenAIKey } from './openai'
import { streamGemini, testGeminiKey } from './gemini'
import { streamOllama, testOllamaConnection, listOllamaModels } from './ollama'
import { streamMistral, testMistralConnection } from './mistral'

export type ProviderId = 'claude' | 'openai' | 'gemini' | 'ollama' | 'mistral' | 'custom'

export interface ModelOption {
  id: string
  name: string
  provider: ProviderId
  inputCostPer1M: number   // USD
  outputCostPer1M: number  // USD
  isLocal?: boolean
  description?: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Anthropic Claude — use canonical Anthropic model IDs
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'claude', inputCostPer1M: 3, outputCostPer1M: 15, description: 'Fast, capable' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'claude', inputCostPer1M: 15, outputCostPer1M: 75, description: 'Most capable' },
  { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', provider: 'claude', inputCostPer1M: 0.8, outputCostPer1M: 4, description: 'Fastest & cheapest' },
  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', inputCostPer1M: 2.5, outputCostPer1M: 10, description: 'OpenAI flagship' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai', inputCostPer1M: 0.15, outputCostPer1M: 0.60, description: 'Fast & cheap' },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', inputCostPer1M: 1.10, outputCostPer1M: 4.40, description: 'Reasoning model' },
  // Google
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', inputCostPer1M: 0.10, outputCostPer1M: 0.40, description: 'Fastest Gemini' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', inputCostPer1M: 1.25, outputCostPer1M: 5, description: 'Google flagship' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', inputCostPer1M: 0.075, outputCostPer1M: 0.30, description: 'Ultra fast' },
  // Mistral
  { id: 'mistral-large-latest', name: 'Mistral Large', provider: 'mistral', inputCostPer1M: 3, outputCostPer1M: 9, description: 'Mistral flagship' },
  { id: 'mistral-small-latest', name: 'Mistral Small', provider: 'mistral', inputCostPer1M: 1, outputCostPer1M: 3, description: 'Fast & efficient' },
]

export interface RouterConfig {
  provider: ProviderId
  modelId: string
  apiKeys: Partial<Record<ProviderId, string>>
  ollamaBaseUrl?: string
  customEndpoint?: string
  mistralApiKey?: string
}

export interface StreamChunk {
  text: string
  done: boolean
  inputTokens?: number
  outputTokens?: number
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = `You are an expert coding assistant inside Agent Arcade — a universal AI agent cockpit.
Help the user with coding tasks. When you write code use markdown code blocks with language tags.
Be precise and concise. You can see all active agents and their states in the current session.`

/**
 * Stream via the server-side /api/chat route.
 * Uses env-var API keys — no client-side key needed.
 */
async function* streamViaServer(
  messages: ConversationMessage[],
  provider: string,
  modelId: string,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model: modelId, provider }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err?.error || `Server error: ${res.status}`)
  }

  if (!res.body) throw new Error('Empty response body from chat server')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') { yield { text: '', done: true, inputTokens, outputTokens }; return }
        try {
          const parsed = JSON.parse(data)
          // Anthropic SSE format
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { text: parsed.delta.text, done: false }
          } else if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens || 0
          } else if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens || 0
          } else if (parsed.type === 'message_stop') {
            yield { text: '', done: true, inputTokens, outputTokens }; return
          }
          // OpenAI / Mistral SSE format
          else if (parsed.choices?.[0]?.delta?.content != null) {
            yield { text: parsed.choices[0].delta.content, done: false }
          } else if (parsed.choices?.[0]?.finish_reason) {
            inputTokens = parsed.usage?.prompt_tokens || 0
            outputTokens = parsed.usage?.completion_tokens || 0
            yield { text: '', done: true, inputTokens, outputTokens }; return
          }
          // Gemini SSE format
          else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text != null) {
            yield { text: parsed.candidates[0].content.parts[0].text, done: false }
          }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  yield { text: '', done: true, inputTokens, outputTokens }
}

export async function* streamWithRouter(
  messages: ConversationMessage[],
  config: RouterConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const { provider, modelId, apiKeys } = config

  if (provider === 'ollama') {
    yield* streamOllama(messages, { model: modelId, baseUrl: config.ollamaBaseUrl }, signal)
    return
  }

  const clientKey = apiKeys[provider as keyof typeof apiKeys] || ''

  // No client key → try server-side route (uses env vars automatically)
  if (!clientKey) {
    yield* streamViaServer(messages, provider, modelId, signal)
    return
  }

  // Client key provided → call API directly from browser
  if (provider === 'claude') {
    yield* streamClaude(messages, { apiKey: clientKey, model: modelId, systemPrompt: SYSTEM_PROMPT }, signal)
  } else if (provider === 'openai') {
    yield* streamOpenAI(messages, { apiKey: clientKey, model: modelId, systemPrompt: SYSTEM_PROMPT }, signal)
  } else if (provider === 'gemini') {
    yield* streamGemini(messages, { apiKey: clientKey, model: modelId, systemPrompt: SYSTEM_PROMPT }, signal)
  } else if (provider === 'mistral') {
    yield* streamMistral(messages, { apiKey: clientKey, model: modelId, systemPrompt: SYSTEM_PROMPT }, signal)
  } else {
    throw new Error(`Unknown provider: ${provider}`)
  }
}

export async function testConnection(provider: ProviderId, apiKey: string, ollamaBaseUrl?: string): Promise<boolean> {
  if (provider === 'claude') return testClaudeKey(apiKey)
  if (provider === 'openai') return testOpenAIKey(apiKey)
  if (provider === 'gemini') return testGeminiKey(apiKey)
  if (provider === 'mistral') return testMistralConnection(apiKey)
  if (provider === 'ollama') return testOllamaConnection(ollamaBaseUrl)
  return false
}

/**
 * Check which providers have server-side API keys configured.
 * Returns a map of provider → available.
 */
export async function checkServerProviders(): Promise<Partial<Record<ProviderId, boolean>>> {
  try {
    const res = await fetch('/api/chat')
    if (!res.ok) return {}
    const { providers } = await res.json()
    return providers || {}
  } catch {
    return {}
  }
}

export { listOllamaModels }

export function calculateCost(inputTokens: number, outputTokens: number, model: ModelOption): number {
  return (inputTokens / 1_000_000) * model.inputCostPer1M + (outputTokens / 1_000_000) * model.outputCostPer1M
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateCost(text: string, model: ModelOption): number {
  const tokens = estimateTokens(text)
  return (tokens / 1_000_000) * model.inputCostPer1M
}
