'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface SplitPanelProps {
  left: React.ReactNode
  right: React.ReactNode
  consoleOpen: boolean
  onToggleConsole: () => void
  isMobile: boolean
  activeTab?: 'arcade' | 'console'
  onTabChange?: (tab: 'arcade' | 'console') => void
}

const STORAGE_KEY = 'arcade-split-panel-width'
const MIN_CONSOLE_WIDTH = 300
const DEFAULT_CONSOLE_WIDTH = 400

function getStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_CONSOLE_WIDTH
  try {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) || '') || 0
    // Clamp to 35% of current viewport so it works on any screen size
    const cap = Math.floor(window.innerWidth * 0.35)
    if (stored) return Math.min(stored, cap)
    return Math.min(DEFAULT_CONSOLE_WIDTH, cap)
  } catch { return DEFAULT_CONSOLE_WIDTH }
}

export function SplitPanel({
  left,
  right,
  consoleOpen,
  onToggleConsole,
  isMobile,
  activeTab = 'arcade',
  onTabChange,
}: SplitPanelProps) {
  const [consoleWidth, setConsoleWidth] = useState(getStoredWidth)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startXRef.current = e.clientX
    startWidthRef.current = consoleWidth
  }, [consoleWidth])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerWidth = containerRef.current.offsetWidth
      const maxWidth = containerWidth * 0.45
      const delta = startXRef.current - e.clientX  // dragging left = wider console
      const newWidth = Math.max(MIN_CONSOLE_WIDTH, Math.min(maxWidth, startWidthRef.current + delta))
      setConsoleWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      try { localStorage.setItem(STORAGE_KEY, String(consoleWidth)) } catch { /* quota */ }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, consoleWidth])

  // Mobile: Tab switcher
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex border-b border-white/10 shrink-0">
          <button
            onClick={() => onTabChange?.('arcade')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === 'arcade' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-white/50 hover:text-white/70'}`}
          >
            🎮 Arcade
          </button>
          <button
            onClick={() => onTabChange?.('console')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === 'console' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-white/50 hover:text-white/70'}`}
          >
            💬 Console
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'arcade' ? left : right}
        </div>
      </div>
    )
  }

  // Desktop: Resizable split
  return (
    <div ref={containerRef} className="flex h-full overflow-hidden relative">
      {/* Left: Arcade */}
      <div
        className="flex-1 overflow-hidden min-w-0 transition-all duration-200"
        style={{ minWidth: '0' }}
      >
        {left}
      </div>

      {/* Toggle button */}
      <button
        onClick={onToggleConsole}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-20 w-6 h-12 flex items-center justify-center rounded-l-lg transition-all duration-200 ${consoleOpen ? 'bg-blue-600 hover:bg-blue-500 text-white right-[var(--console-width)]' : 'bg-white/10 hover:bg-white/20 text-white/60'}`}
        style={{ right: consoleOpen ? `${consoleWidth}px` : 0 } as React.CSSProperties}
        title={consoleOpen ? 'Close Console (Ctrl+`)' : 'Open Console (Ctrl+`)'}
      >
        <span className="text-xs">{consoleOpen ? '›' : '‹'}</span>
      </button>

      {/* Resize handle */}
      {consoleOpen && (
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 hover:w-1.5 bg-white/5 hover:bg-blue-500/50 cursor-col-resize transition-all duration-100 shrink-0 ${isDragging ? 'w-1.5 bg-blue-500/70' : ''}`}
          title="Drag to resize"
        />
      )}

      {/* Right: Console */}
      {consoleOpen && (
        <div
          className="shrink-0 overflow-hidden border-l border-white/10"
          style={{ width: `${consoleWidth}px` }}
        >
          {right}
        </div>
      )}
    </div>
  )
}
