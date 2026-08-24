import { parseContactCsv } from '@/lib/contacts/parse-contact-csv';
import { dedupeByPhone, normalizeKey } from '@/lib/contacts/dedupe';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

export interface BroadcastCsvContact {
  phone: string;
  name?: string;
}

export interface BroadcastAudienceCsvResult {
  contacts: BroadcastCsvContact[];
  duplicateRows: number;
  invalidRows: number;
  hasPhoneColumn: boolean;
}

/**
 * Parse a broadcast audience CSV into the minimal contact shape used by the
 * broadcast wizard. Numbers are stored as digits-only E.164 values because
 * that is the format accepted by Meta and used by the application's phone
 * de-duplication logic.
 */
export function parseBroadcastAudienceCsv(
  source: string
): BroadcastAudienceCsvResult {
  // Spreadsheet exports may prefix the first header with a UTF-8 BOM.
  const text = source.replace(/^\uFEFF/, '');
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0] ?? '';
  const headers = header
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/["']/g, ''));
  const hasPhoneColumn = headers.includes('phone');

  if (!hasPhoneColumn) {
    return {
      contacts: [],
      duplicateRows: 0,
      invalidRows: Math.max(0, lines.length - 1),
      hasPhoneColumn: false,
    };
  }

  const parsed = parseContactCsv(text);
  const nonEmptyDataRows = lines.slice(1).filter((line) => line.trim()).length;
  // parseContactCsv drops rows with an empty phone cell.
  let invalidRows = Math.max(0, nonEmptyDataRows - parsed.rows.length);
  const validRows: BroadcastCsvContact[] = [];

  for (const row of parsed.rows) {
    const phone = normalizeKey(row.phone);
    if (!isValidE164(phone)) {
      invalidRows += 1;
      continue;
    }

    validRows.push({
      phone,
      name: row.name?.trim() || undefined,
    });
  }

  const { unique, duplicates } = dedupeByPhone(validRows);
  return {
    contacts: unique,
    duplicateRows: duplicates,
    invalidRows,
    hasPhoneColumn: true,
  };
}
