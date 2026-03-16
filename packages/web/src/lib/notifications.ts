// Notification utilities for agent status alerts

export type NotificationType = 'warning' | 'success' | 'error' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  agentId?: string
  timestamp: number
}

export function createNotification(
  type: NotificationType,
  message: string,
  agentId?: string
): Notification {
  return {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    message,
    agentId,
    timestamp: Date.now(),
  }
}

// Agent status notification helpers
export function agentStuckNotification(agentId: string, name: string, minutes: number): Notification {
  return createNotification('warning', `⚠️ ${name} has been stuck for ${minutes} minutes`, agentId)
}

export function agentDoneNotification(agentId: string, name: string, summary?: string): Notification {
  return createNotification('success', `✅ ${name} completed${summary ? `: ${summary}` : ''}`, agentId)
}

export function agentErrorNotification(agentId: string, name: string, error: string): Notification {
  return createNotification('error', `❌ ${name} encountered an error: ${error.slice(0, 60)}`, agentId)
}

export function agentWaitingNotification(agentId: string, name: string): Notification {
  return createNotification('info', `⏳ ${name} is waiting for your input`, agentId)
}

export function sessionCostAlert(cost: number, limit: number): Notification {
  return createNotification('warning', `💰 Session cost reached $${cost.toFixed(2)} (limit: $${limit.toFixed(2)})`)
}
