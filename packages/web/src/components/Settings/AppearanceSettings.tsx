'use client'

import type { ArcadeSettings } from '@/hooks/useSettings'

interface AppearanceSettingsProps {
  settings: ArcadeSettings
  updateSetting: <K extends keyof ArcadeSettings>(key: K, value: ArcadeSettings[K]) => void
}

type FontSizeOption = ArcadeSettings['fontSize']
type CodeFontOption = ArcadeSettings['codeFont']
type AnimationOption = ArcadeSettings['animationSpeed']

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

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-white/60 uppercase tracking-wider block">
        {label}
      </label>
      <div className="flex gap-2 flex-wrap">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              value === opt.value
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const FONT_SIZE_OPTIONS: { value: FontSizeOption; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

const CODE_FONT_OPTIONS: { value: CodeFontOption; label: string }[] = [
  { value: 'mono', label: 'Mono' },
  { value: 'fira-code', label: 'Fira Code' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
]

const ANIMATION_OPTIONS: { value: AnimationOption; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'none', label: 'None' },
]

export function AppearanceSettings({ settings, updateSetting }: AppearanceSettingsProps) {
  return (
    <div className="space-y-5">
      <OptionGroup
        label="Console Font Size"
        options={FONT_SIZE_OPTIONS}
        value={settings.fontSize}
        onChange={v => updateSetting('fontSize', v)}
      />

      <OptionGroup
        label="Code Font"
        options={CODE_FONT_OPTIONS}
        value={settings.codeFont}
        onChange={v => updateSetting('codeFont', v)}
      />

      <OptionGroup
        label="Animation Speed"
        options={ANIMATION_OPTIONS}
        value={settings.animationSpeed}
        onChange={v => updateSetting('animationSpeed', v)}
      />

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-white/80">Compact mode</span>
          <p className="text-xs text-white/30 mt-0.5">Reduce padding and spacing throughout</p>
        </div>
        <Toggle
          checked={settings.compactMode}
          onChange={v => updateSetting('compactMode', v)}
        />
      </div>
    </div>
  )
}
