/**
 * Voice/narration system for Agent Arcade
 *
 * Uses Web Speech Synthesis API for agent narration.
 * Rate-limited: max 1 utterance per agent per 3 seconds.
 * Queue system prevents overlap.
 */

const COOLDOWN_MS = 3000
const lastSpoke = new Map<string, number>()
let speaking = false
const queue: Array<{ text: string; agentIndex: number; agentId: string }> = []

function processQueue() {
  if (speaking || queue.length === 0) return
  if (typeof speechSynthesis === 'undefined') return

  const item = queue.shift()!
  const now = Date.now()
  const last = lastSpoke.get(item.agentId) ?? 0
  if (now - last < COOLDOWN_MS) {
    // Skip this one, try next
    processQueue()
    return
  }

  speaking = true
  lastSpoke.set(item.agentId, now)

  const utterance = new SpeechSynthesisUtterance(item.text)
  utterance.rate = 1.1
  utterance.volume = 0.7
  // Vary pitch per agent (0.8 → 1.4)
  utterance.pitch = 0.8 + (item.agentIndex % 7) * 0.1
  utterance.onend = () => { speaking = false; processQueue() }
  utterance.onerror = () => { speaking = false; processQueue() }

  speechSynthesis.speak(utterance)
}

export function speak(text: string, agentId: string, agentIndex: number) {
  if (typeof speechSynthesis === 'undefined') return
  if (!text.trim()) return

  // Keep queue short
  if (queue.length > 5) queue.splice(0, queue.length - 5)

  queue.push({ text: text.slice(0, 80), agentIndex, agentId })
  processQueue()
}

export function stopVoice() {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  queue.length = 0
  speaking = false
}

export function isVoiceAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined'
}
