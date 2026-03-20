/**
 * Telemetry provider hook — connects to the gateway via Socket.IO or SSE
 * and feeds events into the Zustand store.
 */

'use client'

import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAgentArcadeStore } from '../store'
import { TelemetryEvent, Agent, GatewayConfig } from '../types'

interface ProviderOpts extends GatewayConfig {
  autoConnect?: boolean
}

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_ATTEMPTS = 20
const STATE_REFRESH_INTERVAL_MS = 10000

export function useTelemetryProvider(opts: ProviderOpts) {
  const socketRef = useRef<Socket | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const hasHydratedRef = useRef(false)
  const wasDisconnectedRef = useRef(false)
  const cleanupIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const store = useAgentArcadeStore()

  // Periodic stale agent cleanup (every 10s):
  //   done agents removed after 20s, error after 30s, idle after 45s
  // Use getState() inside the callback so this effect has no reactive dependency
  // on the store object (which changes on every event and would otherwise cause
  // the interval to be cleared and recreated continuously).
  useEffect(() => {
    cleanupIntervalRef.current = setInterval(() => {
      useAgentArcadeStore.getState().cleanupStaleAgents(45000)
    }, 10000)
    return () => {
      if (cleanupIntervalRef.current) clearInterval(cleanupIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!opts.autoConnect || !opts.url || !opts.sessionId) return

    const { url, sessionId, authToken, apiKey, sessionSignature, transport = 'auto' } = opts
    store.setConfig({ url, sessionId, authToken, apiKey, sessionSignature, transport })
    store.setStatus('connecting')
    hasHydratedRef.current = false
    reconnectAttemptsRef.current = 0

    const hydrateFromSnapshot = (data: { agents: Agent[]; events: TelemetryEvent[] }) => {
      const local = useAgentArcadeStore.getState()

      // Reset state if reconnecting after a disconnect (fresh start)
      if (wasDisconnectedRef.current) {
        store.reset()
        wasDisconnectedRef.current = false
      }

      // Initial snapshot hydrates the full scene. Later snapshots are treated as
      // recovery-only to avoid frame reset/flicker when the gateway publishes
      // both incremental events and state on each update.
      if (!hasHydratedRef.current) {
        store.loadState(data.agents || [], data.events || [])
        hasHydratedRef.current = true
        return
      }

      // Gateway restarted with empty state — clear stale canvas roster so ghost agents disappear
      if ((data.agents?.length || 0) === 0 && local.agentsList.length > 0) {
        store.reset()
        return
      }

      if (local.agentsList.length === 0 && (data.agents?.length || 0) > 0) {
        store.loadState(data.agents || [], data.events || [])
      }
    }

    const attemptReconnect = () => {
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        store.setStatus('error')
        store.setError('Max reconnection attempts reached. Please refresh the page.')
        return
      }
      reconnectAttemptsRef.current++
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000)
      store.setStatus('connecting')
      store.setError(`Reconnecting (attempt ${reconnectAttemptsRef.current})...`)
      reconnectTimeoutRef.current = setTimeout(() => {
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      // Clean up existing connections
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      // ── Try WebSocket first ───────────────────────────────────────────
      if (transport !== 'sse') {
        const socket = io(url, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
          timeout: 10000,
          auth: { token: authToken || apiKey || undefined },
        })

        socket.on('connect', () => {
          store.setStatus('connected')
          store.setTransport('websocket')
          store.setError(null)
          reconnectAttemptsRef.current = 0
          socket.emit('subscribe', { sessionId, sig: sessionSignature })
          
          // Set up periodic state refresh to catch any missed events
          if (stateRefreshIntervalRef.current) clearInterval(stateRefreshIntervalRef.current)
          stateRefreshIntervalRef.current = setInterval(() => {
            if (socket.connected) {
              socket.emit('refresh', { sessionId })
            }
          }, STATE_REFRESH_INTERVAL_MS)
        })

        socket.on('state', (data: { agents: Agent[]; events: TelemetryEvent[] }) => {
          hydrateFromSnapshot(data)
        })

        socket.on('event', (ev: TelemetryEvent) => {
          store.processEvent(ev)
        })

        socket.on('disconnect', (reason) => {
          store.setStatus('disconnected')
          wasDisconnectedRef.current = true
          hasHydratedRef.current = false
          if (stateRefreshIntervalRef.current) clearInterval(stateRefreshIntervalRef.current)
          
          // Auto-reconnect for server-initiated disconnects
          if (reason === 'io server disconnect' || reason === 'transport close') {
            attemptReconnect()
          }
        })

        socket.on('connect_error', (err) => {
          console.warn('[agent-arcade] WebSocket connection error:', err.message)
          // Fall back to SSE
          if (transport === 'auto') {
            socket.disconnect()
            connectSSE(url, sessionId, authToken, apiKey, sessionSignature, store, esRef, hydrateFromSnapshot, attemptReconnect, stateRefreshIntervalRef)
          } else {
            attemptReconnect()
          }
        })

        socketRef.current = socket
      } else {
        connectSSE(url, sessionId, authToken, apiKey, sessionSignature, store, esRef, hydrateFromSnapshot, attemptReconnect, stateRefreshIntervalRef)
      }
    }

    // Initial connection
    connectSocket()

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (stateRefreshIntervalRef.current) clearInterval(stateRefreshIntervalRef.current)
      socketRef.current?.disconnect()
      socketRef.current = null
      esRef.current?.close()
      esRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url, opts.sessionId, opts.authToken, opts.apiKey, opts.sessionSignature, opts.autoConnect])
}

function connectSSE(
  url: string,
  sessionId: string,
  authToken: string | undefined,
  apiKey: string | undefined,
  sessionSignature: string | undefined,
  store: ReturnType<typeof useAgentArcadeStore.getState>,
  esRef: React.MutableRefObject<EventSource | null>,
  hydrateFromSnapshot: (data: { agents: Agent[]; events: TelemetryEvent[] }) => void,
  attemptReconnect: () => void,
  stateRefreshIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
) {
  const sseUrl = `${url}/v1/stream?sessionId=${encodeURIComponent(sessionId)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}${apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : ''}${sessionSignature ? `&sig=${encodeURIComponent(sessionSignature)}` : ''}`
  const es = new EventSource(sseUrl)

  es.addEventListener('state', (e) => {
    try {
      const data = JSON.parse(e.data) as { agents: Agent[]; events: TelemetryEvent[] }
      hydrateFromSnapshot(data)
    } catch (err) {
      console.warn('[agent-arcade] Failed to parse SSE state event:', err)
    }
  })

  es.addEventListener('event', (e) => {
    try {
      store.processEvent(JSON.parse(e.data) as TelemetryEvent)
    } catch (err) {
      console.warn('[agent-arcade] Failed to parse SSE event:', err)
    }
  })

  es.onopen = () => {
    store.setStatus('connected')
    store.setTransport('sse')
    store.setError(null)
    
    // Set up periodic state refresh via HTTP for SSE (since SSE is one-way)
    if (stateRefreshIntervalRef.current) clearInterval(stateRefreshIntervalRef.current)
    stateRefreshIntervalRef.current = setInterval(async () => {
      try {
        const stateUrl = `${url}/v1/state?sessionId=${encodeURIComponent(sessionId)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}${sessionSignature ? `&sig=${encodeURIComponent(sessionSignature)}` : ''}`
        const res = await fetch(stateUrl)
        if (res.ok) {
          const data = await res.json()
          if (data.agents?.length > 0) {
            hydrateFromSnapshot(data)
          }
        }
      } catch {
        // Ignore refresh errors
      }
    }, STATE_REFRESH_INTERVAL_MS)
  }

  es.onerror = () => {
    store.setStatus('error')
    store.setError('SSE connection failed')
    if (stateRefreshIntervalRef.current) clearInterval(stateRefreshIntervalRef.current)
    attemptReconnect()
  }

  esRef.current = es
}
