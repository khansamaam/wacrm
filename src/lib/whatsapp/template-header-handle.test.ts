import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Meta resumable upload so the helper is tested in isolation.
vi.mock('./meta-api', () => ({
  uploadResumableMedia: vi.fn(async () => ({ handle: 'HANDLE123' })),
}));

import {
  ensureImageHeaderHandle,
  ensureMediaHeaderHandle,
  resolveSampleContentType,
} from './template-header-handle';
import { uploadResumableMedia } from './meta-api';
import type { TemplatePayload } from './template-validators';

function payload(over: Partial<TemplatePayload> = {}): TemplatePayload {
  return {
    name: 't',
    category: 'Utility',
    language: 'en_US',
    body_text: 'hi',
    header_type: 'image',
    header_media_url: 'https://x.test/img.jpg',
    ...over,
  };
}

function imgResponse(type = 'image/jpeg', size = 1024, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as Response;
}

describe('ensureImageHeaderHandle', () => {
  beforeEach(() => {
    vi.mocked(uploadResumableMedia).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is a no-op for non-image headers', async () => {
    const p = payload({ header_type: 'text', header_content: 'Hi' });
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBeUndefined();
  });

  it('is a no-op when a handle already exists', async () => {
    const p = payload({ header_handle: 'existing' });
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBe('existing');
  });

  it('throws an actionable error when no Meta App ID is available', async () => {
    const p = payload();
    await expect(ensureImageHeaderHandle(p, 'tok')).rejects.toThrow(/Meta App ID/);
  });

  it('derives + sets header_handle from a valid image URL', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal('fetch', vi.fn(async () => imgResponse('image/jpeg', 2048)));
    const p = payload();
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).toHaveBeenCalledOnce();
    expect(p.header_handle).toBe('HANDLE123');
  });

  it('uses the per-number Meta App ID when provided', async () => {
    vi.stubEnv('META_APP_ID', '');
    vi.stubGlobal('fetch', vi.fn(async () => imgResponse('image/png', 2048)));
    const p = payload();
    await ensureImageHeaderHandle(p, 'tok', 'number-app-1');
    expect(uploadResumableMedia).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'number-app-1' }),
    );
  });

  it('rejects a non-image content type', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal('fetch', vi.fn(async () => imgResponse('text/html')));
    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(/JPEG or PNG/);
  });

  it('rejects an image over 5 MB', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal('fetch', vi.fn(async () => imgResponse('image/png', 6 * 1024 * 1024)));
    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(/5 MB/);
  });
});

describe('ensureMediaHeaderHandle — document and video headers', () => {
  function fileResponse(type: string, size = 2048) {
    return new Response(new Uint8Array(size), { status: 200, headers: { 'content-type': type } })
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uploads a PDF document sample and attaches the handle', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.mocked(uploadResumableMedia).mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => fileResponse('application/pdf')));
    const p = payload({ header_type: 'document', header_media_url: 'https://cdn.example.com/estimate.pdf' });
    await ensureMediaHeaderHandle(p, 'tok');
    expect(p.header_handle).toBe('HANDLE123');
    expect(vi.mocked(uploadResumableMedia)).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/pdf', fileName: 'header.pdf' }),
    );
  });

  it('uploads a video sample', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.mocked(uploadResumableMedia).mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => fileResponse('video/mp4')));
    const p = payload({ header_type: 'video', header_media_url: 'https://cdn.example.com/clip.mp4' });
    await ensureMediaHeaderHandle(p, 'tok');
    expect(vi.mocked(uploadResumableMedia)).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'video/mp4', fileName: 'header.mp4' }),
    );
  });

  it('treats a generic octet-stream PDF link as a PDF', async () => {
    expect(resolveSampleContentType('document', 'application/octet-stream', 'https://x/estimate.pdf')).toBe('application/pdf')
    expect(resolveSampleContentType('document', '', 'https://x/file')).toBe('application/pdf')
  })

  it('rejects a non-PDF document and an HTML page posing as a file', async () => {
    expect(() => resolveSampleContentType('document', 'application/msword', 'https://x/a.doc')).toThrow(/PDF/)
    expect(() => resolveSampleContentType('document', 'text/html', 'https://x/a.pdf')).toThrow(/PDF/)
  })

  it('accepts MP4 video samples', () => {
    expect(resolveSampleContentType('video', 'video/mp4', 'https://x/v')).toBe('video/mp4')
  })
})
