'use client'

import type { WhatsAppNumber } from '@/types'
import { numberBadge } from '@/lib/whatsapp/number-badge'
import { cn } from '@/lib/utils'

/**
 * Colour-coded short tag ("BFL") for the WhatsApp number a record belongs
 * to. Renders nothing for single-number workspaces, for unscoped rows, or
 * when `onlyWhenAll` is set and a specific number is already selected.
 */
export function NumberBadge({
  numberId,
  numbers,
  selectedNumberId = null,
  onlyWhenAll = true,
  className,
}: {
  numberId: string | null | undefined
  numbers: WhatsAppNumber[]
  selectedNumberId?: string | null
  onlyWhenAll?: boolean
  className?: string
}) {
  if (numbers.length <= 1 || !numberId) return null
  if (onlyWhenAll && selectedNumberId) return null
  const position = numbers.findIndex((n) => n.id === numberId)
  const number = numbers[position]
  if (!number) return null
  const { text, color } = numberBadge(number, position)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-bold leading-4 tracking-wide',
        className,
      )}
      style={{ color, backgroundColor: `${color}26`, boxShadow: `inset 0 0 0 1px ${color}55` }}
      title={`${number.label} · ${number.display_phone_number || number.phone_number_id}`}
    >
      {text}
    </span>
  )
}
