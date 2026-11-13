#!/usr/bin/env node
// variant-sha.mjs — journal 의 runtimeConfigurationSha256 과 맞는
// runtimeConfiguration 변형을 찾는다. 값은 출력하지 않고 지문만 비교한다.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const load = async input => JSON.parse(
  input.trim().startsWith('{') ? input : await readFile(input, 'utf8'),
);
const manifest = await load(process.env.CCC_INSTALL_MANIFEST);
const {
  publishedAt: _p, expiresAt: _e, sequence: _s,
  signingKeyId: _k, ed25519Signature: _sig, ...runtimeConfig
} = manifest;

const canon = value => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha = value => createHash('sha256').update(canon(value), 'utf8').digest('hex');

const target = process.env.JOURNAL_CONFIG_SHA;
const variants = {
  asIs: runtimeConfig,
  enginesEmpty: { ...runtimeConfig, approvedSttEngineIds: [] },
  enginesAbsent: Object.fromEntries(
    Object.entries(runtimeConfig).filter(([key]) => key !== 'approvedSttEngineIds'),
  ),
  enginesNull: { ...runtimeConfig, approvedSttEngineIds: null },
};
for (const [name, variant] of Object.entries(variants)) {
  const digest = sha(variant);
  console.log(JSON.stringify({ variant: name, sha16: digest.slice(0, 16), match: digest === target }));
}
