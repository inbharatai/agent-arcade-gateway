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
    // Non-fatal: emitter can still run without persistence.
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
console.log(`[arcade] auto-emitter workspace: ${workspace}`)
console.log(`[arcade] tip: run \`npm run emitter:auto -- "C:/path/to/client"\` once to pin a new workspace`)

const child = spawn(
  'npx tsx examples/copilot-live.ts "' + workspace.replace(/\\/g, '/') + '"',
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  }
)

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
