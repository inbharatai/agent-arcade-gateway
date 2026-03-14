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

const VERSION = '3.0.0'

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
    execSync('pip list --format=json 2>/dev/null || pip3 list --format=json 2>/dev/null', { encoding: 'utf-8' })
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

  // Check for Ollama
  try {
    await fetch('http://localhost:11434/api/tags')
    success('Found Ollama running')
    agents.push({ type: 'ollama', autoDetect: true })
  } catch { /* not running */ }

  if (agents.length === 0) {
    warn('No AI tools detected. You can add them manually to arcade.config.json')
    agents.push({ type: 'custom', webhook: 'http://localhost:9000/events' })
  }

  const config = {
    version: '3.0.0',
    session: process.cwd().split(/[/\\]/).pop() || 'my-project',
    gateway: { port: 8787 },
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

  const children: ReturnType<typeof spawn>[] = []

  // Start gateway
  info('Starting gateway on :8787...')
  const gateway = spawn('bun', ['run', 'packages/gateway/src/index.ts'], {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: { ...process.env },
  })
  children.push(gateway)
  gateway.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg) log(`${c.dim}[gateway]${c.reset} ${msg}`)
  })

  // Start web
  info('Starting dashboard on :3000...')
  const web = spawn('npm', ['run', 'dev'], {
    stdio: 'pipe',
    cwd: join(process.cwd(), 'packages', 'web'),
    env: { ...process.env },
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
          env: { ...process.env },
        })
        children.push(proxy)
      }
    } catch { /* no config */ }
  }

  log('')
  success(`Gateway:   ${c.cyan}http://localhost:8787${c.reset}`)
  success(`Dashboard: ${c.cyan}http://localhost:3000${c.reset}`)
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
    const res = await fetch('http://localhost:8787/health')
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
    await fetch('http://localhost:3000')
    success(`Dashboard: ${c.green}online${c.reset}`)
  } catch {
    error('Dashboard: offline')
  }

  log('')
}

async function cmdDemo() {
  log(`\n${c.cyan}${c.bold}Agent Arcade Demo Mode${c.reset}\n`)
  log(`${c.dim}Simulating a multi-agent AI session...${c.reset}\n`)

  const gatewayUrl = 'http://localhost:8787'
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
  log(`${c.dim}Open ${c.cyan}http://localhost:3000${c.dim} to see the replay${c.reset}\n`)
}

async function cmdHookClaudeCode() {
  log(`\n${c.cyan}${c.bold}Setting up Claude Code Hooks${c.reset}\n`)

  const claudeDir = join(homedir(), '.claude')
  if (!existsSync(claudeDir)) {
    error(`Claude Code config not found at ${claudeDir}`)
    return
  }

  const hooksDir = join(claudeDir, 'hooks')
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true })
  }

  // Pre-tool hook
  const preToolHook = `#!/bin/bash
# Agent Arcade Pre-Tool Hook
# Emits agent.state(tool) when Claude Code uses a tool
TOOL_NAME="$1"
GATEWAY_URL="\${ARCADE_GATEWAY:-http://localhost:8787}"
SESSION_ID="\${ARCADE_SESSION:-claude-code}"
AGENT_ID="\${ARCADE_AGENT:-claude_code_$$}"

curl -s -X POST "$GATEWAY_URL/v1/ingest" \\
  -H "Content-Type: application/json" \\
  -d "{\\"v\\":1,\\"ts\\":$(date +%s)000,\\"sessionId\\":\\"$SESSION_ID\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.tool\\",\\"payload\\":{\\"name\\":\\"$TOOL_NAME\\",\\"label\\":\\"Using $TOOL_NAME\\"}}" \\
  2>/dev/null || true
`

  // Post-tool hook
  const postToolHook = `#!/bin/bash
# Agent Arcade Post-Tool Hook
# Emits agent.state(thinking) after tool completes
TOOL_NAME="$1"
EXIT_CODE="$2"
GATEWAY_URL="\${ARCADE_GATEWAY:-http://localhost:8787}"
SESSION_ID="\${ARCADE_SESSION:-claude-code}"
AGENT_ID="\${ARCADE_AGENT:-claude_code_$$}"

STATE="thinking"
LABEL="Tool $TOOL_NAME complete"
if [ "$EXIT_CODE" != "0" ]; then
  STATE="error"
  LABEL="Tool $TOOL_NAME failed (exit $EXIT_CODE)"
fi

curl -s -X POST "$GATEWAY_URL/v1/ingest" \\
  -H "Content-Type: application/json" \\
  -d "{\\"v\\":1,\\"ts\\":$(date +%s)000,\\"sessionId\\":\\"$SESSION_ID\\",\\"agentId\\":\\"$AGENT_ID\\",\\"type\\":\\"agent.state\\",\\"payload\\":{\\"state\\":\\"$STATE\\",\\"label\\":\\"$LABEL\\"}}" \\
  2>/dev/null || true
`

  writeFileSync(join(hooksDir, 'pre-tool.sh'), preToolHook, { mode: 0o755 })
  writeFileSync(join(hooksDir, 'post-tool.sh'), postToolHook, { mode: 0o755 })

  success(`Created ${c.bold}pre-tool.sh${c.reset} hook`)
  success(`Created ${c.bold}post-tool.sh${c.reset} hook`)
  log(`\n${c.dim}Hooks installed at ${hooksDir}${c.reset}`)
  log(`${c.dim}Claude Code will now emit events to Agent Arcade${c.reset}\n`)
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
  ${c.cyan}hook claude-code${c.reset}  Set up Claude Code telemetry hooks
  ${c.cyan}version${c.reset}           Show version
  ${c.cyan}help${c.reset}              Show this help

${c.bold}Examples:${c.reset}

  ${c.dim}# Quick start${c.reset}
  agent-arcade init
  agent-arcade start

  ${c.dim}# Try the demo${c.reset}
  agent-arcade demo

  ${c.dim}# Auto-hook Claude Code${c.reset}
  agent-arcade hook claude-code

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
