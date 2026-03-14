/**
 * Agent Arcade Notification System
 *
 * Central router that dispatches alerts to configured channels:
 * WhatsApp, Slack, Discord, Email.
 *
 * Reads config from arcade.config.json alerts section.
 * Evaluates rules and rate-limits to prevent spam.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationConfig {
  channels: ChannelConfig[]
  rules: AlertRule[]
  rateLimitMs?: number // minimum ms between same-type alerts (default: 60000)
}

export interface ChannelConfig {
  type: 'whatsapp' | 'slack' | 'discord' | 'email'
  enabled: boolean
  // WhatsApp
  phoneNumber?: string
  // Slack
  webhookUrl?: string
  // Discord
  discordWebhookUrl?: string
  // Email
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  emailTo?: string
  emailFrom?: string
}

export interface AlertRule {
  type: 'cost_threshold' | 'error_rate' | 'agent_error' | 'agent_stuck' | 'session_complete' | 'agent_waiting'
  threshold?: number // e.g., cost > 5.00, errorRate > 0.1, stuckMinutes > 10
  channels: string[] // which channel types to notify
  enabled: boolean
}

export interface AlertEvent {
  type: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  agentId?: string
  agentName?: string
  sessionId?: string
  data?: Record<string, unknown>
  timestamp: number
}

// ---------------------------------------------------------------------------
// Channel Senders
// ---------------------------------------------------------------------------

async function sendSlack(webhookUrl: string, alert: AlertEvent): Promise<void> {
  const color = alert.severity === 'critical' ? '#ef4444'
    : alert.severity === 'warning' ? '#f59e0b' : '#22c55e'

  const body = {
    attachments: [{
      color,
      title: `${getSeverityEmoji(alert.severity)} ${alert.title}`,
      text: alert.message,
      fields: [
        ...(alert.agentName ? [{ title: 'Agent', value: alert.agentName, short: true }] : []),
        ...(alert.sessionId ? [{ title: 'Session', value: alert.sessionId, short: true }] : []),
      ],
      footer: 'Agent Arcade',
      ts: Math.floor(alert.timestamp / 1000),
    }],
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.warn(`Slack notification failed: ${res.status}`)
  } catch (e) {
    console.warn(`Slack notification error: ${e}`)
  }
}

async function sendDiscord(webhookUrl: string, alert: AlertEvent): Promise<void> {
  const color = alert.severity === 'critical' ? 0xef4444
    : alert.severity === 'warning' ? 0xf59e0b : 0x22c55e

  const body = {
    embeds: [{
      title: `${getSeverityEmoji(alert.severity)} ${alert.title}`,
      description: alert.message,
      color,
      fields: [
        ...(alert.agentName ? [{ name: 'Agent', value: alert.agentName, inline: true }] : []),
        ...(alert.sessionId ? [{ name: 'Session', value: alert.sessionId, inline: true }] : []),
      ],
      footer: { text: 'Agent Arcade' },
      timestamp: new Date(alert.timestamp).toISOString(),
    }],
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.warn(`Discord notification failed: ${res.status}`)
  } catch (e) {
    console.warn(`Discord notification error: ${e}`)
  }
}

async function sendEmail(config: ChannelConfig, alert: AlertEvent): Promise<void> {
  try {
    // Dynamic import to avoid requiring nodemailer when not using email
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: config.smtpHost || 'smtp.gmail.com',
      port: config.smtpPort || 587,
      secure: false,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    })

    await transporter.sendMail({
      from: config.emailFrom || config.smtpUser,
      to: config.emailTo,
      subject: `[Agent Arcade] ${getSeverityEmoji(alert.severity)} ${alert.title}`,
      html: `
        <div style="font-family: monospace; padding: 20px; background: #0a0a1a; color: #fff;">
          <h2 style="color: ${alert.severity === 'critical' ? '#ef4444' : '#f59e0b'};">${alert.title}</h2>
          <p>${alert.message}</p>
          ${alert.agentName ? `<p><strong>Agent:</strong> ${alert.agentName}</p>` : ''}
          ${alert.sessionId ? `<p><strong>Session:</strong> ${alert.sessionId}</p>` : ''}
          <hr style="border-color: #333;">
          <p style="color: #666; font-size: 12px;">Agent Arcade Notification System</p>
        </div>
      `,
    })
  } catch (e) {
    console.warn(`Email notification error: ${e}`)
  }
}

async function sendWhatsApp(phoneNumber: string, alert: AlertEvent): Promise<void> {
  // WhatsApp integration via whatsapp-web.js requires persistent session
  // For now, log the message -- users can integrate with Twilio or whatsapp-web.js
  const msg = `${getSeverityEmoji(alert.severity)} *${alert.title}*\n${alert.message}`
  if (alert.agentName) console.log(`Agent: ${alert.agentName}`)
  console.log(`[WhatsApp → ${phoneNumber}] ${msg}`)
  // TODO: Integrate with whatsapp-web.js or Twilio API
  // For Twilio:
  // const twilio = require('twilio')(accountSid, authToken)
  // await twilio.messages.create({ body: msg, from: 'whatsapp:+14155238886', to: `whatsapp:${phoneNumber}` })
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '\u{1F6A8}'
    case 'warning': return '\u{26A0}\u{FE0F}'
    default: return '\u{2139}\u{FE0F}'
  }
}

// ---------------------------------------------------------------------------
// Notification Router
// ---------------------------------------------------------------------------

export class NotificationRouter {
  private config: NotificationConfig
  private lastAlerts = new Map<string, number>() // type -> last timestamp
  private rateLimitMs: number

  constructor(config: NotificationConfig) {
    this.config = config
    this.rateLimitMs = config.rateLimitMs || 60000
  }

  /**
   * Evaluate an event against configured rules and dispatch notifications.
   */
  async evaluate(alert: AlertEvent): Promise<void> {
    // Rate limiting
    const key = `${alert.type}:${alert.agentId || 'global'}`
    const lastTime = this.lastAlerts.get(key) || 0
    if (Date.now() - lastTime < this.rateLimitMs) return
    this.lastAlerts.set(key, Date.now())

    // Find matching rules
    const matchingRules = this.config.rules.filter(r => r.enabled && r.type === alert.type)

    for (const rule of matchingRules) {
      // Check threshold if applicable
      if (rule.threshold !== undefined && alert.data) {
        const value = alert.data.value as number | undefined
        if (value !== undefined && value < rule.threshold) continue
      }

      // Dispatch to configured channels
      for (const channelType of rule.channels) {
        const channel = this.config.channels.find(c => c.type === channelType && c.enabled)
        if (!channel) continue

        try {
          switch (channel.type) {
            case 'slack':
              if (channel.webhookUrl) await sendSlack(channel.webhookUrl, alert)
              break
            case 'discord':
              if (channel.discordWebhookUrl) await sendDiscord(channel.discordWebhookUrl, alert)
              break
            case 'email':
              if (channel.smtpUser && channel.emailTo) await sendEmail(channel, alert)
              break
            case 'whatsapp':
              if (channel.phoneNumber) await sendWhatsApp(channel.phoneNumber, alert)
              break
          }
        } catch (e) {
          console.warn(`Failed to send ${channel.type} notification: ${e}`)
        }
      }
    }
  }

  /**
   * Check cost threshold and fire alert if exceeded.
   */
  async checkCostThreshold(sessionId: string, currentCost: number, limit: number): Promise<void> {
    if (currentCost >= limit) {
      await this.evaluate({
        type: 'cost_threshold',
        title: 'Cost Threshold Exceeded',
        message: `Session "${sessionId}" has reached $${currentCost.toFixed(2)} (limit: $${limit.toFixed(2)})`,
        severity: currentCost >= limit * 1.5 ? 'critical' : 'warning',
        sessionId,
        data: { value: currentCost, limit },
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Check error rate and fire alert if exceeded.
   */
  async checkErrorRate(sessionId: string, errorRate: number, threshold: number): Promise<void> {
    if (errorRate >= threshold) {
      await this.evaluate({
        type: 'error_rate',
        title: 'High Error Rate',
        message: `Session "${sessionId}" error rate is ${(errorRate * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`,
        severity: errorRate >= threshold * 2 ? 'critical' : 'warning',
        sessionId,
        data: { value: errorRate, threshold },
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Fire alert for agent error.
   */
  async alertAgentError(agentId: string, agentName: string, sessionId: string, errorMessage: string): Promise<void> {
    await this.evaluate({
      type: 'agent_error',
      title: 'Agent Error',
      message: `Agent "${agentName}" encountered an error: ${errorMessage}`,
      severity: 'warning',
      agentId,
      agentName,
      sessionId,
      timestamp: Date.now(),
    })
  }

  /**
   * Fire alert when agent is waiting for input.
   */
  async alertAgentWaiting(agentId: string, agentName: string, sessionId: string): Promise<void> {
    await this.evaluate({
      type: 'agent_waiting',
      title: 'Agent Waiting for Input',
      message: `Agent "${agentName}" is waiting for your approval or input`,
      severity: 'info',
      agentId,
      agentName,
      sessionId,
      timestamp: Date.now(),
    })
  }

  /**
   * Fire alert when session completes.
   */
  async alertSessionComplete(sessionId: string, summary: string): Promise<void> {
    await this.evaluate({
      type: 'session_complete',
      title: 'Session Complete',
      message: summary,
      severity: 'info',
      sessionId,
      timestamp: Date.now(),
    })
  }

  /** Update configuration */
  updateConfig(config: NotificationConfig): void {
    this.config = config
    this.rateLimitMs = config.rateLimitMs || 60000
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  channels: [],
  rules: [
    { type: 'agent_error', threshold: undefined, channels: ['slack', 'discord', 'email'], enabled: true },
    { type: 'cost_threshold', threshold: 5.00, channels: ['slack', 'email', 'whatsapp'], enabled: true },
    { type: 'error_rate', threshold: 0.1, channels: ['slack'], enabled: true },
    { type: 'agent_waiting', threshold: undefined, channels: ['whatsapp', 'slack'], enabled: true },
    { type: 'session_complete', threshold: undefined, channels: ['slack'], enabled: false },
  ],
  rateLimitMs: 60000,
}

export default NotificationRouter
