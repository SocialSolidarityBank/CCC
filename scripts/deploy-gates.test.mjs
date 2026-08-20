/**
 * 배포 게이트 회귀 테스트 — 게이트가 **막아야 할 것을 막는지**를 고정한다 (CCC-117 · P1-1).
 *
 * 방향이 중요하다. 이 게이트들은 "위반이 없으면 통과"라서, 아무것도 못 잡는 상태와
 * 통과가 화면에서 구별되지 않는다(hierarchy-audit.test.mjs 와 같은 교훈). 그래서 아래는
 * 통과 케이스와 함께 **일부러 어긋난 입력을 넣고 빨간불이 뜨는지**를 반드시 본다.
 *
 * 실행: node scripts/deploy-gates.test.mjs   (pnpm guard:deploy-gates)
 */
import {
  secretsVerdict,
  webSmokeVerdict,
  apiSmokeVerdict,
  cronVerdict,
  rollbackGuidance,
  REQUIRED_PRODUCTION_SECRETS,
  REQUIRED_PRODUCTION_CRONS,
} from './deploy-gates.mjs';

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
};

// ---------------------------------------------------------------- secretsVerdict

// wrangler secret list 의 실제 출력 모양 — JSON 배열 앞뒤로 배너가 섞일 수 있다.
const 시크릿있음 = `
 ⛅️ wrangler 4.x
[
  { "name": "PII_ENC_KEY", "type": "secret_text" },
  { "name": "CODEX_API_KEY", "type": "secret_text" }
]`;
{
  const v = secretsVerdict(시크릿있음);
  check('필수 시크릿이 있으면 통과', v.ok === true && v.missing.length === 0);
  check('이름을 전부 읽는다', v.names.includes('PII_ENC_KEY') && v.names.includes('CODEX_API_KEY'));
}
{
  const v = secretsVerdict('[ { "name": "CODEX_API_KEY", "type": "secret_text" } ]');
  check('PII_ENC_KEY 누락이면 중단', v.ok === false && v.missing.includes('PII_ENC_KEY'));
  check('누락은 조회 실패가 아니다', v.unreadable === false);
}
{
  // 조회가 답을 안 줬다 — "시크릿이 없다"와 다른 사실이지만 똑같이 배포를 막는다.
  const v = secretsVerdict('');
  check('빈 출력이면 중단(fail-closed)', v.ok === false);
  check('빈 출력은 unreadable 로 갈린다', v.unreadable === true);
}
{
  const v = secretsVerdict('Error: not logged in');
  check('에러 텍스트여도 중단', v.ok === false && v.unreadable === true);
}
check('필수 목록에 PII_ENC_KEY 가 있다', REQUIRED_PRODUCTION_SECRETS.includes('PII_ENC_KEY'));

// ---------------------------------------------------------------- webSmokeVerdict

check('웹 200 통과', webSmokeVerdict(200).ok === true);
check('웹 302 통과(Access 로그인 유도도 살아 있다는 증거)', webSmokeVerdict(302).ok === true);
check('웹 500 이면 실패', webSmokeVerdict(500).ok === false);
check('웹 404 면 실패', webSmokeVerdict(404).ok === false);
check('웹 0(연결 실패)이면 실패', webSmokeVerdict(0).ok === false);

// ---------------------------------------------------------------- apiSmokeVerdict

check('API 무인증 401 = fail-closed 증명', apiSmokeVerdict(401).ok === true);
check('API 무인증 403 통과', apiSmokeVerdict(403).ok === true);
check(
  'Access 가로채기(302 → cloudflareaccess.com) 통과',
  apiSmokeVerdict(302, 'https://bss.cloudflareaccess.com/cdn-cgi/access/login/...').ok === true,
);
{
  // 최악의 사고 — 무인증 200. 이 한 줄이 이 스모크의 존재 이유다.
  const v = apiSmokeVerdict(200);
  check('API 무인증 200 이면 실패', v.ok === false);
  check('200 실패 사유가 게이트 열림을 말한다', /열려/.test(v.reason ?? ''));
}
check('엉뚱한 곳으로의 302 는 실패', apiSmokeVerdict(302, 'https://evil.example.com/').ok === false);
check('API 500 이면 실패', apiSmokeVerdict(500).ok === false);
check('API 0(연결 실패)이면 실패', apiSmokeVerdict(0).ok === false);

// ---------------------------------------------------------------- cronVerdict

const 크론둘다 = 'Trigger: schedule */30 * * * *\nTrigger: schedule 0 3 * * *';
check('크론 둘 다 보이면 통과', cronVerdict(크론둘다).ok === true);
{
  const v = cronVerdict('Trigger: schedule */30 * * * *');
  check('파기 크론이 빠지면 실패', v.ok === false && v.missing.includes('0 3 * * *'));
}
{
  const v = cronVerdict('');
  check('빈 출력이면 실패(둘 다 누락)', v.ok === false && v.missing.length === 2);
}
check(
  '필수 크론이 워치독·파기 둘이다 (cron-schedule.ts 와 일치)',
  REQUIRED_PRODUCTION_CRONS.includes('*/30 * * * *') && REQUIRED_PRODUCTION_CRONS.includes('0 3 * * *'),
);

// ---------------------------------------------------------------- rollbackGuidance

{
  const text = rollbackGuidance().join('\n');
  check('롤백 안내에 API 롤백 명령이 있다', text.includes('wrangler rollback --env production'));
  check('웹 롤백은 --env 가 없다', /wrangler rollback\s*$/m.test(text));
  check('이전 태그 재배포 경로를 안내한다', text.includes('--ref <이전태그>'));
}

// -------------------------------------------------------------------- 판정

if (failures.length > 0) {
  console.error(`deploy-gates 회귀 ${failures.length}건:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('deploy-gates 판정 회귀 없음.');
