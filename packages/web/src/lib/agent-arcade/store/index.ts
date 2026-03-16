/**
 * Agent Arcade Zustand Store
 *
 * Manages agents, sessions, connection state, settings, and UI state.
 */

import { create } from 'zustand'
import { Agent, AgentState, AgentStateEntry, ConnectionStatus, GatewayConfig, TelemetryEvent, SessionNarrative, NarrativeMilestone, isValidState } from '../types'
import { loadSettings, saveSettings, ArcadeSettings, DEFAULT_SETTINGS } from '../settings'

interface ArcadeStore {
  // Connection
  status: ConnectionStatus
  error: string | null
  config: GatewayConfig | null
  transport: string | null

  // Session
  sessionId: string | null
  agents: Map<string, Agent>
  agentsList: Agent[]
  events: TelemetryEvent[]
  lastUpdate: number | null
  droppedEvents: number
  narrative: SessionNarrative

  // UI
  selectedAgentId: string | null
  settings: ArcadeSettings

  // Actions — connection
  setConfig: (config: GatewayConfig) => void
  setStatus: (status: ConnectionStatus) => void
  setError: (error: string | null) => void
  setTransport: (t: string) => void

  // Actions — agents
  processEvent: (event: TelemetryEvent) => void
  loadState: (agents: Agent[], events: TelemetryEvent[]) => void

  // Actions — UI
  selectAgent: (agentId: string | null) => void
  updateSettings: (patch: Partial<ArcadeSettings>) => void
  incrementDropped: () => void
  reset: () => void
  cleanupStaleAgents: (staleMs?: number) => void
}

const createNarrative = (): SessionNarrative => ({
  milestones: [],
  startedAt: Date.now(),
  totalEvents: 0,
  peakAgents: 0,
})

const initial = {
  status: 'disconnected' as const,
  error: null,
  config: null,
  transport: null,
  sessionId: null,
  agents: new Map<string, Agent>(),
  agentsList: [] as Agent[],
  events: [] as TelemetryEvent[],
  lastUpdate: null,
  droppedEvents: 0,
  selectedAgentId: null,
  settings: DEFAULT_SETTINGS,
  narrative: createNarrative(),
}

export const useAgentArcadeStore = create<ArcadeStore>((set, get) => ({
  ...initial,
  settings: typeof window !== 'undefined' ? loadSettings() : DEFAULT_SETTINGS,

  setConfig: (config) => set({ config, sessionId: config.sessionId }),
  setStatus: (status) => set({ status, error: status === 'connected' ? null : get().error }),
  setError: (error) => set({ error, status: error ? 'error' : get().status }),
  setTransport: (transport) => set({ transport }),

  processEvent: (event) => {
    set((state) => {
      const agents = new Map(state.agents)
      const events = [...state.events, event].slice(-200)
      const narrative = { ...state.narrative, totalEvents: state.narrative.totalEvents + 1 }

      const milestonesCap = narrative.milestones.length > 100
        ? narrative.milestones.slice(-80) : narrative.milestones

      const addMilestone = (m: NarrativeMilestone) => { milestonesCap.push(m) }

      const getSource = (p: Record<string, unknown>) =>
        p.source === 'process' || p.source === 'filesystem' ? p.source : undefined
      const getConfidence = (p: Record<string, unknown>) =>
        typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : undefined

      const computeTrust = (a: Agent, source?: 'process' | 'filesystem', confidence?: number): number => {
        const verified = a.verifiedActions + (source === 'process' ? 1 : 0)
        const inferred = a.inferredActions + (source === 'filesystem' ? 1 : 0)
        const total = verified + inferred
        if (total === 0) return 0.5
        const base = verified / total
        const confBoost = confidence != null ? (confidence - 0.5) * 0.1 : 0
        return Math.max(0, Math.min(1, base + confBoost))
      }

      const recordState = (a: Agent, newState: AgentState, label: string, source?: 'process' | 'filesystem', confidence?: number): AgentStateEntry[] => {
        const prev = Array.isArray(a.stateHistory) ? a.stateHistory : []
        const history = [...prev, { state: newState, ts: event.ts, label, source, confidence }]
        return history.length > 50 ? history.slice(-40) : history
      }

      const computeActiveTime = (a: Agent): number => {
        const hist = Array.isArray(a.stateHistory) ? a.stateHistory : []
        if (hist.length < 2) return a.activeTime
        const last = hist[hist.length - 1]
        const prev = hist[hist.length - 2]
        if (prev && prev.state !== 'idle' && prev.state !== 'done') {
          return a.activeTime + (event.ts - prev.ts)
        }
        return a.activeTime
      }

      const ensureAgent = (): Agent => {
        const existing = agents.get(event.agentId)
        if (existing) {
          // Normalize in case it came from a gateway snapshot missing client fields
          if (!Array.isArray(existing.stateHistory)) {
            existing.stateHistory = []
            existing.trustScore = existing.trustScore ?? 0.5
            existing.verifiedActions = existing.verifiedActions ?? 0
            existing.inferredActions = existing.inferredActions ?? 0
            existing.activeTime = existing.activeTime ?? 0
            existing.spawnedAt = existing.spawnedAt ?? existing.lastUpdate ?? Date.now()
            existing.errorCount = existing.errorCount ?? 0
            existing.recoveryCount = existing.recoveryCount ?? 0
          }
          return existing
        }

        const p = event.payload as Record<string, unknown>
        const source = getSource(p)
        const confidence = getConfidence(p)
        const created: Agent = {
          id: event.agentId,
          sessionId: state.sessionId || event.sessionId,
          name: typeof p.name === 'string' && p.name.trim() ? p.name : event.agentId,
          role: typeof p.role === 'string' && p.role.trim() ? p.role : 'assistant',
          state: 'idle',
          label: '',
          progress: 0,
          tools: [],
          messages: [],
          lastUpdate: event.ts,
          avatar: typeof p.avatar === 'string' ? p.avatar : undefined,
          characterClass: typeof p.characterClass === 'string' ? p.characterClass : undefined,
          aiModel: typeof p.aiModel === 'string' ? p.aiModel : undefined,
          task: typeof p.task === 'string' ? p.task : undefined,
          signalSource: source,
          signalConfidence: confidence,
          trustScore: 0.5,
          verifiedActions: source === 'process' ? 1 : 0,
          inferredActions: source === 'filesystem' ? 1 : 0,
          stateHistory: [{ state: 'idle' as AgentState, ts: event.ts, label: '', source, confidence }],
          activeTime: 0,
          spawnedAt: event.ts,
          errorCount: 0,
          recoveryCount: 0,
        }
        agents.set(event.agentId, created)
        return created
      }

      switch (event.type) {
        case 'agent.spawn': {
          const p = event.payload as Record<string, unknown>
          const source = getSource(p)
          const confidence = getConfidence(p)
          const name = typeof p.name === 'string' ? p.name : 'Agent'
          agents.set(event.agentId, {
            id: event.agentId,
            sessionId: state.sessionId || event.sessionId,
            name: name || 'Agent',
            role: typeof p.role === 'string' ? p.role : 'assistant',
            state: 'idle',
            label: 'Starting\u2026',
            progress: 0,
            tools: [],
            messages: [],
            lastUpdate: event.ts,
            avatar: typeof p.avatar === 'string' ? p.avatar : undefined,
            characterClass: typeof p.characterClass === 'string' ? p.characterClass : undefined,
            aiModel: typeof p.aiModel === 'string' ? p.aiModel : undefined,
            task: typeof p.task === 'string' ? p.task : undefined,
            signalSource: source,
            signalConfidence: confidence,
            trustScore: confidence ?? 0.5,
            verifiedActions: source === 'process' ? 1 : 0,
            inferredActions: source === 'filesystem' ? 1 : 0,
            stateHistory: [{ state: 'idle' as AgentState, ts: event.ts, label: 'Starting\u2026', source, confidence }],
            activeTime: 0,
            spawnedAt: event.ts,
            errorCount: 0,
            recoveryCount: 0,
          })
          addMilestone({ ts: event.ts, type: 'spawn', agentId: event.agentId, agentName: name || 'Agent', description: `${name || 'Agent'} joined as ${typeof p.role === 'string' ? p.role : 'assistant'}` })
          break
        }
        case 'agent.state': {
          const a = ensureAgent()
          const p = event.payload as Record<string, unknown>
          const newState = isValidState(String(p.state)) ? (p.state as AgentState) : a.state
          const label = typeof p.label === 'string' ? p.label : a.label
          const source = getSource(p) || a.signalSource
          const confidence = getConfidence(p) ?? a.signalConfidence
          const wasError = a.state === 'error'
          const isRecovery = wasError && newState !== 'error' && newState !== 'done'

          agents.set(event.agentId, {
            ...a,
            state: newState,
            label,
            progress: typeof p.progress === 'number' ? Math.max(0, Math.min(1, p.progress)) : a.progress,
            aiModel: typeof p.aiModel === 'string' ? p.aiModel : a.aiModel,
            task: typeof p.task === 'string' ? p.task : a.task,
            signalSource: source,
            signalConfidence: confidence,
            trustScore: computeTrust(a, source, confidence),
            verifiedActions: a.verifiedActions + (source === 'process' ? 1 : 0),
            inferredActions: a.inferredActions + (source === 'filesystem' ? 1 : 0),
            stateHistory: recordState(a, newState, label, source, confidence),
            activeTime: computeActiveTime(a),
            errorCount: newState === 'error' ? a.errorCount + 1 : a.errorCount,
            lastError: newState === 'error' && typeof p.label === 'string' ? p.label : a.lastError,
            recoveryCount: isRecovery ? a.recoveryCount + 1 : a.recoveryCount,
            lastUpdate: event.ts,
          })
          if (newState === 'error') {
            addMilestone({ ts: event.ts, type: 'error', agentId: event.agentId, agentName: a.name, description: label || 'Error occurred' })
          }
          if (isRecovery) {
            addMilestone({ ts: event.ts, type: 'recovery', agentId: event.agentId, agentName: a.name, description: `Recovered \u2192 ${newState}` })
          }
          break
        }
        case 'agent.tool': {
          const a = ensureAgent()
          const p = event.payload as Record<string, unknown>
          const source = getSource(p) || a.signalSource
          const confidence = getConfidence(p) ?? a.signalConfidence
          const toolName = typeof p.name === 'string' ? p.name : 'tool'
          const label = typeof p.label === 'string' ? p.label : `Using ${toolName}`
          agents.set(event.agentId, {
            ...a, state: 'tool',
            label,
            tools: [...a.tools, toolName],
            signalSource: source,
            signalConfidence: confidence,
            trustScore: computeTrust(a, source, confidence),
            verifiedActions: a.verifiedActions + (source === 'process' ? 1 : 0),
            inferredActions: a.inferredActions + (source === 'filesystem' ? 1 : 0),
            stateHistory: recordState(a, 'tool', label, source, confidence),
            activeTime: computeActiveTime(a),
            lastUpdate: event.ts,
          })
          if (a.tools.length % 5 === 0) {
            addMilestone({ ts: event.ts, type: 'tool', agentId: event.agentId, agentName: a.name, description: `Used ${toolName} (${a.tools.length + 1} total)` })
          }
          break
        }
        case 'agent.message': {
          const a = ensureAgent()
          const p = event.payload as Record<string, unknown>
          const text = String(p.text || '').trim()
          const output = typeof p.output === 'string' ? p.output.trim() : ''
          const isCommandLike =
            p.level === 'command' ||
            text.startsWith('/') ||
            text.toLowerCase().startsWith('run ') ||
            text.toLowerCase().startsWith('command:') ||
            Boolean(p.requiresInput)

          const nextMessages = [...a.messages]
          if (text) nextMessages.push(text)
          if (output) nextMessages.push(`Output: ${output}`)

          agents.set(event.agentId, {
            ...a,
            state: p.level === 'waiting' || p.requiresInput ? 'waiting' : a.state,
            label: text || output || a.label,
            messages: nextMessages,
            lastUpdate: event.ts,
          })

          const selectedAgentId = isCommandLike ? event.agentId : state.selectedAgentId

          const peakAgents = Math.max(narrative.peakAgents, agents.size)
          return {
            agents,
            agentsList: Array.from(agents.values()),
            events,
            lastUpdate: event.ts,
            selectedAgentId,
            narrative: { ...narrative, milestones: milestonesCap, peakAgents },
          }
        }
        case 'agent.link': {
          const p = event.payload as Record<string, string>
          const child = agents.get(p.childAgentId)
          if (child) agents.set(p.childAgentId, { ...child, parentAgentId: p.parentAgentId })
          break
        }
        case 'agent.position': {
          const a = ensureAgent()
          const p = event.payload as Record<string, number>
          agents.set(event.agentId, { ...a, position: { x: p.x, y: p.y }, lastUpdate: event.ts })
          break
        }
        case 'agent.end': {
          const a = ensureAgent()
          const p = event.payload as Record<string, unknown>
          const reason = String(p.reason || 'Completed')
          agents.set(event.agentId, {
            ...a, state: 'done',
            label: reason,
            progress: 1, lastUpdate: event.ts,
            stateHistory: recordState(a, 'done', reason, a.signalSource, a.signalConfidence),
            activeTime: computeActiveTime(a),
          })
          addMilestone({ ts: event.ts, type: 'done', agentId: event.agentId, agentName: a.name, description: reason })
          break
        }
      }

      const peakAgents = Math.max(narrative.peakAgents, agents.size)
      return { agents, agentsList: Array.from(agents.values()), events, lastUpdate: event.ts, narrative: { ...narrative, milestones: milestonesCap, peakAgents } }
    })
  },

  loadState: (agentsList, events) => {
    const agents = new Map<string, Agent>()
    agentsList.forEach(a => {
      // Normalize agents from gateway snapshots that lack client-side fields
      const normalized: Agent = {
        ...a,
        stateHistory: Array.isArray(a.stateHistory) ? a.stateHistory : [],
        trustScore: a.trustScore ?? 0.5,
        verifiedActions: a.verifiedActions ?? 0,
        inferredActions: a.inferredActions ?? 0,
        activeTime: a.activeTime ?? 0,
        spawnedAt: a.spawnedAt ?? a.lastUpdate ?? Date.now(),
        errorCount: a.errorCount ?? 0,
        recoveryCount: a.recoveryCount ?? 0,
      }
      agents.set(a.id, normalized)
    })
    set({ agents, agentsList: Array.from(agents.values()), events, lastUpdate: Date.now() })
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  updateSettings: (patch) => {
    const settings = saveSettings(patch)
    set({ settings })
  },

  incrementDropped: () => set(s => ({ droppedEvents: s.droppedEvents + 1 })),

  reset: () => set({ ...initial, settings: get().settings, narrative: createNarrative() }),

  // Auto-cleanup stale agents — removes unused/old agents per state:
  //   done   → removed after 20s  (task completed, no longer needed)
  //   error  → removed after 30s  (failed, clear the canvas)
  //   idle   → removed after staleMs (default 45s, just sitting there)
  //   other active states → never removed by cleanup (still working)
  cleanupStaleAgents: (staleMs = 45000) => {
    const now = Date.now()
    set((state) => {
      const agents = new Map(state.agents)
      let removed = 0
      for (const [id, agent] of agents) {
        const age = now - agent.lastUpdate
        if (agent.state === 'done'  && age > 20000) { agents.delete(id); removed++ }
        else if (agent.state === 'error' && age > 30000) { agents.delete(id); removed++ }
        else if (agent.state === 'idle'  && age > staleMs) { agents.delete(id); removed++ }
      }
      if (removed === 0) return state
      // Clear selectedAgentId if the selected agent was pruned
      const newSelectedId = (state.selectedAgentId && agents.has(state.selectedAgentId))
        ? state.selectedAgentId
        : null
      return { agents, agentsList: Array.from(agents.values()), selectedAgentId: newSelectedId }
    })
  },
}))

// Selectors
export const useAgents = () => useAgentArcadeStore(s => s.agentsList)
export const useSelectedAgent = () => useAgentArcadeStore(s => s.selectedAgentId ? s.agents.get(s.selectedAgentId) : undefined)
export const useConnectionStatus = () => useAgentArcadeStore(s => s.status)
export const useSettings = () => useAgentArcadeStore(s => s.settings)
export const useNarrative = () => useAgentArcadeStore(s => s.narrative)
