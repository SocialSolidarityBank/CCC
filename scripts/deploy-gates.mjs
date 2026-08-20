/**
 * 운영 배포 게이트 판정 (CCC-117 · P1-1, 2026-08-20 신설).
 *
 * 왜 파일을 따로 뺐나 — deploy-verdict.mjs 와 같은 이유다. deploy-production.mjs 는
 * 불러오는 순간 사전 점검을 돌리므로 테스트가 import 할 수 없다. 판정만 떼어 두면
 * 실제 wrangler 출력·HTTP 응답 모양으로 잰다(scripts/deploy-gates.test.mjs).
 *
 * 판정 3종 + 시크릿 검사:
 *   1) secretsVerdict  — 배포 **전** 필수 시크릿 **이름** 존재(값은 절대 읽지 않는다).
 *      `wrangler deploy` 는 시크릿이 없어도 성공한다 — 워커가 런타임에 터질 뿐이다.
 *      예전에는 배포 **후** 경고만 찍었다. 경고는 아무것도 막지 않으므로 배포 전 중단으로 올렸다.
 *      조회 자체가 실패한 것과 "이름이 없다"는 다른 사실이지만, **둘 다 배포를 막는다**(fail-closed).
 *   2) webSmokeVerdict / apiSmokeVerdict — 배포 **후** 런타임 확인. 웹은 살아 있어야 하고
 *      (200 또는 리다이렉트), API 는 무인증 요청이 **거부**돼야 한다(401/403 = fail-closed 증명,
 *      identity.ts 계약). API 가 무인증에 200 을 주면 그것이 최악의 사고다 — Access·JWT 게이트가
 *      꺼진 채 PII 경로가 열려 있다는 뜻이다.
 *   3) cronVerdict — 크론 재등록 확인. wrangler 배포는 [triggers].crons 를 다시 등록하는데,
 *      그 사실을 "그럴 것이다"가 아니라 출력에서 문자열로 확인한다.
 */

/**
 * 운영에 반드시 있어야 하는 시크릿 이름. 없으면 배포가 초록이어도 런타임에 터진다.
 *   PII_ENC_KEY — PII 봉투 암호화 키. 없으면 참여자 PII 경로 전체가 죽는다.
 * CODEX_API_KEY 는 넣지 않는다 — 유료 외부 AI 호출은 기본 OFF 이고(EXTERNAL_AI_CALLS_ENABLED),
 * 승인된 배포에만 있는 것이 정상이다(docs/ops.md).
 */
export const REQUIRED_PRODUCTION_SECRETS = ['PII_ENC_KEY'];

/** apps/api/src/cron-schedule.ts · apps/api/wrangler.toml [triggers].crons 와 일치해야 한다. */
export const REQUIRED_PRODUCTION_CRONS = ['*/30 * * * *', '0 3 * * *'];

/**
 * `wrangler secret list --env production` 출력에서 **이름만** 뽑아 필수 목록과 대조한다.
 *
 * @param {string} listOutput  wrangler 출력(JSON 배열이지만 배너가 섞일 수 있어 텍스트로 훑는다)
 * @param {string[]} required
 * @returns {{ok: boolean, names: string[], missing: string[], unreadable: boolean}}
 *   unreadable — 이름을 하나도 못 읽었다. "필수 시크릿이 없다"와 다른 사실이므로 갈라서 알린다
 *   (미적용 마이그레이션 판정과 같은 교훈, 2026-08-10). 둘 다 ok=false 다.
 */
export function secretsVerdict(listOutput, required = REQUIRED_PRODUCTION_SECRETS) {
  const names = [...String(listOutput ?? '').matchAll(/"name"\s*:\s*"([^"]+)"/g)]
    .map((match) => match[1]);
  if (names.length === 0) {
    return { ok: false, names, missing: [...required], unreadable: true };
  }
  const missing = required.filter((name) => !names.includes(name));
  return { ok: missing.length === 0, names, missing, unreadable: false };
}

/**
 * 웹 GET / 스모크. 살아 있으면 된다 — 200 또는 리다이렉트(3xx).
 * 리다이렉트를 허용하는 이유: Cloudflare Access·로그인 유도가 3xx 로 나올 수 있고,
 * 그것도 "워커가 응답한다"는 증거다. 5xx·연결 실패가 잡으려는 사고다.
 *
 * @param {number} status
 * @returns {{ok: boolean, reason?: string}}
 */
export function webSmokeVerdict(status) {
  if (status === 200) return { ok: true };
  if (status >= 300 && status < 400) return { ok: true };
  return { ok: false, reason: `웹 GET / 이 ${status} — 200 또는 3xx 가 아니다` };
}

/**
 * API 무인증 스모크. **거부돼야 통과다** (fail-closed 증명).
 *   401/403 — identity.ts 가 직접 거부 (헤더 없음 → 401, 디렉터리 밖 신원 → 403)
 *   3xx + cloudflareaccess.com — Access 가 요청을 가로채 로그인으로 보냄. API 에 닿기 전에
 *     막혔다는 뜻이므로 이것도 fail-closed 다.
 * 200 이 나오면 인증 게이트가 꺼진 채 열려 있다 — 이 스모크가 잡으려는 최악의 사고다.
 *
 * @param {number} status
 * @param {string} [location]  3xx 일 때의 Location 헤더
 * @returns {{ok: boolean, reason?: string}}
 */
export function apiSmokeVerdict(status, location = '') {
  if (status === 401 || status === 403) return { ok: true };
  if (status >= 300 && status < 400 && /cloudflareaccess\.com/i.test(location)) {
    return { ok: true };
  }
  if (status === 200) {
    return { ok: false, reason: '무인증 요청이 200 — 인증 게이트가 열려 있다. 즉시 복구한다.' };
  }
  return { ok: false, reason: `무인증 요청이 ${status} — 401/403(또는 Access 리다이렉트)이 아니다` };
}

/**
 * 크론 재등록 확인. `wrangler deployments list`(또는 triggers 계열) 출력에
 * 두 크론 문자열이 **둘 다** 보여야 통과다.
 *
 * @param {string} output
 * @param {string[]} required
 * @returns {{ok: boolean, missing: string[]}}
 */
export function cronVerdict(output, required = REQUIRED_PRODUCTION_CRONS) {
  const text = String(output ?? '');
  const missing = required.filter((cron) => !text.includes(cron));
  return { ok: missing.length === 0, missing };
}

/**
 * 스모크 실패 시 사람에게 찍어 줄 복구 절차 (docs/ops.md 운영 배포 절과 한 몸).
 * 롤백은 워커별이다 — API 는 named env(production), 웹은 최상위가 곧 운영이라 --env 가 없다
 * (--env production 을 붙이면 없는 환경을 찾는다, 배포 명령과 같은 함정).
 *
 * @returns {string[]}  줄 단위 안내
 */
export function rollbackGuidance() {
  return [
    '복구 절차 (둘 중 하나):',
    '  A. 직전 배포로 롤백:',
    '     pnpm --filter @ccc/api exec wrangler rollback --env production',
    '     pnpm --filter @ccc/web exec wrangler rollback',
    '  B. 이전 태그 재배포 (태그 목록은 docs/releases.md 이력 표):',
    '     gh workflow run deploy-production.yml --ref <이전태그> -f confirm=deploy-production',
    '  복구 후 같은 스모크로 다시 확인한다. 원인 규명 전에는 재배포하지 않는다.',
  ];
}
