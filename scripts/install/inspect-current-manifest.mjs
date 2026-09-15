#!/usr/bin/env node
// inspect-current-manifest.mjs — Infisical /current 의 CCC_INSTALL_MANIFEST 원문에서
// engines·sequence·installationId·config sha 만 읽는다. 파일 우선 주입 전 원본을 본다.
import { createHash } from 'node:crypto';

const canon = value => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha = value => createHash('sha256').update(canon(value), 'utf8').digest('hex');
const doc = JSON.parse(process.env.CCC_INSTALL_MANIFEST);
const {
  publishedAt: _p, expiresAt: _e, sequence: _s,
  signingKeyId: _k, ed25519Signature: _sig, ...rc
} = doc;
console.log(JSON.stringify({
  manifestSha16: sha(doc).slice(0, 16),
  manifestMatchesJournal: sha(doc) === 'd58c63b04169fc1fd0ac9b814c36c800c34eef7eb6bc3bd4953a7d9bc1738449',
  configSha16: sha(rc).slice(0, 16),
  configMatchesJournal: sha(rc) === 'b19b4475caeb7e89acb5f9e4a1d0a8d90e9f6de27f02d720dad9b98342b95e50',
  sequence: doc.sequence,
  installationId8: doc.installationId.slice(0, 8),
  engines: doc.approvedSttEngineIds,
  publishedAt: doc.publishedAt,
}));
