'use client'

import type { WhatsAppNumber } from '@/types'
import { Label } from '@/components/ui/label'

/**
 * WhatsApp number a new record belongs to (contacts, tags, custom fields,
 * pipelines — migration 060). Renders nothing for single-number
 * workspaces; with `locked` it only shows the number (e.g. when editing).
 */
export function NumberScopeSelect({
  numbers,
  value,
  onChange,
  locked = false,
  label = 'WhatsApp number',
}: {
  numbers: WhatsAppNumber[]
  value: string | null
  onChange: (id: string) => void
  locked?: boolean
  label?: string
}) {
  if (numbers.length <= 1) return null
  const current = numbers.find((n) => n.id === value)
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {locked ? (
        <p className="text-muted-foreground text-sm">
          {current ? `${current.label} · ${current.display_phone_number || current.phone_number_id}` : '—'}
        </p>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="border-border bg-muted text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
        >
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} · {n.display_phone_number || n.phone_number_id}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/** Numbers the member may create records on (excludes view-only). */
export function writableNumbers(numbers: WhatsAppNumber[]): WhatsAppNumber[] {
  return numbers.filter((n) => n.my_access_level !== 'view')
}

/** Default number for a new record: the selected one if writable, else
 *  the workspace default, else the first writable number. */
export function defaultScopeNumberId(
  numbers: WhatsAppNumber[],
  selectedNumberId: string | null,
): string | null {
  const writable = writableNumbers(numbers)
  if (selectedNumberId && writable.some((n) => n.id === selectedNumberId)) {
    return selectedNumberId
  }
  return writable.find((n) => n.is_default)?.id ?? writable[0]?.id ?? null
}

/** Records visible for a number filter: that number's rows plus unscoped
 *  (NULL-number) rows; everything when no number is selected. */
export function matchesNumber(
  rowNumberId: string | null | undefined,
  numberId: string | null,
): boolean {
  return !numberId || !rowNumberId || rowNumberId === numberId
}
