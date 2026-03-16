'use client'

import { useState, useEffect } from 'react'
import type { GoalState, TaskExecution } from '@/lib/goal-engine/types'

interface TaskReviewProps {
  goal: GoalState
  phaseIndex: number
  onApprovePhase: () => void
  onRequestChanges: (taskId: string, note: string) => void
  isFinal?: boolean
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export function TaskReview({ goal, phaseIndex, onApprovePhase, onRequestChanges, isFinal }: TaskReviewProps) {
  const [changeNotes, setChangeNotes] = useState<Record<string, string>>({})
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (goal.completedAt) return // no need to tick if already complete
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [goal.completedAt])

  const phase = goal.phases[phaseIndex]
  const phaseTasks = phase ? phase.taskIds.map(id => goal.tasks[id]).filter(Boolean) : []
  const allTasks = Object.values(goal.tasks)

  const totalElapsed = goal.startedAt && goal.completedAt
    ? goal.completedAt - goal.startedAt
    : goal.startedAt
      ? now - goal.startedAt
      : 0

  const totalFilesCreated = allTasks.reduce((sum, t) => sum + (t.filesCreated?.length || 0), 0)

  const handleRequestChanges = (taskId: string) => {
    const note = changeNotes[taskId]?.trim()
    if (!note) return
    onRequestChanges(taskId, note)
    setChangeNotes(prev => ({ ...prev, [taskId]: '' }))
  }

  if (isFinal) {
    return (
      <div className="space-y-5">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">Goal Complete</h3>
          <p className="text-xs text-white/50">{goal.taskTree.goal}</p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Total Time', value: formatDuration(totalElapsed) },
            { label: 'Total Cost', value: `$${goal.totalCost.toFixed(4)}` },
            { label: 'Files Created', value: String(totalFilesCreated) },
            { label: 'Tasks', value: `${allTasks.filter(t => t.status === 'complete').length}/${allTasks.length}` },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-center">
              <p className="text-[10px] text-white/40">{stat.label}</p>
              <p className="text-sm font-mono text-white/80">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* All task summaries */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold tracking-widest uppercase text-white/40">Task Summaries</h4>
          {allTasks.map(task => (
            <TaskSummaryRow key={task.id} task={task} />
          ))}
        </div>

        {/* Final warning */}
        <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-yellow-400">Goal complete — but please verify:</p>
          <ul className="text-[11px] text-yellow-300/70 space-y-1 list-disc list-inside">
            <li>Test the code in your environment</li>
            <li>Review security-critical sections</li>
            <li>Do not deploy without your own testing</li>
          </ul>
        </div>

        {/* Final buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {/* export report */}}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:text-white/90 hover:bg-white/8 transition-colors"
          >
            📋 Export Report
          </button>
          <button
            onClick={() => onRequestChanges('__all__', 'Make changes')}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:text-white/90 hover:bg-white/8 transition-colors"
          >
            🔄 Make Changes
          </button>
          <button
            onClick={onApprovePhase}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
          >
            ✅ Accept &amp; Close
          </button>
        </div>
      </div>
    )
  }

  // Phase review
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-white">Phase {phaseIndex + 1} Review</h3>
        <p className="text-xs text-white/50">{goal.taskTree.goal}</p>
      </div>

      {/* Warning */}
      <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-2.5">
        <p className="text-[11px] text-blue-300/80">
          Review these files before Phase {phaseIndex + 2} begins.
        </p>
      </div>

      {/* Completed tasks in this phase */}
      <div className="space-y-3">
        {phaseTasks.map(task => (
          <div key={task.id} className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">{task.status === 'complete' ? '✅' : '❌'}</span>
                <span className="text-xs font-medium text-white">{task.title}</span>
              </div>
              <button
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
              >
                {expandedTask === task.id ? 'Collapse' : 'Details'}
              </button>
            </div>

            {expandedTask === task.id && (
              <div className="space-y-2 pt-1">
                {task.output && (
                  <p className="text-[11px] text-white/50">{task.output}</p>
                )}
                {task.filesCreated && task.filesCreated.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-white/30 font-semibold">Files created:</p>
                    {task.filesCreated.map(f => (
                      <p key={f} className="text-[11px] font-mono text-violet-300/70 pl-2">{f}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Request changes input */}
            <div className="flex items-center gap-2">
              <input
                value={changeNotes[task.id] || ''}
                onChange={e => setChangeNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                placeholder="Describe changes needed..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
              />
              <button
                onClick={() => handleRequestChanges(task.id)}
                disabled={!changeNotes[task.id]?.trim()}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white/50 hover:text-white/80 transition-colors disabled:opacity-30"
              >
                🔀 Request Changes
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onApprovePhase}
          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
        >
          ✅ Approve Phase {phaseIndex + 1}
        </button>
      </div>
    </div>
  )
}

/* ─── Task Summary Row ─────────────────────────────────────── */

function TaskSummaryRow({ task }: { task: TaskExecution }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 border border-white/5">
      <span className="text-sm">{task.status === 'complete' ? '✅' : task.status === 'failed' ? '❌' : '⏭️'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/70 truncate">{task.title}</p>
        {task.filesCreated && task.filesCreated.length > 0 && (
          <p className="text-[10px] text-white/30">{task.filesCreated.length} file(s)</p>
        )}
      </div>
      <span className="text-[10px] text-white/30 font-mono shrink-0">${task.cost.toFixed(4)}</span>
    </div>
  )
}
