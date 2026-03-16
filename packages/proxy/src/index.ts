/**
 * Agent Arcade AI Proxy
 *
 * Lightweight HTTP proxy that intercepts AI API calls and emits
 * Agent Arcade telemetry. Zero code changes required -- just change
 * your base URL to point to the proxy.
 *
 * Usage:
 *   OPENAI_BASE_URL=http://localhost:8788/openai python my_app.py
 *   ANTHROPIC_BASE_URL=http://localhost:8788/anthropic node my_app.js
 *
 * Port: 8788 (configurable via PROXY_PORT env var)
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8788')
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47890'
const SESSION_ID = process.env.SESSION_ID || 'proxy-session'

const TARGETS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: 'http://localhost:11434',
  mistral: 'https://api.mistral.ai',
}

let counter = 0
function uid(): string {
  return `proxy_${Date.now().toString(36)}_${(counter++).toString(36)}`
}

// ---------------------------------------------------------------------------
// Emitter (fire-and-forget)
// ---------------------------------------------------------------------------

function emitEvent(event: Record<string, unknown>): void {
  fetch(`${GATEWAY_URL}/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => { /* never fail the proxy */ })
}

function emit(type: string, agentId: string, payload: Record<string, unknown>): void {
  emitEvent({
    v: 1,
    ts: Date.now(),
    sessionId: SESSION_ID,
    agentId,
    type,
    payload,
  })
}

// ---------------------------------------------------------------------------
// Request extractors
// ---------------------------------------------------------------------------

interface RequestInfo {
  model: string
  provider: string
  isStreaming: boolean
  messageCount: number
}

function extractInfo(provider: string, body: any, path: string): RequestInfo {
  const isStreaming = body?.stream === true
  let model = body?.model || 'unknown'
  let messageCount = 0

  switch (provider) {
    case 'openai':
      messageCount = body?.messages?.length || 0
      break
    case 'anthropic':
      messageCount = body?.messages?.length || 0
      break
    case 'gemini':
      model = path.match(/models\/([^:]+)/)?.[1] || model
      messageCount = body?.contents?.length || 0
      break
    case 'ollama':
      messageCount = body?.messages?.length || 1
      break
    case 'mistral':
      messageCount = body?.messages?.length || 0
      break
  }

  return { model, provider, isStreaming, messageCount }
}

function extractTokensFromResponse(provider: string, body: any): { input: number; output: number } {
  switch (provider) {
    case 'openai':
      return {
        input: body?.usage?.prompt_tokens || 0,
        output: body?.usage?.completion_tokens || 0,
      }
    case 'anthropic':
      return {
        input: body?.usage?.input_tokens || 0,
        output: body?.usage?.output_tokens || 0,
      }
    case 'gemini':
      return {
        input: body?.usageMetadata?.promptTokenCount || 0,
        output: body?.usageMetadata?.candidatesTokenCount || 0,
      }
    case 'ollama':
      return {
        input: body?.prompt_eval_count || 0,
        output: body?.eval_count || 0,
      }
    default:
      return { input: 0, output: 0 }
  }
}

// ---------------------------------------------------------------------------
// Proxy Server
// ---------------------------------------------------------------------------

const isAIEndpoint = (path: string): boolean => {
  return path.includes('/chat/completions') ||
    path.includes('/v1/messages') ||
    path.includes('/generateContent') ||
    path.includes('/api/chat') ||
    path.includes('/api/generate')
}

const server = Bun.serve({
  port: PROXY_PORT,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const provider = pathParts[1] // e.g., /openai/v1/chat/completions -> "openai"
    const targetBase = TARGETS[provider]

    if (!targetBase) {
      return new Response(JSON.stringify({
        error: `Unknown provider: ${provider}. Use one of: ${Object.keys(TARGETS).join(', ')}`,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    // Reconstruct the target URL (remove the provider prefix)
    const targetPath = '/' + pathParts.slice(2).join('/')
    const targetUrl = `${targetBase}${targetPath}${url.search}`

    // Read and parse request body
    let body: any = null
    let bodyText = ''
    if (req.method === 'POST' || req.method === 'PUT') {
      bodyText = await req.text()
      try { body = JSON.parse(bodyText) } catch { /* not JSON */ }
    }

    const isAI = isAIEndpoint(url.pathname)
    let agentId = ''
    let info: RequestInfo | null = null

    // Pre-request telemetry
    if (isAI && body) {
      agentId = uid()
      info = extractInfo(provider, body, url.pathname)

      emit('agent.spawn', agentId, {
        name: info.model,
        role: provider,
        aiModel: info.model,
        source: 'process',
        confidence: 0.99,
      })
      emit('agent.state', agentId, {
        state: 'thinking',
        label: `Processing ${info.messageCount} message(s)`,
      })
    }

    // Forward the request
    const startTime = Date.now()
    try {
      // Copy headers, remove host
      const headers = new Headers(req.headers)
      headers.delete('host')

      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: bodyText || undefined,
      })

      const latency = Date.now() - startTime

      if (isAI && agentId && info) {
        if (info.isStreaming) {
          // For streaming, emit "writing" and pass through
          emit('agent.state', agentId, { state: 'writing', label: 'Streaming response...' })

          // We can't easily read the stream without buffering,
          // so emit a delayed "done" based on when the stream completes
          const originalBody = proxyRes.body
          if (originalBody) {
            const { readable, writable } = new TransformStream()
            let chunkCount = 0

            const reader = originalBody.getReader()
            const writer = writable.getWriter()

            ;(async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  chunkCount++
                  if (chunkCount === 1) {
                    emit('agent.state', agentId, { state: 'writing', label: 'Generating...' })
                  }
                  await writer.write(value)
                }
              } finally {
                await writer.close()
                emit('agent.end', agentId, {
                  reason: `Streamed ${chunkCount} chunks in ${Date.now() - startTime}ms`,
                  success: true,
                })
              }
            })()

            return new Response(readable, {
              status: proxyRes.status,
              headers: proxyRes.headers,
            })
          }
        } else {
          // Non-streaming: read response and extract tokens
          const resBody = await proxyRes.text()
          let resJson: any = null
          try { resJson = JSON.parse(resBody) } catch { /* not JSON */ }

          const tokens = resJson ? extractTokensFromResponse(provider, resJson) : { input: 0, output: 0 }

          emit('agent.state', agentId, { state: 'writing', label: 'Response received' })
          emit('agent.end', agentId, {
            reason: `${tokens.input + tokens.output} tokens in ${latency}ms`,
            success: proxyRes.ok,
          })

          return new Response(resBody, {
            status: proxyRes.status,
            headers: proxyRes.headers,
          })
        }
      }

      return proxyRes
    } catch (error: any) {
      if (isAI && agentId) {
        emit('agent.state', agentId, { state: 'error', label: error.message?.slice(0, 200) || 'Proxy error' })
        emit('agent.end', agentId, { reason: `Error: ${error.message?.slice(0, 100)}`, success: false })
      }

      return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
})

console.log(`\n  \x1b[36m\x1b[1mAgent Arcade AI Proxy\x1b[0m`)
console.log(`  \x1b[90mPort:\x1b[0m     ${PROXY_PORT}`)
console.log(`  \x1b[90mGateway:\x1b[0m  ${GATEWAY_URL}`)
console.log(`  \x1b[90mSession:\x1b[0m  ${SESSION_ID}`)
console.log(``)
console.log(`  \x1b[33mUsage:\x1b[0m`)
console.log(`    OPENAI_BASE_URL=http://localhost:${PROXY_PORT}/openai python app.py`)
console.log(`    ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT}/anthropic node app.js`)
console.log(``)
