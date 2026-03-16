'use client'

import type { ArcadeSettings } from '@/hooks/useSettings'

interface LanguageSettingsProps {
  settings: ArcadeSettings
  updateSetting: <K extends keyof ArcadeSettings>(key: K, value: ArcadeSettings[K]) => void
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'kn', label: 'Kannada' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' },
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

export function LanguageSettings({ settings, updateSetting }: LanguageSettingsProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider block">
          Detection & Translation
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/80">Auto-detect language</span>
              <p className="text-xs text-white/30 mt-0.5">Detect language as you type</p>
            </div>
            <Toggle
              checked={settings.autoDetectLanguage}
              onChange={v => updateSetting('autoDetectLanguage', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/80">Auto-translate to English</span>
              <p className="text-xs text-white/30 mt-0.5">Normalize input before sending to AI</p>
            </div>
            <Toggle
              checked={settings.autoTranslate}
              onChange={v => updateSetting('autoTranslate', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-white/80">Show translation preview</span>
              <p className="text-xs text-white/30 mt-0.5">Preview translated text above input</p>
            </div>
            <Toggle
              checked={settings.showTranslationPreview}
              onChange={v => updateSetting('showTranslationPreview', v)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-white/60 uppercase tracking-wider block">
          Preferred Display Language
        </label>
        <select
          value={settings.preferredLanguage}
          onChange={e => updateSetting('preferredLanguage', e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/80 focus:outline-none focus:border-blue-500/50"
        >
          {LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code} className="bg-gray-900">
              {lang.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-white/30">
          Used for UI labels and AI response hints when available.
        </p>
      </div>
    </div>
  )
}
