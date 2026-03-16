'use client'

import { useState, useEffect, useCallback } from 'react'

export interface Toast {
  id: string
  type: 'warning' | 'success' | 'error' | 'info'
  message: string
  agentId?: string
  timestamp: number
}

interface NotificationToastProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
  onAgentClick?: (agentId: string) => void
}

const TOAST_ICONS = {
  warning: '⚠️',
  success: '✅',
  error: '❌',
  info: 'ℹ️',
}

const TOAST_STYLES = {
  warning: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300',
  success: 'bg-green-500/15 border-green-500/30 text-green-300',
  error: 'bg-red-500/15 border-red-500/30 text-red-300',
  info: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
}

function ToastItem({ toast, onDismiss, onAgentClick }: {
  toast: Toast
  onDismiss: (id: string) => void
  onAgentClick?: (agentId: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 6000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-sm cursor-pointer transition-all duration-200 max-w-sm ${TOAST_STYLES[toast.type]}`}
      onClick={() => { if (toast.agentId && onAgentClick) onAgentClick(toast.agentId) }}
    >
      <span className="text-lg shrink-0">{TOAST_ICONS[toast.type]}</span>
      <span className="text-sm flex-1">{toast.message}</span>
      <button
        onClick={e => { e.stopPropagation(); onDismiss(toast.id) }}
        className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

export function NotificationToast({ toasts, onDismiss, onAgentClick }: NotificationToastProps) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.slice(-3).map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onAgentClick={onAgentClick} />
      ))}
    </div>
  )
}

// Hook for managing toasts
export function useNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: Toast['type'], message: string, agentId?: string) => {
    const toast: Toast = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      message,
      agentId,
      timestamp: Date.now(),
    }
    setToasts(prev => [...prev.slice(-4), toast])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, dismiss }
}
