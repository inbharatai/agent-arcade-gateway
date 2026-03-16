'use client'

import { useState, useCallback } from 'react'
import type { ModelOption, ProviderId } from '@/lib/providers/router'
import { MODEL_OPTIONS } from '@/lib/providers/router'

export function useProvider() {
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() => {
    if (typeof window === 'undefined') return MODEL_OPTIONS[0]
    try {
      const id = localStorage.getItem('arcade-console-model')
      return MODEL_OPTIONS.find(m => m.id === id) || MODEL_OPTIONS[0]
    } catch { return MODEL_OPTIONS[0] }
  })

  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('arcade-console-api-keys') || '{}') } catch { return {} }
  })

  const changeModel = useCallback((model: ModelOption) => {
    setSelectedModel(model)
    if (typeof window !== 'undefined') localStorage.setItem('arcade-console-model', model.id)
  }, [])

  const setApiKey = useCallback((provider: ProviderId, key: string) => {
    setApiKeys(prev => {
      const next = { ...prev, [provider]: key }
      if (typeof window !== 'undefined') localStorage.setItem('arcade-console-api-keys', JSON.stringify(next))
      return next
    })
  }, [])

  return { selectedModel, apiKeys, changeModel, setApiKey }
}
