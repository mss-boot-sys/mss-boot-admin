#!/usr/bin/env node
/**
 * Frontend style guardrails (see AGENTS.md "Frontend conventions").
 *
 * 1. No inline `style={{…}}` / `style: {…}` in TSX. Data-driven values that
 *    cannot be expressed as classes (registry order, measured sizes) need a
 *    `style-guardrail-ignore: <reason>` comment within the 3 preceding lines.
 * 2. No Tailwind arbitrary `[var(--mss-…)]` classes; use the semantic
 *    utilities declared in src/tailwind.css (`text-fg-tertiary`, `bg-surface`).
 * 3. No raw hex colors outside the token sources (tokens.ts, styles/base.css).
 *
 * Generated code (src/generated) is checked by the generator's own tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['generated', '.umi', '.umi-production', '.umi-test']);
const HEX_ALLOW = new Set([
  'src/shared/design-system/tokens.ts',
  'src/shared/design-system/styles/base.css',
  // Normalizes operator-supplied theme colors; the literal is antd's default.
  'src/shared/theme/contract.ts',
]);
const INLINE_STYLE = /\bstyle=\{\{|\bstyle:\s*\{/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const ARBITRARY_VAR = /-\[var\(--mss-/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

export function checkFile(rel, text) {
  const problems = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`;
    if (rel.endsWith('.tsx') && INLINE_STYLE.test(line)) {
      const context = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
      if (!context.includes('style-guardrail-ignore:')) {
        problems.push(`${at} inline style; use a design-system class or token`);
      }
    }
    if (rel.endsWith('.tsx') && ARBITRARY_VAR.test(line)) {
      problems.push(`${at} arbitrary --mss-* class; add a semantic color in tailwind.css`);
    }
    if (!HEX_ALLOW.has(rel) && HEX.test(line.replace(/\/\/.*$/, ''))) {
      // Skip URL fragments such as href="#main".
      if (!/["'`]#[a-z][\w-]*["'`]/.test(line)) {
        problems.push(`${at} raw hex color; use --mss-* CSS variables or tokens.ts`);
      }
    }
  });
  return problems;
}

if (import.meta.url.startsWith('file:') && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(root, 'src');
  const problems = walk(src).flatMap((file) => {
    const rel = relative(root, file).split('\\').join('/');
    return checkFile(rel, readFileSync(file, 'utf8'));
  });
  if (problems.length) {
    console.error(`Style guardrails failed (${problems.length}):\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log('Style guardrails passed.');
}
