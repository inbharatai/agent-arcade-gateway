'use client'

import { useState, useCallback, useRef } from 'react'
import { detectLanguage } from '@/lib/i18n/detector'
import { normalizeHinglish } from '@/lib/i18n/normalizer'

export function useLanguage() {
  const [detection, setDetection] = useState<{ flag: string; label: string; normalized?: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const analyzeText = useCallback((text: string) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!text || text.trim().length < 5) { setDetection(null); return }
      const det = detectLanguage(text)
      if (det.lang !== 'en') {
        const { normalized, wasTranslated, originalLang } = normalizeHinglish(text)
        setDetection({ flag: det.flag, label: originalLang, normalized: wasTranslated ? normalized : undefined })
      } else {
        setDetection(null)
      }
    }, 300)
  }, [])

  const normalize = useCallback((text: string): string => {
    const { normalized } = normalizeHinglish(text)
    return normalized
  }, [])

  return { detection, analyzeText, normalize }
}
