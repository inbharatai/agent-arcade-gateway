import { NextRequest } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

/**
 * Server-side chat proxy route — zero configuration required.
 *
 * API keys are resolved in priority order:
 *   1. Gateway /v1/chat  — gateway auto-detects Claude Code OAuth + env vars
 *   2. Claude Code OAuth — ~/.claude/.credentials.json (paid subscription)
 *   3. Local env vars    — ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
 *
 * When connected to any paid AI tool (Claude Code, Cursor, etc.), the Console
 * automatically piggybacks on its authentication — no separate key needed.
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:47890'

/** Detect Anthropic key from Claude Code OAuth or env */
function detectAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    if (home) {
      const credPath = resolve(home, '.claude', '.credentials.json')
      if (existsSync(credPath)) {
        const creds = JSON.parse(readFileSync(credPath, 'utf-8'))
        const oauth = creds?.claudeAiOauth
        if (oauth?.accessToken && typeof oauth.expiresAt === 'number' && oauth.expiresAt > Date.now() + 300_000) {
          return oauth.accessToken
        }
      }
    }
  } catch { /* ignore */ }
  return ''
}

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

  // Fall back to local env + Claude Code OAuth detection
  const providers: Record<string, boolean> = {
    claude:  !!detectAnthropicKey(),
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
    const apiKey = detectAnthropicKey()
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
    if (!apiKey) {
      return Response.json({
        error: 'No Anthropic API key detected. Add your key in Settings → Providers, or set ANTHROPIC_API_KEY in your environment.',
      }, { status: 401 })
    }

    // OAuth tokens can't hit the public API — use claude CLI (subscription auth)
    const isOAuth = apiKey.startsWith('sk-ant-oat01-')
    if (isOAuth) {
      try {
        const lastMsg = messages[messages.length - 1]?.content || ''
        const cliModel = model || 'claude-sonnet-4-6'
        const prompt = `${SYSTEM_PROMPT}\n\n${lastMsg}`
        const reply = execFileSync('claude', ['-p', '--model', cliModel], {
          input: prompt,
          timeout: 60_000,
          encoding: 'utf-8',
        }).trim()

        // Wrap as a single SSE event for client compatibility
        const encoder = new TextEncoder()
        const sseData = JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: reply },
        })
        const stopData = JSON.stringify({ type: 'message_stop' })
        const body = `event: content_block_delta\ndata: ${sseData}\n\nevent: message_stop\ndata: ${stopData}\n\n`
        return new Response(encoder.encode(body), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
        })
      } catch (e) {
        return Response.json({ error: `Claude CLI error: ${String(e).slice(0, 150)}` }, { status: 500 })
      }
    }

    // Standard API key path
    const upstream = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
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
        error: `No ${provider} API key detected. Add your key in Settings → Providers, or set the key in your environment.`,
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
      return Response.json({ error: 'No Gemini API key detected. Add your key in Settings → Providers, or set GEMINI_API_KEY in your environment.' }, { status: 401 })
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
