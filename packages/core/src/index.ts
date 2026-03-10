/**
 * @agent-arcade/core
 *
 * Canonical protocol definition for Agent Arcade telemetry.
 * All SDKs, the gateway, and frontends MUST use these types.
 */

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------
export const PROTOCOL_VERSION = 1

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------
export const EVENT_TYPES = [
  'agent.spawn',
  'agent.state',
  'agent.tool',
  'agent.message',
  'agent.link',
  'agent.position',
  'agent.end',
  'session.start',
  'session.end',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

// ---------------------------------------------------------------------------
// Agent state enum — the ONLY source of truth for states
// ---------------------------------------------------------------------------
export const AGENT_STATES = [
  'idle',
  'thinking',
  'reading',
  'writing',
  'tool',
  'waiting',
  'moving',
  'error',
  'done',
] as const

export type AgentState = (typeof AGENT_STATES)[number]

// ---------------------------------------------------------------------------
// Telemetry event wire format
// ---------------------------------------------------------------------------
export interface TelemetryEvent {
  /** Protocol version */
  v: number
  /** Timestamp in ms since epoch */
  ts: number
  /** Session identifier */
  sessionId: string
  /** Agent identifier */
  agentId: string
  /** Event type */
  type: EventType
  /** Event-specific payload */
  payload: EventPayload
}

// ---------------------------------------------------------------------------
// Payload types per event
// ---------------------------------------------------------------------------
export interface SpawnPayload {
  name?: string
  role?: string
  avatar?: string
  characterClass?: string
}

export interface StatePayload {
  state: AgentState
  label?: string
  progress?: number
}

export interface ToolPayload {
  name: string
  path?: string
  label?: string
}

export interface MessagePayload {
  text: string
  level?: 'info' | 'warning' | 'waiting'
  requiresInput?: boolean
}

export interface LinkPayload {
  parentAgentId: string
  childAgentId: string
}

export interface PositionPayload {
  x: number
  y: number
}

export interface EndPayload {
  reason?: string
  success?: boolean
}

export interface SessionStartPayload {
  name?: string
  metadata?: Record<string, unknown>
}

export interface SessionEndPayload {
  reason?: string
}

export type EventPayload =
  | SpawnPayload
  | StatePayload
  | ToolPayload
  | MessagePayload
  | LinkPayload
  | PositionPayload
  | EndPayload
  | SessionStartPayload
  | SessionEndPayload
  | Record<string, unknown>

// ---------------------------------------------------------------------------
// Agent model (frontend / store representation)
// ---------------------------------------------------------------------------
export interface AgentModel {
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
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface GatewayConfig {
  url: string
  sessionId: string
  authToken?: string
  transport?: 'ws' | 'sse' | 'auto'
}

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------
export const THEME_IDS = ['office', 'war-room', 'retro-arcade', 'cyber-lab', 'campus-ops'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeColors {
  floor: string
  floorAlt: string
  wall: string
  desk: string
  deskHighlight: string
  monitor: string
  screenBg: string
  bubble: string
  bubbleBorder: string
  text: string
  background: string
  accent: string
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  colors: ThemeColors
  floorPattern: 'checker' | 'wood' | 'grid' | 'metal' | 'grass'
  wallStyle: 'brick' | 'panel' | 'neon' | 'glass' | 'hedge'
  deskStyle: 'wood' | 'metal' | 'neon' | 'glass' | 'picnic'
}

// ---------------------------------------------------------------------------
// Pixel level definitions
// ---------------------------------------------------------------------------
export const PIXEL_LEVELS = ['8bit', '16bit', '32bit', 'hd'] as const
export type PixelLevel = (typeof PIXEL_LEVELS)[number]

export interface PixelLevelConfig {
  id: PixelLevel
  name: string
  tileSize: number
  spriteSize: number
  scale: number
  smoothing: boolean
}

// ---------------------------------------------------------------------------
// Settings (persisted by frontend)
// ---------------------------------------------------------------------------
export interface ArcadeSettings {
  theme: ThemeId
  pixelLevel: PixelLevel
  soundEnabled: boolean
  reducedMotion: boolean
  zoom: number
  showDebugPanel: boolean
  darkMode: boolean
}

export const DEFAULT_SETTINGS: ArcadeSettings = {
  theme: 'office',
  pixelLevel: '16bit',
  soundEnabled: false,
  reducedMotion: false,
  zoom: 1,
  showDebugPanel: false,
  darkMode: true,
}

// ---------------------------------------------------------------------------
// Animation mapping
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Character classes (skins / avatars)
// ---------------------------------------------------------------------------
export const CHARACTER_CLASSES = [
  'developer', 'designer', 'manager',
  'researcher', 'writer', 'engineer',
  'hacker', 'analyst',
] as const
export type CharacterClass = (typeof CHARACTER_CLASSES)[number]

export interface CharacterPalette {
  skin: string
  hair: string
  shirt: string
  pants: string
  shoes: string
  accent: string
  outline: string
}

export const CHARACTER_PALETTES: Record<string, CharacterPalette> = {
  developer:  { skin: '#fce8d0', hair: '#3d2314', shirt: '#2563eb', pants: '#1e293b', shoes: '#475569', accent: '#60a5fa', outline: '#1e1e1e' },
  designer:   { skin: '#d4a574', hair: '#ff6b9d', shirt: '#ec4899', pants: '#7c3aed', shoes: '#a855f7', accent: '#f472b6', outline: '#1e1e1e' },
  manager:    { skin: '#fce8d0', hair: '#6b7280', shirt: '#ffffff', pants: '#1f2937', shoes: '#111827', accent: '#ef4444', outline: '#1e1e1e' },
  researcher: { skin: '#fce8d0', hair: '#854d0e', shirt: '#f8fafc', pants: '#6b7280', shoes: '#374151', accent: '#22c55e', outline: '#1e1e1e' },
  writer:     { skin: '#fce8d0', hair: '#92400e', shirt: '#fef3c7', pants: '#78350f', shoes: '#451a03', accent: '#f59e0b', outline: '#1e1e1e' },
  engineer:   { skin: '#fce8d0', hair: '#292524', shirt: '#f97316', pants: '#1e293b', shoes: '#71717a', accent: '#eab308', outline: '#1e1e1e' },
  hacker:     { skin: '#fce8d0', hair: '#1a1a1a', shirt: '#000000', pants: '#1a1a1a', shoes: '#333333', accent: '#00ff41', outline: '#1e1e1e' },
  analyst:    { skin: '#d4a574', hair: '#4a3728', shirt: '#0ea5e9', pants: '#334155', shoes: '#475569', accent: '#38bdf8', outline: '#1e1e1e' },
}

// ---------------------------------------------------------------------------
// Agent palette assignment colours
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function isValidState(s: string): s is AgentState {
  return (AGENT_STATES as readonly string[]).includes(s)
}

export function isValidEventType(t: string): t is EventType {
  return (EVENT_TYPES as readonly string[]).includes(t)
}

export function createEvent(
  type: EventType,
  sessionId: string,
  agentId: string,
  payload: EventPayload,
): TelemetryEvent {
  return { v: PROTOCOL_VERSION, ts: Date.now(), sessionId, agentId, type, payload }
}
