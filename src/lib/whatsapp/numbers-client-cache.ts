'use client'

import type { WhatsAppNumber } from '@/types'

/**
 * Shared loader for `/api/whatsapp/numbers` in the browser.
 *
 * Many components mount `useWhatsAppNumbers()` / the sidebar status hook
 * on the same page; without this each one sent its own request (and the
 * route does several database round trips). Concurrent callers share one
 * in-flight request, and a result is reused for a few seconds.
 *
 * The last list is also kept in localStorage so number badges and the
 * number dropdown render immediately on the next page load, then refresh
 * in the background. It holds no tokens (the route returns sanitized
 * rows) and is cleared on sign-out.
 */
const TTL_MS = 10_000
const SNAPSHOT_KEY = 'wacrm:whatsapp-numbers-snapshot'

let cached: { at: number; numbers: WhatsAppNumber[] } | null = null
let inFlight: Promise<WhatsAppNumber[]> | null = null

function readSnapshot(): WhatsAppNumber[] | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as WhatsAppNumber[]) : null
  } catch {
    return null
  }
}

function writeSnapshot(numbers: WhatsAppNumber[]) {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(numbers))
  } catch {
    // Storage is optional (private/sandboxed browsers may reject access).
  }
}

/**
 * The most recent list without a network request: this session's result
 * if there is one, else the list saved from the previous visit. Null when
 * nothing is known yet.
 */
export function peekWhatsAppNumbers(): WhatsAppNumber[] | null {
  if (cached) return cached.numbers
  if (typeof window === 'undefined') return null
  return readSnapshot()
}

export function loadWhatsAppNumbers(options: { force?: boolean } = {}): Promise<WhatsAppNumber[]> {
  if (!options.force && cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.numbers)
  }
  if (!options.force && inFlight) return inFlight

  const request = fetch('/api/whatsapp/numbers', { cache: 'no-store' })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Failed to load WhatsApp numbers (${response.status})`)
      const numbers: WhatsAppNumber[] = Array.isArray(body.numbers) ? body.numbers : []
      cached = { at: Date.now(), numbers }
      writeSnapshot(numbers)
      return numbers
    })
    .finally(() => {
      if (inFlight === request) inFlight = null
    })
  inFlight = request
  return request
}

/** Drop the cached list, e.g. after a number was added or edited. */
export function invalidateWhatsAppNumbers() {
  cached = null
}

/** Forget everything, including the saved list (sign-out). */
export function clearWhatsAppNumbersCache() {
  cached = null
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY)
  } catch {}
}
