'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { AgentArcadePanel, useAgentArcadeStore } from '@/lib/agent-arcade'

function EmbedInner() {
  const params = useSearchParams()
  const gateway = params.get('gateway') || 'http://localhost:8787'
  const session = params.get('session') || 'default'
  const theme = params.get('theme') || undefined
  const pixels = params.get('pixels') || undefined
  const zoom = params.get('zoom') ? parseFloat(params.get('zoom')!) : undefined
  const dark = params.get('dark') === '1'

  const updateSettings = useAgentArcadeStore(s => s.updateSettings)

  useEffect(() => {
    const patch: Record<string, unknown> = {}
    if (theme) patch.theme = theme
    if (pixels) patch.pixelLevel = pixels
    if (zoom !== undefined) patch.zoom = zoom
    patch.darkMode = dark
    if (Object.keys(patch).length > 0) updateSettings(patch)
  }, [theme, pixels, zoom, dark, updateSettings])

  return (
    <div className={`w-screen h-screen overflow-hidden ${dark ? 'dark bg-gray-950' : 'bg-white'}`}>
      <AgentArcadePanel
        gatewayUrl={gateway}
        sessionId={session}
        embed
      />
    </div>
  )
}

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="w-screen h-screen flex items-center justify-center text-sm text-muted-foreground">Loading Agent Arcade…</div>}>
      <EmbedInner />
    </Suspense>
  )
}
