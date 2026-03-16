'use client'

import { useState } from 'react'
import type { GoalState } from '@/lib/goal-engine/types'

interface GoalControlsProps {
  goal: GoalState
  onPauseAll: () => void
  onResumeAll: () => void
  onStopAll: () => void
  onUndoPhase: (phaseIndex: number) => void
  onCollapseSingle: () => void
}

export function GoalControls({
  goal,
  onPauseAll,
  onResumeAll,
  onStopAll,
  onUndoPhase,
  onCollapseSingle,
}: GoalControlsProps) {
  const [confirmStop, setConfirmStop] = useState(false)

  const isPaused = goal.status === 'paused'
  const isRunning = goal.status === 'executing'

  const handleStopAll = () => {
    if (!confirmStop) {
      setConfirmStop(true)
      return
    }
    onStopAll()
    setConfirmStop(false)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 rounded-xl bg-white/3 border border-white/8">
      {/* Pause / Resume */}
      {isRunning && (
        <button
          onClick={onPauseAll}
          className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400 hover:bg-yellow-500/20 transition-colors"
        >
          ⏸ Pause All
        </button>
      )}
      {isPaused && (
        <button
          onClick={onResumeAll}
          className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400 hover:bg-green-500/20 transition-colors"
        >
          ▶ Resume All
        </button>
      )}

      {/* Stop All with confirmation */}
      {(isRunning || isPaused) && (
        confirmStop ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-red-400/80">
              Stop all agents? Completed work will be saved. Incomplete tasks will be marked failed.
            </span>
            <button
              onClick={handleStopAll}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-xs text-white font-medium hover:bg-red-500 transition-colors"
            >
              Confirm Stop
            </button>
            <button
              onClick={() => setConfirmStop(false)}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleStopAll}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
          >
            ⏹ Stop All
          </button>
        )
      )}

      {/* Undo last phase */}
      {goal.currentPhase > 0 && (
        <button
          onClick={() => onUndoPhase(goal.currentPhase - 1)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          ↩ Undo Phase {goal.currentPhase}
        </button>
      )}

      {/* Collapse to single agent */}
      <button
        onClick={onCollapseSingle}
        className="ml-auto px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
      >
        Switch to Single Agent Mode
      </button>
    </div>
  )
}
