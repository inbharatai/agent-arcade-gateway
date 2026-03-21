#!/usr/bin/env bun
/**
 * Multi-Agent Orchestrator — Coordinates multiple AI agents working in parallel
 *
 * Features:
 * - Spawns specialized agents for different task types
 * - Coordinates parallel execution
 * - Aggregates results from multiple agents
 * - Provides voice feedback for each agent's progress
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:47890 bun run packages/gateway/src/multi-agent-orchestrator.ts
 */

import { spawn } from 'child_process'
import { createHmac } from 'crypto'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47890'
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || ''
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || ''
const ORCHESTRATOR_SESSION_ID = process.env.ORCHESTRATOR_SESSION_ID || 'multi-agent-session'
const MAX_PARALLEL_AGENTS = Number(process.env.MAX_PARALLEL_AGENTS || '5')
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || '180000') // 3 minutes per agent

/** Agent specializations with their capabilities */
interface AgentSpec {
  id: string
  name: string
  role: string
  characterClass: string
  specialization: string
  model?: string
}

const AGENT_SPECS: AgentSpec[] = [
  {
    id: 'architect-agent',
    name: '🏗️ Architect',
    role: 'planner',
    characterClass: 'sage',
    specialization: 'System design and architecture planning',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'coder-agent',
    name: '💻 Coder',
    role: 'executor',
    characterClass: 'warrior',
    specialization: 'Code implementation and file operations',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'tester-agent',
    name: '🧪 Tester',
    role: 'validator',
    characterClass: 'scout',
    specialization: 'Testing and quality assurance',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'reviewer-agent',
    name: '🔍 Reviewer',
    role: 'reviewer',
    characterClass: 'sage',
    specialization: 'Code review and best practices',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'debugger-agent',
    name: '🐛 Debugger',
    role: 'debugger',
    characterClass: 'healer',
    specialization: 'Bug fixing and troubleshooting',
    model: 'claude-sonnet-4-5',
  },
]

/** Compute HMAC-SHA256 session signature */
function signSession(sessionId: string): string {
  if (!SESSION_SIGNING_SECRET) return ''
  return createHmac('sha256', SESSION_SIGNING_SECRET).update(sessionId).digest('hex')
}

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (GATEWAY_TOKEN) headers['Authorization'] = `Bearer ${GATEWAY_TOKEN}`
const sessionSig = signSession(ORCHESTRATOR_SESSION_ID)
if (sessionSig) headers['x-session-signature'] = sessionSig

/** Fire-and-forget telemetry helper */
function ingest(agentId: string, type: string, payload: Record<string, unknown>) {
  fetch(`${GATEWAY_URL}/v1/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      v: 1,
      ts: Date.now(),
      sessionId: ORCHESTRATOR_SESSION_ID,
      agentId,
      type,
      payload,
    }),
  }).catch(() => {})
}

/** Execute a task with Claude Code CLI */
async function executeTask(
  spec: AgentSpec,
  instruction: string,
  onProgress: (msg: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--verbose',
      '--model', spec.model || 'claude-sonnet-4-5',
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
      reject(new Error(`${spec.name} timed out after ${AGENT_TIMEOUT_MS / 1000}s`))
    }, AGENT_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString()
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const ev = JSON.parse(trimmed) as Record<string, unknown>

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
                  onProgress(`${spec.name} using ${toolName}`)
                  ingest(spec.id, 'agent.tool', { name: toolName })
                  ingest(spec.id, 'agent.message', {
                    text: `Using ${toolName}`,
                    level: 'info',
                  })
                }
              }
            }
          }

          if (ev.type === 'tool' && typeof ev.tool_name === 'string') {
            stepCount++
            const toolName = ev.tool_name as string
            onProgress(`${spec.name} using ${toolName}`)
            ingest(spec.id, 'agent.tool', { name: toolName })
          }

          if (ev.type === 'result' && typeof ev.result === 'string' && ev.result.trim()) {
            fullText = ev.result.trim()
          }
        } catch {
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
        reject(new Error(stderr.trim() || `${spec.name} exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeoutHandle)
      reject(err)
    })

    const prompt = `You are ${spec.name}, a specialized AI agent with expertise in ${spec.specialization}.\n\nTask: ${instruction}`
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** Break down a complex task into subtasks for parallel execution */
function decomposeTask(mainTask: string): Array<{ spec: AgentSpec; task: string }> {
  const subtasks: Array<{ spec: AgentSpec; task: string }> = []

  // Simple task decomposition logic (can be enhanced with AI)
  const lowerTask = mainTask.toLowerCase()

  // If task mentions design/architecture, assign to Architect
  if (lowerTask.includes('design') || lowerTask.includes('architect') || lowerTask.includes('plan')) {
    subtasks.push({
      spec: AGENT_SPECS[0], // Architect
      task: `Plan the architecture and design for: ${mainTask}`,
    })
  }

  // If task mentions coding/implementation, assign to Coder
  if (lowerTask.includes('implement') || lowerTask.includes('code') || lowerTask.includes('write') || lowerTask.includes('create')) {
    subtasks.push({
      spec: AGENT_SPECS[1], // Coder
      task: `Implement the solution for: ${mainTask}`,
    })
  }

  // If task mentions testing, assign to Tester
  if (lowerTask.includes('test') || lowerTask.includes('qa')) {
    subtasks.push({
      spec: AGENT_SPECS[2], // Tester
      task: `Write and run tests for: ${mainTask}`,
    })
  }

  // If task mentions review/quality, assign to Reviewer
  if (lowerTask.includes('review') || lowerTask.includes('quality') || lowerTask.includes('refactor')) {
    subtasks.push({
      spec: AGENT_SPECS[3], // Reviewer
      task: `Review and suggest improvements for: ${mainTask}`,
    })
  }

  // If task mentions bug/fix/debug, assign to Debugger
  if (lowerTask.includes('bug') || lowerTask.includes('fix') || lowerTask.includes('debug') || lowerTask.includes('error')) {
    subtasks.push({
      spec: AGENT_SPECS[4], // Debugger
      task: `Debug and fix issues in: ${mainTask}`,
    })
  }

  // If no specific agents matched, assign to all available agents
  if (subtasks.length === 0) {
    subtasks.push(
      { spec: AGENT_SPECS[0], task: `Analyze and plan: ${mainTask}` },
      { spec: AGENT_SPECS[1], task: `Execute: ${mainTask}` },
    )
  }

  return subtasks.slice(0, MAX_PARALLEL_AGENTS)
}

/** Orchestrate multiple agents working on a complex task */
async function orchestrateTask(mainTask: string): Promise<string> {
  console.log(`[multi-agent] Orchestrating task: ${mainTask}`)

  // Spawn orchestrator agent
  ingest('orchestrator', 'agent.spawn', {
    name: '🎯 Orchestrator',
    role: 'coordinator',
    characterClass: 'commander',
    task: `Coordinating multi-agent execution`,
    aiModel: 'Multi-Agent System',
  })

  ingest('orchestrator', 'agent.message', {
    text: `Decomposing task into specialized subtasks`,
    level: 'info',
  })

  const subtasks = decomposeTask(mainTask)
  console.log(`[multi-agent] Decomposed into ${subtasks.length} subtasks`)

  // Spawn all agent workers
  for (const { spec } of subtasks) {
    ingest(spec.id, 'agent.spawn', {
      name: spec.name,
      role: spec.role,
      characterClass: spec.characterClass,
      task: spec.specialization,
      aiModel: `Claude (${spec.model})`,
    })
    ingest(spec.id, 'agent.message', {
      text: `${spec.name} ready to assist with ${spec.specialization}`,
      level: 'info',
    })
  }

  ingest('orchestrator', 'agent.message', {
    text: `Executing ${subtasks.length} agents in parallel`,
    level: 'info',
  })

  // Execute all subtasks in parallel
  const results = await Promise.allSettled(
    subtasks.map(async ({ spec, task }) => {
      console.log(`[multi-agent] ${spec.name} starting: ${task.slice(0, 80)}`)

      ingest(spec.id, 'agent.state', {
        state: 'thinking',
        label: `Task: ${task.slice(0, 80)}`,
        task: task.slice(0, 120),
      })
      ingest(spec.id, 'agent.message', {
        text: `Starting my task`,
        level: 'info',
      })

      try {
        const result = await executeTask(
          spec,
          task,
          (msg) => console.log(`[multi-agent]   ${msg}`),
        )

        ingest(spec.id, 'agent.state', { state: 'idle', label: 'Done ✓' })
        ingest(spec.id, 'agent.message', {
          text: `Task completed successfully`,
          level: 'success',
        })

        console.log(`[multi-agent] ${spec.name} completed`)
        return { spec, result }
      } catch (err) {
        console.error(`[multi-agent] ${spec.name} error:`, (err as Error).message)

        ingest(spec.id, 'agent.state', {
          state: 'error',
          label: `Error: ${(err as Error).message.slice(0, 80)}`,
        })
        ingest(spec.id, 'agent.message', {
          text: `Error: ${(err as Error).message.slice(0, 60)}`,
          level: 'error',
        })

        throw err
      }
    }),
  )

  // Aggregate results
  const successful = results.filter(r => r.status === 'fulfilled') as Array<{
    status: 'fulfilled'
    value: { spec: AgentSpec; result: string }
  }>
  const failed = results.filter(r => r.status === 'rejected')

  console.log(`[multi-agent] Completed: ${successful.length} succeeded, ${failed.length} failed`)

  ingest('orchestrator', 'agent.message', {
    text: `Task complete: ${successful.length} agents succeeded, ${failed.length} failed`,
    level: 'success',
  })

  // Combine all successful results
  let finalReport = `# Multi-Agent Task Results\n\n`
  finalReport += `## Task: ${mainTask}\n\n`
  finalReport += `**Agents deployed:** ${subtasks.length}\n`
  finalReport += `**Successful:** ${successful.length}\n`
  finalReport += `**Failed:** ${failed.length}\n\n`

  for (const { value } of successful) {
    finalReport += `---\n\n### ${value.spec.name} (${value.spec.specialization})\n\n`
    finalReport += `${value.result}\n\n`
  }

  if (failed.length > 0) {
    finalReport += `---\n\n### Failures\n\n`
    for (const failure of failed) {
      finalReport += `- ${(failure as { reason: Error }).reason.message}\n`
    }
  }

  ingest('orchestrator', 'agent.state', { state: 'idle', label: 'Orchestration complete' })

  return finalReport
}

/** Main orchestration loop - polls for directives and dispatches to multi-agent system */
async function pollAndOrchestrate() {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/directives`, { headers })
    if (!res.ok) {
      console.warn(`[multi-agent] Poll failed: HTTP ${res.status}`)
      return
    }

    const data = await res.json() as {
      directives: Array<{ id: string; instruction: string; source: string }>
    }
    const pending = data.directives || []

    for (const directive of pending) {
      // Only handle directives tagged for multi-agent execution
      if (!directive.instruction.toLowerCase().includes('multi-agent') &&
          !directive.instruction.toLowerCase().includes('parallel')) {
        continue
      }

      console.log(`[multi-agent] Handling directive ${directive.id.slice(0, 8)}`)

      // ACK immediately
      await fetch(`${GATEWAY_URL}/v1/directives/${directive.id}/ack`, {
        method: 'POST',
        headers,
      }).catch(() => {})

      try {
        const result = await orchestrateTask(directive.instruction)

        await fetch(`${GATEWAY_URL}/v1/directives/${directive.id}/done`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ response: result.slice(0, 8000) }),
        })
      } catch (err) {
        console.error(`[multi-agent] Orchestration error:`, (err as Error).message)

        await fetch(`${GATEWAY_URL}/v1/directives/${directive.id}/done`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            response: `⚠️ Multi-agent orchestration failed: ${(err as Error).message}`,
          }),
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.warn(`[multi-agent] Poll error:`, (err as Error).message)
  }
}

// Register orchestrator
console.log(`[multi-agent] Multi-Agent Orchestrator starting`)
console.log(`[multi-agent] Gateway: ${GATEWAY_URL}`)
console.log(`[multi-agent] Max parallel agents: ${MAX_PARALLEL_AGENTS}`)
console.log(`[multi-agent] Available agent types:`)
for (const spec of AGENT_SPECS) {
  console.log(`  - ${spec.name}: ${spec.specialization}`)
}

ingest('orchestrator', 'agent.spawn', {
  name: '🎯 Multi-Agent Orchestrator',
  role: 'coordinator',
  characterClass: 'commander',
  task: 'Coordinates multiple specialized AI agents',
  aiModel: 'Orchestration System',
})

// Poll every 3 seconds
setInterval(pollAndOrchestrate, 3000)
pollAndOrchestrate()
