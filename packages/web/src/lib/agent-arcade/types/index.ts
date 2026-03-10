/**
 * Agent Arcade — canonical types for the web frontend
 * Re-exports core protocol + UI-specific additions.
 */

export const PROTOCOL_VERSION = 1

export const EVENT_TYPES = [
  'agent.spawn', 'agent.state', 'agent.tool', 'agent.message',
  'agent.link', 'agent.position', 'agent.end',
  'session.start', 'session.end',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const AGENT_STATES = [
  'idle', 'thinking', 'reading', 'writing', 'tool',
  'waiting', 'moving', 'error', 'done',
] as const
export type AgentState = (typeof AGENT_STATES)[number]

export interface TelemetryEvent {
  v: number
  ts: number
  sessionId: string
  agentId: string
  type: EventType
  payload: Record<string, unknown>
}

export interface Agent {
  id: string
  sessionId: string
  name: string
  role: string
  state: AgentState
  label: string
  progress: number
  tools: string[]
  messages: string[]
  lastUpdate: number
  parentAgentId?: string
  avatar?: string
  characterClass?: string
  position?: { x: number; y: number }
  targetPosition?: { x: number; y: number }
  animationFrame?: number
  /** AI model powering this agent (e.g. "GPT-4o", "Claude Opus") */
  aiModel?: string
  /** Current high-level task description — what the user asked the agent to do */
  task?: string
  /** Latest action signal origin: process (high-confidence) or filesystem (inferred) */
  signalSource?: 'process' | 'filesystem'
  /** Confidence score from 0..1 for the latest action signal */
  signalConfidence?: number

  // ── Trust Layer ──────────────────────────────────────────────────
  /** Rolling trust score 0..1 based on signal quality history */
  trustScore?: number
  /** Number of verified actions (high-confidence signals) */
  verifiedActions: number
  /** Number of inferred actions (low-confidence filesystem signals) */
  inferredActions: number

  // ── Temporal Coherence ──────────────────────────────────────────
  /** State history for timeline visualization [{ state, ts, label }] */
  stateHistory: AgentStateEntry[]
  /** Total active time in milliseconds */
  activeTime: number
  /** Timestamp when agent first appeared */
  spawnedAt: number

  // ── Error Honesty ──────────────────────────────────────────────
  /** Number of errors encountered */
  errorCount: number
  /** Last error message */
  lastError?: string
  /** Number of recoveries from error state */
  recoveryCount: number
}

export interface AgentStateEntry {
  state: AgentState
  ts: number
  label: string
  source?: 'process' | 'filesystem'
  confidence?: number
}

export interface SessionNarrative {
  /** Key moments in the session for summary */
  milestones: NarrativeMilestone[]
  /** Session start time */
  startedAt: number
  /** Total events processed */
  totalEvents: number
  /** Peak concurrent active agents */
  peakAgents: number
}

export interface NarrativeMilestone {
  ts: number
  type: 'spawn' | 'tool' | 'error' | 'done' | 'recovery' | 'milestone'
  agentId: string
  agentName: string
  description: string
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface GatewayConfig {
  url: string
  sessionId: string
  authToken?: string
  apiKey?: string
  sessionSignature?: string
  transport?: 'ws' | 'sse' | 'auto'
}

export const STATE_VISUALS: Record<AgentState, { icon: string; label: string; color: string }> = {
  idle:     { icon: '😐', label: 'Idle',     color: '#6b7280' },
  thinking: { icon: '💭', label: 'Thinking', color: '#a855f7' },
  reading:  { icon: '📖', label: 'Reading',  color: '#3b82f6' },
  writing:  { icon: '✍️', label: 'Writing',  color: '#22c55e' },
  tool:     { icon: '🔧', label: 'Tool',     color: '#06b6d4' },
  waiting:  { icon: '❓', label: 'Waiting',  color: '#f59e0b' },
  moving:   { icon: '🚶', label: 'Moving',   color: '#8b5cf6' },
  error:    { icon: '❌', label: 'Error',    color: '#ef4444' },
  done:     { icon: '✅', label: 'Done',     color: '#22c55e' },
}

export const AGENT_COLORS = [
  { primary: '#4ade80', secondary: '#22c55e' },
  { primary: '#f472b6', secondary: '#ec4899' },
  { primary: '#60a5fa', secondary: '#3b82f6' },
  { primary: '#fbbf24', secondary: '#f59e0b' },
  { primary: '#a78bfa', secondary: '#8b5cf6' },
  { primary: '#fb923c', secondary: '#f97316' },
  { primary: '#2dd4bf', secondary: '#14b8a6' },
  { primary: '#f87171', secondary: '#ef4444' },
]

export function isValidState(s: string): s is AgentState {
  return (AGENT_STATES as readonly string[]).includes(s)
}
