import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../scripts/check-bundle-budget.mjs');

// An entry that exceeds the 32 KiB default even after gzip.
const oversizedDist = () => {
  const dist = mkdtempSync(join(tmpdir(), 'mss-budget-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<script src="/umi.abc.js"></script>');
  writeFileSync(join(dist, 'umi.abc.js'), randomBytes(48 * 1024).toString('base64'));
  return dist;
};

const run = (args: string[], env: Record<string, string> = {}) => {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) if (key.startsWith('MSS_V6_')) delete clean[key];
  return spawnSync(process.execPath, [script, '--dist', oversizedDist(), ...args], {
    env: { ...clean, ...env },
    encoding: 'utf8',
  });
};

describe('bundle budget defaults', () => {
  it('enforces the default ceilings for the reference application', () => {
    const result = run([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Bundle budget failed');
  });

  it('only warns for downstream hosts that did not set their own ceilings', () => {
    const result = run(['--advisory']);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Bundle budget warning');
  });

  it('enforces ceilings a downstream host sets explicitly', () => {
    expect(run(['--advisory'], { MSS_V6_ENTRY_GZIP_BUDGET_KB: '32' }).status).not.toBe(0);
    expect(run(['--advisory'], { MSS_V6_BUNDLE_BUDGET: 'enforce' }).status).not.toBe(0);
    expect(run(['--advisory'], { MSS_V6_ENTRY_GZIP_BUDGET_KB: '1024' }).status).toBe(0);
  });

  it('lets any build opt into warnings', () => {
    expect(run([], { MSS_V6_BUNDLE_BUDGET: 'warn' }).status).toBe(0);
  });
});
