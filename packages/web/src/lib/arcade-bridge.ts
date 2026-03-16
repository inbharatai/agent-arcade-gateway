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
  if (!bridgeConfig?.gatewayUrl || !bridgeConfig.sessionId) return
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
    await fetch(`${bridgeConfig.gatewayUrl}/v1/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    })
  } catch {
    // Silently fail — gateway may not be running during SSR or offline
  }
}

const CONSOLE_AGENT_ID = '🎮-console'

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
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'thinking' })
  // Emit the raw prompt so the agent "says" what it received —
  // the onMessage voice callback will speak this directly
  void ingest('agent.message', CONSOLE_AGENT_ID, {
    text: prompt.slice(0, 100) + (prompt.length > 100 ? '…' : ''),
  })
}

export function consoleAgentWriting(model: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'writing' })
  void ingest('agent.tool', CONSOLE_AGENT_ID, { tool: `${model}-generation` })
}

export function consoleAgentDone(summary: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'idle' })
  void ingest('agent.message', CONSOLE_AGENT_ID, { text: `Done: ${summary.slice(0, 80)}` })
}

export function consoleAgentError(error: string): void {
  void ingest('agent.state', CONSOLE_AGENT_ID, { state: 'error' })
  void ingest('agent.message', CONSOLE_AGENT_ID, { text: `Error: ${error.slice(0, 80)}` })
}

export function consoleAgentCodeDetected(): void {
  void ingest('agent.tool', CONSOLE_AGENT_ID, { tool: 'code_generation' })
}
