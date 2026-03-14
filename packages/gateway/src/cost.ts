/**
 * Agent Arcade Cost Calculator
 *
 * Comprehensive pricing table for all major AI models.
 * Tracks per-agent and per-session costs in real-time.
 * Fuzzy model name matching for flexible input.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  name: string
  provider: string
  inputPer1M: number   // $ per 1M input tokens
  outputPer1M: number  // $ per 1M output tokens
  isLocal: boolean
}

export interface CostResult {
  inputCost: number
  outputCost: number
  totalCost: number
  model: string
  inputTokens: number
  outputTokens: number
}

export interface AgentCost {
  agentId: string
  model: string
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
}

export interface SessionCost {
  sessionId: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  agentCosts: AgentCost[]
  modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cost: number }>
}

export interface CostReport {
  sessionId: string
  generatedAt: number
  totalCost: number
  agentCount: number
  requestCount: number
  modelBreakdown: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>
  agentDetails: AgentCost[]
  budgetStatus?: { limit: number; used: number; remaining: number; percentage: number }
}

// ---------------------------------------------------------------------------
// Pricing Table (as of 2026-03-15)
// ---------------------------------------------------------------------------

const PRICING: ModelPricing[] = [
  // Anthropic
  { name: 'claude-sonnet-4', provider: 'anthropic', inputPer1M: 3, outputPer1M: 15, isLocal: false },
  { name: 'claude-opus-4', provider: 'anthropic', inputPer1M: 15, outputPer1M: 75, isLocal: false },
  { name: 'claude-haiku-3.5', provider: 'anthropic', inputPer1M: 0.80, outputPer1M: 4, isLocal: false },
  { name: 'claude-3.5-sonnet', provider: 'anthropic', inputPer1M: 3, outputPer1M: 15, isLocal: false },
  { name: 'claude-3-opus', provider: 'anthropic', inputPer1M: 15, outputPer1M: 75, isLocal: false },

  // OpenAI
  { name: 'gpt-4o', provider: 'openai', inputPer1M: 2.50, outputPer1M: 10, isLocal: false },
  { name: 'gpt-4o-mini', provider: 'openai', inputPer1M: 0.15, outputPer1M: 0.60, isLocal: false },
  { name: 'gpt-4.1', provider: 'openai', inputPer1M: 2, outputPer1M: 8, isLocal: false },
  { name: 'gpt-4.1-mini', provider: 'openai', inputPer1M: 0.40, outputPer1M: 1.60, isLocal: false },
  { name: 'gpt-4.1-nano', provider: 'openai', inputPer1M: 0.10, outputPer1M: 0.40, isLocal: false },
  { name: 'o3', provider: 'openai', inputPer1M: 10, outputPer1M: 40, isLocal: false },
  { name: 'o4-mini', provider: 'openai', inputPer1M: 1.10, outputPer1M: 4.40, isLocal: false },

  // Google
  { name: 'gemini-2.5-pro', provider: 'google', inputPer1M: 1.25, outputPer1M: 10, isLocal: false },
  { name: 'gemini-2.5-flash', provider: 'google', inputPer1M: 0.15, outputPer1M: 0.60, isLocal: false },
  { name: 'gemini-2.0-flash', provider: 'google', inputPer1M: 0.10, outputPer1M: 0.40, isLocal: false },
  { name: 'gemini-1.5-pro', provider: 'google', inputPer1M: 1.25, outputPer1M: 5, isLocal: false },
  { name: 'gemini-1.5-flash', provider: 'google', inputPer1M: 0.075, outputPer1M: 0.30, isLocal: false },

  // Mistral
  { name: 'mistral-large', provider: 'mistral', inputPer1M: 2, outputPer1M: 6, isLocal: false },
  { name: 'mistral-small', provider: 'mistral', inputPer1M: 0.10, outputPer1M: 0.30, isLocal: false },

  // DeepSeek
  { name: 'deepseek-v3', provider: 'deepseek', inputPer1M: 0.27, outputPer1M: 1.10, isLocal: false },
  { name: 'deepseek-r1', provider: 'deepseek', inputPer1M: 0.55, outputPer1M: 2.19, isLocal: false },

  // Local / Free
  { name: 'llama-3', provider: 'meta', inputPer1M: 0, outputPer1M: 0, isLocal: true },
  { name: 'llama-3.1', provider: 'meta', inputPer1M: 0, outputPer1M: 0, isLocal: true },
  { name: 'llama-3.2', provider: 'meta', inputPer1M: 0, outputPer1M: 0, isLocal: true },
  { name: 'qwen', provider: 'alibaba', inputPer1M: 0, outputPer1M: 0, isLocal: true },
  { name: 'phi-3', provider: 'microsoft', inputPer1M: 0, outputPer1M: 0, isLocal: true },
  { name: 'codellama', provider: 'meta', inputPer1M: 0, outputPer1M: 0, isLocal: true },
]

// ---------------------------------------------------------------------------
// Fuzzy Model Matching
// ---------------------------------------------------------------------------

function normalizeModelName(model: string): string {
  return model.toLowerCase()
    .replace(/[_\s]/g, '-')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '') // Remove date suffixes like -2024-08-06
    .replace(/-latest$/, '')
    .replace(/-preview$/, '')
}

function findPricing(model: string): ModelPricing | null {
  const normalized = normalizeModelName(model)

  // Exact match
  const exact = PRICING.find(p => normalizeModelName(p.name) === normalized)
  if (exact) return exact

  // Prefix match (e.g., "gpt-4o-2024-08-06" matches "gpt-4o")
  const prefix = PRICING.find(p => normalized.startsWith(normalizeModelName(p.name)))
  if (prefix) return prefix

  // Contains match (e.g., "claude-3-5-sonnet-20241022" matches "claude-3.5-sonnet")
  const fuzzy = PRICING.find(p => {
    const pNorm = normalizeModelName(p.name).replace(/\./g, '-')
    const mNorm = normalized.replace(/\./g, '-')
    return mNorm.includes(pNorm) || pNorm.includes(mNorm)
  })
  if (fuzzy) return fuzzy

  // Provider detection fallback
  if (normalized.includes('claude')) return PRICING.find(p => p.name === 'claude-sonnet-4') || null
  if (normalized.includes('gpt')) return PRICING.find(p => p.name === 'gpt-4o') || null
  if (normalized.includes('gemini')) return PRICING.find(p => p.name === 'gemini-2.5-flash') || null
  if (normalized.includes('llama') || normalized.includes('ollama')) return PRICING.find(p => p.name === 'llama-3') || null

  return null
}

// ---------------------------------------------------------------------------
// Cost Calculator
// ---------------------------------------------------------------------------

export class CostCalculator {
  private agentUsage = new Map<string, AgentCost>()
  private sessionAgents = new Map<string, Set<string>>() // sessionId -> Set<agentId>

  /** Calculate cost for a single request */
  calculateCost(model: string, inputTokens: number, outputTokens: number): CostResult {
    const pricing = findPricing(model)
    const inputCost = pricing ? (inputTokens / 1_000_000) * pricing.inputPer1M : 0
    const outputCost = pricing ? (outputTokens / 1_000_000) * pricing.outputPer1M : 0

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      model: pricing?.name || model,
      inputTokens,
      outputTokens,
    }
  }

  /** Track token usage for an agent */
  trackUsage(agentId: string, model: string, inputTokens: number, outputTokens: number, sessionId?: string): CostResult {
    const cost = this.calculateCost(model, inputTokens, outputTokens)

    let agent = this.agentUsage.get(agentId)
    if (!agent) {
      agent = { agentId, model: cost.model, inputTokens: 0, outputTokens: 0, totalCost: 0, requestCount: 0 }
      this.agentUsage.set(agentId, agent)
    }

    agent.inputTokens += inputTokens
    agent.outputTokens += outputTokens
    agent.totalCost += cost.totalCost
    agent.requestCount++

    // Track session membership
    if (sessionId) {
      if (!this.sessionAgents.has(sessionId)) {
        this.sessionAgents.set(sessionId, new Set())
      }
      this.sessionAgents.get(sessionId)!.add(agentId)
    }

    return cost
  }

  /** Get cost for a specific agent */
  getAgentCost(agentId: string): AgentCost | null {
    return this.agentUsage.get(agentId) || null
  }

  /** Get total session cost */
  getSessionCost(sessionId: string): SessionCost {
    const agentIds = this.sessionAgents.get(sessionId) || new Set()
    const agentCosts: AgentCost[] = []
    let totalCost = 0
    let totalInput = 0
    let totalOutput = 0
    const modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cost: number }> = {}

    for (const agentId of agentIds) {
      const agent = this.agentUsage.get(agentId)
      if (!agent) continue

      agentCosts.push(agent)
      totalCost += agent.totalCost
      totalInput += agent.inputTokens
      totalOutput += agent.outputTokens

      if (!modelBreakdown[agent.model]) {
        modelBreakdown[agent.model] = { inputTokens: 0, outputTokens: 0, cost: 0 }
      }
      modelBreakdown[agent.model].inputTokens += agent.inputTokens
      modelBreakdown[agent.model].outputTokens += agent.outputTokens
      modelBreakdown[agent.model].cost += agent.totalCost
    }

    return {
      sessionId,
      totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      agentCosts,
      modelBreakdown,
    }
  }

  /** Check if session exceeds budget */
  checkBudgetAlert(sessionId: string, budgetLimit: number): boolean {
    const session = this.getSessionCost(sessionId)
    return session.totalCost >= budgetLimit
  }

  /** Get pricing for a model */
  getModelPricing(model: string): ModelPricing | null {
    return findPricing(model)
  }

  /** Export a full cost report */
  exportCostReport(sessionId: string, budgetLimit?: number): CostReport {
    const session = this.getSessionCost(sessionId)
    const totalRequests = session.agentCosts.reduce((sum, a) => sum + a.requestCount, 0)

    const modelBreakdown: CostReport['modelBreakdown'] = {}
    for (const [model, data] of Object.entries(session.modelBreakdown)) {
      const requests = session.agentCosts.filter(a => a.model === model).reduce((s, a) => s + a.requestCount, 0)
      modelBreakdown[model] = { ...data, requests }
    }

    return {
      sessionId,
      generatedAt: Date.now(),
      totalCost: session.totalCost,
      agentCount: session.agentCosts.length,
      requestCount: totalRequests,
      modelBreakdown,
      agentDetails: session.agentCosts,
      budgetStatus: budgetLimit ? {
        limit: budgetLimit,
        used: session.totalCost,
        remaining: Math.max(0, budgetLimit - session.totalCost),
        percentage: (session.totalCost / budgetLimit) * 100,
      } : undefined,
    }
  }

  /** Reset all data */
  reset(): void {
    this.agentUsage.clear()
    this.sessionAgents.clear()
  }
}

// Singleton
export const costCalculator = new CostCalculator()

export { PRICING, findPricing }
export default CostCalculator
