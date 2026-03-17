/**
 * Agent Arcade — Live Demo Bot
 *
 * Continuously emits realistic fake telemetry so anyone visiting the hosted demo
 * sees active agents without needing to connect their own tools.
 *
 * Run:  bun packages/demo-bot/index.ts
 * Env:  GATEWAY_URL (default: http://localhost:47890)
 *       SESSION_ID  (default: auto-generated each cycle)
 *       CYCLE_MS    (default: 300_000 = 5 minutes between full resets)
 */

const GATEWAY_URL = process.env.GATEWAY_URL?.replace(/\/$/, '') || 'http://localhost:47890'
const CYCLE_MS    = Number(process.env.CYCLE_MS || '300000')

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jitter(base: number, factor = 0.4): number {
  return Math.round(base * (1 - factor / 2 + Math.random() * factor))
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

async function post(sessionId: string, agentId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, ts: Date.now(), sessionId, agentId, type, payload }),
    })
  } catch {
    // Gateway might not be ready yet — suppress
  }
}

// ── Agent definitions ─────────────────────────────────────────────────────────

interface AgentDef {
  id: string
  name: string
  role: string
  model: string
  tools: string[]
  taskPool: string[]
  x: number
  y: number
}

const AGENTS: AgentDef[] = [
  {
    id: 'researcher',
    name: '🔍 Researcher',
    role: 'researcher',
    model: 'claude-sonnet-4-6',
    tools: ['web_search', 'read_file', 'grep', 'list_files', 'fetch_url'],
    taskPool: [
      'Analyzing competitor landscape for AI observability tools',
      'Researching LangSmith tracing API documentation',
      'Summarizing recent papers on multi-agent orchestration',
      'Mapping all SDK integration points for AutoGen 0.4',
      'Reviewing OpenTelemetry span schema for agent traces',
      'Finding open-source session replay implementations',
    ],
    x: 180,
    y: 200,
  },
  {
    id: 'coder',
    name: '⚙️ Coder',
    role: 'engineer',
    model: 'claude-opus-4-6',
    tools: ['read_file', 'edit_file', 'bash', 'write_file', 'glob', 'grep'],
    taskPool: [
      'Implementing SQLite WAL-mode persistence layer',
      'Adding budget alert threshold to CostDashboard',
      'Fixing react-hooks/purity lint violations in SessionReplay',
      'Writing CrewAI callback adapter with thread safety',
      'Refactoring TracePanel to support span comparison mode',
      'Adding CSV export to cost analytics component',
    ],
    x: 380,
    y: 200,
  },
  {
    id: 'reviewer',
    name: '✅ Reviewer',
    role: 'reviewer',
    model: 'claude-haiku-4-5-20251001',
    tools: ['read_file', 'grep', 'list_files', 'run_tests', 'eslint'],
    taskPool: [
      'Reviewing TypeScript strict-mode violations in gateway',
      'Validating all ESLint rules pass across packages',
      'Checking for React key prop issues in list renders',
      'Auditing rate-limit logic for bypass edge cases',
      'Reviewing span comparison UI for accessibility',
      'Verifying demo bot emits all required event types',
    ],
    x: 580,
    y: 200,
  },
]

// ── Scenario scripts ──────────────────────────────────────────────────────────

const THINKING_MESSAGES: Record<string, string[]> = {
  researcher: [
    'Scanning documentation sources...',
    'Cross-referencing prior research...',
    'Identifying knowledge gaps...',
    'Building context window...',
  ],
  engineer: [
    'Reading existing implementation...',
    'Planning code changes...',
    'Checking type compatibility...',
    'Considering edge cases...',
  ],
  reviewer: [
    'Parsing lint output...',
    'Tracing data flow...',
    'Verifying contract compliance...',
    'Scanning for security issues...',
  ],
}

const TOOL_MESSAGES: Record<string, string[]> = {
  web_search: ['Querying DuckDuckGo...', 'Parsing search results...'],
  read_file:  ['Reading source file...', 'Loading file contents...'],
  grep:       ['Running pattern search...', 'Scanning 847 files...'],
  list_files: ['Listing directory...', 'Building file tree...'],
  fetch_url:  ['Fetching remote resource...', 'Parsing HTML...'],
  edit_file:  ['Applying patch...', 'Updating source...'],
  bash:       ['Executing command...', 'Waiting for output...'],
  write_file: ['Writing to disk...', 'File created.'],
  glob:       ['Expanding glob pattern...', 'Found 23 matches.'],
  run_tests:  ['Running test suite...', 'Collecting coverage...'],
  eslint:     ['Running ESLint...', 'Analysing AST...'],
}

// ── Agent lifecycle for one work cycle ───────────────────────────────────────

async function runAgentCycle(sessionId: string, def: AgentDef, cycleIndex: number): Promise<void> {
  const task = def.taskPool[cycleIndex % def.taskPool.length]!
  const toolCount = 3 + Math.floor(Math.random() * 5)  // 3–7 tool calls
  const willError = Math.random() < 0.08               // ~8% chance of error

  // 1. Thinking
  await post(sessionId, def.id, 'agent.state', {
    state: 'thinking',
    label: `Thinking: ${task.slice(0, 60)}`,
    task,
    progress: 5,
  })
  await post(sessionId, def.id, 'agent.message', {
    text: pick(THINKING_MESSAGES[def.role] ?? THINKING_MESSAGES.researcher!),
  })
  await sleep(jitter(1800))

  // 2. Tool calls
  for (let i = 0; i < toolCount; i++) {
    const toolName = pick(def.tools)
    const toolMsg  = pick(TOOL_MESSAGES[toolName] ?? ['Running...'])
    const progress = Math.round(10 + (i / toolCount) * 70)

    await post(sessionId, def.id, 'agent.state', {
      state: 'tool',
      label: `Step ${i + 1}: ${toolName}`,
      progress,
    })
    await post(sessionId, def.id, 'agent.tool', { name: toolName })
    await post(sessionId, def.id, 'agent.message', { text: toolMsg })

    // Emit a span for tracing
    const spanId  = `span-${uid()}`
    const spanStart = Date.now()
    await sleep(jitter(900))
    const inputTokens  = 200 + Math.floor(Math.random() * 800)
    const outputTokens = 50  + Math.floor(Math.random() * 400)
    const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015)

    await post(sessionId, def.id, 'agent.span', {
      spanId,
      name: toolName,
      status: willError && i === toolCount - 1 ? 'error' : 'ok',
      startTs: spanStart,
      endTs: Date.now(),
      model: def.model,
      inputTokens,
      outputTokens,
      cost,
      input:  `{"tool":"${toolName}","step":${i + 1}}`,
      output: willError && i === toolCount - 1 ? '{"error":"timeout after 30s"}' : `{"result":"ok","rows":${Math.floor(Math.random() * 50)}}`,
    })
  }

  // 3. Error or writing
  if (willError) {
    await post(sessionId, def.id, 'agent.state', {
      state: 'error',
      label: 'Tool timeout — retrying',
      progress: 65,
    })
    await post(sessionId, def.id, 'agent.message', { text: 'Encountered an error. Will retry.' })
    await sleep(jitter(1200))
  }

  // 4. Writing / responding
  await post(sessionId, def.id, 'agent.state', {
    state: 'writing',
    label: `Writing response with ${def.model.split('-').slice(1, 3).join('-')}`,
    progress: 85,
  })
  await sleep(jitter(1400))

  // 5. Done
  const inputTokens  = 800  + Math.floor(Math.random() * 1200)
  const outputTokens = 400  + Math.floor(Math.random() * 800)
  const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015)

  await post(sessionId, def.id, 'agent.state', {
    state: 'idle',
    label: 'Done',
    progress: 100,
    inputTokens,
    outputTokens,
    cost,
  })
  await post(sessionId, def.id, 'agent.message', {
    text: `Completed: ${task.slice(0, 80)}`,
  })
}

// ── Session orchestration ─────────────────────────────────────────────────────

async function spawnSession(): Promise<string> {
  const sessionId = `demo-${uid()}`

  // Start session
  await post(sessionId, 'demo-orchestrator', 'session.start', {
    name: 'Agent Arcade Live Demo',
    description: 'Automated demo showing multi-agent collaboration',
  })

  // Spawn all agents
  for (const def of AGENTS) {
    await post(sessionId, def.id, 'agent.spawn', {
      name: def.name,
      role: def.role,
      aiModel: def.model,
      task: def.taskPool[0],
      characterClass: def.role === 'researcher' ? 'wizard' : def.role === 'engineer' ? 'warrior' : 'rogue',
    })
    await post(sessionId, def.id, 'agent.position', { x: def.x, y: def.y })
  }

  // Link agents: researcher → coder → reviewer
  await post(sessionId, 'researcher', 'agent.link', { targetAgentId: 'coder',    type: 'feeds' })
  await post(sessionId, 'coder',      'agent.link', { targetAgentId: 'reviewer', type: 'feeds' })

  await sleep(500)
  return sessionId
}

async function endSession(sessionId: string): Promise<void> {
  for (const def of AGENTS) {
    await post(sessionId, def.id, 'agent.end', { reason: 'session_reset' })
  }
  await post(sessionId, 'demo-orchestrator', 'session.end', {})
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runCycle(cycleIndex: number): Promise<void> {
  console.log(`[demo-bot] Starting cycle ${cycleIndex} → ${GATEWAY_URL}`)
  const sessionId = await spawnSession()
  console.log(`[demo-bot] Session: ${sessionId}`)

  const cycleStart = Date.now()
  let round = 0

  while (Date.now() - cycleStart < CYCLE_MS) {
    // Run all three agents concurrently but stagger start times slightly
    await Promise.all([
      runAgentCycle(sessionId, AGENTS[0]!, round),
      sleep(jitter(1200)).then(() => runAgentCycle(sessionId, AGENTS[1]!, round)),
      sleep(jitter(2400)).then(() => runAgentCycle(sessionId, AGENTS[2]!, round)),
    ])

    // Short pause between rounds
    await sleep(jitter(3000))
    round++
  }

  await endSession(sessionId)
  console.log(`[demo-bot] Cycle ${cycleIndex} complete — ${round} rounds run`)
}

async function main(): Promise<void> {
  console.log(`[demo-bot] Starting — gateway: ${GATEWAY_URL}, cycle: ${CYCLE_MS}ms`)

  // Wait for gateway to be ready (up to 30s)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`)
      if (res.ok) break
    } catch { /* not ready yet */ }
    console.log(`[demo-bot] Waiting for gateway... (${i + 1}/30)`)
    await sleep(1000)
  }

  let cycle = 0
  while (true) {
    try {
      await runCycle(cycle++)
    } catch (e) {
      console.error('[demo-bot] Cycle error:', e)
      await sleep(5000)
    }
  }
}

main()
