'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { AgentArcadePanel } from '@/lib/agent-arcade'

const getGatewayUrl = () =>
  typeof window === 'undefined'
    ? 'http://localhost:8787'
    : process.env.NEXT_PUBLIC_GATEWAY_URL || `${window.location.protocol}//${window.location.hostname}:8787`

const subscribeNoop = () => () => {}

function useGatewayUrl() {
  return useSyncExternalStore(subscribeNoop, getGatewayUrl, () => 'http://localhost:8787')
}

interface SessionAuthState {
  token: string
  sessionId: string
  sessionSignature: string
}

export default function Home() {
  const gatewayUrl = useGatewayUrl()
  const [auth, setAuth] = useState<SessionAuthState | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionInput, setSessionInput] = useState('')

  const lockSession = (process.env.NEXT_PUBLIC_LOCK_SESSION_ID || '1') === '1'

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
  }, [])

  const refreshSession = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/session-token', { cache: 'no-store' })
      const data = await res.json() as { token?: string; sessionId?: string; sessionSignature?: string; error?: string }
      if (!res.ok || !data.sessionId || !data.sessionSignature) {
        throw new Error(data.error || 'Failed to refresh session')
      }
      setAuth({ token: data.token || '', sessionId: data.sessionId, sessionSignature: data.sessionSignature })
      setSessionInput(data.sessionId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to refresh session')
    } finally {
      setLoading(false)
    }
  }

  const activeSessionId = lockSession ? (auth?.sessionId || '') : (sessionInput || auth?.sessionId || '')

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎮</span>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                Agent Arcade
              </h1>
              <p className="text-xs text-muted-foreground">Universal Agent Visualizer</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-500 animate-pulse' : auth ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-muted-foreground">{loading ? 'Authenticating…' : auth ? 'Secured' : 'Error'}</span>
            <input
              className="bg-muted px-2 py-1 rounded font-mono text-xs w-48 disabled:opacity-50"
              value={activeSessionId}
              onChange={e => setSessionInput(e.target.value)}
              placeholder="session-id"
              disabled={lockSession}
            />
            <button
              className="px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80"
              onClick={refreshSession}
            >
              Refresh Token
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
          <AgentArcadePanel
            gatewayUrl={gatewayUrl}
            sessionId={activeSessionId}
            authToken={auth.token}
            sessionSignature={auth.sessionSignature}
            showControls
            width={800}
            height={500}
          />
        )}
      </main>

      <footer className="border-t bg-card/50 py-2 px-4 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>Gateway: {gatewayUrl} · Protocol v1</span>
        <span>Agent Arcade — Secure Telemetry Visualizer</span>
      </footer>
    </div>
  )
}
