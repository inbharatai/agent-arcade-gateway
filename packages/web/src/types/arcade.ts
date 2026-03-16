// Shared type definitions for Agent Arcade v3.2
export type AgentState =
  | 'idle' | 'thinking' | 'reading' | 'writing' | 'tool'
  | 'waiting' | 'done' | 'paused' | 'stopped' | 'error'
  | 'redirected' | 'handoff' | 'moving'

export type AIProvider =
  | 'anthropic' | 'openai' | 'google' | 'mistral' | 'ollama' | 'custom'

export type InterventionAction =
  | 'pause' | 'resume' | 'stop' | 'undo' | 'restart' | 'redirect' | 'handoff'

export type SupportedLanguage =
  | 'en' | 'hi' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'ru' | 'zh' | 'ja'
  | 'ko' | 'ar' | 'nl' | 'pl' | 'tr' | 'vi' | 'th' | 'id' | 'ms' | 'uk'

export interface LanguageDetectionResult {
  detected: SupportedLanguage
  confidence: number
  isNative: boolean
  flag: string
  name: string
  script: 'latin' | 'devanagari' | 'cjk' | 'arabic' | 'cyrillic' | 'thai' | 'hangul' | 'other'
  isMixed: boolean
  translatedText?: string
}

export interface ModelOption {
  id: string
  name: string
  provider: AIProvider
  costPer1kInput: number
  costPer1kOutput: number
  contextWindow: number
  supportsVision: boolean
}

export interface StreamChunk {
  text: string
  done: boolean
  inputTokens?: number
  outputTokens?: number
  error?: string
}
