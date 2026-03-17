'use client'

/**
 * SessionReplay — AgentOps-grade session replay with timeline scrubber,
 * agent swimlanes, and event inspector.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { ReplayEngine } from '../replay'
import type { ReplayRecording } from '../replay'
import type { AgentState, TelemetryEvent } from '../types'
import { STATE_VISUALS, isValidState } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const EVENT_MARKERS: Record<string, { color: string; icon: string }> = {
  'agent.spawn':   { color: '#4ade80', icon: '🚀' },
  'agent.state':   { color: '#a78bfa', icon: '🔄' },
  'agent.tool':    { color: '#fbbf24', icon: '🔧' },
  'agent.message': { color: '#60a5fa', icon: '💬' },
  'agent.end':     { color: '#f472b6', icon: '🏁' },
  'agent.span':    { color: '#2dd4bf', icon: '📊' },
  'agent.link':    { color: '#fb923c', icon: '🔗' },
}

// ── State Reconstruction ─────────────────────────────────────────────────────

function reconstructStateAtTime(events: TelemetryEvent[], upTo: number): Map<string, { name: string; state: AgentState; label: string; tools: number; cost: number }> {
  const agents = new Map<string, { name: string; state: AgentState; label: string; tools: number; cost: number }>()
  for (const ev of events) {
    if (ev.ts > upTo) break
    const p = ev.payload as Record<string, unknown>
    switch (ev.type) {
      case 'agent.spawn':
        agents.set(ev.agentId, {
          name: typeof p.name === 'string' ? p.name : ev.agentId.slice(0, 8),
          state: 'idle', label: 'Starting…', tools: 0, cost: 0,
        })
        break
      case 'agent.state': {
        const a = agents.get(ev.agentId)
        if (a) {
          const s = String(p.state)
          a.state = isValidState(s) ? s : a.state
          a.label = typeof p.label === 'string' ? p.label : a.label
          if (typeof p.cost === 'number') a.cost += p.cost
        }
        break
      }
      case 'agent.tool': {
        const a = agents.get(ev.agentId)
        if (a) { a.state = 'tool'; a.tools++; a.label = typeof p.name === 'string' ? p.name : 'tool' }
        break
      }
      case 'agent.end': {
        const a = agents.get(ev.agentId)
        if (a) { a.state = 'done'; a.label = String(p.reason || 'Done') }
        break
      }
    }
  }
  return agents
}

/** Check if a full recording's events contain an agent error state. */
function recordingHasErrors(recording: ReplayRecording): boolean {
  for (const replayEv of recording.events) {
    const telEv = replayEv.payload
    if (telEv.type === 'agent.state' && telEv.payload['state'] === 'error') {
      return true
    }
  }
  return false
}

// ── Timeline Bar ─────────────────────────────────────────────────────────────

interface TimelineProps {
  events: TelemetryEvent[]
  duration: number
  startTs: number
  currentTime: number
  onSeek: (ts: number) => void
}

function Timeline({ events, duration, startTs, currentTime, onSeek }: TimelineProps) {
  const barRef = useRef<HTMLDivElement>(null)

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || duration <= 0) return
    const rect = barRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(startTs + pct * duration)
  }, [duration, startTs, onSeek])

  const progress = duration > 0 ? Math.min(1, (currentTime - startTs) / duration) : 0

  return (
    <div style={{ padding: '8px 16px' }}>
      <div
        ref={barRef}
        onClick={handleClick}
        style={{
          position: 'relative', height: 28, background: '#111', borderRadius: 4,
          cursor: 'crosshair', overflow: 'hidden', border: '1px solid #222',
        }}
      >
        {/* Progress fill */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(167,139,250,0.15)', transition: 'width 0.1s' }} />

        {/* Event markers */}
        {events.map((ev, i) => {
          const pct = duration > 0 ? ((ev.ts - startTs) / duration) * 100 : 0
          const marker = EVENT_MARKERS[ev.type]
          if (!marker) return null
          return (
            <div
              key={`${ev.type}-${ev.ts}-${i}`}
              title={`${ev.type} @ ${formatTime(ev.ts - startTs)}`}
              style={{
                position: 'absolute', left: `${pct}%`, top: 2, bottom: 2,
                width: 3, borderRadius: 1,
                background: marker.color,
                opacity: 0.7,
                transform: 'translateX(-1px)',
              }}
            />
          )
        })}

        {/* Playhead */}
        <div style={{
          position: 'absolute', left: `${progress * 100}%`, top: 0, bottom: 0,
          width: 2, background: '#fff', transform: 'translateX(-1px)',
          boxShadow: '0 0 6px rgba(255,255,255,0.5)',
        }} />
      </div>

      {/* Time labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: '#555', marginTop: 2 }}>
        <span>{formatTime(0)}</span>
        <span style={{ color: '#a78bfa' }}>{formatTime(currentTime - startTs)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

// ── Agent Swimlanes ──────────────────────────────────────────────────────────

interface SwimlanesProps {
  events: TelemetryEvent[]
  duration: number
  startTs: number
  currentTime: number
  onSeek: (ts: number) => void
}

function Swimlanes({ events, duration, startTs, currentTime, onSeek }: SwimlanesProps) {
  // Build per-agent state segments
  const lanes = useMemo(() => {
    const agentEvents = new Map<string, Array<{ ts: number; state: AgentState; name: string }>>()
    for (const ev of events) {
      const p = ev.payload as Record<string, unknown>
      if (ev.type === 'agent.spawn') {
        const name = typeof p.name === 'string' ? p.name : ev.agentId.slice(0, 8)
        if (!agentEvents.has(ev.agentId)) agentEvents.set(ev.agentId, [])
        agentEvents.get(ev.agentId)!.push({ ts: ev.ts, state: 'idle', name })
      }
      if (ev.type === 'agent.state') {
        const s = String(p.state)
        if (!agentEvents.has(ev.agentId)) agentEvents.set(ev.agentId, [])
        const entries = agentEvents.get(ev.agentId)!
        const name = entries.length > 0 ? entries[0].name : ev.agentId.slice(0, 8)
        if (isValidState(s)) entries.push({ ts: ev.ts, state: s, name })
      }
      if (ev.type === 'agent.tool') {
        if (!agentEvents.has(ev.agentId)) agentEvents.set(ev.agentId, [])
        const entries = agentEvents.get(ev.agentId)!
        const name = entries.length > 0 ? entries[0].name : ev.agentId.slice(0, 8)
        entries.push({ ts: ev.ts, state: 'tool', name })
      }
      if (ev.type === 'agent.end') {
        if (!agentEvents.has(ev.agentId)) agentEvents.set(ev.agentId, [])
        const entries = agentEvents.get(ev.agentId)!
        const name = entries.length > 0 ? entries[0].name : ev.agentId.slice(0, 8)
        entries.push({ ts: ev.ts, state: 'done', name })
      }
    }
    return agentEvents
  }, [events])

  const endTs = startTs + duration

  return (
    <div style={{ padding: '0 16px 8px' }}>
      {Array.from(lanes.entries()).map(([agentId, entries]) => {
        const name = entries[0]?.name || agentId.slice(0, 8)
        // Build colored segments
        const segments: Array<{ left: number; width: number; color: string; state: string }> = []
        for (let i = 0; i < entries.length; i++) {
          const start = entries[i].ts
          const end = entries[i + 1]?.ts || endTs
          const pctLeft = duration > 0 ? ((start - startTs) / duration) * 100 : 0
          const pctWidth = duration > 0 ? ((end - start) / duration) * 100 : 0
          segments.push({
            left: pctLeft, width: Math.max(0.5, pctWidth),
            color: STATE_VISUALS[entries[i].state]?.color || '#333',
            state: entries[i].state,
          })
        }

        return (
          <div key={agentId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 7, color: '#888', width: 80, flexShrink: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <div
              style={{ flex: 1, height: 10, background: '#111', borderRadius: 2, position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const pct = (e.clientX - rect.left) / rect.width
                onSeek(startTs + pct * duration)
              }}
            >
              {segments.map((seg, i) => (
                <div
                  key={`${seg.state}-${seg.left}-${i}`}
                  title={seg.state}
                  style={{
                    position: 'absolute', left: `${seg.left}%`, width: `${seg.width}%`,
                    top: 0, bottom: 0, background: seg.color, opacity: 0.8,
                  }}
                />
              ))}
              {/* Playhead */}
              {duration > 0 && (
                <div style={{
                  position: 'absolute', left: `${((currentTime - startTs) / duration) * 100}%`,
                  top: 0, bottom: 0, width: 1, background: '#fff',
                }} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Event Inspector ──────────────────────────────────────────────────────────

function EventInspector({ events, currentTime }: { events: TelemetryEvent[]; currentTime: number }) {
  const nearbyEvents = useMemo(() => {
    // Show events within 2 seconds of current time
    return events.filter(ev => Math.abs(ev.ts - currentTime) < 2000).slice(-5)
  }, [events, currentTime])

  if (nearbyEvents.length === 0) return null

  return (
    <div style={{ padding: '4px 16px 8px', borderTop: '1px solid #1a1a2e' }}>
      <span style={{ fontSize: 7, color: '#666' }}>Events at cursor:</span>
      <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
        {nearbyEvents.map((ev, i) => {
          const marker = EVENT_MARKERS[ev.type]
          const p = ev.payload as Record<string, unknown>
          return (
            <div key={`${ev.type}-${ev.ts}-${i}`} style={{ display: 'flex', gap: 6, fontSize: 8, color: '#aaa', padding: '2px 4px', background: '#0a0a1a', borderRadius: 3 }}>
              <span>{marker?.icon || '📡'}</span>
              <span style={{ color: marker?.color || '#888' }}>{ev.type.replace('agent.', '')}</span>
              <span style={{ color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {String(p.name || p.state || p.text || p.reason || '')}
              </span>
              <span style={{ color: '#444' }}>{ev.agentId.slice(0, 8)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main SessionReplay ───────────────────────────────────────────────────────

interface SessionReplayProps {
  engine: ReplayEngine
  events: TelemetryEvent[]
  sessionId: string
  /** Called for each replayed event so callers can feed it back into the store.
   *  Pass a no-op if you only want to view the recording without re-driving state. */
  processEvent: (event: TelemetryEvent) => void
}

export function SessionReplay({ engine, events, sessionId, processEvent }: SessionReplayProps) {
  const [replayState, setReplayState] = useState(engine.getState())
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [recordings, setRecordings] = useState<ReturnType<ReplayEngine['listRecordings']>>([])
  const [selectedRecording, setSelectedRecording] = useState<ReplayRecording | null>(null)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [showErrorsOnly, setShowErrorsOnly] = useState(false)
  const [showAllRecordings, setShowAllRecordings] = useState(false)
  const updateRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  // Load recordings list
  useEffect(() => {
    setRecordings(engine.listRecordings())
  }, [engine])

  // Tick for live time tracking
  useEffect(() => {
    updateRef.current = setInterval(() => {
      setReplayState(engine.getState())
      setProgress(engine.getProgress())
      if (engine.getState() === 'playing') {
        setCurrentTime(engine.getCurrentTime())
      } else {
        setCurrentTime(Date.now())
      }
    }, 100)
    return () => { if (updateRef.current) clearInterval(updateRef.current) }
  }, [engine])

  // Build a set of recording IDs that have errors by loading each full recording
  const errorRecordingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const rec of recordings) {
      const full = engine.loadRecording(rec.id)
      if (full && recordingHasErrors(full)) {
        ids.add(rec.id)
      }
    }
    return ids
  }, [recordings, engine])

  const handleRecord = useCallback(() => {
    if (engine.isRecording()) {
      const rec = engine.stopRecording('Session replay')
      engine.saveRecording(rec)
      setRecordings(engine.listRecordings())
      setReplayState('idle')
    } else {
      engine.startRecording(sessionId)
      setReplayState('recording')
    }
  }, [engine, sessionId])

  const handlePlay = useCallback((recId: string) => {
    const rec = engine.loadRecording(recId)
    if (!rec) return
    setSelectedRecording(rec)
    engine.play(rec, {
      speed,
      onEvent: processEvent,
      onProgress: setProgress,
      onComplete: () => setReplayState('idle'),
    })
    setReplayState('playing')
  }, [engine, speed, processEvent])

  const handlePauseResume = useCallback(() => {
    if (engine.getState() === 'playing') { engine.pause(); setReplayState('paused') }
    else if (engine.getState() === 'paused') { engine.resume(); setReplayState('playing') }
  }, [engine])

  const handleStop = useCallback(() => {
    engine.stop()
    setReplayState('idle')
    setSelectedRecording(null)
  }, [engine])

  const handleSeek = useCallback((ts: number) => {
    if (selectedRecording) {
      const offset = Math.max(0, ts - (selectedRecording.startedAt))
      engine.seek(offset)
    }
  }, [engine, selectedRecording])

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setSpeed(newSpeed)
    engine.setSpeed(newSpeed)
  }, [engine])

  const handleDelete = useCallback((recId: string) => {
    engine.deleteRecording(recId)
    setRecordings(engine.listRecordings())
  }, [engine])

  // Determine timeline data
  const timelineEvents = selectedRecording
    ? selectedRecording.events.map(e => e.payload)
    : events
  const startTs = selectedRecording?.startedAt || (events.length > 0 ? events[0].ts : currentTime)
  const duration = selectedRecording?.duration || (events.length > 1 ? events[events.length - 1].ts - events[0].ts : 0)

  // Filter recordings based on "has errors" toggle
  const displayedRecordings = useMemo(() => {
    if (!showErrorsOnly) return recordings
    return recordings.filter(rec => errorRecordingIds.has(rec.id))
  }, [recordings, showErrorsOnly, errorRecordingIds])

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)',
      borderRadius: 12, fontFamily: '"Press Start 2P", "Courier New", monospace',
      color: '#fff', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #222' }}>
        <h2 style={{ fontSize: 11, margin: 0, color: '#f472b6' }}>⏪ Session Replay</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Speed selector */}
          <select
            value={speed}
            onChange={e => handleSpeedChange(Number(e.target.value))}
            style={{ background: '#111', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 7, padding: '2px 4px' }}
          >
            {[0.25, 0.5, 1, 2, 4, 8].map(s => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>

          {/* Record button */}
          <button
            onClick={handleRecord}
            style={{
              background: engine.isRecording() ? '#ef4444' : '#222',
              border: '1px solid #333', borderRadius: 4, color: engine.isRecording() ? '#fff' : '#888',
              cursor: 'pointer', padding: '3px 8px', fontSize: 8,
            }}
          >
            {engine.isRecording() ? '⏹ Stop Rec' : '⏺ Record'}
          </button>
        </div>
      </div>

      {/* Playback controls */}
      {(replayState === 'playing' || replayState === 'paused' || selectedRecording) && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderBottom: '1px solid #1a1a2e', alignItems: 'center' }}>
          <button onClick={handlePauseResume} style={{ background: '#222', border: '1px solid #333', borderRadius: 4, color: '#ccc', cursor: 'pointer', padding: '3px 8px', fontSize: 8 }}>
            {replayState === 'playing' ? '⏸' : '▶'}
          </button>
          <button onClick={handleStop} style={{ background: '#222', border: '1px solid #333', borderRadius: 4, color: '#ccc', cursor: 'pointer', padding: '3px 8px', fontSize: 8 }}>
            ⏹
          </button>
          <div style={{ flex: 1, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#f472b6', width: `${progress * 100}%`, transition: 'width 0.1s' }} />
          </div>
          <span style={{ fontSize: 7, color: '#888' }}>{Math.round(progress * 100)}%</span>
        </div>
      )}

      {/* Timeline */}
      {timelineEvents.length > 0 && (
        <Timeline
          events={timelineEvents}
          duration={duration}
          startTs={startTs}
          currentTime={selectedRecording ? startTs + engine.getCurrentTime() : (events.length > 0 ? events[events.length - 1].ts : currentTime)}
          onSeek={handleSeek}
        />
      )}

      {/* Agent Swimlanes */}
      {timelineEvents.length > 0 && (
        <Swimlanes
          events={timelineEvents}
          duration={duration}
          startTs={startTs}
          currentTime={selectedRecording ? startTs + engine.getCurrentTime() : (events.length > 0 ? events[events.length - 1].ts : currentTime)}
          onSeek={handleSeek}
        />
      )}

      {/* Event Inspector */}
      <EventInspector
        events={timelineEvents}
        currentTime={selectedRecording ? startTs + engine.getCurrentTime() : (events.length > 0 ? events[events.length - 1].ts : currentTime)}
      />

      {/* Agent state snapshot */}
      {timelineEvents.length > 0 && (
        <div style={{ padding: '4px 16px 8px', borderTop: '1px solid #1a1a2e' }}>
          <span style={{ fontSize: 7, color: '#666' }}>Agent state at cursor:</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {(() => {
              const snapshot = reconstructStateAtTime(
                timelineEvents,
                selectedRecording ? startTs + engine.getCurrentTime() : currentTime
              )
              return Array.from(snapshot.entries()).map(([id, s]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#111', borderRadius: 4, padding: '3px 6px', fontSize: 7 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATE_VISUALS[s.state]?.color || '#555' }} />
                  <span style={{ color: '#ccc' }}>{s.name}</span>
                  <span style={{ color: '#666' }}>{s.state}</span>
                  {s.tools > 0 && <span style={{ color: '#888' }}>🔧{s.tools}</span>}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Saved recordings */}
      <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 8, color: '#888' }}>Saved Recordings ({recordings.length})</span>
          <button
            onClick={() => setShowErrorsOnly(v => !v)}
            style={{
              background: showErrorsOnly ? '#2a0a0a' : '#222',
              border: `1px solid ${showErrorsOnly ? '#ef4444' : '#333'}`,
              borderRadius: 4,
              color: showErrorsOnly ? '#ef4444' : '#888',
              cursor: 'pointer', padding: '2px 8px', fontSize: 7,
            }}
          >
            Has errors
          </button>
        </div>
        {displayedRecordings.length === 0 ? (
          <div style={{ fontSize: 8, color: '#444', padding: '8px 0' }}>
            {showErrorsOnly
              ? 'No recordings with errors found.'
              : 'No recordings yet. Click \u201cRecord\u201d to capture a session.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {(showAllRecordings ? displayedRecordings : displayedRecordings.slice(0, 10)).map(rec => {
              const name = rec.sessionName || (rec.sessionId.length > 12 ? rec.sessionId.slice(0, 12) + '…' : rec.sessionId)
              return (
                <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', borderRadius: 4, padding: '4px 8px', fontSize: 7 }}>
                  <button onClick={() => handlePlay(rec.id)} style={{ background: '#222', border: '1px solid #333', borderRadius: 3, color: '#4ade80', cursor: 'pointer', padding: '2px 6px', fontSize: 7 }}>
                    ▶
                  </button>
                  <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                    {errorRecordingIds.has(rec.id) && (
                      <span
                        title="This recording contains agent errors"
                        style={{ marginLeft: 5, color: '#ef4444', fontSize: 8 }}
                      >
                        ⚠
                      </span>
                    )}
                  </span>
                  <span style={{ color: '#666', flexShrink: 0 }}>{rec.eventCount}ev</span>
                  <span style={{ color: '#666', flexShrink: 0 }}>{rec.agentCount}ag</span>
                  <span style={{ color: '#555', flexShrink: 0 }}>{formatTime(rec.duration)}</span>
                  <button onClick={() => handleDelete(rec.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 7, flexShrink: 0 }}>✕</button>
                </div>
              )
            })}
            {displayedRecordings.length > 10 && (
              <button
                onClick={() => setShowAllRecordings(v => !v)}
                style={{ background: 'none', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontSize: 7, padding: '3px 0', textAlign: 'center' }}
              >
                {showAllRecordings ? 'Show less' : `Show all ${displayedRecordings.length} recordings`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SessionReplay
