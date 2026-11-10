'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { loadWhatsAppNumbers, peekWhatsAppNumbers } from '@/lib/whatsapp/numbers-client-cache'
import type { WhatsAppNumber } from '@/types'

/** Last number chosen in any tab: the starting point for a new tab. */
const STORAGE_KEY = 'wacrm:selected-whatsapp-number'
/** This tab's own choice. sessionStorage is per tab, so tabs can work on
 *  different numbers side by side and a reload keeps the tab's number. */
const TAB_STORAGE_KEY = 'wacrm:selected-whatsapp-number:tab'
/** Same-tab broadcast so every mounted hook (sidebar switcher, inbox,
 *  dashboard, …) follows a selection change immediately. Deliberately not
 *  synced across tabs. */
const CHANGE_EVENT = 'wacrm:selected-whatsapp-number-change'

function readStoredSelection(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const tab = window.sessionStorage.getItem(TAB_STORAGE_KEY)
    // '' marks an explicit "All numbers" choice in this tab.
    if (tab !== null) return tab || null
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage is optional (private/sandboxed browsers may reject access).
    return null
  }
}

/** Accessible number list plus a per-tab, browser-persisted filter. */
export function useWhatsAppNumbers() {
  // Read the cached list and this tab's choice during the first render, so
  // the inbox's first conversations query already uses the right number
  // instead of firing unfiltered and then again once the list arrives.
  // The dashboard only renders on the client after login, so storage is
  // available here.
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>(
    () => peekWhatsAppNumbers() ?? [],
  )
  const [selectedNumberId, setSelectedState] = useState<string | null>(readStoredSelection)
  const [loading, setLoading] = useState(() => numbers.length === 0)

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string | null>).detail
      setSelectedState(detail ?? null)
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // The cached list (if any) is already showing; replace it with the
    // fresh one.
    void loadWhatsAppNumbers()
      .then((list) => {
        if (!cancelled) setNumbers(list)
      })
      .catch((error) => console.error('[use-whatsapp-numbers] load failed:', error))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Until the list first arrives, trust the stored choice rather than
  // dropping to "All numbers" and switching back a moment later.
  const validSelectedNumberId =
    selectedNumberId && (numbers.length === 0 ? loading : numbers.some((number) => number.id === selectedNumberId))
      ? selectedNumberId
      : null

  const setSelectedNumberId = useCallback((id: string | null) => {
    setSelectedState(id)
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, id ?? '')
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {}
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }))
  }, [])

  const selectedNumber = useMemo(
    () => numbers.find((number) => number.id === validSelectedNumberId) ?? null,
    [numbers, validSelectedNumberId],
  )

  return { numbers, selectedNumberId: validSelectedNumberId, selectedNumber, setSelectedNumberId, loading }
}
