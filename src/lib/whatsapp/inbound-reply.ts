/**
 * Minimal webhook shape shared by Meta's two reply formats:
 *
 * - Template quick-reply buttons (including carousel cards) arrive as a
 *   top-level `button` message.
 * - Interactive button/list replies arrive under `interactive`.
 *
 * Normalising both shapes here keeps the webhook route and downstream flow /
 * automation matching independent of Meta's transport-specific structure.
 */
export interface MetaInboundReplyMessage {
  type: string
  button?: {
    payload?: string
    text?: string
  }
  interactive?: {
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
}

export interface ParsedInboundReply {
  contentText: string
  interactiveReplyId: string | null
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Return a display label and stable routing id for an inbound button tap. */
export function parseInboundReply(
  message: MetaInboundReplyMessage,
): ParsedInboundReply | null {
  if (message.type === 'button') {
    const text = clean(message.button?.text)
    const payload = clean(message.button?.payload)

    return {
      contentText: text ?? payload ?? '[Button reply]',
      // Meta normally supplies payload. Falling back to the visible text
      // keeps legacy templates routable when their webhook omits it.
      interactiveReplyId: payload ?? text,
    }
  }

  if (message.type === 'interactive') {
    const reply =
      message.interactive?.button_reply ?? message.interactive?.list_reply
    const id = clean(reply?.id)
    const title = clean(reply?.title)

    return {
      contentText: title ?? id ?? '[Interactive reply]',
      interactiveReplyId: id,
    }
  }

  return null
}
