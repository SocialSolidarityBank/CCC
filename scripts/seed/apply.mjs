#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = {
  local: ['ccc-local', '--local'],
  preview: ['ccc-preview', '--env', 'preview', '--remote'],
};

const target = process.argv[2];
const targetArgs = Object.hasOwn(TARGETS, target) ? TARGETS[target] : undefined;
if (targetArgs === undefined || process.argv.length !== 3) {
  console.error('[seed] 지원 대상은 local 또는 preview뿐입니다. production에는 가상 시드를 적용할 수 없습니다.');
  process.exit(1);
}

const seedDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(seedDir, 'out', 'manifest.json'), 'utf8'));
if (manifest.profile !== 'preview' || manifest.target !== target) {
  console.error(`[seed] manifest가 ${target}용 preview 산출물이 아닙니다. 해당 seed:generate 명령으로 다시 생성하세요.`);
  process.exit(1);
}

for (const file of ['preload.sql', 'seed.sql', 'verify.sql']) {
  console.log(`\n== ${target}: ${file}`);
  execFileSync(
    'pnpm',
    ['--filter', '@ccc/api', 'exec', 'wrangler', 'd1', 'execute', ...targetArgs, '--file', join(seedDir, 'out', file)],
    { stdio: 'inherit' },
  );
}
