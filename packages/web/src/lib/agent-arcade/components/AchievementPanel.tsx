'use client'

/**
 * Achievement Panel -- grid display of all achievements with filters.
 * Locked achievements shown grayed out, unlocked ones in full color.
 */

import React, { useState, useMemo } from 'react'
import type { Achievement, AchievementCategory } from '../achievements'
import { TIER_COLORS, TIER_ORDER } from '../achievements'

interface AchievementPanelProps {
  achievements: Achievement[]
  onClose?: () => void
}

const CATEGORIES: { key: AchievementCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'speed', label: 'Speed' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'tooling', label: 'Tooling' },
  { key: 'endurance', label: 'Endurance' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'special', label: 'Special' },
]

type SortMode = 'tier' | 'category' | 'unlockDate' | 'progress'

export function AchievementPanel({ achievements, onClose }: AchievementPanelProps) {
  const [category, setCategory] = useState<AchievementCategory | 'all'>('all')
  const [sortMode, setSortMode] = useState<SortMode>('tier')

  const filtered = useMemo(() => {
    let items = [...achievements]

    if (category !== 'all') {
      items = items.filter(a => a.category === category)
    }

    switch (sortMode) {
      case 'tier':
        items.sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier])
        break
      case 'category':
        items.sort((a, b) => a.category.localeCompare(b.category))
        break
      case 'unlockDate':
        items.sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0))
        break
      case 'progress':
        items.sort((a, b) => b.progress - a.progress)
        break
    }

    return items
  }, [achievements, category, sortMode])

  const unlockedCount = achievements.filter(a => a.unlockedAt != null).length

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)',
        borderRadius: 12,
        padding: 20,
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        color: '#fff',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 14, margin: 0, color: '#ffd700' }}>Achievements</h2>
          <p style={{ fontSize: 9, color: '#8892b0', margin: '4px 0 0 0' }}>
            {unlockedCount} / {achievements.length} unlocked
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 4,
              color: '#888', cursor: 'pointer', padding: '4px 8px', fontSize: 10,
            }}
          >
            X
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            style={{
              background: category === cat.key ? '#2a2a4a' : 'transparent',
              border: `1px solid ${category === cat.key ? '#4a4a8a' : '#333'}`,
              borderRadius: 4,
              color: category === cat.key ? '#fff' : '#666',
              cursor: 'pointer',
              padding: '4px 8px',
              fontSize: 8,
              fontFamily: 'inherit',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: '#666' }}>Sort:</span>
        {(['tier', 'progress', 'unlockDate', 'category'] as SortMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setSortMode(mode)}
            style={{
              background: sortMode === mode ? '#1a1a3a' : 'transparent',
              border: `1px solid ${sortMode === mode ? '#333' : '#222'}`,
              borderRadius: 3,
              color: sortMode === mode ? '#aaa' : '#555',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: 7,
              fontFamily: 'inherit',
            }}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Achievement Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {filtered.map(a => (
          <AchievementCard key={a.id} achievement={a} />
        ))}
      </div>
    </div>
  )
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const unlocked = achievement.unlockedAt != null
  const tierColor = TIER_COLORS[achievement.tier]

  return (
    <div
      style={{
        background: unlocked ? '#1a1a2e' : '#0d0d1a',
        border: `2px solid ${unlocked ? tierColor : '#222'}`,
        borderRadius: 6,
        padding: 12,
        opacity: unlocked ? 1 : 0.6,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            fontSize: 24,
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: unlocked ? `${tierColor}15` : '#111',
            borderRadius: 4,
            border: `1px solid ${unlocked ? `${tierColor}40` : '#222'}`,
            filter: unlocked ? 'none' : 'grayscale(1)',
          }}
        >
          {unlocked ? achievement.icon : '?'}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: unlocked ? '#fff' : '#555', marginBottom: 2 }}>
            {achievement.name}
          </div>
          <div style={{ fontSize: 7, color: '#666', lineHeight: 1.3 }}>
            {achievement.description}
          </div>
        </div>

        <div
          style={{
            fontSize: 7,
            color: tierColor,
            textTransform: 'uppercase',
            letterSpacing: 1,
            opacity: unlocked ? 1 : 0.5,
          }}
        >
          {achievement.tier}
        </div>
      </div>

      {/* Progress bar */}
      {!unlocked && achievement.progress > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 7, color: '#555' }}>
              {achievement.current} / {achievement.target}
            </span>
            <span style={{ fontSize: 7, color: '#555' }}>
              {Math.round(achievement.progress * 100)}%
            </span>
          </div>
          <div style={{ background: '#111', borderRadius: 2, height: 4, overflow: 'hidden' }}>
            <div
              style={{
                background: `linear-gradient(90deg, ${tierColor}80, ${tierColor})`,
                height: '100%',
                width: `${achievement.progress * 100}%`,
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Unlock date */}
      {unlocked && achievement.unlockedAt && (
        <div style={{ marginTop: 6, fontSize: 7, color: '#444' }}>
          Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}

export default AchievementPanel
