'use client'

import { useState, useEffect } from 'react'
import type { GoalState, TaskExecution, TaskStatus } from '@/lib/goal-engine/types'

interface ExecutionGraphProps {
  goal: GoalState
  onPauseAll: () => void
  onResumeAll: () => void
  onStopAll: () => void
  onTaskAction: (taskId: string, action: string, args?: any) => void
}

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '⏳',
  queued: '📋',
  running: '🔄',
  paused: '⏸️',
  complete: '✅',
  failed: '❌',
  skipped: '⏭️',
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'border-white/10',
  queued: 'border-blue-500/30',
  running: 'border-violet-500/40',
  paused: 'border-yellow-500/30',
  complete: 'border-green-500/30',
  failed: 'border-red-500/30',
  skipped: 'border-white/10',
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function isStuck(task: TaskExecution, now: number, stuckMs = 180_000): boolean {
  if (task.status !== 'running' || !task.startedAt) return false
  return now - task.startedAt > stuckMs
}

export function ExecutionGraph({ goal, onPauseAll, onResumeAll, onStopAll, onTaskAction }: ExecutionGraphProps) {
  const [expandedLog, setExpandedLog] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const completedCount = Object.values(goal.tasks).filter(t => t.status === 'complete').length
  const totalCount = Object.keys(goal.tasks).length
  const elapsed = goal.startedAt ? now - goal.startedAt : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">{goal.taskTree.goal}</h3>
          <div className="flex items-center gap-4 text-[11px] text-white/40">
            <span>⏱ {formatElapsed(elapsed)}</span>
            <span>💰 ${goal.totalCost.toFixed(4)}</span>
            <span>📦 {completedCount}/{totalCount} tasks</span>
          </div>
        </div>

        {/* Global controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onPauseAll}
            className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400 hover:bg-yellow-500/20 transition-colors"
          >
            ⏸ PAUSE ALL
          </button>
          <button
            onClick={onResumeAll}
            className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400 hover:bg-green-500/20 transition-colors"
          >
            ▶ RESUME ALL
          </button>
          <button
            onClick={onStopAll}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
          >
            ⏹ STOP ALL
          </button>
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {goal.phases.map((phase, phaseIdx) => {
          const phaseTasks = phase.taskIds.map(id => goal.tasks[id]).filter(Boolean)
          const phaseStatus = phase.status === 'complete' ? '✅' : phase.status === 'running' ? '🔄' : '⏳'

          return (
            <div key={phase.index} className="space-y-2">
              <h4 className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-white/40">
                <span>{phaseStatus}</span>
                <span>Phase {phaseIdx + 1}</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {phaseTasks.map(task => (
                  <TaskExecutionCard
                    key={task.id}
                    task={task}
                    onAction={onTaskAction}
                    now={now}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Goal log */}
      <div className="rounded-xl bg-white/3 border border-white/8">
        <button
          onClick={() => setExpandedLog(!expandedLog)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-white/50 hover:text-white/70 transition-colors"
        >
          <span className="font-semibold">Goal Log</span>
          <span>{expandedLog ? '▾' : '▸'}</span>
        </button>
        {expandedLog && (
          <div className="px-4 pb-3 space-y-1 max-h-40 overflow-y-auto">
            {Object.values(goal.tasks)
              .filter(t => t.startedAt)
              .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
              .map(task => (
                <div key={task.id} className="flex items-center gap-2 text-[11px] text-white/40 font-mono">
                  <span className="text-white/25 shrink-0">
                    {task.startedAt ? new Date(task.startedAt).toLocaleTimeString() : '--'}
                  </span>
                  <span>{STATUS_ICON[task.status]}</span>
                  <span className="text-white/60 truncate">{task.title}</span>
                  {task.status === 'complete' && <span className="text-green-400/60">done</span>}
                  {task.status === 'failed' && <span className="text-red-400/60">{task.error || 'failed'}</span>}
                </div>
              ))}
            {Object.values(goal.tasks).filter(t => t.startedAt).length === 0 && (
              <p className="text-[11px] text-white/25 italic">No events yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Task Execution Card ──────────────────────────────────── */

function TaskExecutionCard({
  task,
  onAction,
  now,
}: {
  task: TaskExecution
  onAction: (taskId: string, action: string, args?: any) => void
  now: number
}) {
  const stuck = isStuck(task, now)
  const elapsed = task.startedAt ? now - task.startedAt : 0

  return (
    <div
      className={`rounded-xl bg-white/5 border p-3 space-y-2 transition-colors ${
        stuck ? 'border-yellow-500/50 bg-yellow-500/5' : STATUS_COLOR[task.status]
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{STATUS_ICON[task.status]}</span>
          <span className="text-xs font-medium text-white truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-white/30 shrink-0">
          <span>{formatElapsed(elapsed)}</span>
          <span>·</span>
          <span>${task.cost.toFixed(4)}</span>
        </div>
      </div>

      {/* Progress bar */}
      {task.status === 'running' && (
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(task.progress, 100)}%` }}
          />
        </div>
      )}

      {/* Live state text */}
      {task.status === 'running' && task.output && (
        <p className="text-[11px] text-violet-300/70 truncate">
          ✍️ {task.output}
        </p>
      )}

      {/* Stuck warning */}
      {stuck && (
        <p className="text-[10px] text-yellow-400/80 font-medium">
          ⚠️ Task may be stuck — running for {formatElapsed(elapsed)}
        </p>
      )}

      {/* Per-task controls */}
      {(task.status === 'running' || task.status === 'paused') && (
        <div className="flex items-center gap-2 pt-1">
          {task.status === 'running' && (
            <button
              onClick={() => onAction(task.id, 'pause')}
              className="text-[11px] text-yellow-400/60 hover:text-yellow-400 transition-colors"
            >
              ⏸
            </button>
          )}
          {task.status === 'paused' && (
            <button
              onClick={() => onAction(task.id, 'resume')}
              className="text-[11px] text-green-400/60 hover:text-green-400 transition-colors"
            >
              ▶
            </button>
          )}
          <button
            onClick={() => onAction(task.id, 'stop')}
            className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
          >
            ⏹
          </button>
          <button
            onClick={() => onAction(task.id, 'redirect')}
            className="text-[11px] text-blue-400/60 hover:text-blue-400 transition-colors"
          >
            🔀 Redirect
          </button>
        </div>
      )}
    </div>
  )
}
