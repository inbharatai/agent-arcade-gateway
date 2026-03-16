import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const CHECK_EVERY_MS = Number(process.env.ARCADE_WATCHDOG_INTERVAL_MS || 10000)
const START_COOLDOWN_MS = Number(process.env.ARCADE_WATCHDOG_COOLDOWN_MS || 30000)
const GATEWAY_URL = process.env.ARCADE_GATEWAY_HEALTH_URL || 'http://localhost:47890/health'
const WEB_URL = process.env.ARCADE_WEB_HEALTH_URL || 'http://localhost:47380/api/health'

let lastGatewayStart = 0
let lastWebStart = 0

function now() {
  return Date.now()
}

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

function startInBackground(label, command) {
  const child = spawn(command, {
    cwd: ROOT,
    shell: true,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
  console.log(`[watchdog] started ${label}: ${command}`)
}

async function checkAndHeal() {
  const [gatewayUp, webUp] = await Promise.all([isUp(GATEWAY_URL), isUp(WEB_URL)])
  console.log(`[watchdog] gateway=${gatewayUp ? 'up' : 'down'} web=${webUp ? 'up' : 'down'}`)

  const t = now()

  if (!gatewayUp && t - lastGatewayStart > START_COOLDOWN_MS) {
    lastGatewayStart = t
    startInBackground('gateway', 'npm run dev:gateway')
  }

  if (!webUp && t - lastWebStart > START_COOLDOWN_MS) {
    lastWebStart = t
    startInBackground('web', 'npm run dev:web')
  }
}

console.log('[watchdog] Agent Arcade watchdog running')
console.log(`[watchdog] interval=${CHECK_EVERY_MS}ms cooldown=${START_COOLDOWN_MS}ms`)
console.log(`[watchdog] gatewayHealth=${GATEWAY_URL}`)
console.log(`[watchdog] webHealth=${WEB_URL}`)

await checkAndHeal()
setInterval(() => {
  checkAndHeal().catch((err) => {
    console.error('[watchdog] check failed:', err?.message || String(err))
  })
}, CHECK_EVERY_MS)
