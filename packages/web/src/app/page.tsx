'use client'

import { useEffect, useState, useSyncExternalStore, useCallback } from 'react'
import { AgentArcadePanel, useAgentArcadeStore } from '@/lib/agent-arcade'
import { ArcadeConsole } from '@/components/ArcadeConsole'
import { SplitPanel } from '@/components/layout/SplitPanel'
import { ControlPanel } from '@/components/AgentIntervention/ControlPanel'
import { NotificationToast, useNotifications } from '@/components/AgentIntervention/NotificationToast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useArcadeConsole } from '@/hooks/useArcadeConsole'
import { useAgentIntervention } from '@/hooks/useAgentIntervention'

const getGatewayUrl = () =>
  typeof window === 'undefined'
    ? 'http://localhost:47890'
    : process.env.NEXT_PUBLIC_GATEWAY_URL || `${window.location.protocol}//${window.location.hostname}:47890`

const subscribeNoop = () => () => {}

function useGatewayUrl() {
  return useSyncExternalStore(subscribeNoop, getGatewayUrl, () => 'http://localhost:47890')
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    // Use 640px (sm) as mobile threshold so tablets/small laptops get the split layout
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

interface SessionAuthState {
  token: string
  sessionId: string
  sessionSignature: string
}

function purgeStaleCacheOnNewSession(newSessionId: string) {
  if (typeof window === 'undefined') return
  try {
    // Only nuke session-specific data; preserve API keys, model choice, settings
    const sessionKey = 'arcade-active-session'
    const prevSession = localStorage.getItem(sessionKey)
    if (prevSession && prevSession !== newSessionId) {
      // New session → clear stale console conversation caches
      for (const key of Object.keys(localStorage)) {
        if (
          key.startsWith('arcade-session-') ||
          key === 'arcade-console-active-session'
        ) {
          localStorage.removeItem(key)
        }
      }
    }
    localStorage.setItem(sessionKey, newSessionId)
  } catch { /* quota / private mode */ }
}

export default function Home() {
  const gatewayUrl = useGatewayUrl()
  const isMobile = useIsMobile()
  const [auth, setAuth] = useState<SessionAuthState | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionInput, setSessionInput] = useState('')
  const [activeTab, setActiveTab] = useState<'arcade' | 'console'>('arcade')

  // Use loadState([], []) instead of reset() so we clear agents without
  // killing the live socket connection (reset() sets status='disconnected')
  const arcadeLoadState = useAgentArcadeStore(s => s.loadState)
  const arcadeReset = useCallback(() => arcadeLoadState([], []), [arcadeLoadState])

  const lockSession = (process.env.NEXT_PUBLIC_LOCK_SESSION_ID || '1') === '1'
  const activeSessionId = lockSession ? (auth?.sessionId || '') : (sessionInput || auth?.sessionId || '')

  // Console + bridge — use HTTP-based bridge, no socket needed
  const { consoleOpen, toggleConsole } = useArcadeConsole({
    gatewayUrl,
    sessionId: activeSessionId,
    authToken: auth?.token,
    sessionSignature: auth?.sessionSignature,
  })

  // Agent intervention — uses HTTP POST to ingest
  const {
    selectedAgentId, confirmDialog,
    selectAgent, pauseAgent, resumeAgent, stopAgent, redirectAgent, handoffAgent, dismissConfirm,
    getAgentState,
  } = useAgentIntervention({
    gatewayUrl,
    sessionId: activeSessionId,
    authToken: auth?.token,
    sessionSignature: auth?.sessionSignature,
  })

  const { toasts, dismiss: dismissToast } = useNotifications()

  // Read agents from the arcade store for ControlPanel
  const agentsList = useAgentArcadeStore(s => s.agentsList)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      setLoading(true)
      setErrorMsg(null)
      try {
        const res = await fetch('/api/session-token', { cache: 'no-store' })
        const data = await res.json() as { token?: string; sessionId?: string; sessionSignature?: string; error?: string }
        if (!res.ok || !data.sessionId || !data.sessionSignature) {
          throw new Error(data.error || 'Failed to acquire session token')
        }
        if (!mounted) return
        purgeStaleCacheOnNewSession(data.sessionId)
        arcadeReset()
        setAuth({ token: data.token || '', sessionId: data.sessionId, sessionSignature: data.sessionSignature })
        setSessionInput(data.sessionId)
      } catch (err) {
        if (!mounted) return
        setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize session')
        setAuth(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [arcadeReset])

  const refreshSession = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/session-token', { cache: 'no-store' })
      const data = await res.json() as { token?: string; sessionId?: string; sessionSignature?: string; error?: string }
      if (!res.ok || !data.sessionId || !data.sessionSignature) {
        throw new Error(data.error || 'Failed to refresh session')
      }
      purgeStaleCacheOnNewSession(data.sessionId)
      arcadeReset()
      setAuth({ token: data.token || '', sessionId: data.sessionId, sessionSignature: data.sessionSignature })
      setSessionInput(data.sessionId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to refresh session')
    } finally {
      setLoading(false)
    }
  }

  const handleAgentCommand = useCallback((cmd: string, agentId?: string, args?: string) => {
    if (!agentId) return
    if (cmd === '/pause') pauseAgent(agentId)
    else if (cmd === '/stop') stopAgent(agentId)
    else if (cmd === '/redirect' && args) redirectAgent(agentId, args)
    else if (cmd === '/status') selectAgent(agentId)
  }, [pauseAgent, stopAgent, redirectAgent, selectAgent])

  return (
    <ErrorBoundary>
    <div className="min-h-screen flex flex-col bg-background" style={{ height: '100dvh' }}>
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50 shrink-0">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎮</span>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                Agent Arcade
              </h1>
              <p className="text-xs text-muted-foreground">Universal AI Agent Cockpit v3.2</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-500 animate-pulse' : auth ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-muted-foreground hidden sm:block">
              {loading ? 'Authenticating…' : auth ? 'Secured' : 'Error'}
            </span>
            {/* Session ID — only visible on wide screens */}
            <input
              className="hidden lg:block bg-muted px-2 py-1 rounded font-mono text-xs w-36 disabled:opacity-50"
              value={activeSessionId}
              onChange={e => setSessionInput(e.target.value)}
              placeholder="session-id"
              disabled={lockSession}
            />
            <button
              className="px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80"
              onClick={refreshSession}
            >
              Refresh
            </button>
            {/* Console toggle — always visible, responsive sizing */}
            <button
              onClick={toggleConsole}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-bold transition-all shadow-lg flex items-center gap-1.5 sm:gap-2 shrink-0 ${consoleOpen ? 'bg-blue-600 text-white border-2 border-blue-400 shadow-blue-500/40' : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white border-2 border-purple-400/50 shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105'}`}
              title="Toggle Console (Ctrl+`)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {consoleOpen ? 'Console ✓' : 'Console'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {errorMsg && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="text-center space-y-3 p-6 rounded-xl bg-card border border-border shadow-lg max-w-sm">
              <div className="text-4xl">⚠️</div>
              <h2 className="font-bold text-lg">Initialization Error</h2>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <button
                onClick={refreshSession}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!auth && !errorMsg && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="text-center space-y-3 p-6">
              <div className="text-4xl animate-bounce">🎮</div>
              <h2 className="font-bold text-lg">Preparing secure session…</h2>
            </div>
          </div>
        )}

        {auth && (
          <>
            <SplitPanel
              consoleOpen={consoleOpen}
              onToggleConsole={toggleConsole}
              isMobile={isMobile}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              left={
                <div className="relative h-full flex overflow-hidden">
                  {/* Arcade map — shrinks when control panel is open */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <AgentArcadePanel
                      gatewayUrl={gatewayUrl}
                      sessionId={activeSessionId}
                      authToken={auth.token}
                      sessionSignature={auth.sessionSignature}
                      showControls
                      onAgentSelect={selectAgent}
                    />
                  </div>

                  {/* Agent Control Panel — right sidebar, never overlaps the canvas */}
                  {selectedAgentId && (() => {
                    const agent = agentsList.find(a => a.id === selectedAgentId)
                    if (!agent) return null
                    const controlState = getAgentState(selectedAgentId)
                    return (
                      <div className="w-64 xl:w-72 shrink-0 border-l border-white/10 overflow-y-auto bg-gray-900/95 backdrop-blur-sm flex flex-col">
                        <ControlPanel
                          agent={{
                            id: agent.id,
                            name: agent.name,
                            state: agent.state,
                            label: agent.label,
                            aiModel: agent.aiModel,
                            task: agent.task,
                            spawnedAt: agent.spawnedAt,
                          }}
                          controlState={controlState}
                          allAgents={agentsList.map(a => ({ id: a.id, name: a.name, state: a.state }))}
                          onClose={() => selectAgent(null)}
                          onPause={pauseAgent}
                          onResume={resumeAgent}
                          onStop={stopAgent}
                          onRedirect={redirectAgent}
                          onHandoff={handoffAgent}
                        />
                      </div>
                    )
                  })()}

                  {/* Confirm dialog for destructive actions */}
                  {confirmDialog && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                      <div className="bg-gray-900 border border-white/10 rounded-2xl p-5 shadow-2xl max-w-sm w-full mx-4 text-center space-y-4">
                        <div className="text-2xl">⚠️</div>
                        <p className="text-sm text-white/80">{confirmDialog.message}</p>
                        <div className="flex gap-3 justify-center">
                          <button
                            onClick={confirmDialog.onConfirm}
                            className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-sm font-medium transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={dismissConfirm}
                            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-sm font-medium transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              }
              right={
                <ArcadeConsole
                  gatewayUrl={gatewayUrl}
                  sessionId={activeSessionId}
                  authToken={auth.token}
                  sessionSignature={auth.sessionSignature}
                  connectedAgents={agentsList.length}
                  activeAgentModels={agentsList.map(a => a.aiModel).filter(Boolean) as string[]}
                  onAgentCommand={handleAgentCommand}
                />
              }
            />

            {/* Notification toasts */}
            <NotificationToast
              toasts={toasts}
              onDismiss={dismissToast}
              onAgentClick={agentId => selectAgent(agentId)}
            />
          </>
        )}
      </main>

      <footer className="border-t bg-card/50 py-2 px-4 text-[11px] text-muted-foreground flex items-center justify-between shrink-0">
        <span>Gateway: {gatewayUrl} · Protocol v1 · v3.2</span>
        <span className="hidden sm:block">Agent Arcade — Universal AI Agent Cockpit</span>
      </footer>
    </div>
    </ErrorBoundary>
  )
}
