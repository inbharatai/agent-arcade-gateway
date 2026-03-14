/**
 * Agent Arcade Leaderboard System
 *
 * Tracks per-agent stats and ranks them across multiple categories.
 * Persists to localStorage for cross-session continuity.
 */

import type { Agent, TelemetryEvent } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number
  agentId: string
  agentName: string
  aiModel?: string
  totalXP: number
  level: number
  levelTitle: string
  tasksCompleted: number
  avgSpeed: number     // average completion time in ms
  errorRate: number    // 0..1
  toolsUsed: number    // unique tools count
  bestStreak: number   // consecutive error-free completions
  totalErrors: number
  totalRecoveries: number
}

export type LeaderboardCategory = 'overall' | 'speed' | 'reliability' | 'tooling' | 'endurance'

// ---------------------------------------------------------------------------
// Internal stats tracker
// ---------------------------------------------------------------------------

interface AgentStats {
  agentId: string
  agentName: string
  aiModel?: string
  totalXP: number
  level: number
  levelTitle: string
  tasksCompleted: number
  totalDuration: number  // sum of all task durations
  totalErrors: number
  totalRecoveries: number
  uniqueTools: Set<string>
  currentStreak: number
  bestStreak: number
  totalEvents: number
  lastActive: number
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'agent-arcade-leaderboard'

// ---------------------------------------------------------------------------
// Leaderboard Manager
// ---------------------------------------------------------------------------

export class LeaderboardManager {
  private stats = new Map<string, AgentStats>()

  constructor() {
    this._loadFromStorage()
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Process a telemetry event to update agent stats */
  processEvent(event: TelemetryEvent, agents: Map<string, Agent>): void {
    const agent = agents.get(event.agentId)
    if (!agent) return

    const stats = this._getOrCreateStats(event.agentId, agent)
    stats.totalEvents++
    stats.lastActive = event.ts

    switch (event.type) {
      case 'agent.end': {
        const payload = event.payload as Record<string, unknown>
        const success = payload.success !== false
        const duration = event.ts - (agent.spawnedAt || event.ts)

        if (success) {
          stats.tasksCompleted++
          stats.totalDuration += duration

          if (agent.errorCount === 0) {
            stats.currentStreak++
            stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak)
          } else {
            stats.currentStreak = 0
          }
        } else {
          stats.currentStreak = 0
        }
        break
      }

      case 'agent.state': {
        const payload = event.payload as Record<string, unknown>
        if (payload.state === 'error') {
          stats.totalErrors++
        }
        // Recovery
        if (agent.state === 'error' && payload.state !== 'error' && payload.state !== 'done') {
          stats.totalRecoveries++
        }
        break
      }

      case 'agent.tool': {
        const payload = event.payload as Record<string, unknown>
        const toolName = typeof payload.name === 'string' ? payload.name : 'tool'
        stats.uniqueTools.add(toolName)
        break
      }
    }

    this._saveToStorage()
  }

  /** Update XP/level info from XP engine */
  updateXP(agentId: string, totalXP: number, level: number, levelTitle: string): void {
    const stats = this.stats.get(agentId)
    if (stats) {
      stats.totalXP = totalXP
      stats.level = level
      stats.levelTitle = levelTitle
    }
  }

  /** Get sorted leaderboard */
  getLeaderboard(sortBy: LeaderboardCategory = 'overall', limit = 50): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = Array.from(this.stats.values()).map(s => ({
      rank: 0,
      agentId: s.agentId,
      agentName: s.agentName,
      aiModel: s.aiModel,
      totalXP: s.totalXP,
      level: s.level,
      levelTitle: s.levelTitle,
      tasksCompleted: s.tasksCompleted,
      avgSpeed: s.tasksCompleted > 0 ? s.totalDuration / s.tasksCompleted : 0,
      errorRate: s.tasksCompleted > 0 ? s.totalErrors / (s.tasksCompleted + s.totalErrors) : 0,
      toolsUsed: s.uniqueTools.size,
      bestStreak: s.bestStreak,
      totalErrors: s.totalErrors,
      totalRecoveries: s.totalRecoveries,
    }))

    // Sort by category
    switch (sortBy) {
      case 'overall':
        entries.sort((a, b) => b.totalXP - a.totalXP)
        break
      case 'speed':
        entries.sort((a, b) => {
          if (a.tasksCompleted === 0) return 1
          if (b.tasksCompleted === 0) return -1
          return a.avgSpeed - b.avgSpeed // lower is better
        })
        break
      case 'reliability':
        entries.sort((a, b) => {
          if (a.tasksCompleted === 0) return 1
          if (b.tasksCompleted === 0) return -1
          return a.errorRate - b.errorRate // lower is better
        })
        break
      case 'tooling':
        entries.sort((a, b) => b.toolsUsed - a.toolsUsed)
        break
      case 'endurance':
        entries.sort((a, b) => b.tasksCompleted - a.tasksCompleted)
        break
    }

    // Assign ranks
    entries.forEach((entry, i) => { entry.rank = i + 1 })

    return entries.slice(0, limit)
  }

  /** Get a specific agent's rank */
  getAgentRank(agentId: string, category: LeaderboardCategory = 'overall'): number {
    const board = this.getLeaderboard(category, 1000)
    const entry = board.find(e => e.agentId === agentId)
    return entry?.rank || 0
  }

  /** Get top N agents in a category */
  getTopN(n: number, category: LeaderboardCategory = 'overall'): LeaderboardEntry[] {
    return this.getLeaderboard(category, n)
  }

  // ── Internal ───────────────────────────────────────────────────────

  private _getOrCreateStats(agentId: string, agent: Agent): AgentStats {
    let stats = this.stats.get(agentId)
    if (!stats) {
      stats = {
        agentId,
        agentName: agent.name,
        aiModel: agent.aiModel,
        totalXP: 0,
        level: 1,
        levelTitle: 'Novice',
        tasksCompleted: 0,
        totalDuration: 0,
        totalErrors: 0,
        totalRecoveries: 0,
        uniqueTools: new Set(),
        currentStreak: 0,
        bestStreak: 0,
        totalEvents: 0,
        lastActive: Date.now(),
      }
      this.stats.set(agentId, stats)
    }
    return stats
  }

  private _loadFromStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved) as Record<string, any>
        for (const [id, s] of Object.entries(data)) {
          this.stats.set(id, {
            ...s,
            uniqueTools: new Set(s.uniqueTools || []),
          })
        }
      }
    } catch { /* start fresh */ }
  }

  private _saveToStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const data: Record<string, any> = {}
      for (const [id, s] of this.stats) {
        data[id] = {
          ...s,
          uniqueTools: Array.from(s.uniqueTools),
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* storage full */ }
  }
}

export default LeaderboardManager
