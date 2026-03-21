'use client'

import { useState, useEffect } from 'react'
import { checkServerProviders } from '@/lib/providers/router'
import type { ProviderId } from '@/lib/providers/router'

interface ProviderStatus {
  id: ProviderId
  label: string
  icon: string
  color: string
  description: string
  envVar?: string
  autoDetect?: string
}

const PROVIDERS: ProviderStatus[] = [
  {
    id: 'claude',
    label: 'Anthropic Claude',
    icon: '🟠',
    color: 'text-orange-400',
    description: 'Auto-detected via Claude Code CLI or OAuth subscription.',
    autoDetect: 'Claude Code',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    icon: '🟢',
    color: 'text-green-400',
    description: 'Set OPENAI_API_KEY in your server environment.',
    envVar: 'OPENAI_API_KEY',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    icon: '🔵',
    color: 'text-blue-400',
    description: 'Set GEMINI_API_KEY in your server environment.',
    envVar: 'GEMINI_API_KEY',
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    icon: '🟣',
    color: 'text-purple-400',
    description: 'Auto-detected when Ollama is running on localhost:11434.',
    autoDetect: 'Ollama',
  },
]

export function ProviderSettings() {
  const [serverProviders, setServerProviders] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkServerProviders()
      .then(setServerProviders)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleRefresh = () => {
    setLoading(true)
    checkServerProviders()
      .then(setServerProviders)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-white/40">
          Providers are detected automatically — no API keys needed.
        </p>
        <button
          onClick={handleRefresh}
          className="text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          {loading ? '⏳' : '↻ Refresh'}
        </button>
      </div>

      {PROVIDERS.map(provider => {
        const isAvailable = serverProviders[provider.id]

        return (
          <div
            key={provider.id}
            className="rounded-xl bg-white/3 border border-white/8 p-4 flex items-start gap-3"
          >
            <span className="text-lg mt-0.5">{provider.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-semibold ${provider.color}`}>{provider.label}</span>
                {loading ? (
                  <span className="ml-auto text-xs text-white/30">checking…</span>
                ) : isAvailable ? (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                    Connected ✓
                  </span>
                ) : (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/35 border border-white/10">
                    Not detected
                  </span>
                )}
              </div>
              <p className="text-xs text-white/40">{provider.description}</p>
              {!isAvailable && provider.envVar && (
                <p className="text-xs text-white/25 mt-1 font-mono">
                  export {provider.envVar}=&quot;your-key&quot;
                </p>
              )}
              {!isAvailable && provider.autoDetect === 'Claude Code' && (
                <p className="text-xs text-amber-400/60 mt-1">
                  Start Claude Code or set ANTHROPIC_API_KEY to enable.
                </p>
              )}
            </div>
          </div>
        )
      })}

      <div className="rounded-xl bg-blue-500/5 border border-blue-500/15 p-3 text-xs text-blue-300/70 space-y-1">
        <p className="font-semibold text-blue-300/90">How it works</p>
        <p>Agent Arcade auto-inherits credentials from any running AI tool (Claude Code, Cursor, etc.) — no copy-pasting keys into the browser. Additional providers can be enabled via server environment variables.</p>
      </div>
    </div>
  )
}
