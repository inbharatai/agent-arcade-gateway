'use client'

import { useState } from 'react'
import type { GoalSettings } from '@/lib/goal-engine/types'
import { DEFAULT_GOAL_SETTINGS } from '@/lib/goal-engine/types'

const STORAGE_KEY = 'agent-arcade:goal-settings'

function loadSettings(): GoalSettings {
  if (typeof window === 'undefined') return DEFAULT_GOAL_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_GOAL_SETTINGS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return DEFAULT_GOAL_SETTINGS
}

function saveSettings(s: GoalSettings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function GoalModeSettings() {
  const [settings, setSettings] = useState<GoalSettings>(() => loadSettings())

  const update = <K extends keyof GoalSettings>(key: K, value: GoalSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎯</span>
        <div>
          <h3 className="text-white font-semibold text-sm">Goal Mode</h3>
          <p className="text-white/40 text-xs">Supervised multi-agent orchestration</p>
        </div>
      </div>

      {/* Warning */}
      <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-yellow-400">⚠️ Experimental Feature</p>
        <p className="text-[11px] text-yellow-300/60 leading-relaxed">
          Goal Mode decomposes high-level goals into tasks and assigns them to specialized agents.
          All plans require your approval before execution. Results need your review.
        </p>
      </div>

      {/* Settings grid */}
      <div className="rounded-xl bg-white/3 border border-white/8 divide-y divide-white/5">
        {/* Phase review gates */}
        <ToggleRow
          label="Phase Review Gates"
          description="Pause between phases for your review"
          checked={settings.phaseReviewGates}
          onChange={v => update('phaseReviewGates', v)}
        />

        {/* Auto-collapse on failure */}
        <ToggleRow
          label="Auto-Collapse on Failure"
          description="Stop all agents if any task fails"
          checked={settings.autoCollapseOnFailure}
          onChange={v => update('autoCollapseOnFailure', v)}
        />

        {/* WhatsApp updates */}
        <ToggleRow
          label="WhatsApp Updates"
          description="Send phase completion notifications to WhatsApp"
          checked={settings.whatsappUpdates}
          onChange={v => update('whatsappUpdates', v)}
        />
      </div>

      {/* Numeric settings */}
      <div className="rounded-xl bg-white/3 border border-white/8 divide-y divide-white/5">
        <NumberRow
          label="Max Parallel Agents"
          description="Maximum agents running simultaneously"
          value={settings.maxParallelAgents}
          min={1}
          max={6}
          onChange={v => update('maxParallelAgents', v)}
        />

        <NumberRow
          label="Max Tasks per Goal"
          description="Maximum sub-tasks per goal decomposition"
          value={settings.maxTasksPerGoal}
          min={2}
          max={6}
          onChange={v => update('maxTasksPerGoal', v)}
        />

        <NumberRow
          label="Stuck Timeout (minutes)"
          description="Mark task as stuck after this duration"
          value={settings.stuckTimeout}
          min={1}
          max={30}
          onChange={v => update('stuckTimeout', v)}
        />

        <NumberRow
          label="Cost Limit per Goal ($)"
          description="Stop execution if total cost exceeds this"
          value={settings.costLimitPerGoal}
          min={1}
          max={100}
          onChange={v => update('costLimitPerGoal', v)}
        />
      </div>

      {/* Reset button */}
      <button
        onClick={() => {
          setSettings(DEFAULT_GOAL_SETTINGS)
          saveSettings(DEFAULT_GOAL_SETTINGS)
        }}
        className="text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        Reset Goal Mode settings to defaults
      </button>
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────── */

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div>
        <p className="text-xs text-white/80 font-medium">{label}</p>
        <p className="text-[11px] text-white/35">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-violet-600' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </div>
  )
}

function NumberRow({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  description: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div>
        <p className="text-xs text-white/80 font-medium">{label}</p>
        <p className="text-[11px] text-white/35">{description}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-6 h-6 rounded bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors"
        >
          −
        </button>
        <span className="w-8 text-center text-xs font-mono text-white/70">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-6 h-6 rounded bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}
