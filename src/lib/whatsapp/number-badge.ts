/**
 * Short, colour-coded identity for a WhatsApp number, shown when records
 * from several numbers are listed together ("All numbers").
 *
 * Owners can set `metadata.badge_label` / `metadata.badge_color` on the
 * number; otherwise the label is derived (initials of the number's label,
 * or the last four digits for a label that is just a phone number) and the
 * colour follows the number's position in the workspace's list.
 */

export const NUMBER_BADGE_COLORS = {
  emerald: '#10b981',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  teal: '#14b8a6',
  orange: '#f97316',
  indigo: '#6366f1',
} as const

export type NumberBadgeColor = keyof typeof NUMBER_BADGE_COLORS

export const NUMBER_BADGE_COLOR_KEYS = Object.keys(
  NUMBER_BADGE_COLORS,
) as NumberBadgeColor[]

export const MAX_BADGE_LABEL_LENGTH = 6

interface BadgeSource {
  id: string
  label: string
  display_phone_number?: string | null
  phone_number_id?: string
  metadata?: Record<string, unknown> | null
}

export function isNumberBadgeColor(value: unknown): value is NumberBadgeColor {
  return typeof value === 'string' && value in NUMBER_BADGE_COLORS
}

/** "BEAUTY FOR LESS CLINICS" → "BFL"; "+971 800 4526687" → "6687". */
export function deriveBadgeLabel(number: BadgeSource): string {
  const words = number.label.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []
  if (words.length > 0) {
    const initials = words.map((w) => w[0]).join('').toUpperCase()
    return initials.length >= 2
      ? initials.slice(0, 3)
      : (words[0] ?? '').slice(0, 3).toUpperCase()
  }
  const digits = (number.label + (number.display_phone_number ?? ''))
    .replace(/\D/g, '')
  return digits ? digits.slice(-4) : '#'
}

function hashColor(id: string): NumberBadgeColor {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return NUMBER_BADGE_COLOR_KEYS[hash % NUMBER_BADGE_COLOR_KEYS.length]
}

/**
 * `position` is the number's index in the workspace's number list (default
 * number first): automatic colours follow it so different numbers never
 * share a colour (for up to 8 numbers). Without it the colour is derived
 * from the id.
 */
export function numberBadge(number: BadgeSource, position = -1): {
  text: string
  color: string
  colorKey: NumberBadgeColor
} {
  const custom = number.metadata?.badge_label
  const text =
    typeof custom === 'string' && custom.trim()
      ? custom.trim().slice(0, MAX_BADGE_LABEL_LENGTH).toUpperCase()
      : deriveBadgeLabel(number)
  const colorKey = isNumberBadgeColor(number.metadata?.badge_color)
    ? number.metadata.badge_color
    : position >= 0
      ? NUMBER_BADGE_COLOR_KEYS[position % NUMBER_BADGE_COLOR_KEYS.length]
      : hashColor(number.id)
  return { text, color: NUMBER_BADGE_COLORS[colorKey], colorKey }
}
