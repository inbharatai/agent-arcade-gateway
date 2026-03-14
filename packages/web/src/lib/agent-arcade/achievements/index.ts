/**
 * Agent Arcade Achievement System
 *
 * 30+ achievements across 6 categories with progress tracking,
 * localStorage persistence, and event-driven unlock notifications.
 */

import type { Agent, TelemetryEvent, AgentState } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'diamond'
export type AchievementCategory = 'speed' | 'reliability' | 'tooling' | 'endurance' | 'teamwork' | 'special'

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  tier: AchievementTier
  category: AchievementCategory
  unlockedAt?: number
  progress: number // 0..1
  target: number   // numerical target for progress tracking
  current: number  // current progress count
}

export interface AchievementUnlockEvent {
  achievement: Achievement
  timestamp: number
}

// ---------------------------------------------------------------------------
// Achievement Definitions
// ---------------------------------------------------------------------------

interface AchievementDef {
  id: string
  name: string
  description: string
  icon: string
  tier: AchievementTier
  category: AchievementCategory
  target: number
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ── Speed ───────────────────────────────────────────────────────────
  { id: 'speed_lightning', name: 'Lightning Reflexes', description: 'Complete a task under 1 second', icon: '\u26A1', tier: 'gold', category: 'speed', target: 1 },
  { id: 'speed_demon', name: 'Speed Demon', description: 'Complete 5 tasks under 2 seconds each', icon: '\uD83D\uDD25', tier: 'silver', category: 'speed', target: 5 },
  { id: 'speed_flash', name: 'Flash', description: 'Complete a task under 500ms', icon: '\uD83D\uDCA8', tier: 'diamond', category: 'speed', target: 1 },
  { id: 'speed_timelord', name: 'Time Lord', description: 'Complete 10 tasks under 3 seconds', icon: '\u231B', tier: 'gold', category: 'speed', target: 10 },
  { id: 'speed_quickdraw', name: 'Quick Draw', description: 'Complete 25 tasks under 5 seconds', icon: '\uD83C\uDFAF', tier: 'silver', category: 'speed', target: 25 },

  // ── Reliability ─────────────────────────────────────────────────────
  { id: 'rel_firstblood', name: 'First Blood', description: 'Complete your first task successfully', icon: '\uD83C\uDF1F', tier: 'bronze', category: 'reliability', target: 1 },
  { id: 'rel_survivor', name: 'Survivor', description: 'Recover from an error', icon: '\uD83D\uDEE1\uFE0F', tier: 'bronze', category: 'reliability', target: 1 },
  { id: 'rel_bulletproof', name: 'Bulletproof', description: 'Complete 10 tasks with zero errors', icon: '\uD83D\uDEE1\uFE0F', tier: 'silver', category: 'reliability', target: 10 },
  { id: 'rel_perfectrun', name: 'Perfect Run', description: 'Complete an entire session error-free', icon: '\uD83C\uDFC6', tier: 'gold', category: 'reliability', target: 1 },
  { id: 'rel_comeback', name: 'Comeback Kid', description: 'Recover from 3+ errors in one session', icon: '\uD83D\uDD04', tier: 'gold', category: 'reliability', target: 3 },
  { id: 'rel_ironclad', name: 'Ironclad', description: 'Complete 50 tasks with zero errors', icon: '\uD83E\uDDF1', tier: 'diamond', category: 'reliability', target: 50 },

  // ── Tooling ─────────────────────────────────────────────────────────
  { id: 'tool_first', name: 'Tool Time', description: 'Use your first tool', icon: '\uD83D\uDD27', tier: 'bronze', category: 'tooling', target: 1 },
  { id: 'tool_swiss', name: 'Swiss Army Knife', description: 'Use 5 different tools', icon: '\uD83E\uDE9B', tier: 'silver', category: 'tooling', target: 5 },
  { id: 'tool_smith', name: 'Toolsmith', description: 'Use 10 different tools', icon: '\u2692\uFE0F', tier: 'gold', category: 'tooling', target: 10 },
  { id: 'tool_master', name: 'Master Craftsman', description: 'Use 20 different tools in a session', icon: '\uD83D\uDC51', tier: 'diamond', category: 'tooling', target: 20 },
  { id: 'tool_precision', name: 'Precision Strike', description: 'Complete a tool call under 100ms', icon: '\uD83C\uDFAF', tier: 'gold', category: 'tooling', target: 1 },

  // ── Endurance ───────────────────────────────────────────────────────
  { id: 'end_marathon', name: 'Marathon Runner', description: 'Session lasting 30+ minutes', icon: '\uD83C\uDFC3', tier: 'silver', category: 'endurance', target: 1 },
  { id: 'end_ironman', name: 'Iron Man', description: 'Session lasting 2+ hours', icon: '\uD83E\uDDB8', tier: 'diamond', category: 'endurance', target: 1 },
  { id: 'end_workhorse', name: 'Workhorse', description: 'Process 100+ events in a session', icon: '\uD83D\uDCAA', tier: 'silver', category: 'endurance', target: 100 },
  { id: 'end_unstoppable', name: 'Unstoppable', description: 'Process 500+ events', icon: '\uD83D\uDE80', tier: 'gold', category: 'endurance', target: 500 },
  { id: 'end_legendary', name: 'Legendary', description: 'Process 1000+ events', icon: '\uD83C\uDF1F', tier: 'diamond', category: 'endurance', target: 1000 },

  // ── Teamwork ────────────────────────────────────────────────────────
  { id: 'team_contact', name: 'First Contact', description: 'Two agents active simultaneously', icon: '\uD83E\uDD1D', tier: 'bronze', category: 'teamwork', target: 2 },
  { id: 'team_squad', name: 'Squad Goals', description: '5+ agents active simultaneously', icon: '\uD83D\uDC65', tier: 'silver', category: 'teamwork', target: 5 },
  { id: 'team_army', name: 'Army', description: '10+ agents active simultaneously', icon: '\u2694\uFE0F', tier: 'gold', category: 'teamwork', target: 10 },
  { id: 'team_hivemind', name: 'Hive Mind', description: '20+ agents coordinating', icon: '\uD83E\uDDE0', tier: 'diamond', category: 'teamwork', target: 20 },
  { id: 'team_chain', name: 'Chain Reaction', description: '5+ agents spawned by one parent', icon: '\uD83D\uDD17', tier: 'gold', category: 'teamwork', target: 5 },

  // ── Special ─────────────────────────────────────────────────────────
  { id: 'sp_nightowl', name: 'Night Owl', description: 'Active between midnight and 5am', icon: '\uD83E\uDD89', tier: 'silver', category: 'special', target: 1 },
  { id: 'sp_earlybird', name: 'Early Bird', description: 'Active between 5am and 7am', icon: '\uD83D\uDC26', tier: 'silver', category: 'special', target: 1 },
  { id: 'sp_centurion', name: 'Centurion', description: '100th session', icon: '\uD83C\uDFDB\uFE0F', tier: 'diamond', category: 'special', target: 100 },
  { id: 'sp_versatile', name: 'Versatile', description: 'Use all 9 agent states in one session', icon: '\uD83C\uDFAD', tier: 'gold', category: 'special', target: 9 },
  { id: 'sp_explorer', name: 'Explorer', description: 'Try all 8 themes', icon: '\uD83C\uDF0D', tier: 'bronze', category: 'special', target: 8 },
  { id: 'sp_firstsession', name: 'Welcome', description: 'Start your first session', icon: '\uD83D\uDC4B', tier: 'bronze', category: 'special', target: 1 },
]

// ---------------------------------------------------------------------------
// Tier Colors
// ---------------------------------------------------------------------------

export const TIER_COLORS: Record<AchievementTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  diamond: '#B9F2FF',
}

export const TIER_ORDER: Record<AchievementTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  diamond: 3,
}

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'agent-arcade-achievements'
const SESSION_COUNT_KEY = 'agent-arcade-session-count'

// ---------------------------------------------------------------------------
// Achievement Engine
// ---------------------------------------------------------------------------

export class AchievementEngine {
  private achievements: Map<string, Achievement>
  private listeners: Array<(event: AchievementUnlockEvent) => void> = []

  // Session-scoped trackers
  private sessionErrors = 0
  private sessionRecoveries = 0
  private sessionEvents = 0
  private sessionStatesUsed = new Set<AgentState>()
  private sessionUniqueTools = new Set<string>()
  private sessionCompletedTasks = 0
  private sessionFastTasks = 0 // under 2s
  private sessionErrorFreeTasks = 0
  private sessionStartTime = Date.now()
  private parentChildCounts = new Map<string, number>() // parentId -> child count

  constructor() {
    this.achievements = new Map()
    this._loadFromStorage()
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Process a telemetry event and check for achievement unlocks */
  check(event: TelemetryEvent, agents: Map<string, Agent>): void {
    this.sessionEvents++

    switch (event.type) {
      case 'session.start':
        this._onSessionStart()
        break
      case 'agent.spawn':
        this._onAgentSpawn(event, agents)
        break
      case 'agent.state':
        this._onAgentState(event, agents)
        break
      case 'agent.tool':
        this._onAgentTool(event, agents)
        break
      case 'agent.end':
        this._onAgentEnd(event, agents)
        break
      case 'agent.link':
        this._onAgentLink(event)
        break
    }

    // Time-based checks
    this._checkTimeBased()

    // Endurance checks
    this._checkEndurance()
  }

  /** Get all achievements */
  getAll(): Achievement[] {
    return Array.from(this.achievements.values())
  }

  /** Get unlocked achievements */
  getUnlocked(): Achievement[] {
    return this.getAll().filter(a => a.unlockedAt != null)
  }

  /** Get locked achievements */
  getLocked(): Achievement[] {
    return this.getAll().filter(a => a.unlockedAt == null)
  }

  /** Get progress for a specific achievement */
  getProgress(id: string): number {
    return this.achievements.get(id)?.progress ?? 0
  }

  /** Get achievements by category */
  getByCategory(category: AchievementCategory): Achievement[] {
    return this.getAll().filter(a => a.category === category)
  }

  /** Subscribe to unlock events */
  onUnlock(listener: (event: AchievementUnlockEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  /** Reset session-scoped trackers (call on new session) */
  resetSession(): void {
    this.sessionErrors = 0
    this.sessionRecoveries = 0
    this.sessionEvents = 0
    this.sessionStatesUsed.clear()
    this.sessionUniqueTools.clear()
    this.sessionCompletedTasks = 0
    this.sessionFastTasks = 0
    this.sessionErrorFreeTasks = 0
    this.sessionStartTime = Date.now()
    this.parentChildCounts.clear()
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  private _onSessionStart(): void {
    // Increment session count
    const count = this._getSessionCount() + 1
    this._setSessionCount(count)

    this.resetSession()

    // Welcome achievement
    this._incrementProgress('sp_firstsession', 1)

    // Centurion
    this._incrementProgress('sp_centurion', 1, count)
  }

  private _onAgentSpawn(_event: TelemetryEvent, agents: Map<string, Agent>): void {
    // Teamwork achievements based on active agent count
    const activeCount = Array.from(agents.values()).filter(a => a.state !== 'done').length
    if (activeCount >= 2) this._incrementProgress('team_contact', 1, activeCount)
    if (activeCount >= 5) this._incrementProgress('team_squad', 1, activeCount)
    if (activeCount >= 10) this._incrementProgress('team_army', 1, activeCount)
    if (activeCount >= 20) this._incrementProgress('team_hivemind', 1, activeCount)
  }

  private _onAgentState(event: TelemetryEvent, agents: Map<string, Agent>): void {
    const payload = event.payload as Record<string, unknown>
    const state = payload.state as AgentState | undefined
    if (state) {
      this.sessionStatesUsed.add(state)

      // Versatile achievement
      if (this.sessionStatesUsed.size >= 9) {
        this._incrementProgress('sp_versatile', 1, 9)
      }

      // Error tracking
      if (state === 'error') {
        this.sessionErrors++
      }

      // Recovery tracking
      const agent = agents.get(event.agentId)
      if (agent && agent.state === 'error' && state !== 'error' && state !== 'done') {
        this.sessionRecoveries++
        this._incrementProgress('rel_survivor', 1)
        if (this.sessionRecoveries >= 3) {
          this._incrementProgress('rel_comeback', 1, this.sessionRecoveries)
        }
      }
    }
  }

  private _onAgentTool(event: TelemetryEvent, _agents: Map<string, Agent>): void {
    const payload = event.payload as Record<string, unknown>
    const toolName = typeof payload.name === 'string' ? payload.name : 'tool'

    this.sessionUniqueTools.add(toolName)

    // Tool achievements
    this._incrementProgress('tool_first', 1)
    this._incrementProgress('tool_swiss', 1, this.sessionUniqueTools.size)
    this._incrementProgress('tool_smith', 1, this.sessionUniqueTools.size)
    this._incrementProgress('tool_master', 1, this.sessionUniqueTools.size)
  }

  private _onAgentEnd(event: TelemetryEvent, agents: Map<string, Agent>): void {
    const payload = event.payload as Record<string, unknown>
    const success = payload.success !== false
    const agent = agents.get(event.agentId)

    if (success) {
      this.sessionCompletedTasks++

      // First Blood
      this._incrementProgress('rel_firstblood', 1)

      // Speed achievements
      if (agent) {
        const duration = event.ts - (agent.spawnedAt || event.ts)

        if (duration < 500) {
          this._incrementProgress('speed_flash', 1)
          this.sessionFastTasks++
        }
        if (duration < 1000) {
          this._incrementProgress('speed_lightning', 1)
          this.sessionFastTasks++
        }
        if (duration < 2000) {
          this.sessionFastTasks++
          this._incrementProgress('speed_demon', 1, this.sessionFastTasks)
        }
        if (duration < 3000) {
          this._incrementProgress('speed_timelord', 1, Math.min(this.sessionFastTasks, 10))
        }
        if (duration < 5000) {
          this._incrementProgress('speed_quickdraw', 1, Math.min(this.sessionCompletedTasks, 25))
        }

        // Error-free tasks
        if (agent.errorCount === 0) {
          this.sessionErrorFreeTasks++
          this._incrementProgress('rel_bulletproof', 1, this.sessionErrorFreeTasks)
          this._incrementProgress('rel_ironclad', 1, this.sessionErrorFreeTasks)
        }
      }
    }
  }

  private _onAgentLink(event: TelemetryEvent): void {
    const payload = event.payload as Record<string, string>
    const parentId = payload.parentAgentId
    if (parentId) {
      const count = (this.parentChildCounts.get(parentId) || 0) + 1
      this.parentChildCounts.set(parentId, count)
      if (count >= 5) {
        this._incrementProgress('team_chain', 1, count)
      }
    }
  }

  private _checkTimeBased(): void {
    const hour = new Date().getHours()
    if (hour >= 0 && hour < 5) this._incrementProgress('sp_nightowl', 1)
    if (hour >= 5 && hour < 7) this._incrementProgress('sp_earlybird', 1)
  }

  private _checkEndurance(): void {
    const elapsed = Date.now() - this.sessionStartTime

    // Marathon (30 min)
    if (elapsed >= 30 * 60 * 1000) this._incrementProgress('end_marathon', 1)
    // Iron Man (2 hours)
    if (elapsed >= 2 * 60 * 60 * 1000) this._incrementProgress('end_ironman', 1)

    // Event count
    this._incrementProgress('end_workhorse', 1, this.sessionEvents)
    this._incrementProgress('end_unstoppable', 1, this.sessionEvents)
    this._incrementProgress('end_legendary', 1, this.sessionEvents)

    // Perfect run check
    if (this.sessionCompletedTasks > 0 && this.sessionErrors === 0) {
      this._incrementProgress('rel_perfectrun', 1)
    }
  }

  // ── Progress Tracking ──────────────────────────────────────────────

  private _incrementProgress(id: string, _increment: number, absoluteValue?: number): void {
    const achievement = this.achievements.get(id)
    if (!achievement || achievement.unlockedAt != null) return

    if (absoluteValue !== undefined) {
      achievement.current = Math.max(achievement.current, absoluteValue)
    } else {
      achievement.current = Math.max(achievement.current, achievement.current + 1)
    }

    achievement.progress = Math.min(1, achievement.current / achievement.target)

    if (achievement.current >= achievement.target) {
      achievement.unlockedAt = Date.now()
      achievement.progress = 1
      this._saveToStorage()
      this._notifyUnlock(achievement)
    }
  }

  private _notifyUnlock(achievement: Achievement): void {
    const event: AchievementUnlockEvent = {
      achievement,
      timestamp: Date.now(),
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        // Never crash event processing for a listener error
      }
    }
  }

  // ── Persistence ────────────────────────────────────────────────────

  private _loadFromStorage(): void {
    // Initialize all achievements from definitions
    for (const def of ACHIEVEMENT_DEFS) {
      this.achievements.set(def.id, {
        ...def,
        unlockedAt: undefined,
        progress: 0,
        current: 0,
      })
    }

    // Load saved progress
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved) as Record<string, { unlockedAt?: number; current: number }>
        for (const [id, state] of Object.entries(data)) {
          const achievement = this.achievements.get(id)
          if (achievement) {
            achievement.unlockedAt = state.unlockedAt
            achievement.current = state.current
            achievement.progress = Math.min(1, achievement.current / achievement.target)
          }
        }
      }
    } catch (e) {
      // Corrupted storage -- start fresh
    }
  }

  private _saveToStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const data: Record<string, { unlockedAt?: number; current: number }> = {}
      for (const [id, a] of this.achievements) {
        if (a.current > 0 || a.unlockedAt != null) {
          data[id] = { unlockedAt: a.unlockedAt, current: a.current }
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      // Storage full or unavailable
    }
  }

  private _getSessionCount(): number {
    if (typeof window === 'undefined') return 0
    try {
      return parseInt(localStorage.getItem(SESSION_COUNT_KEY) || '0', 10)
    } catch {
      return 0
    }
  }

  private _setSessionCount(count: number): void {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(SESSION_COUNT_KEY, String(count))
    } catch {
      // ignore
    }
  }
}

export { ACHIEVEMENT_DEFS }
export default AchievementEngine
