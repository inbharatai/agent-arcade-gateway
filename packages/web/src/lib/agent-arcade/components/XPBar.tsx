'use client'

/**
 * XP Bar -- animated experience bar for agents.
 * Shows level, title, progress to next level, and streak info.
 */

import React, { useEffect, useState, useRef } from 'react'
import type { AgentXP } from '../xp'

interface XPBarProps {
  xp: AgentXP
  compact?: boolean
}

const LEVEL_COLORS: Record<number, string> = {
  1: '#6b7280',  // Novice - gray
  2: '#22c55e',  // Apprentice - green
  3: '#3b82f6',  // Journeyman - blue
  4: '#8b5cf6',  // Adept - purple
  5: '#f59e0b',  // Expert - amber
  6: '#ef4444',  // Master - red
  7: '#ec4899',  // Grandmaster - pink
  8: '#f97316',  // Champion - orange
  9: '#14b8a6',  // Legend - teal
  10: '#ffd700', // Mythic - gold
  11: '#B9F2FF', // Transcendent - diamond
  12: '#ff00ff', // Godlike - magenta
}

export function XPBar({ xp, compact = false }: XPBarProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0)
  const [sparkle, setSparkle] = useState(false)
  const prevXP = useRef(xp.totalXP)

  useEffect(() => {
    // Animate the bar
    const timer = setTimeout(() => setAnimatedProgress(xp.xpProgress), 100)

    // Show sparkle on XP gain
    if (xp.totalXP > prevXP.current) {
      setSparkle(true)
      setTimeout(() => setSparkle(false), 1000)
    }
    prevXP.current = xp.totalXP

    return () => clearTimeout(timer)
  }, [xp.xpProgress, xp.totalXP])

  const levelColor = LEVEL_COLORS[xp.level] || '#fff'

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: '"Press Start 2P", monospace' }}>
        <span style={{ fontSize: 8, color: levelColor }}>Lv{xp.level}</span>
        <div style={{ flex: 1, background: '#111', borderRadius: 2, height: 4, minWidth: 60 }}>
          <div
            style={{
              background: `linear-gradient(90deg, ${levelColor}80, ${levelColor})`,
              height: '100%',
              width: `${animatedProgress * 100}%`,
              borderRadius: 2,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 7, color: '#666' }}>{xp.totalXP} XP</span>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#0d0d1a',
        border: `2px solid ${levelColor}40`,
        borderRadius: 8,
        padding: 12,
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Sparkle overlay */}
      {sparkle && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle, ${levelColor}20 0%, transparent 70%)`,
            animation: 'xpSparkle 1s ease-out forwards',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Level & Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 16, color: levelColor, textShadow: `0 0 10px ${levelColor}` }}>
            {xp.level}
          </span>
          <span style={{ fontSize: 9, color: '#fff' }}>{xp.levelTitle}</span>
        </div>
        <span style={{ fontSize: 8, color: '#888' }}>{xp.agentName}</span>
      </div>

      {/* XP Bar */}
      <div style={{ background: '#111', borderRadius: 4, height: 8, marginBottom: 6, overflow: 'hidden' }}>
        <div
          style={{
            background: `linear-gradient(90deg, ${levelColor}60, ${levelColor})`,
            height: '100%',
            width: `${animatedProgress * 100}%`,
            borderRadius: 4,
            transition: 'width 0.5s ease',
            boxShadow: `0 0 8px ${levelColor}60`,
          }}
        />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7 }}>
        <span style={{ color: '#ffd700' }}>{xp.totalXP.toLocaleString()} XP</span>
        <span style={{ color: '#555' }}>
          {xp.xpToNextLevel > 0 ? `${xp.xpToNextLevel.toLocaleString()} to next` : 'MAX LEVEL'}
        </span>
        {xp.streakDays > 1 && (
          <span style={{ color: '#f59e0b' }}>
            {xp.streakDays}d streak ({xp.streakMultiplier.toFixed(1)}x)
          </span>
        )}
      </div>

      <style>{`
        @keyframes xpSparkle {
          0% { opacity: 0.8; transform: scale(0.8); }
          100% { opacity: 0; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}

export default XPBar
