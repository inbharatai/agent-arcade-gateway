'use client'

import { useState } from 'react'

interface GoalInputProps {
  onDecompose: (goal: string) => void
  isDecomposing: boolean
}

const EXAMPLE_HINTS = [
  'Build a REST API with authentication',
  'Create a dashboard with charts',
  'Add a payment system with Stripe',
  'Refactor the database layer',
  'Build and test a user profile system',
]

export function GoalInput({ onDecompose, isDecomposing }: GoalInputProps) {
  const [goal, setGoal] = useState('')

  const handleSubmit = () => {
    const trimmed = goal.trim()
    if (!trimmed || isDecomposing) return
    onDecompose(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-4">
      {/* Header label */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🎯</span>
        <span className="text-xs font-bold tracking-widest uppercase text-violet-400">
          Goal Mode
        </span>
        <span className="text-[10px] text-white/40">
          — Supervised Multi-Agent Orchestration
        </span>
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your goal... e.g. Build a complete auth system with Google OAuth and JWT"
          rows={4}
          disabled={isDecomposing}
          className="w-full rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 disabled:opacity-50 transition-colors"
        />
      </div>

      {/* Example hint chips */}
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_HINTS.map(hint => (
          <button
            key={hint}
            onClick={() => setGoal(hint)}
            disabled={isDecomposing}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/8 text-xs text-white/50 hover:text-white/80 hover:bg-white/8 hover:border-white/15 transition-colors disabled:opacity-40"
          >
            {hint}
          </button>
        ))}
      </div>

      {/* Disclaimer */}
      <p className="text-[11px] text-white/35 leading-relaxed">
        Arcade will suggest a plan. You approve before any agent starts.
      </p>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!goal.trim() || isDecomposing}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isDecomposing ? (
          <>
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <span>Decomposing...</span>
          </>
        ) : (
          <span>Decompose Goal &rarr;</span>
        )}
      </button>
    </div>
  )
}
