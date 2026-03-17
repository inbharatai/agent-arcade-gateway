#!/usr/bin/env bun
/**
 * Agent Arcade CLI
 *
 * Commands:
 *   agent-arcade init     -- Generate arcade.config.json
 *   agent-arcade start    -- Start gateway + web + watchers
 *   agent-arcade status   -- Show connected agents
 *   agent-arcade demo     -- Run demo simulation
 *   agent-arcade hook claude-code -- Set up Claude Code hooks
 *   agent-arcade version  -- Show version
 *   agent-arcade help     -- Show help
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { spawn, execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function log(msg: string) { console.log(msg) }
function success(msg: string) { log(`${c.green}\u2713${c.reset} ${msg}`) }
function warn(msg: string) { log(`${c.yellow}\u26A0${c.reset} ${msg}`) }
function info(msg: string) { log(`${c.cyan}\u2139${c.reset} ${msg}`) }
function error(msg: string) { log(`${c.red}\u2717${c.reset} ${msg}`) }

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const VERSION = '3.2.4'

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit() {
  log(`\n${c.cyan}${c.bold}Agent Arcade Init${c.reset}\n`)
  log(`${c.dim}Scanning your system for AI tools...${c.reset}\n`)

  const agents: any[] = []

  // Check for Claude Code
  const claudeDir = join(homedir(), '.claude')
  if (existsSync(claudeDir)) {
    success('Found Claude Code')
    agents.push({ type: 'claude-code', autoDetect: true })
  }

  // Check for Aider
  if (existsSync(join(process.cwd(), '.aider.chat.history.md'))) {
    success('Found Aider history')
    agents.push({ type: 'custom', logFile: '.aider.chat.history.md' })
  }

  // Check for .env with API keys
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8')
    if (envContent.includes('OPENAI_API_KEY')) {
      success('Found OpenAI API key')
      agents.push({ type: 'openai-proxy', intercept: true })
    }
    if (envContent.includes('ANTHROPIC_API_KEY')) {
      success('Found Anthropic API key')
    }
  }

  // Check for Python AI packages
  try {
    const pipList = execSync('pip list --format=json 2>/dev/null || pip3 list --format=json', { encoding: 'utf-8' })
    const packages = JSON.parse(pipList) as Array<{ name: string }>
    const names = packages.map(p => p.name.toLowerCase())

    if (names.includes('langchain') || names.includes('langchain-core')) {
      success('Found LangChain')
      agents.push({ type: 'langchain', autoDetect: true })
    }
    if (names.includes('crewai')) {
      success('Found CrewAI')
      agents.push({ type: 'crewai', autoDetect: true })
    }
    if (names.includes('pyautogen') || names.includes('autogen')) {
      success('Found AutoGen')
      agents.push({ type: 'autogen', autoDetect: true })
    }
  } catch { /* pip not available */ }

  // Check for Ollama (with timeout so CLI doesn't hang)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    await fetch('http://localhost:11434/api/tags', { signal: ctrl.signal })
    clearTimeout(timer)
    success('Found Ollama running')
    agents.push({ type: 'ollama', autoDetect: true })
  } catch { /* not running or timed out */ }

  if (agents.length === 0) {
    warn('No AI tools detected. You can add them manually to arcade.config.json')
    agents.push({ type: 'custom', webhook: 'http://localhost:9000/events' })
  }

  const config = {
    version: '3.0.0',
    session: process.cwd().split(/[/\\]/).pop() || 'my-project',
    gateway: { port: 47890 },
    web: { port: 3000 },
    agents,
    alerts: {
      costLimit: 5.0,
      errorRate: 0.1,
      notify: [],
    },
  }

  writeFileSync('arcade.config.json', JSON.stringify(config, null, 2))
  log('')
  success(`Created ${c.bold}arcade.config.json${c.reset} with ${agents.length} agent(s)`)
  log(`\n${c.dim}Next: run ${c.cyan}agent-arcade start${c.dim} to launch the dashboard${c.reset}\n`)
}

async function cmdStart() {
  log(`\n${c.cyan}${c.bold}Agent Arcade${c.reset} ${c.dim}v${VERSION}${c.reset}\n`)

  // ── Auto-create gateway .env if missing ───────────────────────────────
  const gatewayEnvPath = join(process.cwd(), 'packages', 'gateway', '.env')
  if (!existsSync(gatewayEnvPath)) {
    warn('No gateway .env found — creating development config...')
    const detectedKeys: string[] = []
    if (process.env.ANTHROPIC_API_KEY) detectedKeys.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`)
    if (process.env.OPENAI_API_KEY)    detectedKeys.push(`OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`)
    if (process.env.GEMINI_API_KEY)    detectedKeys.push(`GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`)
    if (process.env.MISTRAL_API_KEY)   detectedKeys.push(`MISTRAL_API_KEY=${process.env.MISTRAL_API_KEY}`)

    const devEnv = [
      '# Agent Arcade Gateway — Development Config (auto-generated)',
      'NODE_ENV=development',
      'PORT=47890',
      'REQUIRE_AUTH=0',
      'ENABLE_REDIS_ADAPTER=0',
      'RETENTION_SECONDS=86400',
      'MAX_EVENTS=1000',
      'REPLAY_COUNT=100',
      'ALLOWED_ORIGINS=http://localhost:47380,http://localhost:3000,http://localhost:3001',
      'ENABLE_INTERNAL_ROUTES=1',
      '',
      '# AI Provider Keys (auto-detected from your environment)',
      ...(detectedKeys.length > 0 ? detectedKeys : ['# ANTHROPIC_API_KEY=sk-ant-...']),
      '',
    ].join('\n')

    writeFileSync(gatewayEnvPath, devEnv)
    success(`Created ${c.bold}packages/gateway/.env${c.reset} (development mode)`)
    if (detectedKeys.length > 0) {
      success(`Auto-detected ${detectedKeys.length} API key(s) from your environment`)
    } else {
      warn('No API keys detected. Add ANTHROPIC_API_KEY to packages/gateway/.env for console chat.')
    }
    log('')
  }

  // ── Also create web .env.local if missing ─────────────────────────────
  const webEnvPath = join(process.cwd(), 'packages', 'web', '.env.local')
  if (!existsSync(webEnvPath)) {
    const webEnv = [
      '# Agent Arcade Web — Development Config (auto-generated)',
      'NEXT_PUBLIC_GATEWAY_URL=http://localhost:47890',
      'NEXT_PUBLIC_DEFAULT_SESSION=dev-session',
      '',
    ].join('\n')
    writeFileSync(webEnvPath, webEnv)
    success(`Created ${c.bold}packages/web/.env.local${c.reset}`)
  }

  const children: ReturnType<typeof spawn>[] = []

  // Shared env — pass current shell env + gateway url to all children
  const sharedEnv = {
    ...process.env,
    NEXT_PUBLIC_GATEWAY_URL: 'http://localhost:47890',
  }

  // Start gateway
  info('Starting gateway on :47890...')
  const gateway = spawn('bun', ['run', 'packages/gateway/src/index.ts'], {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: sharedEnv,
  })
  children.push(gateway)
  gateway.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) log(`${c.dim}[gateway]${c.reset} ${msg}`)
  })
  gateway.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg && !msg.includes('ExperimentalWarning')) log(`${c.red}[gateway]${c.reset} ${msg}`)
  })

  // Start web
  info('Starting dashboard on :47380...')
  const web = spawn('npm', ['run', 'dev'], {
    stdio: 'pipe',
    cwd: join(process.cwd(), 'packages', 'web'),
    env: sharedEnv,
    shell: true,
  })
  children.push(web)
  web.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) log(`${c.dim}[web]${c.reset} ${msg}`)
  })

  // Check for proxy config
  if (existsSync('arcade.config.json')) {
    try {
      const config = JSON.parse(readFileSync('arcade.config.json', 'utf-8'))
      const hasProxy = config.agents?.some((a: any) => a.type === 'openai-proxy' && a.intercept)
      if (hasProxy) {
        info('Starting AI proxy on :8788...')
        const proxy = spawn('bun', ['run', 'packages/proxy/src/index.ts'], {
          stdio: 'pipe',
          cwd: process.cwd(),
          env: sharedEnv,
        })
        children.push(proxy)
      }
    } catch { /* no config */ }
  }

  log('')
  success(`Gateway:   ${c.cyan}http://localhost:47890${c.reset}`)
  success(`Dashboard: ${c.cyan}http://localhost:47380${c.reset}`)
  info(`Console chat: ${process.env.ANTHROPIC_API_KEY ? `${c.green}auto-connected (Claude)${c.reset}` : `${c.yellow}add ANTHROPIC_API_KEY to gateway .env${c.reset}`}`)
  log(`\n${c.dim}Press Ctrl+C to stop all services${c.reset}\n`)

  // Graceful shutdown
  const shutdown = () => {
    log(`\n${c.yellow}Shutting down...${c.reset}`)
    children.forEach(child => child.kill())
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function cmdStatus() {
  log(`\n${c.cyan}${c.bold}Agent Arcade Status${c.reset}\n`)

  try {
    const res = await fetch('http://localhost:47890/health')
    const health = await res.json() as any

    success(`Gateway: ${c.green}online${c.reset}`)
    log(`  ${c.dim}Uptime: ${Math.floor((health.uptime || 0) / 60)}m`)
    log(`  ${c.dim}Sessions: ${health.sessions || 0}`)
    log(`  ${c.dim}Agents: ${health.agents || 0}${c.reset}`)
  } catch {
    error('Gateway: offline')
    log(`  ${c.dim}Run: agent-arcade start${c.reset}`)
  }

  try {
    await fetch('http://localhost:47380')
    success(`Dashboard: ${c.green}online${c.reset}`)
  } catch {
    error('Dashboard: offline')
  }

  log('')
}

async function cmdDemo() {
  log(`\n${c.cyan}${c.bold}Agent Arcade Demo Mode${c.reset}\n`)
  log(`${c.dim}Simulating a multi-agent AI session...${c.reset}\n`)

  const gatewayUrl = 'http://localhost:47890'
  const sessionId = `demo-${Date.now()}`

  function emit(type: string, agentId: string, payload: Record<string, unknown>) {
    fetch(`${gatewayUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, ts: Date.now(), sessionId, agentId, type, payload }),
    }).catch(() => { /* gateway not running */ })
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // Agent 1: Claude Sonnet
  const a1 = 'demo_claude'
  info('Spawning Claude Sonnet...')
  emit('agent.spawn', a1, { name: 'Claude Sonnet', role: 'assistant', aiModel: 'claude-sonnet-4-20250514' })
  await sleep(500)

  emit('agent.state', a1, { state: 'thinking', label: 'Analyzing requirements...' })
  await sleep(2000)

  // Agent 2: GPT-4o
  const a2 = 'demo_gpt'
  info('Spawning GPT-4o...')
  emit('agent.spawn', a2, { name: 'GPT-4o', role: 'researcher', aiModel: 'gpt-4o' })
  emit('agent.state', a2, { state: 'reading', label: 'Reading documentation...' })
  await sleep(1500)

  // Claude uses tools
  emit('agent.tool', a1, { name: 'read_file', label: 'Reading src/index.ts' })
  emit('agent.state', a1, { state: 'tool', label: 'Using read_file' })
  await sleep(1000)

  // GPT writes
  emit('agent.state', a2, { state: 'writing', label: 'Generating research report...', progress: 0.3 })
  await sleep(1500)

  // Agent 3: Code Reviewer (child of Claude)
  const a3 = 'demo_reviewer'
  info('Spawning Code Reviewer...')
  emit('agent.spawn', a3, { name: 'Code Reviewer', role: 'reviewer', aiModel: 'claude-haiku-3.5' })
  emit('agent.link', a3, { parentAgentId: a1, childAgentId: a3 })
  emit('agent.state', a3, { state: 'reading', label: 'Reviewing code changes...' })
  await sleep(2000)

  // Claude writes
  emit('agent.state', a1, { state: 'writing', label: 'Generating implementation...', progress: 0.5 })
  await sleep(1000)
  emit('agent.tool', a1, { name: 'write_file', label: 'Writing src/feature.ts' })
  await sleep(1500)

  // GPT finishes
  emit('agent.state', a2, { state: 'writing', label: 'Finalizing report...', progress: 0.9 })
  await sleep(1000)
  emit('agent.end', a2, { reason: 'Report complete', success: true })
  success('GPT-4o finished')

  // Agent 4: Test Runner (encounters error, recovers)
  const a4 = 'demo_tester'
  info('Spawning Test Runner...')
  emit('agent.spawn', a4, { name: 'Test Runner', role: 'tester', aiModel: 'gpt-4o-mini' })
  emit('agent.state', a4, { state: 'tool', label: 'Running test suite...' })
  emit('agent.tool', a4, { name: 'run_tests', label: 'npm test' })
  await sleep(2000)

  // Test fails
  emit('agent.state', a4, { state: 'error', label: 'Test failed: assertion error in auth.test.ts' })
  warn('Test Runner hit an error!')
  await sleep(1500)

  // Test recovers
  emit('agent.state', a4, { state: 'thinking', label: 'Analyzing failure...' })
  await sleep(1000)
  emit('agent.state', a4, { state: 'tool', label: 'Fixing test...' })
  emit('agent.tool', a4, { name: 'write_file', label: 'Fixing auth.test.ts' })
  await sleep(1500)
  emit('agent.end', a4, { reason: 'Tests passing after fix', success: true })
  success('Test Runner recovered and passed')

  // Reviewer finishes
  emit('agent.state', a3, { state: 'writing', label: 'Writing review comments...' })
  await sleep(1000)
  emit('agent.end', a3, { reason: 'Review complete: LGTM', success: true })
  success('Code Reviewer finished')

  // Claude finishes
  emit('agent.state', a1, { state: 'writing', label: 'Committing changes...', progress: 0.95 })
  await sleep(1000)
  emit('agent.tool', a1, { name: 'git_commit', label: 'feat: implement new feature' })
  await sleep(500)
  emit('agent.end', a1, { reason: 'Implementation complete', success: true })
  success('Claude Sonnet finished')

  log(`\n${c.green}${c.bold}Demo complete!${c.reset}`)
  log(`${c.dim}Open ${c.cyan}http://localhost:47380${c.dim} to see the replay${c.reset}\n`)
}

async function cmdHookClaudeCode() {
  log(`\n${c.cyan}${c.bold}Setting up Claude Code Hooks${c.reset}\n`)

  const claudeDir = join(homedir(), '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
    warn(`Created ${claudeDir} (Claude Code not detected but hooks installed)`)
  }

  const hooksDir = join(claudeDir, 'hooks')
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

  // ── Shell hook scripts ──────────────────────────────────────────────────

  // Pre-tool hook — reads tool input from stdin (JSON), emits agent.tool + agent.state(tool)
  const preToolHook = `#!/bin/bash
# Agent Arcade PreToolUse Hook
# Receives: tool name as arg, full JSON input on stdin
# Claude Code invokes this before EVERY tool call automatically.
GATEWAY="\${ARCADE_GATEWAY:-http://localhost:47890}"
SESSION="\${ARCADE_SESSION:-claude-code}"
TOOL_NAME="\${CLAUDE_TOOL_NAME:-\$1}"
AGENT_ID="claude_\${CLAUDE_PARENT_PROCESS_ID:-$$}"
TS=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)

# Emit spawn if not already done (gateway deduplicates)
curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.spawn\\",\\"payload\\":{\\"name\\":\\"Claude Code\\",\\"role\\":\\"assistant\\",\\"aiModel\\":\\"claude\\",\\"source\\":\\"hooks\\"}}" >/dev/null 2>&1 || true

# Emit tool event
curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.tool\\",\\"payload\\":{\\"name\\":\\"$TOOL_NAME\\",\\"label\\":\\"$TOOL_NAME\\"}}" >/dev/null 2>&1 || true

# Emit state(tool)
curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.state\\",\\"payload\\":{\\"state\\":\\"tool\\",\\"label\\":\\"Using $TOOL_NAME\\"}}" >/dev/null 2>&1 || true

exit 0
`

  // Post-tool hook — emits agent.state(thinking|error) based on exit code
  const postToolHook = `#!/bin/bash
# Agent Arcade PostToolUse Hook
# Claude Code invokes this after EVERY tool call with exit code.
GATEWAY="\${ARCADE_GATEWAY:-http://localhost:47890}"
SESSION="\${ARCADE_SESSION:-claude-code}"
TOOL_NAME="\${CLAUDE_TOOL_NAME:-\$1}"
EXIT_CODE="\${CLAUDE_TOOL_EXIT_CODE:-\$2}"
AGENT_ID="claude_\${CLAUDE_PARENT_PROCESS_ID:-$$}"
TS=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)

STATE="thinking"
LABEL="$TOOL_NAME done"
if [ "\${EXIT_CODE}" != "0" ] && [ -n "\${EXIT_CODE}" ]; then
  STATE="error"
  LABEL="$TOOL_NAME failed (exit \${EXIT_CODE})"
fi

curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.state\\",\\"payload\\":{\\"state\\":\\"$STATE\\",\\"label\\":\\"$LABEL\\"}}" >/dev/null 2>&1 || true

exit 0
`

  // Notification hook — emits agent.message when Claude sends a notification
  const notificationHook = `#!/bin/bash
# Agent Arcade Notification Hook
# Fired when Claude Code shows a notification to the user.
GATEWAY="\${ARCADE_GATEWAY:-http://localhost:47890}"
SESSION="\${ARCADE_SESSION:-claude-code}"
AGENT_ID="claude_\${CLAUDE_PARENT_PROCESS_ID:-$$}"
MSG=\$(cat | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','')[:200])" 2>/dev/null || echo "Notification")
TS=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null || echo 0)

curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.message\\",\\"payload\\":{\\"text\\":\\"$MSG\\",\\"level\\":\\"info\\"}}" >/dev/null 2>&1 || true

exit 0
`

  // Stop hook — emits agent.end when Claude Code session stops
  const stopHook = `#!/bin/bash
# Agent Arcade Stop Hook
# Fired when Claude Code finishes a task or the user ends the session.
GATEWAY="\${ARCADE_GATEWAY:-http://localhost:47890}"
SESSION="\${ARCADE_SESSION:-claude-code}"
AGENT_ID="claude_\${CLAUDE_PARENT_PROCESS_ID:-$$}"
TS=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null || echo 0)

curl -sf -X POST "$GATEWAY/v1/ingest" -H 'Content-Type: application/json' -d "{\\"v\\":1,\\"ts\\":$TS,\\"sessionId\\":\\"$SESSION\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.end\\",\\"payload\\":{\\"reason\\":\\"Session stopped\\",\\"success\\":true}}" >/dev/null 2>&1 || true

exit 0
`

  const preToolPath  = join(hooksDir, 'arcade-pre-tool.sh')
  const postToolPath = join(hooksDir, 'arcade-post-tool.sh')
  const notifyPath   = join(hooksDir, 'arcade-notification.sh')
  const stopPath     = join(hooksDir, 'arcade-stop.sh')

  writeFileSync(preToolPath,  preToolHook,       { mode: 0o755 })
  writeFileSync(postToolPath, postToolHook,      { mode: 0o755 })
  writeFileSync(notifyPath,   notificationHook,  { mode: 0o755 })
  writeFileSync(stopPath,     stopHook,          { mode: 0o755 })

  success(`Created ${c.bold}arcade-pre-tool.sh${c.reset}`)
  success(`Created ${c.bold}arcade-post-tool.sh${c.reset}`)
  success(`Created ${c.bold}arcade-notification.sh${c.reset}`)
  success(`Created ${c.bold}arcade-stop.sh${c.reset}`)

  // ── Register hooks in ~/.claude/settings.json ──────────────────────────
  const settingsPath = join(claudeDir, 'settings.json')
  let settings: any = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      warn(`Could not parse ${settingsPath} — creating fresh hooks config`)
      settings = {}
    }
  }

  // Merge arcade hooks into existing settings
  const arcadeHooks = {
    PreToolUse: [
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: preToolPath }],
      },
    ],
    PostToolUse: [
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: postToolPath }],
      },
    ],
    Notification: [
      {
        hooks: [{ type: 'command', command: notifyPath }],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: stopPath }],
      },
    ],
  }

  // Remove any previous arcade hooks, then add current ones
  if (!settings.hooks) settings.hooks = {}
  for (const [eventType, hookArr] of Object.entries(arcadeHooks)) {
    const existing = (settings.hooks[eventType] || []) as any[]
    // Remove old arcade entries
    const filtered = existing.filter((h: any) =>
      !h.hooks?.some((hh: any) => typeof hh.command === 'string' && hh.command.includes('arcade-'))
    )
    settings.hooks[eventType] = [...filtered, ...hookArr]
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  success(`Registered hooks in ${c.bold}~/.claude/settings.json${c.reset}`)

  log(`
${c.green}${c.bold}Claude Code hooks installed!${c.reset}

${c.dim}Every tool call Claude Code makes will now appear live in your Agent Arcade dashboard.${c.reset}

  Gateway:    ${c.cyan}http://localhost:47890${c.reset}
  Dashboard:  ${c.cyan}http://localhost:47380${c.reset}

${c.dim}Environment variables (optional — defaults shown):${c.reset}
  ARCADE_GATEWAY=${c.cyan}http://localhost:47890${c.reset}
  ARCADE_SESSION=${c.cyan}claude-code${c.reset}

${c.dim}To uninstall: remove arcade-*.sh entries from ~/.claude/settings.json${c.reset}
`)
}

function cmdHelp() {
  log(`
${c.cyan}${c.bold}Agent Arcade CLI${c.reset} ${c.dim}v${VERSION}${c.reset}
${c.dim}The universal AI agent observability platform${c.reset}

${c.bold}Commands:${c.reset}

  ${c.cyan}init${c.reset}              Generate arcade.config.json (auto-detects AI tools)
  ${c.cyan}start${c.reset}             Start gateway + dashboard + watchers
  ${c.cyan}status${c.reset}            Show running services and connected agents
  ${c.cyan}demo${c.reset}              Run realistic multi-agent simulation
  ${c.cyan}hook claude-code${c.reset}  Install Claude Code hooks via ~/.claude/settings.json
  ${c.cyan}version${c.reset}           Show version
  ${c.cyan}help${c.reset}              Show this help

${c.bold}Examples:${c.reset}

  ${c.dim}# 1. Quick start — launch everything${c.reset}
  agent-arcade init
  agent-arcade start

  ${c.dim}# 2. Hook Claude Code (you're using it right now!)${c.reset}
  agent-arcade hook claude-code

  ${c.dim}# 3. Try the demo (4 simulated agents)${c.reset}
  agent-arcade demo

  ${c.dim}# 4. Check running services${c.reset}
  agent-arcade status

${c.bold}Gateway-first API key setup:${c.reset}

  Add your key ONCE to ${c.cyan}packages/gateway/.env${c.reset}:
    ${c.dim}ANTHROPIC_API_KEY=sk-ant-...${c.reset}

  All clients (console, adapters, CLI) auto-connect — no per-client config.

${c.dim}Docs: https://github.com/inbharatai/agent-arcade-gateway${c.reset}
`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case 'init': cmdInit(); break
  case 'start': cmdStart(); break
  case 'status': cmdStatus(); break
  case 'demo': cmdDemo(); break
  case 'hook':
    if (args[1] === 'claude-code') cmdHookClaudeCode()
    else error(`Unknown hook target: ${args[1]}. Available: claude-code`)
    break
  case 'version': case '--version': case '-v':
    log(`Agent Arcade v${VERSION}`)
    break
  case 'help': case '--help': case '-h': case undefined:
    cmdHelp()
    break
  default:
    error(`Unknown command: ${command}`)
    cmdHelp()
}
