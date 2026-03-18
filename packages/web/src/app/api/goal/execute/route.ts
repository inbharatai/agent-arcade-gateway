import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { allocateAgents } from '@/lib/goal-engine/allocator'
import type { TaskTree, GoalState, GoalPhase, TaskExecution } from '@/lib/goal-engine/types'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:47890'

/**
 * POST /api/goal/execute
 *
 * Accepts a validated TaskTree and a sessionId.
 * Builds a complete GoalState (with phases, task execution records, agent assignments),
 * registers it with the gateway via POST /v1/goals/start,
 * and returns the full GoalState so the UI can render the execution graph immediately.
 */
export async function POST(req: NextRequest) {
  let body: { taskTree?: TaskTree; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { taskTree, sessionId } = body
  if (!taskTree || !taskTree.tasks || taskTree.tasks.length === 0) {
    return Response.json({ error: 'taskTree with at least one task is required' }, { status: 400 })
  }
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const goalId = randomUUID()
  const now = Date.now()

  // Allocate specialized agents to each task
  const assignments = allocateAgents(taskTree, sessionId)
  const assignmentMap = new Map(assignments.map(a => [a.taskId, a]))

  // Build TaskExecution records from the task tree
  const tasks: Record<string, TaskExecution> = {}
  for (const task of taskTree.tasks) {
    const assignment = assignmentMap.get(task.id)
    tasks[task.id] = {
      ...task,
      status: 'pending',
      agentId: assignment?.agentId,
      agentName: assignment?.agentName,
      progress: 0,
      cost: 0,
      tokens: 0,
    }
  }

  // Build phases from executionOrder
  const phases: GoalPhase[] = taskTree.executionOrder.map((taskIds, index) => ({
    index,
    taskIds,
    status: index === 0 ? 'running' : 'pending',
  }))

  // Mark first-phase tasks as queued
  if (phases.length > 0) {
    for (const taskId of phases[0].taskIds) {
      if (tasks[taskId]) tasks[taskId].status = 'queued'
    }
  }

  const goal: GoalState = {
    id: goalId,
    sessionId,
    originalGoal: taskTree.goal,
    taskTree,
    status: 'executing',
    tasks,
    phases,
    currentPhase: 0,
    approvedPhases: [],
    startedAt: now,
    totalCost: 0,
    totalTokens: 0,
  }

  // Register with gateway — fire and forget if gateway is unavailable
  // (UI still gets a functional GoalState to render)
  try {
    const gwRes = await fetch(`${GATEWAY_URL}/v1/goals/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goalId,
        sessionId,
        originalGoal: taskTree.goal,
        taskTree,
        tasks: goal.tasks,
        phases: goal.phases,
      }),
    })
    if (!gwRes.ok) {
      const err = await gwRes.json().catch(() => ({ error: gwRes.statusText }))
      console.warn('[goal/execute] gateway rejected goal:', err)
    }
  } catch (err) {
    // Gateway unreachable — continue anyway; polling will reconnect
    console.warn('[goal/execute] gateway unreachable:', err)
  }

  return Response.json({ goal })
}
