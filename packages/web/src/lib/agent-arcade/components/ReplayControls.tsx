'use client'

/**
 * Replay Controls -- playback controls for session replays.
 * Play/Pause/Stop, scrubber, speed selector, and recording indicator.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { ReplayState } from '../replay'
import type { ReplayEngine } from '../replay'

interface ReplayControlsProps {
  engine: ReplayEngine
  onStateChange?: (state: ReplayState) => void
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function ReplayControls({ engine, onStateChange }: ReplayControlsProps) {
  const [state, setState] = useState<ReplayState>(engine.getState())
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(engine.getSpeed())
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const rafRef = useRef<number | null>(null)

  // Poll playback state
  useEffect(() => {
    const tick = () => {
      const s = engine.getState()
      setState(s)
      setProgress(engine.getProgress())
      setCurrentTime(engine.getCurrentTime())
      setDuration(engine.getDuration())
      setSpeed(engine.getSpeed())
      onStateChange?.(s)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [engine, onStateChange])

  const handlePlayPause = useCallback(() => {
    if (state === 'playing') {
      engine.pause()
    } else if (state === 'paused') {
      engine.resume()
    }
  }, [engine, state])

  const handleStop = useCallback(() => {
    engine.stop()
  }, [engine])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    engine.seek(pct * engine.getDuration())
  }, [engine])

  const handleSpeedChange = useCallback((newSpeed: number) => {
    engine.setSpeed(newSpeed)
    setSpeed(newSpeed)
  }, [engine])

  const isActive = state === 'playing' || state === 'paused'
  const isRecording = state === 'recording'

  const btnStyle: React.CSSProperties = {
    background: '#1a1a2e',
    border: '2px solid #333',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: 10,
    fontFamily: '"Press Start 2P", monospace',
  }

  return (
    <div
      style={{
        background: '#0d0d1a',
        border: '2px solid #222',
        borderRadius: 8,
        padding: 12,
        fontFamily: '"Press Start 2P", "Courier New", monospace',
      }}
    >
      {/* Recording indicator */}
      {isRecording && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            fontSize: 9,
            color: '#ef4444',
          }}
        >
          <span style={{ animation: 'recBlink 1s infinite', fontSize: 14 }}>{'\u2B24'}</span>
          REC
        </div>
      )}

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          style={{ ...btnStyle, opacity: isActive ? 1 : 0.5 }}
          disabled={!isActive}
        >
          {state === 'playing' ? '\u23F8' : '\u25B6'}
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          style={{ ...btnStyle, opacity: isActive ? 1 : 0.5 }}
          disabled={!isActive}
        >
          {'\u23F9'}
        </button>

        {/* Time display */}
        <span style={{ fontSize: 8, color: '#888', minWidth: 100, textAlign: 'center' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Speed selector */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              style={{
                ...btnStyle,
                padding: '3px 6px',
                fontSize: 7,
                background: speed === s ? '#2a2a4a' : '#0d0d1a',
                borderColor: speed === s ? '#4a4a8a' : '#222',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Scrubber */}
      <div
        onClick={handleSeek}
        style={{
          background: '#111',
          borderRadius: 4,
          height: 8,
          cursor: isActive ? 'pointer' : 'default',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: state === 'recording'
              ? 'linear-gradient(90deg, #ef4444, #ff6b6b)'
              : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
            height: '100%',
            width: `${progress * 100}%`,
            borderRadius: 4,
            transition: state === 'playing' ? 'none' : 'width 0.1s',
          }}
        />
      </div>

      <style>{`
        @keyframes recBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

export default ReplayControls
