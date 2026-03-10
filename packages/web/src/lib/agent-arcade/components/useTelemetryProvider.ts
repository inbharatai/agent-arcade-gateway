/**
 * Telemetry provider hook — connects to the gateway via Socket.IO or SSE
 * and feeds events into the Zustand store.
 */

'use client'

import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAgentArcadeStore } from '../store'
import { TelemetryEvent, Agent, GatewayConfig } from '../types'

interface ProviderOpts extends GatewayConfig {
  autoConnect?: boolean
}

export function useTelemetryProvider(opts: ProviderOpts) {
  const socketRef = useRef<Socket | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const hasHydratedRef = useRef(false)
  const store = useAgentArcadeStore()

  useEffect(() => {
    if (!opts.autoConnect || !opts.url || !opts.sessionId) return

    const { url, sessionId, authToken, apiKey, sessionSignature, transport = 'auto' } = opts
    store.setConfig({ url, sessionId, authToken, apiKey, sessionSignature, transport })
    store.setStatus('connecting')
    hasHydratedRef.current = false

    const hydrateFromSnapshot = (data: { agents: Agent[]; events: TelemetryEvent[] }) => {
      const local = useAgentArcadeStore.getState()

      // Initial snapshot hydrates the full scene. Later snapshots are treated as
      // recovery-only to avoid frame reset/flicker when the gateway publishes
      // both incremental events and state on each update.
      if (!hasHydratedRef.current) {
        store.loadState(data.agents || [], data.events || [])
        hasHydratedRef.current = true
        return
      }

      if (local.agentsList.length === 0 && (data.agents?.length || 0) > 0) {
        store.loadState(data.agents || [], data.events || [])
      }
    }

    // ── Try WebSocket first ───────────────────────────────────────────
    if (transport !== 'sse') {
      const socket = io(url, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        auth: { token: authToken || apiKey || undefined },
      })

      socket.on('connect', () => {
        store.setStatus('connected')
        store.setTransport('websocket')
        socket.emit('subscribe', { sessionId, sig: sessionSignature })
      })

      socket.on('state', (data: { agents: Agent[]; events: TelemetryEvent[] }) => {
        hydrateFromSnapshot(data)
      })

      socket.on('event', (ev: TelemetryEvent) => {
        store.processEvent(ev)
      })

      socket.on('disconnect', () => {
        store.setStatus('disconnected')
      })

      socket.on('connect_error', () => {
        // Fall back to SSE
        if (transport === 'auto') {
          socket.disconnect()
          connectSSE(url, sessionId, authToken, apiKey, sessionSignature, store, esRef, hydrateFromSnapshot)
        } else {
          store.setStatus('error')
          store.setError('WebSocket connection failed')
        }
      })

      socketRef.current = socket
    } else {
      connectSSE(url, sessionId, authToken, apiKey, sessionSignature, store, esRef, hydrateFromSnapshot)
    }

    return () => {
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
  }

  es.onerror = () => {
    store.setStatus('error')
    store.setError('SSE connection failed')
  }

  esRef.current = es
}
