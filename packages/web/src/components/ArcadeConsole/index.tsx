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
  consoleAgentDone, consoleAgentError, consoleAgentCodeDetected, consoleAgentCost,
} from '@/lib/arcade-bridge'
import dynamic from 'next/dynamic'

const GoalMode = dynamic(() => import('@/components/GoalMode').then(m => ({ default: m.GoalMode })), { ssr: false })

interface ArcadeConsoleProps {
  gatewayUrl?: string
  sessionId?: string
  authToken?: string
  sessionSignature?: string
  connectedAgents?: number
  activeAgentModels?: string[]
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
  activeAgentModels = [],
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
  const [settingsTab, setSettingsTab] = useState<'console' | 'providers' | 'language' | 'appearance' | 'whatsapp' | 'goalmode' | 'about'>('console')
  const [sessionStart] = useState(Date.now())
  const [consoleMode, setConsoleMode] = useState<'chat' | 'goal'>('chat')
  const [inlineKeyInput, setInlineKeyInput] = useState('')
  const [inlineKeyExpanded, setInlineKeyExpanded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const autoDetectedRef = useRef(false)
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('arcade-voice-enabled') === 'true'
  })

  const speakText = useCallback((text: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, 'code block').slice(0, 500))
    utterance.rate = 1.05
    window.speechSynthesis.speak(utterance)
  }, [voiceEnabled])

  const toggleVoice = useCallback(() => {
    setVoiceEnabled(prev => {
      const next = !prev
      if (typeof window !== 'undefined') localStorage.setItem('arcade-voice-enabled', String(next))
      if (!next && window.speechSynthesis) window.speechSynthesis.cancel()
      return next
    })
  }, [])

  // Check server-side providers on mount
  useEffect(() => {
    checkServerProviders().then(setServerProviders).catch(() => {})
  }, [])

  // Auto-detect AI model from active agents + server providers
  // Runs whenever agents or server providers change, but only if user hasn't manually selected a model
  useEffect(() => {
    if (activeAgentModels.length === 0 && Object.keys(serverProviders).length === 0) return

    // Already auto-detected this exact set of providers → skip to avoid thrashing
    if (autoDetectedRef.current) return

    // Already has a user-saved model preference → don't override
    if (typeof window !== 'undefined' && localStorage.getItem(MODEL_STORAGE_KEY)) return

    // Try to match agent model strings to our MODEL_OPTIONS
    const matchFromAgents = (): ModelOption | null => {
      for (const agentModel of activeAgentModels) {
        const lower = agentModel.toLowerCase()
        // Direct ID match
        const exact = MODEL_OPTIONS.find(m => m.id === lower || m.name.toLowerCase() === lower)
        if (exact) return exact
        // Fuzzy: "claude" → Claude Sonnet, "gpt" → GPT-4o, "gemini" → Gemini Flash
        if (lower.includes('claude') || lower.includes('anthropic')) return MODEL_OPTIONS.find(m => m.provider === 'claude') || null
        if (lower.includes('gpt') || lower.includes('openai')) return MODEL_OPTIONS.find(m => m.provider === 'openai') || null
        if (lower.includes('gemini') || lower.includes('google')) return MODEL_OPTIONS.find(m => m.provider === 'gemini') || null
        if (lower.includes('mistral')) return MODEL_OPTIONS.find(m => m.provider === 'mistral') || null
        if (lower.includes('ollama') || lower.includes('llama')) return null // ollama needs separate setup
      }
      return null
    }

    // Try to pick best model from server providers (gateway has the key)
    const matchFromProviders = (): ModelOption | null => {
      if (serverProviders.claude) return MODEL_OPTIONS.find(m => m.provider === 'claude') || null
      if (serverProviders.openai) return MODEL_OPTIONS.find(m => m.provider === 'openai') || null
      if (serverProviders.gemini) return MODEL_OPTIONS.find(m => m.provider === 'gemini') || null
      if (serverProviders.mistral) return MODEL_OPTIONS.find(m => m.provider === 'mistral') || null
      return null
    }

    const detected = matchFromAgents() || matchFromProviders()
    if (detected) {
      autoDetectedRef.current = true
      setSelectedModel(detected)
    }
  }, [activeAgentModels, serverProviders])

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

  // Subscribe to gateway SSE stream for messages from external AI tools
  // This makes the Console a universal panel — responses from Claude Code,
  // Cursor, WhatsApp relay, or any connected tool appear in the chat.
  const sseSourceRef = useRef<EventSource | null>(null)
  // Monotonic counter ensures unique message IDs even if two events arrive in the same ms
  const extMsgCounterRef = useRef(0)
  useEffect(() => {
    if (!gatewayUrl || !sessionId) return

    // Build SSE URL with auth params
    const params = new URLSearchParams({ sessionId })
    if (authToken) params.set('token', authToken)
    if (sessionSignature) params.set('sig', sessionSignature)
    const sseUrl = `${gatewayUrl}/v1/stream?${params.toString()}`

    const es = new EventSource(sseUrl)
    sseSourceRef.current = es

    es.addEventListener('event', (e) => {
      try {
        const ev = JSON.parse(e.data)
        // Only insert chat messages from NON-console agents (to avoid duplicates)
        if (ev.type === 'agent.message' && ev.agentId && ev.agentId !== 'arcade-console' && !ev.agentId.startsWith('console-')) {
          const text = ev.payload?.text
          if (!text || typeof text !== 'string') return
          // Skip chat-proxy broadcasts (Console already has these from its own stream)
          if (ev.payload?.source === 'chat-proxy') return
          // Skip "Directive from X" announcements
          if (/^Directive from /i.test(text)) return
          // Skip empty messages
          if (text.length < 2) return
          // Skip messages that are just state announcements
          if (/^(thinking|writing|done|error|waiting)/i.test(text)) return
          if (/^I am thinking about:/i.test(text)) return
          if (/^Now writing/i.test(text)) return
          if (/^Done:/i.test(text)) return
          if (/^Error:/i.test(text)) return
          if (/^Generating response with/i.test(text)) return
          if (/^Task complete\./i.test(text)) return
          if (/^Encountered an error:/i.test(text)) return
          if (/^Starting task:/i.test(text)) return
          if (/^Task completed successfully/i.test(text)) return
          if (/^Error occurred:/i.test(text)) return
          if (/^⏱️ AI response timed out/i.test(text)) return
          if (/^⚠️ Error reaching AI:/i.test(text)) return

          // ── WhatsApp Integration ────────────────────────────────────────────
          // Clean up WhatsApp message formatting for display in chat
          let displayText = text
          let messageRole: 'user' | 'assistant' = 'assistant'

          // User message from WhatsApp: strip "WhatsApp command:" prefix and show as user
          if (/^WhatsApp command:/i.test(text)) {
            displayText = text.replace(/^WhatsApp command:\s*/i, '').trim()
            messageRole = 'user'
          }

          // AI response from directive-response: show as assistant
          const isDirectiveResponse = ev.payload?.source === 'directive-response'
          if (isDirectiveResponse) {
            messageRole = 'assistant'
          }

          if (!displayText || displayText.length < 2) return

          // Map known agent IDs to friendly names
          const AGENT_NAMES: Record<string, string> = {
            'claude-code-main': '🤖 Claude Code',
            'whatsapp-relay': '📱 WhatsApp',
            'cursor-main': '📝 Cursor',
            'openai-main': '🧠 OpenAI',
            'gemini-main': '💎 Gemini',
            'crewai-main': '👥 CrewAI',
            'autogen-main': '🔄 AutoGen',
            'langchain-main': '🔗 LangChain',
            'openclaw-main': '🦞 OpenClaw',
          }
          const agentName = AGENT_NAMES[ev.agentId] || ev.agentId.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'External AI'

          const msg: ChatMessage = {
            id: `ext-${Date.now()}-${++extMsgCounterRef.current}`,
            role: messageRole,
            content: displayText,
            timestamp: Date.now(),
            model: agentName,
          }
          setSession(prev => {
            if (!prev) return prev
            if (prev.messages.some(m => m.id === msg.id)) return prev
            const updated = addMessage(prev.id, msg)
            return updated ? { ...updated } : prev
          })
          // Speak external agent responses aloud (skip WhatsApp user echoes)
          if (messageRole === 'assistant') speakText(displayText)
        }
      } catch { /* ignore parse errors */ }
    })

    es.onerror = () => {
      // EventSource auto-reconnects — just log for debugging
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[console] SSE stream error — will auto-reconnect')
      }
    }

    return () => {
      es.close()
      sseSourceRef.current = null
    }
  }, [gatewayUrl, sessionId, authToken, sessionSignature, speakText])

  // Initialize session — always start fresh on mount so connecting to a new
  // tool never shows old conversation history. Old sessions remain in storage
  // and can be browsed via the session history panel.
  useEffect(() => {
    const newSession = createSession(selectedModel.id)
    saveSession(newSession)
    setActiveSessionId(newSession.id)
    setSession(newSession)
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
    speakText(`Thinking about: ${userInput.slice(0, 80)}`)

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
      speakText(`Generating response with ${selectedModel.name}`)

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
      speakText(fullText)
      if (lastInputTokens > 0 || lastOutputTokens > 0) {
        consoleAgentCost(lastInputTokens, lastOutputTokens, cost)
      }
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
        speakText(`Error: ${errMsg.slice(0, 80)}`)
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [session, isStreaming, selectedModel, apiKeys, ollamaBaseUrl, gatewayUrl, authToken, sessionSignature, speakText])

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

    // Specialized multi-agent orchestrator: sends directive with "multi-agent" keyword so
    // the orchestrator process picks it up and assigns Architect/Coder/Tester/Reviewer/Debugger agents
    if (cmd === '/agents') {
      const task = (args || '').trim()
      if (!task) return
      if (gatewayUrl) {
        const dirHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (authToken) dirHeaders['Authorization'] = `Bearer ${authToken}`
        if (sessionSignature) dirHeaders['X-Session-Signature'] = sessionSignature
        fetch(`${gatewayUrl}/v1/directives`, {
          method: 'POST', headers: dirHeaders,
          body: JSON.stringify({ instruction: `multi-agent: ${task}`, source: 'console-agents' }),
        }).catch(() => {})
      }
      speakText(`Dispatching multi-agent orchestration for: ${task.slice(0, 60)}`)
      void handleSend(`[Multi-Agent Orchestration] Dispatching task to specialized agents (Architect, Coder, Tester, Reviewer, Debugger):\n\n${task}`)
      return
    }

    // Multi-agent broadcast: push directive to ALL connected agents + run local AI in parallel
    if (cmd === '/multi') {
      const task = (args || '').trim()
      if (!task) return
      // Broadcast to connected agents via gateway directive queue
      if (gatewayUrl) {
        const dirHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (authToken) dirHeaders['Authorization'] = `Bearer ${authToken}`
        if (sessionSignature) dirHeaders['X-Session-Signature'] = sessionSignature
        fetch(`${gatewayUrl}/v1/directives`, {
          method: 'POST', headers: dirHeaders,
          body: JSON.stringify({ instruction: task, source: 'multi-agent-broadcast' }),
        }).catch(() => {})
      }
      // Also run via local AI provider as one of the agents
      void handleSend(`[Multi-Agent Task] ${task}`)
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
  }, [handleSend, onAgentCommand, session, gatewayUrl, authToken, sessionSignature, speakText])

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

      {/* Chat / Goal Mode Toggle */}
      <div className="shrink-0 px-3 pt-2 flex items-center gap-1">
        <button
          onClick={() => setConsoleMode('chat')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            consoleMode === 'chat'
              ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300'
              : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/60'
          }`}
        >
          💬 Chat Mode
        </button>
        <button
          onClick={() => setConsoleMode('goal')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            consoleMode === 'goal'
              ? 'bg-violet-500/20 border border-violet-500/30 text-violet-300'
              : 'bg-white/5 border border-white/10 text-white/40 hover:text-white/60'
          }`}
        >
          🎯 Goal Mode
        </button>
        {consoleMode === 'goal' && (
          <span className="text-[10px] text-white/30 ml-2">Supervised multi-agent orchestration</span>
        )}
        <div className="ml-auto">
          <button
            onClick={toggleVoice}
            title={voiceEnabled ? 'Voice on — click to mute' : 'Voice off — click to enable'}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              voiceEnabled
                ? 'bg-green-500/20 border-green-500/30 text-green-300'
                : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
            }`}
          >
            {voiceEnabled ? '🔊 Voice' : '🔇 Voice'}
          </button>
        </div>
      </div>

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

      {/* Provider not yet detected — inline quick key entry */}
      {!apiKeys[selectedModel.provider] && !serverProviders[selectedModel.provider] && selectedModel.provider !== 'ollama' && messages.length === 0 && !error && (
        <div className="shrink-0 mx-3 mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 overflow-hidden">
          {!inlineKeyExpanded ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <span>🔑</span>
              <span className="flex-1">No <strong>{selectedModel.provider}</strong> API key — paste yours to start chatting instantly.</span>
              <button
                onClick={() => setInlineKeyExpanded(true)}
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 shrink-0 font-medium whitespace-nowrap"
              >
                Enter Key ▾
              </button>
            </div>
          ) : (
            <div className="px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <span>🔑</span>
                <span className="flex-1 font-semibold text-amber-200">Paste your {selectedModel.provider} API key:</span>
                <button onClick={() => { setInlineKeyExpanded(false); setInlineKeyInput('') }} className="text-amber-400/60 hover:text-amber-400">✕</button>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={inlineKeyInput}
                  onChange={e => setInlineKeyInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && inlineKeyInput.trim()) {
                      handleApiKeyChange(selectedModel.provider as ProviderId, inlineKeyInput.trim())
                      setInlineKeyInput('')
                      setInlineKeyExpanded(false)
                    }
                    if (e.key === 'Escape') { setInlineKeyExpanded(false); setInlineKeyInput('') }
                  }}
                  placeholder={`sk-ant-... / sk-... / AIza...`}
                  autoFocus
                  className="flex-1 bg-black/30 border border-amber-500/30 rounded px-2 py-1 text-white placeholder-white/20 font-mono outline-none focus:border-amber-400/60 text-xs"
                />
                <button
                  onClick={() => {
                    if (inlineKeyInput.trim()) {
                      handleApiKeyChange(selectedModel.provider as ProviderId, inlineKeyInput.trim())
                      setInlineKeyInput('')
                      setInlineKeyExpanded(false)
                    }
                  }}
                  disabled={!inlineKeyInput.trim()}
                  className="px-3 py-1 rounded bg-amber-500/30 hover:bg-amber-500/50 border border-amber-500/40 text-amber-100 font-bold disabled:opacity-40 whitespace-nowrap"
                >
                  Save ✓
                </button>
              </div>
              <div className="text-amber-400/60 text-[10px]">Saved locally in your browser. Or set ANTHROPIC_API_KEY in packages/gateway/.env for auto-detection.</div>
            </div>
          )}
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

      {consoleMode === 'chat' ? (
        <>
          <ChatHistory
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            modelName={selectedModel.name}
          />

          <OutputPanel
            lastResponse={messages.findLast(m => m.role === 'assistant')?.content || ''}
            userCommand={messages.findLast(m => m.role === 'user')?.content}
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
        </>
      ) : (
        <GoalMode
          sessionId={sessionId || 'default'}
          gatewayUrl={gatewayUrl}
        />
      )}
    </div>
  )
}
