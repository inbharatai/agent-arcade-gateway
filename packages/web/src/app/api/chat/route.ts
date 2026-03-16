import { NextRequest } from 'next/server'

/**
 * Server-side chat proxy route.
 *
 * Priority order for API keys:
 *   1. Gateway /v1/chat  — the gateway server has the keys (set once, shared by all clients)
 *   2. Local env vars    — ANTHROPIC_API_KEY etc. in .env.local
 *
 * This means users NEVER need to enter API keys in the browser.
 * Just configure the gateway (or .env.local) once.
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:47890'

const SYSTEM_PROMPT = `You are an expert assistant inside Agent Arcade — a universal AI agent cockpit.
Help the user understand and direct the AI agents visible in the current session.
Be concise and helpful. When writing code use markdown code blocks.`

/** Check which providers are available — gateway first, then local env */
export async function GET() {
  // Try gateway providers first
  try {
    const gwRes = await fetch(`${GATEWAY_URL}/v1/chat/providers`, { cache: 'no-store' })
    if (gwRes.ok) {
      const { providers } = await gwRes.json()
      return Response.json({ providers, source: 'gateway' })
    }
  } catch { /* gateway unreachable, fall through to local */ }

  // Fall back to local env
  const providers: Record<string, boolean> = {
    claude:  !!process.env.ANTHROPIC_API_KEY,
    openai:  !!process.env.OPENAI_API_KEY,
    gemini:  !!process.env.GEMINI_API_KEY,
    mistral: !!process.env.MISTRAL_API_KEY,
  }
  return Response.json({ providers, source: 'local' })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    messages: Array<{ role: string; content: string }>
    model: string
    provider: string
  }
  const { messages, model, provider } = body

  // ── 1. Try gateway /v1/chat first ────────────────────────────────────────
  try {
    const gwRes = await fetch(`${GATEWAY_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model, provider }),
    })

    if (gwRes.ok) {
      return new Response(gwRes.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    // If gateway returned 401 (key not configured) fall through to local
    if (gwRes.status !== 401 && gwRes.status !== 404) {
      const err = await gwRes.json().catch(() => ({ error: gwRes.statusText }))
      return Response.json({ error: err?.error || `Gateway error: ${gwRes.status}` }, { status: gwRes.status })
    }
  } catch { /* gateway unreachable — fall through to local env */ }

  // ── 2. Fall back to local env vars ────────────────────────────────────────
  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
    if (!apiKey) {
      return Response.json({
        error: [
          'No Anthropic API key found.',
          'Fix options (pick one):',
          '  1. Run: agent-arcade start  (auto-detects key from your shell)',
          '  2. Add ANTHROPIC_API_KEY=sk-ant-... to packages/gateway/.env',
          '  3. Add ANTHROPIC_API_KEY=sk-ant-... to packages/web/.env.local',
          '  4. Enter your key in Settings → Providers in the console',
        ].join('\n'),
      }, { status: 401 })
    }

    const upstream = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ error: { message: upstream.statusText } }))
      return Response.json({ error: err?.error?.message || `API error: ${upstream.status}` }, { status: upstream.status })
    }

    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    })
  }

  if (provider === 'openai' || provider === 'mistral') {
    const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.MISTRAL_API_KEY
    const baseUrl = provider === 'openai' ? 'https://api.openai.com' : 'https://api.mistral.ai'
    if (!apiKey) {
      return Response.json({
        error: `No API key configured. Add ${provider.toUpperCase()}_API_KEY to the gateway .env`,
      }, { status: 401 })
    }

    const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    })

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ error: { message: upstream.statusText } }))
      return Response.json({ error: err?.error?.message || `API error: ${upstream.status}` }, { status: upstream.status })
    }

    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    })
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY not configured on server' }, { status: 401 })
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      }),
    })

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ error: { message: upstream.statusText } }))
      return Response.json({ error: err?.error?.message || `API error: ${upstream.status}` }, { status: upstream.status })
    }

    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }

  return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 })
}
