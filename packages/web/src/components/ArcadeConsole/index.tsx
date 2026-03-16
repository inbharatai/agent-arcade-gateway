'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { StatsBar } from './StatsBar'
import { ModelSelector } from './ModelSelector'
import { ChatHistory } from './ChatHistory'
import { InputPanel } from './InputPanel'
import { OutputPanel } from './OutputPanel'
import { CommandPalette } from './CommandPalette'
import { SettingsPanel } from '@/components/Settings'
import { MODEL_OPTIONS, streamWithRouter, calculateCost, checkServerProviders } from '@/lib/providers/router'
import type { ModelOption, ProviderId, RouterConfig } from '@/lib/providers/router'
import {
  createSession, getSession, saveSession, addMessage,
  getActiveSessionId, setActiveSessionId, exportSession,
} from '@/lib/session-store'
import type { ChatMessage, ConsoleSession } from '@/lib/session-store'
import {
  initArcadeBridge, consoleAgentSpawn, consoleAgentThinking, consoleAgentWriting,
  consoleAgentDone, consoleAgentError, consoleAgentCodeDetected,
} from '@/lib/arcade-bridge'

interface ArcadeConsoleProps {
  gatewayUrl?: string
  sessionId?: string
  authToken?: string
  sessionSignature?: string
  connectedAgents?: number
  onAgentCommand?: (cmd: string, agentId?: string, args?: string) => void
}

const API_KEYS_STORAGE_KEY = 'arcade-console-api-keys'
const MODEL_STORAGE_KEY = 'arcade-console-model'

function loadApiKeys(): Partial<Record<ProviderId, string>> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(API_KEYS_STORAGE_KEY) || '{}') } catch { return {} }
}

function saveApiKeys(keys: Partial<Record<ProviderId, string>>): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys)) } catch { /* quota */ }
}

function loadSavedModel(): ModelOption {
  if (typeof window === 'undefined') return MODEL_OPTIONS[0]
  try {
    const id = localStorage.getItem(MODEL_STORAGE_KEY)
    return MODEL_OPTIONS.find(m => m.id === id) || MODEL_OPTIONS[0]
  } catch { return MODEL_OPTIONS[0] }
}

export function ArcadeConsole({
  gatewayUrl = 'http://localhost:47890',
  sessionId,
  authToken,
  sessionSignature,
  connectedAgents = 0,
  onAgentCommand,
}: ArcadeConsoleProps) {
  const [selectedModel, setSelectedModel] = useState<ModelOption>(loadSavedModel)
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>(loadApiKeys)
  const [serverProviders, setServerProviders] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434')
  const [session, setSession] = useState<ConsoleSession | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOutput, setShowOutput] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'console' | 'providers' | 'language' | 'appearance' | 'whatsapp' | 'about'>('console')
  const [sessionStart] = useState(Date.now())
  const abortRef = useRef<AbortController | null>(null)

  // Check server-side providers on mount
  useEffect(() => {
    checkServerProviders().then(setServerProviders).catch(() => {})
  }, [])

  // Initialize arcade bridge with gateway config
  useEffect(() => {
    if (gatewayUrl && sessionId) {
      initArcadeBridge({ gatewayUrl, sessionId, authToken, sessionSignature })
    }
  }, [gatewayUrl, sessionId, authToken, sessionSignature])

  // Spawn console agent when bridge is ready
  useEffect(() => {
    if (gatewayUrl && sessionId) {
      consoleAgentSpawn()
    }
  }, [gatewayUrl, sessionId])

  // Initialize session — restores existing or creates fresh
  useEffect(() => {
    const activeId = getActiveSessionId()
    const existing = activeId ? getSession(activeId) : null
    if (existing) {
      setSession(existing)
    } else {
      const newSession = createSession(selectedModel.id)
      saveSession(newSession)
      setActiveSessionId(newSession.id)
      setSession(newSession)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-start a fresh console session whenever the gateway session ID changes
  // This ensures no old conversation state bleeds into a new session
  const prevSessionIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!sessionId) return
    if (prevSessionIdRef.current && prevSessionIdRef.current !== sessionId) {
      // Gateway session rotated — start fresh console conversation
      const newSession = createSession(selectedModel.id)
      saveSession(newSession)
      setActiveSessionId(newSession.id)
      setSession(newSession)
      setStreamingContent('')
      setError(null)
      setShowOutput(false)
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
    prevSessionIdRef.current = sessionId
  }, [sessionId, selectedModel.id])

  const handleApiKeyChange = useCallback((provider: ProviderId, key: string) => {
    setApiKeys(prev => {
      const next = { ...prev, [provider]: key }
      saveApiKeys(next)
      return next
    })
  }, [])

  const handleModelChange = useCallback((model: ModelOption) => {
    setSelectedModel(model)
    if (typeof window !== 'undefined') localStorage.setItem(MODEL_STORAGE_KEY, model.id)
  }, [])

  const handleSend = useCallback(async (userInput: string) => {
    if (!session || isStreaming) return
    setError(null)

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    }
    const updatedSession = addMessage(session.id, userMsg)
    if (updatedSession) setSession({ ...updatedSession })

    consoleAgentThinking(userInput)

    setIsStreaming(true)
    setStreamingContent('')
    abortRef.current = new AbortController()

    const messages = (updatedSession?.messages || [...session.messages, userMsg])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const routerConfig: RouterConfig = {
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      apiKeys,
      ollamaBaseUrl,
    }

    let fullText = ''
    let lastInputTokens = 0
    let lastOutputTokens = 0
    let hasCode = false

    try {
      consoleAgentWriting(selectedModel.name)

      for await (const chunk of streamWithRouter(messages, routerConfig, abortRef.current.signal)) {
        if (chunk.done) {
          lastInputTokens = chunk.inputTokens || lastInputTokens
          lastOutputTokens = chunk.outputTokens || lastOutputTokens
          break
        }
        fullText += chunk.text
        setStreamingContent(fullText)
        if (!hasCode && /```/.test(fullText)) {
          hasCode = true
          consoleAgentCodeDetected()
          setShowOutput(true)
        }
      }

      const cost = calculateCost(lastInputTokens, lastOutputTokens, selectedModel)
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: fullText,
        timestamp: Date.now(),
        model: selectedModel.name,
        inputTokens: lastInputTokens,
        outputTokens: lastOutputTokens,
        cost,
      }
      const finalSession = addMessage(session.id, aiMsg)
      if (finalSession) setSession({ ...finalSession })

      consoleAgentDone(fullText.slice(0, 80))
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (fullText) {
          const aiMsg: ChatMessage = {
            id: `msg-${Date.now()}-ai`,
            role: 'assistant',
            content: fullText + '\n\n*[Stopped]*',
            timestamp: Date.now(),
            model: selectedModel.name,
          }
          const finalSession = addMessage(session.id, aiMsg)
          if (finalSession) setSession({ ...finalSession })
        }
      } else {
        const errMsg = (err as Error).message || 'Unknown error'
        setError(errMsg)
        consoleAgentError(errMsg)
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [session, isStreaming, selectedModel, apiKeys, ollamaBaseUrl])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleCommand = useCallback((cmd: string, args?: string) => {
    const agentCommands = ['/stop', '/pause', '/status', '/history', '/redirect', '/ask']
    if (agentCommands.includes(cmd) && onAgentCommand) {
      const parts = (args || '').split(' ')
      const agentId = parts[0]
      const rest = parts.slice(1).join(' ')
      onAgentCommand(cmd, agentId || '', rest || undefined)
      return
    }

    const prompts: Record<string, string> = {
      '/fix': 'Fix this code:\n\n',
      '/explain': 'Explain this code:\n\n',
      '/test': 'Write tests for this code:\n\n',
      '/review': 'Review this code:\n\n',
      '/opt': 'Optimize this for performance:\n\n',
      '/docs': 'Generate documentation for:\n\n',
      '/refactor': 'Refactor this code:\n\n',
      '/debug': 'Help debug this:\n\n',
      '/cost': `Show session cost breakdown. Current session: $${(session?.totalCost || 0).toFixed(4)} total, ${session?.messages.length || 0} messages.`,
    }
    if (prompts[cmd]) void handleSend(prompts[cmd] + (args || ''))
  }, [handleSend, onAgentCommand, session])

  const handleNewSession = useCallback(() => {
    const newSession = createSession(selectedModel.id)
    saveSession(newSession)
    setActiveSessionId(newSession.id)
    setSession(newSession)
    setStreamingContent('')
    setError(null)
    setShowOutput(false)
  }, [selectedModel.id])

  const messages = session?.messages || []
  const totalTokens = (session?.totalInputTokens || 0) + (session?.totalOutputTokens || 0)

  // Keyboard shortcut: Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCommand={handleCommand}
      />

      <SettingsPanel
        isOpen={settingsOpen}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={() => setSettingsOpen(false)}
      />

      <StatsBar
        modelName={selectedModel.name}
        messageCount={messages.length}
        totalTokens={totalTokens}
        sessionCost={session?.totalCost || 0}
        sessionStart={sessionStart}
        connectedAgents={connectedAgents}
      />

      <div className="shrink-0 px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            apiKeys={apiKeys}
            onApiKeyChange={handleApiKeyChange}
            ollamaBaseUrl={ollamaBaseUrl}
            onOllamaUrlChange={setOllamaBaseUrl}
            serverProviders={serverProviders}
          />
        </div>
        <button
          onClick={handleNewSession}
          className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/60 transition-colors shrink-0"
          title="New session"
        >
          + New
        </button>
        {session && (
          <button
            onClick={() => exportSession(session)}
            className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/60 transition-colors shrink-0"
            title="Export chat"
          >
            ↓ Export
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(s => !s)}
          className={`px-2 py-1.5 rounded-lg border text-xs transition-colors shrink-0 ${
            settingsOpen
              ? 'bg-blue-500/20 border-blue-500/30 text-blue-300'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60'
          }`}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Provider not yet detected — nudge to start the gateway alongside the AI tool */}
      {!apiKeys[selectedModel.provider] && !serverProviders[selectedModel.provider] && selectedModel.provider !== 'ollama' && messages.length === 0 && !error && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
          <span>🔗</span>
          <span className="flex-1">Start <code className="bg-black/30 px-1 rounded font-mono">agent-arcade start</code> in the same shell as your AI tool — the Console auto-detects API keys from your environment.</span>
        </div>
      )}

      {error && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2">
          <span>⚠️</span>
          <span className="flex-1">{error}</span>
          {error.toLowerCase().includes('api key') && (
            <button
              onClick={() => { setSettingsTab('providers'); setSettingsOpen(true); setError(null) }}
              className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-200 shrink-0 font-medium whitespace-nowrap"
            >
              Set Key →
            </button>
          )}
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-1">✕</button>
        </div>
      )}

      <ChatHistory
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        modelName={selectedModel.name}
      />

      <OutputPanel
        lastResponse={messages.findLast(m => m.role === 'assistant')?.content || ''}
        isVisible={showOutput}
        onClose={() => setShowOutput(false)}
      />

      <InputPanel
        onSend={handleSend}
        isStreaming={isStreaming}
        onStop={handleStop}
        selectedModel={selectedModel}
        onCommandPalette={() => setCommandPaletteOpen(true)}
      />
    </div>
  )
}
