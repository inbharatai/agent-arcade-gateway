// Mistral AI provider — streaming via direct fetch
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ProviderConfig {
  apiKey: string
  model: string
  systemPrompt?: string
}

export interface StreamChunk {
  text: string
  done: boolean
  inputTokens?: number
  outputTokens?: number
}

const SYSTEM_PROMPT = `You are an expert coding assistant inside Agent Arcade — a universal AI agent cockpit.
Help the user with coding tasks. When you write code use markdown code blocks with language tags.
Be precise and concise. You can see all active agents and their states in the current session.`

export async function* streamMistral(
  messages: Message[],
  config: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'mistral-large-latest',
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: config.systemPrompt || SYSTEM_PROMPT },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err?.message || `Mistral API error: ${res.status}`)
  }

  const reader = res.body!.getReader()
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
        if (data === '[DONE]') {
          yield { text: '', done: true, inputTokens, outputTokens }
          return
        }
        try {
          const parsed = JSON.parse(data)
          const delta = parsed?.choices?.[0]?.delta?.content
          if (delta) {
            yield { text: delta, done: false }
          }
          const finishReason = parsed?.choices?.[0]?.finish_reason
          if (finishReason === 'stop') {
            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens || 0
              outputTokens = parsed.usage.completion_tokens || 0
            }
            yield { text: '', done: true, inputTokens, outputTokens }
            return
          }
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || 0
            outputTokens = parsed.usage.completion_tokens || 0
          }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  yield { text: '', done: true, inputTokens, outputTokens }
}

export async function testMistralConnection(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })
    return res.ok
  } catch { return false }
}
