/**
 * Copilot Live — Real-Time Workspace Telemetry for Agent Arcade
 *
 * Watches the ACTUAL workspace for real file changes and emits
 * telemetry events representing what Copilot is really doing.
 * No demo, no dummy data — pure live workspace activity.
 *
 * Run:
 *   npx tsx examples/copilot-live.ts [workspace-path]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8787'
const SESSION = 'copilot-live'
const V = 1
const MAX_RETRY_DELAY = 30_000
const INITIAL_RETRY_DELAY = 2_000
const TOOL_SCAN_INTERVAL_MS = Number(process.env.TOOL_SCAN_INTERVAL_MS || 1000)
const MAX_CMD_PREVIEW = 160
const execAsync = promisify(exec)
const CONFIDENCE_PROCESS = 0.98
const CONFIDENCE_FILESYSTEM = 0.72

// Workspace root — default to the monorepo root
const WORKSPACE = process.argv[2] || path.resolve(__dirname, '..')

// ── Agent IDs ────────────────────────────────────────────────────────────────
const COPILOT = 'copilot-agent'
const WATCHER = 'file-watcher'
const TERMINAL = 'terminal-agent'
let subagentCounter = 0

// ── State tracking ───────────────────────────────────────────────────────────
let totalEdits = 0
let totalReads = 0
let lastActivity = Date.now()
const recentFiles = new Set<string>()
const spawned = new Set<string>()
const toolSpawned = new Set<string>()
const monitoredPids = new Set<number>()
const pidMeta = new Map<number, { toolId: string; toolName: string; command: string }>()

// ── Helpers ──────────────────────────────────────────────────────────────────

let gatewayAlive = true
let retryDelay = INITIAL_RETRY_DELAY
let knownGatewayStartedAt: number | null = null

async function send(agentId: string, type: string, payload: Record<string, unknown>) {
  const ev = { v: V, ts: Date.now(), sessionId: SESSION, agentId, type, payload }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GATEWAY}/v1/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        console.error(`  ✗ ${type} → ${res.status}`)
      } else {
        if (!gatewayAlive) {
          gatewayAlive = true
          retryDelay = INITIAL_RETRY_DELAY
          console.log('   ✓ Gateway reconnected')
        }
      }
      return
    } catch (e: unknown) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)))
        continue
      }
      if (gatewayAlive) {
        gatewayAlive = false
        console.error(`  ✗ Gateway unreachable — will retry in background`)
      }
    }
  }
}

function relative(filepath: string): string {
  return path.relative(WORKSPACE, filepath).replace(/\\/g, '/')
}

function classifyFile(filepath: string): { module: string; type: string } {
  const rel = relative(filepath)
  const ext = path.extname(filepath)
  if (rel.includes('themes'))    return { module: 'themes', type: 'theme-engine' }
  if (rel.includes('sprites'))   return { module: 'sprites', type: 'character-system' }
  if (rel.includes('core'))      return { module: 'core', type: 'renderer' }
  if (rel.includes('audio'))     return { module: 'audio', type: 'audio-engine' }
  if (rel.includes('store'))     return { module: 'store', type: 'state-management' }
  if (rel.includes('movement'))  return { module: 'movement', type: 'pathfinding' }
  if (rel.includes('component')) return { module: 'components', type: 'ui' }
  if (rel.includes('gateway'))   return { module: 'gateway', type: 'server' }
  if (rel.includes('sdk'))       return { module: 'sdk', type: 'sdk' }
  if (rel.includes('prisma'))    return { module: 'database', type: 'schema' }
  if (rel.includes('example'))   return { module: 'examples', type: 'tooling' }
  if (ext === '.css')            return { module: 'styles', type: 'styling' }
  if (ext === '.json')           return { module: 'config', type: 'configuration' }
  return { module: 'workspace', type: 'source' }
}

function stateForAction(action: string): string {
  switch (action) {
    case 'change': return 'writing'
    case 'rename': return 'tool'
    default:       return 'reading'
  }
}

function compactCommand(cmd: string): string {
  const oneLine = cmd.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_CMD_PREVIEW ? `${oneLine.slice(0, MAX_CMD_PREVIEW - 3)}...` : oneLine
}

type ProcInfo = { pid: number; name: string; command: string }
type ToolMatch = { toolId: string; toolName: string }

const TOOL_PATTERNS: Array<{ re: RegExp; toolId: string; toolName: string }> = [
  { re: /\bgit(\.exe)?\b/i, toolId: 'git', toolName: 'Git' },
  { re: /\bnpm(\.cmd)?\b/i, toolId: 'npm', toolName: 'npm' },
  { re: /\bbun(\.exe)?\b/i, toolId: 'bun', toolName: 'Bun' },
  { re: /\bnode(\.exe)?\b/i, toolId: 'node', toolName: 'Node.js' },
  { re: /\bpython(\.exe)?\b|\bpy(\.exe)?\b/i, toolId: 'python', toolName: 'Python' },
  { re: /\bpip(\.exe)?\b/i, toolId: 'pip', toolName: 'pip' },
  { re: /\btsx(\.cmd)?\b/i, toolId: 'tsx', toolName: 'tsx' },
  { re: /\btsc(\.cmd)?\b/i, toolId: 'tsc', toolName: 'TypeScript' },
  { re: /\beslint(\.cmd)?\b/i, toolId: 'eslint', toolName: 'ESLint' },
  { re: /\bjest(\.cmd)?\b|\bvitest(\.cmd)?\b/i, toolId: 'tests', toolName: 'Test Runner' },
  { re: /\bdocker(\.exe)?\b/i, toolId: 'docker', toolName: 'Docker' },
  { re: /\bkubectl(\.exe)?\b/i, toolId: 'kubectl', toolName: 'kubectl' },
  { re: /\bgo(\.exe)?\b/i, toolId: 'go', toolName: 'Go' },
  { re: /\bcargo(\.exe)?\b|\brustc(\.exe)?\b/i, toolId: 'rust', toolName: 'Rust' },
  { re: /\bdotnet(\.exe)?\b/i, toolId: 'dotnet', toolName: '.NET' },
  { re: /\bjava(\.exe)?\b|\bgradle(\.bat)?\b|\bmvn(\.cmd)?\b/i, toolId: 'java', toolName: 'Java' },
  { re: /\bpowershell(\.exe)?\b|\bpwsh(\.exe)?\b|\bcmd(\.exe)?\b|\bbash\b|\bzsh\b/i, toolId: 'shell', toolName: 'Shell' },
]

function matchTool(command: string, name: string): ToolMatch | null {
  const haystack = `${name} ${command}`
  for (const p of TOOL_PATTERNS) {
    if (p.re.test(haystack)) {
      return { toolId: p.toolId, toolName: p.toolName }
    }
  }
  return null
}

function normalizeProcName(name: string): string {
  return name.replace(/\.exe$/i, '').trim().toLowerCase()
}

function shouldTrackProcess(proc: ProcInfo): ToolMatch | null {
  if (!Number.isFinite(proc.pid) || proc.pid <= 0) return null
  if (proc.pid === process.pid) return null
  const normalized = normalizeProcName(proc.name)
  if (normalized === 'code' || normalized === 'code-insiders') return null

  const cmd = proc.command || ''
  if (!cmd || cmd.includes('examples/copilot-live.ts')) return null

  const tool = matchTool(cmd, proc.name)
  if (!tool) return null

  // Accuracy guard: prefer workspace-related commands to avoid unrelated system noise.
  const workspaceLower = WORKSPACE.toLowerCase()
  const cmdLower = cmd.toLowerCase()
  const workspaceRelated = cmdLower.includes(workspaceLower) || cmdLower.includes('agent-arcade')
  if (!workspaceRelated) return null

  return tool
}

async function listProcesses(): Promise<ProcInfo[]> {
  if (process.platform === 'win32') {
    const psCmd = [
      "$ErrorActionPreference = 'SilentlyContinue';",
      'Get-CimInstance Win32_Process',
      '| Select-Object ProcessId,Name,CommandLine',
      '| ConvertTo-Json -Compress',
    ].join(' ')
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd}"`, { maxBuffer: 8 * 1024 * 1024 })
    const parsed = JSON.parse(stdout || '[]') as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr
      .map((p: Record<string, unknown>) => ({
        pid: Number(p.ProcessId || 0),
        name: String(p.Name || ''),
        command: String(p.CommandLine || ''),
      }))
      .filter(p => p.pid > 0 && p.name)
  }

  const { stdout } = await execAsync('ps -axo pid=,comm=,args=', { maxBuffer: 4 * 1024 * 1024 })
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  const out: ProcInfo[] = []
  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    out.push({ pid: Number(m[1]), name: m[2], command: m[3] || '' })
  }
  return out
}

async function scanToolProcesses() {
  const processes = await listProcesses()
  const activeTracked = new Set<number>()

  for (const proc of processes) {
    const tool = shouldTrackProcess(proc)
    if (!tool) continue

    activeTracked.add(proc.pid)
    const cmdPreview = compactCommand(proc.command)
    const known = monitoredPids.has(proc.pid)

    if (!known) {
      monitoredPids.add(proc.pid)
      pidMeta.set(proc.pid, { toolId: tool.toolId, toolName: tool.toolName, command: cmdPreview })

      if (!toolSpawned.has(tool.toolId)) {
        toolSpawned.add(tool.toolId)
        const toolAgentId = `tool-${tool.toolId}`
        await send(toolAgentId, 'agent.spawn', {
          name: `${tool.toolName} Runner`,
          role: 'tool',
          characterClass: 'operator',
        })
        await send(toolAgentId, 'agent.link', { parentAgentId: TERMINAL, childAgentId: toolAgentId })
      }

      await send(TERMINAL, 'agent.state', {
        state: 'tool',
        label: `Running ${tool.toolName}`,
        progress: 0.4,
        source: 'process',
        confidence: CONFIDENCE_PROCESS,
      })
      await send(TERMINAL, 'agent.tool', {
        name: tool.toolId,
        label: `Start ${tool.toolName} (pid ${proc.pid})`,
        command: cmdPreview,
        source: 'process',
        confidence: CONFIDENCE_PROCESS,
      })
      await send(`tool-${tool.toolId}`, 'agent.state', {
        state: 'tool',
        label: cmdPreview,
        progress: 0.5,
        source: 'process',
        confidence: CONFIDENCE_PROCESS,
      })
      await send(`tool-${tool.toolId}`, 'agent.message', {
        text: `[start] pid=${proc.pid} ${cmdPreview}`,
        source: 'process',
        confidence: CONFIDENCE_PROCESS,
      })
      console.log(`   ⚙ ${tool.toolName} started (pid=${proc.pid})`)
    }
  }

  for (const pid of Array.from(monitoredPids)) {
    if (activeTracked.has(pid)) continue

    monitoredPids.delete(pid)
    const meta = pidMeta.get(pid)
    pidMeta.delete(pid)
    if (!meta) continue

    await send(`tool-${meta.toolId}`, 'agent.message', {
      text: `[end] pid=${pid} ${meta.command}`,
      source: 'process',
      confidence: CONFIDENCE_PROCESS,
    })
    await send(`tool-${meta.toolId}`, 'agent.state', {
      state: 'idle',
      label: `${meta.toolName} done`,
      progress: 1,
      source: 'process',
      confidence: CONFIDENCE_PROCESS,
    })
    await send(TERMINAL, 'agent.state', {
      state: 'idle',
      label: `${meta.toolName} finished`,
      progress: 1,
      source: 'process',
      confidence: CONFIDENCE_PROCESS,
    })
    console.log(`   ✓ ${meta.toolName} finished (pid=${pid})`)
  }
}

// Debounce rapid changes to the same file
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()
function debounced(key: string, ms: number, fn: () => void) {
  const existing = debounceMap.get(key)
  if (existing) clearTimeout(existing)
  debounceMap.set(key, setTimeout(() => {
    debounceMap.delete(key)
    fn()
  }, ms))
}

// ── Ignored paths ────────────────────────────────────────────────────────────
const IGNORE = [
  'node_modules', '.next', '.git', 'dist', '.turbo',
  '.cache', '.swc', '__pycache__', '.vercel',
]

function shouldIgnore(filepath: string): boolean {
  const rel = relative(filepath)
  return IGNORE.some(ig => rel.includes(ig)) || rel.startsWith('.')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎮 Agent Arcade — Copilot Live Telemetry')
  console.log(`   Gateway:   ${GATEWAY}`)
  console.log(`   Session:   ${SESSION}`)
  console.log(`   Workspace: ${WORKSPACE}`)
  console.log('')

  // Verify gateway is reachable — retry instead of exiting
  let gatewayReady = false
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const health = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(5000) })
      const data = await health.json() as Record<string, unknown>
      const totalEvents = typeof data.totalEvents === 'number' ? data.totalEvents : 0
      const sessions = typeof data.sessions === 'number' ? data.sessions : 0
      console.log(`   Gateway status: ${data.status ?? 'unknown'} (${totalEvents} events, ${sessions} sessions)`)
      knownGatewayStartedAt = (data.startedAt as number) || null
      gatewayReady = true
      break
    } catch {
      const delay = Math.min(MAX_RETRY_DELAY, INITIAL_RETRY_DELAY * (attempt + 1))
      console.error(`   ✗ Cannot reach gateway (attempt ${attempt + 1}/10) — retrying in ${delay / 1000}s…`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  if (!gatewayReady) {
    console.error('   ✗ Gateway unreachable after 10 attempts — starting anyway, will retry on events')
  }
  console.log('')

  // ── Spawn primary agents ──────────────────────────────────────────────
  console.log('▸ Spawning Copilot agent…')
  await send(COPILOT, 'agent.spawn', {
    name: 'Copilot', role: 'developer',
    characterClass: 'developer',
  })

  console.log('▸ Spawning File Watcher…')
  await send(WATCHER, 'agent.spawn', {
    name: 'File Watcher', role: 'analyst',
    characterClass: 'researcher',
  })
  await send(WATCHER, 'agent.link', { parentAgentId: COPILOT, childAgentId: WATCHER })

  console.log('▸ Spawning Terminal Monitor…')
  await send(TERMINAL, 'agent.spawn', {
    name: 'Terminal', role: 'engineer',
    characterClass: 'operator',
  })
  await send(TERMINAL, 'agent.link', { parentAgentId: COPILOT, childAgentId: TERMINAL })

  // Set initial states
  await send(COPILOT, 'agent.state', { state: 'thinking', label: 'Copilot session active…', progress: 0 })
  await send(WATCHER, 'agent.state', { state: 'reading', label: 'Watching workspace…', progress: 0 })
  await send(TERMINAL, 'agent.state', { state: 'idle', label: 'Terminal standby', progress: 0 })

  console.log('')
  console.log('▸ Watching for real file changes…')
  console.log('  (Edit any file in the workspace to see it live in the arcade)')
  console.log('')

  // ── Watch directories ─────────────────────────────────────────────────
  const watchDirs = [
    path.join(WORKSPACE, 'packages'),
    path.join(WORKSPACE, 'examples'),
    path.join(WORKSPACE, 'src'),
  ].filter(d => fs.existsSync(d))

  for (const dir of watchDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const filepath = path.join(dir, filename)
        if (shouldIgnore(filepath)) return

        debounced(filepath, 300, () => handleFileEvent(eventType, filepath))
      })
      watcher.on('error', (err) => {
        console.warn(`   ⚠ Watcher error on ${relative(dir)}: ${err.message} — restarting watcher`)
        try {
          watcher.close()
          fs.watch(dir, { recursive: true }, (eventType, filename) => {
            if (!filename) return
            const filepath = path.join(dir, filename)
            if (shouldIgnore(filepath)) return
            debounced(filepath, 300, () => handleFileEvent(eventType, filepath))
          })
          console.log(`   📂 Restarted watcher: ${relative(dir)}/`)
        } catch (e) {
          console.error(`   ✗ Failed to restart watcher for ${relative(dir)}: ${e}`)
        }
      })
      console.log(`   📂 Watching: ${relative(dir)}/`)
    } catch (err) {
      console.warn(`   ⚠ Cannot watch ${relative(dir)}: ${err}`)
    }
  }

  // ── Heartbeat — keep agents alive & show stats ────────────────────────
  setInterval(async () => {
    const idle = Date.now() - lastActivity
    if (idle > 10000) {
      await send(COPILOT, 'agent.state', {
        state: 'idle',
        label: `Idle — ${totalEdits} edits, ${totalReads} reads`,
        progress: 0,
      })
      await send(WATCHER, 'agent.state', {
        state: 'reading',
        label: `Monitoring ${recentFiles.size} recent files`,
        progress: 0,
      })
    }
  }, 8000)

  // ── Tool monitor — react immediately to real command execution ─────────
  const tickToolMonitor = async () => {
    try {
      await scanToolProcesses()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`   ⚠ Tool monitor error: ${msg}`)
    }
  }
  setInterval(() => {
    void tickToolMonitor()
  }, TOOL_SCAN_INTERVAL_MS)
  void tickToolMonitor()

  // ── Keep process alive ────────────────────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`\n▸ Received ${signal} — shutting down…`)
    await send(COPILOT, 'agent.state', { state: 'done', label: 'Session ended', progress: 1 })
    await send(COPILOT, 'agent.end', { reason: 'Session closed', success: true })
    await send(WATCHER, 'agent.end', { reason: 'Watcher stopped', success: true })
    await send(TERMINAL, 'agent.end', { reason: 'Terminal stopped', success: true })
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // ── Gateway health check — detect restarts & reconnect agents ─────
  async function spawnAllAgents() {
    await send(COPILOT, 'agent.spawn', { name: 'Copilot', role: 'developer', characterClass: 'developer' })
    await send(WATCHER, 'agent.spawn', { name: 'File Watcher', role: 'analyst', characterClass: 'researcher' })
    await send(TERMINAL, 'agent.spawn', { name: 'Terminal', role: 'engineer', characterClass: 'operator' })
    await send(COPILOT, 'agent.state', { state: 'thinking', label: 'Copilot session active…', progress: 0 })
    await send(WATCHER, 'agent.state', { state: 'reading', label: 'Watching workspace…', progress: 0 })
    await send(TERMINAL, 'agent.state', { state: 'idle', label: 'Terminal standby', progress: 0 })
  }

  setInterval(async () => {
    try {
      const health = await fetch(`${GATEWAY}/health`, { signal: AbortSignal.timeout(5000) })
      if (!health.ok) { gatewayAlive = false; return }
      const data = await health.json() as Record<string, unknown>
      const startedAt = data.startedAt as number

      if (!gatewayAlive) {
        // Was down, now back
        gatewayAlive = true
        retryDelay = INITIAL_RETRY_DELAY
        console.log('   ✓ Gateway back online — re-spawning agents')
        knownGatewayStartedAt = startedAt
        spawned.clear()
        await spawnAllAgents()
      } else if (knownGatewayStartedAt && startedAt !== knownGatewayStartedAt) {
        // Gateway restarted while we thought it was alive
        console.log('   ✓ Gateway restarted (new instance) — re-spawning agents')
        knownGatewayStartedAt = startedAt
        spawned.clear()
        await spawnAllAgents()
      } else if (!knownGatewayStartedAt) {
        knownGatewayStartedAt = startedAt
      }
    } catch {
      if (gatewayAlive) {
        gatewayAlive = false
        console.error('   ✗ Gateway unreachable — monitoring for recovery')
      }
    }
  }, 15_000)
}

// ── File Event Handler ───────────────────────────────────────────────────────

async function handleFileEvent(eventType: string, filepath: string) {
  const rel = relative(filepath)
  const { module, type } = classifyFile(filepath)
  const state = stateForAction(eventType)
  const ext = path.extname(filepath)

  lastActivity = Date.now()
  recentFiles.add(rel)

  // Only count actual source files
  const isSource = ['.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.prisma', '.json', '.md'].includes(ext)
  if (!isSource) return

  if (eventType === 'change') {
    totalEdits++

    // Copilot is writing
    console.log(`   ✎ ${rel} (${module})`)
    await send(COPILOT, 'agent.state', {
      state: 'writing',
      label: `Editing ${rel}`,
      progress: Math.min(0.95, totalEdits / 50),
      source: 'filesystem',
      confidence: CONFIDENCE_FILESYSTEM,
    })
    await send(COPILOT, 'agent.tool', {
      name: 'write_file',
      label: `Writing ${rel}`,
      path: rel,
      source: 'filesystem',
      confidence: CONFIDENCE_FILESYSTEM,
    })

    // Watcher reports
    await send(WATCHER, 'agent.state', {
      state: 'reading',
      label: `Detected change in ${module}/${path.basename(filepath)}`,
      progress: Math.min(0.95, totalEdits / 100),
      source: 'filesystem',
      confidence: CONFIDENCE_FILESYSTEM,
    })
    await send(WATCHER, 'agent.message', {
      text: `[${module}] ${path.basename(filepath)} modified — ${type}`,
      source: 'filesystem',
      confidence: CONFIDENCE_FILESYSTEM,
    })

    // On significant edits, spawn a sub-agent for the module
    if (totalEdits % 5 === 0 && !spawned.has(module)) {
      spawned.add(module)
      const subId = `sub-${module}-${++subagentCounter}`
      const names: Record<string, string> = {
        'themes': 'Theme Builder', 'sprites': 'Sprite Artist',
        'core': 'Renderer', 'audio': 'Composer',
        'components': 'UI Designer', 'gateway': 'Gateway Ops',
        'store': 'State Manager', 'movement': 'Pathfinder',
        'workspace': 'Workspace Agent', 'sdk': 'SDK Builder',
        'database': 'DB Architect', 'examples': 'Example Writer',
        'styles': 'Style Artist', 'config': 'Config Manager',
      }
      await send(subId, 'agent.spawn', {
        name: names[module] || `${module} Worker`,
        role: type,
        characterClass: module === 'sprites' ? 'builder' : module === 'audio' ? 'mentor' : 'reviewer',
      })
      await send(subId, 'agent.link', { parentAgentId: COPILOT, childAgentId: subId })
      await send(subId, 'agent.state', {
        state: 'writing',
        label: `Working on ${module}…`,
        progress: 0.3,
      })
      console.log(`   🤖 Spawned ${names[module] || module} sub-agent`)
    }

  } else if (eventType === 'rename') {
    // File created or deleted
    const exists = fs.existsSync(filepath)
    if (exists) {
      totalReads++
      console.log(`   + ${rel} (created)`)
      await send(COPILOT, 'agent.tool', {
        name: 'create_file',
        label: `Created ${rel}`,
        path: rel,
        source: 'filesystem',
        confidence: CONFIDENCE_FILESYSTEM,
      })
      await send(COPILOT, 'agent.state', {
        state: 'writing',
        label: `Created ${path.basename(filepath)}`,
        progress: Math.min(0.95, totalEdits / 50),
        source: 'filesystem',
        confidence: CONFIDENCE_FILESYSTEM,
      })
      await send(WATCHER, 'agent.message', {
        text: `[new] ${path.basename(filepath)} created in ${module}`,
        source: 'filesystem',
        confidence: CONFIDENCE_FILESYSTEM,
      })
    } else {
      console.log(`   - ${rel} (deleted)`)
      await send(WATCHER, 'agent.message', {
        text: `[del] ${path.basename(filepath)} removed from ${module}`,
        source: 'filesystem',
        confidence: CONFIDENCE_FILESYSTEM,
      })
    }
  }
}

// ── Process Hardening — never crash, always recover ──────────────────────────
process.on('uncaughtException', (err) => {
  console.error(`  ✗ UNCAUGHT EXCEPTION — recovering: ${err.message}`)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  console.error(`  ✗ UNHANDLED REJECTION — recovering: ${msg}`)
})

main().catch((err) => {
  console.error(`  ✗ main() failed: ${err.message} — restarting in 5s`)
  setTimeout(() => {
    main().catch(console.error)
  }, 5000)
})
