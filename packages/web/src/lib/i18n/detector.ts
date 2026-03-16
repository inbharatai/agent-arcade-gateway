// Client-side language detection using Unicode ranges + vocabulary patterns
// Expanded to support 20 languages for Agent Arcade v3.2

import type { SupportedLanguage, LanguageDetectionResult } from '@/types/arcade'

// Keep legacy types for backward compatibility
export type LangCode = 'hi' | 'bn' | 'ta' | 'te' | 'mr' | 'gu' | 'kn' | 'ml' | 'pa' | 'as' | 'hinglish' | 'en'

export interface DetectionResult {
  lang: LangCode
  confidence: number
  flag: string
  label: string
}

// ── Unicode Script Ranges ──────────────────────────────────────────────────

interface ScriptRange {
  lang: SupportedLanguage
  start: number
  end: number
  flag: string
  name: string
  script: LanguageDetectionResult['script']
}

const SCRIPT_RANGES: ScriptRange[] = [
  // Devanagari (Hindi / Marathi — disambiguate by vocab)
  { lang: 'hi', start: 0x0900, end: 0x097F, flag: '🇮🇳', name: 'Hindi', script: 'devanagari' },
  // Arabic
  { lang: 'ar', start: 0x0600, end: 0x06FF, flag: '🇸🇦', name: 'Arabic', script: 'arabic' },
  // Thai
  { lang: 'th', start: 0x0E00, end: 0x0E7F, flag: '🇹🇭', name: 'Thai', script: 'thai' },
  // Korean Hangul syllables
  { lang: 'ko', start: 0xAC00, end: 0xD7AF, flag: '🇰🇷', name: 'Korean', script: 'hangul' },
  // Hiragana (Japanese)
  { lang: 'ja', start: 0x3040, end: 0x309F, flag: '🇯🇵', name: 'Japanese', script: 'cjk' },
  // Katakana (Japanese)
  { lang: 'ja', start: 0x30A0, end: 0x30FF, flag: '🇯🇵', name: 'Japanese', script: 'cjk' },
  // CJK unified (may be Chinese or Japanese — disambiguated below)
  { lang: 'zh', start: 0x4E00, end: 0x9FFF, flag: '🇨🇳', name: 'Chinese', script: 'cjk' },
  // Cyrillic (Russian / Ukrainian — disambiguated below)
  { lang: 'ru', start: 0x0400, end: 0x04FF, flag: '🇷🇺', name: 'Russian', script: 'cyrillic' },
]

// ── Vocabulary Patterns (Latin-script languages) ───────────────────────────

interface VocabPattern {
  lang: SupportedLanguage
  flag: string
  name: string
  pattern: RegExp
}

const VOCAB_PATTERNS: VocabPattern[] = [
  {
    lang: 'es',
    flag: '🇪🇸',
    name: 'Spanish',
    pattern: /\b(crear|arreglar|añadir|mostrar|mejorar|borrar|por favor|también|función|archivo|código|error|hola|gracias|problema)\b/i,
  },
  {
    lang: 'fr',
    flag: '🇫🇷',
    name: 'French',
    pattern: /\b(créer|corriger|ajouter|montrer|améliorer|supprimer|s'il vous plaît|aussi|fonction|fichier|code|erreur|bonjour|merci)\b/i,
  },
  {
    lang: 'de',
    flag: '🇩🇪',
    name: 'German',
    pattern: /\b(erstellen|korrigieren|hinzufügen|zeigen|verbessern|löschen|bitte|auch|Funktion|Datei|Fehler|danke|hallo)\b/i,
  },
  {
    lang: 'pt',
    flag: '🇧🇷',
    name: 'Portuguese',
    pattern: /\b(criar|corrigir|adicionar|mostrar|melhorar|excluir|por favor|também|função|arquivo|erro|obrigado|olá)\b/i,
  },
  {
    lang: 'it',
    flag: '🇮🇹',
    name: 'Italian',
    pattern: /\b(creare|correggere|aggiungere|mostrare|migliorare|eliminare|per favore|anche|funzione|file|errore|grazie|ciao)\b/i,
  },
  {
    lang: 'nl',
    flag: '🇳🇱',
    name: 'Dutch',
    pattern: /\b(maken|corrigeren|toevoegen|tonen|verbeteren|verwijderen|alsjeblieft|ook|functie|bestand|fout|bedankt|hallo)\b/i,
  },
  {
    lang: 'pl',
    flag: '🇵🇱',
    name: 'Polish',
    pattern: /\b(stworzyć|naprawić|dodać|pokazać|poprawić|usunąć|proszę|także|funkcja|plik|błąd|dziękuję|cześć)\b/i,
  },
  {
    lang: 'tr',
    flag: '🇹🇷',
    name: 'Turkish',
    pattern: /\b(oluştur|düzelt|ekle|göster|geliştir|sil|lütfen|ayrıca|fonksiyon|dosya|hata|teşekkür|merhaba)\b/i,
  },
  {
    lang: 'vi',
    flag: '🇻🇳',
    name: 'Vietnamese',
    pattern: /[độắễ]|\b(tạo|sửa|thêm|hiển thị|cải thiện|xóa|xin vui lòng|cũng|hàm|tệp|lỗi|cảm ơn|xin chào)\b/i,
  },
  {
    lang: 'id',
    flag: '🇮🇩',
    name: 'Indonesian',
    pattern: /\b(buat|perbaiki|tambah|tampilkan|hapus|tolong|juga|fungsi|berkas|kesalahan|terima kasih|halo|apa|ini|yang)\b/i,
  },
  {
    lang: 'ms',
    flag: '🇲🇾',
    name: 'Malay',
    pattern: /\b(buat|betulkan|tambah|tunjukkan|hapus|tolong|juga|fungsi|fail|ralat|terima kasih|helo|saya|anda)\b/i,
  },
]

// Ukrainian-specific characters (not in standard Russian)
const UKRAINIAN_CHARS = /[їіє]/

// Hinglish patterns (Latin-script Hindi/mixed)
const HINGLISH_PATTERNS = [
  /\b(kar[oa]|karo|karna|karta|karti|kar)\b/i,
  /\b(bana[oa]|banao|banana)\b/i,
  /\b(theek|thik)\b/i,
  /\b(dikhao|dekho|dikha)\b/i,
  /\b(likho|likhna)\b/i,
  /\b(add|delete|fix|check|test|build|run|start|stop)\s+(karo|karna|karo|kar)\b/i,
  /\b(mein|me|hai|hain|nahi|aur|ke|ka|ki|ko|se|par|wala|wali)\b/i,
  /\b(bohot|bahut|bilkul|sirf|bas|abhi|jaldi)\b/i,
]

// ── Main detector ──────────────────────────────────────────────────────────

/**
 * Full 20-language detector returning LanguageDetectionResult.
 */
export function detectLanguageFull(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return { detected: 'en', confidence: 1, isNative: true, flag: '🇺🇸', name: 'English', script: 'latin', isMixed: false }
  }

  // ── Step 1: Count Unicode script characters ──
  const scriptCounts: Partial<Record<SupportedLanguage, number>> = {}
  let jaCount = 0 // hiragana/katakana
  let cjkCount = 0

  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0
    for (const r of SCRIPT_RANGES) {
      if (cp >= r.start && cp <= r.end) {
        // Track Japanese kana separately
        if ((cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF)) {
          jaCount++
        }
        if (cp >= 0x4E00 && cp <= 0x9FFF) {
          cjkCount++
        }
        scriptCounts[r.lang] = (scriptCounts[r.lang] || 0) + 1
        break
      }
    }
  }

  const totalNonAscii = Object.values(scriptCounts).reduce((a, b) => a + (b ?? 0), 0)

  if (totalNonAscii > 2) {
    // ── CJK disambiguation: Japanese vs Chinese ──
    const hasCJK = (scriptCounts['zh'] || 0) + (scriptCounts['ja'] || 0) > 0
    if (hasCJK) {
      if (jaCount > 0) {
        // Has hiragana/katakana → Japanese
        const conf = Math.min(0.99, totalNonAscii / text.length + 0.5)
        return { detected: 'ja', confidence: conf, isNative: true, flag: '🇯🇵', name: 'Japanese', script: 'cjk', isMixed: false }
      } else {
        // Pure CJK → Chinese
        const conf = Math.min(0.99, totalNonAscii / text.length + 0.5)
        return { detected: 'zh', confidence: conf, isNative: true, flag: '🇨🇳', name: 'Chinese', script: 'cjk', isMixed: false }
      }
    }

    // ── Cyrillic disambiguation: Russian vs Ukrainian ──
    if (scriptCounts['ru'] && scriptCounts['ru'] > 0) {
      const isUkrainian = UKRAINIAN_CHARS.test(text)
      if (isUkrainian) {
        const conf = Math.min(0.99, totalNonAscii / text.length + 0.5)
        return { detected: 'uk', confidence: conf, isNative: true, flag: '🇺🇦', name: 'Ukrainian', script: 'cyrillic', isMixed: false }
      }
      const conf = Math.min(0.99, totalNonAscii / text.length + 0.5)
      return { detected: 'ru', confidence: conf, isNative: true, flag: '🇷🇺', name: 'Russian', script: 'cyrillic', isMixed: false }
    }

    // ── Other scripts (Arabic, Thai, Korean, Devanagari) ──
    const sorted = Object.entries(scriptCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    const [dominantLang, dominantCount] = sorted[0]
    const range = SCRIPT_RANGES.find(r => r.lang === dominantLang)
    const conf = Math.min(0.99, (dominantCount ?? 0) / text.length + 0.5)
    return {
      detected: dominantLang as SupportedLanguage,
      confidence: conf,
      isNative: true,
      flag: range?.flag || '🌐',
      name: range?.name || dominantLang,
      script: range?.script || 'other',
      isMixed: sorted.length > 1,
    }
  }

  // ── Step 2: Vocabulary patterns for Latin-script languages ──
  for (const vp of VOCAB_PATTERNS) {
    if (vp.pattern.test(text)) {
      const matches = text.match(vp.pattern)
      const matchCount = matches ? matches.length : 1
      const conf = Math.min(0.95, 0.6 + matchCount * 0.08)
      return {
        detected: vp.lang,
        confidence: conf,
        isNative: false,
        flag: vp.flag,
        name: vp.name,
        script: 'latin',
        isMixed: false,
      }
    }
  }

  // ── Step 3: Hinglish detection (Latin-script Hindi) ──
  let hinglishMatches = 0
  for (const pattern of HINGLISH_PATTERNS) {
    if (pattern.test(text)) hinglishMatches++
  }
  if (hinglishMatches >= 2) {
    return {
      detected: 'hi',
      confidence: Math.min(0.95, hinglishMatches * 0.15),
      isNative: false,
      flag: '🇮🇳',
      name: 'Hindi/Hinglish',
      script: 'latin',
      isMixed: true,
    }
  }

  // ── Default: English ──
  return { detected: 'en', confidence: 0.9, isNative: true, flag: '🇺🇸', name: 'English', script: 'latin', isMixed: false }
}

// ── Legacy API (backward compatible) ──────────────────────────────────────

const LEGACY_RANGES: Array<{ lang: LangCode; start: number; end: number; flag: string; label: string }> = [
  { lang: 'hi', start: 0x0900, end: 0x097F, flag: '🇮🇳', label: 'Hindi' },
  { lang: 'bn', start: 0x0980, end: 0x09FF, flag: '🇧🇩', label: 'Bengali' },
  { lang: 'pa', start: 0x0A00, end: 0x0A7F, flag: '🇮🇳', label: 'Punjabi' },
  { lang: 'gu', start: 0x0A80, end: 0x0AFF, flag: '🇮🇳', label: 'Gujarati' },
  { lang: 'mr', start: 0x0900, end: 0x097F, flag: '🇮🇳', label: 'Marathi' },
  { lang: 'ta', start: 0x0B80, end: 0x0BFF, flag: '🇮🇳', label: 'Tamil' },
  { lang: 'te', start: 0x0C00, end: 0x0C7F, flag: '🇮🇳', label: 'Telugu' },
  { lang: 'kn', start: 0x0C80, end: 0x0CFF, flag: '🇮🇳', label: 'Kannada' },
  { lang: 'ml', start: 0x0D00, end: 0x0D7F, flag: '🇮🇳', label: 'Malayalam' },
]

export function detectLanguage(text: string): DetectionResult {
  if (!text || text.trim().length === 0) {
    return { lang: 'en', confidence: 1, flag: '🇺🇸', label: 'English' }
  }

  // Count non-ASCII chars per script
  const counts: Record<string, number> = {}
  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0
    for (const r of LEGACY_RANGES) {
      if (cp >= r.start && cp <= r.end) {
        counts[r.lang] = (counts[r.lang] || 0) + 1
        break
      }
    }
  }

  const totalNonAscii = Object.values(counts).reduce((a, b) => a + b, 0)
  if (totalNonAscii > 2) {
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    const range = LEGACY_RANGES.find(r => r.lang === dominant[0])
    const confidence = Math.min(0.99, totalNonAscii / text.length + 0.5)
    return {
      lang: dominant[0] as LangCode,
      confidence,
      flag: range?.flag || '🇮🇳',
      label: range?.label || 'Indian',
    }
  }

  // Check Hinglish patterns
  let hinglishMatches = 0
  for (const pattern of HINGLISH_PATTERNS) {
    if (pattern.test(text)) hinglishMatches++
  }
  if (hinglishMatches >= 2) {
    return { lang: 'hinglish', confidence: Math.min(0.95, hinglishMatches * 0.15), flag: '🇮🇳', label: 'Hindi/Hinglish' }
  }

  return { lang: 'en', confidence: 0.9, flag: '🇺🇸', label: 'English' }
}
