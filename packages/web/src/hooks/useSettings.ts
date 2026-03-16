'use client'

import { useState, useCallback } from 'react'

export interface ArcadeSettings {
  showTokenCounts: boolean
  showCostEstimates: boolean
  historyRetention: 10 | 25 | 50 | 0  // 0 = unlimited
  autoScroll: boolean
  autoDetectLanguage: boolean
  autoTranslate: boolean
  showTranslationPreview: boolean
  preferredLanguage: string
  fontSize: 'small' | 'medium' | 'large'
  codeFont: 'mono' | 'fira-code' | 'jetbrains-mono'
  animationSpeed: 'slow' | 'normal' | 'fast' | 'none'
  compactMode: boolean
}

const STORAGE_KEY = 'arcade-settings'

const DEFAULT_SETTINGS: ArcadeSettings = {
  showTokenCounts: true,
  showCostEstimates: true,
  historyRetention: 50,
  autoScroll: true,
  autoDetectLanguage: true,
  autoTranslate: true,
  showTranslationPreview: true,
  preferredLanguage: 'en',
  fontSize: 'medium',
  codeFont: 'mono',
  animationSpeed: 'normal',
  compactMode: false,
}

function loadSettings(): ArcadeSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ArcadeSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function persistSettings(settings: ArcadeSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // quota exceeded — silently ignore
  }
}

export function useSettings() {
  // Lazy initializer: runs once on mount, safe for 'use client' components.
  // loadSettings() gracefully returns DEFAULT_SETTINGS during SSR.
  const [settings, setSettings] = useState<ArcadeSettings>(loadSettings)

  const updateSetting = useCallback(<K extends keyof ArcadeSettings>(
    key: K,
    value: ArcadeSettings[K]
  ) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      persistSettings(next)
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    persistSettings(DEFAULT_SETTINGS)
    setSettings(DEFAULT_SETTINGS)
  }, [])

  return { settings, updateSetting, resetSettings }
}
