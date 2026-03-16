'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { detectLanguage } from '@/lib/i18n/detector'
import { normalizeHinglish } from '@/lib/i18n/normalizer'
import { estimateTokens, estimateCost } from '@/lib/providers/router'
import type { ModelOption } from '@/lib/providers/router'

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item: (index: number) => SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item: (index: number) => SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent {
  error: string
  message: string
}

interface InputPanelProps {
  onSend: (text: string) => void
  isStreaming: boolean
  onStop: () => void
  selectedModel: ModelOption
  onCommandPalette: () => void
}

const TEMPLATES = [
  { label: '🐛 Fix bug', value: 'Fix this bug:\n\n' },
  { label: '✨ New feature', value: 'Create a new feature:\n\n' },
  { label: '💡 Explain', value: 'Explain this code:\n\n' },
  { label: '🧪 Write tests', value: 'Write tests for:\n\n' },
  { label: '👁️ Code review', value: 'Review this code:\n\n' },
  { label: '⚡ Optimize', value: 'Optimize this for performance:\n\n' },
  { label: '📚 Document', value: 'Generate documentation for:\n\n' },
  { label: '🔧 Refactor', value: 'Refactor this code:\n\n' },
]

export function InputPanel({ onSend, isStreaming, onStop, selectedModel, onCommandPalette }: InputPanelProps) {
  const [text, setText] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [langDetection, setLangDetection] = useState<{ flag: string; label: string; normalized?: string } | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const speechRef = useRef<SpeechRecognitionInstance | null>(null)
  const interimBaseRef = useRef('')
  const voiceErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    setTimeout(() => setSpeechSupported(!!SpeechRecognitionCtor), 0)
  }, [])

  const showVoiceError = useCallback((msg: string) => {
    setVoiceError(msg)
    clearTimeout(voiceErrorTimerRef.current)
    voiceErrorTimerRef.current = setTimeout(() => setVoiceError(null), 4000)
  }, [])

  const stopListening = useCallback(() => {
    if (speechRef.current) {
      speechRef.current.abort()
      speechRef.current = null
    }
    interimBaseRef.current = ''
    setIsListening(false)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    // Use browser locale so non-English users get correct STT (falls back to 'en-US')
    recognition.lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US'

    interimBaseRef.current = text

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }

      if (finalTranscript) {
        const newBase = interimBaseRef.current + (interimBaseRef.current ? ' ' : '') + finalTranscript.trim()
        interimBaseRef.current = newBase
        setText(newBase)
      } else if (interimTranscript) {
        const combined = interimBaseRef.current + (interimBaseRef.current ? ' ' : '') + interimTranscript
        setText(combined)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      stopListening()
      const errorMap: Record<string, string> = {
        'not-allowed': '🎤 Mic access denied — allow microphone in browser settings',
        'no-speech': '🎤 No speech detected — try speaking louder',
        'audio-capture': '🎤 No microphone found — plug one in and retry',
        'network': '🎤 Network error during voice recognition',
        'aborted': '',  // silent — user or code aborted
        'service-not-allowed': '🎤 Voice service not allowed on this page',
      }
      const msg = errorMap[event.error] ?? `🎤 Voice error: ${event.error}`
      if (msg) showVoiceError(msg)
    }

    recognition.onend = () => {
      setIsListening(false)
      speechRef.current = null
      interimBaseRef.current = ''
    }

    speechRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
    } catch {
      showVoiceError('🎤 Could not start voice recognition — try again')
      speechRef.current = null
    }
  }, [text, stopListening, showVoiceError])

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }, [text])

  const handleTextChange = useCallback((value: string) => {
    setText(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (value.trim().length > 5) {
        const det = detectLanguage(value)
        if (det.lang !== 'en') {
          const { normalized, wasTranslated, originalLang } = normalizeHinglish(value)
          setLangDetection({ flag: det.flag, label: originalLang, normalized: wasTranslated ? normalized : undefined })
        } else {
          setLangDetection(null)
        }
      } else {
        setLangDetection(null)
      }
    }, 300)
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    const { normalized } = normalizeHinglish(trimmed)
    onSend(normalized)
    setText('')
    setLangDetection(null)
  }, [text, isStreaming, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onCommandPalette()
    }
  }, [handleSend, onCommandPalette])

  const tokenCount = estimateTokens(text)
  const costEstimate = estimateCost(text, selectedModel)
  const langCode = text.trim().length > 5 ? detectLanguage(text).lang : null

  const LANG_ICONS: Record<string, string> = {
    hi: '🇮🇳', bn: '🇧🇩', ta: '🇮🇳', te: '🇮🇳', mr: '🇮🇳',
    gu: '🇮🇳', kn: '🇮🇳', ml: '🇮🇳', pa: '🇮🇳', hinglish: '🇮🇳', en: '🇺🇸',
  }

  return (
    <div className="shrink-0 border-t border-white/10 bg-black/10 p-3">
      {langDetection && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs flex items-start gap-2">
          <span>{langDetection.flag}</span>
          <div>
            <span className="text-orange-300">Detected {langDetection.label}</span>
            {langDetection.normalized && (
              <span className="text-white/60 ml-1">→ &quot;{langDetection.normalized.slice(0, 60)}&quot;</span>
            )}
          </div>
        </div>
      )}

      {voiceError && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs text-red-300 flex items-center justify-between">
          <span>{voiceError}</span>
          <button onClick={() => setVoiceError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type anything… Ctrl+Enter to send · Ctrl+K for commands"
            rows={1}
            className="w-full px-4 py-3 pr-12 rounded-xl bg-white/8 border border-white/10 focus:border-blue-500/50 focus:outline-none resize-none text-sm placeholder-white/30 transition-colors leading-relaxed"
          />
          {langCode && langCode !== 'en' && (
            <span className="absolute right-3 top-3 text-lg" title={`Input: ${langCode}`}>
              {LANG_ICONS[langCode] || '🌐'}
            </span>
          )}
        </div>

        <button
          onClick={speechSupported ? handleVoiceToggle : () => showVoiceError('🎤 Voice input not supported in this browser — try Chrome')}
          title={!speechSupported ? 'Voice not supported — try Chrome' : isListening ? 'Stop recording' : 'Start voice input'}
          className={`p-3 rounded-xl border text-sm transition-all shrink-0 ${
            isListening
              ? 'bg-red-500/30 border-red-500/50 text-red-400 animate-pulse'
              : !speechSupported
              ? 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white/90'
          }`}
        >
          🎤
        </button>

        {isStreaming ? (
          <button
            onClick={onStop}
            className="px-4 py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-sm font-medium transition-colors shrink-0"
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
          >
            Send ↑
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTemplates(s => !s)}
            className="text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
          >
            📋 Templates
          </button>
          <button
            onClick={onCommandPalette}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            ⌨️ Ctrl+K
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/30">
          <span>~{tokenCount} tokens</span>
          {costEstimate > 0 && <span>~${costEstimate.toFixed(6)}</span>}
        </div>
      </div>

      {showTemplates && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {TEMPLATES.map(t => (
            <button
              key={t.label}
              onClick={() => { setText(prev => t.value + prev); setShowTemplates(false); textareaRef.current?.focus() }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-xs text-white/70 text-left transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
