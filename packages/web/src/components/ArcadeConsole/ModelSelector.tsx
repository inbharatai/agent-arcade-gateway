'use client'

import { useState, useEffect, useRef } from 'react'
import type { ModelOption, ProviderId } from '@/lib/providers/router'
import { MODEL_OPTIONS, testConnection, listOllamaModels, checkServerProviders } from '@/lib/providers/router'

interface ModelSelectorProps {
  selectedModel: ModelOption
  onModelChange: (model: ModelOption) => void
  apiKeys: Partial<Record<ProviderId, string>>
  onApiKeyChange: (provider: ProviderId, key: string) => void
  ollamaBaseUrl: string
  onOllamaUrlChange: (url: string) => void
  serverProviders?: Partial<Record<ProviderId, boolean>>
}

export function ModelSelector({
  selectedModel,
  onModelChange,
  apiKeys,
  onApiKeyChange,
  ollamaBaseUrl,
  onOllamaUrlChange,
  serverProviders: serverProvidersProp,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState<ProviderId | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({})
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [localServerProviders, setLocalServerProviders] = useState<Partial<Record<ProviderId, boolean>>>({})
  const serverProviders = serverProvidersProp ?? localServerProviders
  const ref = useRef<HTMLDivElement>(null)

  // Fetch server providers ourselves only if parent didn't pass them in
  useEffect(() => {
    if (!serverProvidersProp) {
      checkServerProviders().then(setLocalServerProviders).catch(() => {})
    }
  }, [serverProvidersProp])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadOllamaModels = async () => {
    const models = await listOllamaModels(ollamaBaseUrl || undefined)
    setOllamaModels(models)
  }

  const handleTest = async (provider: ProviderId) => {
    setTestStatus(s => ({ ...s, [provider]: 'testing' }))
    const ok = await testConnection(provider, apiKeys[provider] || '', ollamaBaseUrl || undefined)
    setTestStatus(s => ({ ...s, [provider]: ok ? 'ok' : 'fail' }))
  }

  const PROVIDER_INFO: Record<ProviderId, { label: string; color: string; icon: string }> = {
    claude: { label: 'Anthropic', color: 'text-orange-400', icon: '🟠' },
    openai: { label: 'OpenAI', color: 'text-green-400', icon: '🟢' },
    gemini: { label: 'Google', color: 'text-blue-400', icon: '🔵' },
    mistral: { label: 'Mistral AI', color: 'text-yellow-400', icon: '🟡' },
    ollama: { label: 'Ollama (Local)', color: 'text-purple-400', icon: '🟣' },
    custom: { label: 'Custom', color: 'text-gray-400', icon: '⚪' },
  }

  const groupedModels = MODEL_OPTIONS.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  }, {} as Record<string, ModelOption[]>)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors w-full"
      >
        <span className="text-base">{PROVIDER_INFO[selectedModel.provider]?.icon}</span>
        <span className="font-medium truncate flex-1 text-left">{selectedModel.name}</span>
        {serverProviders[selectedModel.provider] && !apiKeys[selectedModel.provider] ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 shrink-0">Auto ✓</span>
        ) : (
          <span className="text-white/40 text-xs shrink-0">
            {selectedModel.isLocal ? 'FREE' : `$${selectedModel.inputCostPer1M}/1M`}
          </span>
        )}
        <span className="text-white/40">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-gray-900 border border-white/10 shadow-2xl z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          {Object.entries(groupedModels).map(([provider, models]) => {
            const info = PROVIDER_INFO[provider as ProviderId]
            const needsKey = provider !== 'ollama' && provider !== 'custom'
            const status = testStatus[provider]
            return (
              <div key={provider} className="border-b border-white/5 last:border-0">
                <div className="px-3 pt-2 pb-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">
                    <span>{info?.icon}</span>
                    <span className={info?.color}>{info?.label}</span>
                  </div>

                  {needsKey && (
                    <div className="mb-2">
                      {serverProviders[provider as ProviderId] && !apiKeys[provider as ProviderId] ? (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">
                          <span>🔑</span>
                          <span className="flex-1">Auto-connected via server</span>
                          <span className="text-green-300 font-semibold">✓ Ready</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            placeholder={`${info?.label} API Key (optional)`}
                            value={apiKeys[provider as ProviderId] || ''}
                            onChange={e => onApiKeyChange(provider as ProviderId, e.target.value)}
                            className="flex-1 px-2 py-1 rounded text-xs bg-black/30 border border-white/10 font-mono placeholder-white/30"
                            onClick={e => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleTest(provider as ProviderId) }}
                            className="px-2 py-1 rounded text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 shrink-0"
                          >
                            {status === 'testing' ? '⏳' : status === 'ok' ? '✅' : status === 'fail' ? '❌' : 'Test'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {provider === 'ollama' && (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="http://localhost:11434"
                        value={ollamaBaseUrl}
                        onChange={e => onOllamaUrlChange(e.target.value)}
                        className="flex-1 px-2 py-1 rounded text-xs bg-black/30 border border-white/10 font-mono placeholder-white/30"
                        onClick={e => e.stopPropagation()}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); loadOllamaModels() }}
                        className="px-2 py-1 rounded text-xs bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 shrink-0"
                      >
                        Scan
                      </button>
                    </div>
                  )}
                </div>

                {models.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange(m); setOpen(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-white/5 transition-colors ${selectedModel.id === m.id ? 'bg-blue-500/10 text-blue-300' : 'text-white/80'}`}
                  >
                    <span className="flex-1 text-left">{m.name}</span>
                    {m.isLocal ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">LOCAL</span>
                    ) : (
                      <span className="text-xs text-white/40">${m.inputCostPer1M}/1M in</span>
                    )}
                    {selectedModel.id === m.id && <span className="text-blue-400">✓</span>}
                  </button>
                ))}

                {provider === 'ollama' && ollamaModels.filter(m => !MODEL_OPTIONS.find(o => o.id === m)).map(modelName => (
                  <button
                    key={modelName}
                    onClick={() => {
                      onModelChange({ id: modelName, name: modelName, provider: 'ollama', inputCostPer1M: 0, outputCostPer1M: 0, isLocal: true })
                      setOpen(false)
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-white/5 transition-colors ${selectedModel.id === modelName ? 'bg-blue-500/10 text-blue-300' : 'text-white/80'}`}
                  >
                    <span className="flex-1 text-left">{modelName}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">LOCAL</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
