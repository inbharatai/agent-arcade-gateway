'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onCommand: (command: string, args?: string) => void
}

const COMMANDS = [
  { cmd: '/fix', description: 'Fix selected/pasted code', icon: '🐛' },
  { cmd: '/explain', description: 'Explain selected code', icon: '💡' },
  { cmd: '/test', description: 'Generate tests', icon: '🧪' },
  { cmd: '/review', description: 'Code review', icon: '👁️' },
  { cmd: '/opt', description: 'Optimize performance', icon: '⚡' },
  { cmd: '/docs', description: 'Generate documentation', icon: '📚' },
  { cmd: '/refactor', description: 'Refactor code', icon: '🔧' },
  { cmd: '/debug', description: 'Debug assistance', icon: '🔍' },
  { cmd: '/agents', description: 'Run task with specialized multi-agent orchestrator (Architect, Coder, Tester, Reviewer, Debugger)', icon: '🤖', args: '[task]' },
  { cmd: '/multi', description: 'Broadcast task to ALL connected agents in parallel', icon: '👥', args: '[task]' },
  { cmd: '/ask', description: 'Ask specific agent', icon: '🤖', args: '[agent_name]' },
  { cmd: '/stop', description: 'Stop specific agent', icon: '⏹', args: '[agent_name]' },
  { cmd: '/pause', description: 'Pause specific agent', icon: '⏸', args: '[agent_name]' },
  { cmd: '/status', description: 'Show all agent statuses', icon: '📊' },
  { cmd: '/cost', description: 'Show session cost breakdown', icon: '💰' },
  { cmd: '/history', description: 'Show agent action history', icon: '📜', args: '[agent_name]' },
  { cmd: '/redirect', description: 'Redirect agent mid-task', icon: '🔀', args: '[agent_name] [instruction]' },
]

export function CommandPalette({ isOpen, onClose, onCommand }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    // Reset and focus when palette opens — deferred to avoid synchronous setState-in-effect
    const t = setTimeout(() => {
      setQuery('')
      setSelected(0)
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [isOpen])

  const filtered = COMMANDS.filter(c =>
    !query || c.cmd.includes(query.toLowerCase()) || c.description.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = useCallback((cmd: typeof COMMANDS[0]) => {
    const [command, ...argParts] = cmd.cmd.split(' ')
    onCommand(command, argParts.join(' ') || undefined)
    onClose()
  }, [onCommand, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && filtered[selected]) { handleSelect(filtered[selected]) }
  }, [filtered, selected, handleSelect, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-2xl bg-gray-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="text-white/40">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm placeholder-white/30 focus:outline-none"
          />
          <kbd className="text-xs text-white/30 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-white/30 text-center">No commands found</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.cmd}
                onClick={() => handleSelect(cmd)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${i === selected ? 'bg-white/8' : 'hover:bg-white/5'}`}
              >
                <span className="text-lg w-6 text-center">{cmd.icon}</span>
                <span className="font-mono text-blue-300">{cmd.cmd}</span>
                {cmd.args && <span className="text-white/30 text-xs">{cmd.args}</span>}
                <span className="ml-auto text-white/40 text-xs">{cmd.description}</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-white/5 flex items-center gap-4 text-xs text-white/30">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>ESC close</span>
        </div>
      </div>
    </div>
  )
}
