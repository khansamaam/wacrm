/**
 * Resolve the public application origin used in invitation links.
 *
 * Explicit configuration wins. Otherwise we trust the reverse proxy's
 * forwarded host, subject to the optional allow-list, and finally fall back
 * to the direct request host.
 */
export function getPublicAppUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const allowedHosts = parseAllowedHosts();
  const forwardedHost = firstHeaderValue(
    request.headers.get('x-forwarded-host'),
  );
  const forwardedProtocol =
    firstHeaderValue(request.headers.get('x-forwarded-proto')) || 'https';

  if (forwardedHost && isAllowed(forwardedHost, allowedHosts)) {
    return `${forwardedProtocol}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host && isAllowed(host, allowedHosts)) {
    return `${new URL(request.url).protocol}//${host}`;
  }

  console.warn('[public-url] could not resolve an allowed application host', {
    forwardedHost,
    host,
  });
  return 'https://wacrm.tech';
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;

  const hosts = raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : null;
}

function isAllowed(
  hostnameWithOptionalPort: string,
  allowedHosts: readonly string[] | null,
): boolean {
  if (!allowedHosts) return true;
  const hostname = hostnameWithOptionalPort.split(':')[0].toLowerCase();
  return allowedHosts.includes(hostname);
}
