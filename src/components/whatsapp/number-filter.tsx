'use client'

import { Smartphone } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { WhatsAppNumber } from '@/types'

export function WhatsAppNumberFilter({
  numbers,
  value,
  onChange,
  allowAll = true,
  className,
}: {
  numbers: WhatsAppNumber[]
  value: string | null
  onChange(value: string | null): void
  allowAll?: boolean
  className?: string
}) {
  if (numbers.length <= 1) return null
  return (
    <Select value={value ?? '__all__'} onValueChange={(next) => onChange(next === '__all__' ? null : next)}>
      <SelectTrigger className={className ?? 'w-[220px]'}>
        <Smartphone className="mr-2 size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="__all__">All numbers</SelectItem>}
        {numbers.map((number) => (
          <SelectItem key={number.id} value={number.id}>
            {number.label} · {number.display_phone_number || number.phone_number_id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
