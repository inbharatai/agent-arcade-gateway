/**
 * Agent Arcade Process Watcher
 *
 * Polls running processes every 2 seconds to auto-detect known AI agent
 * processes. Spawns agent cards and infers activity from CPU/memory usage.
 *
 * Known processes: claude, aider, cursor, devin, copilot, python (with
 * langchain/crewai in args), node (with openai in args).
 */

import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessInfo {
  pid: number
  name: string
  cpu: number
  memory: number
  command: string
}

interface TrackedAgent {
  pid: number
  agentId: string
  name: string
  type: string
  spawned: boolean
  lastCpu: number
  lastState: string
}

interface WatcherConfig {
  gatewayUrl?: string
  sessionId?: string
  interval?: number
}

// ---------------------------------------------------------------------------
// Process patterns to detect
// ---------------------------------------------------------------------------

const AI_PROCESS_PATTERNS: Array<{ pattern: RegExp; name: string; type: string }> = [
  { pattern: /\bclaude\b/i, name: 'Claude Code', type: 'claude-code' },
  { pattern: /\baider\b/i, name: 'Aider', type: 'aider' },
  { pattern: /\bcursor\b/i, name: 'Cursor', type: 'cursor' },
  { pattern: /\bdevin\b/i, name: 'Devin', type: 'devin' },
  { pattern: /\bcopilot\b/i, name: 'GitHub Copilot', type: 'copilot' },
  { pattern: /python.*langchain/i, name: 'LangChain Agent', type: 'langchain' },
  { pattern: /python.*crewai/i, name: 'CrewAI Agent', type: 'crewai' },
  { pattern: /python.*autogen/i, name: 'AutoGen Agent', type: 'autogen' },
  { pattern: /python.*llamaindex/i, name: 'LlamaIndex Agent', type: 'llamaindex' },
  { pattern: /\bollama\b.*serve/i, name: 'Ollama', type: 'ollama' },
]

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

async function emitEvent(gatewayUrl: string, event: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${gatewayUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Process discovery
// ---------------------------------------------------------------------------

function getProcessList(): ProcessInfo[] {
  try {
    const isWindows = process.platform === 'win32'
    let output: string

    if (isWindows) {
      output = execSync(
        'wmic process get ProcessId,Name,WorkingSetSize,CommandLine /FORMAT:CSV',
        { encoding: 'utf-8', timeout: 5000 }
      )
      return output.split('\n').filter(l => l.trim()).slice(1).map(line => {
        const parts = line.split(',')
        return {
          pid: parseInt(parts[parts.length - 2]) || 0,
          name: parts[1] || '',
          cpu: 0,
          memory: parseInt(parts[parts.length - 1]) || 0,
          command: parts.slice(1, -2).join(','),
        }
      }).filter(p => p.pid > 0)
    } else {
      output = execSync(
        'ps aux --no-headers 2>/dev/null || ps aux',
        { encoding: 'utf-8', timeout: 5000 }
      )
      return output.split('\n').filter(l => l.trim()).map(line => {
        const parts = line.trim().split(/\s+/)
        return {
          pid: parseInt(parts[1]) || 0,
          name: parts[10] || '',
          cpu: parseFloat(parts[2]) || 0,
          memory: parseFloat(parts[3]) || 0,
          command: parts.slice(10).join(' '),
        }
      }).filter(p => p.pid > 0)
    }
  } catch {
    return []
  }
}

function matchProcess(proc: ProcessInfo): { name: string; type: string } | null {
  const fullText = `${proc.name} ${proc.command}`
  for (const pattern of AI_PROCESS_PATTERNS) {
    if (pattern.pattern.test(fullText)) {
      return { name: pattern.name, type: pattern.type }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Process Watcher
// ---------------------------------------------------------------------------

export class ProcessWatcher {
  private config: Required<WatcherConfig>
  private tracked = new Map<number, TrackedAgent>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: WatcherConfig = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl || 'http://localhost:8787',
      sessionId: config.sessionId || 'process-watcher',
      interval: config.interval || 2000,
    }
  }

  start(): void {
    console.log(`[Process Watcher] Scanning every ${this.config.interval}ms`)
    this._poll() // initial scan
    this.timer = setInterval(() => this._poll(), this.config.interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // End all tracked agents
    for (const [, agent] of this.tracked) {
      if (agent.spawned) {
        emitEvent(this.config.gatewayUrl, {
          v: 1, ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: agent.agentId,
          type: 'agent.end',
          payload: { reason: 'Watcher stopped', success: true },
        })
      }
    }
  }

  private async _poll(): Promise<void> {
    const processes = getProcessList()
    const seenPids = new Set<number>()

    for (const proc of processes) {
      const match = matchProcess(proc)
      if (!match) continue

      seenPids.add(proc.pid)

      let agent = this.tracked.get(proc.pid)
      if (!agent) {
        // New agent detected
        const agentId = `proc_${proc.pid}_${Date.now().toString(36)}`
        agent = {
          pid: proc.pid,
          agentId,
          name: match.name,
          type: match.type,
          spawned: false,
          lastCpu: proc.cpu,
          lastState: 'idle',
        }
        this.tracked.set(proc.pid, agent)

        // Spawn
        await emitEvent(this.config.gatewayUrl, {
          v: 1, ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId,
          type: 'agent.spawn',
          payload: {
            name: match.name,
            role: match.type,
            source: 'process',
            confidence: 0.98,
          },
        })
        agent.spawned = true
        console.log(`[Process Watcher] Detected: ${match.name} (PID ${proc.pid})`)
      }

      // Infer state from CPU
      let inferredState = 'idle'
      if (proc.cpu > 50) inferredState = 'thinking'
      else if (proc.cpu > 20) inferredState = 'writing'
      else if (proc.cpu > 5) inferredState = 'reading'

      if (inferredState !== agent.lastState) {
        await emitEvent(this.config.gatewayUrl, {
          v: 1, ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: agent.agentId,
          type: 'agent.state',
          payload: {
            state: inferredState,
            label: `CPU: ${proc.cpu.toFixed(1)}% | MEM: ${proc.memory.toFixed(1)}%`,
            source: 'process',
            confidence: inferredState === 'idle' ? 0.95 : 0.72,
          },
        })
        agent.lastState = inferredState
      }

      agent.lastCpu = proc.cpu
    }

    // Detect gone processes
    for (const [pid, agent] of this.tracked) {
      if (!seenPids.has(pid) && agent.spawned) {
        await emitEvent(this.config.gatewayUrl, {
          v: 1, ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: agent.agentId,
          type: 'agent.end',
          payload: { reason: 'Process exited', success: true },
        })
        this.tracked.delete(pid)
        console.log(`[Process Watcher] Gone: ${agent.name} (PID ${pid})`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const watcher = new ProcessWatcher({
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:8787',
    sessionId: process.env.SESSION_ID || 'process-watcher',
  })

  watcher.start()

  process.on('SIGINT', () => {
    watcher.stop()
    process.exit(0)
  })
}

export default ProcessWatcher
