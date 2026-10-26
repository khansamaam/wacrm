'use client'

import { useWhatsAppNumbers } from '@/hooks/use-whatsapp-numbers'
import { defaultScopeNumberId } from '@/components/whatsapp/number-scope-select'

/**
 * The WhatsApp number whose AI assistant the AI screens edit
 * (migration 062): the number selected in the sidebar, else the
 * workspace default. `query` is ready to append to /api/ai/* URLs.
 */
export function useAiNumberScope() {
  const { numbers, selectedNumberId, loading } = useWhatsAppNumbers()
  const numberId = defaultScopeNumberId(numbers, selectedNumberId)
  const number = numbers.find((n) => n.id === numberId) ?? null
  return {
    loading,
    numberId,
    number,
    /** True when more than one number exists (show which one is edited). */
    multiple: numbers.length > 1,
    query: numberId ? `?whatsapp_number_id=${encodeURIComponent(numberId)}` : '',
  }
}
