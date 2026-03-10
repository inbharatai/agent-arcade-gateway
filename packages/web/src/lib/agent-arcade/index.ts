/**
 * Agent Arcade — barrel export for the web library
 */

// Types
export type {
  Agent,
  AgentState,
  AgentStateEntry,
  GatewayConfig,
  ConnectionStatus,
  TelemetryEvent,
  EventType,
  SessionNarrative,
  NarrativeMilestone,
} from './types'
export { AGENT_STATES, EVENT_TYPES, STATE_VISUALS, AGENT_COLORS, isValidState } from './types'

// Settings
export type { ArcadeSettings } from './settings'
export { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'

// Store
export { useAgentArcadeStore, useAgents, useSelectedAgent, useConnectionStatus, useSettings, useNarrative } from './store'

// Themes
export type { ThemeDef, ThemeColors } from './themes'
export { THEMES, THEME_LIST, getTheme } from './themes'

// Sprites
export { PIXEL_CONFIGS, CHARACTER_PALETTES, CHARACTER_CLASSES, SPRITE_SIZE, generateCharacterSheet, getCharacterSheet, stateToFrame, clearSpriteCache } from './sprites'

// Movement
export type { GridPos, MovementState } from './movement'
export { DESK_POSITIONS, assignDesk, findPath, startMovement, tickMovement, createMovementState } from './movement'

// Canvas
export { PixelCanvas } from './core/PixelCanvas'

// Components
export { AgentArcadePanel } from './components/AgentArcadePanel'
export { useTelemetryProvider } from './components/useTelemetryProvider'
