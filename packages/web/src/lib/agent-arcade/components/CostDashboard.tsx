'use client'

/**
 * Cost Dashboard -- real-time cost tracking per agent and session.
 * Shows cost breakdown by model, budget progress, and historical chart.
 */

import React, { useMemo } from 'react'

// ---------------------------------------------------------------------------
// Types (shared with gateway cost module)
// ---------------------------------------------------------------------------

export interface AgentCost {
  agentId: string
  agentName: string
  model: string
  inputTokens: number
  outputTokens: number
  totalCost: number
}

export interface SessionCost {
  sessionId: string
  totalCost: number
  agentCosts: AgentCost[]
  modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cost: number }>
  budgetLimit?: number
  budgetUsed: number // 0..1
}

interface CostDashboardProps {
  sessionCost: SessionCost
  budgetLimit?: number
  onClose?: () => void
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${(cost * 100).toFixed(2)}c`
  return `$${cost.toFixed(4)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

// ---------------------------------------------------------------------------
// Model Colors
// ---------------------------------------------------------------------------

const MODEL_COLORS: Record<string, string> = {
  'claude': '#D97706',
  'gpt': '#10B981',
  'gemini': '#3B82F6',
  'mistral': '#F97316',
  'deepseek': '#8B5CF6',
  'llama': '#06B6D4',
  'qwen': '#EC4899',
  'o3': '#14B8A6',
  'o4': '#14B8A6',
}

function getModelColor(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#6B7280'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostDashboard({ sessionCost, budgetLimit, onClose }: CostDashboardProps) {
  const sortedAgents = useMemo(() => {
    return [...sessionCost.agentCosts].sort((a, b) => b.totalCost - a.totalCost)
  }, [sessionCost.agentCosts])

  const modelEntries = useMemo(() => {
    return Object.entries(sessionCost.modelBreakdown).sort((a, b) => b[1].cost - a[1].cost)
  }, [sessionCost.modelBreakdown])

  const budget = budgetLimit || sessionCost.budgetLimit || 10
  const budgetPct = Math.min(1, sessionCost.totalCost / budget)
  const isOverBudget = budgetPct >= 1
  const isWarning = budgetPct >= 0.8

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)',
        borderRadius: 12,
        padding: 20,
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        color: '#fff',
        maxHeight: '80vh',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, margin: 0, color: '#ffd700' }}>Cost Dashboard</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 4,
              color: '#888', cursor: 'pointer', padding: '4px 8px', fontSize: 10,
            }}
          >
            X
          </button>
        )}
      </div>

      {/* Total Cost */}
      <div
        style={{
          background: '#111',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          border: `2px solid ${isOverBudget ? '#ef4444' : isWarning ? '#f59e0b' : '#222'}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 8, color: '#888' }}>Session Total</span>
          <span style={{
            fontSize: 20,
            color: isOverBudget ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e',
            textShadow: isOverBudget ? '0 0 10px #ef4444' : 'none',
          }}>
            ${sessionCost.totalCost.toFixed(4)}
          </span>
        </div>

        {/* Budget bar */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: '#666', marginBottom: 4 }}>
            <span>Budget: ${budget.toFixed(2)}</span>
            <span>{(budgetPct * 100).toFixed(1)}% used</span>
          </div>
          <div style={{ background: '#0a0a0a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div
              style={{
                background: isOverBudget
                  ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                  : isWarning
                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                    : 'linear-gradient(90deg, #22c55e, #16a34a)',
                height: '100%',
                width: `${Math.min(100, budgetPct * 100)}%`,
                borderRadius: 4,
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      </div>

      {/* Model Breakdown */}
      {modelEntries.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 9, color: '#888', marginBottom: 8 }}>Cost by Model</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {modelEntries.map(([model, data]) => (
              <div key={model} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: getModelColor(model),
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 8, color: '#ccc', flex: 1 }}>{model}</span>
                <span style={{ fontSize: 7, color: '#666' }}>
                  {formatTokens(data.inputTokens)}in / {formatTokens(data.outputTokens)}out
                </span>
                <span style={{ fontSize: 8, color: getModelColor(model), minWidth: 60, textAlign: 'right' }}>
                  {formatCost(data.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Agent Costs */}
      <div>
        <h3 style={{ fontSize: 9, color: '#888', marginBottom: 8 }}>Cost by Agent</h3>
        {sortedAgents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#444', fontSize: 8 }}>
            No cost data yet
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ fontSize: 7, color: '#555', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #222' }}>Agent</th>
                <th style={{ fontSize: 7, color: '#555', textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #222' }}>Model</th>
                <th style={{ fontSize: 7, color: '#555', textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #222' }}>Tokens</th>
                <th style={{ fontSize: 7, color: '#555', textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #222' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map(agent => (
                <tr key={agent.agentId}>
                  <td style={{ fontSize: 8, color: '#ccc', padding: '4px 8px', borderBottom: '1px solid #111' }}>
                    {agent.agentName}
                  </td>
                  <td style={{ fontSize: 7, color: getModelColor(agent.model), padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #111' }}>
                    {agent.model}
                  </td>
                  <td style={{ fontSize: 7, color: '#666', padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #111' }}>
                    {formatTokens(agent.inputTokens + agent.outputTokens)}
                  </td>
                  <td style={{ fontSize: 8, color: '#ffd700', padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #111' }}>
                    {formatCost(agent.totalCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default CostDashboard
