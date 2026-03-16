'use client'

import { useEffect, useRef } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { ConsoleSettings } from './ConsoleSettings'
import { ProviderSettings } from './ProviderSettings'
import { LanguageSettings } from './LanguageSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { WhatsAppSettings } from './WhatsAppSettings'

type SettingsTab = 'console' | 'providers' | 'language' | 'appearance' | 'whatsapp' | 'about'

interface SettingsPanelProps {
  isOpen: boolean
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onClose: () => void
}

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'console', label: 'Console', icon: '⌨️' },
  { id: 'providers', label: 'Providers', icon: '🔑' },
  { id: 'language', label: 'Language', icon: '🌐' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'whatsapp', label: 'WhatsApp', icon: '📱' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
]

export function SettingsPanel({ isOpen, activeTab, onTabChange, onClose }: SettingsPanelProps) {
  const { settings, updateSetting, resetSettings } = useSettings()
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" />

      {/* Panel — slides in from the right */}
      <div
        ref={panelRef}
        className="w-full max-w-sm sm:max-w-md bg-gray-950 border-l border-white/10 flex flex-col shadow-2xl"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <h2 className="text-sm font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors text-lg leading-none"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex overflow-x-auto border-b border-white/10 shrink-0 scrollbar-none">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-300'
                  : 'border-transparent text-white/50 hover:text-white/80'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'console' && (
            <ConsoleSettings settings={settings} updateSetting={updateSetting} />
          )}
          {activeTab === 'providers' && (
            <ProviderSettings />
          )}
          {activeTab === 'language' && (
            <LanguageSettings settings={settings} updateSetting={updateSetting} />
          )}
          {activeTab === 'appearance' && (
            <AppearanceSettings settings={settings} updateSetting={updateSetting} />
          )}
          {activeTab === 'whatsapp' && (
            <WhatsAppSettings />
          )}
          {activeTab === 'about' && (
            <AboutTab />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-white/10 flex items-center justify-between">
          <button
            onClick={resetSettings}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Reset to defaults
          </button>
          <span className="text-xs text-white/20">Agent Arcade v3.2</span>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function AboutTab() {
  return (
    <div className="space-y-5 text-sm text-white/70">
      <div className="text-center space-y-2 py-4">
        <div className="text-5xl">🎮</div>
        <h3 className="text-lg font-bold text-white">Agent Arcade</h3>
        <p className="text-xs text-white/40">Universal AI Agent Cockpit</p>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/25 text-xs text-blue-300">
          Version 3.2
        </div>
      </div>

      <div className="rounded-xl bg-white/3 border border-white/8 divide-y divide-white/5">
        {[
          { label: 'Protocol', value: 'v1' },
          { label: 'Gateway', value: 'HTTP + SSE' },
          { label: 'Providers', value: 'Claude · OpenAI · Gemini · Ollama' },
          { label: 'Voice Input', value: 'Web Speech API' },
          { label: 'Storage', value: 'localStorage (client-only)' },
        ].map(row => (
          <div key={row.label} className="flex items-center justify-between px-3 py-2">
            <span className="text-white/40 text-xs">{row.label}</span>
            <span className="text-white/70 text-xs font-mono">{row.value}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/30 text-center">
        Built with Next.js · Tailwind CSS · TypeScript
      </p>
    </div>
  )
}
