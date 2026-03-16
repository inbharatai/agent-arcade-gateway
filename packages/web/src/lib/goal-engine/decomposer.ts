import type { TaskTree, TaskNode } from './types'

const DECOMPOSITION_SYSTEM_PROMPT = `You are a software project planner inside Agent Arcade. Break down the following goal into a structured task tree.
Rules:
- Maximum 6 sub-tasks per goal
- Each task must be atomic and completable by a single AI agent in one session
- Tasks must have clear dependencies
- Identify which tasks can run in parallel
- Identify which must run sequentially
- Estimate complexity: low/medium/high
- Estimate token cost: low/medium/high
Return ONLY valid JSON. No explanation. No preamble. No markdown. Pure JSON only.

JSON format:
{
  "goal": "<original goal>",
  "summary": "<one-line summary of the plan>",
  "estimatedCost": "low|medium|high",
  "estimatedTime": "<e.g. '5-10 minutes'>",
  "tasks": [
    {
      "id": "task-1",
      "title": "<short title>",
      "description": "<what this task does>",
      "agentType": "backend|frontend|database|testing|devops|general",
      "dependencies": [],
      "canParallel": true,
      "complexity": "low|medium|high",
      "estimatedTokens": "low|medium|high",
      "successCriteria": "<how to verify completion>"
    }
  ],
  "executionOrder": [
    ["task-1", "task-2"],
    ["task-3"]
  ]
}`

/**
 * Validate a parsed TaskTree for structural correctness.
 */
export function validateTaskTree(tree: TaskTree): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!tree.goal || typeof tree.goal !== 'string') {
    errors.push('Missing or invalid "goal" field')
  }
  if (!tree.summary || typeof tree.summary !== 'string') {
    errors.push('Missing or invalid "summary" field')
  }
  if (!['low', 'medium', 'high'].includes(tree.estimatedCost)) {
    errors.push(`Invalid estimatedCost: "${tree.estimatedCost}" — must be low, medium, or high`)
  }
  if (!tree.estimatedTime || typeof tree.estimatedTime !== 'string') {
    errors.push('Missing or invalid "estimatedTime" field')
  }

  // Validate tasks array
  if (!Array.isArray(tree.tasks) || tree.tasks.length === 0) {
    errors.push('Tasks array is missing or empty')
    return { valid: false, errors }
  }

  // Max 6 tasks
  if (tree.tasks.length > 6) {
    errors.push(`Too many tasks: ${tree.tasks.length} — maximum is 6`)
  }

  const taskIds = new Set(tree.tasks.map((t) => t.id))

  // Validate each task
  for (const task of tree.tasks) {
    if (!task.id || typeof task.id !== 'string') {
      errors.push('Task has missing or invalid "id"')
      continue
    }

    if (!task.title) errors.push(`Task ${task.id}: missing "title"`)
    if (!task.description) errors.push(`Task ${task.id}: missing "description"`)
    if (!task.successCriteria) errors.push(`Task ${task.id}: missing "successCriteria"`)

    const validAgentTypes = ['backend', 'frontend', 'database', 'testing', 'devops', 'general']
    if (!validAgentTypes.includes(task.agentType)) {
      errors.push(`Task ${task.id}: invalid agentType "${task.agentType}"`)
    }

    if (!['low', 'medium', 'high'].includes(task.complexity)) {
      errors.push(`Task ${task.id}: invalid complexity "${task.complexity}"`)
    }
    if (!['low', 'medium', 'high'].includes(task.estimatedTokens)) {
      errors.push(`Task ${task.id}: invalid estimatedTokens "${task.estimatedTokens}"`)
    }

    // Validate dependencies exist
    if (Array.isArray(task.dependencies)) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          errors.push(`Task ${task.id}: dependency "${dep}" does not exist`)
        }
      }
    }
  }

  // Check for circular dependencies
  const circularError = detectCircularDeps(tree.tasks)
  if (circularError) {
    errors.push(circularError)
  }

  // Validate executionOrder covers all tasks
  if (!Array.isArray(tree.executionOrder) || tree.executionOrder.length === 0) {
    errors.push('executionOrder is missing or empty')
  } else {
    const coveredIds = new Set<string>()
    for (const phase of tree.executionOrder) {
      if (!Array.isArray(phase)) {
        errors.push('Each executionOrder phase must be an array of task IDs')
        continue
      }
      for (const id of phase) {
        if (!taskIds.has(id)) {
          errors.push(`executionOrder references unknown task "${id}"`)
        }
        if (coveredIds.has(id)) {
          errors.push(`executionOrder lists task "${id}" more than once`)
        }
        coveredIds.add(id)
      }
    }

    Array.from(taskIds).forEach((id) => {
      if (!coveredIds.has(id)) {
        errors.push(`Task "${id}" is not included in executionOrder`)
      }
    })
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Detect circular dependencies in the task list using DFS.
 */
function detectCircularDeps(tasks: TaskNode[]): string | null {
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const taskMap = new Map(tasks.map((t) => [t.id, t]))

  function dfs(id: string): string | null {
    if (inStack.has(id)) return `Circular dependency detected involving task "${id}"`
    if (visited.has(id)) return null

    visited.add(id)
    inStack.add(id)

    const task = taskMap.get(id)
    if (task) {
      for (const dep of task.dependencies) {
        const result = dfs(dep)
        if (result) return result
      }
    }

    inStack.delete(id)
    return null
  }

  for (const task of tasks) {
    const result = dfs(task.id)
    if (result) return result
  }

  return null
}

/**
 * Extract JSON from a response string, handling potential markdown fences or preamble.
 */
function extractJSON(text: string): string {
  // Try to extract from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) return jsonMatch[0]

  return text.trim()
}

/**
 * Decompose a high-level goal into a structured TaskTree using an AI provider.
 *
 * Calls the /api/chat endpoint with the decomposition system prompt,
 * parses the JSON response, validates it, and retries once on failure.
 */
export async function decomposeGoal(
  goal: string,
  provider: string,
  modelId: string,
  apiKeys: Record<string, string>,
): Promise<TaskTree> {
  const trimmedGoal = goal.trim()
  if (!trimmedGoal) {
    throw new Error('Goal cannot be empty')
  }

  let lastError: Error | null = null

  // Attempt up to 2 times (initial + 1 retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const userMessage =
        attempt === 0
          ? trimmedGoal
          : `${trimmedGoal}\n\nIMPORTANT: Your previous response was not valid JSON. Return ONLY valid JSON matching the specified format. No explanation, no markdown fences, no preamble.`

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: modelId,
          apiKeys,
          messages: [
            { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Chat API returned ${response.status}: ${body}`)
      }

      const data = await response.json()
      const rawText: string = data.choices?.[0]?.message?.content ?? data.content ?? ''

      if (!rawText) {
        throw new Error('Empty response from AI provider')
      }

      const jsonStr = extractJSON(rawText)
      let parsed: TaskTree

      try {
        parsed = JSON.parse(jsonStr) as TaskTree
      } catch {
        throw new Error(`Failed to parse JSON from AI response: ${jsonStr.slice(0, 200)}...`)
      }

      // Validate
      const validation = validateTaskTree(parsed)
      if (!validation.valid) {
        // Check for specific recoverable issues
        if (parsed.tasks && parsed.tasks.length > 6) {
          throw new Error(
            `Goal is too complex — AI generated ${parsed.tasks.length} tasks (max 6). Try breaking it into smaller goals.`,
          )
        }
        throw new Error(`Invalid task tree: ${validation.errors.join('; ')}`)
      }

      return parsed
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry on non-recoverable errors
      if (
        lastError.message.includes('too complex') ||
        lastError.message.includes('Chat API returned 4')
      ) {
        throw lastError
      }
    }
  }

  throw lastError ?? new Error('Goal decomposition failed after retries')
}
