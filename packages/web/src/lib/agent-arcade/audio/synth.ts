/**
 * World-class procedural sound effects for Agent Arcade
 *
 * All SFX generated with Web Audio oscillators + noise.
 * Features:
 * - Algorithmic reverb via feedback delay network
 * - Detuned oscillator pairs for rich, wide tones
 * - Proper ADSR envelopes
 * - Layered sound design per effect
 * - Zero external audio files needed
 */

import { getAudioEngine } from './engine'

// ── Shared reverb send ────────────────────────────────────────────────────
let reverbNode: ConvolverNode | null = null

function getOrCreateReverb(ctx: AudioContext, dest: AudioNode): AudioNode {
  if (reverbNode) return reverbNode
  // Build impulse response for a short room reverb
  const len = Math.floor(ctx.sampleRate * 1.2)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
    }
  }
  reverbNode = ctx.createConvolver()
  reverbNode.buffer = buf
  const wetGain = ctx.createGain()
  wetGain.gain.value = 0.2
  reverbNode.connect(wetGain)
  wetGain.connect(dest)
  return reverbNode
}

/** Play a single note with optional detuned harmonics for a richer tone */
function playNote(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  startTime: number,
  duration: number,
  volume: number = 0.3,
  detune: number = 0,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  if (detune) osc.detune.setValueAtTime(detune, startTime)
  gain.gain.setValueAtTime(volume, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

/** Rich note — play detuned pair for chorus/width effect */
function playRichNote(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  startTime: number,
  duration: number,
  volume: number = 0.3,
) {
  playNote(ctx, dest, type, freq, startTime, duration, volume * 0.65, 0)
  playNote(ctx, dest, type, freq, startTime, duration, volume * 0.35, 7) // slight detune for width
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  startTime: number,
  duration: number,
  volume: number = 0.15,
) {
  const bufferSize = Math.floor(ctx.sampleRate * duration)
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * volume
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  source.connect(gain)
  gain.connect(dest)
  source.start(startTime)
  source.stop(startTime + duration + 0.01)
}

export function playSpawnSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  const reverb = getOrCreateReverb(ctx, dest)

  // Layered rising sweep: sine + harmonic fifth
  const osc = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc2.type = 'sine'
  osc.frequency.setValueAtTime(180, t)
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.3)
  osc2.frequency.setValueAtTime(270, t)
  osc2.frequency.exponentialRampToValueAtTime(1350, t + 0.3)
  gain.gain.setValueAtTime(0.22, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  osc.connect(gain)
  osc2.connect(gain)
  gain.connect(dest)
  gain.connect(reverb)
  osc.start(t)
  osc2.start(t)
  osc.stop(t + 0.4)
  osc2.stop(t + 0.4)

  // Sparkle chime at peak
  playNote(ctx, dest, 'sine', 1760, t + 0.2, 0.15, 0.08)
  playNote(ctx, dest, 'sine', 2093, t + 0.22, 0.12, 0.06)
  noiseBurst(ctx, dest, t, 0.08, 0.06)
}

export function playStateChangeSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  // Two-tone click with subtle reverb
  playRichNote(ctx, dest, 'square', 880, t, 0.05, 0.1)
  playNote(ctx, dest, 'sine', 660, t + 0.03, 0.04, 0.06)
}

export function playToolUseSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  const reverb = getOrCreateReverb(ctx, dest)
  // Metallic ping with harmonics
  playRichNote(ctx, dest, 'triangle', 1200, t, 0.18, 0.18)
  playNote(ctx, dest, 'triangle', 1800, t + 0.03, 0.14, 0.08)
  playNote(ctx, dest, 'sine', 2400, t + 0.05, 0.1, 0.04)
  // Send to reverb for metallic tail
  const revSend = ctx.createGain()
  revSend.gain.value = 0.1
  const o = ctx.createOscillator()
  o.type = 'triangle'
  o.frequency.value = 1200
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.08, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
  o.connect(g)
  g.connect(revSend)
  revSend.connect(reverb)
  o.start(t)
  o.stop(t + 0.15)
}

export function playMessageSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  // Soft chime chord — C + E + G
  playRichNote(ctx, dest, 'sine', 523, t, 0.2, 0.12)
  playNote(ctx, dest, 'sine', 659, t + 0.02, 0.18, 0.1)
  playNote(ctx, dest, 'sine', 784, t + 0.04, 0.16, 0.08)
}

export function playDoneSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  const reverb = getOrCreateReverb(ctx, dest)
  // Victory arpeggio C-E-G-C with harmonics + reverb tail
  const notes = [523, 659, 784, 1047]
  notes.forEach((freq, i) => {
    playRichNote(ctx, dest, 'sine', freq, t + i * 0.1, 0.2, 0.18)
    // Reverb send
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.06, t + i * 0.1)
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.2)
    o.connect(g)
    g.connect(reverb)
    o.start(t + i * 0.1)
    o.stop(t + i * 0.1 + 0.25)
  })
  // Final shimmer
  playNote(ctx, dest, 'sine', 2093, t + 0.45, 0.3, 0.06)
  noiseBurst(ctx, dest, t + 0.4, 0.05, 0.03)
}

export function playErrorSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  // Low buzz with tremolo + dissonant overtone
  const osc = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const gain = ctx.createGain()
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  osc.type = 'sawtooth'
  osc.frequency.value = 80
  osc2.type = 'sawtooth'
  osc2.frequency.value = 87 // dissonant detuning
  lfo.type = 'sine'
  lfo.frequency.value = 18
  lfoGain.gain.value = 0.12
  lfo.connect(lfoGain)
  lfoGain.connect(gain.gain)
  gain.gain.setValueAtTime(0.18, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  osc.connect(gain)
  osc2.connect(gain)
  gain.connect(dest)
  osc.start(t)
  osc2.start(t)
  osc.stop(t + 0.4)
  osc2.stop(t + 0.4)
  lfo.start(t)
  lfo.stop(t + 0.4)
  // Impact thud
  noiseBurst(ctx, dest, t, 0.04, 0.12)
}

export function playSelectSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  noiseBurst(ctx, dest, t, 0.025, 0.15)
  playNote(ctx, dest, 'sine', 1200, t, 0.04, 0.08)
  playNote(ctx, dest, 'sine', 1500, t + 0.015, 0.03, 0.05)
}

export function playTypingSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  // Rapid soft clicks with pitch variation
  for (let i = 0; i < 3; i++) {
    const pitch = 800 + Math.random() * 600
    noiseBurst(ctx, dest, t + i * 0.06, 0.018, 0.05)
    playNote(ctx, dest, 'square', pitch, t + i * 0.06, 0.018, 0.025)
  }
}

// ── Trust & Narrative SFX ─────────────────────────────────────────────────

/** Chime that varies in pitch/brightness with trust level (0-1) */
export function playTrustChime(trust: number) {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  // Higher trust → brighter, higher pitched
  const base = 400 + trust * 600
  playRichNote(ctx, dest, 'sine', base, t, 0.15, 0.08 + trust * 0.06)
  playNote(ctx, dest, 'sine', base * 1.5, t + 0.04, 0.1, 0.04 + trust * 0.03)
}

/** Recovery success — rising two-note chime */
export function playRecoverySfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  const reverb = getOrCreateReverb(ctx, dest)
  playRichNote(ctx, dest, 'sine', 440, t, 0.12, 0.14)
  playRichNote(ctx, dest, 'sine', 660, t + 0.1, 0.18, 0.16)
  playNote(ctx, reverb, 'sine', 660, t + 0.1, 0.15, 0.05)
}

/** Narrative milestone — gentle bell chime */
export function playMilestoneSfx() {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getSfxGain()
  if (!ctx || !dest) return
  const t = ctx.currentTime
  const reverb = getOrCreateReverb(ctx, dest)
  playNote(ctx, dest, 'sine', 1047, t, 0.25, 0.06)
  playNote(ctx, dest, 'triangle', 1319, t + 0.06, 0.2, 0.04)
  playNote(ctx, reverb, 'sine', 1568, t + 0.12, 0.2, 0.03)
}
