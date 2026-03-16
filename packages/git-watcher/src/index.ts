/**
 * Agent Arcade Git Watcher
 *
 * Monitors git index every 5 seconds for changes.
 * Detects new staged/unstaged files and emits agent.tool(write_file) events.
 * Attributes changes to the active agent process.
 */

import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitChange {
  status: string     // M, A, D, R, etc.
  file: string
  staged: boolean
}

interface WatcherConfig {
  /** Directory to watch (must be a git repo) */
  repoPath: string
  /** Gateway URL (default: http://localhost:47890) */
  gatewayUrl?: string
  /** Session ID */
  sessionId?: string
  /** Poll interval in ms (default: 5000) */
  interval?: number
  /** Agent ID to attribute changes to (optional -- auto-detect if not set) */
  agentId?: string
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
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

function getGitStatus(repoPath: string): GitChange[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    if (!output) return []

    return output.split('\n').map(line => {
      const stagedStatus = line[0]
      const unstagedStatus = line[1]
      const file = line.slice(3).trim()

      if (stagedStatus !== ' ' && stagedStatus !== '?') {
        return { status: stagedStatus, file, staged: true }
      }
      return { status: unstagedStatus === '?' ? 'A' : unstagedStatus, file, staged: false }
    }).filter(c => c.file)
  } catch {
    return []
  }
}

function getDiffSummary(repoPath: string): string {
  try {
    const stat = execSync('git diff --stat', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    const lastLine = stat.split('\n').pop() || ''
    return lastLine
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export class GitWatcher {
  private config: Required<WatcherConfig>
  private previousFiles = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private agentSpawned = false

  constructor(config: WatcherConfig) {
    this.config = {
      repoPath: config.repoPath,
      gatewayUrl: config.gatewayUrl || 'http://localhost:47890',
      sessionId: config.sessionId || 'git-watcher',
      interval: config.interval || 5000,
      agentId: config.agentId || `git_${Date.now().toString(36)}`,
    }
  }

  /** Start watching */
  start(): void {
    console.log(`[Git Watcher] Watching ${this.config.repoPath} every ${this.config.interval}ms`)

    // Initial snapshot
    const initial = getGitStatus(this.config.repoPath)
    this.previousFiles = new Set(initial.map(c => `${c.status}:${c.file}`))

    this.timer = setInterval(() => this._poll(), this.config.interval)
  }

  /** Stop watching */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.agentSpawned) {
      emitEvent(this.config.gatewayUrl, {
        v: 1,
        ts: Date.now(),
        sessionId: this.config.sessionId,
        agentId: this.config.agentId,
        type: 'agent.end',
        payload: { reason: 'Git watcher stopped', success: true },
      })
    }
  }

  private async _poll(): Promise<void> {
    const changes = getGitStatus(this.config.repoPath)
    const currentKeys = new Set(changes.map(c => `${c.status}:${c.file}`))

    // Find new changes
    const newChanges = changes.filter(c => !this.previousFiles.has(`${c.status}:${c.file}`))

    if (newChanges.length > 0) {
      // Spawn agent if first time
      if (!this.agentSpawned) {
        await emitEvent(this.config.gatewayUrl, {
          v: 1,
          ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: this.config.agentId,
          type: 'agent.spawn',
          payload: { name: 'Git Activity', role: 'file-watcher', source: 'filesystem', confidence: 0.85 },
        })
        this.agentSpawned = true
      }

      // Emit tool events for each new file change
      for (const change of newChanges) {
        const action = change.status === 'A' ? 'create' : change.status === 'D' ? 'delete' : 'modify'
        await emitEvent(this.config.gatewayUrl, {
          v: 1,
          ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: this.config.agentId,
          type: 'agent.tool',
          payload: {
            name: 'write_file',
            label: `${action}: ${change.file}`,
            path: change.file,
            source: 'filesystem',
            confidence: 0.85,
          },
        })
      }

      // Summary message
      const diffSummary = getDiffSummary(this.config.repoPath)
      if (diffSummary) {
        await emitEvent(this.config.gatewayUrl, {
          v: 1,
          ts: Date.now(),
          sessionId: this.config.sessionId,
          agentId: this.config.agentId,
          type: 'agent.message',
          payload: { text: `${newChanges.length} file(s) changed: ${diffSummary}` },
        })
      }

      // Update state
      await emitEvent(this.config.gatewayUrl, {
        v: 1,
        ts: Date.now(),
        sessionId: this.config.sessionId,
        agentId: this.config.agentId,
        type: 'agent.state',
        payload: { state: 'writing', label: `${changes.length} files modified`, source: 'filesystem', confidence: 0.85 },
      })
    }

    this.previousFiles = currentKeys
  }
}

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const repoPath = process.argv[2] || process.cwd()
  const watcher = new GitWatcher({
    repoPath,
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:47890',
    sessionId: process.env.SESSION_ID || 'git-watcher',
  })

  watcher.start()

  process.on('SIGINT', () => {
    watcher.stop()
    process.exit(0)
  })
}

export default GitWatcher
