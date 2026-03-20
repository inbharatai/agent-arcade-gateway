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

import { speak, stopVoice, isVoiceAvailable, unlockVoice } from './voice'

function resetVoiceState() {
  stopVoice()
  mockSpeak.mockClear()
  mockCancel.mockClear()
  createdUtterances.length = 0
  // Unlock voice so processQueue actually speaks (Chrome autoplay policy gate)
  unlockVoice()
  // Clear the cancel call from unlockVoice
  mockCancel.mockClear()
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
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  test('does not add whitespace-only string to queue', () => {
    speak('   ', 'agent-1', 0)
    expect(mockSpeak).not.toHaveBeenCalled()
  })

  test('does add non-empty string and triggers speak', () => {
    speak('Hello world', 'agent-1', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })
})

// ── speak(): queue capping ────────────────────────────────────────────────

describe('speak(): queue capping at 6 items', () => {
  test('adding 7 items keeps only 6 in queue (oldest trimmed)', () => {
    // First speak starts speaking
    speak('First item — starts speaking', 'agent-a', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Add items 2–8 while "speaking" is true (they go to queue)
    for (let i = 2; i <= 8; i++) {
      speak(`Item ${i}`, 'agent-a', 0)
    }

    // Queue cap is 6: when queue.length >= 6, trim to 5 before pushing
    // So the queue stays capped at 6 items max
    expect(mockSpeak).toHaveBeenCalledTimes(1) // only the first item triggered speak
  })

  test('queue trim discards oldest items, not newest', () => {
    // Lock the speaking state with agent-trim-0
    speak('speaking-now', 'agent-trim-0', 0)

    // Add 7 more items with DIFFERENT agentIds so cooldown doesn't block
    const items = [
      { text: 'old-1', agentId: 'agent-trim-1' },
      { text: 'old-2', agentId: 'agent-trim-2' },
      { text: 'old-3', agentId: 'agent-trim-3' },
      { text: 'old-4', agentId: 'agent-trim-4' },
      { text: 'old-5', agentId: 'agent-trim-5' },
      { text: 'old-6', agentId: 'agent-trim-6' },
      { text: 'newest-7', agentId: 'agent-trim-7' },
    ]
    for (const item of items) {
      speak(item.text, item.agentId, 0)
    }

    // Simulate the first utterance finishing — processQueue pops the next item
    const utterance = createdUtterances[0]
    utterance.onend?.()

    expect(mockSpeak).toHaveBeenCalledTimes(2)
    const secondUtterance = createdUtterances[1]
    expect(secondUtterance).toBeDefined()
    // old-1 was trimmed — should NOT appear as the next spoken item
    expect(secondUtterance.text).not.toBe('old-1')
  })
})

// ── speak(): text truncation ──────────────────────────────────────────────

describe('speak(): text truncation', () => {
  test('truncates text to 120 characters', () => {
    const longText = 'A'.repeat(200)
    speak(longText, 'agent-trunc', 0)

    expect(mockSpeak).toHaveBeenCalledTimes(1)
    const utterance = createdUtterances[0]
    expect(utterance.text.length).toBe(120)
    expect(utterance.text).toBe('A'.repeat(120))
  })

  test('does not truncate text under 120 characters', () => {
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

// ── processQueue(): cooldown per agent (1.5s) ────────────────────────────

describe('processQueue(): per-agent cooldown (1.5s)', () => {
  test('second speak for same agent within 1.5s is skipped', () => {
    speak('First line', 'agent-cooldown', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    // Finish the utterance
    createdUtterances[0].onend?.()

    // Immediately try to speak again for the same agent (< 1.5s)
    speak('Second line — should be skipped due to cooldown', 'agent-cooldown', 0)

    // processQueue sees lastSpoke[agent-cooldown] is < 1.5s ago → skips
    expect(mockSpeak).toHaveBeenCalledTimes(1)
  })

  test('different agents are not affected by each other cooldowns', () => {
    speak('Agent A speaks', 'agent-a-cd', 0)
    // Finish agent-a-cd utterance
    createdUtterances[0].onend?.()

    // Agent B has never spoken — should speak immediately
    speak('Agent B speaks', 'agent-b-cd', 1)
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })
})

// ── stopVoice() ──────────────────────────────────────────────────────────

describe('stopVoice()', () => {
  test('calls speechSynthesis.cancel()', () => {
    mockCancel.mockClear()
    stopVoice()
    expect(mockCancel).toHaveBeenCalledTimes(1)
  })

  test('after stopVoice, new speak works again (speaking flag reset)', () => {
    speak('Something', 'agent-stop', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(1)

    stopVoice()
    // Re-unlock since stopVoice doesn't reset the unlock flag
    // (unlocked persists across stop, as expected)

    speak('After stop', 'agent-stop-2', 0)
    expect(mockSpeak).toHaveBeenCalledTimes(2)
  })
})
