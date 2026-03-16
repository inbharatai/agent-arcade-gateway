'use client'

import { useState, useCallback, useEffect } from 'react'
import { initArcadeBridge } from '@/lib/arcade-bridge'

interface ArcadeConsoleConfig {
  gatewayUrl: string
  sessionId: string
  authToken?: string
  sessionSignature?: string
}

export function useArcadeConsole(config: ArcadeConsoleConfig) {
  const [consoleOpen, setConsoleOpen] = useState(false)
  const { gatewayUrl, sessionId, authToken, sessionSignature } = config

  // Initialize bridge whenever gateway config is available
  useEffect(() => {
    if (gatewayUrl && sessionId) {
      initArcadeBridge({ gatewayUrl, sessionId, authToken, sessionSignature })
    }
  }, [gatewayUrl, sessionId, authToken, sessionSignature])

  const toggleConsole = useCallback(() => setConsoleOpen(o => !o), [])
  const openConsole = useCallback(() => setConsoleOpen(true), [])
  const closeConsole = useCallback(() => setConsoleOpen(false), [])

  // Ctrl+` to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        toggleConsole()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggleConsole])

  return { consoleOpen, toggleConsole, openConsole, closeConsole }
}
