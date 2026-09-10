#!/usr/bin/env node
/**
 * Guard: No extensionless relative imports in packages compiled for Node ESM
 *
 * Node ESM with NodeNext moduleResolution requires explicit file extensions.
 * This script fails if any relative import lacks .js, .mjs, or .ts extension.
 *
 * Packages checked (Local Single service dependencies):
 * - packages/contracts/src
 * - adapters/audio-file/src
 * - adapters/scheduler-node/src
 * - adapters/secrets-dpapi/src
 * - adapters/db-sqlite/src
 * - apps/local-service/src
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const DIRS_TO_CHECK = [
  'packages/contracts/src',
  'adapters/audio-file/src',
  'adapters/scheduler-node/src',
  'adapters/secrets-dpapi/src',
  'adapters/db-sqlite/src',
  'apps/local-service/src',
];

// Match: from './foo' or from '../foo' without extension
// Must NOT end with .js, .mjs, .ts, .json
const EXTENSIONLESS_IMPORT = /from\s+['"](\.\.[^'"]*|\.\/[^'"]*[^.][^jmts][^son]*)['"]|from\s+['"](\.\.\/[^'"]+|\.\/[^'"]+)['"](?![.](js|mjs|ts|json))/g;

// Simpler: match relative imports and check if they have extensions
const RELATIVE_IMPORT = /from\s+['"](\.\.[^'"]*|\.\/[^'"]*)['"];?/g;

async function* walkTs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTs(path);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      yield path;
    }
  }
}

function hasExtension(importPath) {
  // Check if the import path ends with a known extension
  return /\.(js|mjs|ts|json)$/.test(importPath);
}

async function main() {
  const errors = [];

  for (const relDir of DIRS_TO_CHECK) {
    const dir = join(root, relDir);
    try {
      for await (const file of walkTs(dir)) {
        const content = await readFile(file, 'utf8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let match;
          const regex = /from\s+['"](\.\.[^'"]*|\.\/[^'"]*)['"];?/g;
          
          while ((match = regex.exec(line)) !== null) {
            const importPath = match[1];
            if (!hasExtension(importPath)) {
              const relFile = file.replace(root + '/', '');
              errors.push(`${relFile}:${i + 1}: extensionless relative import '${importPath}'`);
            }
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Directory doesn't exist, skip
    }
  }

  if (errors.length > 0) {
    console.error('ERROR: Found extensionless relative imports in Node ESM packages:');
    console.error('');
    for (const err of errors) {
      console.error(`  ${err}`);
    }
    console.error('');
    console.error('Node ESM requires explicit file extensions. Add .js to each import.');
    console.error('Example: from \'./foo\' → from \'./foo.js\'');
    process.exit(1);
  }

  console.log(`✓ guard-esm-imports: ${DIRS_TO_CHECK.length} directories checked, no extensionless imports found`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
