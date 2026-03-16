/**
 * Agent Arcade Log Tailer
 *
 * Watches log files from known AI tools and auto-parses into agent events.
 * Supports: Claude Code, Aider, custom log formats.
 */

import { watch, readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogTailerConfig {
  gatewayUrl?: string
  sessionId?: string
  logSources?: LogSource[]
}

interface LogSource {
  name: string
  path: string
  parser: 'claude-code' | 'aider' | 'generic'
}

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
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Log Parsers
// ---------------------------------------------------------------------------

function parseClaudeCodeLine(line: string): { state?: string; label?: string; tool?: string } | null {
  if (!line.trim()) return null

  // Tool usage patterns
  if (line.includes('Tool:') || line.includes('tool_use')) {
    const toolMatch = line.match(/Tool:\s*(\w+)/) || line.match(/name["']?\s*:\s*["'](\w+)/)
    return { state: 'tool', tool: toolMatch?.[1] || 'tool', label: line.trim().slice(0, 200) }
  }

  // Thinking patterns
  if (line.includes('thinking') || line.includes('Analyzing') || line.includes('Processing')) {
    return { state: 'thinking', label: line.trim().slice(0, 200) }
  }

  // Writing patterns
  if (line.includes('Generating') || line.includes('Writing') || line.includes('Creating')) {
    return { state: 'writing', label: line.trim().slice(0, 200) }
  }

  // Reading patterns
  if (line.includes('Reading') || line.includes('Loading') || line.includes('Fetching')) {
    return { state: 'reading', label: line.trim().slice(0, 200) }
  }

  // Error patterns
  if (line.includes('Error') || line.includes('error') || line.includes('FAILED')) {
    return { state: 'error', label: line.trim().slice(0, 200) }
  }

  return null
}

function parseAiderLine(line: string): { state?: string; label?: string; tool?: string } | null {
  if (!line.trim()) return null

  if (line.includes('> ') || line.startsWith('USER')) {
    return { state: 'waiting', label: 'Waiting for input' }
  }
  if (line.includes('ASSISTANT') || line.includes('Thinking')) {
    return { state: 'thinking', label: line.trim().slice(0, 200) }
  }
  if (line.includes('Applied edit') || line.includes('wrote')) {
    return { state: 'writing', label: line.trim().slice(0, 200) }
  }
  if (line.includes('git') || line.includes('commit')) {
    return { state: 'tool', tool: 'git', label: line.trim().slice(0, 200) }
  }

  return null
}

function parseGenericLine(line: string): { state?: string; label?: string; tool?: string } | null {
  if (!line.trim()) return null
  const lower = line.toLowerCase()

  if (lower.includes('error') || lower.includes('exception')) {
    return { state: 'error', label: line.trim().slice(0, 200) }
  }
  if (lower.includes('complete') || lower.includes('success') || lower.includes('done')) {
    return { state: 'done', label: line.trim().slice(0, 200) }
  }
  if (lower.includes('start') || lower.includes('begin') || lower.includes('processing')) {
    return { state: 'thinking', label: line.trim().slice(0, 200) }
  }

  return null
}

const PARSERS: Record<string, (line: string) => ReturnType<typeof parseClaudeCodeLine>> = {
  'claude-code': parseClaudeCodeLine,
  'aider': parseAiderLine,
  'generic': parseGenericLine,
}

// ---------------------------------------------------------------------------
// Log Tailer
// ---------------------------------------------------------------------------

export class LogTailer {
  private config: Required<LogTailerConfig>
  private fileOffsets = new Map<string, number>()
  private agentIds = new Map<string, string>()
  private watchers: Array<ReturnType<typeof setInterval>> = []

  constructor(config: LogTailerConfig = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl || 'http://localhost:47890',
      sessionId: config.sessionId || 'log-tailer',
      logSources: config.logSources || this._getDefaultSources(),
    }
  }

  start(): void {
    for (const source of this.config.logSources) {
      if (!existsSync(source.path)) {
        console.log(`[Log Tailer] Skipping ${source.name} -- path not found: ${source.path}`)
        continue
      }

      console.log(`[Log Tailer] Watching: ${source.name} at ${source.path}`)

      // Set initial offset to end of file
      try {
        const stat = statSync(source.path)
        this.fileOffsets.set(source.path, stat.size)
      } catch {
        this.fileOffsets.set(source.path, 0)
      }

      // Poll for changes
      const timer = setInterval(() => this._checkFile(source), 2000)
      this.watchers.push(timer)
    }
  }

  stop(): void {
    for (const timer of this.watchers) {
      clearInterval(timer)
    }
    this.watchers = []

    // End all agents
    for (const [, agentId] of this.agentIds) {
      emitEvent(this.config.gatewayUrl, {
        v: 1, ts: Date.now(),
        sessionId: this.config.sessionId,
        agentId,
        type: 'agent.end',
        payload: { reason: 'Log tailer stopped', success: true },
      })
    }
  }

  private async _checkFile(source: LogSource): Promise<void> {
    try {
      const stat = statSync(source.path)
      const prevOffset = this.fileOffsets.get(source.path) || 0

      if (stat.size <= prevOffset) return // No new data

      // Read new content
      const fd = readFileSync(source.path, 'utf-8')
      const newContent = fd.slice(prevOffset)
      this.fileOffsets.set(source.path, stat.size)

      const lines = newContent.split('\n').filter(l => l.trim())
      const parser = PARSERS[source.parser] || PARSERS.generic

      // Ensure agent exists
      let agentId = this.agentIds.get(source.name)
      if (!agentId) {
        agentId = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        this.agentIds.set(source.name, agentId)

        await emitEvent(this.config.gatewayUrl, {
          v: 1, ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId,
          type: 'agent.spawn',
          payload: { name: source.name, role: 'log-source', source: 'filesystem', confidence: 0.72 },
        })
      }

      for (const line of lines) {
        const parsed = parser(line)
        if (!parsed) continue

        if (parsed.tool) {
          await emitEvent(this.config.gatewayUrl, {
            v: 1, ts: Date.now(),
            sessionId: this.config.sessionId,
            agentId,
            type: 'agent.tool',
            payload: { name: parsed.tool, label: parsed.label, source: 'filesystem', confidence: 0.72 },
          })
        }

        if (parsed.state) {
          await emitEvent(this.config.gatewayUrl, {
            v: 1, ts: Date.now(),
            sessionId: this.config.sessionId,
            agentId,
            type: 'agent.state',
            payload: { state: parsed.state, label: parsed.label, source: 'filesystem', confidence: 0.72 },
          })
        }
      }
    } catch {
      // File might be locked or rotated
    }
  }

  private _getDefaultSources(): LogSource[] {
    const sources: LogSource[] = []
    const home = homedir()

    // Claude Code logs
    const claudeLogDir = join(home, '.claude', 'logs')
    if (existsSync(claudeLogDir)) {
      sources.push({ name: 'Claude Code', path: claudeLogDir, parser: 'claude-code' })
    }

    // Aider history
    const aiderHistory = join(process.cwd(), '.aider.chat.history.md')
    if (existsSync(aiderHistory)) {
      sources.push({ name: 'Aider', path: aiderHistory, parser: 'aider' })
    }

    return sources
  }
}

// ---------------------------------------------------------------------------
// Standalone
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const tailer = new LogTailer({
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:47890',
    sessionId: process.env.SESSION_ID || 'log-tailer',
  })

  tailer.start()

  process.on('SIGINT', () => {
    tailer.stop()
    process.exit(0)
  })
}

export default LogTailer
