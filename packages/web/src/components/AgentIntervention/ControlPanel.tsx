'use client'

import { useState, useCallback } from 'react'
import { Controls } from './Controls'
import { ActionHistory } from './ActionHistory'
import { RedirectPanel } from './RedirectPanel'
import { HandoffPanel } from './HandoffPanel'
import type { AgentControlState } from '@/hooks/useAgentIntervention'

interface Agent {
  id: string
  name: string
  state: string
  label?: string
  aiModel?: string
  task?: string
  spawnedAt?: number
}

interface ControlPanelProps {
  agent: Agent
  controlState: AgentControlState | null
  allAgents: Agent[]
  onClose: () => void
  onPause: (agentId: string) => void
  onResume: (agentId: string) => void
  onStop: (agentId: string) => void
  onRedirect: (agentId: string, instruction: string) => void
  onHandoff: (fromAgentId: string, toAgentId: string, note?: string) => void
}

const STATE_ICONS: Record<string, string> = {
  idle: '😴', thinking: '🤔', reading: '📖', writing: '✍️',
  tool: '⚙️', waiting: '⏳', moving: '🏃', error: '❌', done: '✅',
}

const STATE_COLORS: Record<string, string> = {
  idle: 'text-gray-400', thinking: 'text-blue-400', reading: 'text-cyan-400',
  writing: 'text-green-400', tool: 'text-yellow-400', waiting: 'text-orange-400',
  moving: 'text-purple-400', error: 'text-red-400', done: 'text-emerald-400',
}

function formatDuration(spawnedAt?: number): string {
  if (!spawnedAt) return '—'
  const s = Math.floor((Date.now() - spawnedAt) / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function ControlPanel({
  agent,
  controlState,
  allAgents,
  onClose,
  onPause,
  onResume,
  onStop,
  onRedirect,
  onHandoff,
}: ControlPanelProps) {
  const [expanded, setExpanded] = useState(true)

  const handlePause = useCallback(() => onPause(agent.id), [agent.id, onPause])
  const handleResume = useCallback(() => onResume(agent.id), [agent.id, onResume])
  const handleStop = useCallback(() => onStop(agent.id), [agent.id, onStop])
  const handleRedirect = useCallback((instruction: string) => onRedirect(agent.id, instruction), [agent.id, onRedirect])
  const handleHandoff = useCallback((toId: string, note?: string) => onHandoff(agent.id, toId, note), [agent.id, onHandoff])

  const isPaused = controlState?.isPaused || false
  const isStopped = controlState?.isStopped || false
  const actions = controlState?.actions || []
  const redirectHistory = controlState?.redirectHistory || []

  return (
    <div className="border border-white/10 rounded-xl bg-gray-900/95 backdrop-blur-sm shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{STATE_ICONS[agent.state] || '🤖'}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-white truncate">{agent.name || agent.id}</div>
            <div className="flex items-center gap-2 text-xs">
              <span className={STATE_COLORS[agent.state] || 'text-white/50'}>
                {agent.label || agent.state}
              </span>
              {agent.aiModel && <span className="text-white/30">· {agent.aiModel}</span>}
              {agent.spawnedAt && <span className="text-white/30">· {formatDuration(agent.spawnedAt)}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded text-white/40 hover:text-white/70 transition-colors text-sm"
          >
            {expanded ? '▾' : '▸'}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-white/30 hover:text-white/60 transition-colors text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Task info */}
          {agent.task && (
            <div className="px-3 py-2 text-xs text-white/50 border-b border-white/5">
              <span className="text-white/30">Task: </span>
              <span className="italic">{agent.task.slice(0, 100)}</span>
            </div>
          )}

          {/* Controls */}
          <Controls
            agentId={agent.id}
            isPaused={isPaused}
            isStopped={isStopped}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
          />

          {/* Action history */}
          <ActionHistory actions={actions} agentId={agent.id} />

          {/* Redirect */}
          {!isStopped && (
            <RedirectPanel
              agentId={agent.id}
              onRedirect={handleRedirect}
              redirectHistory={redirectHistory}
            />
          )}

          {/* Handoff */}
          {!isStopped && (
            <HandoffPanel
              agentId={agent.id}
              availableAgents={allAgents.map(a => a.id)}
              onHandoff={handleHandoff}
            />
          )}
        </>
      )}
    </div>
  )
}
