'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export interface AgentAction {
  id: string
  agentId: string
  timestamp: number
  type: 'file_create' | 'file_edit' | 'tool_call' | 'message' | 'state_change' | 'redirect' | 'handoff'
  description: string
  details?: string
  tokens?: number
  cost?: number
  duration?: number
}

export interface AgentControlState {
  agentId: string
  isPaused: boolean
  isStopped: boolean
  actions: AgentAction[]
  redirectHistory: Array<{ ts: number; instruction: string }>
}

interface InterventionConfig {
  gatewayUrl: string
  sessionId: string
  authToken?: string
  sessionSignature?: string
}

export function useAgentIntervention(config: InterventionConfig) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [controlStates, setControlStates] = useState<Map<string, AgentControlState>>(new Map())
  const [confirmDialog, setConfirmDialog] = useState<{
    action: string
    agentId: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // Per-instance state map (useRef prevents re-renders and avoids module-level leak)
  const agentStatesRef = useRef(new Map<string, AgentControlState>())
  const agentStates = agentStatesRef.current

  const configRef = useRef(config)
  useEffect(() => { configRef.current = config })

  // Cleanup on unmount — prevent Map entries from surviving component lifecycle
  useEffect(() => {
    return () => { agentStatesRef.current.clear() }
  }, [])

  // Post an event to the gateway via HTTP ingest
  const ingest = useCallback(async (type: string, agentId: string, payload: Record<string, unknown>) => {
    const { gatewayUrl, sessionId, authToken, sessionSignature } = configRef.current
    if (!gatewayUrl || !sessionId) return
    const event = { v: 1, ts: Date.now(), sessionId, agentId, type, payload }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`
    if (sessionSignature) headers['X-Session-Signature'] = sessionSignature
    try {
      await fetch(`${gatewayUrl}/v1/ingest`, { method: 'POST', headers, body: JSON.stringify(event) })
    } catch {
      // Silently fail — gateway may not be available
    }
  }, [])

  const getOrCreate = useCallback((agentId: string): AgentControlState => {
    if (!agentStates.has(agentId)) {
      agentStates.set(agentId, {
        agentId, isPaused: false, isStopped: false, actions: [], redirectHistory: [],
      })
    }
    return agentStates.get(agentId)!
  }, [])

  const refreshState = useCallback(() => {
    setControlStates(new Map(agentStates))
  }, [])

  const selectAgent = useCallback((agentId: string | null) => {
    setSelectedAgentId(agentId)
    if (agentId) getOrCreate(agentId)
  }, [getOrCreate])

  const pauseAgent = useCallback((agentId: string) => {
    const state = getOrCreate(agentId)
    state.isPaused = true
    refreshState()
    void ingest('agent.state', agentId, { state: 'waiting', paused: true })
  }, [ingest, getOrCreate, refreshState])

  const resumeAgent = useCallback((agentId: string) => {
    const state = getOrCreate(agentId)
    state.isPaused = false
    refreshState()
    void ingest('agent.state', agentId, { state: 'thinking', resumed: true })
  }, [ingest, getOrCreate, refreshState])

  const stopAgent = useCallback((agentId: string) => {
    setConfirmDialog({
      action: 'stop',
      agentId,
      message: `Stop agent "${agentId}"? Progress will be saved.`,
      onConfirm: () => {
        const state = getOrCreate(agentId)
        state.isStopped = true
        state.isPaused = false
        refreshState()
        void ingest('agent.end', agentId, { reason: 'user_stopped', saveProgress: true })
        setConfirmDialog(null)
      },
    })
  }, [ingest, getOrCreate, refreshState])

  const redirectAgent = useCallback((agentId: string, instruction: string) => {
    const state = getOrCreate(agentId)
    state.redirectHistory.push({ ts: Date.now(), instruction })
    state.actions.push({
      id: `action-${Date.now()}`,
      agentId,
      timestamp: Date.now(),
      type: 'redirect',
      description: `Redirected: ${instruction.slice(0, 60)}`,
    })
    refreshState()
    void ingest('agent.message', agentId, { type: 'redirect', text: instruction, redirect: true })
  }, [ingest, getOrCreate, refreshState])

  const handoffAgent = useCallback((fromAgentId: string, toAgentId: string, note?: string) => {
    setConfirmDialog({
      action: 'handoff',
      agentId: fromAgentId,
      message: `Hand off "${fromAgentId}" to "${toAgentId}"?`,
      onConfirm: () => {
        void ingest('agent.message', fromAgentId, {
          type: 'handoff', toAgentId, note: note || '', text: `Handing off to ${toAgentId}`,
        })
        void ingest('agent.message', toAgentId, {
          type: 'handoff_received', fromAgentId, text: `Received handoff from ${fromAgentId}`,
        })
        void ingest('agent.state', fromAgentId, { state: 'done', handedOff: true })
        setConfirmDialog(null)
      },
    })
  }, [ingest])

  const addAction = useCallback((agentId: string, action: Omit<AgentAction, 'id' | 'agentId'>) => {
    const state = getOrCreate(agentId)
    const newAction: AgentAction = {
      ...action,
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentId,
    }
    state.actions = [...state.actions.slice(-99), newAction]
    refreshState()
  }, [getOrCreate, refreshState])

  const dismissConfirm = useCallback(() => setConfirmDialog(null), [])

  const getAgentState = useCallback((agentId: string) => {
    return agentStates.get(agentId) || null
  }, [])

  return {
    selectedAgentId,
    controlStates,
    confirmDialog,
    selectAgent,
    pauseAgent,
    resumeAgent,
    stopAgent,
    redirectAgent,
    handoffAgent,
    addAction,
    dismissConfirm,
    getAgentState,
  }
}
