#!/usr/bin/env node
// diff-runtime-config.mjs — /current 정본 manifest 와 로컬 재서명 manifest 의
// runtimeConfiguration 필드(서명·시각·sequence 제외 13키) 차이만 보고한다.
// 값 자체는 출력하지 않고 필드 이름과 sha256 앞 12자리만 낸다.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const load = async input => JSON.parse(
  input.trim().startsWith('{') ? input : await readFile(input, 'utf8'),
);
const original = await load(process.env.CCC_INSTALL_MANIFEST);
const renewed = await load(resolve(here, '../../artifacts/install/current/install-manifest.json'));

const EXCLUDED = new Set(['publishedAt', 'expiresAt', 'sequence', 'signingKeyId', 'ed25519Signature']);
const digest = value => createHash('sha256')
  .update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 12);
const fields = [...new Set([...Object.keys(original), ...Object.keys(renewed)])]
  .filter(key => !EXCLUDED.has(key)).sort();
const diffs = fields
  .filter(key => JSON.stringify(original[key]) !== JSON.stringify(renewed[key]))
  .map(key => ({ field: key, originalSha12: digest(original[key]), renewedSha12: digest(renewed[key]) }));
console.log(JSON.stringify({
  runtimeConfigFields: fields,
  differingFields: diffs,
  originalSequence: original.sequence,
  renewedSequence: renewed.sequence,
  originalPublishedAt: original.publishedAt,
  renewedPublishedAt: renewed.publishedAt,
  originalExpiresAt: original.expiresAt,
  renewedExpiresAt: renewed.expiresAt,
}));
