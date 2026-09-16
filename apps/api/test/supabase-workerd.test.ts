/**
 * Supabase 사람 신원 레인의 workerd 계약 시험 (2026-09-16 운영 503 회귀).
 *
 * 왜 별도 파일인가: 기존 시험은 Node(undici)에서 돌아 verifier 의 JWKS fetch 옵션이
 * workerd 와 다른 런타임에서 깨지는 것을 잡지 못했다 — redirect:'error' 가 workerd 에
 * 없어 운영에서 IdentityStoreUnavailableError(503) 로 떨어진 사고가 그것이다.
 * 이 파일은 실제 워커 엔트리 배선(createWorkerSupabaseIdentity + adaptD1Environment)을
 * esbuild 로 묶어 miniflare 안의 진짜 workerd 에서 돌린다. outbound fetch 는
 * miniflare fetchMock 이 가로채므로 네트워크는 나가지 않는다.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, createFetchMock } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { build } from 'esbuild';
import { SQLITE_MIGRATIONS_PATH } from './support/d1';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = fileURLToPath(new URL('./support/supabase-workerd-entry.ts', import.meta.url));

const SUPABASE_ORIGIN = 'https://workerd-test.supabase.co';
const ISSUER = `${SUPABASE_ORIGIN}/auth/v1`;
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
const LINKED_SUB = '61f8457d-470d-4853-a681-1135027a523d';
const UNLINKED_SUB = '7b2c9e10-aaaa-4bbb-8ccc-ddddeeeeffff';
const USER_ID = 'workerd.counselor@example.invalid';
const ORG_ID = 'org_demo';

let pair: CryptoKeyPair;
let jwksBody: string;
let mf: Miniflare;
let persistDir: string;


function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function supabaseToken(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${encoded({ alg: 'ES256', kid: 'ec-one', typ: 'JWT' })}.${encoded({
    iss: ISSUER, aud: 'authenticated', sub, session_id: 'session-workerd', role: 'authenticated',
    is_anonymous: false, aal: 'aal1', email: 'worker@example.invalid',
    iat: now, exp: now + 3600,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'ec-one', alg: 'ES256', use: 'sig' };
  jwksBody = JSON.stringify({ keys: [jwk] });

  persistDir = mkdtempSync(join(tmpdir(), 'ccc-workerd-d1-'));
  // scriptPath 는 workerd 경로 샌드박스에 걸려 저장소 밖 파일을 못 연다 — 번들을 문자열로 넣는다.
  const bundled = await build({
    entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'neutral',
    target: 'es2022', write: false, absWorkingDir: REPO_ROOT,
  });
  const script = bundled.outputFiles[0]!.text;

  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  fetchMock.get(SUPABASE_ORIGIN).intercept({ path: JWKS_PATH, method: 'GET' })
    .reply(200, jwksBody, { headers: { 'content-type': 'application/json' } }).persist();

  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    d1Persist: persistDir,
    bindings: { SUPABASE_AUTH_ORIGIN: SUPABASE_ORIGIN },
    fetchMock,
  });

  const db = await mf.getD1Database('DB');
  const migrations = await readD1Migrations(SQLITE_MIGRATIONS_PATH);
  for (const migration of migrations) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  await db.prepare(
    `INSERT INTO users (id, org_id, email, role, active, time_zone, auth_subject)
     VALUES (?, ?, ?, 'counselor', 1, NULL, ?)`,
  ).bind(USER_ID, ORG_ID, USER_ID, LINKED_SUB).run();
}, 120_000);

afterAll(async () => {
  await mf?.dispose();
  rmSync(persistDir, { recursive: true, force: true });
});

describe('Supabase 신원 레인 — workerd 런타임', () => {
  it('workerd 에서 JWKS 를 가져와 디렉터리에 연결된 subject 를 사람 Actor 로 해석한다', async () => {
    const response = await mf.dispatchFetch('http://localhost/', {
      headers: { authorization: `Bearer ${await supabaseToken(LINKED_SUB)}` },
    });
    const result = await response.json() as { status: number; body: unknown };
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ userId: USER_ID, orgId: ORG_ID });
  });

  it('디렉터리에 연결되지 않은 subject 는 유효한 토큰이어도 workerd 에서 403 이다', async () => {
    const response = await mf.dispatchFetch('http://localhost/', {
      headers: { authorization: `Bearer ${await supabaseToken(UNLINKED_SUB)}` },
    });
    const result = await response.json() as { status: number; body: unknown };
    expect(result.status).toBe(403);
  });
});
