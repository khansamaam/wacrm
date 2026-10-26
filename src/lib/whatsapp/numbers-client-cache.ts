'use client'

import type { WhatsAppNumber } from '@/types'

/**
 * Shared loader for `/api/whatsapp/numbers` in the browser.
 *
 * Many components mount `useWhatsAppNumbers()` / the sidebar status hook
 * on the same page; without this each one sent its own request (and the
 * route does several database round trips). Concurrent callers share one
 * in-flight request, and a result is reused for a few seconds.
 */
const TTL_MS = 10_000

let cached: { at: number; numbers: WhatsAppNumber[] } | null = null
let inFlight: Promise<WhatsAppNumber[]> | null = null

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
