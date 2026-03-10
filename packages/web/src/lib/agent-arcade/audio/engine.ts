/**
 * Web Audio engine for Agent Arcade
 *
 * Lazy-initialized on first user gesture. Provides master/music/sfx/voice
 * volume controls via GainNodes. Respects soundEnabled and reducedMotion.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private voiceGain: GainNode | null = null
  private _initialized = false

  get initialized() { return this._initialized }

  /** Call on first user gesture (click/keypress) */
  init() {
    if (this._initialized) return
    try {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.connect(this.ctx.destination)

      this.musicGain = this.ctx.createGain()
      this.musicGain.connect(this.masterGain)
      this.musicGain.gain.value = 0.3

      this.sfxGain = this.ctx.createGain()
      this.sfxGain.connect(this.masterGain)
      this.sfxGain.gain.value = 0.5

      this.voiceGain = this.ctx.createGain()
      this.voiceGain.connect(this.masterGain)
      this.voiceGain.gain.value = 0.6

      this._initialized = true
    } catch {
      // Web Audio not supported
    }
  }

  getContext(): AudioContext | null { return this.ctx }
  getMusicGain(): GainNode | null { return this.musicGain }
  getSfxGain(): GainNode | null { return this.sfxGain }
  getVoiceGain(): GainNode | null { return this.voiceGain }

  setMasterVolume(v: number) {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v))
  }

  setMusicVolume(v: number) {
    if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v))
  }

  setSfxVolume(v: number) {
    if (this.sfxGain) this.sfxGain.gain.value = Math.max(0, Math.min(1, v))
  }

  setVoiceVolume(v: number) {
    if (this.voiceGain) this.voiceGain.gain.value = Math.max(0, Math.min(1, v))
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume()
  }

  dispose() {
    this.ctx?.close()
    this.ctx = null
    this._initialized = false
  }
}

/** Singleton */
let instance: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!instance) instance = new AudioEngine()
  return instance
}
