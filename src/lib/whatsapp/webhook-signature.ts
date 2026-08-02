import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   At least one candidate app secret is required. Multi-number workspaces
 *   can connect numbers from different Meta apps, so callers pass the
 *   per-number secret(s) resolved from the webhook payload. We fail closed
 *   when no secret is available.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  candidateSecrets: Array<string | null | undefined> = [process.env.META_APP_SECRET],
): boolean {
  const secrets = [
    ...new Set(
      candidateSecrets
        .map((secret) => secret?.trim())
        .filter((secret): secret is string => Boolean(secret)),
    ),
  ]
  if (secrets.length === 0) {
    console.error(
      '[webhook] No Meta App Secret is available for this webhook payload — rejecting request.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const a = Buffer.from(signatureHeader)
  return secrets.some((secret) => {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const b = Buffer.from(expected)
    // Bail if lengths differ — timingSafeEqual throws otherwise.
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  })
}
