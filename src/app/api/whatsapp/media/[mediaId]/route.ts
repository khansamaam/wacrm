import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session-user'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppNumber, WhatsAppNumberError } from '@/lib/whatsapp/numbers'

// Meta media ids are immutable, so downloaded bytes can be reused. Keeping
// recent files in memory skips the two Meta round trips (URL lookup +
// download) when the inbox re-renders the same images. Entries are keyed
// by number id as well, and only read after the caller's access to that
// number has been checked below.
const MEDIA_CACHE_MAX_BYTES = 150 * 1024 * 1024
const MEDIA_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024
const mediaCache = new Map<string, { buffer: Uint8Array; contentType: string }>()
let mediaCacheBytes = 0

function readMediaCache(key: string) {
  const hit = mediaCache.get(key)
  if (!hit) return null
  // Re-insert so Map order tracks recency (oldest first).
  mediaCache.delete(key)
  mediaCache.set(key, hit)
  return hit
}

function writeMediaCache(key: string, buffer: Uint8Array, contentType: string) {
  if (buffer.byteLength > MEDIA_CACHE_MAX_ENTRY_BYTES || mediaCache.has(key)) return
  mediaCache.set(key, { buffer, contentType })
  mediaCacheBytes += buffer.byteLength
  for (const [oldKey, entry] of mediaCache) {
    if (mediaCacheBytes <= MEDIA_CACHE_MAX_BYTES) break
    mediaCache.delete(oldKey)
    mediaCacheBytes -= entry.buffer.byteLength
  }
}

function mediaResponse(buffer: Uint8Array, contentType: string) {
  return new Response(buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Private: the proxy is session-gated, so shared caches (Cloudflare)
      // must not keep a copy. The browser may reuse it for a day.
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const user = await getSessionUser(supabase)

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const selectedNumberId = new URL(request.url).searchParams.get('number')
    let config
    try {
      config = await resolveWhatsAppNumber({
        supabase,
        accountId,
        whatsappNumberId: selectedNumberId,
      })
    } catch (error) {
      if (!(error instanceof WhatsAppNumberError)) throw error
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'not_accessible' ? 403 : 400 },
      )
    }
    if (!config.access_token) {
      return NextResponse.json({ error: 'WhatsApp access token is missing' }, { status: 400 })
    }
    const cacheKey = `${config.id}:${mediaId}`
    const cached = readMediaCache(cacheKey)
    if (cached) return mediaResponse(cached.buffer, cached.contentType)

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    const bytes = new Uint8Array(buffer)
    const type = contentType || mediaInfo.mimeType || 'application/octet-stream'
    writeMediaCache(cacheKey, bytes, type)
    return mediaResponse(bytes, type)
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
