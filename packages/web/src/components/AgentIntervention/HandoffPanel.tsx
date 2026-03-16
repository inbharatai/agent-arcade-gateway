'use client'

import { useState } from 'react'

interface HandoffPanelProps {
  agentId: string
  availableAgents: string[]
  onHandoff: (targetAgentId: string, note?: string) => void
}

export function HandoffPanel({ agentId, availableAgents, onHandoff }: HandoffPanelProps) {
  const [targetAgent, setTargetAgent] = useState('')
  const [note, setNote] = useState('')

  const others = availableAgents.filter(a => a !== agentId)
  if (others.length === 0) return null

  return (
    <div className="px-3 py-2 border-t border-white/5">
      <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
        🤝 Hand Off To
      </div>
      <div className="flex items-center gap-2">
        <select
          value={targetAgent}
          onChange={e => setTargetAgent(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 focus:outline-none focus:border-blue-500/50"
        >
          <option value="">Select agent…</option>
          {others.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <button
          onClick={() => { if (targetAgent) { onHandoff(targetAgent, note || undefined); setTargetAgent(''); setNote('') } }}
          disabled={!targetAgent}
          className="px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-xs font-medium transition-colors disabled:opacity-40"
        >
          Hand Off →
        </button>
      </div>
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional handoff note…"
        className="mt-2 w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs placeholder-white/25 focus:outline-none focus:border-blue-500/50"
      />
    </div>
  )
}
