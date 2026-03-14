/**
 * Agent Arcade XP & Leveling System
 *
 * RPG-style experience points with 12 levels, streak multipliers,
 * and event-driven level-up notifications.
 */

import type { Agent, TelemetryEvent } from '../types'
import type { AchievementTier } from '../achievements'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentXP {
  agentId: string
  agentName: string
  totalXP: number
  level: number
  levelTitle: string
  xpToNextLevel: number
  xpProgress: number // 0..1 within current level
  streakDays: number
  streakMultiplier: number
}

export interface LevelUpEvent {
  agentId: string
  agentName: string
  oldLevel: number
  newLevel: number
  newTitle: string
  totalXP: number
}

// ---------------------------------------------------------------------------
// Level Definitions
// ---------------------------------------------------------------------------

interface LevelDef {
  level: number
  title: string
  xpRequired: number
}

const LEVELS: LevelDef[] = [
  { level: 1,  title: 'Novice',        xpRequired: 0 },
  { level: 2,  title: 'Apprentice',    xpRequired: 500 },
  { level: 3,  title: 'Journeyman',    xpRequired: 1500 },
  { level: 4,  title: 'Adept',         xpRequired: 3500 },
  { level: 5,  title: 'Expert',        xpRequired: 7000 },
  { level: 6,  title: 'Master',        xpRequired: 12000 },
  { level: 7,  title: 'Grandmaster',   xpRequired: 20000 },
  { level: 8,  title: 'Champion',      xpRequired: 32000 },
  { level: 9,  title: 'Legend',        xpRequired: 50000 },
  { level: 10, title: 'Mythic',        xpRequired: 80000 },
  { level: 11, title: 'Transcendent',  xpRequired: 120000 },
  { level: 12, title: 'Godlike',       xpRequired: 200000 },
]

// ---------------------------------------------------------------------------
// XP Award Rules
// ---------------------------------------------------------------------------

const XP_RULES = {
  taskComplete: 100,
  speedBonusUnder2s: 50,
  speedBonusUnder1s: 100,
  speedBonusUnder500ms: 200,
  errorFreeBonus: 25,
  toolUsage: 10,     // per unique tool
  errorRecovery: 50,
  firstToolInSession: 20,
  achievementBronze: 200,
  achievementSilver: 500,
  achievementGold: 1000,
  achievementDiamond: 2500,
} as const

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const XP_STORAGE_KEY = 'agent-arcade-xp'
const STREAK_STORAGE_KEY = 'agent-arcade-streak'

// ---------------------------------------------------------------------------
// XP Engine
// ---------------------------------------------------------------------------

export class XPEngine {
  private agentXP = new Map<string, AgentXP>()
  private listeners: Array<(event: LevelUpEvent) => void> = []
  private sessionToolsUsed = new Set<string>()
  private sessionFirstTool = false
  private streakDays = 0
  private streakMultiplier = 1.0
  private lastActiveDate = ''

  constructor() {
    this._loadFromStorage()
    this._updateStreak()
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Award XP for a telemetry event */
  processEvent(event: TelemetryEvent, agents: Map<string, Agent>): void {
    const agent = agents.get(event.agentId)
    if (!agent) return

    switch (event.type) {
      case 'agent.end': {
        const payload = event.payload as Record<string, unknown>
        if (payload.success === false) break

        let xp = XP_RULES.taskComplete
        const duration = event.ts - (agent.spawnedAt || event.ts)

        // Speed bonuses (stackable)
        if (duration < 500) xp += XP_RULES.speedBonusUnder500ms
        else if (duration < 1000) xp += XP_RULES.speedBonusUnder1s
        else if (duration < 2000) xp += XP_RULES.speedBonusUnder2s

        // Error-free bonus
        if (agent.errorCount === 0) xp += XP_RULES.errorFreeBonus

        // Tool diversity bonus
        const uniqueTools = new Set(agent.tools).size
        xp += uniqueTools * XP_RULES.toolUsage

        // Apply streak multiplier
        xp = Math.round(xp * this.streakMultiplier)

        this._awardXP(event.agentId, agent.name, xp)
        break
      }

      case 'agent.tool': {
        const payload = event.payload as Record<string, unknown>
        const toolName = typeof payload.name === 'string' ? payload.name : 'tool'

        if (!this.sessionFirstTool) {
          this.sessionFirstTool = true
          this._awardXP(event.agentId, agent.name, Math.round(XP_RULES.firstToolInSession * this.streakMultiplier))
        }
        this.sessionToolsUsed.add(toolName)
        break
      }

      case 'agent.state': {
        const payload = event.payload as Record<string, unknown>
        // Recovery XP
        if (agent.state === 'error' && payload.state !== 'error' && payload.state !== 'done') {
          this._awardXP(event.agentId, agent.name, Math.round(XP_RULES.errorRecovery * this.streakMultiplier))
        }
        break
      }
    }
  }

  /** Award XP for an achievement unlock */
  awardAchievementXP(agentId: string, agentName: string, tier: AchievementTier): void {
    const xpMap: Record<AchievementTier, number> = {
      bronze: XP_RULES.achievementBronze,
      silver: XP_RULES.achievementSilver,
      gold: XP_RULES.achievementGold,
      diamond: XP_RULES.achievementDiamond,
    }
    const xp = Math.round((xpMap[tier] || 0) * this.streakMultiplier)
    if (xp > 0) this._awardXP(agentId, agentName, xp)
  }

  /** Get XP info for a specific agent */
  getAgentXP(agentId: string): AgentXP | undefined {
    return this.agentXP.get(agentId)
  }

  /** Get all agent XP entries */
  getAllXP(): AgentXP[] {
    return Array.from(this.agentXP.values())
  }

  /** Get level for a given XP amount */
  getLevel(xp: number): number {
    let level = 1
    for (const def of LEVELS) {
      if (xp >= def.xpRequired) level = def.level
      else break
    }
    return level
  }

  /** Get title for a given level */
  getLevelTitle(level: number): string {
    return LEVELS.find(l => l.level === level)?.title || 'Unknown'
  }

  /** Get current streak info */
  getStreak(): { days: number; multiplier: number } {
    return { days: this.streakDays, multiplier: this.streakMultiplier }
  }

  /** Subscribe to level-up events */
  onLevelUp(listener: (event: LevelUpEvent) => void): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter(l => l !== listener) }
  }

  /** Reset session trackers */
  resetSession(): void {
    this.sessionToolsUsed.clear()
    this.sessionFirstTool = false
    this._updateStreak()
  }

  // ── Internal ───────────────────────────────────────────────────────

  private _awardXP(agentId: string, agentName: string, amount: number): void {
    let entry = this.agentXP.get(agentId)
    const oldLevel = entry?.level || 1

    if (!entry) {
      entry = {
        agentId,
        agentName,
        totalXP: 0,
        level: 1,
        levelTitle: 'Novice',
        xpToNextLevel: 500,
        xpProgress: 0,
        streakDays: this.streakDays,
        streakMultiplier: this.streakMultiplier,
      }
      this.agentXP.set(agentId, entry)
    }

    entry.totalXP += amount
    entry.level = this.getLevel(entry.totalXP)
    entry.levelTitle = this.getLevelTitle(entry.level)
    entry.streakDays = this.streakDays
    entry.streakMultiplier = this.streakMultiplier

    // Calculate progress within current level
    const currentLevelXP = LEVELS.find(l => l.level === entry!.level)?.xpRequired || 0
    const nextLevel = LEVELS.find(l => l.level === entry!.level + 1)
    if (nextLevel) {
      const range = nextLevel.xpRequired - currentLevelXP
      entry.xpToNextLevel = nextLevel.xpRequired - entry.totalXP
      entry.xpProgress = (entry.totalXP - currentLevelXP) / range
    } else {
      entry.xpToNextLevel = 0
      entry.xpProgress = 1
    }

    // Level up notification
    if (entry.level > oldLevel) {
      const levelUpEvent: LevelUpEvent = {
        agentId,
        agentName,
        oldLevel,
        newLevel: entry.level,
        newTitle: entry.levelTitle,
        totalXP: entry.totalXP,
      }
      for (const listener of this.listeners) {
        try { listener(levelUpEvent) } catch { /* never crash */ }
      }
    }

    this._saveToStorage()
  }

  private _updateStreak(): void {
    if (typeof window === 'undefined') return
    try {
      const today = new Date().toISOString().slice(0, 10)
      const saved = localStorage.getItem(STREAK_STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved) as { lastDate: string; days: number }
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

        if (data.lastDate === today) {
          this.streakDays = data.days
        } else if (data.lastDate === yesterday) {
          this.streakDays = data.days + 1
        } else {
          this.streakDays = 1
        }
      } else {
        this.streakDays = 1
      }

      // Multiplier: 1.0 base + 0.1 per day, max 3.0x
      this.streakMultiplier = Math.min(3.0, 1.0 + (this.streakDays - 1) * 0.1)

      localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify({
        lastDate: today,
        days: this.streakDays,
      }))
    } catch {
      this.streakDays = 1
      this.streakMultiplier = 1.0
    }
  }

  private _loadFromStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem(XP_STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved) as Record<string, AgentXP>
        for (const [id, entry] of Object.entries(data)) {
          this.agentXP.set(id, entry)
        }
      }
    } catch { /* start fresh */ }
  }

  private _saveToStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const data: Record<string, AgentXP> = {}
      for (const [id, entry] of this.agentXP) {
        data[id] = entry
      }
      localStorage.setItem(XP_STORAGE_KEY, JSON.stringify(data))
    } catch { /* storage full */ }
  }
}

export { LEVELS, XP_RULES }
export default XPEngine
