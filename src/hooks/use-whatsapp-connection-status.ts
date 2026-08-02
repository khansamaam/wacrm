'use client'

import { useCallback, useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'

export interface WhatsAppConnectionStatus {
  loading: boolean
  configured: boolean
  connected: boolean
  phoneNumber: string | null
  numberKind: 'display' | 'id' | null
  connectedCount: number
  totalCount: number
}

const INITIAL_STATUS: WhatsAppConnectionStatus = {
  loading: true,
  configured: false,
  connected: false,
  phoneNumber: null,
  numberKind: null,
  connectedCount: 0,
  totalCount: 0,
}

/**
 * Load the sanitized connection summary and refresh it whenever the shared
 * WhatsApp configuration changes.
 */
export function useWhatsAppConnectionStatus(
  accountId: string | undefined
): WhatsAppConnectionStatus {
  const [status, setStatus] =
    useState<WhatsAppConnectionStatus>(INITIAL_STATUS)

  const refresh = useCallback(async () => {
    if (!accountId) return

    try {
      const response = await fetch('/api/whatsapp/numbers', {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`Status request failed: ${response.status}`)
      }

      const payload = (await response.json()) as { numbers?: Array<{
        display_phone_number?: string | null
        phone_number_id: string
        status: string
        is_default: boolean
      }> }
      const numbers = payload.numbers ?? []
      const connected = numbers.filter((number) => number.status === 'connected')
      const primary = connected.find((number) => number.is_default) ?? connected[0] ?? numbers[0]
      setStatus({
        loading: false,
        configured: numbers.length > 0,
        connected: connected.length > 0,
        connectedCount: connected.length,
        totalCount: numbers.length,
        phoneNumber: primary?.display_phone_number || primary?.phone_number_id || null,
        numberKind: primary?.display_phone_number ? 'display' : primary ? 'id' : null,
      })
    } catch (error) {
      console.warn('[sidebar] Could not load WhatsApp status:', error)
      setStatus((current) => ({ ...current, loading: false }))
    }
  }, [accountId])

  useEffect(() => {
    if (!accountId) return

    void refresh()

    const supabase = createClient()
    const channel = supabase
      .channel(`sidebar-whatsapp-status-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_numbers',
          filter: `account_id=eq.${accountId}`,
        },
        () => void refresh()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [accountId, refresh])

  return status
}
