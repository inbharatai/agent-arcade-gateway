'use client'

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/lib/session-store'

interface ChatHistoryProps {
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  modelName: string
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const copy = () => navigator.clipboard.writeText(code)
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-3 py-1 bg-white/5 text-xs text-white/50">
        <span className="font-mono">{lang || 'code'}</span>
        <button onClick={copy} className="hover:text-white/80 transition-colors">📋 Copy</button>
      </div>
      <pre className="p-3 text-sm text-green-300 font-mono overflow-x-auto leading-relaxed bg-black/30">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g

function renderContent(content: string) {
  const parts: React.ReactNode[] = []
  const regex = new RegExp(CODE_BLOCK_REGEX.source, CODE_BLOCK_REGEX.flags)
  let lastIndex = 0
  let match

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={lastIndex} className="whitespace-pre-wrap">
          {content.slice(lastIndex, match.index)}
        </span>
      )
    }
    parts.push(<CodeBlock key={match.index} lang={match[1]} code={match[2]} />)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(
      <span key={lastIndex} className="whitespace-pre-wrap">
        {content.slice(lastIndex)}
      </span>
    )
  }

  return parts
}

function MessageBubble({ msg, modelName }: { msg: ChatMessage; modelName: string }) {
  const isUser = msg.role === 'user'
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // External agent messages (WhatsApp, Claude Code, etc.) carry their source in msg.model
  const displayModel = msg.model || modelName

  if (isUser) {
    // WhatsApp or other external user messages carry a source label in msg.model
    const externalSource = msg.model && msg.model !== modelName ? msg.model : null
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%]">
          {externalSource && (
            <div className="text-right text-xs text-blue-400/70 mb-1 px-1">{externalSource}</div>
          )}
          <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-blue-600/80 text-white text-sm leading-relaxed">
            <span className="whitespace-pre-wrap">{msg.content}</span>
          </div>
          <div className="text-right text-xs text-white/30 mt-1 px-1">{time}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs shrink-0 mt-0.5">
        AI
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/40 mb-1 font-medium">{displayModel}</div>
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white/8 border border-white/8 text-sm text-white/90 leading-relaxed">
          {renderContent(msg.content)}
        </div>
        <div className="text-xs text-white/30 mt-1 px-1 flex gap-3">
          <span>{time}</span>
          {msg.inputTokens && <span>{(msg.inputTokens + (msg.outputTokens || 0)).toLocaleString()} tokens</span>}
          {msg.cost && msg.cost > 0 && <span>${msg.cost.toFixed(5)}</span>}
        </div>
      </div>
    </div>
  )
}

export function ChatHistory({ messages, streamingContent, isStreaming, modelName }: ChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef(messages.length)

  useEffect(() => {
    if (messages.length !== prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, streamingContent])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-white/30 p-6">
        <div className="text-4xl">🎮</div>
        <div className="text-center">
          <div className="font-semibold text-white/50 mb-1">Arcade Console</div>
          <div className="text-sm">Ask anything. Control your agents.</div>
          <div className="text-xs mt-2">Ctrl+K for commands · Ctrl+Enter to send</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1">
      {messages.map(msg => (
        <MessageBubble key={msg.id} msg={msg} modelName={modelName} />
      ))}

      {isStreaming && (
        <div className="flex gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs shrink-0 mt-0.5">
            AI
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40 mb-1 font-medium">{modelName}</div>
            <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white/8 border border-white/8 text-sm text-white/90 leading-relaxed">
              {streamingContent ? renderContent(streamingContent) : (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
              <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
