// Ollama local provider — no API key needed
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ProviderConfig {
  model: string
  baseUrl?: string
}

export interface StreamChunk {
  text: string
  done: boolean
  inputTokens?: number
  outputTokens?: number
}

const DEFAULT_BASE = 'http://localhost:11434'

export async function* streamOllama(
  messages: Message[],
  config: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const base = config.baseUrl || DEFAULT_BASE
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed.message?.content) yield { text: parsed.message.content, done: false }
          if (parsed.done) {
            yield { text: '', done: true, inputTokens: parsed.prompt_eval_count, outputTokens: parsed.eval_count }
            return
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  yield { text: '', done: true }
}

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  try {
    const base = baseUrl || DEFAULT_BASE
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = await res.json() as { models?: Array<{ name: string }> }
    return data.models?.map(m => m.name) || []
  } catch { return [] }
}

export async function testOllamaConnection(baseUrl?: string): Promise<boolean> {
  try {
    const base = baseUrl || DEFAULT_BASE
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch { return false }
}
