// Persistent session storage for console chat history
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  model?: string
  inputTokens?: number
  outputTokens?: number
  cost?: number
}

export interface ConsoleSession {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  model: string
}

const STORAGE_KEY = 'arcade-console-sessions'
const ACTIVE_KEY = 'arcade-console-active-session'

function loadAll(): ConsoleSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveAll(sessions: ConsoleSession[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* quota exceeded */ }
}

export function createSession(model: string): ConsoleSession {
  const now = Date.now()
  return {
    id: `session-${now}`,
    name: `Session ${new Date(now).toLocaleTimeString()}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    model,
  }
}

export function getActiveSessionId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACTIVE_KEY)
}

export function setActiveSessionId(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACTIVE_KEY, id)
}

export function listSessions(): ConsoleSession[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): ConsoleSession | null {
  return loadAll().find(s => s.id === id) || null
}

export function saveSession(session: ConsoleSession): void {
  const all = loadAll()
  const idx = all.findIndex(s => s.id === session.id)
  if (idx >= 0) all[idx] = session
  else all.unshift(session)
  // Keep last 20 sessions
  saveAll(all.slice(0, 20))
}

export function addMessage(sessionId: string, msg: ChatMessage): ConsoleSession | null {
  const all = loadAll()
  const session = all.find(s => s.id === sessionId)
  if (!session) return null
  if (session.messages.some(m => m.id === msg.id)) return session
  session.messages = [...session.messages.slice(-49), msg]  // Keep last 50
  session.updatedAt = Date.now()
  if (msg.cost) session.totalCost += msg.cost
  if (msg.inputTokens) session.totalInputTokens += msg.inputTokens
  if (msg.outputTokens) session.totalOutputTokens += msg.outputTokens
  saveAll(all)
  return session
}

export function renameSession(id: string, name: string): void {
  const all = loadAll()
  const s = all.find(s => s.id === id)
  if (s) { s.name = name; saveAll(all) }
}

export function deleteSession(id: string): void {
  saveAll(loadAll().filter(s => s.id !== id))
}

export function exportSession(session: ConsoleSession): void {
  const lines = [`# ${session.name}`, `Created: ${new Date(session.createdAt).toISOString()}`, '']
  for (const msg of session.messages) {
    lines.push(`## ${msg.role === 'user' ? 'You' : 'AI'}`)
    lines.push(msg.content)
    lines.push('')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${session.name.replace(/\s+/g, '-')}.md`
  a.click()
  URL.revokeObjectURL(url)
}
