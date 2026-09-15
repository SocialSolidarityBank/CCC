#!/usr/bin/env node
// compare-install-manifests.mjs — /install(stale)·/current 정본·로컬 재서명 manifest 의
// sha256Jcs 를 journal 의 runtimeManifestSha256·runtimeConfigurationSha256 와 대조한다.
// 값은 출력하지 않고 지문 앞 16자리와 일치 여부만 낸다.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const canon = value => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha = value => createHash('sha256').update(canon(value), 'utf8').digest('hex');
const load = async input => JSON.parse(
  input.trim().startsWith('{') ? input : await readFile(input, 'utf8'));

const current = await load(process.env.CCC_INSTALL_MANIFEST);
const stale = process.env.RELAYER_INSTALL_MANIFEST
  ? await load(process.env.RELAYER_INSTALL_MANIFEST) : null;
const renewed = await load(resolve(here, '../../artifacts/install/current/install-manifest.json'));

const runtimeConfigOf = manifest => {
  const {
    publishedAt: _p, expiresAt: _e, sequence: _s,
    signingKeyId: _k, ed25519Signature: _sig, ...rc
  } = manifest;
  return rc;
};

const JOURNAL_MANIFEST_SHA = 'd58c63b04169fc1fd0ac9b814c36c800c34eef7eb6bc3bd4953a7d9bc1738449';
const JOURNAL_CONFIG_SHA = 'b19b4475caeb7e89acb5f9e4a1d0a8d90e9f6de27f02d720dad9b98342b95e50';
const report = {};
for (const [name, doc] of Object.entries({ current, stale, renewed })) {
  if (!doc) { report[name] = null; continue; }
  report[name] = {
    manifestSha16: sha(doc).slice(0, 16),
    manifestMatchesJournal: sha(doc) === JOURNAL_MANIFEST_SHA,
    configSha16: sha(runtimeConfigOf(doc)).slice(0, 16),
    configMatchesJournal: sha(runtimeConfigOf(doc)) === JOURNAL_CONFIG_SHA,
    sequence: doc.sequence,
    installationId8: doc.installationId.slice(0, 8),
    engines: doc.approvedSttEngineIds,
  };
}
console.log(JSON.stringify(report));
