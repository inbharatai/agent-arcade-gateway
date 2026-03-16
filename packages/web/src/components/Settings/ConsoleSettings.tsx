'use client'

import { useState } from 'react'
import { MODEL_OPTIONS } from '@/lib/providers/router'
import type { ArcadeSettings } from '@/hooks/useSettings'

interface ConsoleSettingsProps {
  settings: ArcadeSettings
  updateSetting: <K extends keyof ArcadeSettings>(key: K, value: ArcadeSettings[K]) => void
}

const KEYBOARD_SHORTCUTS = [
  { keys: 'Ctrl + Enter', action: 'Send message' },
  { keys: 'Ctrl + K', action: 'Open command palette' },
  { keys: 'Ctrl + `', action: 'Toggle console' },
  { keys: 'Esc', action: 'Close panel / cancel' },
  { keys: '/fix', action: 'Fix selected code' },
  { keys: '/explain', action: 'Explain code' },
  { keys: '/test', action: 'Write tests' },
  { keys: '/review', action: 'Code review' },
  { keys: '/opt', action: 'Optimize performance' },
  { keys: '/docs', action: 'Generate docs' },
  { keys: '/refactor', action: 'Refactor code' },
  { keys: '/cost', action: 'Show session cost' },
]

type HistoryRetention = ArcadeSettings['historyRetention']

const RETENTION_OPTIONS: { value: HistoryRetention; label: string }[] = [
  { value: 10, label: '10 messages' },
  { value: 25, label: '25 messages' },
  { value: 50, label: '50 messages' },
  { value: 0, label: 'Unlimited' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-blue-500' : 'bg-white/20'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export function ConsoleSettings({ settings, updateSetting }: ConsoleSettingsProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  return (
    <div className="space-y-5">
      {/* Default model */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
          Default AI Model
        </label>
        <select
          value={settings.preferredLanguage === 'en' ? MODEL_OPTIONS[0].id : MODEL_OPTIONS[0].id}
          onChange={() => {/* model is managed by ArcadeConsole, this is a display preference */}}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/80 focus:outline-none focus:border-blue-500/50"
        >
          {MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id} className="bg-gray-900">
              {m.name} — ${m.inputCostPer1M}/1M in
            </option>
          ))}
        </select>
        <p className="text-xs text-white/30">Model in active console overrides this.</p>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider block">
          Display
        </label>
        <div className="space-y-3">
          {(
            [
              { key: 'showTokenCounts', label: 'Show token counts' },
              { key: 'showCostEstimates', label: 'Show cost estimates' },
              { key: 'autoScroll', label: 'Auto-scroll to bottom' },
            ] as { key: keyof ArcadeSettings; label: string }[]
          ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-white/80">{label}</span>
              <Toggle
                checked={settings[key] as boolean}
                onChange={v => updateSetting(key, v as ArcadeSettings[typeof key])}
              />
            </div>
          ))}
        </div>
      </div>

      {/* History retention */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider block">
          History Retention
        </label>
        <div className="grid grid-cols-2 gap-2">
          {RETENTION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateSetting('historyRetention', opt.value)}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                settings.historyRetention === opt.value
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="space-y-2">
        <button
          onClick={() => setShortcutsOpen(s => !s)}
          className="flex items-center justify-between w-full text-xs font-semibold text-white/60 uppercase tracking-wider hover:text-white/80 transition-colors"
        >
          <span>Keyboard Shortcuts</span>
          <span>{shortcutsOpen ? '▲' : '▼'}</span>
        </button>
        {shortcutsOpen && (
          <div className="rounded-lg bg-white/3 border border-white/8 overflow-hidden">
            {KEYBOARD_SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-0">
                <span className="text-xs text-white/50">{s.action}</span>
                <kbd className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/70">{s.keys}</kbd>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
