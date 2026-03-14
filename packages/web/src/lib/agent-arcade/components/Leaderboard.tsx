'use client'

/**
 * Leaderboard -- sortable ranking table for agents.
 * Top 3 get crown icons. Category tabs for different ranking modes.
 */

import React, { useState, useMemo } from 'react'
import type { LeaderboardEntry, LeaderboardCategory } from '../xp/leaderboard'

interface LeaderboardProps {
  entries: LeaderboardEntry[]
  onCategoryChange?: (category: LeaderboardCategory) => void
  onClose?: () => void
}

const CATEGORIES: { key: LeaderboardCategory; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'speed', label: 'Speed' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'tooling', label: 'Tools' },
  { key: 'endurance', label: 'Endurance' },
]

const RANK_ICONS = ['', '\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'] // gold, silver, bronze medals
const RANK_COLORS = ['', '#FFD700', '#C0C0C0', '#CD7F32']

function formatSpeed(ms: number): string {
  if (ms === 0) return '--'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

export function Leaderboard({ entries, onCategoryChange, onClose }: LeaderboardProps) {
  const [category, setCategory] = useState<LeaderboardCategory>('overall')
  const [sortColumn, setSortColumn] = useState<string>('rank')
  const [sortAsc, setSortAsc] = useState(true)

  const handleCategoryChange = (cat: LeaderboardCategory) => {
    setCategory(cat)
    onCategoryChange?.(cat)
  }

  const sorted = useMemo(() => {
    if (sortColumn === 'rank') return entries
    const items = [...entries]
    items.sort((a, b) => {
      let va: number, vb: number
      switch (sortColumn) {
        case 'xp': va = a.totalXP; vb = b.totalXP; break
        case 'level': va = a.level; vb = b.level; break
        case 'tasks': va = a.tasksCompleted; vb = b.tasksCompleted; break
        case 'speed': va = a.avgSpeed; vb = b.avgSpeed; break
        case 'errors': va = a.errorRate; vb = b.errorRate; break
        case 'tools': va = a.toolsUsed; vb = b.toolsUsed; break
        case 'streak': va = a.bestStreak; vb = b.bestStreak; break
        default: return 0
      }
      return sortAsc ? va - vb : vb - va
    })
    return items
  }, [entries, sortColumn, sortAsc])

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortColumn(col)
      setSortAsc(col === 'speed' || col === 'errors') // lower is better for these
    }
  }

  const headerStyle = (col: string): React.CSSProperties => ({
    fontSize: 7,
    color: sortColumn === col ? '#fff' : '#666',
    cursor: 'pointer',
    padding: '6px 8px',
    textAlign: 'right' as const,
    borderBottom: '1px solid #222',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  })

  const cellStyle: React.CSSProperties = {
    fontSize: 8,
    padding: '6px 8px',
    textAlign: 'right',
    borderBottom: '1px solid #111',
  }

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
        <h2 style={{ fontSize: 14, margin: 0, color: '#ffd700' }}>Leaderboard</h2>
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
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => handleCategoryChange(cat.key)}
            style={{
              background: category === cat.key ? '#2a2a4a' : 'transparent',
              border: `1px solid ${category === cat.key ? '#4a4a8a' : '#333'}`,
              borderRadius: 4,
              color: category === cat.key ? '#fff' : '#666',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 8,
              fontFamily: 'inherit',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#444', fontSize: 9 }}>
          No agents on the board yet. Start a session to see rankings!
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...headerStyle('rank'), textAlign: 'center' }} onClick={() => handleSort('rank')}>#</th>
              <th style={{ ...headerStyle('name'), textAlign: 'left' }}>Agent</th>
              <th style={headerStyle('xp')} onClick={() => handleSort('xp')}>XP</th>
              <th style={headerStyle('level')} onClick={() => handleSort('level')}>Level</th>
              <th style={headerStyle('tasks')} onClick={() => handleSort('tasks')}>Tasks</th>
              <th style={headerStyle('speed')} onClick={() => handleSort('speed')}>Avg Speed</th>
              <th style={headerStyle('errors')} onClick={() => handleSort('errors')}>Error Rate</th>
              <th style={headerStyle('tools')} onClick={() => handleSort('tools')}>Tools</th>
              <th style={headerStyle('streak')} onClick={() => handleSort('streak')}>Streak</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => {
              const isTop3 = entry.rank <= 3
              return (
                <tr
                  key={entry.agentId}
                  style={{
                    background: isTop3 ? `${RANK_COLORS[entry.rank]}08` : 'transparent',
                  }}
                >
                  <td style={{ ...cellStyle, textAlign: 'center', color: RANK_COLORS[entry.rank] || '#555' }}>
                    {RANK_ICONS[entry.rank] || entry.rank}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'left', color: isTop3 ? '#fff' : '#aaa' }}>
                    {entry.agentName}
                    {entry.aiModel && (
                      <span style={{ fontSize: 6, color: '#555', marginLeft: 4 }}>
                        ({entry.aiModel})
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, color: '#ffd700' }}>{entry.totalXP.toLocaleString()}</td>
                  <td style={{ ...cellStyle, color: '#8b5cf6' }}>
                    {entry.level} <span style={{ fontSize: 6, color: '#555' }}>{entry.levelTitle}</span>
                  </td>
                  <td style={{ ...cellStyle, color: '#22c55e' }}>{entry.tasksCompleted}</td>
                  <td style={{ ...cellStyle, color: '#3b82f6' }}>{formatSpeed(entry.avgSpeed)}</td>
                  <td style={{ ...cellStyle, color: entry.errorRate > 0.1 ? '#ef4444' : '#22c55e' }}>
                    {formatRate(entry.errorRate)}
                  </td>
                  <td style={{ ...cellStyle, color: '#06b6d4' }}>{entry.toolsUsed}</td>
                  <td style={{ ...cellStyle, color: '#f59e0b' }}>{entry.bestStreak}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default Leaderboard
