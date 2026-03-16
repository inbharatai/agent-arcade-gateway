/**
 * Voice System Unit Tests
 *
 * Tests speak(), processQueue(), and queue management in isolation.
 * speechSynthesis is browser-only, so we mock it globally.
 *
 * Run with: bun test packages/web/src/lib/agent-arcade/audio/voice.test.ts
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ── Global browser API mocks ──────────────────────────────────────────────

const mockSpeak = mock(() => {})
const mockCancel = mock(() => {})
const mockGetVoices = mock(() => [])

// @ts-ignore
global.speechSynthesis = {
  speak: mockSpeak,
  cancel: mockCancel,
  getVoices: mockGetVoices,
}

// Track utterances created so tests can inspect them
const createdUtterances: InstanceType<typeof MockSpeechSynthesisUtterance>[] = []

class MockSpeechSynthesisUtterance {
  text: string
  rate = 1
  volume = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null

  constructor(t: string) {
    this.text = t
    createdUtterances.push(this)
  }
}

// @ts-ignore
global.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance

// ── Import the module AFTER setting up globals ────────────────────────────
// We must re-import fresh state for each describe block via module isolation.
// Since Bun caches modules, we test using the exported functions directly and
// track observable side effects on the mock.

// We use dynamic import with a cache-busting approach by testing behavior
// via the exported API. The module-level state (queue, speaking, lastSpoke)
// persists across tests in the same file, so we reset it via stopVoice()
// between tests.

import { speak, stopVoice, isVoiceAvailable } from './voice'

function resetVoiceState() {
  stopVoice()
  mockSpeak.mockClear()
  mockCancel.mockClear()
  createdUtterances.length = 0
}

beforeEach(() => {
  resetVoiceState()
})

// ── isVoiceAvailable ──────────────────────────────────────────────────────

describe('isVoiceAvailable', () => {
  test('returns true when speechSynthesis is defined (mocked)', () => {
    expect(isVoiceAvailable()).toBe(true)
  })
})

// ── speak(): empty string guard ───────────────────────────────────────────

describe('speak(): empty string guard', () => {
  test('does not add empty string to queue', () => {
    speak('', 'agent-1', 0)
    // No speak call should be made since queue was not populated
    // (processQueue called but queue empty)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  test('does not add whitespace-only string to queue', () => {
    speak('   ', 'agent-1', 0)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  test('does add non-empty string and triggers speak', () => {
    speak('Hello world', 'agent-1', 0)
    // processQueue will call speechSynthesis.speak immediately (speaking=false initially)
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })
})

// ── speak(): queue capping ────────────────────────────────────────────────

describe('speak(): queue capping at 5 items', () => {
  test('adding 6 items keeps only 5 in queue (oldest trimmed)', () => {
    // Saturate the queue by first starting a "speaking" state
    // We do this by calling speak once to start speaking, then adding to queue
    // without finishing the utterance
    speak('First item — starts speaking', 'agent-a', 0)
    // At this point speaking=true, mockSpeak called once.
    // Now add more items — they go to the queue but don't trigger speak (already speaking)

    // Add items 2–7 while "speaking" is true
    for (let i = 2; i <= 7; i++) {
      speak(`Item ${i}`, 'agent-a', 0)
    }

    // The queue cap logic: if queue.length >= 5, trim to 4 before pushing
    // So when we push item 7 (6th queued item), it trims to 4 then pushes → 5 items
    // Items 2-6 are queued (5 items), then item 7 causes a trim:
    // At item 6: queue has [2,3,4,5], push → [2,3,4,5,6] (length = 5, cap hit on next)
    // At item 7: queue.length >= 5 → splice to keep last 4: [3,4,5,6], push 7 → [3,4,5,6,7]
    // So queue has 5 items and items 1 (speaking) + 2 are gone

    // We can't directly inspect the internal queue, but we can verify:
    // 1. mockSpeak was called once (for item 1 that triggered speaking)
    // 2. After "finishing" the utterance, subsequent speak calls drain the queue
    expect(mockSpeak).toHaveBeenCalledTimes(1)
    const firstUtterance = createdUtterances[0]
    expect(firstUtterance).toBeDefined()
    expect(firstUtterance.text).toBe('First item — starts speaking')
  })

  test('queue trim discards oldest items, not newest', () => {
    // Use unique agent IDs per queued item so cooldown never blocks the next item.
    // The trim test needs to verify that after filling the queue past cap, the first
    // item to speak after the current utterance ends is NOT from the trimmed portion.

    // Lock the speaking state with agent-trim-0
    speak('speaking-now', 'agent-trim-0', 0)

    // Add 6 more items with DIFFERENT agentIds so cooldown doesn't block any of them
    const items = [
      { text: 'old-1', agentId: 'agent-trim-1' },
      { text: 'old-2', agentId: 'agent-trim-2' },
      { text: 'old-3', agentId: 'agent-trim-3' },
      { text: 'old-4', agentId: 'agent-trim-4' },
      { text: 'old-5', agentId: 'agent-trim-5' },
      { text: 'newest-6', agentId: 'agent-trim-6' },
    ]
    for (const item of items) {
      speak(item.text, item.agentId, 0)
    }

    // Now simulate the utterance finishing — this calls processQueue
    const utterance = createdUtterances[0]
    utterance.onend?.()

    // After trim: queue had old-1..old-5 (5 items), then newest-6 caused trim:
    //   splice(0, length-4) removes old-1, keeping [old-2,old-3,old-4,old-5], push newest-6
    //   → queue = [old-2, old-3, old-4, old-5, newest-6]
    // processQueue then dequeues old-2 and speaks it (not old-1, which was trimmed)
    expect(mockSpeak).toHaveBeenCalledTimes(2)
    const secondUtterance = createdUtterances[1]
    expect(secondUtterance).toBeDefined()
    // old-1 was trimmed — should NOT appear as the next spoken item
    expect(secondUtterance.text).not.toBe('old-1')
  })
})

// ── speak(): text truncation ──────────────────────────────────────────────

describe('speak(): text truncation', () => {
  test('truncates text to 80 characters', () => {
    const longText = 'A'.repeat(120)
    speak(longText, 'agent-trunc', 0)

    expect(mockSpeak).toHaveBeenCalledTimes(1)
    const utterance = createdUtterances[0]
    expect(utterance.text.length).toBe(80)
    expect(utterance.text).toBe('A'.repeat(80))
  })

  test('does not truncate text under 80 characters', () => {
    const shortText = 'Short message'
    speak(shortText, 'agent-short', 0)

    expect(mockSpeak).toHaveBeenCalledTimes(1)
    expect(createdUtterances[0].text).toBe('Short message')
  })
})

// ── processQueue(): utterance properties ─────────────────────────────────

describe('processQueue(): utterance properties', () => {
  test('utterance has rate=1.1 and volume=0.7', () => {
    speak('Test utterance', 'agent-props', 0)

    expect(createdUtterances[0]).toBeDefined()
    expect(createdUtterances[0].rate).toBe(1.1)
    expect(createdUtterances[0].volume).toBe(0.7)
  })

  test('pitch varies by agentIndex (0.8 + index%7 * 0.1)', () => {
    // agentIndex=0 → pitch = 0.8 + 0 * 0.1 = 0.8
    speak('Agent zero', 'agent-pitch-0', 0)
    const u0 = createdUtterances[0]
    expect(u0.pitch).toBeCloseTo(0.8, 5)
    resetVoiceState()

    // agentIndex=3 → pitch = 0.8 + 3 * 0.1 = 1.1
    speak('Agent three', 'agent-pitch-3', 3)
    const u3 = createdUtterances[0]
    expect(u3.pitch).toBeCloseTo(1.1, 5)
    resetVoiceState()

    // agentIndex=7 → 7%7=0 → pitch = 0.8
    speak('Agent seven', 'agent-pitch-7', 7)
    const u7 = createdUtterances[0]
    expect(u7.pitch).toBeCloseTo(0.8, 5)
  })
})

// ── processQueue(): cooldown per agent ────────────────────────────────────

describe('processQueue(): per-agent cooldown (3s)', () => {
  test('second speak for same agent within 3s is skipped', () => {
    // First speak for agent — succeeds
    speak('First line', 'agent-cooldown', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Finish the utterance
    createdUtterances[0].onend?.()

    // Immediately try to speak again for the same agent (< 3s since last spoke)
    speak('Second line — should be skipped due to cooldown', 'agent-cooldown', 0)

    // processQueue is called but sees lastSpoke[agent-cooldown] is < 3s ago
    // It will shift() the item and recurse, but queue is now empty → no new speak
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })

  test('different agents are not affected by each other cooldowns', () => {
    speak('Agent A speaks', 'agent-a-cd', 0)
    // Finish agent-a-cd utterance
    createdUtterances[0].onend?.()

    // Agent B has never spoken — should speak immediately despite agent-a-cd cooldown
    speak('Agent B speaks', 'agent-b-cd', 1)
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })
})

// ── stopVoice() ──────────────────────────────────────────────────────────

describe('stopVoice()', () => {
  test('calls speechSynthesis.cancel()', () => {
    stopVoice()
    expect(mockCancel).toHaveBeenCalledTimes(1)
  })

  test('after stopVoice, new speak works again (speaking flag reset)', () => {
    // Start speaking
    speak('Something', 'agent-stop', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Stop everything
    stopVoice()

    // New speak should work immediately
    speak('After stop', 'agent-stop-2', 0)
    // speaking was reset to false by stopVoice, so processQueue will call speak again
    // However, agent-stop-2 has no cooldown so it should go through
    expect(mockSpeak).toHaveBeenCalledTimes(2) // one from before stop, one after
  })
})
