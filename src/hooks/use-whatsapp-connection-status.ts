'use client'

import { useCallback, useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'

export interface WhatsAppConnectionStatus {
  loading: boolean
  configured: boolean
  connected: boolean
  phoneNumber: string | null
  numberKind: 'display' | 'id' | null
}

const INITIAL_STATUS: WhatsAppConnectionStatus = {
  loading: true,
  configured: false,
  connected: false,
  phoneNumber: null,
  numberKind: null,
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
      const response = await fetch('/api/whatsapp/status', {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`Status request failed: ${response.status}`)
      }

      const payload = (await response.json()) as Omit<
        WhatsAppConnectionStatus,
        'loading'
      >
      setStatus({ ...payload, loading: false })
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
          table: 'whatsapp_config',
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
