'use client'

import { useState, useEffect } from 'react'
import { testConnection, checkServerProviders } from '@/lib/providers/router'
import type { ProviderId } from '@/lib/providers/router'

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

const API_KEYS_STORAGE_KEY = 'arcade-console-api-keys'

function loadStoredKeys(): Partial<Record<ProviderId, string>> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(API_KEYS_STORAGE_KEY) || '{}') } catch { return {} }
}

function saveStoredKeys(keys: Partial<Record<ProviderId, string>>): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys)) } catch { /* quota */ }
}

interface ProviderConfig {
  id: ProviderId
  label: string
  icon: string
  color: string
  placeholder: string
  needsKey: boolean
  needsUrl: boolean
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'claude', label: 'Anthropic', icon: '🟠', color: 'text-orange-400', placeholder: 'sk-ant-…', needsKey: true, needsUrl: false },
  { id: 'openai', label: 'OpenAI', icon: '🟢', color: 'text-green-400', placeholder: 'sk-…', needsKey: true, needsUrl: false },
  { id: 'gemini', label: 'Google Gemini', icon: '🔵', color: 'text-blue-400', placeholder: 'AIza…', needsKey: true, needsUrl: false },
  { id: 'ollama', label: 'Ollama (Local)', icon: '🟣', color: 'text-purple-400', placeholder: '', needsKey: false, needsUrl: true },
]

export function ProviderSettings() {
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>(loadStoredKeys)
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [showKey, setShowKey] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [testStatus, setTestStatus] = useState<Partial<Record<ProviderId, TestStatus>>>({})
  const [serverProviders, setServerProviders] = useState<Partial<Record<ProviderId, boolean>>>({})

  // Check server providers on mount
  useEffect(() => {
    checkServerProviders().then(setServerProviders).catch(() => {})
  }, [])

  const handleKeyChange = (provider: ProviderId, value: string) => {
    setApiKeys(prev => {
      const next = { ...prev, [provider]: value }
      saveStoredKeys(next)   // ← persist immediately
      return next
    })
    // Reset test status when key changes
    setTestStatus(prev => ({ ...prev, [provider]: 'idle' }))
  }

  const handleTest = async (provider: ProviderId) => {
    setTestStatus(prev => ({ ...prev, [provider]: 'testing' }))
    try {
      const ok = await testConnection(
        provider,
        apiKeys[provider] || '',
        provider === 'ollama' ? ollamaUrl : undefined
      )
      setTestStatus(prev => ({ ...prev, [provider]: ok ? 'ok' : 'fail' }))
    } catch {
      setTestStatus(prev => ({ ...prev, [provider]: 'fail' }))
    }
  }

  const handleAutoDetect = async () => {
    const commonPorts = ['11434', '11435']
    for (const port of commonPorts) {
      const url = `http://localhost:${port}`
      try {
        const ok = await testConnection('ollama', '', url)
        if (ok) {
          setOllamaUrl(url)
          setTestStatus(prev => ({ ...prev, ollama: 'ok' }))
          return
        }
      } catch {
        // continue trying
      }
    }
    setTestStatus(prev => ({ ...prev, ollama: 'fail' }))
  }

  const statusIcon = (status: TestStatus | undefined) => {
    if (status === 'testing') return '⏳'
    if (status === 'ok') return '✅'
    if (status === 'fail') return '❌'
    return 'Test'
  }

  return (
    <div className="space-y-5">
      {PROVIDERS.map(provider => {
        const status = testStatus[provider.id]
        const visible = showKey[provider.id]
        const hasServerKey = serverProviders[provider.id]
        const hasClientKey = !!(apiKeys[provider.id]?.trim())

        return (
          <div key={provider.id} className="rounded-xl bg-white/3 border border-white/8 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span>{provider.icon}</span>
              <span className={`text-sm font-semibold ${provider.color}`}>{provider.label}</span>
              {hasServerKey && !hasClientKey && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                  Auto-connected ✓
                </span>
              )}
              {status === 'ok' && <span className="ml-auto text-xs text-green-400">Connected ✅</span>}
              {status === 'fail' && <span className="ml-auto text-xs text-red-400">Failed ❌</span>}
            </div>

            {provider.needsKey && (
              <>
                {hasServerKey && !hasClientKey ? (
                  <div className="px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/15 text-xs text-green-300 flex items-center gap-2">
                    <span>🔑</span>
                    <span className="flex-1">API key configured on server — no manual setup needed.</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={visible ? 'text' : 'password'}
                      placeholder={hasServerKey ? `${provider.placeholder} (override server key)` : provider.placeholder}
                      value={apiKeys[provider.id] || ''}
                      onChange={e => handleKeyChange(provider.id, e.target.value)}
                      className="w-full px-3 py-2 pr-9 rounded-lg bg-black/30 border border-white/10 text-sm font-mono placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowKey(prev => ({ ...prev, [provider.id]: !visible }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 text-xs"
                      title={visible ? 'Hide key' : 'Show key'}
                    >
                      {visible ? '🙈' : '👁'}
                    </button>
                  </div>
                  <button
                    onClick={() => void handleTest(provider.id)}
                    disabled={!hasClientKey && !hasServerKey}
                    className="px-3 py-2 rounded-lg text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-colors"
                  >
                    {statusIcon(status)}
                  </button>
                </div>
              </>
            )}

            {provider.needsUrl && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="http://localhost:11434"
                    value={ollamaUrl}
                    onChange={e => setOllamaUrl(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={() => void handleAutoDetect()}
                    className="px-3 py-2 rounded-lg text-xs bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 shrink-0 transition-colors"
                  >
                    Auto-detect
                  </button>
                  <button
                    onClick={() => void handleTest(provider.id)}
                    className="px-3 py-2 rounded-lg text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 shrink-0 transition-colors"
                  >
                    {statusIcon(status)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <p className="text-xs text-white/30 text-center px-2">
        🔒 Keys saved to your browser only. Never sent to any external server.
      </p>
    </div>
  )
}
