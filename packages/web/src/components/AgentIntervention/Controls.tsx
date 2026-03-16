'use client'

interface ControlsProps {
  agentId: string
  isPaused: boolean
  isStopped: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function Controls({ agentId, isPaused, isStopped, onPause, onResume, onStop }: ControlsProps) {
  if (isStopped) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-500/10 border border-gray-500/20 text-xs text-gray-400">
          <span>⏹</span>
          <span>Stopped</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {isPaused ? (
        <button
          onClick={onResume}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-400 text-xs font-medium transition-colors"
        >
          ▶ Resume
        </button>
      ) : (
        <button
          onClick={onPause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/30 text-yellow-400 text-xs font-medium transition-colors"
        >
          ⏸ Pause
        </button>
      )}
      <button
        onClick={onStop}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-medium transition-colors"
      >
        ⏹ Stop
      </button>
      {isPaused && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-500/10 text-yellow-400/70 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          Paused
        </div>
      )}
    </div>
  )
}
