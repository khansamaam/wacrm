import { describe, expect, it } from 'vitest'
import { parseInboundReply } from './inbound-reply'

describe('parseInboundReply', () => {
  it('normalizes a template or carousel quick-reply button', () => {
    expect(
      parseInboundReply({
        type: 'button',
        button: { text: 'Buy me', payload: 'BUY_ME' },
      }),
    ).toEqual({
      contentText: 'Buy me',
      interactiveReplyId: 'BUY_ME',
    })
  })

  it('falls back to button text when a legacy payload is absent', () => {
    expect(
      parseInboundReply({ type: 'button', button: { text: 'Call me' } }),
    ).toEqual({
      contentText: 'Call me',
      interactiveReplyId: 'Call me',
    })
  })

  it('normalizes an interactive button reply', () => {
    expect(
      parseInboundReply({
        type: 'interactive',
        interactive: {
          button_reply: { id: 'existing', title: 'Existing customer' },
        },
      }),
    ).toEqual({
      contentText: 'Existing customer',
      interactiveReplyId: 'existing',
    })
  })

  it('ignores ordinary inbound messages', () => {
    expect(parseInboundReply({ type: 'text' })).toBeNull()
  })
})
