/**
 * Persistent settings for Agent Arcade
 *
 * Uses localStorage with safe fallback for SSR/iframe contexts.
 */

export interface ArcadeSettings {
  theme: string
  pixelLevel: string
  soundEnabled: boolean
  musicEnabled: boolean
  sfxEnabled: boolean
  voiceEnabled: boolean
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  reducedMotion: boolean
  zoom: number
  showDebugPanel: boolean
  darkMode: boolean
  selectedSession: string
  panelVisible: boolean
  // ── Trust Layer UI ──────────────────────────────────────
  showTrustIndicators: boolean
  // ── Session Narrative ───────────────────────────────────
  showNarrative: boolean
  // ── Timeline view ───────────────────────────────────────
  showTimeline: boolean
}

const STORAGE_KEY = 'agent-arcade-settings'
const SETTINGS_VERSION = 2  // Bump to force audio-on migration

export const DEFAULT_SETTINGS: ArcadeSettings = {
  theme: 'office',
  pixelLevel: '16bit',
  soundEnabled: true,
  musicEnabled: true,
  sfxEnabled: true,
  voiceEnabled: true,
  masterVolume: 0.7,
  musicVolume: 0.3,
  sfxVolume: 0.5,
  reducedMotion: false,
  zoom: 1,
  showDebugPanel: false,
  darkMode: true,
  selectedSession: '',
  panelVisible: true,
  showTrustIndicators: true,
  showNarrative: true,
  showTimeline: true,
}

function safeStorage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null }
  catch { return null }
}

export function loadSettings(): ArcadeSettings {
  const store = safeStorage()
  if (!store) return { ...DEFAULT_SETTINGS }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Migration: if old version or missing version, reset audio defaults
    if (!parsed._v || (parsed._v as number) < SETTINGS_VERSION) {
      parsed.soundEnabled = DEFAULT_SETTINGS.soundEnabled
      parsed.voiceEnabled = DEFAULT_SETTINGS.voiceEnabled
      parsed._v = SETTINGS_VERSION
      store.setItem(STORAGE_KEY, JSON.stringify(parsed))
    }
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Partial<ArcadeSettings>): ArcadeSettings {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  const store = safeStorage()
  if (store) {
    store.setItem(STORAGE_KEY, JSON.stringify(merged))
  }
  return merged
}
