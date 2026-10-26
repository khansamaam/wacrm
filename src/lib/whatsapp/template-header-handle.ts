import { uploadResumableMedia } from '@/lib/whatsapp/meta-api';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE, VIDEO or DOCUMENT header —
 * a plain public URL is not accepted as the sample ("Missing Sample
 * Parameter"). These helpers turn the template's `header_media_url`
 * (whether the user uploaded a file or pasted a link) into a handle and
 * write it onto the payload.
 *
 * No-op unless the header is a media header that has a URL but no handle.
 */

type MediaHeaderType = 'image' | 'video' | 'document';

interface MediaRule {
  maxBytes: number;
  /** Accepted content types → file extension used for the upload. */
  types: Record<string, string>;
  /** Content type assumed when the server sends a generic one. */
  fallbackType: string;
  label: string;
}

// Meta's template-sample limits per header format.
const MEDIA_RULES: Record<MediaHeaderType, MediaRule> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    types: { 'image/jpeg': 'jpg', 'image/png': 'png' },
    fallbackType: 'image/jpeg',
    label: 'Header image must be JPEG or PNG',
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    types: { 'video/mp4': 'mp4', 'video/3gpp': '3gp' },
    fallbackType: 'video/mp4',
    label: 'Header video must be MP4 or 3GPP',
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    types: { 'application/pdf': 'pdf' },
    fallbackType: 'application/pdf',
    label: 'Header document must be a PDF',
  },
};

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
};

function isMediaHeader(value: unknown): value is MediaHeaderType {
  return value === 'image' || value === 'video' || value === 'document';
}

/**
 * Work out the sample's content type: the server's header when it is a
 * specific type, else the URL's file extension (many hosts serve PDFs as
 * application/octet-stream).
 */
export function resolveSampleContentType(
  headerType: MediaHeaderType,
  serverType: string,
  url: string,
): string {
  const rule = MEDIA_RULES[headerType];
  const type = serverType.split(';')[0].trim().toLowerCase();
  if (type in rule.types) return type;
  // A specific, different type (e.g. text/html from a login or error page)
  // is never the sample, whatever the URL's extension says.
  const generic = !type || type === 'application/octet-stream' || type === 'binary/octet-stream';
  if (!generic) throw new Error(`${rule.label} (got ${type}).`);
  let extension = '';
  try {
    extension = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
  } catch {
    extension = '';
  }
  const fromExtension = EXTENSION_TYPES[extension];
  if (fromExtension && fromExtension in rule.types) return fromExtension;
  return rule.fallbackType;
}

async function uploadHeaderSample(
  headerType: MediaHeaderType,
  url: string,
  accessToken: string,
  metaAppId?: string | null,
): Promise<string> {
  const rule = MEDIA_RULES[headerType];
  const appId = metaAppId?.trim() || process.env.META_APP_ID;
  if (!appId) {
    throw new Error(
      `${headerType[0].toUpperCase()}${headerType.slice(1)}-header templates need a Meta App ID for this WhatsApp number (used for Meta’s Resumable Upload). Add it in the number’s Meta settings, or remove the header.`
    );
  }

  // Fetch the sample bytes (works for our uploaded chat-media URL and for
  // a manually pasted public link).
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(
      `Could not fetch the header ${headerType} URL. Make sure it is publicly reachable.`
    );
  }
  if (!res.ok) {
    throw new Error(
      `Header ${headerType} URL returned ${res.status}. It must be publicly reachable.`
    );
  }

  const mimeType = resolveSampleContentType(
    headerType,
    res.headers.get('content-type') || '',
    url,
  );

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`Header ${headerType} is empty.`);
  }
  if (bytes.byteLength > rule.maxBytes) {
    throw new Error(
      `Header ${headerType} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`
    );
  }

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName: `header.${rule.types[mimeType]}`,
    mimeType,
    bytes,
  });
  return handle;
}

/** Upload the header sample (image, video or document) and attach its handle. */
export async function ensureMediaHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
  metaAppId?: string | null
): Promise<void> {
  if (!isMediaHeader(payload.header_type)) return;
  if (payload.header_handle) return; // already have one
  if (!payload.header_media_url) return; // validator already requires url-or-handle
  payload.header_handle = await uploadHeaderSample(
    payload.header_type,
    payload.header_media_url,
    accessToken,
    metaAppId,
  );
}

/**
 * @deprecated Kept for existing callers; handles every media header now
 * (the name predates document/video support).
 */
export const ensureImageHeaderHandle = ensureMediaHeaderHandle;

/** Upload every image/video card sample and attach its Meta creation handle. */
export async function ensureCarouselHeaderHandles(
  payload: TemplatePayload,
  accessToken: string,
  metaAppId?: string | null
): Promise<void> {
  if ((payload.template_type ?? 'standard') !== 'carousel') return;

  for (const card of payload.carousel_cards ?? []) {
    if (card.header_type !== 'image' && card.header_type !== 'video') continue;
    if (card.header_handle || !card.header_media_url) continue;
    card.header_handle = await uploadHeaderSample(
      card.header_type,
      card.header_media_url,
      accessToken,
      metaAppId,
    );
  }
}
