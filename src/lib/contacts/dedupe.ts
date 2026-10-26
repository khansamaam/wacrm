import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filter against the generated digits-only `phone_normalized`
 * column, then apply `phonesMatch` in JS for trunk-prefix tolerance. Querying
 * the normalized column is important: formatted stored values such as
 * "+971 50 151 0564" cannot match a raw digit suffix against `phone`.
 *
 * Contacts are separate per WhatsApp number (migration 060). With
 * `whatsappNumberId` only that number's contacts — plus unscoped legacy
 * contacts (NULL number), which the caller may claim — are considered, and
 * a contact on the number wins over an unscoped one.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  whatsappNumberId?: string | null,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const base = () =>
    db
      .from("contacts")
      .select("*")
      .eq("account_id", accountId)
      .like("phone_normalized", `%${suffix}`);

  let { data, error } = whatsappNumberId
    ? await base().or(
        `whatsapp_number_id.eq.${whatsappNumberId},whatsapp_number_id.is.null`,
      )
    : await base();
  if (error && whatsappNumberId && isMissingNumberColumn(error)) {
    // Migration 060 not applied yet: contacts are still workspace-wide.
    ({ data, error } = await base());
  }

  if (error || !data) return null;

  const matches = (data as ExistingContact[]).filter((c) =>
    phonesMatch(c.phone, phone),
  );
  if (whatsappNumberId) {
    return (
      matches.find((c) => c.whatsapp_number_id === whatsappNumberId) ??
      matches[0] ??
      null
    );
  }
  return matches[0] ?? null;
}

/** Postgres/PostgREST "column does not exist" for whatsapp_number_id. */
export function isMissingNumberColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /whatsapp_number_id/.test(message ?? "") && /does not exist|could not find/i.test(message ?? "")
  );
}

/**
 * Assign an unscoped legacy contact (NULL number) to `whatsappNumberId`
 * the first time it is used through that number. Best-effort: a no-op when
 * the contact is already scoped or the column does not exist yet.
 */
export async function claimContactForNumber(
  db: SupabaseClient,
  contact: ExistingContact,
  whatsappNumberId: string | null | undefined,
): Promise<void> {
  if (!whatsappNumberId) return;
  if (!("whatsapp_number_id" in contact) || contact.whatsapp_number_id) return;
  const { error } = await db
    .from("contacts")
    .update({ whatsapp_number_id: whatsappNumberId })
    .eq("id", contact.id)
    .is("whatsapp_number_id", null);
  if (!error) contact.whatsapp_number_id = whatsappNumberId;
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}

/**
 * Insert one contact and return it. `whatsapp_number_id` scopes the contact
 * to a number (migration 060); before that migration is applied the column
 * does not exist, so the insert is retried without it.
 */
export async function insertContactRow(
  db: SupabaseClient,
  values: Record<string, unknown>,
): Promise<{ data: ExistingContact | null; error: { code?: string; message: string } | null }> {
  const first = await db.from("contacts").insert(values).select().single();
  if (
    first.error &&
    "whatsapp_number_id" in values &&
    isMissingNumberColumn(first.error)
  ) {
    const { whatsapp_number_id: _omit, ...rest } = values;
    void _omit;
    const retry = await db.from("contacts").insert(rest).select().single();
    return { data: retry.data as ExistingContact | null, error: retry.error };
  }
  return { data: first.data as ExistingContact | null, error: first.error };
}
