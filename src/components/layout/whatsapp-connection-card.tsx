'use client'

import Link from 'next/link'
import { Check, ChevronsUpDown, Layers, Phone, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { WhatsAppConnectionStatus } from '@/hooks/use-whatsapp-connection-status'
import { useWhatsAppNumbers } from '@/hooks/use-whatsapp-numbers'
import type { WhatsAppNumber } from '@/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface WhatsAppConnectionCardProps {
  status: WhatsAppConnectionStatus
  canOpenSettings: boolean
  onNavigate?: () => void
}

/**
 * Compact workspace identity card shown directly above Dashboard.
 *
 * With one number it is informational (and opens settings for the
 * Workspace Owner). With several numbers it is the app-wide number
 * switcher: the choice drives the same selection the inbox, contacts,
 * dashboard, broadcasts and automations filters use. "All numbers" lists
 * every number with its connection status.
 */
export function WhatsAppConnectionCard({
  status,
  canOpenSettings,
  onNavigate,
}: WhatsAppConnectionCardProps) {
  const t = useTranslations('Sidebar')
  const { numbers, selectedNumber, setSelectedNumberId } = useWhatsAppNumbers()

  if (numbers.length > 1) {
    return (
      <NumberSwitcher
        numbers={numbers}
        selected={selectedNumber}
        onSelect={setSelectedNumberId}
        canOpenSettings={canOpenSettings}
        onNavigate={onNavigate}
        t={t}
      />
    )
  }

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
          {status.connectedCount > 1 ? ` · +${status.connectedCount - 1}` : null}
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

function numberText(number: WhatsAppNumber): string {
  return number.display_phone_number || number.phone_number_id
}

function StatusLine({
  number,
  t,
}: {
  number: WhatsAppNumber
  t: ReturnType<typeof useTranslations>
}) {
  const connected = number.status === 'connected'
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          connected ? 'bg-emerald-400' : 'bg-rose-400'
        )}
      />
      {connected ? t('whatsappConnected') : t('whatsappDisconnected')}
      {number.my_access_level === 'view' ? ` · ${t('whatsappViewOnly')}` : null}
    </span>
  )
}

function NumberSwitcher({
  numbers,
  selected,
  onSelect,
  canOpenSettings,
  onNavigate,
  t,
}: {
  numbers: WhatsAppNumber[]
  selected: WhatsAppNumber | null
  onSelect: (id: string | null) => void
  canOpenSettings: boolean
  onNavigate?: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="border-border bg-background/45 hover:border-primary/35 hover:bg-primary/5 mb-3 flex w-full flex-col gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
        aria-label={t('whatsappSwitchNumber')}
      >
        <span className="flex w-full items-center gap-2.5">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
            {selected ? <Phone className="size-4" /> : <Layers className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-xs font-semibold">
              {selected ? selected.label : t('whatsappAllNumbers')}
            </span>
            {selected ? (
              <span className="text-muted-foreground block truncate text-[11px]">
                {numberText(selected)}
              </span>
            ) : (
              <span className="text-muted-foreground block truncate text-[11px]">
                {t('whatsappNumbersCount', { count: numbers.length })}
              </span>
            )}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </span>
        {selected ? (
          <span className="pl-[42px]">
            <StatusLine number={selected} t={t} />
          </span>
        ) : (
          <span className="flex w-full flex-col gap-1.5 border-t pt-2">
            {numbers.map((number) => (
              <span key={number.id} className="min-w-0">
                <span className="text-foreground block truncate text-[11px] font-medium">
                  {numberText(number)}
                </span>
                <StatusLine number={number} t={t} />
              </span>
            ))}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onClick={() => onSelect(null)}>
          <Layers className="mr-2 size-4" />
          <span className="flex-1">{t('whatsappAllNumbers')}</span>
          {!selected && <Check className="size-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {numbers.map((number) => (
          <DropdownMenuItem key={number.id} onClick={() => onSelect(number.id)}>
            <span
              className={cn(
                'mr-2 size-2 shrink-0 rounded-full',
                number.status === 'connected' ? 'bg-emerald-400' : 'bg-rose-400'
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{number.label}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {numberText(number)}
              </span>
            </span>
            {selected?.id === number.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {canOpenSettings && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link href="/settings?tab=whatsapp" onClick={onNavigate} />}
            >
              <Settings className="mr-2 size-4" />
              {t('whatsappManageNumbers')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
