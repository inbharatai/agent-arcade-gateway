import { NextRequest } from 'next/server'
import { validateTaskTree } from '@/lib/goal-engine/decomposer'
import type { TaskTree } from '@/lib/goal-engine/types'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:47890'

const DECOMPOSITION_SYSTEM_PROMPT = `You are a software project planner inside Agent Arcade. Break down the following goal into a structured task tree.
Rules:
- Maximum 6 sub-tasks per goal
- Each task must be atomic and completable by a single AI agent in one session
- Tasks must have clear dependencies
- Identify which tasks can run in parallel
- Identify which must run sequentially
- Estimate complexity: low/medium/high
- Estimate token cost: low/medium/high
Return ONLY valid JSON. No explanation. No preamble. No markdown. Pure JSON only.

JSON format:
{
  "goal": "<original goal>",
  "summary": "<one-line summary of the plan>",
  "estimatedCost": "low|medium|high",
  "estimatedTime": "<e.g. '5-10 minutes'>",
  "tasks": [
    {
      "id": "task-1",
      "title": "<short title>",
      "description": "<what this task does>",
      "agentType": "backend|frontend|database|testing|devops|general",
      "dependencies": [],
      "canParallel": true,
      "complexity": "low|medium|high",
      "estimatedTokens": "low|medium|high",
      "successCriteria": "<how to verify completion>"
    }
  ],
  "executionOrder": [
    ["task-1", "task-2"],
    ["task-3"]
  ]
}`

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) return jsonMatch[0]
  return text.trim()
}

async function callGatewayChat(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, provider: 'claude', model: 'claude-sonnet-4-6' }),
  })
  if (!res.ok) throw new Error(`Gateway chat returned ${res.status}`)

  // Gateway streams SSE — collect and extract text
  const raw = await res.text()
  const lines = raw.split('\n').filter(l => l.startsWith('data:'))
  let text = ''
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.slice(5).trim())
      // Anthropic SSE format
      if (obj.type === 'content_block_delta') text += obj.delta?.text ?? ''
      // OpenAI SSE format
      if (obj.choices?.[0]?.delta?.content) text += obj.choices[0].delta.content
    } catch { /* skip unparseable lines */ }
  }
  return text.trim()
}

export async function POST(req: NextRequest) {
  let body: { goal?: string; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const goal = (body.goal ?? '').trim()
  if (!goal) return Response.json({ error: 'goal is required' }, { status: 400 })
  if (goal.length > 2000) return Response.json({ error: 'goal must be under 2000 characters' }, { status: 400 })

  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const userMessage =
        attempt === 0
          ? goal
          : `${goal}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY valid JSON matching the specified format. No explanation, no markdown fences, no preamble.`

      const rawText = await callGatewayChat([
        { role: 'user', content: `${DECOMPOSITION_SYSTEM_PROMPT}\n\n${userMessage}` },
      ])

      if (!rawText) throw new Error('Empty response from AI provider')

      const jsonStr = extractJSON(rawText)
      let parsed: TaskTree
      try {
        parsed = JSON.parse(jsonStr) as TaskTree
      } catch {
        throw new Error(`AI response was not valid JSON: ${jsonStr.slice(0, 200)}`)
      }

      const validation = validateTaskTree(parsed)
      if (!validation.valid) {
        if (parsed.tasks && parsed.tasks.length > 6) {
          return Response.json({
            error: `Goal is too complex — AI generated ${parsed.tasks.length} tasks (max 6). Try breaking it into smaller goals.`,
          }, { status: 422 })
        }
        throw new Error(`Invalid task tree: ${validation.errors.join('; ')}`)
      }

      return Response.json({ taskTree: parsed })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // Don't retry on non-recoverable errors
      if (lastError.includes('too complex') || lastError.includes('returned 4')) break
    }
  }

  return Response.json({ error: `Goal decomposition failed: ${lastError}` }, { status: 500 })
}
