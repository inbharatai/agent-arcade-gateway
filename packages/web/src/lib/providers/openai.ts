// OpenAI provider — streaming via direct fetch
export interface Message {
  role: 'user' | 'assistant' | 'system'
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

export async function* streamOpenAI(
  messages: Message[],
  config: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const msgs = [
    { role: 'system', content: config.systemPrompt || SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o',
      stream: true,
      stream_options: { include_usage: true },
      messages: msgs,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message || `OpenAI API error: ${res.status}`)
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
        if (data === '[DONE]') { yield { text: '', done: true, inputTokens, outputTokens }; return }
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) yield { text: delta, done: false }
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || 0
            outputTokens = parsed.usage.completion_tokens || 0
          }
          if (parsed.choices?.[0]?.finish_reason === 'stop') {
            yield { text: '', done: true, inputTokens, outputTokens }
            return
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  yield { text: '', done: true, inputTokens, outputTokens }
}

export async function testOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    return res.ok
  } catch { return false }
}

export function estimateOpenAITokens(text: string): number {
  return Math.ceil(text.length / 4)
}
