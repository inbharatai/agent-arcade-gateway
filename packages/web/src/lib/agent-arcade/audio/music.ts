/**
 * World-class procedural ambient music for Agent Arcade
 *
 * Per-theme generative ambient loops using Web Audio.
 * Features:
 * - Proper chord progressions (multi-oscillator chords)
 * - Harmonic intervals (3rds, 5ths)
 * - Algorithmic reverb/delay per theme
 * - Rhythmic patterns via LFO-gated oscillators
 * - Dynamic filtering with resonance
 * - Multiple layers per theme for rich soundscapes
 */

import { getAudioEngine } from './engine'

interface MusicLoop {
  nodes: AudioNode[]
  oscillators: OscillatorNode[]
  sources: AudioBufferSourceNode[]
  playing: boolean
  themeId: string
}

let currentLoop: MusicLoop | null = null
let fadeInterval: ReturnType<typeof setTimeout> | null = null

function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Create a simple impulse response for reverb */
function createReverbBuffer(ctx: AudioContext, duration: number = 1.5, decay: number = 2.5): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * duration)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** Create a reverb convolver for a theme */
function createReverb(ctx: AudioContext, dest: AudioNode, loop: MusicLoop, wet: number = 0.15, duration: number = 1.5): AudioNode {
  const reverb = ctx.createConvolver()
  reverb.buffer = createReverbBuffer(ctx, duration)
  const wetGain = ctx.createGain()
  wetGain.gain.value = wet
  reverb.connect(wetGain)
  wetGain.connect(dest)
  loop.nodes.push(reverb, wetGain)
  return reverb
}

/** Play a chord: multiple oscillators at once */
function addChord(
  ctx: AudioContext, dest: AudioNode, loop: MusicLoop,
  type: OscillatorType, freqs: number[], volume: number,
  filterFreq?: number, filterQ?: number,
) {
  const outGain = ctx.createGain()
  outGain.gain.value = volume

  let target: AudioNode = outGain
  if (filterFreq) {
    const flt = ctx.createBiquadFilter()
    flt.type = 'lowpass'
    flt.frequency.value = filterFreq
    flt.Q.value = filterQ ?? 1
    outGain.connect(flt)
    flt.connect(dest)
    loop.nodes.push(flt)
    target = outGain
  } else {
    outGain.connect(dest)
  }

  for (const freq of freqs) {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(target)
    osc.start()
    loop.oscillators.push(osc)
  }
  loop.nodes.push(outGain)
}

function stopLoop() {
  if (!currentLoop) return
  if (fadeInterval) { clearTimeout(fadeInterval); fadeInterval = null }
  for (const o of currentLoop.oscillators) { try { o.stop() } catch { /* already stopped */ } }
  for (const s of currentLoop.sources) { try { s.stop() } catch { /* already stopped */ } }
  for (const n of currentLoop.nodes) { try { n.disconnect() } catch { /* ok */ } }
  currentLoop.playing = false
  currentLoop = null
}

function createOffice(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'office' }
  const reverb = createReverb(ctx, dest, loop, 0.12, 1.8)

  // Warm pad chord: Cmaj7 (C3-E3-G3-B3)
  const padGain = ctx.createGain()
  padGain.gain.value = 0.035
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 600
  padFilter.Q.value = 0.7
  const padLfo = ctx.createOscillator()
  const padLfoGain = ctx.createGain()
  padLfo.type = 'sine'
  padLfo.frequency.value = 0.05  // very slow filter sweep
  padLfoGain.gain.value = 200
  padLfo.connect(padLfoGain)
  padLfoGain.connect(padFilter.frequency)
  padLfo.start()
  loop.oscillators.push(padLfo)
  loop.nodes.push(padLfoGain)

  for (const freq of [130.8, 164.8, 196, 246.9]) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(padGain)
    osc.start()
    loop.oscillators.push(osc)
  }
  padGain.connect(padFilter)
  padFilter.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain, padFilter)

  // Sub bass with gentle pulse
  const bass = ctx.createOscillator()
  const bassGain = ctx.createGain()
  const bassLfo = ctx.createOscillator()
  const bassLfoGain = ctx.createGain()
  bass.type = 'sine'
  bass.frequency.value = 55
  bassGain.gain.value = 0.07
  bassLfo.type = 'sine'
  bassLfo.frequency.value = 0.25
  bassLfoGain.gain.value = 0.03
  bassLfo.connect(bassLfoGain)
  bassLfoGain.connect(bassGain.gain)
  bass.connect(bassGain)
  bassGain.connect(dest)
  bass.start()
  bassLfo.start()
  loop.oscillators.push(bass, bassLfo)
  loop.nodes.push(bassGain, bassLfoGain)

  // Hi-hat texture
  const noiseBuf = createNoiseBuffer(ctx, 2)
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.015
  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = 9000
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  noise.connect(hpf)
  hpf.connect(noiseGain)
  noiseGain.connect(dest)
  noise.start()
  loop.sources.push(noise)
  loop.nodes.push(noiseGain, hpf)

  // Gentle high chime (octave above root, very quiet)
  const chime = ctx.createOscillator()
  const chimeGain = ctx.createGain()
  const chimeLfo = ctx.createOscillator()
  const chimeLfoGain = ctx.createGain()
  chime.type = 'sine'
  chime.frequency.value = 523
  chimeGain.gain.value = 0
  chimeLfo.type = 'sine'
  chimeLfo.frequency.value = 0.15
  chimeLfoGain.gain.value = 0.015
  chimeLfo.connect(chimeLfoGain)
  chimeLfoGain.connect(chimeGain.gain)
  chime.connect(chimeGain)
  chimeGain.connect(reverb)
  chime.start()
  chimeLfo.start()
  loop.oscillators.push(chime, chimeLfo)
  loop.nodes.push(chimeGain, chimeLfoGain)

  return loop
}

function createWarRoom(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'war-room' }
  const reverb = createReverb(ctx, dest, loop, 0.08, 1.2)

  // Tense drone — minor 2nd cluster for dissonance
  const droneFilter = ctx.createBiquadFilter()
  droneFilter.type = 'lowpass'
  droneFilter.frequency.value = 180
  droneFilter.Q.value = 2
  const droneGain = ctx.createGain()
  droneGain.gain.value = 0.05
  for (const freq of [55, 58.5, 82.5]) { // A1 + dissonant Bb1 + E2 (power 5th)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.connect(droneFilter)
    osc.start()
    loop.oscillators.push(osc)
  }
  droneFilter.connect(droneGain)
  droneGain.connect(dest)
  droneGain.connect(reverb)
  loop.nodes.push(droneGain, droneFilter)

  // Radar blip — rhythmic ping
  const blip = ctx.createOscillator()
  const blipGain = ctx.createGain()
  const blipLfo = ctx.createOscillator()
  const blipLfoGain = ctx.createGain()
  blip.type = 'sine'
  blip.frequency.value = 1200
  blipGain.gain.value = 0
  blipLfo.type = 'square'
  blipLfo.frequency.value = 0.25
  blipLfoGain.gain.value = 0.025
  blipLfo.connect(blipLfoGain)
  blipLfoGain.connect(blipGain.gain)
  blip.connect(blipGain)
  blipGain.connect(dest)
  blip.start()
  blipLfo.start()
  loop.oscillators.push(blip, blipLfo)
  loop.nodes.push(blipGain, blipLfoGain)

  // Tension strings — filtered noise with resonance
  const noiseBuf = createNoiseBuffer(ctx, 3)
  const tensionGain = ctx.createGain()
  tensionGain.gain.value = 0.02
  const tensFlt = ctx.createBiquadFilter()
  tensFlt.type = 'bandpass'
  tensFlt.frequency.value = 350
  tensFlt.Q.value = 8
  const tensLfo = ctx.createOscillator()
  const tensLfoGain = ctx.createGain()
  tensLfo.type = 'sine'
  tensLfo.frequency.value = 0.08
  tensLfoGain.gain.value = 100
  tensLfo.connect(tensLfoGain)
  tensLfoGain.connect(tensFlt.frequency)
  const tensNoise = ctx.createBufferSource()
  tensNoise.buffer = noiseBuf
  tensNoise.loop = true
  tensNoise.connect(tensFlt)
  tensFlt.connect(tensionGain)
  tensionGain.connect(dest)
  tensionGain.connect(reverb)
  tensNoise.start()
  tensLfo.start()
  loop.sources.push(tensNoise)
  loop.oscillators.push(tensLfo)
  loop.nodes.push(tensionGain, tensFlt, tensLfoGain)

  return loop
}

function createRetroArcade(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'retro-arcade' }

  // Chiptune bass — square wave with arpeggio
  const bass = ctx.createOscillator()
  const bassGain = ctx.createGain()
  bass.type = 'square'
  bass.frequency.value = 110
  bassGain.gain.value = 0.07
  const arpLfo = ctx.createOscillator()
  const arpGain = ctx.createGain()
  arpLfo.type = 'sawtooth'
  arpLfo.frequency.value = 4
  arpGain.gain.value = 55
  arpLfo.connect(arpGain)
  arpGain.connect(bass.frequency)
  bass.connect(bassGain)
  bassGain.connect(dest)
  bass.start()
  arpLfo.start()
  loop.oscillators.push(bass, arpLfo)
  loop.nodes.push(bassGain, arpGain)

  // Lead melody — triangle wave with vibrato (classic chiptune)
  const lead = ctx.createOscillator()
  const leadGain = ctx.createGain()
  lead.type = 'triangle'
  lead.frequency.value = 440
  leadGain.gain.value = 0.035
  const vibrato = ctx.createOscillator()
  const vibratoGain = ctx.createGain()
  vibrato.type = 'sine'
  vibrato.frequency.value = 5.5
  vibratoGain.gain.value = 10
  vibrato.connect(vibratoGain)
  vibratoGain.connect(lead.frequency)
  lead.connect(leadGain)
  leadGain.connect(dest)
  lead.start()
  vibrato.start()
  loop.oscillators.push(lead, vibrato)
  loop.nodes.push(leadGain, vibratoGain)

  // Harmony — 5th above lead for chiptune feel
  const harm = ctx.createOscillator()
  const harmGain = ctx.createGain()
  harm.type = 'square'
  harm.frequency.value = 660 // E5 perfect 5th
  harmGain.gain.value = 0.02
  harm.connect(harmGain)
  harmGain.connect(dest)
  harm.start()
  loop.oscillators.push(harm)
  loop.nodes.push(harmGain)

  // Noise percussion — filtered rhythmic noise
  const noiseBuf = createNoiseBuffer(ctx, 1)
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0
  const noiseLfo = ctx.createOscillator()
  const noiseLfoGain = ctx.createGain()
  noiseLfo.type = 'square'
  noiseLfo.frequency.value = 8
  noiseLfoGain.gain.value = 0.03
  noiseLfo.connect(noiseLfoGain)
  noiseLfoGain.connect(noiseGain.gain)
  const noiseFlt = ctx.createBiquadFilter()
  noiseFlt.type = 'highpass'
  noiseFlt.frequency.value = 6000
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  noise.connect(noiseFlt)
  noiseFlt.connect(noiseGain)
  noiseGain.connect(dest)
  noise.start()
  noiseLfo.start()
  loop.sources.push(noise)
  loop.oscillators.push(noiseLfo)
  loop.nodes.push(noiseGain, noiseFlt, noiseLfoGain)

  return loop
}

function createCyberLab(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'cyber-lab' }
  const reverb = createReverb(ctx, dest, loop, 0.2, 2.5)

  // Saw pad chord with filter sweep: Cm9 (C-Eb-G-Bb-D)
  const padFilter = ctx.createBiquadFilter()
  const filterLfo = ctx.createOscillator()
  const filterLfoGain = ctx.createGain()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 700
  padFilter.Q.value = 4
  filterLfo.type = 'sine'
  filterLfo.frequency.value = 0.08
  filterLfoGain.gain.value = 500
  filterLfo.connect(filterLfoGain)
  filterLfoGain.connect(padFilter.frequency)
  filterLfo.start()
  loop.oscillators.push(filterLfo)
  loop.nodes.push(padFilter, filterLfoGain)

  const padGain = ctx.createGain()
  padGain.gain.value = 0.03
  for (const freq of [130.8, 155.6, 196, 233.1, 293.7]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.connect(padFilter)
    osc.start()
    loop.oscillators.push(osc)
  }
  padFilter.connect(padGain)
  padGain.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain)

  // Glitch percussion — gated bandpass noise
  const noiseBuf = createNoiseBuffer(ctx, 1)
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.012
  const bpf = ctx.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.frequency.value = 4000
  bpf.Q.value = 6
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  const noiseLfo = ctx.createOscillator()
  const noiseLfoGain = ctx.createGain()
  noiseLfo.type = 'square'
  noiseLfo.frequency.value = 2
  noiseLfoGain.gain.value = 0.012
  noiseLfo.connect(noiseLfoGain)
  noiseLfoGain.connect(noiseGain.gain)
  noise.connect(bpf)
  bpf.connect(noiseGain)
  noiseGain.connect(dest)
  noise.start()
  noiseLfo.start()
  loop.sources.push(noise)
  loop.oscillators.push(noiseLfo)
  loop.nodes.push(noiseGain, bpf, noiseLfoGain)

  // High-frequency data blip with reverb
  const dataBlip = ctx.createOscillator()
  const dataGain = ctx.createGain()
  const dataLfo = ctx.createOscillator()
  const dataLfoGain = ctx.createGain()
  dataBlip.type = 'sine'
  dataBlip.frequency.value = 3200
  dataGain.gain.value = 0
  dataLfo.type = 'square'
  dataLfo.frequency.value = 0.4
  dataLfoGain.gain.value = 0.012
  dataLfo.connect(dataLfoGain)
  dataLfoGain.connect(dataGain.gain)
  dataBlip.connect(dataGain)
  dataGain.connect(reverb)
  dataBlip.start()
  dataLfo.start()
  loop.oscillators.push(dataBlip, dataLfo)
  loop.nodes.push(dataGain, dataLfoGain)

  return loop
}

function createCampusOps(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'campus-ops' }
  const reverb = createReverb(ctx, dest, loop, 0.18, 2.0)

  // Wind (filtered noise with slow modulation)
  const windBuf = createNoiseBuffer(ctx, 3)
  const windGain = ctx.createGain()
  windGain.gain.value = 0.025
  const windFilter = ctx.createBiquadFilter()
  windFilter.type = 'lowpass'
  windFilter.frequency.value = 500
  const windLfo = ctx.createOscillator()
  const windLfoGain = ctx.createGain()
  windLfo.type = 'sine'
  windLfo.frequency.value = 0.12
  windLfoGain.gain.value = 200
  windLfo.connect(windLfoGain)
  windLfoGain.connect(windFilter.frequency)
  const wind = ctx.createBufferSource()
  wind.buffer = windBuf
  wind.loop = true
  wind.connect(windFilter)
  windFilter.connect(windGain)
  windGain.connect(dest)
  wind.start()
  windLfo.start()
  loop.sources.push(wind)
  loop.oscillators.push(windLfo)
  loop.nodes.push(windGain, windFilter, windLfoGain)

  // Bird chirps — gated high sine with frequency wobble
  const bird = ctx.createOscillator()
  const birdGain = ctx.createGain()
  const birdLfo = ctx.createOscillator()
  const birdLfoGain = ctx.createGain()
  bird.type = 'sine'
  bird.frequency.value = 2400
  birdGain.gain.value = 0
  birdLfo.type = 'square'
  birdLfo.frequency.value = 0.3
  birdLfoGain.gain.value = 0.02
  birdLfo.connect(birdLfoGain)
  birdLfoGain.connect(birdGain.gain)
  const freqLfo = ctx.createOscillator()
  const freqLfoGain = ctx.createGain()
  freqLfo.type = 'sine'
  freqLfo.frequency.value = 14
  freqLfoGain.gain.value = 500
  freqLfo.connect(freqLfoGain)
  freqLfoGain.connect(bird.frequency)
  bird.connect(birdGain)
  birdGain.connect(dest)
  birdGain.connect(reverb)
  bird.start()
  birdLfo.start()
  freqLfo.start()
  loop.oscillators.push(bird, birdLfo, freqLfo)
  loop.nodes.push(birdGain, birdLfoGain, freqLfoGain)

  // Gentle pad chord: Gmaj (G3-B3-D4)
  const padGain = ctx.createGain()
  padGain.gain.value = 0.03
  for (const freq of [196, 246.9, 293.7]) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(padGain)
    osc.start()
    loop.oscillators.push(osc)
  }
  padGain.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain)

  // Melodic fifth (interval shimmer)
  const fifth = ctx.createOscillator()
  const fifthGain = ctx.createGain()
  const fifthLfo = ctx.createOscillator()
  const fifthLfoGain = ctx.createGain()
  fifth.type = 'sine'
  fifth.frequency.value = 587.3 // D5
  fifthGain.gain.value = 0
  fifthLfo.type = 'sine'
  fifthLfo.frequency.value = 0.2
  fifthLfoGain.gain.value = 0.012
  fifthLfo.connect(fifthLfoGain)
  fifthLfoGain.connect(fifthGain.gain)
  fifth.connect(fifthGain)
  fifthGain.connect(reverb)
  fifth.start()
  fifthLfo.start()
  loop.oscillators.push(fifth, fifthLfo)
  loop.nodes.push(fifthGain, fifthLfoGain)

  return loop
}

function createDeepSpace(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'deep-space' }
  const reverb = createReverb(ctx, dest, loop, 0.25, 3.0)

  // Deep space drone — very low, vast-sounding pad
  // Em chord (E2-B2-E3-G3) — ethereal minor
  const padGain = ctx.createGain()
  padGain.gain.value = 0.025
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 400
  padFilter.Q.value = 0.5
  const padLfo = ctx.createOscillator()
  const padLfoGain = ctx.createGain()
  padLfo.type = 'sine'
  padLfo.frequency.value = 0.03
  padLfoGain.gain.value = 150
  padLfo.connect(padLfoGain)
  padLfoGain.connect(padFilter.frequency)
  padLfo.start()
  loop.oscillators.push(padLfo)
  loop.nodes.push(padLfoGain)

  for (const freq of [82.4, 123.5, 164.8, 196]) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(padGain)
    osc.start()
    loop.oscillators.push(osc)
  }
  padGain.connect(padFilter)
  padFilter.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain, padFilter)

  // Sub-bass rumble
  const bass = ctx.createOscillator()
  const bassGain = ctx.createGain()
  bass.type = 'sine'
  bass.frequency.value = 41.2
  bassGain.gain.value = 0.06
  const bassLfo = ctx.createOscillator()
  const bassLfoGain = ctx.createGain()
  bassLfo.type = 'sine'
  bassLfo.frequency.value = 0.12
  bassLfoGain.gain.value = 0.025
  bassLfo.connect(bassLfoGain)
  bassLfoGain.connect(bassGain.gain)
  bass.connect(bassGain)
  bassGain.connect(dest)
  bass.start()
  bassLfo.start()
  loop.oscillators.push(bass, bassLfo)
  loop.nodes.push(bassGain, bassLfoGain)

  // High crystalline shimmer — detuned sine pulsing in and out
  const shimmer = ctx.createOscillator()
  const shimmerGain = ctx.createGain()
  const shimmerLfo = ctx.createOscillator()
  const shimmerLfoGain = ctx.createGain()
  shimmer.type = 'sine'
  shimmer.frequency.value = 659.3 // E5
  shimmerGain.gain.value = 0
  shimmerLfo.type = 'sine'
  shimmerLfo.frequency.value = 0.08
  shimmerLfoGain.gain.value = 0.008
  shimmerLfo.connect(shimmerLfoGain)
  shimmerLfoGain.connect(shimmerGain.gain)
  shimmer.connect(shimmerGain)
  shimmerGain.connect(reverb)
  shimmer.start()
  shimmerLfo.start()
  loop.oscillators.push(shimmer, shimmerLfo)
  loop.nodes.push(shimmerGain, shimmerLfoGain)

  // Distant radio static (very subtle)
  const noiseBuf = createNoiseBuffer(ctx, 2)
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.008
  const bpf = ctx.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.frequency.value = 2500
  bpf.Q.value = 3
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  noise.connect(bpf)
  bpf.connect(noiseGain)
  noiseGain.connect(reverb)
  noise.start()
  loop.sources.push(noise)
  loop.nodes.push(noiseGain, bpf)

  return loop
}

function createDungeonTerminal(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'dungeon-terminal' }
  const reverb = createReverb(ctx, dest, loop, 0.2, 2.5)

  // Dark minor drone — Am (A2-C3-E3)
  const padGain = ctx.createGain()
  padGain.gain.value = 0.03
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 350
  padFilter.Q.value = 0.8
  for (const freq of [110, 130.8, 164.8]) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    osc.connect(padGain)
    osc.start()
    loop.oscillators.push(osc)
  }
  padGain.connect(padFilter)
  padFilter.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain, padFilter)

  // Deep bass pulse
  const bass = ctx.createOscillator()
  const bassGain = ctx.createGain()
  bass.type = 'sine'
  bass.frequency.value = 55
  bassGain.gain.value = 0.05
  const bassLfo = ctx.createOscillator()
  const bassLfoGain = ctx.createGain()
  bassLfo.type = 'sine'
  bassLfo.frequency.value = 0.3
  bassLfoGain.gain.value = 0.025
  bassLfo.connect(bassLfoGain)
  bassLfoGain.connect(bassGain.gain)
  bass.connect(bassGain)
  bassGain.connect(dest)
  bass.start()
  bassLfo.start()
  loop.oscillators.push(bass, bassLfo)
  loop.nodes.push(bassGain, bassLfoGain)

  // Eerie high tone — weaving fifth
  const eerie = ctx.createOscillator()
  const eerieGain = ctx.createGain()
  const eerieLfo = ctx.createOscillator()
  const eerieLfoGain = ctx.createGain()
  eerie.type = 'sine'
  eerie.frequency.value = 329.6 // E4
  eerieGain.gain.value = 0
  eerieLfo.type = 'sine'
  eerieLfo.frequency.value = 0.12
  eerieLfoGain.gain.value = 0.01
  eerieLfo.connect(eerieLfoGain)
  eerieLfoGain.connect(eerieGain.gain)
  eerie.connect(eerieGain)
  eerieGain.connect(reverb)
  eerie.start()
  eerieLfo.start()
  loop.oscillators.push(eerie, eerieLfo)
  loop.nodes.push(eerieGain, eerieLfoGain)

  // Dripping water sound — noise bursts
  const noiseBuf = createNoiseBuffer(ctx, 2)
  const dripGain = ctx.createGain()
  dripGain.gain.value = 0.01
  const dripFilter = ctx.createBiquadFilter()
  dripFilter.type = 'bandpass'
  dripFilter.frequency.value = 4000
  dripFilter.Q.value = 5
  const dripLfo = ctx.createOscillator()
  const dripLfoGain = ctx.createGain()
  dripLfo.type = 'square'
  dripLfo.frequency.value = 0.4
  dripLfoGain.gain.value = 0.01
  dripLfo.connect(dripLfoGain)
  dripLfoGain.connect(dripGain.gain)
  dripLfo.start()
  const drip = ctx.createBufferSource()
  drip.buffer = noiseBuf
  drip.loop = true
  drip.connect(dripFilter)
  dripFilter.connect(dripGain)
  dripGain.connect(reverb)
  drip.start()
  loop.sources.push(drip)
  loop.oscillators.push(dripLfo)
  loop.nodes.push(dripGain, dripFilter, dripLfoGain)

  return loop
}

function createHackerBunker(ctx: AudioContext, dest: AudioNode): MusicLoop {
  const loop: MusicLoop = { nodes: [], oscillators: [], sources: [], playing: true, themeId: 'hacker-bunker' }
  const reverb = createReverb(ctx, dest, loop, 0.1, 1.0)

  // Tense minor pad — Dm (D3-F3-A3)
  const padGain = ctx.createGain()
  padGain.gain.value = 0.025
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 500
  padFilter.Q.value = 1.2
  const padLfo = ctx.createOscillator()
  const padLfoGain = ctx.createGain()
  padLfo.type = 'sine'
  padLfo.frequency.value = 0.06
  padLfoGain.gain.value = 200
  padLfo.connect(padLfoGain)
  padLfoGain.connect(padFilter.frequency)
  padLfo.start()
  loop.oscillators.push(padLfo)
  loop.nodes.push(padLfoGain)

  for (const freq of [146.8, 174.6, 220]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.connect(padGain)
    osc.start()
    loop.oscillators.push(osc)
  }
  padGain.connect(padFilter)
  padFilter.connect(dest)
  padGain.connect(reverb)
  loop.nodes.push(padGain, padFilter)

  // Pulsing bass — rhythmic
  const bass = ctx.createOscillator()
  const bassGain = ctx.createGain()
  bass.type = 'square'
  bass.frequency.value = 73.4 // D2
  bassGain.gain.value = 0.04
  const bassLfo = ctx.createOscillator()
  const bassLfoGain = ctx.createGain()
  bassLfo.type = 'square'
  bassLfo.frequency.value = 2
  bassLfoGain.gain.value = 0.035
  bassLfo.connect(bassLfoGain)
  bassLfoGain.connect(bassGain.gain)
  bass.connect(bassGain)
  const bassFilter = ctx.createBiquadFilter()
  bassFilter.type = 'lowpass'
  bassFilter.frequency.value = 300
  bassGain.connect(bassFilter)
  bassFilter.connect(dest)
  bass.start()
  bassLfo.start()
  loop.oscillators.push(bass, bassLfo)
  loop.nodes.push(bassGain, bassLfoGain, bassFilter)

  // Digital glitch noise — filtered noise bursts
  const noiseBuf = createNoiseBuffer(ctx, 2)
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = 0.012
  const noiseBpf = ctx.createBiquadFilter()
  noiseBpf.type = 'bandpass'
  noiseBpf.frequency.value = 6000
  noiseBpf.Q.value = 4
  const noiseLfo = ctx.createOscillator()
  const noiseLfoGain = ctx.createGain()
  noiseLfo.type = 'square'
  noiseLfo.frequency.value = 4
  noiseLfoGain.gain.value = 0.012
  noiseLfo.connect(noiseLfoGain)
  noiseLfoGain.connect(noiseGain.gain)
  noiseLfo.start()
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  noise.connect(noiseBpf)
  noiseBpf.connect(noiseGain)
  noiseGain.connect(dest)
  noise.start()
  loop.sources.push(noise)
  loop.oscillators.push(noiseLfo)
  loop.nodes.push(noiseGain, noiseBpf, noiseLfoGain)

  // High alert tone — piercing but quiet
  const alert = ctx.createOscillator()
  const alertGain = ctx.createGain()
  const alertLfo = ctx.createOscillator()
  const alertLfoGain = ctx.createGain()
  alert.type = 'sine'
  alert.frequency.value = 880
  alertGain.gain.value = 0
  alertLfo.type = 'sine'
  alertLfo.frequency.value = 0.2
  alertLfoGain.gain.value = 0.006
  alertLfo.connect(alertLfoGain)
  alertLfoGain.connect(alertGain.gain)
  alert.connect(alertGain)
  alertGain.connect(reverb)
  alert.start()
  alertLfo.start()
  loop.oscillators.push(alert, alertLfo)
  loop.nodes.push(alertGain, alertLfoGain)

  return loop
}

export function startMusic(themeId: string) {
  const engine = getAudioEngine()
  const ctx = engine.getContext()
  const dest = engine.getMusicGain()
  if (!ctx || !dest) return

  // Already playing this theme
  if (currentLoop?.playing && currentLoop.themeId === themeId) return

  stopLoop()

  switch (themeId) {
    case 'office': currentLoop = createOffice(ctx, dest); break
    case 'war-room': currentLoop = createWarRoom(ctx, dest); break
    case 'retro-arcade': currentLoop = createRetroArcade(ctx, dest); break
    case 'cyber-lab': currentLoop = createCyberLab(ctx, dest); break
    case 'campus-ops': currentLoop = createCampusOps(ctx, dest); break
    case 'deep-space': currentLoop = createDeepSpace(ctx, dest); break
    case 'dungeon-terminal': currentLoop = createDungeonTerminal(ctx, dest); break
    case 'hacker-bunker': currentLoop = createHackerBunker(ctx, dest); break
    default: currentLoop = createOffice(ctx, dest); break
  }
}

export function stopMusic() {
  stopLoop()
}

export function isMusicPlaying(): boolean {
  return currentLoop?.playing ?? false
}
