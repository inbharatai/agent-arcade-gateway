#!/usr/bin/env bun
/**
 * Directive Bridge — Connects the Console/WhatsApp directive queue to Claude Code (or any AI tool).
 *
 * This script:
 *   1. Polls GET /v1/directives for pending commands
 *   2. Executes them using `claude -p --output-format stream-json` (Claude Code CLI)
 *   3. Streams every tool_use event back to the gateway as agent.tool telemetry
 *      → users see "Step N: BashTool", "Step N: ReadFile" live on the canvas
 *   4. Posts the final response back to /v1/directives/:id/done
 *   5. The gateway broadcasts the response via SSE → Console chat shows it
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:47890 bun run packages/gateway/src/directive-bridge.ts
 */

import { spawn } from 'child_process'
import { createHmac } from 'crypto'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47890'
const POLL_INTERVAL = Number(process.env.DIRECTIVE_POLL_MS || '2000') // 2s default
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || ''
const MAX_RESPONSE_LEN = 4000
// Model used when executing directives via `claude -p`. Override with DIRECTIVE_MODEL env var.
const DIRECTIVE_MODEL = process.env.DIRECTIVE_MODEL || 'claude-sonnet-4-5'
// Timeout in ms for each directive execution. Override with DIRECTIVE_TIMEOUT_MS env var.
const DIRECTIVE_TIMEOUT_MS = Number(process.env.DIRECTIVE_TIMEOUT_MS || '120000')
// Session ID that the bridge reports telemetry under. Must match the web UI session.
const BRIDGE_SESSION_ID = process.env.BRIDGE_SESSION_ID || 'copilot-live'
// Session signing secret — must match SESSION_SIGNING_SECRET on the gateway.
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || ''

/** Compute HMAC-SHA256 session signature matching gateway checkSessionSignature() */
function signSession(sessionId: string): string {
  if (!SESSION_SIGNING_SECRET) return ''
  return createHmac('sha256', SESSION_SIGNING_SECRET).update(sessionId).digest('hex')
}

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (GATEWAY_TOKEN) headers['Authorization'] = `Bearer ${GATEWAY_TOKEN}`
const sessionSig = signSession(BRIDGE_SESSION_ID)
if (sessionSig) headers['x-session-signature'] = sessionSig

console.log(`[directive-bridge] Starting directive bridge`)
console.log(`[directive-bridge] Gateway: ${GATEWAY_URL}`)
console.log(`[directive-bridge] Poll interval: ${POLL_INTERVAL}ms`)
console.log(`[directive-bridge] Timeout: ${DIRECTIVE_TIMEOUT_MS / 1000}s`)

// Track directives we're currently processing to avoid double-execution
const processing = new Set<string>()

/** Fire-and-forget ingest helper */
function ingest(agentId: string, type: string, payload: Record<string, unknown>) {
  fetch(`${GATEWAY_URL}/v1/ingest`, {
    method: 'POST', headers,
    body: JSON.stringify({ v: 1, ts: Date.now(), sessionId: BRIDGE_SESSION_ID, agentId, type, payload }),
  }).catch(() => {})
}

async function pollAndExecute() {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/directives`, { headers })
    if (!res.ok) {
      console.warn(`[directive-bridge] Poll failed: HTTP ${res.status}`)
      return
    }
    const data = await res.json() as { directives: Array<{ id: string; instruction: string; source: string; agentId: string; ts: number }> }
    const pending = data.directives || []

    for (const d of pending) {
      if (processing.has(d.id)) continue
      processing.add(d.id)

      const agentId = d.agentId || 'claude-code-main'
      console.log(`[directive-bridge] Executing directive ${d.id.slice(0, 8)} from ${d.source}: ${d.instruction.slice(0, 80)}`)

      // ACK immediately so it doesn't get picked up again
      fetch(`${GATEWAY_URL}/v1/directives/${d.id}/ack`, { method: 'POST', headers }).catch(() => {})

      // Announce: agent is now thinking about this task
      ingest(agentId, 'agent.state', {
        state: 'thinking',
        label: `Task: ${d.instruction.slice(0, 80)}`,
        task: d.instruction.slice(0, 120),
      })
      // Voice announcement: what the agent is working on
      ingest(agentId, 'agent.message', {
        text: `Starting task: ${d.instruction.slice(0, 80)}${d.instruction.length > 80 ? '...' : ''}`,
        level: 'info',
      })

      try {
        const response = await executeWithClaude(
          d.instruction,
          agentId,
          // onTool — fires for every tool Claude invokes (e.g. Bash, ReadFile)
          (toolName: string) => {
            ingest(agentId, 'agent.tool', { name: toolName })
          },
          // onProgress — fires with human-readable label for each step
          (label: string) => {
            ingest(agentId, 'agent.state', { state: 'tool', label })
          },
        )

        console.log(`[directive-bridge] Response for ${d.id.slice(0, 8)}: ${response.slice(0, 100)}...`)

        // Post response back to gateway — this broadcasts via SSE to the Console
        await fetch(`${GATEWAY_URL}/v1/directives/${d.id}/done`, {
          method: 'POST', headers,
          body: JSON.stringify({ response: response.slice(0, MAX_RESPONSE_LEN) }),
        })

        // ── Goal Mode task completion ──────────────────────────────────────
        const goalIdMatch = d.instruction.match(/Goal ID:\s*([\w-]+)/)
        const taskIdMatch = d.instruction.match(/Task ID:\s*([\w-]+)/)
        if (goalIdMatch && taskIdMatch) {
          const goalId = goalIdMatch[1]
          const taskId = taskIdMatch[1]
          fetch(`${GATEWAY_URL}/v1/goals/${goalId}/tasks/${taskId}/update`, {
            method: 'POST', headers,
            body: JSON.stringify({ status: 'complete', progress: 1, output: response.slice(0, 2000) }),
          }).then(r => {
            if (r.ok) console.log(`[directive-bridge] Goal task ${taskId.slice(0, 8)} marked complete`)
          }).catch(() => {})
        }

        // Mark agent idle + done
        ingest(agentId, 'agent.state', { state: 'idle', label: 'Done ✓' })
        // Voice announcement: task completion
        ingest(agentId, 'agent.message', {
          text: `Task completed successfully`,
          level: 'success',
        })

      } catch (err) {
        console.error(`[directive-bridge] Execution error:`, (err as Error).message)

        ingest(agentId, 'agent.state', {
          state: 'error',
          label: `Error: ${(err as Error).message.slice(0, 80)}`,
        })
        // Voice announcement: error occurred
        ingest(agentId, 'agent.message', {
          text: `Error occurred: ${(err as Error).message.slice(0, 60)}`,
          level: 'error',
        })

        // Report Goal Mode task failure if applicable
        const goalIdMatchErr = d.instruction.match(/Goal ID:\s*([\w-]+)/)
        const taskIdMatchErr = d.instruction.match(/Task ID:\s*([\w-]+)/)
        if (goalIdMatchErr && taskIdMatchErr) {
          fetch(`${GATEWAY_URL}/v1/goals/${goalIdMatchErr[1]}/tasks/${taskIdMatchErr[1]}/update`, {
            method: 'POST', headers,
            body: JSON.stringify({ status: 'failed', error: (err as Error).message.slice(0, 200) }),
          }).catch(() => {})
        }

        await fetch(`${GATEWAY_URL}/v1/directives/${d.id}/done`, {
          method: 'POST', headers,
          body: JSON.stringify({ response: `⚠️ Error: ${(err as Error).message}` }),
        }).catch(() => {})
      } finally {
        setTimeout(() => processing.delete(d.id), 30000)
      }
    }
  } catch (err) {
    console.warn(`[directive-bridge] Poll error:`, (err as Error).message)
  }
}

/**
 * Run a Claude Code CLI command with streaming JSON output.
 * Parses each NDJSON line and fires callbacks for tool use and progress.
 * Returns the final text result.
 */
function executeWithClaude(
  instruction: string,
  agentId: string,
  onTool: (toolName: string) => void,
  onProgress: (label: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--verbose',
      '--model', DIRECTIVE_MODEL,
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let fullText = ''
    let lineBuffer = ''
    let timedOut = false
    let stepCount = 0

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill()
      reject(new Error(`Execution timed out after ${DIRECTIVE_TIMEOUT_MS / 1000}s`))
    }, DIRECTIVE_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString()
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const ev = JSON.parse(trimmed) as Record<string, unknown>

          // ── Assistant message (may contain text or tool_use blocks) ──
          if (ev.type === 'assistant') {
            const msg = ev.message as Record<string, unknown>
            const content = msg?.content as Array<Record<string, unknown>>
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                  fullText += block.text
                } else if (block.type === 'tool_use' && typeof block.name === 'string') {
                  stepCount++
                  const toolName = block.name as string
                  const inputPreview = JSON.stringify(block.input || {}).slice(0, 60)
                  console.log(`[directive-bridge]   Step ${stepCount}: ${toolName}`)
                  onTool(toolName)
                  onProgress(`Step ${stepCount}: ${toolName} — ${inputPreview}`)
                }
              }
            }
          }

          // ── Direct tool event (some CLI versions emit this separately) ──
          if (ev.type === 'tool' && typeof ev.tool_name === 'string') {
            stepCount++
            const toolName = ev.tool_name as string
            console.log(`[directive-bridge]   Step ${stepCount}: ${toolName}`)
            onTool(toolName)
            onProgress(`Step ${stepCount}: ${toolName}`)
          }

          // ── Tool result — show brief output preview ──
          if (ev.type === 'tool_result') {
            const preview = String(ev.content ?? '').slice(0, 80).replace(/\n/g, ' ')
            if (preview) onProgress(`→ ${preview}`)
          }

          // ── Final result event — the clean answer ──
          if (ev.type === 'result' && typeof ev.result === 'string' && ev.result.trim()) {
            fullText = ev.result.trim()
          }

        } catch {
          // Non-JSON line — plain text output from claude (shouldn't happen with stream-json but be safe)
          if (trimmed && !trimmed.startsWith('{')) {
            fullText += trimmed + '\n'
          }
        }
      }
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      clearTimeout(timeoutHandle)
      if (timedOut) return
      const result = fullText.trim()
      if (result) {
        resolve(result)
      } else {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutHandle)
      reject(err)
    })

    const prompt = `You are an AI assistant helping with the Agent Arcade project. Answer clearly and concisely.\n\nUser command: ${instruction}`
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// Register the bridge as an agent in the Arcade
ingest('claude-code-main', 'agent.spawn', {
  name: '🤖 Claude Code',
  role: 'executor',
  characterClass: 'warrior',
  task: 'Directive executor — Console & WhatsApp commands',
  aiModel: `Claude (${DIRECTIVE_MODEL}) via CLI`,
})

// Start polling loop
console.log(`[directive-bridge] Polling for directives every ${POLL_INTERVAL}ms...`)
setInterval(pollAndExecute, POLL_INTERVAL)
pollAndExecute()
