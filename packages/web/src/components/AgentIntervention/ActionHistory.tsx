'use client'

import type { AgentAction } from '@/hooks/useAgentIntervention'

interface ActionHistoryProps {
  actions: AgentAction[]
  agentId: string
}

const TYPE_ICONS: Record<AgentAction['type'], string> = {
  file_create: '📁',
  file_edit: '✏️',
  tool_call: '⚙️',
  message: '💬',
  state_change: '🔄',
  redirect: '🔀',
  handoff: '🤝',
}

const TYPE_COLORS: Record<AgentAction['type'], string> = {
  file_create: 'text-green-400',
  file_edit: 'text-blue-400',
  tool_call: 'text-yellow-400',
  message: 'text-white/60',
  state_change: 'text-purple-400',
  redirect: 'text-orange-400',
  handoff: 'text-pink-400',
}

function formatTime(ts: number): string {
  const elapsed = Date.now() - ts
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s ago`
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ActionHistory({ actions, agentId }: ActionHistoryProps) {
  if (actions.length === 0) {
    return (
      <div className="text-xs text-white/30 text-center py-4 px-3">
        No actions recorded yet for {agentId}
      </div>
    )
  }

  return (
    <div className="space-y-1 px-3 py-2 overflow-y-auto max-h-48">
      <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Action History</div>
      {[...actions].reverse().map(action => (
        <div key={action.id} className="flex items-start gap-2 text-xs group">
          <span className="shrink-0 text-sm mt-0.5">{TYPE_ICONS[action.type]}</span>
          <div className="flex-1 min-w-0">
            <span className={`${TYPE_COLORS[action.type]}`}>{action.description}</span>
            {action.details && (
              <div className="text-white/30 truncate mt-0.5">{action.details}</div>
            )}
          </div>
          <div className="shrink-0 text-white/30 text-right">
            <div>{formatTime(action.timestamp)}</div>
            {action.tokens && <div>{action.tokens} tok</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
