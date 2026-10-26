import { describe, expect, it } from 'vitest'

import { messagePreview } from './desktop-notifications'

describe('messagePreview', () => {
  it('shows text messages as-is', () => {
    expect(messagePreview({ content_type: 'text', content_text: 'Hello' })).toBe('Hello')
  })

  it('labels media and keeps a caption', () => {
    expect(messagePreview({ content_type: 'image', content_text: null })).toBe('📷 Photo')
    expect(messagePreview({ content_type: 'image', content_text: 'Price?' })).toBe('📷 Photo: Price?')
    expect(messagePreview({ content_type: 'audio', content_text: null })).toBe('🎤 Voice message')
  })

  it('truncates long text', () => {
    const body = messagePreview({ content_type: 'text', content_text: 'x'.repeat(300) })
    expect(body.length).toBe(138)
    expect(body.endsWith('…')).toBe(true)
  })

  it('falls back for empty messages', () => {
    expect(messagePreview({ content_type: 'text', content_text: '  ' })).toBe('New message')
  })
})
