'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WhatsAppNumber } from '@/types'

const STORAGE_KEY = 'wacrm:selected-whatsapp-number'

/** Accessible number list plus a workspace-wide, browser-persisted filter. */
export function useWhatsAppNumbers() {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([])
  const [selectedNumberId, setSelectedState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) Promise.resolve().then(() => setSelectedState(stored))
    } catch {
      // Storage is optional (private/sandboxed browsers may reject access).
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/whatsapp/numbers', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Failed to load WhatsApp numbers')
        if (!cancelled) setNumbers(Array.isArray(body.numbers) ? body.numbers : [])
      })
      .catch((error) => console.error('[use-whatsapp-numbers] load failed:', error))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const validSelectedNumberId = selectedNumberId && numbers.some((number) => number.id === selectedNumberId)
    ? selectedNumberId
    : null

  const setSelectedNumberId = useCallback((id: string | null) => {
    setSelectedState(id)
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  const selectedNumber = useMemo(
    () => numbers.find((number) => number.id === validSelectedNumberId) ?? null,
    [numbers, validSelectedNumberId],
  )

  return { numbers, selectedNumberId: validSelectedNumberId, selectedNumber, setSelectedNumberId, loading }
}
