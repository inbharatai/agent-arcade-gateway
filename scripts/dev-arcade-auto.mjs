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
  const envWorkspace = resolveCandidate(process.env.ARCADE_TARGET_WORKSPACE)
  const savedWorkspace = resolveCandidate(loadSavedWorkspace())

  const chosen = argWorkspace || envWorkspace || savedWorkspace || process.cwd()
  const normalized = path.resolve(chosen)

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    throw new Error(`Workspace not found or not a directory: ${normalized}`)
  }

  saveWorkspace(normalized)
  return normalized
}

const workspace = resolveWorkspace()
console.log(`[arcade] starting full stack with auto-emitter workspace: ${workspace}`)

const children = []

function start(name, command) {
  const child = spawn(command, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  children.push({ name, child })
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[arcade] ${name} exited with code ${code}`)
    }
  })
}

start('gateway', 'npm run dev:gateway')
start('web', 'npm run dev:web')
start('emitter', 'node scripts/start-auto-emitter.mjs "' + workspace.replace(/\\/g, '/') + '"')

function shutdown() {
  for (const { child } of children) {
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
