// Anthropic Claude provider — streaming via direct fetch
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

export async function* streamClaude(
  messages: Message[],
  config: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      stream: true,
      system: config.systemPrompt || SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message || `Claude API error: ${res.status}`)
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
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { text: parsed.delta.text, done: false }
          } else if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens || 0
          } else if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens || 0
          } else if (parsed.type === 'message_stop') {
            yield { text: '', done: true, inputTokens, outputTokens }
            return
          }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  yield { text: '', done: true, inputTokens, outputTokens }
}

export async function testClaudeKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    return res.ok
  } catch { return false }
}

export function estimateClaudeTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
