import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Compare webhook verification tokens without leaking where they differ.
 * Hashing first also gives timingSafeEqual fixed-length buffers.
 */
export function matchesWebhookVerifyToken(
  providedToken: string,
  configuredToken: string | undefined
): boolean {
  if (!providedToken || !configuredToken) return false

  const providedDigest = createHash('sha256').update(providedToken).digest()
  const configuredDigest = createHash('sha256').update(configuredToken).digest()

  return timingSafeEqual(providedDigest, configuredDigest)
}
