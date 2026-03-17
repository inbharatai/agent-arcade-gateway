'use client'

/**
 * TracePanel — LangSmith-grade span tree viewer with token-level detail.
 * Shows hierarchical execution traces, tool I/O, LLM latency, and costs.
 */

import React, { useState, useMemo } from 'react'
import type { SpanRecord, SpanTree, Agent } from '../types'
import { buildSpanTree } from '../types'

// ── Constants ────────────────────────────────────────────────────────────────

const KIND_ICONS: Record<string, string> = {
  llm: '🧠', tool: '🔧', chain: '🔗', retriever: '📚', custom: '⚙️',
}

const STATUS_COLORS: Record<string, string> = {
  started: '#f59e0b', ok: '#22c55e', error: '#ef4444',
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTokens(n?: number): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(c?: number): string {
  if (c == null) return ''
  if (c < 0.01) return `$${(c * 100).toFixed(2)}¢`
  return `$${c.toFixed(4)}`
}

function truncate(s: unknown, max = 200): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s, null, 2)
  if (!str) return '—'
  return str.length > max ? str.slice(0, max) + '…' : str
}

/** Check if a span matches a search string (case-insensitive). */
function spanMatchesSearch(s: SpanRecord, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  if (s.name.toLowerCase().includes(q)) return true
  if (s.error && s.error.toLowerCase().includes(q)) return true
  try {
    if (JSON.stringify(s.input).toLowerCase().includes(q)) return true
  } catch { /* ignore */ }
  try {
    if (JSON.stringify(s.output).toLowerCase().includes(q)) return true
  } catch { /* ignore */ }
  return false
}

/** Collect all SpanRecord leaves from a SpanTree recursively. */
function collectSpans(node: SpanTree): SpanRecord[] {
  return [node.span, ...node.children.flatMap(collectSpans)]
}

/** Return true if this node or any descendant matches the search. */
function treeMatchesSearch(node: SpanTree, search: string): boolean {
  if (spanMatchesSearch(node.span, search)) return true
  return node.children.some(child => treeMatchesSearch(child, search))
}

// ── SpanRow ──────────────────────────────────────────────────────────────────

interface SpanRowProps {
  node: SpanTree
  depth: number
  search: string
  compareMode: boolean
  compareSpans: string[]
  onToggleCompare: (spanId: string) => void
}

function SpanRow({ node, depth, search, compareMode, compareSpans, onToggleCompare }: SpanRowProps) {
  const [expanded, setExpanded] = useState(node.span.status === 'error')
  const [showIO, setShowIO] = useState(false)
  const s = node.span
  const hasChildren = node.children.length > 0
  const hasIO = s.input != null || s.output != null || s.error

  const isError = s.status === 'error'
  const isSelectedForCompare = compareSpans.includes(s.spanId)

  const rowBackground = isError
    ? (expanded ? '#1a0a0a' : '#1a0a0a')
    : (expanded ? 'rgba(255,255,255,0.02)' : 'transparent')

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingLeft: depth * 20 + 8, paddingRight: 8,
          paddingTop: 4, paddingBottom: 4,
          borderBottom: '1px solid #1a1a2e',
          borderLeft: isError ? '3px solid #ef4444' : '3px solid transparent',
          cursor: hasChildren || hasIO ? 'pointer' : 'default',
          background: isSelectedForCompare ? 'rgba(167,139,250,0.15)' : rowBackground,
          outline: isSelectedForCompare ? '1px solid #a78bfa' : 'none',
        }}
        onClick={() => hasChildren || hasIO ? setExpanded(e => !e) : null}
      >
        {/* Expand indicator */}
        <span style={{ width: 12, fontSize: 8, color: '#555', flexShrink: 0 }}>
          {(hasChildren || hasIO) ? (expanded ? '▼' : '▶') : '·'}
        </span>

        {/* Kind icon */}
        <span style={{ fontSize: 12, flexShrink: 0 }}>{KIND_ICONS[s.kind] || '⚙️'}</span>

        {/* Name */}
        <span style={{ fontSize: 9, color: isError ? '#f87171' : '#ddd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.name}
          {s.model && <span style={{ color: '#888', marginLeft: 6 }}>({s.model})</span>}
        </span>

        {/* Error text inline */}
        {isError && s.error && (
          <span style={{ fontSize: 7, color: '#ef4444', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.error}
          </span>
        )}

        {/* Duration */}
        <span style={{ fontSize: 8, color: '#888', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>
          {formatDuration(s.durationMs)}
        </span>

        {/* Token counts (LLM only) */}
        {s.kind === 'llm' && (s.promptTokens || s.completionTokens) && (
          <span style={{ fontSize: 7, color: '#666', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
            {formatTokens(s.promptTokens)}→{formatTokens(s.completionTokens)}
          </span>
        )}

        {/* Cost */}
        {s.cost != null && (
          <span style={{ fontSize: 8, color: '#ffd700', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>
            {formatCost(s.cost)}
          </span>
        )}

        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: STATUS_COLORS[s.status] || '#666',
          boxShadow: s.status === 'error' ? '0 0 6px #ef4444' : 'none',
        }} />

        {/* Compare toggle */}
        {compareMode && (
          <button
            onClick={e => { e.stopPropagation(); onToggleCompare(s.spanId) }}
            style={{
              background: isSelectedForCompare ? '#a78bfa' : '#222',
              border: '1px solid #555', borderRadius: 3,
              color: isSelectedForCompare ? '#fff' : '#888',
              cursor: 'pointer', padding: '1px 5px', fontSize: 7, flexShrink: 0,
            }}
          >
            {isSelectedForCompare ? '✓' : '+'}
          </button>
        )}
      </div>

      {/* Expanded: I/O detail */}
      {expanded && hasIO && (
        <div style={{ paddingLeft: depth * 20 + 32, paddingRight: 8, paddingBottom: 6, fontSize: 8, background: isError ? '#120808' : 'transparent' }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowIO(v => !v) }}
            style={{ background: 'none', border: '1px solid #333', borderRadius: 3, color: '#888', cursor: 'pointer', padding: '2px 6px', fontSize: 7, marginBottom: 4 }}
          >
            {showIO ? 'Hide I/O' : 'Show I/O'}
          </button>
          {showIO && (
            <div style={{ display: 'grid', gap: 4 }}>
              {s.input != null && (
                <div>
                  <span style={{ color: '#60a5fa', fontSize: 7 }}>INPUT</span>
                  <pre style={{ margin: 0, color: '#aaa', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0a0a1a', borderRadius: 4, padding: 6, maxHeight: 120, overflow: 'auto' }}>
                    {truncate(s.input, 500)}
                  </pre>
                </div>
              )}
              {s.output != null && (
                <div>
                  <span style={{ color: '#22c55e', fontSize: 7 }}>OUTPUT</span>
                  <pre style={{ margin: 0, color: '#aaa', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0a0a1a', borderRadius: 4, padding: 6, maxHeight: 120, overflow: 'auto' }}>
                    {truncate(s.output, 500)}
                  </pre>
                </div>
              )}
              {s.error && (
                <div>
                  <span style={{ color: '#ef4444', fontSize: 7 }}>ERROR</span>
                  <pre style={{ margin: 0, color: '#f87171', whiteSpace: 'pre-wrap', background: '#1a0505', borderRadius: 4, padding: 6 }}>
                    {s.error}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Token stream visualization for LLM spans */}
          {s.tokens && s.tokens.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span style={{ color: '#a78bfa', fontSize: 7 }}>TOKEN STREAM ({s.tokens.length} tokens)</span>
              <div style={{ background: '#0a0a1a', borderRadius: 4, padding: 6, maxHeight: 80, overflow: 'auto', fontSize: 8, color: '#ccc', lineHeight: 1.5 }}>
                {s.tokens.map((t, i) => (
                  <span key={i} title={`+${t.ts}ms`} style={{ borderBottom: '1px dotted #333' }}>
                    {t.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {expanded && hasChildren && node.children.map(child => (
        treeMatchesSearch(child, search) && (
          <SpanRow
            key={child.span.spanId}
            node={child}
            depth={depth + 1}
            search={search}
            compareMode={compareMode}
            compareSpans={compareSpans}
            onToggleCompare={onToggleCompare}
          />
        )
      ))}
    </>
  )
}

// ── ComparePanel ─────────────────────────────────────────────────────────────

function ComparePanel({ spanIds, allSpans }: { spanIds: string[]; allSpans: SpanRecord[] }) {
  const selected = spanIds.map(id => allSpans.find(s => s.spanId === id)).filter((s): s is SpanRecord => s != null)

  if (selected.length === 0) {
    return (
      <div style={{ padding: '12px 16px', fontSize: 8, color: '#555', borderTop: '1px solid #222' }}>
        Select up to 2 spans using the + button to compare them.
      </div>
    )
  }

  return (
    <div style={{ borderTop: '1px solid #a78bfa', padding: '12px 16px' }}>
      <span style={{ fontSize: 8, color: '#a78bfa' }}>Compare ({selected.length}/2)</span>
      <div style={{ display: 'grid', gridTemplateColumns: selected.length === 2 ? '1fr 1fr' : '1fr', gap: 12, marginTop: 8 }}>
        {selected.map(s => (
          <div key={s.spanId} style={{ background: '#0a0a1a', borderRadius: 6, padding: 10, border: '1px solid #333' }}>
            <div style={{ fontSize: 8, color: '#a78bfa', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {KIND_ICONS[s.kind] || '⚙️'} {s.name}
            </div>
            <div style={{ fontSize: 7, color: '#666', marginBottom: 6 }}>
              {formatDuration(s.durationMs)} · {s.model || s.kind} · {s.status}
              {s.cost != null && ` · ${formatCost(s.cost)}`}
            </div>
            {s.input != null && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 6, color: '#60a5fa' }}>INPUT</span>
                <pre style={{ margin: '2px 0 0', fontSize: 7, color: '#aaa', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111', borderRadius: 3, padding: 6, maxHeight: 100, overflow: 'auto' }}>
                  {truncate(s.input, 300)}
                </pre>
              </div>
            )}
            {s.output != null && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 6, color: '#22c55e' }}>OUTPUT</span>
                <pre style={{ margin: '2px 0 0', fontSize: 7, color: '#aaa', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111', borderRadius: 3, padding: 6, maxHeight: 100, overflow: 'auto' }}>
                  {truncate(s.output, 300)}
                </pre>
              </div>
            )}
            {s.error && (
              <div>
                <span style={{ fontSize: 6, color: '#ef4444' }}>ERROR</span>
                <pre style={{ margin: '2px 0 0', fontSize: 7, color: '#f87171', whiteSpace: 'pre-wrap', background: '#1a0505', borderRadius: 3, padding: 6 }}>
                  {s.error}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TracePanel ───────────────────────────────────────────────────────────────

interface TracePanelProps {
  agents: Agent[]
  selectedAgentId?: string | null
}

export function TracePanel({ agents, selectedAgentId }: TracePanelProps) {
  const [filterAgent, setFilterAgent] = useState<string>(selectedAgentId || 'all')
  const [search, setSearch] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [compareSpans, setCompareSpans] = useState<string[]>([])

  // Collect all spans
  const allSpans = useMemo(() => {
    if (filterAgent === 'all') {
      return agents.flatMap(a => a.spans || [])
    }
    const agent = agents.find(a => a.id === filterAgent)
    return agent?.spans || []
  }, [agents, filterAgent])

  const tree = useMemo(() => buildSpanTree(allSpans), [allSpans])

  // Summary stats
  const stats = useMemo(() => {
    let totalDuration = 0, totalCost = 0, totalPrompt = 0, totalCompletion = 0, errors = 0
    for (const s of allSpans) {
      if (s.durationMs) totalDuration += s.durationMs
      if (s.cost) totalCost += s.cost
      if (s.promptTokens) totalPrompt += s.promptTokens
      if (s.completionTokens) totalCompletion += s.completionTokens
      if (s.status === 'error') errors++
    }
    return { totalDuration, totalCost, totalPrompt, totalCompletion, errors, count: allSpans.length }
  }, [allSpans])

  const handleToggleCompare = (spanId: string) => {
    setCompareSpans(prev => {
      if (prev.includes(spanId)) return prev.filter(id => id !== spanId)
      if (prev.length >= 2) return [prev[1], spanId]
      return [...prev, spanId]
    })
  }

  const handleToggleCompareMode = () => {
    setCompareMode(m => {
      if (m) setCompareSpans([])
      return !m
    })
  }

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)',
      borderRadius: 12, fontFamily: '"Press Start 2P", "Courier New", monospace',
      color: '#fff', overflow: 'hidden',
    }}>
      {/* Header + filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #222' }}>
        <h2 style={{ fontSize: 11, margin: 0, color: '#a78bfa' }}>🔍 Execution Traces</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleToggleCompareMode}
            style={{
              background: compareMode ? '#a78bfa' : '#222',
              border: '1px solid #555', borderRadius: 4,
              color: compareMode ? '#fff' : '#888',
              cursor: 'pointer', padding: '3px 8px', fontSize: 7,
            }}
          >
            Compare
          </button>
          <select
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value)}
            style={{ background: '#111', border: '1px solid #333', borderRadius: 4, color: '#ccc', fontSize: 8, padding: '3px 6px' }}
          >
            <option value="all">All agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.spans?.length || 0})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a2e' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search spans..."
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#111', border: '1px solid #333', borderRadius: 4,
            color: '#ddd', fontSize: 8, padding: '5px 8px',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 16px', borderBottom: '1px solid #1a1a2e', fontSize: 8 }}>
        <span style={{ color: '#888' }}>Spans: <b style={{ color: '#ddd' }}>{stats.count}</b></span>
        <span style={{ color: '#888' }}>Duration: <b style={{ color: '#60a5fa' }}>{formatDuration(stats.totalDuration)}</b></span>
        <span style={{ color: '#888' }}>Tokens: <b style={{ color: '#ccc' }}>{formatTokens(stats.totalPrompt)}→{formatTokens(stats.totalCompletion)}</b></span>
        {stats.totalCost > 0 && (
          <span style={{ color: '#888' }}>Cost: <b style={{ color: '#ffd700' }}>{formatCost(stats.totalCost)}</b></span>
        )}
        {stats.errors > 0 && (
          <span style={{ color: '#ef4444' }}>⚠ {stats.errors} errors</span>
        )}
      </div>

      {/* Span tree */}
      <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
        {tree.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#444', fontSize: 9 }}>
            No traces yet. Traces appear when agents send <code style={{ color: '#666' }}>agent.span</code> or <code style={{ color: '#666' }}>agent.tool</code> events with span data.
          </div>
        ) : (
          tree.map(node =>
            treeMatchesSearch(node, search) && (
              <SpanRow
                key={node.span.spanId}
                node={node}
                depth={0}
                search={search}
                compareMode={compareMode}
                compareSpans={compareSpans}
                onToggleCompare={handleToggleCompare}
              />
            )
          )
        )}
      </div>

      {/* Compare panel */}
      {compareMode && (
        <ComparePanel spanIds={compareSpans} allSpans={allSpans} />
      )}
    </div>
  )
}

export default TracePanel
