import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  insertContactRow,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // chain to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string }>): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("returns a contact whose stored phone contains formatting", async () => {
    const db = stubDb([{ id: "c1", phone: "+971 50 151 0564" }]);
    const hit = await findExistingContact(db, "acct", "+971501510564");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });
});

describe("findExistingContact — per WhatsApp number (migration 060)", () => {
  function numberDb(
    rows: Array<Record<string, unknown>>,
    opts: { missingColumn?: boolean } = {},
  ) {
    const orCalls: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            like: () => {
              const all = Promise.resolve({ data: rows, error: null });
              return Object.assign(all, {
                or: (filter: string) => {
                  orCalls.push(filter);
                  return Promise.resolve(
                    opts.missingColumn
                      ? { data: null, error: { code: "42703", message: "column contacts.whatsapp_number_id does not exist" } }
                      : {
                          data: rows.filter(
                            (r) =>
                              r.whatsapp_number_id === "num-a" ||
                              r.whatsapp_number_id === null,
                          ),
                          error: null,
                        },
                  );
                },
              });
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    return { db, orCalls };
  }

  const rows = [
    { id: "on-b", phone: "+971501234567", whatsapp_number_id: "num-b" },
    { id: "unscoped", phone: "+971501234567", whatsapp_number_id: null },
    { id: "on-a", phone: "+971501234567", whatsapp_number_id: "num-a" },
  ];

  it("only considers the number's contacts and prefers them over unscoped ones", async () => {
    const { db, orCalls } = numberDb(rows);
    const found = await findExistingContact(db, "acct", "+971501234567", "num-a");
    expect(found?.id).toBe("on-a");
    expect(orCalls).toEqual(["whatsapp_number_id.eq.num-a,whatsapp_number_id.is.null"]);
  });

  it("falls back to an unscoped contact when the number has none", async () => {
    const { db } = numberDb(rows.filter((r) => r.id !== "on-a"));
    const found = await findExistingContact(db, "acct", "+971501234567", "num-a");
    expect(found?.id).toBe("unscoped");
  });

  it("never returns another number's contact", async () => {
    const { db } = numberDb([rows[0]]);
    expect(await findExistingContact(db, "acct", "+971501234567", "num-a")).toBeNull();
  });

  it("works before migration 060 (column missing) like before", async () => {
    const { db } = numberDb([rows[0]], { missingColumn: true });
    const found = await findExistingContact(db, "acct", "+971501234567", "num-a");
    expect(found?.id).toBe("on-b");
  });
});

describe("insertContactRow", () => {
  it("retries without whatsapp_number_id when the column does not exist yet", async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const db = {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  "whatsapp_number_id" in values
                    ? { data: null, error: { code: "PGRST204", message: "Could not find the 'whatsapp_number_id' column" } }
                    : { data: { id: "c1", phone: "1" }, error: null },
                ),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;
    const { data, error } = await insertContactRow(db, {
      phone: "1",
      whatsapp_number_id: "num-a",
    });
    expect(error).toBeNull();
    expect(data?.id).toBe("c1");
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("whatsapp_number_id");
  });
});
