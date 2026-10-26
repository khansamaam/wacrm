'use client'

import { Smartphone } from 'lucide-react'

import { useAiNumberScope } from '@/hooks/use-ai-number-scope'

/** "These AI settings apply to <number>" line for the AI screens. */
export function AiNumberScopeNotice() {
  const { number, multiple } = useAiNumberScope()
  if (!multiple || !number) return null
  return (
    <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
      <Smartphone className="size-3.5 shrink-0" />
      <span>
        AI assistant for <span className="text-foreground font-medium">{number.label}</span>
        {number.display_phone_number ? ` (${number.display_phone_number})` : ''}. Switch
        numbers in the sidebar to configure another number.
      </span>
    </div>
  )
}
