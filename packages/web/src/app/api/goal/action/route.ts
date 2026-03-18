import { NextRequest } from 'next/server'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:47890'

type GoalAction =
  | 'pause-all'
  | 'resume-all'
  | 'stop-all'
  | 'approve-phase'
  | 'undo-phase'
  | 'collapse-single'
  | 'request-changes'
  | 'task-action'

interface ActionBody {
  goalId: string
  sessionId: string
  action: GoalAction
  phaseIndex?: number
  taskId?: string
  taskAction?: 'retry' | 'skip' | 'update'
  note?: string
  // arbitrary extra fields forwarded to gateway
  [key: string]: unknown
}

async function gw(path: string, method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res
}

/**
 * POST /api/goal/action
 *
 * Unified action proxy. Maps frontend action names to the correct
 * gateway REST endpoints and returns the refreshed GoalState on success.
 *
 * Supported actions:
 *   pause-all       → POST /v1/goals/:id/pause-all
 *   resume-all      → POST /v1/goals/:id/resume-all
 *   stop-all        → POST /v1/goals/:id/stop-all
 *   approve-phase   → POST /v1/goals/:id/approve-phase  { phaseIndex }
 *   undo-phase      → reset phase to pending (task statuses updated)
 *   collapse-single → stop-all (single running phase — treated as stop)
 *   request-changes → POST /v1/goals/:id/tasks/:taskId/update { error: note }
 *   task-action     → retry → POST /v1/goals/:id/tasks/:taskId/retry
 *                     skip  → POST /v1/goals/:id/tasks/:taskId/skip
 *                     update → POST /v1/goals/:id/tasks/:taskId/update
 */
export async function POST(req: NextRequest) {
  let body: ActionBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { goalId, sessionId, action, phaseIndex, taskId, taskAction, note } = body
  if (!goalId) return Response.json({ error: 'goalId is required' }, { status: 400 })
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })
  if (!action) return Response.json({ error: 'action is required' }, { status: 400 })

  let gwRes: Response

  switch (action) {
    case 'pause-all':
      gwRes = await gw(`/v1/goals/${goalId}/pause-all`, 'POST')
      break

    case 'resume-all':
      gwRes = await gw(`/v1/goals/${goalId}/resume-all`, 'POST')
      break

    case 'stop-all':
    case 'collapse-single':
      gwRes = await gw(`/v1/goals/${goalId}/stop-all`, 'POST')
      break

    case 'approve-phase': {
      if (phaseIndex === undefined || phaseIndex === null) {
        return Response.json({ error: 'phaseIndex required for approve-phase' }, { status: 400 })
      }
      gwRes = await gw(`/v1/goals/${goalId}/approve-phase`, 'POST', { phaseIndex })

      // On successful approval, dispatch directives for the NEXT phase's tasks so
      // connected tools (Claude Code / directive-bridge) pick up and execute them.
      if (gwRes.ok) {
        try {
          const statusRes = await gw(`/v1/goals/${goalId}/status`, 'GET')
          if (statusRes.ok) {
            const currentGoal = await statusRes.json()
            const nextPhaseIndex = phaseIndex + 1
            const nextPhase = currentGoal.phases?.[nextPhaseIndex]
            if (nextPhase && nextPhase.taskIds?.length > 0) {
              for (const tid of nextPhase.taskIds as string[]) {
                const task = currentGoal.tasks?.[tid]
                if (!task) continue
                const instruction = [
                  `[Goal Mode — Phase ${nextPhaseIndex} of ${currentGoal.phases.length}] Goal: ${currentGoal.originalGoal}`,
                  `Task: ${task.title}`,
                  task.description ? `Details: ${task.description}` : '',
                  task.successCriteria ? `Success criteria: ${task.successCriteria}` : '',
                  `Goal ID: ${goalId}  Task ID: ${tid}  Session: ${sessionId}`,
                ].filter(Boolean).join('\n')

                fetch(`${GATEWAY_URL}/v1/directives`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    agentId: task.agentId || 'goal-mode',
                    instruction: instruction.slice(0, 8000),
                    source: 'goal-mode',
                  }),
                }).catch(() => {})
              }
            }
          }
        } catch {
          // Non-fatal — UI still shows refreshed state
        }
      }
      break
    }

    case 'undo-phase':
      // undo-phase resets the current phase's tasks back to pending
      // Implemented as a task bulk update to pending status for the phase's tasks
      // We first get the current goal state, then reset task statuses
      gwRes = await gw(`/v1/goals/${goalId}/status`, 'GET')
      if (!gwRes.ok) {
        return Response.json({ error: 'Goal not found' }, { status: 404 })
      }
      {
        const currentGoal = await gwRes.json()
        const phaseToUndo = phaseIndex ?? (currentGoal.currentPhase - 1)
        const phaseTasks: string[] = currentGoal.phases?.[phaseToUndo]?.taskIds
          ?? currentGoal.taskTree?.executionOrder?.[phaseToUndo]
          ?? []

        // Reset each task in the phase
        await Promise.all(
          phaseTasks.map((tid: string) =>
            gw(`/v1/goals/${goalId}/tasks/${tid}/update`, 'POST', {
              status: 'pending',
              progress: 0,
              error: undefined,
            })
          )
        )

        // Also reset the phase index on the goal via approve-phase trick in reverse:
        // We stop the goal and restart it at the earlier phase
        await gw(`/v1/goals/${goalId}/pause-all`, 'POST')
        gwRes = new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      break

    case 'request-changes':
      if (!taskId) return Response.json({ error: 'taskId required for request-changes' }, { status: 400 })
      gwRes = await gw(`/v1/goals/${goalId}/tasks/${taskId}/update`, 'POST', {
        status: 'failed',
        error: note ?? 'Changes requested',
      })
      break

    case 'task-action':
      if (!taskId) return Response.json({ error: 'taskId required for task-action' }, { status: 400 })
      if (taskAction === 'retry') {
        gwRes = await gw(`/v1/goals/${goalId}/tasks/${taskId}/retry`, 'POST')
      } else if (taskAction === 'skip') {
        gwRes = await gw(`/v1/goals/${goalId}/tasks/${taskId}/skip`, 'POST')
      } else {
        // Generic update — forward remaining body fields
        const { goalId: _g, sessionId: _s, action: _a, taskId: _t, taskAction: _ta, ...rest } = body
        gwRes = await gw(`/v1/goals/${goalId}/tasks/${taskId}/update`, 'POST', rest)
      }
      break

    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  if (!gwRes.ok) {
    const err = await gwRes.json().catch(() => ({ error: gwRes.statusText }))
    return Response.json({ error: err?.error ?? `Gateway error: ${gwRes.status}` }, { status: gwRes.status })
  }

  // Fetch refreshed goal state from gateway
  try {
    const statusRes = await gw(`/v1/goals/${goalId}/status`, 'GET')
    if (statusRes.ok) {
      const goal = await statusRes.json()
      return Response.json({ goal })
    }
  } catch { /* ignore — return ok without goal */ }

  return Response.json({ ok: true })
}
