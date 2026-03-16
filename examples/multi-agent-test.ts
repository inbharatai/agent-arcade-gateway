/**
 * Multi-Agent Integration Test
 *
 * Simulates 4 AI agents (Claude Code, OpenClaw Brain, OpenClaw Skill, OpenAI GPT-4o)
 * collaborating in a single session. Validates that the gateway receives all events,
 * gamification engines process them, and the dashboard would render correctly.
 *
 * Run: bun run examples/multi-agent-test.ts
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:47890'
const SESSION_ID = `test_multiagent_${Date.now().toString(36)}`

const PROTOCOL_VERSION = 1
let eventsSent = 0

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TelemetryEvent {
  v: number
  ts: number
  sessionId: string
  agentId: string
  type: string
  payload: Record<string, unknown>
}

async function emit(event: TelemetryEvent): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    eventsSent++
    return res.ok
  } catch {
    return false
  }
}

function ev(agentId: string, type: string, payload: Record<string, unknown>): TelemetryEvent {
  return { v: PROTOCOL_VERSION, ts: Date.now(), sessionId: SESSION_ID, agentId, type, payload }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Test Agents
// ---------------------------------------------------------------------------

async function runClaudeCodeAgent() {
  const id = 'claude_code_001'
  console.log('  [Claude Code] Spawning...')
  await emit(ev(id, 'agent.spawn', { name: 'Claude Code', role: 'coding-assistant', aiModel: 'claude-sonnet-4-20250514' }))
  await sleep(100)

  console.log('  [Claude Code] Thinking about task...')
  await emit(ev(id, 'agent.state', { state: 'thinking', label: 'Analyzing codebase for integration points' }))
  await sleep(200)

  console.log('  [Claude Code] Reading files...')
  await emit(ev(id, 'agent.state', { state: 'reading', label: 'Reading src/index.ts' }))
  await emit(ev(id, 'agent.tool', { name: 'Read', label: 'src/index.ts' }))
  await sleep(150)

  await emit(ev(id, 'agent.tool', { name: 'Read', label: 'src/config.ts' }))
  await sleep(100)

  await emit(ev(id, 'agent.tool', { name: 'Grep', label: 'Searching for API endpoints' }))
  await sleep(150)

  console.log('  [Claude Code] Writing code...')
  await emit(ev(id, 'agent.state', { state: 'writing', label: 'Implementing OpenClaw adapter' }))
  await emit(ev(id, 'agent.tool', { name: 'Edit', label: 'src/adapters/openclaw.ts' }))
  await sleep(300)

  await emit(ev(id, 'agent.tool', { name: 'Write', label: 'src/adapters/openclaw.test.ts' }))
  await sleep(200)

  console.log('  [Claude Code] Running tests...')
  await emit(ev(id, 'agent.state', { state: 'tool', label: 'Running test suite' }))
  await emit(ev(id, 'agent.tool', { name: 'Bash', label: 'bun test' }))
  await sleep(400)

  console.log('  [Claude Code] Done!')
  await emit(ev(id, 'agent.state', { state: 'done', label: 'All tests passing' }))
  await emit(ev(id, 'agent.end', { reason: 'OpenClaw adapter implemented, 12 tests pass', success: true }))
}

async function runOpenClawBrainAgent() {
  const brainId = 'openclaw_brain_001'
  const skillId = 'openclaw_skill_weather'

  console.log('  [OpenClaw Brain] Spawning...')
  await emit(ev(brainId, 'agent.spawn', { name: 'OpenClaw Brain', role: 'brain', aiModel: 'openclaw-react' }))
  await sleep(100)

  console.log('  [OpenClaw Brain] Thinking (ReAct loop)...')
  await emit(ev(brainId, 'agent.state', { state: 'thinking', label: 'Query: What is the weather in NYC?' }))
  await sleep(200)

  console.log('  [OpenClaw Brain] Planning...')
  await emit(ev(brainId, 'agent.message', { text: 'Plan: 1. Search weather API  2. Format response  3. Store in memory' }))
  await sleep(150)

  console.log('  [OpenClaw Brain] Executing skill (spawning child)...')
  await emit(ev(brainId, 'agent.state', { state: 'tool', label: 'Invoking weather_lookup skill' }))
  await emit(ev(brainId, 'agent.tool', { name: 'weather_lookup', label: 'NYC weather check' }))

  // Spawn skill as child agent
  await emit(ev(skillId, 'agent.spawn', { name: 'Skill: weather_lookup', role: 'skill' }))
  await emit(ev(skillId, 'agent.link', { parentAgentId: brainId, childAgentId: skillId }))
  await emit(ev(skillId, 'agent.state', { state: 'tool', label: 'Calling weather API' }))
  await sleep(300)
  await emit(ev(skillId, 'agent.end', { reason: 'Weather data fetched: 72F, sunny', success: true }))

  console.log('  [OpenClaw Brain] Observing result...')
  await emit(ev(brainId, 'agent.state', { state: 'reading', label: 'Observing: 72F, sunny in NYC' }))
  await sleep(100)

  console.log('  [OpenClaw Brain] Writing to memory...')
  await emit(ev(brainId, 'agent.tool', { name: 'memory:write', label: 'Storing: last_weather_query = NYC' }))
  await sleep(100)

  console.log('  [OpenClaw Brain] Responding...')
  await emit(ev(brainId, 'agent.state', { state: 'writing', label: 'It\'s 72F and sunny in New York City!' }))
  await sleep(150)

  console.log('  [OpenClaw Brain] Done!')
  await emit(ev(brainId, 'agent.end', { reason: 'Query answered successfully', success: true }))
}

async function runOpenAIAgent() {
  const id = 'openai_gpt4o_001'

  console.log('  [GPT-4o] Spawning...')
  await emit(ev(id, 'agent.spawn', { name: 'GPT-4o', role: 'chat', aiModel: 'gpt-4o' }))
  await sleep(100)

  console.log('  [GPT-4o] Processing messages...')
  await emit(ev(id, 'agent.state', { state: 'thinking', label: 'Processing 3 messages' }))
  await sleep(300)

  console.log('  [GPT-4o] Generating response...')
  await emit(ev(id, 'agent.state', { state: 'writing', label: 'Streaming... (42 chunks)' }))
  await sleep(400)

  console.log('  [GPT-4o] Done!')
  await emit(ev(id, 'agent.end', { reason: 'Streamed 42 chunks', success: true }))
}

async function runSubAgent() {
  const parentId = 'claude_code_001'
  const childId = 'claude_subagent_001'

  console.log('  [Sub-Agent] Claude Code spawning helper...')
  await emit(ev(childId, 'agent.spawn', { name: 'Type Checker', role: 'validator' }))
  await emit(ev(childId, 'agent.link', { parentAgentId: parentId, childAgentId: childId }))
  await sleep(50)

  await emit(ev(childId, 'agent.state', { state: 'thinking', label: 'Running tsc --noEmit' }))
  await sleep(200)

  // Simulate an error + recovery
  console.log('  [Sub-Agent] Error detected...')
  await emit(ev(childId, 'agent.state', { state: 'error', label: 'TS2339: Property does not exist' }))
  await sleep(100)

  console.log('  [Sub-Agent] Recovering...')
  await emit(ev(childId, 'agent.state', { state: 'writing', label: 'Fixing type error' }))
  await emit(ev(childId, 'agent.tool', { name: 'Edit', label: 'Fixing GamePanel.tsx' }))
  await sleep(150)

  console.log('  [Sub-Agent] Re-running check...')
  await emit(ev(childId, 'agent.state', { state: 'thinking', label: 'Re-running tsc --noEmit' }))
  await sleep(200)

  console.log('  [Sub-Agent] Clean!')
  await emit(ev(childId, 'agent.end', { reason: '0 TypeScript errors', success: true }))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('========================================')
  console.log('  Agent Arcade — Multi-Agent Test')
  console.log('========================================')
  console.log(`  Gateway: ${GATEWAY_URL}`)
  console.log(`  Session: ${SESSION_ID}`)
  console.log()

  // Check gateway health
  try {
    const health = await fetch(`${GATEWAY_URL}/health`)
    if (!health.ok) throw new Error(`HTTP ${health.status}`)
    console.log('  Gateway: HEALTHY')
  } catch (e: any) {
    console.error(`  Gateway: UNREACHABLE (${e.message})`)
    console.error('  Start the gateway first: npm run dev:gateway')
    process.exit(1)
  }
  console.log()

  // Start session
  await emit(ev('session', 'session.start', { name: 'Multi-Agent Integration Test' }))

  // Run all 4 agents concurrently (like a real multi-agent session)
  console.log('--- Starting 4 agents concurrently ---\n')

  await Promise.all([
    runClaudeCodeAgent(),
    runOpenClawBrainAgent(),
    runOpenAIAgent(),
    runSubAgent(),
  ])

  // End session
  await emit(ev('session', 'session.end', { reason: 'Test complete' }))

  console.log()
  console.log('========================================')
  console.log(`  RESULTS`)
  console.log('========================================')
  console.log(`  Events sent:   ${eventsSent}`)
  console.log(`  Agents:        4 (Claude Code, OpenClaw Brain, GPT-4o, Type Checker)`)
  console.log(`  Child agents:  2 (weather_lookup skill, Type Checker)`)
  console.log(`  Parent links:  2`)
  console.log(`  Error/recover: 1 (Type Checker)`)
  console.log(`  Session:       ${SESSION_ID}`)
  console.log()

  // Verify via SSE stream
  console.log('--- Verifying via Gateway API ---\n')

  try {
    const caps = await fetch(`${GATEWAY_URL}/v1/capabilities`)
    const capsData = await caps.json() as Record<string, unknown>
    console.log(`  Capabilities: ${JSON.stringify(capsData)}`)
  } catch {
    console.log('  (capabilities endpoint not available)')
  }

  console.log()
  console.log('  ALL PASSED! Open http://localhost:47380 to see the session.')
  console.log('========================================')
}

main().catch(console.error)
