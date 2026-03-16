'use client'

import { useState, useReducer, useCallback } from 'react'
import { GoalInput } from './GoalInput'
import { ExecutionPlan } from './ExecutionPlan'
import { ExecutionGraph } from './ExecutionGraph'
import { GoalControls } from './GoalControls'
import { TaskReview } from './TaskReview'
import type { GoalState, GoalStatus, TaskTree } from '@/lib/goal-engine/types'

interface GoalModeProps {
  sessionId: string
  gatewayUrl: string
}

type GoalPhaseUI = 'idle' | 'planning' | 'review' | 'executing' | 'phase-review' | 'complete'

interface GoalModeState {
  phase: GoalPhaseUI
  taskTree: TaskTree | null
  goal: GoalState | null
  currentReviewPhase: number
}

type GoalAction =
  | { type: 'START_PLANNING' }
  | { type: 'SET_PLAN'; taskTree: TaskTree }
  | { type: 'APPROVE_PLAN'; goal: GoalState }
  | { type: 'UPDATE_GOAL'; goal: GoalState }
  | { type: 'ENTER_PHASE_REVIEW'; phaseIndex: number }
  | { type: 'APPROVE_PHASE' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }

function goalReducer(state: GoalModeState, action: GoalAction): GoalModeState {
  switch (action.type) {
    case 'START_PLANNING':
      return { ...state, phase: 'planning' }
    case 'SET_PLAN':
      return { ...state, phase: 'review', taskTree: action.taskTree }
    case 'APPROVE_PLAN':
      return { ...state, phase: 'executing', goal: action.goal }
    case 'UPDATE_GOAL':
      return { ...state, goal: action.goal }
    case 'ENTER_PHASE_REVIEW':
      return { ...state, phase: 'phase-review', currentReviewPhase: action.phaseIndex }
    case 'APPROVE_PHASE':
      return { ...state, phase: 'executing' }
    case 'COMPLETE':
      return { ...state, phase: 'complete' }
    case 'CANCEL':
      return { phase: 'idle', taskTree: null, goal: null, currentReviewPhase: 0 }
    default:
      return state
  }
}

const initialState: GoalModeState = {
  phase: 'idle',
  taskTree: null,
  goal: null,
  currentReviewPhase: 0,
}

export function GoalMode({ sessionId, gatewayUrl }: GoalModeProps) {
  const [state, dispatch] = useReducer(goalReducer, initialState)
  const [isDecomposing, setIsDecomposing] = useState(false)

  const handleDecompose = useCallback(async (goalText: string) => {
    setIsDecomposing(true)
    dispatch({ type: 'START_PLANNING' })

    try {
      const res = await fetch(`${gatewayUrl}/api/goal/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goalText, sessionId }),
      })
      const data = await res.json()
      dispatch({ type: 'SET_PLAN', taskTree: data.taskTree })
    } catch {
      dispatch({ type: 'CANCEL' })
    } finally {
      setIsDecomposing(false)
    }
  }, [gatewayUrl, sessionId])

  const handleApprovePlan = useCallback(async () => {
    if (!state.taskTree) return
    try {
      const res = await fetch(`${gatewayUrl}/api/goal/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTree: state.taskTree, sessionId }),
      })
      const data = await res.json()
      dispatch({ type: 'APPROVE_PLAN', goal: data.goal })
    } catch {
      // keep in review state on error
    }
  }, [gatewayUrl, sessionId, state.taskTree])

  const handleEditPlan = useCallback((tree: TaskTree) => {
    dispatch({ type: 'SET_PLAN', taskTree: tree })
  }, [])

  const handleCancel = useCallback(() => {
    dispatch({ type: 'CANCEL' })
  }, [])

  const sendGoalAction = useCallback(async (action: string, payload?: any) => {
    if (!state.goal) return
    try {
      const res = await fetch(`${gatewayUrl}/api/goal/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: state.goal.id, sessionId, action, ...payload }),
      })
      const data = await res.json()
      if (data.goal) dispatch({ type: 'UPDATE_GOAL', goal: data.goal })
    } catch {
      // silently fail network errors
    }
  }, [gatewayUrl, sessionId, state.goal])

  const handlePauseAll = useCallback(() => sendGoalAction('pause-all'), [sendGoalAction])
  const handleResumeAll = useCallback(() => sendGoalAction('resume-all'), [sendGoalAction])
  const handleStopAll = useCallback(() => sendGoalAction('stop-all'), [sendGoalAction])
  const handleUndoPhase = useCallback((phaseIndex: number) => sendGoalAction('undo-phase', { phaseIndex }), [sendGoalAction])
  const handleCollapseSingle = useCallback(() => sendGoalAction('collapse-single'), [sendGoalAction])

  const handleTaskAction = useCallback((taskId: string, action: string, args?: any) => {
    sendGoalAction('task-action', { taskId, taskAction: action, args })
  }, [sendGoalAction])

  const handleApprovePhase = useCallback(() => {
    sendGoalAction('approve-phase', { phaseIndex: state.currentReviewPhase })
    dispatch({ type: 'APPROVE_PHASE' })
  }, [sendGoalAction, state.currentReviewPhase])

  const handleRequestChanges = useCallback((taskId: string, note: string) => {
    sendGoalAction('request-changes', { taskId, note })
  }, [sendGoalAction])

  return (
    <div className="space-y-4">
      {/* Goal Input — shown when idle or planning */}
      {(state.phase === 'idle' || state.phase === 'planning') && (
        <GoalInput onDecompose={handleDecompose} isDecomposing={isDecomposing} />
      )}

      {/* Execution Plan — shown when reviewing */}
      {state.phase === 'review' && state.taskTree && (
        <ExecutionPlan
          taskTree={state.taskTree}
          onApprove={handleApprovePlan}
          onCancel={handleCancel}
          onEdit={handleEditPlan}
        />
      )}

      {/* Execution Graph + Controls — shown when executing */}
      {state.phase === 'executing' && state.goal && (
        <>
          <GoalControls
            goal={state.goal}
            onPauseAll={handlePauseAll}
            onResumeAll={handleResumeAll}
            onStopAll={handleStopAll}
            onUndoPhase={handleUndoPhase}
            onCollapseSingle={handleCollapseSingle}
          />
          <ExecutionGraph
            goal={state.goal}
            onPauseAll={handlePauseAll}
            onResumeAll={handleResumeAll}
            onStopAll={handleStopAll}
            onTaskAction={handleTaskAction}
          />
        </>
      )}

      {/* Phase Review — shown at phase gates */}
      {state.phase === 'phase-review' && state.goal && (
        <>
          <GoalControls
            goal={state.goal}
            onPauseAll={handlePauseAll}
            onResumeAll={handleResumeAll}
            onStopAll={handleStopAll}
            onUndoPhase={handleUndoPhase}
            onCollapseSingle={handleCollapseSingle}
          />
          <TaskReview
            goal={state.goal}
            phaseIndex={state.currentReviewPhase}
            onApprovePhase={handleApprovePhase}
            onRequestChanges={handleRequestChanges}
          />
        </>
      )}

      {/* Final Review — shown when complete */}
      {state.phase === 'complete' && state.goal && (
        <TaskReview
          goal={state.goal}
          phaseIndex={state.goal.phases.length - 1}
          onApprovePhase={handleCancel}
          onRequestChanges={handleRequestChanges}
          isFinal
        />
      )}
    </div>
  )
}
