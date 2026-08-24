import { describe, expect, it } from 'vitest';
import { parseBroadcastAudienceCsv } from './parse-audience-csv';

describe('parseBroadcastAudienceCsv', () => {
  it('normalizes valid contacts and keeps optional names', () => {
    const result = parseBroadcastAudienceCsv(`phone,name
+971 50 123 4567,Alice
14155550123,Bob`);

    expect(result).toEqual({
      contacts: [
        { phone: '971501234567', name: 'Alice' },
        { phone: '14155550123', name: 'Bob' },
      ],
      duplicateRows: 0,
      invalidRows: 0,
      hasPhoneColumn: true,
    });
  });

  it('removes normalized duplicates and reports invalid rows', () => {
    const result = parseBroadcastAudienceCsv(`phone,name
+971501234567,First
971 50 123 4567,Duplicate
invalid,Bad
,Missing`);

    expect(result.contacts).toEqual([{ phone: '971501234567', name: 'First' }]);
    expect(result.duplicateRows).toBe(1);
    expect(result.invalidRows).toBe(2);
  });

  it('accepts a UTF-8 BOM before the phone header', () => {
    const result = parseBroadcastAudienceCsv(
      '\uFEFFphone,name\n+14155550123,Alice'
    );

    expect(result.hasPhoneColumn).toBe(true);
    expect(result.contacts).toHaveLength(1);
  });

  it('rejects a CSV without a phone column', () => {
    const result = parseBroadcastAudienceCsv('name,email\nAlice,a@example.com');

    expect(result.hasPhoneColumn).toBe(false);
    expect(result.contacts).toEqual([]);
  });
});
