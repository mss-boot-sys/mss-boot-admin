import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations.
import { checkFile } from '../scripts/check-style-guardrails.mjs';

describe('style guardrails', () => {
  it('rejects inline styles and raw hex colors', () => {
    expect(checkFile('src/a.tsx', '<div style={{ color: "red" }} />')).toHaveLength(1);
    expect(checkFile('src/a.css', '.x { color: #fff; }')).toHaveLength(1);
    expect(checkFile('src/a.tsx', '<p className="text-[var(--mss-color-text)]" />')).toHaveLength(
      1,
    );
  });

  it('accepts annotated data-driven styles and token sources', () => {
    expect(
      checkFile(
        'src/a.tsx',
        '// style-guardrail-ignore: registry order\n<div style={{ order }} />',
      ),
    ).toEqual([]);
    expect(checkFile('src/shared/design-system/tokens.ts', "const a = '#3b5bfd';")).toEqual([]);
    expect(checkFile('src/a.tsx', '<a href="#main" />')).toEqual([]);
  });

  it('passes on the current source tree', () => {
    const script = resolve(import.meta.dirname, '../scripts/check-style-guardrails.mjs');
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).not.toThrow();
  });
});
