/**
 * Agent Arcade Replay System
 *
 * Record, save, and replay agent sessions with full fidelity.
 * Supports playback speed control, seeking, and import/export.
 */

import type { TelemetryEvent } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayRecording {
  id: string
  sessionId: string
  sessionName?: string
  startedAt: number
  endedAt: number
  duration: number
  eventCount: number
  agentCount: number
  events: ReplayEvent[]
  metadata?: Record<string, unknown>
}

export interface ReplayEvent {
  /** Timestamp relative to recording start (ms) */
  offset: number
  type: string
  payload: TelemetryEvent
}

export type ReplayState = 'idle' | 'recording' | 'playing' | 'paused'

export interface ReplayPlaybackOptions {
  speed?: number           // 0.25x to 8x (default: 1)
  startOffset?: number     // ms offset to start from (default: 0)
  onEvent?: (event: TelemetryEvent) => void
  onComplete?: () => void
  onProgress?: (progress: number) => void
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'agent-arcade-replays'
const MAX_STORED_REPLAYS = 50

// ---------------------------------------------------------------------------
// Replay Engine
// ---------------------------------------------------------------------------

export class ReplayEngine {
  private state: ReplayState = 'idle'
  private recording: ReplayEvent[] = []
  private recordingSessionId = ''
  private recordingStart = 0
  private agentIds = new Set<string>()

  // Playback state
  private playbackTimer: ReturnType<typeof setTimeout> | null = null
  private playbackIndex = 0
  private playbackSpeed = 1
  private playbackStart = 0
  private playbackOffset = 0
  private currentRecording: ReplayRecording | null = null
  private onEventCallback: ((event: TelemetryEvent) => void) | null = null
  private onCompleteCallback: (() => void) | null = null
  private onProgressCallback: ((progress: number) => void) | null = null
  private isPaused = false

  // ── Recording ──────────────────────────────────────────────────────

  /** Start recording events */
  startRecording(sessionId: string): void {
    this.state = 'recording'
    this.recording = []
    this.recordingSessionId = sessionId
    this.recordingStart = Date.now()
    this.agentIds.clear()
  }

  /** Capture an event during recording */
  captureEvent(event: TelemetryEvent): void {
    if (this.state !== 'recording') return

    this.agentIds.add(event.agentId)
    this.recording.push({
      offset: Date.now() - this.recordingStart,
      type: event.type,
      payload: { ...event },
    })
  }

  /** Stop recording and return the recording */
  stopRecording(name?: string): ReplayRecording {
    const endTime = Date.now()
    const rec: ReplayRecording = {
      id: `replay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.recordingSessionId,
      sessionName: name || `Session ${new Date().toLocaleString()}`,
      startedAt: this.recordingStart,
      endedAt: endTime,
      duration: endTime - this.recordingStart,
      eventCount: this.recording.length,
      agentCount: this.agentIds.size,
      events: [...this.recording],
    }

    this.state = 'idle'
    this.recording = []
    this.agentIds.clear()
    return rec
  }

  /** Check if currently recording */
  isRecording(): boolean {
    return this.state === 'recording'
  }

  // ── Playback ───────────────────────────────────────────────────────

  /** Play a recording */
  play(recording: ReplayRecording, options: ReplayPlaybackOptions = {}): void {
    this.stop()

    this.currentRecording = recording
    this.playbackSpeed = options.speed || 1
    this.playbackOffset = options.startOffset || 0
    this.onEventCallback = options.onEvent || null
    this.onCompleteCallback = options.onComplete || null
    this.onProgressCallback = options.onProgress || null
    this.isPaused = false
    this.state = 'playing'

    // Find the starting index
    this.playbackIndex = 0
    for (let i = 0; i < recording.events.length; i++) {
      if (recording.events[i].offset >= this.playbackOffset) {
        this.playbackIndex = i
        break
      }
    }

    this.playbackStart = Date.now() - (this.playbackOffset / this.playbackSpeed)
    this._scheduleNext()
  }

  /** Pause playback */
  pause(): void {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.isPaused = true
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    // Store current offset for resume
    this.playbackOffset = this._currentPlaybackTime()
  }

  /** Resume playback */
  resume(): void {
    if (this.state !== 'paused' || !this.currentRecording) return
    this.state = 'playing'
    this.isPaused = false
    this.playbackStart = Date.now() - (this.playbackOffset / this.playbackSpeed)
    this._scheduleNext()
  }

  /** Stop playback completely */
  stop(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer)
      this.playbackTimer = null
    }
    this.state = 'idle'
    this.currentRecording = null
    this.playbackIndex = 0
    this.isPaused = false
  }

  /** Seek to a specific time (ms) */
  seek(timestamp: number): void {
    if (!this.currentRecording) return

    const wasPlaying = this.state === 'playing'
    if (wasPlaying) {
      if (this.playbackTimer) {
        clearTimeout(this.playbackTimer)
        this.playbackTimer = null
      }
    }

    this.playbackOffset = Math.max(0, Math.min(timestamp, this.currentRecording.duration))

    // Find the event index at this offset
    this.playbackIndex = 0
    for (let i = 0; i < this.currentRecording.events.length; i++) {
      if (this.currentRecording.events[i].offset >= this.playbackOffset) {
        this.playbackIndex = i
        break
      }
      // Replay all events up to seek point instantly
      if (this.onEventCallback) {
        this.onEventCallback(this.currentRecording.events[i].payload)
      }
    }

    this.playbackStart = Date.now() - (this.playbackOffset / this.playbackSpeed)

    if (this.onProgressCallback && this.currentRecording.duration > 0) {
      this.onProgressCallback(this.playbackOffset / this.currentRecording.duration)
    }

    if (wasPlaying) {
      this._scheduleNext()
    }
  }

  /** Set playback speed */
  setSpeed(speed: number): void {
    const validSpeeds = [0.25, 0.5, 1, 2, 4, 8]
    this.playbackSpeed = validSpeeds.includes(speed) ? speed : Math.max(0.25, Math.min(8, speed))

    if (this.state === 'playing' && this.currentRecording) {
      // Recalculate timing
      const currentTime = this._currentPlaybackTime()
      this.playbackOffset = currentTime
      this.playbackStart = Date.now() - (this.playbackOffset / this.playbackSpeed)

      if (this.playbackTimer) {
        clearTimeout(this.playbackTimer)
        this.playbackTimer = null
      }
      this._scheduleNext()
    }
  }

  /** Get current playback position (ms) */
  getCurrentTime(): number {
    if (this.state === 'paused') return this.playbackOffset
    if (this.state === 'playing') return this._currentPlaybackTime()
    return 0
  }

  /** Get total recording duration (ms) */
  getDuration(): number {
    return this.currentRecording?.duration || 0
  }

  /** Get current state */
  getState(): ReplayState {
    return this.state
  }

  /** Get current speed */
  getSpeed(): number {
    return this.playbackSpeed
  }

  /** Get playback progress (0..1) */
  getProgress(): number {
    const duration = this.getDuration()
    if (duration === 0) return 0
    return Math.min(1, this.getCurrentTime() / duration)
  }

  // ── Storage ────────────────────────────────────────────────────────

  /** Save a recording to localStorage */
  saveRecording(recording: ReplayRecording): void {
    if (typeof window === 'undefined') return
    try {
      const saved = this._loadAllRecordings()
      saved.unshift(recording)
      // Keep only the most recent N
      const trimmed = saved.slice(0, MAX_STORED_REPLAYS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch { /* storage full */ }
  }

  /** Load all saved recordings (metadata only, without events) */
  listRecordings(): Omit<ReplayRecording, 'events'>[] {
    return this._loadAllRecordings().map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionName: r.sessionName,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      duration: r.duration,
      eventCount: r.eventCount,
      agentCount: r.agentCount,
      metadata: r.metadata,
    }))
  }

  /** Load a full recording by ID */
  loadRecording(id: string): ReplayRecording | null {
    const all = this._loadAllRecordings()
    return all.find(r => r.id === id) || null
  }

  /** Delete a recording */
  deleteRecording(id: string): void {
    if (typeof window === 'undefined') return
    try {
      const saved = this._loadAllRecordings().filter(r => r.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch { /* ignore */ }
  }

  /** Export a recording as a JSON string */
  exportRecording(recording: ReplayRecording): string {
    return JSON.stringify(recording, null, 2)
  }

  /** Import a recording from a JSON string */
  importRecording(json: string): ReplayRecording {
    const recording = JSON.parse(json) as ReplayRecording
    if (!recording.id || !recording.events || !Array.isArray(recording.events)) {
      throw new Error('Invalid recording format')
    }
    return recording
  }

  // ── Internal ───────────────────────────────────────────────────────

  private _currentPlaybackTime(): number {
    return (Date.now() - this.playbackStart) * this.playbackSpeed
  }

  private _scheduleNext(): void {
    if (!this.currentRecording || this.isPaused) return
    if (this.playbackIndex >= this.currentRecording.events.length) {
      // Playback complete
      this.state = 'idle'
      if (this.onCompleteCallback) this.onCompleteCallback()
      return
    }

    const event = this.currentRecording.events[this.playbackIndex]
    const currentTime = this._currentPlaybackTime()
    const delay = Math.max(0, (event.offset - currentTime) / this.playbackSpeed)

    this.playbackTimer = setTimeout(() => {
      if (this.state !== 'playing' || !this.currentRecording) return

      // Emit the event
      if (this.onEventCallback) {
        this.onEventCallback(event.payload)
      }

      // Update progress
      if (this.onProgressCallback && this.currentRecording.duration > 0) {
        this.onProgressCallback(event.offset / this.currentRecording.duration)
      }

      this.playbackIndex++
      this._scheduleNext()
    }, delay)
  }

  private _loadAllRecordings(): ReplayRecording[] {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  }
}

export default ReplayEngine
