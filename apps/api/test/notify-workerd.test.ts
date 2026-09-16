/**
 * 관리자 웹훅 발송의 workerd 계약 시험 (2026-09-16 운영 조용한 실패 회귀).
 *
 * notify.ts 의 웹훅 fetch 가 redirect:'error' 를 써 workerd 에서 항상 TypeError 로
 * 죽고 catch 가 "network error" 만 남겼다 — 크론 알림이 한 번도 나가지 않은 상태였다.
 * Node(undici) 시험은 이 차이를 못 잡으므로, supabase-workerd.test.ts 와 같은 방식으로
 * 실제 notifyAdmins 를 miniflare 안의 진짜 workerd 에서 돌린다. 웹훅 POST 는
 * fetchMock 이 가로채 본문까지 검사한다.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, createFetchMock } from 'miniflare';
import { build } from 'esbuild';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENTRY = fileURLToPath(new URL('./support/notify-workerd-entry.ts', import.meta.url));
const WEBHOOK_ORIGIN = 'https://hooks.workerd-test.invalid';
const WEBHOOK_PATH = '/services/notify';

let mf: Miniflare;
let persistDir: string;
let webhookBodies: string[];

beforeAll(async () => {
  persistDir = mkdtempSync(join(tmpdir(), 'ccc-workerd-notify-'));
  const bundled = await build({
    entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'neutral',
    target: 'es2022', write: false, absWorkingDir: REPO_ROOT,
  });

  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  webhookBodies = [];
  fetchMock.get(WEBHOOK_ORIGIN).intercept({ path: WEBHOOK_PATH, method: 'POST' })
    .reply(200, async (opts) => {
      // workerd 가 보낸 본문은 ReadableStream 으로 온다 — 문자열이 아니다.
      webhookBodies.push(await new Response(opts.body as BodyInit).text());
      return 'ok';
    }).persist();

  mf = new Miniflare({
    modules: true,
    script: bundled.outputFiles[0]!.text,
    compatibilityDate: '2026-07-06',
    bindings: { WEBHOOK_URL: `${WEBHOOK_ORIGIN}${WEBHOOK_PATH}` },
    fetchMock,
  });
}, 120_000);

afterAll(async () => {
  await mf?.dispose();
  rmSync(persistDir, { recursive: true, force: true });
});

describe('관리자 웹훅 발송 — workerd 런타임', () => {
  it('workerd 에서 웹훅 POST 가 실제로 나가고 본문에 알림이 담긴다', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(response.status).toBe(200);
    expect(webhookBodies).toHaveLength(1);
    expect(JSON.parse(webhookBodies[0]!)).toEqual({ text: '[WATCHDOG ALERT] workerd webhook probe' });
  });
});
