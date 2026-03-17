/**
 * Theme definitions for Agent Arcade
 *
 * Each theme provides a complete visual identity: floor, walls, desks,
 * monitors, speech bubbles, effect overlays, and ambient atmosphere.
 * 8 dramatic themes spanning office calm to hacker intensity.
 */

export interface ThemeColors {
  floor: string
  floorAlt: string
  wall: string
  wallHighlight: string
  desk: string
  deskHighlight: string
  monitor: string
  screenBg: string
  bubble: string
  bubbleBorder: string
  text: string
  background: string
  accent: string
  keyboard: string
  shadow: string
}

export type FloorPattern = 'checker' | 'wood' | 'grid' | 'metal' | 'grass' | 'stars' | 'stone' | 'circuit'
export type WallStyle = 'brick' | 'panel' | 'neon' | 'glass' | 'hedge' | 'viewport' | 'dungeon' | 'terminal'
export type DeskStyle = 'wood' | 'metal' | 'neon' | 'glass' | 'picnic' | 'console' | 'stone' | 'holo'

export interface ThemeDef {
  id: string
  name: string
  icon: string
  description: string
  category: 'calm' | 'tactical' | 'retro' | 'tech' | 'nature' | 'scifi' | 'dark'
  colors: ThemeColors
  floorPattern: FloorPattern
  wallStyle: WallStyle
  deskStyle: DeskStyle
  /** Ambient particle tint */
  ambientTint: string
  /** Whether the theme is dark */
  isDark: boolean
  /** Neon sign text displayed on the wall */
  neonSignText: string
  /** Neon sign color */
  neonSignColor: string
  /** Secondary accent for particle variety */
  accentSecondary: string
  /** Tertiary accent for particle variety */
  accentTertiary: string
  /** Floor reflection opacity (0-1) */
  floorReflectionAlpha: number
}

export const THEMES: Record<string, ThemeDef> = {
  office: {
    id: 'office',
    name: 'Office',
    icon: '🏢',
    description: 'Warm professional workspace',
    category: 'calm',
    colors: {
      floor: '#fef3c7', floorAlt: '#fde68a', wall: '#9ca3af', wallHighlight: '#d1d5db',
      desk: '#92400e', deskHighlight: '#b45309', monitor: '#1f2937', screenBg: '#374151',
      bubble: '#ffffff', bubbleBorder: '#1e1e1e', text: '#1f2937', background: '#fde68a',
      accent: '#3b82f6', keyboard: '#374151', shadow: 'rgba(0,0,0,0.15)',
    },
    floorPattern: 'checker',
    wallStyle: 'brick',
    deskStyle: 'wood',
    ambientTint: '#fef3c7',
    isDark: false,
    neonSignText: 'WORK HARD',
    neonSignColor: '#3b82f6',
    accentSecondary: '#f59e0b',
    accentTertiary: '#10b981',
    floorReflectionAlpha: 0.08,
  },
  'war-room': {
    id: 'war-room',
    name: 'War Room',
    icon: '🎖️',
    description: 'Tactical operations center',
    category: 'tactical',
    colors: {
      floor: '#1c1917', floorAlt: '#292524', wall: '#44403c', wallHighlight: '#57534e',
      desk: '#78716c', deskHighlight: '#a8a29e', monitor: '#1c1917', screenBg: '#064e3b',
      bubble: '#ecfdf5', bubbleBorder: '#065f46', text: '#f5f5f4', background: '#1c1917',
      accent: '#10b981', keyboard: '#57534e', shadow: 'rgba(0,0,0,0.4)',
    },
    floorPattern: 'grid',
    wallStyle: 'panel',
    deskStyle: 'metal',
    ambientTint: '#10b981',
    isDark: true,
    neonSignText: 'OPS CENTER',
    neonSignColor: '#10b981',
    accentSecondary: '#ef4444',
    accentTertiary: '#fbbf24',
    floorReflectionAlpha: 0.06,
  },
  'retro-arcade': {
    id: 'retro-arcade',
    name: 'Retro Arcade',
    icon: '👾',
    description: 'Neon-lit pixel paradise',
    category: 'retro',
    colors: {
      floor: '#1e1b4b', floorAlt: '#312e81', wall: '#4c1d95', wallHighlight: '#7c3aed',
      desk: '#581c87', deskHighlight: '#7c3aed', monitor: '#0f172a', screenBg: '#1e1b4b',
      bubble: '#fef08a', bubbleBorder: '#ca8a04', text: '#fef9c3', background: '#0c0a3e',
      accent: '#f472b6', keyboard: '#4c1d95', shadow: 'rgba(0,0,0,0.5)',
    },
    floorPattern: 'checker',
    wallStyle: 'neon',
    deskStyle: 'neon',
    ambientTint: '#f472b6',
    isDark: true,
    neonSignText: 'ARCADE',
    neonSignColor: '#f472b6',
    accentSecondary: '#a855f7',
    accentTertiary: '#fbbf24',
    floorReflectionAlpha: 0.15,
  },
  'cyber-lab': {
    id: 'cyber-lab',
    name: 'Cyber Lab',
    icon: '🔬',
    description: 'High-tech research facility',
    category: 'tech',
    colors: {
      floor: '#0f172a', floorAlt: '#1e293b', wall: '#334155', wallHighlight: '#475569',
      desk: '#1e293b', deskHighlight: '#334155', monitor: '#020617', screenBg: '#0c4a6e',
      bubble: '#e0f2fe', bubbleBorder: '#0284c7', text: '#e2e8f0', background: '#020617',
      accent: '#06b6d4', keyboard: '#334155', shadow: 'rgba(0,0,0,0.5)',
    },
    floorPattern: 'metal',
    wallStyle: 'glass',
    deskStyle: 'glass',
    ambientTint: '#06b6d4',
    isDark: true,
    neonSignText: 'CYBER LAB',
    neonSignColor: '#06b6d4',
    accentSecondary: '#818cf8',
    accentTertiary: '#f472b6',
    floorReflectionAlpha: 0.12,
  },
  'campus-ops': {
    id: 'campus-ops',
    name: 'Campus Ops',
    icon: '🌿',
    description: 'Outdoor mission operations',
    category: 'nature',
    colors: {
      floor: '#bbf7d0', floorAlt: '#86efac', wall: '#a3e635', wallHighlight: '#bef264',
      desk: '#92400e', deskHighlight: '#b45309', monitor: '#1f2937', screenBg: '#14532d',
      bubble: '#ffffff', bubbleBorder: '#166534', text: '#14532d', background: '#dcfce7',
      accent: '#16a34a', keyboard: '#374151', shadow: 'rgba(0,0,0,0.12)',
    },
    floorPattern: 'grass',
    wallStyle: 'hedge',
    deskStyle: 'picnic',
    ambientTint: '#86efac',
    isDark: false,
    neonSignText: 'CAMPUS',
    neonSignColor: '#16a34a',
    accentSecondary: '#fbbf24',
    accentTertiary: '#60a5fa',
    floorReflectionAlpha: 0.05,
  },
  'deep-space': {
    id: 'deep-space',
    name: 'Deep Space Lab',
    icon: '🚀',
    description: 'Zero-gravity orbital station',
    category: 'scifi',
    colors: {
      floor: '#0a0a1a', floorAlt: '#111128', wall: '#1a1a3e', wallHighlight: '#2a2a5e',
      desk: '#1e1e3a', deskHighlight: '#2e2e5a', monitor: '#050510', screenBg: '#0a0a2e',
      bubble: '#c7d2fe', bubbleBorder: '#6366f1', text: '#e0e7ff', background: '#050510',
      accent: '#818cf8', keyboard: '#1e1e3a', shadow: 'rgba(0,0,0,0.6)',
    },
    floorPattern: 'stars',
    wallStyle: 'viewport',
    deskStyle: 'console',
    ambientTint: '#818cf8',
    isDark: true,
    neonSignText: 'STATION',
    neonSignColor: '#818cf8',
    accentSecondary: '#a78bfa',
    accentTertiary: '#38bdf8',
    floorReflectionAlpha: 0.18,
  },
  'dungeon-terminal': {
    id: 'dungeon-terminal',
    name: 'Dungeon Terminal',
    icon: '🏰',
    description: 'Ancient stone command post',
    category: 'dark',
    colors: {
      floor: '#1c1a17', floorAlt: '#2a2720', wall: '#3d3830', wallHighlight: '#5c5545',
      desk: '#4a4035', deskHighlight: '#6b5f50', monitor: '#1a1815', screenBg: '#1e2a1e',
      bubble: '#fef3c7', bubbleBorder: '#92400e', text: '#e7e5e4', background: '#1c1a17',
      accent: '#f59e0b', keyboard: '#3d3830', shadow: 'rgba(0,0,0,0.55)',
    },
    floorPattern: 'stone',
    wallStyle: 'dungeon',
    deskStyle: 'stone',
    ambientTint: '#f59e0b',
    isDark: true,
    neonSignText: 'DUNGEON',
    neonSignColor: '#f59e0b',
    accentSecondary: '#ef4444',
    accentTertiary: '#a78bfa',
    floorReflectionAlpha: 0.10,
  },
  'hacker-bunker': {
    id: 'hacker-bunker',
    name: 'Hacker Bunker',
    icon: '💀',
    description: 'Underground hacking den',
    category: 'dark',
    colors: {
      floor: '#0a0f0a', floorAlt: '#0f1a0f', wall: '#1a2a1a', wallHighlight: '#2a3a2a',
      desk: '#1a1a1a', deskHighlight: '#2a2a2a', monitor: '#050a05', screenBg: '#0a1a0a',
      bubble: '#bbf7d0', bubbleBorder: '#15803d', text: '#4ade80', background: '#050a05',
      accent: '#00ff41', keyboard: '#1a2a1a', shadow: 'rgba(0,0,0,0.6)',
    },
    floorPattern: 'circuit',
    wallStyle: 'terminal',
    deskStyle: 'holo',
    ambientTint: '#00ff41',
    isDark: true,
    neonSignText: 'HACK THE PLANET',
    neonSignColor: '#00ff41',
    accentSecondary: '#ef4444',
    accentTertiary: '#3b82f6',
    floorReflectionAlpha: 0.14,
  },
}

export const THEME_LIST = Object.values(THEMES)

export function getTheme(id: string): ThemeDef {
  return THEMES[id] || THEMES.office
}
