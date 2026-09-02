#!/usr/bin/env node
/**
 * Syntax check every source and test file.
 *
 * The package has no dependencies at all, runtime or development, so there is
 * no ESLint here. `node --check` is what the runtime itself would say about a
 * file, which is the check that actually matters before publishing, and it
 * costs nothing to run on every supported Node version in CI.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const roots = ['src', 'test', 'test-helpers', 'scripts'];

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (/\.(m|c)?js$/.test(entry.name)) yield path;
  }
}

let failed = 0;
let checked = 0;

for (const dir of roots) {
  for (const file of jsFiles(join(root, dir))) {
    checked += 1;
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
      failed += 1;
      process.stderr.write(`${relative(root, file)}\n${error.stderr?.toString() ?? error.message}\n`);
    }
  }
}

process.stdout.write(`Checked ${checked} files, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
