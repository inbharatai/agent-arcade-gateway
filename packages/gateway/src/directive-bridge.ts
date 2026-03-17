#!/usr/bin/env bun
/**
 * Directive Bridge — Connects the Console/WhatsApp directive queue to Claude Code (or any AI tool).
 *
 * This script:
 *   1. Polls GET /v1/directives for pending commands
 *   2. Executes them using `claude -p` (Claude Code CLI)
 *   3. Posts the response back to /v1/directives/:id/done
 *   4. The gateway broadcasts the response via SSE → Console chat shows it
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:47890 bun run packages/gateway/src/directive-bridge.ts
 *
 * This makes the Arcade Console a true universal control panel — type a command
 * in the Console chat, and Claude Code picks it up and responds.
 */

import { spawn } from 'child_process'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47890'
const POLL_INTERVAL = Number(process.env.DIRECTIVE_POLL_MS || '2000') // 2s default
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || ''
const MAX_RESPONSE_LEN = 4000

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (GATEWAY_TOKEN) headers['Authorization'] = `Bearer ${GATEWAY_TOKEN}`

console.log(`[directive-bridge] Starting directive bridge`)
console.log(`[directive-bridge] Gateway: ${GATEWAY_URL}`)
console.log(`[directive-bridge] Poll interval: ${POLL_INTERVAL}ms`)

// Track directives we're currently processing to avoid double-execution
const processing = new Set<string>()

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

      console.log(`[directive-bridge] Executing directive ${d.id.slice(0, 8)} from ${d.source}: ${d.instruction.slice(0, 80)}`)

      // ACK immediately so it doesn't get picked up again
      fetch(`${GATEWAY_URL}/v1/directives/${d.id}/ack`, { method: 'POST', headers }).catch(() => {})

      // Send thinking telemetry
      fetch(`${GATEWAY_URL}/v1/ingest`, {
        method: 'POST', headers,
        body: JSON.stringify({
          v: 1, ts: Date.now(), sessionId: 'copilot-live',
          agentId: d.agentId || 'claude-code-main',
          type: 'agent.state',
          payload: { state: 'thinking', label: `Processing: ${d.instruction.slice(0, 80)}` },
        }),
      }).catch(() => {})

      // Execute via claude CLI
      try {
        const response = await executeWithClaude(d.instruction)
        console.log(`[directive-bridge] Response for ${d.id.slice(0, 8)}: ${response.slice(0, 100)}...`)

        // Post response back to gateway — this broadcasts via SSE to the Console
        await fetch(`${GATEWAY_URL}/v1/directives/${d.id}/done`, {
          method: 'POST', headers,
          body: JSON.stringify({ response: response.slice(0, MAX_RESPONSE_LEN) }),
        })

        // Send done telemetry
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers,
          body: JSON.stringify({
            v: 1, ts: Date.now(), sessionId: 'copilot-live',
            agentId: d.agentId || 'claude-code-main',
            type: 'agent.state',
            payload: { state: 'idle', label: 'Done' },
          }),
        }).catch(() => {})
      } catch (err) {
        console.error(`[directive-bridge] Execution error:`, (err as Error).message)

        // Send error telemetry
        fetch(`${GATEWAY_URL}/v1/ingest`, {
          method: 'POST', headers,
          body: JSON.stringify({
            v: 1, ts: Date.now(), sessionId: 'copilot-live',
            agentId: d.agentId || 'claude-code-main',
            type: 'agent.state',
            payload: { state: 'error', label: `Error: ${(err as Error).message.slice(0, 80)}` },
          }),
        }).catch(() => {})

        // Still mark as done with error response
        await fetch(`${GATEWAY_URL}/v1/directives/${d.id}/done`, {
          method: 'POST', headers,
          body: JSON.stringify({ response: `⚠️ Error: ${(err as Error).message}` }),
        }).catch(() => {})
      } finally {
        // Remove from processing after a delay (in case of re-polls)
        setTimeout(() => processing.delete(d.id), 30000)
      }
    }
  } catch (err) {
    console.warn(`[directive-bridge] Poll error:`, (err as Error).message)
  }
}

function executeWithClaude(instruction: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', 'claude-sonnet-4-6'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim())
      } else if (stdout.trim()) {
        // Non-zero exit but still got output — return it with warning
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`))
      }
    })

    child.on('error', (err) => reject(err))

    // Send the instruction as input
    const prompt = `You are an AI assistant executing a command from the Agent Arcade Console. Respond concisely.\n\nCommand: ${instruction}`
    child.stdin.write(prompt)
    child.stdin.end()

    // Timeout after 60s
    setTimeout(() => {
      child.kill()
      reject(new Error('Execution timed out after 60s'))
    }, 60000)
  })
}

// Register the bridge as an agent in the Arcade
fetch(`${GATEWAY_URL}/v1/ingest`, {
  method: 'POST', headers,
  body: JSON.stringify({
    v: 1, ts: Date.now(), sessionId: 'copilot-live',
    agentId: 'claude-code-main',
    type: 'agent.spawn',
    payload: {
      name: '🤖 Claude Code',
      role: 'executor',
      characterClass: 'warrior',
      task: 'Directive executor — Console & WhatsApp commands',
      aiModel: 'Claude Sonnet 4.6 (via CLI)',
    },
  }),
}).catch(() => {})

// Start polling loop
console.log(`[directive-bridge] Polling for directives every ${POLL_INTERVAL}ms...`)
setInterval(pollAndExecute, POLL_INTERVAL)
// Run immediately on start
pollAndExecute()
