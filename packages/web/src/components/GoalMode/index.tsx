'use client'

import { useState, useReducer, useCallback, useEffect, useRef } from 'react'
import { io as socketIO, Socket } from 'socket.io-client'
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
  error: string | null
}

type GoalAction =
  | { type: 'START_PLANNING' }
  | { type: 'SET_PLAN'; taskTree: TaskTree }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'APPROVE_PLAN'; goal: GoalState }
  | { type: 'UPDATE_GOAL'; goal: GoalState }
  | { type: 'ENTER_PHASE_REVIEW'; phaseIndex: number }
  | { type: 'APPROVE_PHASE' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }

function goalReducer(state: GoalModeState, action: GoalAction): GoalModeState {
  switch (action.type) {
    case 'START_PLANNING':
      return { ...state, phase: 'planning', error: null }
    case 'SET_PLAN':
      return { ...state, phase: 'review', taskTree: action.taskTree, error: null }
    case 'SET_ERROR':
      return { ...state, phase: 'idle', error: action.error }
    case 'APPROVE_PLAN':
      return { ...state, phase: 'executing', goal: action.goal, error: null }
    case 'UPDATE_GOAL': {
      const updatedGoal = action.goal
      // Auto-detect phase completion → trigger phase review
      const currentPhaseData = updatedGoal.phases?.[updatedGoal.currentPhase]
      const phaseComplete =
        currentPhaseData &&
        currentPhaseData.taskIds.every(id => {
          const t = updatedGoal.tasks[id]
          return t?.status === 'complete' || t?.status === 'skipped'
        })
      const allComplete = updatedGoal.status === 'complete'

      if (allComplete) return { ...state, phase: 'complete', goal: updatedGoal }
      if (phaseComplete && state.phase === 'executing' && !updatedGoal.approvedPhases.includes(updatedGoal.currentPhase)) {
        return { ...state, phase: 'phase-review', currentReviewPhase: updatedGoal.currentPhase, goal: updatedGoal }
      }
      return { ...state, goal: updatedGoal }
    }
    case 'ENTER_PHASE_REVIEW':
      return { ...state, phase: 'phase-review', currentReviewPhase: action.phaseIndex }
    case 'APPROVE_PHASE':
      return { ...state, phase: 'executing' }
    case 'COMPLETE':
      return { ...state, phase: 'complete' }
    case 'CANCEL':
      return { phase: 'idle', taskTree: null, goal: null, currentReviewPhase: 0, error: null }
    default:
      return state
  }
}

const initialState: GoalModeState = {
  phase: 'idle',
  taskTree: null,
  goal: null,
  currentReviewPhase: 0,
  error: null,
}

const POLL_INTERVAL_MS = 3000 // Poll gateway every 3s while executing

export function GoalMode({ sessionId, gatewayUrl }: GoalModeProps) {
  const [state, dispatch] = useReducer(goalReducer, initialState)
  const [isDecomposing, setIsDecomposing] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Socket.IO: subscribe to goal events from gateway ──────────────────────
  useEffect(() => {
    if (!gatewayUrl) return

    const socket = socketIO(gatewayUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })
    socketRef.current = socket

    socket.emit('join', `session:${sessionId}`)

    socket.on('goal.started', ({ goal }: { goal: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })
    socket.on('goal.paused', ({ goal }: { goal: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })
    socket.on('goal.resumed', ({ goal }: { goal: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })
    socket.on('goal.stopped', ({ goal }: { goal: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })
    socket.on('goal.phase.approved', ({ goal }: { goal: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })
    socket.on('goal.task.updated', ({ goal }: { goal?: GoalState }) => {
      if (goal) dispatch({ type: 'UPDATE_GOAL', goal })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [gatewayUrl, sessionId])

  // ── Polling: refresh goal status from gateway while executing / paused ────
  useEffect(() => {
    const isActive = state.phase === 'executing' || state.phase === 'phase-review'
    const goalId = state.goal?.id

    if (!isActive || !goalId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const gwRes = await fetch(`${gatewayUrl}/v1/goals/${goalId}/status`)
        if (gwRes.ok) {
          const goal: GoalState = await gwRes.json()
          dispatch({ type: 'UPDATE_GOAL', goal })
        }
      } catch { /* ignore network errors during polling */ }
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [state.phase, state.goal?.id, gatewayUrl, sessionId])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDecompose = useCallback(async (goalText: string) => {
    setIsDecomposing(true)
    dispatch({ type: 'START_PLANNING' })

    try {
      const res = await fetch(`/api/goal/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goalText, sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        dispatch({ type: 'SET_ERROR', error: data.error ?? 'Decomposition failed' })
        return
      }
      dispatch({ type: 'SET_PLAN', taskTree: data.taskTree })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Network error during decomposition' })
    } finally {
      setIsDecomposing(false)
    }
  }, [sessionId])

  const handleApprovePlan = useCallback(async () => {
    if (!state.taskTree) return
    try {
      const res = await fetch(`/api/goal/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTree: state.taskTree, sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        dispatch({ type: 'SET_ERROR', error: data.error ?? 'Failed to start execution' })
        return
      }
      dispatch({ type: 'APPROVE_PLAN', goal: data.goal })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Network error starting execution' })
    }
  }, [sessionId, state.taskTree])

  const handleEditPlan = useCallback((tree: TaskTree) => {
    dispatch({ type: 'SET_PLAN', taskTree: tree })
  }, [])

  const handleCancel = useCallback(() => {
    dispatch({ type: 'CANCEL' })
  }, [])

  const sendGoalAction = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    if (!state.goal) return
    try {
      const res = await fetch(`/api/goal/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: state.goal.id, sessionId, action, ...payload }),
      })
      const data = await res.json()
      if (data.goal) dispatch({ type: 'UPDATE_GOAL', goal: data.goal })
    } catch { /* silently handle network errors */ }
  }, [sessionId, state.goal])

  const handlePauseAll     = useCallback(() => sendGoalAction('pause-all'), [sendGoalAction])
  const handleResumeAll    = useCallback(() => sendGoalAction('resume-all'), [sendGoalAction])
  const handleStopAll      = useCallback(() => sendGoalAction('stop-all'), [sendGoalAction])
  const handleUndoPhase    = useCallback((phaseIndex: number) => sendGoalAction('undo-phase', { phaseIndex }), [sendGoalAction])
  const handleCollapseSingle = useCallback(() => sendGoalAction('collapse-single'), [sendGoalAction])

  const handleTaskAction = useCallback((taskId: string, action: string, args?: Record<string, unknown>) => {
    sendGoalAction('task-action', { taskId, taskAction: action, ...args })
  }, [sendGoalAction])

  const handleApprovePhase = useCallback(() => {
    sendGoalAction('approve-phase', { phaseIndex: state.currentReviewPhase })
    dispatch({ type: 'APPROVE_PHASE' })
  }, [sendGoalAction, state.currentReviewPhase])

  const handleRequestChanges = useCallback((taskId: string, note: string) => {
    sendGoalAction('request-changes', { taskId, note })
  }, [sendGoalAction])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Error banner */}
      {state.error && (
        <div style={{ background: '#2d0a0a', border: '1px solid #ef4444', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
          ⚠ {state.error}
          <button
            onClick={() => dispatch({ type: 'CANCEL' })}
            style={{ float: 'right', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}

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
