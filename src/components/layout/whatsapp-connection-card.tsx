'use client'

import Link from 'next/link'
import { Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { WhatsAppConnectionStatus } from '@/hooks/use-whatsapp-connection-status'
import { cn } from '@/lib/utils'

interface WhatsAppConnectionCardProps {
  status: WhatsAppConnectionStatus
  canOpenSettings: boolean
  onNavigate?: () => void
}

/**
 * Compact workspace identity card shown directly above Dashboard.
 * It is informational for members and opens configuration only for the
 * Workspace Owner.
 */
export function WhatsAppConnectionCard({
  status,
  canOpenSettings,
  onNavigate,
}: WhatsAppConnectionCardProps) {
  const t = useTranslations('Sidebar')
  const numberLabel = status.loading
    ? t('whatsappLoading')
    : status.phoneNumber
      ? status.phoneNumber
      : t('whatsappNoNumber')
  const stateLabel = status.loading
    ? t('whatsappChecking')
    : status.connected
      ? t('whatsappConnected')
      : t('whatsappDisconnected')

  const content = (
    <>
      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Phone className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="text-foreground block truncate text-xs font-semibold"
          title={numberLabel}
        >
          {numberLabel}
        </span>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status.loading
                ? 'bg-muted-foreground animate-pulse'
                : status.connected
                  ? 'bg-emerald-400'
                  : 'bg-rose-400'
            )}
          />
          {stateLabel}
          {status.numberKind === 'id' ? ` · ${t('whatsappPhoneId')}` : null}
        </span>
      </span>
    </>
  )

  const className = cn(
    'border-border bg-background/45 mb-3 flex items-center gap-2.5 rounded-lg border px-2.5 py-2',
    canOpenSettings &&
      'hover:border-primary/35 hover:bg-primary/5 transition-colors'
  )

  if (canOpenSettings) {
    return (
      <Link
        href="/settings?tab=whatsapp"
        onClick={onNavigate}
        className={className}
        aria-label={t('whatsappOpenSettings', { number: numberLabel })}
      >
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}
