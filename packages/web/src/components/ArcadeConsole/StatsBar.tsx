'use client'

import { useState, useEffect } from 'react'

interface StatsBarProps {
  modelName: string
  messageCount: number
  totalTokens: number
  sessionCost: number
  sessionStart: number
  connectedAgents: number
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function StatsBar({ modelName, messageCount, totalTokens, sessionCost, sessionStart, connectedAgents }: StatsBarProps) {
  const [now, setNow] = useState(sessionStart)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const duration = formatDuration(now - sessionStart)

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-black/20 border-b border-white/10 text-xs font-mono overflow-x-auto shrink-0">
      <span className="text-blue-400 font-semibold shrink-0">⚡ {modelName}</span>
      <span className="text-white/50">|</span>
      <span className="text-white/70 shrink-0">💬 {messageCount} msgs</span>
      <span className="text-white/50">|</span>
      <span className="text-white/70 shrink-0">🔤 {totalTokens.toLocaleString()} tokens</span>
      <span className="text-white/50">|</span>
      <span className="text-green-400 shrink-0">💰 ${sessionCost.toFixed(4)}</span>
      <span className="text-white/50">|</span>
      <span className="text-white/70 shrink-0">⏱ {duration}</span>
      <span className="text-white/50">|</span>
      <span className="text-purple-400 shrink-0">🤖 {connectedAgents} agents</span>
    </div>
  )
}
