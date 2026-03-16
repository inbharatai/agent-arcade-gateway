// Google Gemini provider — streaming via direct fetch
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
Be precise and concise.`

export async function* streamGemini(
  messages: Message[],
  config: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const model = config.model || 'gemini-1.5-pro'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: config.systemPrompt || SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message || `Gemini API error: ${res.status}`)
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
        try {
          const parsed = JSON.parse(data)
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) yield { text, done: false }
          if (parsed.usageMetadata) {
            inputTokens = parsed.usageMetadata.promptTokenCount || 0
            outputTokens = parsed.usageMetadata.candidatesTokenCount || 0
          }
          if (parsed.candidates?.[0]?.finishReason === 'STOP') {
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

export async function testGeminiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    )
    return res.ok
  } catch { return false }
}
