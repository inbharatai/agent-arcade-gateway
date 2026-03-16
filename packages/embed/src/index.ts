/**
 * @agent-arcade/embed
 *
 * Provides three ways to embed Agent Arcade:
 *
 * 1. <AgentArcadeEmbed /> — React component
 * 2. Iframe URL helper — point an iframe to /embed?sessionId=...
 * 3. createAgentArcade() — imperative DOM mount
 */

'use client'

import React from 'react'

// ── React Embed Component ───────────────────────────────────────────────────
export interface AgentArcadeEmbedProps {
  /** Gateway URL (e.g. http://localhost:47890) */
  gatewayUrl: string
  /** Session to visualize */
  sessionId: string
  /** Web app base URL (e.g. http://localhost:47380) */
  webUrl?: string
  /** Auth token */
  authToken?: string
  /** Width (CSS value) */
  width?: string | number
  /** Height (CSS value) */
  height?: string | number
  /** Visual theme */
  theme?: string
  /** Pixel resolution level */
  pixelLevel?: string
  /** Dark mode */
  darkMode?: boolean
  /** CSS class */
  className?: string
}

export function AgentArcadeEmbed({
  gatewayUrl,
  sessionId,
  webUrl = '',
  authToken,
  width = '100%',
  height = 600,
  theme = 'office',
  pixelLevel = '16bit',
  darkMode = true,
  className,
}: AgentArcadeEmbedProps) {
  const base = webUrl || gatewayUrl.replace(/:\d+$/, ':47380')
  const params = new URLSearchParams({
    sessionId,
    gateway: gatewayUrl,
    theme,
    pixelLevel,
    darkMode: String(darkMode),
  })
  if (authToken) params.set('token', authToken)
  const src = `${base}/embed?${params.toString()}`

  return (
    <iframe
      src={src}
      width={typeof width === 'number' ? width : undefined}
      height={typeof height === 'number' ? height : undefined}
      style={{
        width: typeof width === 'string' ? width : undefined,
        height: typeof height === 'string' ? height : undefined,
        border: 'none',
        borderRadius: 8,
      }}
      className={className}
      allow="clipboard-read; clipboard-write"
      title="Agent Arcade"
    />
  )
}

// ── Iframe URL builder ──────────────────────────────────────────────────────
export function getEmbedUrl(opts: {
  webUrl: string
  sessionId: string
  gatewayUrl: string
  theme?: string
  pixelLevel?: string
  darkMode?: boolean
  authToken?: string
}): string {
  const params = new URLSearchParams({
    sessionId: opts.sessionId,
    gateway: opts.gatewayUrl,
    theme: opts.theme || 'office',
    pixelLevel: opts.pixelLevel || '16bit',
    darkMode: String(opts.darkMode ?? true),
  })
  if (opts.authToken) params.set('token', opts.authToken)
  return `${opts.webUrl}/embed?${params.toString()}`
}

// ── Imperative DOM mount ────────────────────────────────────────────────────
export function createAgentArcade(
  container: HTMLElement,
  opts: { webUrl: string; sessionId: string; gatewayUrl: string; width?: string; height?: string; theme?: string },
): { destroy: () => void } {
  const iframe = document.createElement('iframe')
  iframe.src = getEmbedUrl({ webUrl: opts.webUrl, sessionId: opts.sessionId, gatewayUrl: opts.gatewayUrl, theme: opts.theme })
  iframe.style.width = opts.width || '100%'
  iframe.style.height = opts.height || '600px'
  iframe.style.border = 'none'
  iframe.style.borderRadius = '8px'
  iframe.title = 'Agent Arcade'
  container.appendChild(iframe)
  return {
    destroy() { iframe.remove() },
  }
}
