'use client'

import { useState, useRef } from 'react'

interface RedirectPanelProps {
  agentId: string
  onRedirect: (instruction: string) => void
  redirectHistory: Array<{ ts: number; instruction: string }>
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function RedirectPanel({ agentId, onRedirect, redirectHistory }: RedirectPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const trimmed = instruction.trim()
    if (!trimmed) return
    setSending(true)
    onRedirect(trimmed)
    setInstruction('')
    setSending(false)
  }

  const EXAMPLES = [
    'Use JWT instead of sessions',
    'Add TypeScript strict mode',
    'Skip tests for now',
    'Use PostgreSQL not MySQL',
    'Add rate limiting to endpoints',
  ]

  return (
    <div className="px-3 py-2 border-t border-white/5">
      <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
        🔀 Redirect This Agent
      </div>

      <textarea
        ref={textareaRef}
        value={instruction}
        onChange={e => setInstruction(e.target.value)}
        placeholder={`New direction for ${agentId}…`}
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-orange-500/50 focus:outline-none resize-none text-xs placeholder-white/25 leading-relaxed transition-colors"
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend() } }}
      />

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSend}
          disabled={!instruction.trim() || sending}
          className="px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-300 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? '⏳ Sending…' : '🔀 Send New Direction →'}
        </button>
      </div>

      {/* Quick examples */}
      <div className="flex flex-wrap gap-1 mt-2">
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            onClick={() => setInstruction(ex)}
            className="px-2 py-0.5 rounded text-xs bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 border border-white/5 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      {/* History */}
      {redirectHistory.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-white/30 font-medium">Recent redirects:</div>
          {redirectHistory.slice(-3).reverse().map((r, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="text-white/20 shrink-0">{timeAgo(r.ts)}</span>
              <span className="text-white/50 truncate">&quot;{r.instruction}&quot;</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
