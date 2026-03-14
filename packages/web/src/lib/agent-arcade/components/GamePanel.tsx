'use client'

/**
 * GamePanel — tabbed container for all v3.0 gamification features.
 * Sits below the canvas and provides tabs for:
 * Achievements, Leaderboard, Cost Dashboard, Replay, and XP Overview.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AchievementPanel } from './AchievementPanel'
import { AchievementToast } from './AchievementToast'
import { XPBar } from './XPBar'
import { Leaderboard } from './Leaderboard'
import { CostDashboard } from './CostDashboard'
import { ReplayControls } from './ReplayControls'
import { AchievementEngine } from '../achievements'
import type { Achievement, AchievementUnlockEvent } from '../achievements'
import { XPEngine } from '../xp'
import type { AgentXP, LevelUpEvent } from '../xp'
import { LeaderboardManager } from '../xp/leaderboard'
import type { LeaderboardEntry, LeaderboardCategory } from '../xp/leaderboard'
import { ReplayEngine } from '../replay'
import type { SessionCost } from './CostDashboard'
import type { Agent, TelemetryEvent } from '../types'

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type GameTab = 'xp' | 'achievements' | 'leaderboard' | 'costs' | 'replay'

const TABS: { key: GameTab; label: string; icon: string }[] = [
  { key: 'xp', label: 'XP', icon: '\u2B50' },
  { key: 'achievements', label: 'Achievements', icon: '\uD83C\uDFC6' },
  { key: 'leaderboard', label: 'Leaderboard', icon: '\uD83D\uDCC8' },
  { key: 'costs', label: 'Costs', icon: '\uD83D\uDCB0' },
  { key: 'replay', label: 'Replay', icon: '\u23EA' },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GamePanelProps {
  agents: Agent[]
  agentsMap: Map<string, Agent>
  events: TelemetryEvent[]
  sessionId: string
  visible: boolean
  onToggle: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GamePanel({ agents, agentsMap, events, sessionId, visible, onToggle }: GamePanelProps) {
  const [activeTab, setActiveTab] = useState<GameTab>('xp')
  const [toastAchievement, setToastAchievement] = useState<Achievement | null>(null)
  const [toastLevelUp, setToastLevelUp] = useState<LevelUpEvent | null>(null)

  // Engine refs — persist across renders
  const achievementEngineRef = useRef<AchievementEngine | null>(null)
  const xpEngineRef = useRef<XPEngine | null>(null)
  const leaderboardRef = useRef<LeaderboardManager | null>(null)
  const replayEngineRef = useRef<ReplayEngine | null>(null)

  // Snapshot state — updated from engines
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [allXP, setAllXP] = useState<AgentXP[]>([])
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([])
  const [leaderboardCategory, setLeaderboardCategory] = useState<LeaderboardCategory>('overall')
  const [isRecording, setIsRecording] = useState(false)
  const [streakDays, setStreakDays] = useState(0)
  const [streakMultiplier, setStreakMultiplier] = useState(1.0)
  const [replayEngine, setReplayEngine] = useState<ReplayEngine | null>(null)
  const [savedReplayCount, setSavedReplayCount] = useState(0)

  // Cost state (derived from events)
  const [sessionCost, setSessionCost] = useState<SessionCost>({
    sessionId: '',
    totalCost: 0,
    agentCosts: [],
    modelBreakdown: {},
    budgetUsed: 0,
  })

  // ── Initialize engines ─────────────────────────────────────────────
  useEffect(() => {
    if (!achievementEngineRef.current) {
      achievementEngineRef.current = new AchievementEngine()
    }
    if (!xpEngineRef.current) {
      xpEngineRef.current = new XPEngine()
    }
    if (!leaderboardRef.current) {
      leaderboardRef.current = new LeaderboardManager()
    }
    if (!replayEngineRef.current) {
      replayEngineRef.current = new ReplayEngine()
      setReplayEngine(replayEngineRef.current)
    }

    // Subscribe to achievement unlocks
    const unsubAch = achievementEngineRef.current.onUnlock((event: AchievementUnlockEvent) => {
      const timer = setTimeout(() => setToastAchievement(event.achievement), 0)
      // Also award XP for the achievement — prefer an active (non-done) agent
      if (xpEngineRef.current) {
        const activeAgent = agents.find(a => a.state !== 'done') || agents[0]
        if (activeAgent) {
          xpEngineRef.current.awardAchievementXP(activeAgent.id, activeAgent.name, event.achievement.tier)
        }
      }
      return () => clearTimeout(timer)
    })

    // Subscribe to level-up events
    const unsubLvl = xpEngineRef.current.onLevelUp((event: LevelUpEvent) => {
      const timer = setTimeout(() => setToastLevelUp(event), 0)
      return () => clearTimeout(timer)
    })

    return () => {
      unsubAch()
      unsubLvl()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Process new events through engines ─────────────────────────────
  const processedCountRef = useRef(0)

  useEffect(() => {
    const achievementEngine = achievementEngineRef.current
    const xpEngine = xpEngineRef.current
    const leaderboard = leaderboardRef.current
    const replayEngine = replayEngineRef.current
    if (!achievementEngine || !xpEngine || !leaderboard || !replayEngine) return

    // Process only new events
    const newEvents = events.slice(processedCountRef.current)
    if (newEvents.length === 0) return

    for (const event of newEvents) {
      achievementEngine.check(event, agentsMap)
      xpEngine.processEvent(event, agentsMap)
      leaderboard.processEvent(event, agentsMap)

      // Sync XP data into leaderboard for each agent
      const agent = agentsMap.get(event.agentId)
      if (agent) {
        const xpData = xpEngine.getAgentXP(event.agentId)
        if (xpData) {
          leaderboard.updateXP(event.agentId, xpData.totalXP, xpData.level, xpData.levelTitle)
        }
      }

      if (isRecording) {
        replayEngine.captureEvent(event)
      }
    }
    processedCountRef.current = events.length

    // Update snapshots + cost calculation
    const timer = setTimeout(() => {
      setAchievements(achievementEngine.getAll())
      setAllXP(xpEngine.getAllXP())
      setLeaderboardEntries(leaderboard.getLeaderboard(leaderboardCategory))
      const streak = xpEngine.getStreak()
      setStreakDays(streak.days)
      setStreakMultiplier(streak.multiplier)
      setSavedReplayCount(replayEngine.listRecordings().length)

      // Inline cost calculation from agent data
      const agentCosts = agents.map(a => ({
        agentId: a.id,
        agentName: a.name,
        model: a.aiModel || 'unknown',
        inputTokens: a.tools.length * 500,
        outputTokens: a.messages.length * 300,
        totalCost: estimateCost(a.aiModel || 'unknown', a.tools.length * 500, a.messages.length * 300),
      }))

      const modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cost: number }> = {}
      for (const ac of agentCosts) {
        if (!modelBreakdown[ac.model]) {
          modelBreakdown[ac.model] = { inputTokens: 0, outputTokens: 0, cost: 0 }
        }
        modelBreakdown[ac.model].inputTokens += ac.inputTokens
        modelBreakdown[ac.model].outputTokens += ac.outputTokens
        modelBreakdown[ac.model].cost += ac.totalCost
      }

      const totalCost = agentCosts.reduce((sum, a) => sum + a.totalCost, 0)

      setSessionCost({
        sessionId,
        totalCost,
        agentCosts,
        modelBreakdown,
        budgetUsed: totalCost / 10,
      })
    }, 0)

    return () => clearTimeout(timer)
  }, [events, agentsMap, agents, sessionId, isRecording, leaderboardCategory])

  // ── Leaderboard category change ───────────────────────────────────
  const handleCategoryChange = useCallback((cat: LeaderboardCategory) => {
    setLeaderboardCategory(cat)
    if (leaderboardRef.current) {
      const timer = setTimeout(() => {
        setLeaderboardEntries(leaderboardRef.current!.getLeaderboard(cat))
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [])

  // ── Replay controls ───────────────────────────────────────────────
  const handleStartRecording = useCallback(() => {
    if (replayEngineRef.current) {
      replayEngineRef.current.startRecording(sessionId)
      const timer = setTimeout(() => setIsRecording(true), 0)
      return () => clearTimeout(timer)
    }
  }, [sessionId])

  const handleStopRecording = useCallback(() => {
    if (replayEngineRef.current) {
      replayEngineRef.current.stopRecording()
      const timer = setTimeout(() => setIsRecording(false), 0)
      return () => clearTimeout(timer)
    }
  }, [])

  // ── Dismiss handlers ──────────────────────────────────────────────
  const dismissToast = useCallback(() => {
    const timer = setTimeout(() => setToastAchievement(null), 0)
    return () => clearTimeout(timer)
  }, [])

  const dismissLevelUp = useCallback(() => {
    const timer = setTimeout(() => setToastLevelUp(null), 0)
    return () => clearTimeout(timer)
  }, [])

  // ── Find the "primary" agent XP to show in the header ─────────────
  const primaryXP = useMemo(() => {
    if (allXP.length === 0) return null
    // Show the agent with highest XP
    return allXP.reduce((best, cur) => cur.totalXP > best.totalXP ? cur : best, allXP[0])
  }, [allXP])

  // Unlocked achievements count
  const unlockedCount = useMemo(() => achievements.filter(a => a.unlockedAt != null).length, [achievements])

  // Level-up toast renderer (shared between visible and hidden states)
  const levelUpToast = toastLevelUp && (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
        border: '3px solid #ffd700',
        borderRadius: 8, padding: '16px 20px', minWidth: 280,
        fontFamily: '"Press Start 2P", monospace',
        animation: 'slideIn 0.4s ease-out forwards',
        boxShadow: '0 0 20px rgba(255,215,0,0.3)',
      }}
    >
      <div style={{ fontSize: 10, color: '#ffd700', letterSpacing: 2, marginBottom: 8 }}>
        LEVEL UP!
      </div>
      <div style={{ fontSize: 12, color: '#fff', marginBottom: 4 }}>
        {toastLevelUp.agentName}
      </div>
      <div style={{ fontSize: 9, color: '#8892b0' }}>
        Level {toastLevelUp.oldLevel} {'\u2192'} Level {toastLevelUp.newLevel} &middot; {toastLevelUp.newTitle}
      </div>
      <button
        onClick={dismissLevelUp}
        aria-label="Dismiss level up notification"
        style={{ position: 'absolute', top: 8, right: 12, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10 }}
      >
        {'\u2715'}
      </button>
    </div>
  )

  if (!visible) {
    return (
      <>
        {/* Always render toasts even when panel is hidden */}
        <AchievementToast achievement={toastAchievement} onDismiss={dismissToast} />
        {levelUpToast}

        {/* Compact XP + toggle bar */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={onToggle}
        >
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{'\uD83C\uDFAE'} Game</span>
          {primaryXP && (
            <div className="flex-1 max-w-xs">
              <XPBar xp={primaryXP} compact />
            </div>
          )}
          {unlockedCount > 0 && (
            <span className="text-[9px] text-amber-400 font-mono">{'\uD83C\uDFC6'} {unlockedCount}</span>
          )}
          {sessionCost.totalCost > 0 && (
            <span className="text-[9px] text-green-400 font-mono">{'\uD83D\uDCB0'} ${sessionCost.totalCost.toFixed(4)}</span>
          )}
          {isRecording && (
            <span className="text-[9px] text-red-400 font-mono animate-pulse">{'\u2B24'} REC</span>
          )}
          <span className="text-[9px] text-muted-foreground">{'\u25B2'}</span>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Achievement Toast — always at top level */}
      <AchievementToast achievement={toastAchievement} onDismiss={dismissToast} />
      {levelUpToast}

      {/* Game Panel */}
      <div className="border-t border-border bg-gradient-to-b from-muted/40 to-muted/20">
        {/* Tab bar + collapse */}
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-t text-[9px] font-bold transition-all ${
                activeTab === tab.key
                  ? 'bg-background text-foreground border border-b-0 border-border -mb-px'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.key === 'achievements' && unlockedCount > 0 && (
                <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[7px]">{unlockedCount}</span>
              )}
            </button>
          ))}

          {/* Recording toggle */}
          <div className="ml-auto flex items-center gap-2">
            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                className="text-[8px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/50 transition-colors"
              >
                {'\u23FA'} Record
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="text-[8px] px-2 py-1 rounded border border-red-500/50 text-red-400 animate-pulse"
              >
                {'\u23F9'} Stop
              </button>
            )}
            <button
              onClick={onToggle}
              className="text-[9px] text-muted-foreground hover:text-foreground px-1"
            >
              {'\u25BC'}
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="max-h-72 overflow-auto">
          {activeTab === 'xp' && (
            <div className="p-3 space-y-3">
              {allXP.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-[10px]">
                  <div className="text-2xl mb-2">{'\u2B50'}</div>
                  <p>No XP earned yet. Start a session to begin leveling up!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {allXP.map(xp => (
                    <XPBar key={xp.agentId} xp={xp} />
                  ))}
                </div>
              )}
              {streakDays > 0 && (
                <div className="flex items-center gap-4 text-[8px] text-muted-foreground pt-2 border-t border-border/30">
                  <span>{'\uD83D\uDD25'} Streak: {streakDays} days</span>
                  <span>{'\u2716'} Multiplier: {streakMultiplier.toFixed(1)}x</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'achievements' && (
            <div className="p-2">
              <AchievementPanel achievements={achievements} />
            </div>
          )}

          {activeTab === 'leaderboard' && (
            <div className="p-2">
              <Leaderboard
                entries={leaderboardEntries}
                onCategoryChange={handleCategoryChange}
              />
            </div>
          )}

          {activeTab === 'costs' && (
            <div className="p-2">
              <CostDashboard sessionCost={sessionCost} />
            </div>
          )}

          {activeTab === 'replay' && replayEngine && (
            <div className="p-3 space-y-3">
              <ReplayControls engine={replayEngine} />
              <div className="text-[8px] text-muted-foreground space-y-1">
                <p>{'\uD83D\uDCBE'} Saved replays: {savedReplayCount} / 50</p>
                <p>{'\u2139\uFE0F'} Click Record to capture the current session, then replay it with speed control.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Simple cost estimator (mirrors gateway/cost.ts pricing)
// ---------------------------------------------------------------------------

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const m = model.toLowerCase()
  let inputRate = 0   // per 1M tokens
  let outputRate = 0

  if (m.includes('opus')) { inputRate = 15; outputRate = 75 }
  else if (m.includes('sonnet')) { inputRate = 3; outputRate = 15 }
  else if (m.includes('haiku')) { inputRate = 0.25; outputRate = 1.25 }
  else if (m.includes('gpt-4o-mini')) { inputRate = 0.15; outputRate = 0.6 }
  else if (m.includes('gpt-4o')) { inputRate = 2.5; outputRate = 10 }
  else if (m.includes('gpt-4')) { inputRate = 10; outputRate = 30 }
  else if (m.includes('o1')) { inputRate = 15; outputRate = 60 }
  else if (m.includes('gemini-1.5-pro')) { inputRate = 1.25; outputRate = 5 }
  else if (m.includes('gemini')) { inputRate = 0.075; outputRate = 0.3 }
  else if (m.includes('mistral-large')) { inputRate = 3; outputRate = 9 }
  else if (m.includes('deepseek')) { inputRate = 0.27; outputRate = 1.1 }
  else if (m.includes('llama') || m.includes('ollama')) { return 0 }
  else { inputRate = 1; outputRate = 3 } // generic fallback

  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
}

export default GamePanel
