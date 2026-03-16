'use client'

import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WAStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error'

interface WAStatusPayload {
  status: WAStatus
  qr?: string          // base64 data URL — only present when status === 'qr'
  gatewayUrl?: string
  message?: string     // human-readable fallback message
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GATEWAY_URL =
  (typeof window !== 'undefined' && (window as any).__ARCADE_GATEWAY_URL__) ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'http://localhost:47890'

const POLL_INTERVAL_MS = 3000   // check every 3 s while tab is open
const POLL_INTERVAL_QR_MS = 5000 // slow down after QR is shown (less pressure)

// ---------------------------------------------------------------------------
// WhatsAppSettings component
// ---------------------------------------------------------------------------

export function WhatsAppSettings() {
  const [payload, setPayload]   = useState<WAStatusPayload | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // ── polling ────────────────────────────────────────────────────────────────
  const poll = async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/whatsapp/status`, {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
      })
      if (!res.ok) {
        setError(`Gateway returned ${res.status}`)
        setPayload(null)
      } else {
        const data: WAStatusPayload = await res.json()
        if (mountedRef.current) {
          setPayload(data)
          setError(null)
        }
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError('Gateway unreachable — is it running on port 47890?')
        setPayload(null)
      }
    }

    if (mountedRef.current) {
      const interval = payload?.status === 'qr' ? POLL_INTERVAL_QR_MS : POLL_INTERVAL_MS
      timerRef.current = setTimeout(poll, interval)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    poll()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── copy gateway URL helper ─────────────────────────────────────────────────
  const copyGatewayUrl = () => {
    navigator.clipboard.writeText(GATEWAY_URL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 text-sm">

      {/* Title row */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">📱</span>
        <div>
          <h3 className="text-white font-semibold text-sm">WhatsApp Control</h3>
          <p className="text-white/40 text-xs">Scan once — control agents from your phone</p>
        </div>
      </div>

      {/* Status pill */}
      {payload && (
        <StatusBadge status={payload.status} />
      )}

      {/* Error state */}
      {error && !payload && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 space-y-1">
          <p className="text-red-400 text-xs font-medium">Connection Error</p>
          <p className="text-white/50 text-xs">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {!payload && !error && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-6 h-6 rounded-full border-2 border-blue-500/40 border-t-blue-400 animate-spin" />
          <p className="text-white/30 text-xs">Checking gateway…</p>
        </div>
      )}

      {/* QR code */}
      {payload?.status === 'qr' && payload.qr && (
        <QRCodePanel qrDataUrl={payload.qr} />
      )}

      {/* Connected state */}
      {payload?.status === 'connected' && (
        <ConnectedPanel />
      )}

      {/* Disconnected / not started */}
      {(payload?.status === 'disconnected' || payload?.status === 'error' || payload?.status === 'starting') && (
        <DisconnectedPanel message={payload?.message} />
      )}

      {/* Gateway URL info */}
      <div className="rounded-xl bg-white/3 border border-white/8 divide-y divide-white/5">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-white/40 text-xs">Gateway</span>
          <button
            onClick={copyGatewayUrl}
            className="text-xs font-mono text-white/60 hover:text-white/90 transition-colors flex items-center gap-1.5"
            title="Click to copy"
          >
            {GATEWAY_URL.replace(/^https?:\/\//, '')}
            <span className="text-white/30">{copied ? '✓' : '⎘'}</span>
          </button>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-white/40 text-xs">WhatsApp port</span>
          <span className="text-white/60 text-xs font-mono">47891</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-white/40 text-xs">Auth persists</span>
          <span className="text-white/60 text-xs font-mono">.whatsapp-auth/</span>
        </div>
      </div>

      {/* Command reference */}
      <CommandReference />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: WAStatus }) {
  const configs: Record<WAStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
    connected:    { color: 'text-green-300',  bg: 'bg-green-500/10',  border: 'border-green-500/25',  dot: 'bg-green-400',  label: 'Connected' },
    qr:           { color: 'text-yellow-300', bg: 'bg-yellow-500/10', border: 'border-yellow-500/25', dot: 'bg-yellow-400', label: 'Waiting for scan' },
    disconnected: { color: 'text-white/50',   bg: 'bg-white/5',       border: 'border-white/10',      dot: 'bg-white/30',   label: 'Disconnected' },
    starting:     { color: 'text-blue-300',   bg: 'bg-blue-500/10',   border: 'border-blue-500/25',   dot: 'bg-blue-400',   label: 'Starting…' },
    error:        { color: 'text-red-300',    bg: 'bg-red-500/10',    border: 'border-red-500/25',    dot: 'bg-red-400',    label: 'Error' },
  }
  const c = configs[status] || configs.disconnected
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${c.bg} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot} ${status === 'connected' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${c.color}`}>{c.label}</span>
    </div>
  )
}

function QRCodePanel({ qrDataUrl }: { qrDataUrl: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-2xl bg-white p-3 shadow-lg shadow-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="WhatsApp QR code — scan with your phone"
          width={240}
          height={240}
          className="block rounded"
        />
      </div>
      <div className="text-center space-y-1">
        <p className="text-white/70 text-sm font-medium">Scan this QR code</p>
        <p className="text-white/40 text-xs">
          Open WhatsApp → Settings → Linked Devices → Link a Device
        </p>
        <p className="text-white/30 text-xs">QR refreshes automatically</p>
      </div>
    </div>
  )
}

function ConnectedPanel() {
  return (
    <div className="rounded-xl border border-green-500/20 bg-green-500/8 px-4 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">✅</span>
        <div>
          <p className="text-green-300 font-semibold text-sm">WhatsApp Linked</p>
          <p className="text-white/50 text-xs">You can now control agents from your phone</p>
        </div>
      </div>
      <p className="text-white/40 text-xs leading-relaxed">
        Send <span className="font-mono text-white/60">help</span> to the linked WhatsApp number
        to see available commands.
      </p>
    </div>
  )
}

function DisconnectedPanel({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/3 px-4 py-4 space-y-3">
      <p className="text-white/60 text-sm font-medium">Start the WhatsApp client</p>
      <div className="rounded-lg bg-black/40 border border-white/8 p-3 font-mono text-xs text-green-400 leading-relaxed space-y-1">
        <p className="text-white/30"># In your gateway directory:</p>
        <p>GATEWAY_URL=http://localhost:47890 \</p>
        <p className="pl-2">bun run packages/whatsapp-client/src/index.ts</p>
      </div>
      {message && (
        <p className="text-white/30 text-xs">{message}</p>
      )}
      <p className="text-white/40 text-xs leading-relaxed">
        Once started, a QR code will appear here and in your terminal.
        Scan it once and the session persists in{' '}
        <span className="font-mono text-white/60">.whatsapp-auth/</span>.
      </p>
    </div>
  )
}

function CommandReference() {
  const [open, setOpen] = useState(false)

  const commands = [
    { cmd: 'help',                          desc: 'List all commands' },
    { cmd: 'list SESSION',                  desc: 'List agents in a session' },
    { cmd: 'status SESSION',                desc: 'Same as list' },
    { cmd: 'pause SESSION AGENT',           desc: 'Pause an agent' },
    { cmd: 'resume SESSION AGENT',          desc: 'Resume a paused agent' },
    { cmd: 'stop SESSION AGENT',            desc: 'Stop an agent' },
    { cmd: 'redirect SESSION AGENT: ...',   desc: 'Redirect with new instruction' },
  ]

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-xs font-semibold text-white/60 uppercase tracking-wider hover:text-white/80 transition-colors"
      >
        <span>WhatsApp Commands</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="rounded-lg bg-white/3 border border-white/8 overflow-hidden">
          {commands.map(c => (
            <div
              key={c.cmd}
              className="flex items-start justify-between gap-3 px-3 py-2 border-b border-white/5 last:border-0"
            >
              <code className="text-xs font-mono text-green-400 shrink-0">{c.cmd}</code>
              <span className="text-xs text-white/40 text-right">{c.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
