export type AgentType = 'backend' | 'frontend' | 'database' | 'testing' | 'devops' | 'general'
export type TaskComplexity = 'low' | 'medium' | 'high'
export type TaskStatus = 'pending' | 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'skipped'
export type GoalStatus = 'planning' | 'review' | 'executing' | 'phase-review' | 'paused' | 'complete' | 'stopped' | 'failed'

export interface TaskNode {
  id: string
  title: string
  description: string
  agentType: AgentType
  dependencies: string[]
  canParallel: boolean
  complexity: TaskComplexity
  estimatedTokens: TaskComplexity
  successCriteria: string
}

export interface TaskTree {
  goal: string
  summary: string
  estimatedCost: TaskComplexity
  estimatedTime: string
  tasks: TaskNode[]
  executionOrder: string[][] // parallel groups (phases)
}

export interface TaskExecution extends TaskNode {
  status: TaskStatus
  agentId?: string
  agentName?: string
  startedAt?: number
  completedAt?: number
  progress: number
  cost: number
  tokens: number
  output?: string
  filesCreated?: string[]
  error?: string
}

export interface GoalPhase {
  index: number
  taskIds: string[]
  status: 'pending' | 'running' | 'review' | 'approved' | 'complete' | 'failed'
  startedAt?: number
  completedAt?: number
}

export interface GoalState {
  id: string
  sessionId: string
  originalGoal: string
  taskTree: TaskTree
  status: GoalStatus
  tasks: Record<string, TaskExecution>
  phases: GoalPhase[]
  currentPhase: number
  startedAt?: number
  completedAt?: number
  totalCost: number
  totalTokens: number
  approvedPhases: number[]
}

export interface GoalSettings {
  phaseReviewGates: boolean
  stuckTimeout: number // minutes
  maxParallelAgents: number
  maxTasksPerGoal: number
  autoCollapseOnFailure: boolean
  costLimitPerGoal: number // USD
  whatsappUpdates: boolean
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  phaseReviewGates: true,
  stuckTimeout: 3,
  maxParallelAgents: 3,
  maxTasksPerGoal: 6,
  autoCollapseOnFailure: false,
  costLimitPerGoal: 5,
  whatsappUpdates: false,
}
