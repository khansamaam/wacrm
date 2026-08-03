import { timingSafeEqual } from 'node:crypto';

/**
 * Authenticate the cron worker when an operator configured a secret.
 *
 * A secret-free deployment intentionally permits the GET kick. The endpoint
 * can only process recipient jobs that already exist in the database; it
 * cannot create broadcasts or recipients. Installations exposed to the public
 * internet should still configure a secret to prevent resource amplification.
 */
export function isBroadcastWorkerRequestAuthorized(
  request: Request,
  workerSecret = process.env.BROADCAST_WORKER_SECRET,
  automationSecret = process.env.AUTOMATION_CRON_SECRET
): boolean {
  const expected = workerSecret || automationSecret;
  if (!expected) return true;

  const supplied = request.headers.get('x-cron-secret') ?? '';
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
