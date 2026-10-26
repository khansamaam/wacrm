'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useWhatsAppNumbers } from '@/hooks/use-whatsapp-numbers'
import { numberBadge } from '@/lib/whatsapp/number-badge'
import {
  OPEN_CONVERSATION_EVENT,
  PREF_CHANGE_EVENT,
  desktopNotificationsEnabled,
  dismissNotificationPrompt,
  messagePreview,
  notificationPermission,
  notificationPromptDismissed,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '@/lib/desktop-notifications'
import { Button } from '@/components/ui/button'

interface InboundMessageRow {
  id: string
  conversation_id: string
  sender_type: string
  content_type: string | null
  content_text: string | null
  message_origin?: string | null
  whatsapp_number_id?: string | null
}

interface ConversationInfo {
  name: string
  whatsappNumberId: string | null
}

/**
 * Shows a browser notification for every inbound customer message the
 * signed-in member can see (RLS scopes the realtime feed to their numbers),
 * on any dashboard page. Clicking it focuses the tab and opens the chat.
 * Skipped while that chat is open in a visible tab. Headless.
 */
export function DesktopMessageNotifier() {
  const router = useRouter()
  const { user } = useAuth()
  const { numbers, selectedNumberId, setSelectedNumberId } = useWhatsAppNumbers()

  // Latest values for the long-lived realtime callback.
  const latest = useRef({ numbers, selectedNumberId, setSelectedNumberId, router })
  useEffect(() => {
    latest.current = { numbers, selectedNumberId, setSelectedNumberId, router }
  })
  const conversationCache = useRef(new Map<string, ConversationInfo>())

  useEffect(() => {
    if (!user || notificationPermission() === 'unsupported') return
    const supabase = createClient()

    const loadConversation = async (convId: string): Promise<ConversationInfo> => {
      const cached = conversationCache.current.get(convId)
      if (cached) return cached
      const { data } = await supabase
        .from('conversations')
        .select('whatsapp_number_id, contact:contacts(name, phone)')
        .eq('id', convId)
        .maybeSingle()
      const contact = (Array.isArray(data?.contact) ? data?.contact[0] : data?.contact) as
        | { name?: string | null; phone?: string | null }
        | null
        | undefined
      const info = {
        name: contact?.name || contact?.phone || 'WhatsApp',
        whatsappNumberId: (data?.whatsapp_number_id as string | null | undefined) ?? null,
      }
      conversationCache.current.set(convId, info)
      return info
    }

    const openChat = (convId: string, numberId: string | null) => {
      window.focus()
      const { selectedNumberId: selected, setSelectedNumberId: select, router: nav } =
        latest.current
      if (window.location.pathname.startsWith('/inbox')) {
        window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: convId }))
        return
      }
      // Make sure the inbox filter shows the chat's number.
      if (selected && numberId && selected !== numberId) select(null)
      nav.push(`/inbox?c=${convId}`)
    }

    const onInsert = async (row: InboundMessageRow) => {
      if (row.sender_type !== 'customer') return
      if (row.message_origin === 'history_sync') return
      if (notificationPermission() !== 'granted' || !desktopNotificationsEnabled()) return

      const viewingThisChat =
        document.visibilityState === 'visible' &&
        window.location.pathname.startsWith('/inbox') &&
        new URLSearchParams(window.location.search).get('c') === row.conversation_id
      if (viewingThisChat) return

      const info = await loadConversation(row.conversation_id)
      const numberId = row.whatsapp_number_id ?? info.whatsappNumberId
      const list = latest.current.numbers
      const position = list.findIndex((n) => n.id === numberId)
      const tag = list.length > 1 && position >= 0
        ? `${numberBadge(list[position]!, position).text} · `
        : ''

      try {
        const notification = new Notification(`${tag}${info.name}`, {
          body: messagePreview(row),
          icon: '/icon.png',
          // One notification per chat: newer messages replace older ones.
          tag: `wacrm-${row.conversation_id}`,
          renotify: true,
        } as NotificationOptions & { renotify?: boolean })
        notification.onclick = () => {
          notification.close()
          openChat(row.conversation_id, numberId)
        }
      } catch (error) {
        console.warn('[desktop notifications] could not show notification:', error)
      }
    }

    const channel = supabase
      .channel(`desktop-notify-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'sender_type=eq.customer',
        },
        (payload) => void onInsert(payload.new as InboundMessageRow),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user])

  return null
}

/** One-time bar asking to allow desktop notifications. */
export function DesktopNotificationsPrompt() {
  const t = useTranslations('DesktopNotifications')
  const [state, setState] = useState<{
    permission: NotificationPermissionState
    dismissed: boolean
  } | null>(null)

  useEffect(() => {
    const read = () =>
      setState({
        permission: notificationPermission(),
        dismissed: notificationPromptDismissed(),
      })
    read()
    window.addEventListener(PREF_CHANGE_EVENT, read)
    return () => window.removeEventListener(PREF_CHANGE_EVENT, read)
  }, [])

  if (!state || state.permission !== 'default' || state.dismissed) return null

  return (
    <div className="border-border bg-primary/5 flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
      <Bell className="text-primary size-4 shrink-0" />
      <span className="text-foreground min-w-0 flex-1">{t('promptText')}</span>
      <Button size="sm" onClick={() => void requestNotificationPermission()}>
        {t('enable')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => dismissNotificationPrompt()}
        aria-label={t('notNow')}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}
