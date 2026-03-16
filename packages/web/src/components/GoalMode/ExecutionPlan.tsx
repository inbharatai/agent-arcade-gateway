'use client'

import { useState } from 'react'
import type { TaskTree, TaskNode, AgentType } from '@/lib/goal-engine/types'

interface ExecutionPlanProps {
  taskTree: TaskTree
  onApprove: () => void
  onCancel: () => void
  onEdit: (tree: TaskTree) => void
}

const AGENT_ICONS: Record<AgentType, string> = {
  backend: '⚙️',
  frontend: '🎨',
  database: '🗄️',
  testing: '🧪',
  devops: '🚀',
  general: '🤖',
}

const AGENT_TYPE_OPTIONS: AgentType[] = ['backend', 'frontend', 'database', 'testing', 'devops', 'general']

const COMPLEXITY_STYLES: Record<string, string> = {
  low: 'bg-green-500/15 text-green-400 border-green-500/25',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  high: 'bg-red-500/15 text-red-400 border-red-500/25',
}

export function ExecutionPlan({ taskTree, onApprove, onCancel, onEdit }: ExecutionPlanProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTree, setEditTree] = useState<TaskTree>(() => JSON.parse(JSON.stringify(taskTree)))

  const activeTree = isEditing ? editTree : taskTree

  const handleRenameTask = (taskId: string, newTitle: string) => {
    setEditTree(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === taskId ? { ...t, title: newTitle } : t),
    }))
  }

  const handleDeleteTask = (taskId: string) => {
    setEditTree(prev => ({
      ...prev,
      tasks: prev.tasks.filter(t => t.id !== taskId),
      executionOrder: prev.executionOrder.map(phase => phase.filter(id => id !== taskId)).filter(phase => phase.length > 0),
    }))
  }

  const handleChangeAgentType = (taskId: string, agentType: AgentType) => {
    setEditTree(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === taskId ? { ...t, agentType } : t),
    }))
  }

  const handleResetToSuggested = () => {
    setEditTree(JSON.parse(JSON.stringify(taskTree)))
  }

  const handleSaveEdits = () => {
    onEdit(editTree)
    setIsEditing(false)
  }

  const getTaskById = (id: string) => activeTree.tasks.find(t => t.id === id)

  const getPhaseLabel = (phaseIndex: number) => {
    const phase = activeTree.executionOrder[phaseIndex]
    if (!phase) return `PHASE ${phaseIndex + 1}`
    const isParallel = phase.length > 1
    const deps = phaseIndex > 0 ? ` needs Phase ${phaseIndex}` : ''
    return `PHASE ${phaseIndex + 1} (${isParallel ? 'parallel' : 'sequential'}${deps})`
  }

  return (
    <div className="space-y-5">
      {/* Goal header */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-white">{activeTree.goal}</h3>
        <p className="text-xs text-white/50">{activeTree.summary}</p>
      </div>

      {/* Estimates */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          <span className="text-xs text-white/40">Est. Time:</span>
          <span className="text-xs font-mono text-white/70">{activeTree.estimatedTime}</span>
          <span className="text-[10px] text-white/30 italic">estimated</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          <span className="text-xs text-white/40">Est. Cost:</span>
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${COMPLEXITY_STYLES[activeTree.estimatedCost]}`}>
            {activeTree.estimatedCost}
          </span>
          <span className="text-[10px] text-white/30 italic">estimated</span>
        </div>
      </div>

      {/* Warning box */}
      <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-yellow-400">⚠️ IMPORTANT</p>
        <ul className="text-[11px] text-yellow-300/70 space-y-1 list-disc list-inside">
          <li>This is a suggested plan. You can edit tasks before starting.</li>
          <li>You can stop any agent at any time.</li>
          <li>Results need your review.</li>
          <li>Not guaranteed to be production-ready without your verification.</li>
        </ul>
      </div>

      {/* Edit mode controls */}
      {isEditing && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetToSuggested}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            Reset to suggested
          </button>
          <button
            onClick={handleSaveEdits}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-xs text-white font-medium hover:bg-violet-500 transition-colors"
          >
            Save edits
          </button>
        </div>
      )}

      {/* Phases */}
      <div className="space-y-4">
        {activeTree.executionOrder.map((phaseIds, phaseIdx) => (
          <div key={phaseIdx} className="space-y-2">
            <h4 className="text-[11px] font-bold tracking-widest uppercase text-white/40">
              {getPhaseLabel(phaseIdx)}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {phaseIds.map(taskId => {
                const task = getTaskById(taskId)
                if (!task) return null
                return (
                  <TaskCard
                    key={taskId}
                    task={task}
                    isEditing={isEditing}
                    onRename={handleRenameTask}
                    onDelete={handleDeleteTask}
                    onChangeAgentType={handleChangeAgentType}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:text-white/90 hover:bg-white/8 transition-colors"
        >
          ✏️ Edit Plan
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          ❌ Cancel
        </button>
        <button
          onClick={onApprove}
          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
        >
          ✅ Approve &amp; Start Execution
        </button>
      </div>
    </div>
  )
}

/* ─── Task Card ──────────────────────────────────────────────── */

function TaskCard({
  task,
  isEditing,
  onRename,
  onDelete,
  onChangeAgentType,
}: {
  task: TaskNode
  isEditing: boolean
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onChangeAgentType: (id: string, agentType: AgentType) => void
}) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{AGENT_ICONS[task.agentType]}</span>
          {isEditing ? (
            <input
              value={task.title}
              onChange={e => onRename(task.id, e.target.value)}
              className="bg-white/5 border border-white/15 rounded px-2 py-1 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          ) : (
            <span className="text-xs font-medium text-white truncate">{task.title}</span>
          )}
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${COMPLEXITY_STYLES[task.complexity]}`}>
          {task.complexity}
        </span>
      </div>

      {task.dependencies.length > 0 && (
        <p className="text-[10px] text-white/30">
          Depends on: {task.dependencies.join(', ')}
        </p>
      )}

      {isEditing && (
        <div className="flex items-center gap-2 pt-1">
          <select
            value={task.agentType}
            onChange={e => onChangeAgentType(task.id, e.target.value as AgentType)}
            className="bg-white/5 border border-white/15 rounded px-2 py-1 text-[11px] text-white/70 focus:outline-none"
          >
            {AGENT_TYPE_OPTIONS.map(at => (
              <option key={at} value={at} className="bg-gray-900">{AGENT_ICONS[at]} {at}</option>
            ))}
          </select>
          <button
            onClick={() => onDelete(task.id)}
            className="ml-auto text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
