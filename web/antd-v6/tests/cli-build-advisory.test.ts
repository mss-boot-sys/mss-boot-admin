import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import packageManifest from '../package.json';

const cli = resolve(import.meta.dirname, '../bin/mss-admin-web.cjs');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function businessHost() {
  const root = mkdtempSync(join(tmpdir(), 'mss-admin-web-cli-'));
  dirs.push(root);
  const contract = packageManifest.mssAdminDistribution;
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'host',
      packageManager: contract.packageManager,
      pnpm: { overrides: contract.runtimeOverrides },
    }),
  );
  for (const file of [
    'config/config.ts',
    'src/app.tsx',
    'src/access.ts',
    'src/generated/routes.ts',
  ]) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), 'export {};\n');
  }
  // Record every child process the CLI starts instead of running Umi and the
  // dist checks, so the real CLI argument wiring is exercised end to end.
  const record = join(root, 'calls.jsonl');
  const preload = join(root, 'record-spawn.cjs');
  writeFileSync(
    preload,
    `const cp = require('node:child_process');
const fs = require('node:fs');
cp.spawnSync = (command, args) => {
  fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify([command, ...args]) + '\\n');
  return { status: 0 };
};
`,
  );
  return { root, record, preload };
}

describe('mss-admin-web build', () => {
  it('runs the bundle budget check in advisory mode for business hosts', () => {
    const { root, record, preload } = businessHost();
    const result = spawnSync(process.execPath, ['--require', preload, cli, 'build'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const calls = readFileSync(record, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toContain('build');
    expect(calls.slice(1).map((call) => basename(call[1] ?? ''))).toEqual([
      'check-runtime-bundle.mjs',
      'check-bundle-budget.mjs',
      'check-release-api.mjs',
    ]);
    const budget = calls.find((call) => (call[1] ?? '').endsWith('check-bundle-budget.mjs'));
    expect(budget).toEqual([
      process.execPath,
      expect.stringMatching(/check-bundle-budget\.mjs$/),
      '--dist',
      resolve(root, 'dist'),
      '--advisory',
    ]);
    for (const call of calls) {
      if ((call[1] ?? '').endsWith('check-bundle-budget.mjs')) continue;
      expect(call).not.toContain('--advisory');
    }
  });
});
