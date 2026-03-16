import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const stateFile = path.join(repoRoot, '.arcade-emitter.json')

function resolveCandidate(input) {
  if (!input) return null
  const trimmed = String(input).trim()
  if (!trimmed) return null
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
}

function loadSavedWorkspace() {
  try {
    if (!fs.existsSync(stateFile)) return null
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    return typeof parsed.workspace === 'string' ? parsed.workspace : null
  } catch {
    return null
  }
}

function saveWorkspace(workspace) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ workspace }, null, 2))
  } catch {
    // Best effort only.
  }
}

function resolveWorkspace() {
  const argWorkspace = resolveCandidate(process.argv[2])
  const savedWorkspace = resolveCandidate(loadSavedWorkspace())
  const chosen = argWorkspace || savedWorkspace || process.cwd()
  const normalized = path.resolve(chosen)

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    throw new Error(`Workspace not found or not a directory: ${normalized}`)
  }

  saveWorkspace(normalized)
  return normalized
}

function start(name, command, cwd, env = {}) {
  const child = spawn(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[arcade-local] ${name} exited with code ${code}`)
    }
  })

  return child
}

const workspace = resolveWorkspace()
const children = []

console.log(`[arcade-local] workspace: ${workspace}`)
console.log('[arcade-local] gateway: http://localhost:47890')
console.log('[arcade-local] dashboard: http://localhost:3100')

children.push(start(
  'gateway',
  'npx tsx packages/gateway/src/index.ts',
  repoRoot,
  {
    PORT: '47890',
    REQUIRE_AUTH: '0',
    ENABLE_REDIS_ADAPTER: '0',
    ALLOWED_ORIGINS: '*',
  },
))

children.push(start(
  'web',
  'npx next dev --webpack -p 3100',
  path.join(repoRoot, 'packages', 'web'),
  {
    NEXT_PUBLIC_GATEWAY_URL: 'http://localhost:47890',
  },
))

children.push(start(
  'emitter',
  `npx tsx examples/copilot-live.ts "${workspace.replace(/\\/g, '/')}"`,
  repoRoot,
  {
    GATEWAY_URL: 'http://localhost:47890',
  },
))

function shutdown() {
  for (const child of children) {
    try {
      child.kill('SIGINT')
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)