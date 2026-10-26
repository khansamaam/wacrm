import { describe, expect, it } from 'vitest'

import { deriveBadgeLabel, numberBadge, NUMBER_BADGE_COLORS } from './number-badge'

describe('number badge', () => {
  it('uses initials of the label', () => {
    expect(deriveBadgeLabel({ id: 'a', label: 'BEAUTY FOR LESS CLINICS' })).toBe('BFL')
    expect(deriveBadgeLabel({ id: 'a', label: 'Glamour Care' })).toBe('GC')
  })

  it('uses the first letters of a single-word label', () => {
    expect(deriveBadgeLabel({ id: 'a', label: 'Clinic' })).toBe('CLI')
  })

  it('uses the last four digits when the label is a phone number', () => {
    expect(deriveBadgeLabel({ id: 'a', label: '+971 800 4526687' })).toBe('6687')
  })

  it('prefers the owner-defined short name and colour', () => {
    const badge = numberBadge({
      id: 'a',
      label: 'BEAUTY FOR LESS CLINICS',
      metadata: { badge_label: 'bfl1', badge_color: 'rose' },
    })
    expect(badge).toEqual({ text: 'BFL1', color: NUMBER_BADGE_COLORS.rose, colorKey: 'rose' })
  })

  it('gives different numbers different automatic colours by list position', () => {
    expect(numberBadge({ id: 'a', label: 'x' }, 0).colorKey).toBe('emerald')
    expect(numberBadge({ id: 'b', label: 'y' }, 1).colorKey).toBe('sky')
  })

  it('picks a stable automatic colour per number', () => {
    const one = numberBadge({ id: 'cb69b599-90c7-4db3', label: 'x' })
    expect(numberBadge({ id: 'cb69b599-90c7-4db3', label: 'y' }).colorKey).toBe(one.colorKey)
  })
})
