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
let unlocked = false
const queue: Array<{ text: string; agentIndex: number; agentId: string }> = []

/**
 * Attempt to unlock speechSynthesis without a click by speaking a zero-volume
 * silent utterance. Chrome requires a user gesture, but this succeeds on
 * Firefox, Safari, and Chrome when the page loads with prior user engagement.
 * Also called automatically on first pointerdown/keydown so voice starts
 * immediately on the very first interaction without waiting for a full click.
 */
export function unlockVoice() {
  if (typeof speechSynthesis === 'undefined' || unlocked) return
  try {
    // Load voices (async in Chrome — must be triggered)
    speechSynthesis.getVoices()

    // Speak a silent placeholder to satisfy Chrome's autoplay policy
    const u = new SpeechSynthesisUtterance('\u200B') // zero-width space
    u.volume = 0
    u.rate = 2
    u.onend = () => { unlocked = true; processQueue() }
    u.onerror = () => { unlocked = true } // error = still unlocked for next call
    speechSynthesis.speak(u)
  } catch { /* ignore */ }
}

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
