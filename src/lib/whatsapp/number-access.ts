import type { SupabaseClient } from '@supabase/supabase-js'

import { hasMinRole, type AccountRole } from '@/lib/auth/roles'

/**
 * Per-number access levels (migration 059).
 *
 *   'full' — read and write (reply, assign, close, broadcast).
 *   'view' — read only.
 *
 * Owners and members in 'all' mode have 'full' on every number; members in
 * 'selected' mode have the level stored per number in
 * whatsapp_number_members (no row = no access). The account role is applied
 * on top: below 'agent' (viewer) is read-only everywhere.
 */
export type NumberAccessLevel = 'view' | 'full'

export interface NumberAccessEntry {
  id: string
  level: NumberAccessLevel
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parse an access list from a request body. Accepts the level-aware shape
 * `[{ id, level }]` or the legacy id list (every id = 'full'). Returns null
 * when the input is malformed. Duplicate ids keep the strongest level.
 */
export function parseNumberAccessList(
  levels: unknown,
  legacyIds?: unknown,
): NumberAccessEntry[] | null {
  const byId = new Map<string, NumberAccessLevel>()
  const add = (id: unknown, level: unknown): boolean => {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return false
    if (level !== 'view' && level !== 'full') return false
    const key = id.toLowerCase()
    if (byId.get(key) !== 'full') byId.set(key, level)
    return true
  }

  if (levels !== undefined && levels !== null) {
    if (!Array.isArray(levels)) return null
    for (const item of levels) {
      if (!item || typeof item !== 'object') return null
      const { id, level } = item as { id?: unknown; level?: unknown }
      if (!add(id, level)) return null
    }
  } else if (legacyIds !== undefined && legacyIds !== null) {
    if (!Array.isArray(legacyIds)) return null
    for (const id of legacyIds) {
      if (!add(id, 'full')) return null
    }
  }

  return [...byId.entries()].map(([id, level]) => ({ id, level }))
}

/** PostgREST errors meaning migration 059 (levels) is not applied yet. */
export function isMissingAccessLevelSupport(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST202' ||
    /access_level|set_member_whatsapp_number_access_levels/i.test(error.message ?? '')
  )
}

/**
 * The caller's effective level on each number in the account. Numbers the
 * caller cannot see at all are absent from the map.
 */
export async function loadMyNumberAccessLevels(args: {
  supabase: SupabaseClient
  userId: string
  accountId: string
  role: AccountRole
  numberIds: string[]
}): Promise<Map<string, NumberAccessLevel>> {
  const { supabase, userId, accountId, role, numberIds } = args
  const result = new Map<string, NumberAccessLevel>()
  if (numberIds.length === 0) return result
  const roleCanWrite = hasMinRole(role, 'agent')
  const cap = (level: NumberAccessLevel): NumberAccessLevel =>
    roleCanWrite ? level : 'view'

  if (role === 'owner') {
    for (const id of numberIds) result.set(id, cap('full'))
    return result
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_number_access_mode')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle()
  if ((profile?.whatsapp_number_access_mode ?? 'all') === 'all') {
    for (const id of numberIds) result.set(id, cap('full'))
    return result
  }

  let rows: Array<{ whatsapp_number_id: string; access_level?: string }> = []
  const withLevel = await supabase
    .from('whatsapp_number_members')
    .select('whatsapp_number_id, access_level')
    .eq('user_id', userId)
  if (withLevel.error && isMissingAccessLevelSupport(withLevel.error)) {
    // Before migration 059 every assignment is full access.
    const legacy = await supabase
      .from('whatsapp_number_members')
      .select('whatsapp_number_id')
      .eq('user_id', userId)
    rows = (legacy.data ?? []) as typeof rows
  } else {
    rows = (withLevel.data ?? []) as typeof rows
  }

  const wanted = new Set(numberIds)
  for (const row of rows) {
    if (!wanted.has(row.whatsapp_number_id)) continue
    result.set(row.whatsapp_number_id, cap(row.access_level === 'view' ? 'view' : 'full'))
  }
  return result
}

export class NumberWriteAccessError extends Error {
  constructor() {
    super('You have view-only access to this WhatsApp number')
    this.name = 'NumberWriteAccessError'
  }
}

/**
 * Throws NumberWriteAccessError unless the caller may write on the number.
 * Database policies enforce the same rule; this gives routes a clear 403
 * before any Meta API call is made.
 */
export async function assertNumberWriteAccess(args: {
  supabase: SupabaseClient
  userId: string
  accountId: string
  role: AccountRole
  numberId: string | null | undefined
}): Promise<void> {
  if (!args.numberId) return
  const levels = await loadMyNumberAccessLevels({ ...args, numberIds: [args.numberId] })
  if (levels.get(args.numberId) !== 'full') throw new NumberWriteAccessError()
}
