import { afterEach, describe, expect, it } from 'vitest';

import { getPublicAppUrl } from './public-url';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalAllowedHosts = process.env.ALLOWED_INVITE_HOSTS;

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  process.env.ALLOWED_INVITE_HOSTS = originalAllowedHosts;
});

describe('getPublicAppUrl', () => {
  it('prefers the explicitly configured site URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com/';
    expect(
      getPublicAppUrl(new Request('http://localhost/api/invitations')),
    ).toBe('https://app.example.com');
  });

  it('uses reverse-proxy headers for a production tunnel', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.ALLOWED_INVITE_HOSTS = 'whatsapp.glamourcare.ae';
    const request = new Request('http://localhost/api/invitations', {
      headers: {
        'x-forwarded-host': 'whatsapp.glamourcare.ae',
        'x-forwarded-proto': 'https',
      },
    });

    expect(getPublicAppUrl(request)).toBe(
      'https://whatsapp.glamourcare.ae',
    );
  });

  it('rejects a forwarded host outside the allow-list', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.ALLOWED_INVITE_HOSTS = 'whatsapp.glamourcare.ae';
    const request = new Request('https://evil.example/api/invitations', {
      headers: {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
      },
    });

    expect(getPublicAppUrl(request)).toBe('https://wacrm.tech');
  });
});
