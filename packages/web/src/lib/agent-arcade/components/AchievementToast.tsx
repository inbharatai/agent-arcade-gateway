'use client'

/**
 * Achievement Toast -- animated popup when an achievement unlocks.
 * Shows icon, name, description, and tier-colored border.
 * Auto-dismisses after 5 seconds.
 */

import React, { useEffect, useState } from 'react'
import type { Achievement, AchievementTier } from '../achievements'
import { TIER_COLORS } from '../achievements'

interface AchievementToastProps {
  achievement: Achievement | null
  onDismiss: () => void
}

const TIER_LABELS: Record<AchievementTier, string> = {
  bronze: 'BRONZE',
  silver: 'SILVER',
  gold: 'GOLD',
  diamond: 'DIAMOND',
}

export function AchievementToast({ achievement, onDismiss }: AchievementToastProps) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (achievement) {
      setVisible(true)
      setExiting(false)

      const timer = setTimeout(() => {
        setExiting(true)
        setTimeout(() => {
          setVisible(false)
          onDismiss()
        }, 400)
      }, 5000)

      return () => clearTimeout(timer)
    }
  }, [achievement, onDismiss])

  if (!visible || !achievement) return null

  const tierColor = TIER_COLORS[achievement.tier]

  return (
    <div
      style={{
        position: 'fixed',
        top: 24,
        right: 24,
        zIndex: 9999,
        animation: exiting ? 'slideOut 0.4s ease-in forwards' : 'slideIn 0.4s ease-out forwards',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          border: `3px solid ${tierColor}`,
          borderRadius: 8,
          padding: '16px 20px',
          minWidth: 320,
          maxWidth: 400,
          boxShadow: `0 0 20px ${tierColor}40, 0 8px 32px rgba(0,0,0,0.5)`,
          fontFamily: '"Press Start 2P", "Courier New", monospace',
          imageRendering: 'pixelated' as any,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: tierColor, letterSpacing: 2 }}>
            {TIER_LABELS[achievement.tier]} ACHIEVEMENT UNLOCKED
          </span>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              fontSize: 32,
              width: 48,
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `${tierColor}20`,
              borderRadius: 4,
              border: `2px solid ${tierColor}60`,
              flexShrink: 0,
            }}
          >
            {achievement.icon}
          </div>

          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 12,
                color: '#fff',
                marginBottom: 4,
                textShadow: `0 0 8px ${tierColor}`,
              }}
            >
              {achievement.name}
            </div>
            <div style={{ fontSize: 9, color: '#8892b0', lineHeight: 1.4 }}>
              {achievement.description}
            </div>
          </div>
        </div>

        {/* XP Reward */}
        <div
          style={{
            marginTop: 8,
            fontSize: 9,
            color: '#ffd700',
            textAlign: 'right',
          }}
        >
          +{achievement.tier === 'diamond' ? '2500' : achievement.tier === 'gold' ? '1000' : achievement.tier === 'silver' ? '500' : '200'} XP
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(120%); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export default AchievementToast
