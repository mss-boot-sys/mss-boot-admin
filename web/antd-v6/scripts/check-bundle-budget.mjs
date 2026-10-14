import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distArgument = process.argv.indexOf('--dist');
if (
  distArgument >= 0 &&
  (!process.argv[distArgument + 1] || process.argv[distArgument + 1].startsWith('--'))
) {
  throw new Error('--dist requires a path');
}
const distRoot = resolve(
  distArgument >= 0 ? process.argv[distArgument + 1] : join(projectRoot, 'dist'),
);
const productionGzipLevel = 6;
// The default ceilings are calibrated for this repository's reference
// application. A downstream Thin Host built through `mss-admin-web build`
// passes --advisory: its business code legitimately adds JavaScript, so the
// defaults only warn there. A host opts back into enforcement by setting any
// MSS_V6_*_GZIP_BUDGET_KB ceiling or MSS_V6_BUNDLE_BUDGET=enforce;
// MSS_V6_BUNDLE_BUDGET=warn makes any build advisory.
const budgetEnvNames = [
  'MSS_V6_ENTRY_GZIP_BUDGET_KB',
  'MSS_V6_CHUNK_GZIP_BUDGET_KB',
  'MSS_V6_TOTAL_JS_GZIP_BUDGET_KB',
];
const budgetMode = process.env.MSS_V6_BUNDLE_BUDGET;
if (budgetMode !== undefined && !['enforce', 'warn'].includes(budgetMode)) {
  throw new Error('MSS_V6_BUNDLE_BUDGET must be "enforce" or "warn"');
}
const advisory =
  budgetMode === 'warn' ||
  (budgetMode !== 'enforce' &&
    process.argv.includes('--advisory') &&
    budgetEnvNames.every((name) => process.env[name] === undefined));

const readBudget = (name, fallbackKiB) => {
  const value = process.env[name] === undefined ? fallbackKiB : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of KiB`);
  }
  return value * 1024;
};

const entryBudget = readBudget('MSS_V6_ENTRY_GZIP_BUDGET_KB', 32);
const chunkBudget = readBudget('MSS_V6_CHUNK_GZIP_BUDGET_KB', 240);
// The total is the complete lazy-loaded application corpus, not a route transfer.
// Keep route cost bounded independently through the entry and largest-chunk budgets,
// and retain enough corpus headroom for ordinary product growth between releases.
// The October dependency refresh measures 926.21 KiB in Admin and 932.18 KiB
// in the external business host; see the 2026-10-10 dependency-bundle ADR.
const totalBudget = readBudget('MSS_V6_TOTAL_JS_GZIP_BUDGET_KB', 940);
const formatKiB = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

const listJavaScript = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const target = join(directory, entry.name);
      return entry.isDirectory() ? listJavaScript(target) : target.endsWith('.js') ? [target] : [];
    }),
  );
  return files.flat();
};

const html = await readFile(join(distRoot, 'index.html'), 'utf8');
const entryMatch = html.match(/<script[^>]+src=["']([^"']*\/umi\.[^"']+\.js)["']/i);
if (!entryMatch) throw new Error('Unable to locate the hashed Umi entry script');

const entryPath = join(distRoot, entryMatch[1].replace(/^\//, ''));
const sizes = await Promise.all(
  (await listJavaScript(distRoot)).map(async (file) => ({
    file,
    gzip: gzipSync(await readFile(file), { level: productionGzipLevel }).byteLength,
  })),
);
const entry = sizes.find(({ file }) => file === entryPath);
if (!entry) throw new Error(`Entry script is missing: ${entryPath}`);

const asyncChunks = sizes.filter(({ file }) => file !== entryPath).sort((a, b) => b.gzip - a.gzip);
const largestChunk = asyncChunks[0];
const total = sizes.reduce((sum, item) => sum + item.gzip, 0);
const failures = [];

if (entry.gzip > entryBudget)
  failures.push(`entry ${formatKiB(entry.gzip)} > ${formatKiB(entryBudget)}`);
if (largestChunk && largestChunk.gzip > chunkBudget) {
  failures.push(
    `${relative(distRoot, largestChunk.file)} ${formatKiB(largestChunk.gzip)} > ${formatKiB(chunkBudget)}`,
  );
}
if (total > totalBudget)
  failures.push(`total JavaScript ${formatKiB(total)} > ${formatKiB(totalBudget)}`);

console.log(`Bundle entry: ${formatKiB(entry.gzip)}`);
console.log(`Total JavaScript: ${formatKiB(total)}`);
if (largestChunk) {
  console.log(
    `Largest async chunk: ${relative(distRoot, largestChunk.file)} (${formatKiB(largestChunk.gzip)})`,
  );
}
if (failures.length > 0) {
  if (advisory) {
    console.warn(
      `Bundle budget warning (advisory default ceilings): ${failures.join('; ')}. ` +
        'Set MSS_V6_ENTRY_GZIP_BUDGET_KB / MSS_V6_CHUNK_GZIP_BUDGET_KB / ' +
        'MSS_V6_TOTAL_JS_GZIP_BUDGET_KB to enforce ceilings for this host.',
    );
  } else {
    throw new Error(`Bundle budget failed: ${failures.join('; ')}`);
  }
}
