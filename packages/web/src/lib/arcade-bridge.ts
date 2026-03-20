// Bridge between Arcade Console and the gateway — uses HTTP POST to /v1/ingest
// This avoids needing to expose the Socket.IO socket from AgentArcadePanel.

export interface ArcadeBridgeConfig {
  gatewayUrl: string
  sessionId: string
  authToken?: string
  sessionSignature?: string
}

let bridgeConfig: ArcadeBridgeConfig | null = null

export function initArcadeBridge(config: ArcadeBridgeConfig): void {
  bridgeConfig = config
}

async function ingest(type: string, agentId: string, payload: Record<string, unknown>): Promise<void> {
  if (!bridgeConfig?.gatewayUrl || !bridgeConfig.sessionId) {
    if (typeof console !== 'undefined') console.warn('[arcade-bridge] Cannot ingest — bridge not initialized (no gatewayUrl or sessionId)')
    return
  }
  const event = {
    v: 1,
    ts: Date.now(),
    sessionId: bridgeConfig.sessionId,
    agentId,
    type,
    payload,
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bridgeConfig.authToken) headers['Authorization'] = `Bearer ${bridgeConfig.authToken}`
  if (bridgeConfig.sessionSignature) headers['X-Session-Signature'] = bridgeConfig.sessionSignature

  try {
    const res = await fetch(`${bridgeConfig.gatewayUrl}/v1/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      console.warn(`[arcade-bridge] Ingest ${type} failed (${res.status}):`, err?.error || res.statusText)
    }
  } catch (e) {
    console.warn('[arcade-bridge] Ingest fetch error:', (e as Error).message)
  }
}

// 'console-' prefix ensures the Console chat SSE listener's agentId filter blocks these
// telemetry events from appearing as duplicate chat bubbles — canvas-only events.
const CONSOLE_AGENT_ID = 'console-arcade'

export function consoleAgentSpawn(): void {
  void ingest('agent.spawn', CONSOLE_AGENT_ID, {
    name: '🎮 Console',
    role: 'console',
    characterClass: 'operator',
    task: 'Arcade Console — natural language interface',
    aiModel: 'Console',
  })
}

export function consoleAgentThinking(prompt: string): void {
  const taskText = prompt.slice(0, 120)
  void ingest('agent.state', CONSOLE_AGENT_ID, {
    state: 'thinking',
    label: `Thinking: ${taskText}`,
    task: taskText,
  })
  // Emit a message so voice narration announces what the agent is working on
  void ingest('agent.message', CONSOLE_AGENT_ID, {
    text: `Thinking about your request: ${taskText}${prompt.length > 120 ? '…' : ''}`,
    level: 'info',
  })
}

export function consoleAgentWriting(model: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, {
    state: 'writing',
    label: `Generating response with ${model}`,
  })
  void ingest('agent.tool', CONSOLE_AGENT_ID, { name: `${model}-generation` })
  void ingest('agent.message', CONSOLE_AGENT_ID, {
    text: `Generating response with ${model}`,
    level: 'info',
  })
}

export function consoleAgentDone(summary: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'idle', label: 'Complete' })
  void ingest('agent.message', CONSOLE_AGENT_ID, {
    text: `Task complete. ${summary.slice(0, 100)}`,
    level: 'success',
  })
}

export function consoleAgentError(error: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'error', label: error.slice(0, 200) })
  void ingest('agent.message', CONSOLE_AGENT_ID, {
    text: `Encountered an error: ${error.slice(0, 120)}`,
    level: 'error',
  })
}

export function consoleAgentCodeDetected(): void {
  void ingest('agent.tool', CONSOLE_AGENT_ID, { name: 'code_generation' })
}

export function consoleAgentCost(inputTokens: number, outputTokens: number, cost: number): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, {
    state: 'idle',
    inputTokens,
    outputTokens,
    cost,
  })
}
