import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvCell } from './csv';

describe('csv export', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(3)).toBe('3');
  });

  it('neutralises spreadsheet formula injection', () => {
    for (const payload of ['=1+1', '+cmd', '-2', '@SUM(A1)']) {
      expect(escapeCsvCell(payload).startsWith(`'`)).toBe(true);
    }
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('builds header and rows with CRLF', () => {
    const csv = buildCsv(
      [
        { header: '账号', value: (row: { u: string }) => row.u },
        { header: 'n', value: () => null },
      ],
      [{ u: 'admin' }],
    );
    expect(csv).toBe('账号,n\r\nadmin,\r\n');
  });
});
