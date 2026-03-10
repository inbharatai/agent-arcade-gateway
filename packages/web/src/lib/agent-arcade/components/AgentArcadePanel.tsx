/**
 * AgentArcadePanel — game-styled mission command HUD for Agent Arcade
 *
 * Features:
 * - Retro-futuristic mission bar header
 * - Visual theme selector grid with icons and descriptions
 * - Agent roster with class icons and live status
 * - Pixel detail mode selector
 * - Integrated audio controls
 * - Responsive layout
 */

'use client'

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { PixelCanvas, CanvasAudioCallbacks } from '../core/PixelCanvas'
import { useAgentArcadeStore, useAgents, useConnectionStatus, useSettings, useNarrative } from '../store'
import { useTelemetryProvider } from './useTelemetryProvider'
import { ConnectionStatus, STATE_VISUALS, Agent, AgentState, AgentStateEntry, TelemetryEvent, SessionNarrative, NarrativeMilestone } from '../types'
import { THEMES, THEME_LIST } from '../themes'
import { PIXEL_CONFIGS } from '../sprites'
import { getAudioEngine } from '../audio/engine'
import {
  playSpawnSfx, playStateChangeSfx, playToolUseSfx,
  playDoneSfx, playErrorSfx, playSelectSfx,
  playTrustChime, playRecoverySfx, playMilestoneSfx,
} from '../audio/synth'
import { startMusic, stopMusic } from '../audio/music'
import { speak, stopVoice } from '../audio/voice'

// ── Status badge ────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<ConnectionStatus, { bg: string; text: string; pulse?: boolean }> = {
  connected: { bg: 'bg-green-500/20', text: 'text-green-400' },
  connecting: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', pulse: true },
  disconnected: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text} ${s.pulse ? 'animate-pulse' : ''}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

// ── Props ───────────────────────────────────────────────────────────────────
export interface AgentArcadePanelProps {
  gatewayUrl?: string
  sessionId?: string
  authToken?: string
  apiKey?: string
  sessionSignature?: string
  showControls?: boolean
  width?: number
  height?: number
  onAgentSelect?: (agentId: string | null) => void
  embed?: boolean
}

export function AgentArcadePanel({
  gatewayUrl = 'http://localhost:8787',
  sessionId = 'default',
  authToken,
  apiKey,
  sessionSignature,
  showControls = true,
  width,
  height,
  onAgentSelect,
  embed = false,
}: AgentArcadePanelProps) {
  const [showDebug, setShowDebug] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showThemeGrid, setShowThemeGrid] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showNarrativePanel, setShowNarrativePanel] = useState(false)
  const audioInitRef = useRef(false)

  const agents = useAgents()
  const status = useConnectionStatus()
  const settings = useSettings()
  const narrative = useNarrative()
  const store = useAgentArcadeStore()

  useTelemetryProvider({ url: gatewayUrl, sessionId, authToken, apiKey, sessionSignature, autoConnect: true })

  // ── Audio initialization on first user gesture ──────────────────────
  const initAudio = useCallback(() => {
    if (audioInitRef.current) return
    const engine = getAudioEngine()
    engine.init()
    engine.resume()
    audioInitRef.current = true
    if (settings.soundEnabled && settings.musicEnabled) {
      startMusic(settings.theme)
    }
  }, [settings.soundEnabled, settings.musicEnabled, settings.theme])

  useEffect(() => {
    const handler = () => initAudio()
    document.addEventListener('click', handler)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('keydown', handler)
    }
  }, [initAudio])

  // ── Sync audio settings ─────────────────────────────────────────────
  useEffect(() => {
    const engine = getAudioEngine()
    if (!engine.initialized) return
    engine.setMasterVolume(settings.soundEnabled ? settings.masterVolume : 0)
    engine.setMusicVolume(settings.musicVolume)
    engine.setSfxVolume(settings.sfxVolume)
    if (settings.soundEnabled && settings.musicEnabled) {
      startMusic(settings.theme)
    } else {
      stopMusic()
    }
    if (!settings.voiceEnabled) stopVoice()
  }, [settings.soundEnabled, settings.musicEnabled, settings.voiceEnabled,
      settings.masterVolume, settings.musicVolume, settings.sfxVolume, settings.theme])

  // ── Audio callbacks from canvas ─────────────────────────────────────
  const audioCallbacks = useMemo<CanvasAudioCallbacks>(() => ({
    onSpawn: (agentId: string) => {
      if (settings.soundEnabled && settings.sfxEnabled) playSpawnSfx()
      if (settings.voiceEnabled) {
        const agent = agents.find(a => a.id === agentId)
        if (agent) speak(`${agent.name} has joined`, agentId, agents.indexOf(agent))
      }
    },
    onStateChange: (agentId: string, newState: AgentState) => {
      if (!settings.soundEnabled) return
      if (settings.sfxEnabled) {
        if (newState === 'tool') playToolUseSfx()
        else playStateChangeSfx()
      }
      if (settings.voiceEnabled) {
        const agent = agents.find(a => a.id === agentId)
        if (agent && agent.label) speak(agent.label, agentId, agents.indexOf(agent))
      }
    },
    onDone: (agentId: string) => {
      if (!settings.soundEnabled || !settings.sfxEnabled) return
      const agent = agents.find(a => a.id === agentId)
      playDoneSfx()
      // Trust chime on completion
      if (agent) playTrustChime(agent.trustScore ?? 0.5)
    },
    onError: (agentId: string) => {
      if (!settings.soundEnabled || !settings.sfxEnabled) return
      playErrorSfx()
      const agent = agents.find(a => a.id === agentId)
      // Recovery sound if agent previously had errors and recovered
      if (agent && agent.recoveryCount > 0) playRecoverySfx()
    },
    onSelect: (_agentId: string | null) => { if (settings.soundEnabled && settings.sfxEnabled) playSelectSfx() },
  }), [settings.soundEnabled, settings.sfxEnabled, settings.voiceEnabled, agents])

  const handleSelect = useCallback((id: string | null) => {
    store.selectAgent(id)
    onAgentSelect?.(id)
    if (settings.soundEnabled && settings.sfxEnabled) playSelectSfx()
  }, [store, onAgentSelect, settings.soundEnabled, settings.sfxEnabled])

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === store.selectedAgentId),
    [agents, store.selectedAgentId],
  )

  const currentTheme = THEMES[settings.theme] || THEMES['office']
  const pxConf = PIXEL_CONFIGS[settings.pixelLevel] || PIXEL_CONFIGS['16bit']

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  const agentsRef = useRef(agents)
  const settingsRef = useRef(settings)

  useEffect(() => { agentsRef.current = agents }, [agents])
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const currentAgents = agentsRef.current

      switch (e.key) {
        case 'Escape':
          handleSelect(null)
          setShowSettings(false)
          setShowThemeGrid(false)
          setShowDebug(false)
          break
        case 'ArrowDown':
        case 'ArrowRight': {
          e.preventDefault()
          if (currentAgents.length === 0) break
          const curIdx = currentAgents.findIndex(a => a.id === store.selectedAgentId)
          const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % currentAgents.length
          handleSelect(currentAgents[nextIdx].id)
          break
        }
        case 'ArrowUp':
        case 'ArrowLeft': {
          e.preventDefault()
          if (currentAgents.length === 0) break
          const curIdx2 = currentAgents.findIndex(a => a.id === store.selectedAgentId)
          const prevIdx = curIdx2 <= 0 ? currentAgents.length - 1 : curIdx2 - 1
          handleSelect(currentAgents[prevIdx].id)
          break
        }
        case 't':
        case 'T':
          setShowThemeGrid(g => !g)
          setShowSettings(false)
          break
        case 's':
        case 'S':
          setShowSettings(s => !s)
          setShowThemeGrid(false)
          break
        case 'd':
        case 'D':
          setShowDebug(d => !d)
          break
        case 'm':
        case 'M':
          store.updateSettings({ soundEnabled: !settingsRef.current.soundEnabled })
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleSelect, store])

  return (
    <div className={`flex flex-col h-full ${settings.darkMode ? 'dark bg-gray-950 text-gray-100' : 'bg-white text-gray-900'}`}>
      {/* ── Mission Bar Header ─────────────────────────────────────────── */}
      {!embed && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-gradient-to-r from-background via-muted/30 to-background">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-lg">{currentTheme.icon}</span>
              <div>
                <h2 className="text-xs font-bold tracking-wider uppercase leading-none">Agent Arcade</h2>
                <p className="text-[9px] text-muted-foreground font-mono">
                  {currentTheme.name} · {sessionId}
                </p>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>
          <div className="flex items-center gap-1.5">
            {/* Agent count */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/50 text-[10px] font-mono">
              <span className="text-xs">👾</span> {agents.length}
            </span>
            {/* Pixel mode badge */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/50 text-[10px] font-mono">
              {pxConf.label || settings.pixelLevel}
            </span>
            {showControls && (
              <>
                <button
                  onClick={() => { setShowThemeGrid(g => !g); setShowSettings(false) }}
                  className="px-1.5 py-0.5 rounded hover:bg-muted text-xs"
                  title="Themes"
                >🎨</button>
                <button
                  onClick={() => setShowTimeline(t => !t)}
                  className={`px-1.5 py-0.5 rounded hover:bg-muted text-xs ${showTimeline ? 'bg-muted ring-1 ring-border' : ''}`}
                  title="Timeline"
                >📊</button>
                <button
                  onClick={() => setShowNarrativePanel(n => !n)}
                  className={`px-1.5 py-0.5 rounded hover:bg-muted text-xs ${showNarrativePanel ? 'bg-muted ring-1 ring-border' : ''}`}
                  title="Session Story"
                >📜</button>
                <button
                  onClick={() => { setShowSettings(s => !s); setShowThemeGrid(false) }}
                  className="px-1.5 py-0.5 rounded hover:bg-muted text-xs"
                  title="Settings"
                >⚙️</button>
                <button
                  onClick={() => setShowDebug(d => !d)}
                  className="px-1.5 py-0.5 rounded hover:bg-muted text-xs"
                  title="Debug"
                >🐛</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Theme Grid Panel ───────────────────────────────────────────── */}
      {showThemeGrid && (
        <div className="border-b border-border bg-muted/30 p-3">
          <div className="grid grid-cols-4 gap-2">
            {THEME_LIST.map(t => (
              <button
                key={t.id}
                onClick={() => store.updateSettings({ theme: t.id })}
                className={`flex items-start gap-2 p-2 rounded-lg border text-left transition-all text-xs ${
                  settings.theme === t.id
                    ? 'border-current ring-1 ring-current bg-muted/70'
                    : 'border-border hover:border-muted-foreground/30 hover:bg-muted/40'
                }`}
                style={settings.theme === t.id ? { color: t.colors.accent } : undefined}
              >
                <span className="text-base leading-none mt-0.5">{t.icon}</span>
                <div className="min-w-0">
                  <div className="font-bold text-[11px] leading-tight truncate">{t.name}</div>
                  <div className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Settings Panel ─────────────────────────────────────────────── */}
      {showSettings && (
        <div className="border-b border-border bg-muted/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              Pixels
              <select
                value={settings.pixelLevel}
                onChange={e => store.updateSettings({ pixelLevel: e.target.value })}
                className="bg-background border rounded px-1 py-0.5 text-xs"
              >
                {Object.entries(PIXEL_CONFIGS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label || k}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1">
              Zoom
              <input
                type="range" min="0.5" max="2" step="0.1"
                value={settings.zoom}
                onChange={e => store.updateSettings({ zoom: parseFloat(e.target.value) })}
                className="w-16"
              />
              <span className="font-mono text-[10px]">{settings.zoom.toFixed(1)}×</span>
            </label>

            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.reducedMotion} onChange={e => store.updateSettings({ reducedMotion: e.target.checked })} />
              Reduced motion
            </label>

            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.darkMode} onChange={e => store.updateSettings({ darkMode: e.target.checked })} />
              Dark
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs border-t border-border/50 pt-2">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Audio</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.soundEnabled} onChange={e => store.updateSettings({ soundEnabled: e.target.checked })} />
              Sound
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.musicEnabled} onChange={e => store.updateSettings({ musicEnabled: e.target.checked })} />
              Music
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.sfxEnabled} onChange={e => store.updateSettings({ sfxEnabled: e.target.checked })} />
              SFX
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.voiceEnabled} onChange={e => store.updateSettings({ voiceEnabled: e.target.checked })} />
              Voice
            </label>
            <label className="flex items-center gap-1">
              Vol
              <input
                type="range" min="0" max="1" step="0.05"
                value={settings.masterVolume}
                onChange={e => store.updateSettings({ masterVolume: parseFloat(e.target.value) })}
                className="w-16"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs border-t border-border/50 pt-2">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">HUD</span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.showTrustIndicators} onChange={e => store.updateSettings({ showTrustIndicators: e.target.checked })} />
              Trust Badges
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.showTimeline} onChange={e => store.updateSettings({ showTimeline: e.target.checked })} />
              Timeline
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings.showNarrative} onChange={e => store.updateSettings({ showNarrative: e.target.checked })} />
              Narrative
            </label>
          </div>
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col sm:flex-row overflow-hidden relative">
        {/* Timeline Panel — horizontal state timeline for all agents */}
        {showTimeline && settings.showTimeline && agents.length > 0 && (
          <TimelinePanel agents={agents} />
        )}

        {/* Agent Roster Sidebar — hidden on mobile, shown on sm+ */}
        {agents.length > 0 && !embed && (
          <div className="hidden sm:block w-44 border-r border-border overflow-y-auto bg-muted/20 flex-shrink-0">
            <div className="px-2 py-1.5 border-b border-border/50">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Agent Roster</span>
            </div>
            <div className="space-y-0.5 p-1">
              {agents.map(agent => {
                const vis = STATE_VISUALS[agent.state]
                const isSelected = store.selectedAgentId === agent.id
                const trust = agent.trustScore ?? 0.5
                const trustColor = trust >= 0.8 ? 'text-emerald-400' : trust >= 0.5 ? 'text-amber-400' : 'text-red-400'
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleSelect(isSelected ? null : agent.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-all text-[10px] ${
                      isSelected ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="text-sm">{vis.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="font-bold truncate leading-tight">{agent.name}</span>
                        {settings.showTrustIndicators && (
                          <span className={`text-[8px] font-mono ${trustColor}`} title={`Trust: ${Math.round(trust * 100)}%`}>
                            {trust >= 0.8 ? '\u2714' : trust >= 0.5 ? '\u25CF' : '\u26A0'}
                          </span>
                        )}
                      </div>
                      {agent.aiModel && (
                        <div className="text-[9px] text-blue-400 truncate leading-tight">\uD83E\uDD16 {agent.aiModel}</div>
                      )}
                      {agent.task && (
                        <div className="text-[9px] text-purple-400 truncate leading-tight">\uD83C\uDFAF {agent.task}</div>
                      )}
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: vis.color }} />
                        <span className="text-muted-foreground truncate">{vis.label}</span>
                        {agent.errorCount > 0 && (
                          <span className="text-[8px] text-red-400 font-mono">{agent.errorCount}\u2716</span>
                        )}
                      </div>
                    </div>
                    {agent.progress > 0 && agent.progress < 1 && (
                      <span className="text-[9px] font-mono text-muted-foreground">{Math.round(agent.progress * 100)}%</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Mobile agent strip — shown only on mobile */}
        {agents.length > 0 && !embed && (
          <div className="sm:hidden flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 overflow-x-auto flex-shrink-0">
            {agents.map(agent => {
              const vis = STATE_VISUALS[agent.state]
              const isSelected = store.selectedAgentId === agent.id
              return (
                <button
                  key={agent.id}
                  onClick={() => handleSelect(isSelected ? null : agent.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded whitespace-nowrap text-[10px] flex-shrink-0 ${
                    isSelected ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/50'
                  }`}
                >
                  <span>{vis.icon}</span>
                  <span className="font-bold">{agent.name}</span>
                  {agent.aiModel && <span className="text-[8px] text-blue-400 ml-1">{agent.aiModel}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 overflow-auto p-1 sm:p-2">
          <PixelCanvas
            agents={agents}
            selectedAgentId={store.selectedAgentId}
            onSelectAgent={handleSelect}
            theme={settings.theme}
            pixelLevel={settings.pixelLevel}
            zoom={settings.zoom}
            reducedMotion={settings.reducedMotion}
            width={width}
            height={height}
            audioCallbacks={audioCallbacks}
            connectionStatus={status}
            errorMessage={store.error}
          />
        </div>

        {/* Agent details — slides over on mobile */}
        {selectedAgent && (
          <div className="absolute right-0 top-0 bottom-0 sm:relative w-full sm:w-64 border-l border-border overflow-y-auto p-3 text-xs space-y-3 bg-background sm:bg-muted/10 z-30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">{STATE_VISUALS[selectedAgent.state].icon}</span>
                <h3 className="font-bold text-sm">{selectedAgent.name}</h3>
              </div>
              <button onClick={() => handleSelect(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <AgentDetails agent={selectedAgent} />
          </div>
        )}
      </div>

      {/* ── Mission Feed (bottom ticker) ───────────────────────────────── */}
      {!embed && store.events.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-t border-border bg-muted/20 text-[9px] font-mono text-muted-foreground overflow-hidden">
          <span className="text-yellow-500 font-bold flex-shrink-0">FEED</span>
          <div className="flex-1 truncate">
            {(() => {
              const last = store.events[store.events.length - 1]
              if (!last) return ''
              const agentName = agents.find(a => a.id === last.agentId)?.name || last.agentId.slice(0, 8)
              return formatFeedEvent(last, agentName)
            })()}
          </div>
          <span className="flex-shrink-0 text-muted-foreground/50">{store.events.length} events</span>
        </div>
      )}

      {/* ── Narrative Panel ────────────────────────────────────────────── */}
      {showNarrativePanel && settings.showNarrative && (
        <NarrativePanel narrative={narrative} agents={agents} />
      )}

      {/* ── Debug panel ────────────────────────────────────────────────── */}
      {showDebug && <DebugPanel />}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

const FEED_ICONS: Record<string, string> = {
  'agent.spawn': '🚀',
  'agent.state': '🔄',
  'agent.tool': '🔧',
  'agent.message': '💬',
  'agent.link': '🔗',
  'agent.position': '📍',
  'agent.end': '🏁',
  'session.start': '▶️',
  'session.end': '⏹️',
}

function formatFeedEvent(ev: TelemetryEvent, agentName: string): string {
  const icon = FEED_ICONS[ev.type] || '📡'
  const p = ev.payload as Record<string, unknown>
  const src = p.source === 'process' || p.source === 'filesystem' ? String(p.source) : ''
  const conf = typeof p.confidence === 'number' ? ` ${Math.round(Math.max(0, Math.min(1, p.confidence)) * 100)}%` : ''
  const tag = src ? ` [${src}${conf ? ` ${conf.trim()}` : ''}]` : ''
  switch (ev.type) {
    case 'agent.spawn':
      return `${icon} ${p.name || agentName} joined as ${p.role || 'agent'}${p.aiModel ? ' · AI: ' + String(p.aiModel) : ''}${p.task ? ' · Task: ' + String(p.task) : ''}${tag}`
    case 'agent.state':
      return `${icon} ${agentName} → ${String(p.state || '').toUpperCase()}${p.label ? ': ' + String(p.label) : ''}${tag}`
    case 'agent.tool':
      return `${icon} ${agentName} using ${p.name || 'tool'}${p.label ? ' — ' + String(p.label) : ''}${tag}`
    case 'agent.message':
      return `${icon} ${agentName}: ${String(p.text || '').slice(0, 80)}${tag}`
    case 'agent.link':
      return `${icon} ${p.parentAgentId ? String(p.parentAgentId).slice(0, 8) : '?'} → ${p.childAgentId ? String(p.childAgentId).slice(0, 8) : '?'}`
    case 'agent.position':
      return `${icon} ${agentName} moved to (${p.x}, ${p.y})`
    case 'agent.end':
      return `${icon} ${agentName} finished — ${p.reason || 'completed'}`
    default:
      return `${icon} ${ev.type} · ${agentName}`
  }
}

const AgentDetails = React.memo(function AgentDetails({ agent }: { agent: Agent }) {
  // Use state for time to avoid calling Date.now() during render
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const vis = STATE_VISUALS[agent.state]
  const trust = agent.trustScore ?? 0.5
  const trustColor = trust >= 0.8 ? '#10b981' : trust >= 0.5 ? '#f59e0b' : '#ef4444'
  const trustLabel = trust >= 0.8 ? 'High Trust' : trust >= 0.5 ? 'Medium Trust' : 'Low Trust'
  const uptime = agent.activeTime > 0
    ? agent.activeTime < 60000
      ? `${Math.round(agent.activeTime / 1000)}s`
      : `${Math.round(agent.activeTime / 60000)}m`
    : '—'
  const alive = now - agent.spawnedAt
  const aliveLabel = alive < 60000 ? `${Math.round(alive / 1000)}s` : `${Math.round(alive / 60000)}m`

  return (
    <>
      {/* Trust Score Ring */}
      <div className="flex items-center gap-3">
        <div className="relative w-12 h-12 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/30"
            />
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke={trustColor} strokeWidth="2.5"
              strokeDasharray={`${trust * 100}, 100`}
              strokeLinecap="round"
              className="aa-trust-ring"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: trustColor }}>
            {Math.round(trust * 100)}
          </span>
        </div>
        <div>
          <div className="font-bold text-[11px]" style={{ color: trustColor }}>{trustLabel}</div>
          <div className="text-[9px] text-muted-foreground">
            {agent.verifiedActions} verified · {agent.inferredActions} inferred
          </div>
        </div>
      </div>

      {agent.aiModel && (
        <div>
          <span className="text-muted-foreground">AI Model</span>
          <p className="mt-0.5 font-medium text-blue-400">\uD83E\uDD16 {agent.aiModel}</p>
        </div>
      )}
      {agent.task && (
        <div>
          <span className="text-muted-foreground">User Request</span>
          <p className="mt-0.5 text-purple-400">\uD83C\uDFAF {agent.task}</p>
        </div>
      )}
      <div>
        <span className="text-muted-foreground">Status</span>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: vis.color }} />
          <span className="font-medium">{vis.label}</span>
          <span>{vis.icon}</span>
        </div>
      </div>
      <div>
        <span className="text-muted-foreground">Current Action</span>
        <p className="mt-0.5">{agent.label}</p>
      </div>

      {/* Temporal Stats */}
      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="bg-muted/50 rounded p-1">
          <div className="text-[9px] text-muted-foreground">Alive</div>
          <div className="text-[10px] font-mono font-bold">{aliveLabel}</div>
        </div>
        <div className="bg-muted/50 rounded p-1">
          <div className="text-[9px] text-muted-foreground">Active</div>
          <div className="text-[10px] font-mono font-bold">{uptime}</div>
        </div>
        <div className="bg-muted/50 rounded p-1">
          <div className="text-[9px] text-muted-foreground">Tools</div>
          <div className="text-[10px] font-mono font-bold">{agent.tools.length}</div>
        </div>
      </div>

      {/* Error Honesty Section */}
      {agent.errorCount > 0 && (
        <div className="border border-red-500/30 rounded p-2 bg-red-500/5">
          <div className="flex items-center gap-1 text-red-400 text-[10px] font-bold">
            <span>\u26A0</span>
            <span>Error History</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
            <div>
              <span className="text-muted-foreground">Errors: </span>
              <span className="text-red-400 font-mono">{agent.errorCount}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Recoveries: </span>
              <span className="text-emerald-400 font-mono">{agent.recoveryCount}</span>
            </div>
          </div>
          {agent.lastError && (
            <p className="mt-1 text-[9px] text-red-300/80 truncate" title={agent.lastError}>Last: {agent.lastError}</p>
          )}
          {agent.recoveryCount > 0 && (
            <div className="mt-1 h-1 rounded-full bg-red-500/20 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(agent.recoveryCount / agent.errorCount) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Signal Quality */}
      {(agent.signalSource || typeof agent.signalConfidence === 'number') && (
        <div>
          <span className="text-muted-foreground">Signal Quality</span>
          <p className="mt-0.5">
            {agent.signalSource ? (
              <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] mr-1 ${agent.signalSource === 'process' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {agent.signalSource}
              </span>
            ) : null}
            {typeof agent.signalConfidence === 'number' ? `${Math.round(agent.signalConfidence * 100)}% confidence` : ''}
          </p>
        </div>
      )}

      {/* Mini State Timeline */}
      {agent.stateHistory.length > 1 && (
        <div>
          <span className="text-muted-foreground">State Timeline</span>
          <div className="mt-1 flex gap-px h-3 rounded overflow-hidden">
            {agent.stateHistory.slice(-20).map((entry, i) => {
              const sv = STATE_VISUALS[entry.state]
              return (
                <div
                  key={i}
                  className="flex-1 min-w-[3px] transition-all"
                  style={{ background: sv.color }}
                  title={`${sv.label}: ${entry.label || ''}`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
            <span>{agent.stateHistory.length} states</span>
            <span>{new Date(agent.stateHistory[agent.stateHistory.length - 1].ts).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {agent.progress > 0 && (
        <div>
          <span className="text-muted-foreground">Progress</span>
          <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${agent.progress * 100}%`, background: vis.color }} />
          </div>
        </div>
      )}
      {agent.tools.length > 0 && (
        <div>
          <span className="text-muted-foreground">Tools ({agent.tools.length})</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {agent.tools.slice(-8).map((t, i) => (
              <span key={i} className="bg-muted px-1 py-0.5 rounded text-[10px]">{t}</span>
            ))}
          </div>
        </div>
      )}
      {agent.messages.length > 0 && (
        <div>
          <span className="text-muted-foreground">Messages</span>
          <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
            {agent.messages.slice(-5).map((m, i) => (
              <p key={i} className="bg-muted p-1.5 rounded text-[10px]">{m}</p>
            ))}
          </div>
        </div>
      )}
      {agent.parentAgentId && (
        <div>
          <span className="text-muted-foreground">Parent</span>
          <p className="mt-0.5 text-[10px] font-mono">{agent.parentAgentId}</p>
        </div>
      )}
      <div>
        <span className="text-muted-foreground">ID</span>
        <p className="mt-0.5 text-[10px] font-mono break-all">{agent.id}</p>
      </div>
    </>
  )
})

function DebugPanel() {
  const store = useAgentArcadeStore()
  const agents = useAgents()
  const events = store.events.slice(-20)

  return (
    <div className="border-t border-border bg-muted/30 text-[10px] font-mono p-3 max-h-64 overflow-y-auto">
      <div className="flex flex-wrap gap-3 mb-2">
        <span>Session: {store.sessionId || '—'}</span>
        <span>Status: {store.status}</span>
        <span>Transport: {store.transport || '—'}</span>
        <span>Agents: {store.agents.size}</span>
        <span>Events: {store.events.length}</span>
        <span>Dropped: {store.droppedEvents}</span>
        <span>Protocol: v1</span>
        <span>Last: {store.lastUpdate ? new Date(store.lastUpdate).toLocaleTimeString() : '—'}</span>
      </div>
      <div className="space-y-0.5">
        {events.map((ev, i) => {
          const agentName = agents.find(a => a.id === ev.agentId)?.name || ev.agentId.slice(0, 12)
          return (
            <div key={i} className="flex gap-2 text-muted-foreground">
              <span className="text-blue-400 flex-shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
              <span className="text-green-400 flex-shrink-0">{FEED_ICONS[ev.type] || '📡'}</span>
              <span className="truncate">{formatFeedEvent(ev, agentName)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Timeline Panel ──────────────────────────────────────────────────────────
const TimelinePanel = React.memo(function TimelinePanel({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) return null

  return (
    <div className="absolute top-0 left-0 right-0 z-20 aa-glass aa-slide-up p-2 max-h-48 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Agent Timeline</span>
        <span className="text-[9px] text-muted-foreground font-mono">{agents.length} agents</span>
      </div>
      <div className="space-y-1.5">
        {agents.map(agent => {
          const history = agent.stateHistory || []
          if (history.length === 0) return null
          const trust = agent.trustScore ?? 0.5
          const trustColor = trust >= 0.8 ? '#10b981' : trust >= 0.5 ? '#f59e0b' : '#ef4444'
          return (
            <div key={agent.id} className="flex items-center gap-2">
              <div className="w-20 flex-shrink-0 text-[9px] truncate font-medium">{agent.name}</div>
              <div className="w-3 h-3 rounded-full flex-shrink-0 border-2" style={{ borderColor: trustColor, background: trustColor + '30' }} title={`Trust: ${Math.round(trust * 100)}%`} />
              <div className="flex-1 flex gap-px h-4 rounded overflow-hidden bg-muted/30">
                {history.slice(-30).map((entry, i) => {
                  const sv = STATE_VISUALS[entry.state]
                  const isError = entry.state === 'error'
                  return (
                    <div
                      key={i}
                      className={`flex-1 min-w-[2px] transition-all ${isError ? 'animate-pulse' : ''}`}
                      style={{ background: sv.color }}
                      title={`${sv.label}: ${entry.label || ''} @ ${new Date(entry.ts).toLocaleTimeString()}`}
                    />
                  )
                })}
              </div>
              <div className="w-14 flex-shrink-0 text-[8px] text-right font-mono text-muted-foreground">
                {agent.tools.length}🔧 {agent.errorCount > 0 ? `${agent.errorCount}⚠` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ── Narrative Panel ─────────────────────────────────────────────────────────
const MILESTONE_ICONS: Record<string, string> = {
  spawn: '🚀', tool: '🔧', error: '💥', done: '🏆', recovery: '💚', milestone: '⭐',
}

const NarrativePanel = React.memo(function NarrativePanel({ narrative, agents }: { narrative: SessionNarrative; agents: Agent[] }) {
  // Use state for time to avoid calling Date.now() during render
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const elapsed = now - narrative.startedAt
  const elapsedLabel = elapsed < 60000 ? `${Math.round(elapsed / 1000)}s` : `${Math.round(elapsed / 60000)}m`

  const totalErrors = agents.reduce((sum, a) => sum + a.errorCount, 0)
  const totalRecoveries = agents.reduce((sum, a) => sum + a.recoveryCount, 0)
  const avgTrust = agents.length > 0 ? agents.reduce((sum, a) => sum + (a.trustScore ?? 0.5), 0) / agents.length : 0

  return (
    <div className="border-t border-border aa-glass text-[10px] p-3 max-h-56 overflow-y-auto aa-slide-up">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold uppercase tracking-widest text-muted-foreground">Session Story</span>
        <div className="flex gap-3 text-[9px] text-muted-foreground font-mono">
          <span>⏱ {elapsedLabel}</span>
          <span>📡 {narrative.totalEvents} events</span>
          <span>👾 Peak: {narrative.peakAgents}</span>
        </div>
      </div>

      {/* Session Health Summary */}
      <div className="flex gap-2 mb-2">
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${avgTrust >= 0.8 ? 'bg-emerald-500/15 text-emerald-400' : avgTrust >= 0.5 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
          Trust: {Math.round(avgTrust * 100)}%
        </div>
        {totalErrors > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 text-[9px]">
            {totalErrors} error{totalErrors !== 1 ? 's' : ''}
            {totalRecoveries > 0 && <span className="text-emerald-400">({totalRecoveries} recovered)</span>}
          </div>
        )}
        {totalErrors === 0 && agents.length > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px]">
            Clean run — no errors
          </div>
        )}
      </div>

      {/* Milestone Timeline */}
      {narrative.milestones.length > 0 ? (
        <div className="space-y-1 border-l-2 border-border pl-2 ml-1">
          {narrative.milestones.slice(-15).map((m, i) => {
            const age = now - m.ts
            const timeLabel = age < 60000 ? `${Math.round(age / 1000)}s ago` : `${Math.round(age / 60000)}m ago`
            return (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-xs flex-shrink-0 -ml-[11px]">{MILESTONE_ICONS[m.type] || '📌'}</span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{m.agentName}</span>
                  <span className="text-muted-foreground"> — {m.description}</span>
                </div>
                <span className="text-[8px] text-muted-foreground/60 flex-shrink-0 font-mono">{timeLabel}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-center py-2">Waiting for first event…</p>
      )}
    </div>
  )
})
