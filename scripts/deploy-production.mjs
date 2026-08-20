/**
 * 운영 배포 몰이꾼 (2026-08-01 Q 결정).
 *
 * **승인 게이트는 그대로 둔다.** 이 스크립트가 없애는 것은 사람이 눌러야 하는 클릭 중
 * *승인 하나를 뺀 전부*다 — 사전 점검 · 방아쇠 · 대기 감시 · 배포 후 확인. 승인은 "누가
 * 운영 배포를 허락했는가"의 유일한 증적이고, 그것을 대화 기록이 대신하지 못한다.
 *
 * 하는 일:
 *   1) preflight — 작업본이 origin/main 과 같은가 · main CI 가 초록인가 · 운영 D1 에
 *      미적용 마이그레이션이 없는가 · 필수 시크릿 **이름**이 있는가(값은 읽지 않는다,
 *      CCC-117). 워크플로도 대부분 같은 것을 보지만, **여기서 먼저 보면 승인을
 *      기다리게 한 뒤에 떨어지는 낭비를 막는다.**
 *   2) 방아쇠 — workflow_dispatch (확인 문구 포함)
 *   3) 대기 감시 — 승인 대기에 걸리면 눌러야 할 주소를 정확히 찍어 준다
 *   4) 배포 후 스모크 — 웹 GET / 살아 있음 · API 무인증 거부(fail-closed 증명) ·
 *      크론 재등록 확인. 하나라도 실패하면 종료 코드 비0 + 복구 절차를 찍는다(CCC-117)
 *
 * `red` 이 스크립트는 **배포해도 되는지**를 판단하지 않는다. 보존·파기 파이프라인
 * 미구현(CLAUDE.md 8장)과 D46 재개 조건은 여전히 열려 있다. 스키마가 맞는 것과 실서비스를
 * 시작해도 되는 것은 다른 문제다.
 *
 * 사용: node scripts/deploy-production.mjs [--preflight-only]
 */
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { verdict } from './deploy-verdict.mjs';
import {
  secretsVerdict,
  webSmokeVerdict,
  apiSmokeVerdict,
  cronVerdict,
  rollbackGuidance,
  REQUIRED_PRODUCTION_SECRETS,
} from './deploy-gates.mjs';

const execFileAsync = promisify(execFile);
const WORKFLOW = 'deploy-production.yml';
const CONFIRM_PHRASE = 'deploy-production';
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only');
// 운영 URL — workers.dev 를 그대로 쓴다(계정에 도메인 zone 없음, apps/api/wrangler.toml 주석).
const WEB_PRODUCTION_URL = 'https://ccc.account-855.workers.dev/';
const API_PRODUCTION_URL = 'https://ccc-api.account-855.workers.dev/';
// 크론 스모크(③)의 schedules API 조회에 쓴다. 계정 ID 는 wrangler whoami 로 공개 조회되는
// 값이라 시크릿이 아니다(위 URL 들과 같은 하드코딩 상수 취급).
const CLOUDFLARE_ACCOUNT_ID = '8855a07cd6da28d8f6120fa95081854e';

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}

function fail(message, hint) {
  console.error(`\n사전 점검 실패 — ${message}`);
  if (hint !== undefined) console.error(`  ${hint}`);
  process.exit(1);
}

function step(label) {
  console.log(`\n== ${label}`);
}

// ---------------------------------------------------------------- 1) preflight

step('1/4 사전 점검');

// 배포는 **기본 브랜치(main)의 워크플로 파일**로 돌고 그 ref 를 체크아웃한다. 로컬이
// main 과 다르면 "내가 방금 고친 것"이 아닌 다른 코드가 나간다 — 가장 헷갈리는 사고다.
sh('git', ['fetch', '--quiet', 'origin', 'main']);
const localHead = sh('git', ['rev-parse', 'HEAD']);
const originMain = sh('git', ['rev-parse', 'origin/main']);
if (localHead !== originMain) {
  const ahead = sh('git', ['rev-list', '--count', `origin/main..HEAD`]);
  const behind = sh('git', ['rev-list', '--count', `HEAD..origin/main`]);
  fail(
    `작업본이 origin/main 과 다르다 (앞선 커밋 ${ahead}개 · 뒤처진 커밋 ${behind}개).`,
    '운영에 나가는 것은 origin/main 이다. 머지·리베이스로 맞춘 뒤 다시 실행한다.',
  );
}
console.log(`  작업본 = origin/main (${localHead.slice(0, 7)})`);

// 버전은 세 곳에 같은 값으로 적혀 있어야 한다 (2026-08-11 Q 결정, docs/releases.md). 하나만
// 올리면 "지금 몇 버전인가"의 답이 파일마다 달라지고, 그때 태그가 어느 값을 가리키는지도 흐려진다.
// 문서에만 적은 규칙은 지켜지지 않으므로 배포가 막는다.
const VERSION_FILES = ['package.json', 'apps/web/package.json', 'apps/api/package.json'];
const versions = VERSION_FILES.map((file) => [
  file,
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).version,
]);
const version = versions[0][1];
if (versions.some(([, value]) => value !== version)) {
  fail(
    `버전이 파일마다 다르다 (${versions.map(([file, value]) => `${file}=${value}`).join(', ')}).`,
    '세 곳을 같은 값으로 맞춘 뒤 다시 실행한다. 규칙은 docs/releases.md.',
  );
}
console.log(`  버전 v${version} (세 곳 일치)`);

// main 의 최신 CI 가 초록인가. 워크플로도 자체 verify 를 돌리지만, 빨간 main 을 배포
// 방아쇠까지 끌고 가는 것 자체가 낭비다.
const ciRaw = sh('gh', [
  'run', 'list', '--branch', 'main', '--workflow', 'ci.yml',
  '--limit', '1', '--json', 'status,conclusion,headSha,url',
]);
const [latestCi] = JSON.parse(ciRaw);
if (latestCi === undefined) {
  fail('main 에서 CI 실행 기록을 찾지 못했다.', 'CI 워크플로 이름과 권한을 확인한다.');
}
if (latestCi.status !== 'completed' || latestCi.conclusion !== 'success') {
  fail(
    `main 최신 CI 가 초록이 아니다 (${latestCi.status}/${latestCi.conclusion ?? '-'}).`,
    latestCi.url,
  );
}
if (latestCi.headSha !== originMain) {
  console.log(`  ⚠ 최신 CI 가 현재 main 커밋이 아니다 (CI: ${latestCi.headSha.slice(0, 7)}). 워크플로가 다시 검증한다.`);
} else {
  console.log('  main 최신 CI 초록');
}

// 운영 D1 스키마. 워크플로의 schema-gate 와 **같은 판정**을 먼저 본다 — 여기서 걸리면
// 승인을 기다리게 한 뒤에 떨어지는 일이 없다.
let migrationsOutput = '';
try {
  migrationsOutput = sh('pnpm', [
    '--filter', '@ccc/api', 'exec', 'wrangler', 'd1', 'migrations', 'list', 'ccc',
    '--env', 'production', '--remote',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  migrationsOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`;
}
// `red` **조회 실패와 "미적용 있음"은 다른 사실이다** (2026-08-10 실측으로 갈랐다).
// 예전에는 둘을 한 갈래로 묶어, 조회가 한 번 흔들렸을 때 "미적용 마이그레이션이 있다"고
// 단언하고 **운영 D1 에 적용하라는 명령을 안내했다**. 그때 운영은 실제로 "No migrations to
// apply" 상태였다 — 안내대로 눌렀으면 없는 이유로 운영 스키마를 건드릴 뻔했다.
// 둘 다 배포를 막는 것은 같지만(fail-closed 유지), 사람에게 시키는 일이 정반대다.
const cleanMarker = /No migrations to apply|적용할 마이그레이션/i.test(migrationsOutput);
const pendingMarker = /\.sql\b/i.test(migrationsOutput); // 미적용 목록에는 파일명이 찍힌다
if (!cleanMarker && !pendingMarker) {
  fail(
    '운영 D1 마이그레이션 상태를 확인하지 못했다 (조회가 답을 주지 않았다).',
    '먼저 손으로 본다: pnpm --filter @ccc/api exec wrangler d1 migrations list ccc --env production --remote',
  );
}
if (!cleanMarker) {
  fail(
    '운영 D1 에 미적용 마이그레이션이 있다 (코드를 스키마보다 앞세우지 않는다).',
    '적용: pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc --env production --remote',
  );
}
console.log('  운영 D1 스키마 = 레포와 같음');

// 필수 시크릿 **이름** 검사 (CCC-117 · P1-1). `wrangler deploy` 는 시크릿이 없어도 성공한다 —
// 워커가 런타임에 터질 뿐이다. 예전에는 배포 **후** 경고만 찍었는데, 경고는 아무것도 막지
// 않는다. 배포 **전** 중단으로 올렸다. 값은 절대 읽지 않는다(이름만 본다).
// 조회 자체가 실패해도 중단한다 — "없다"와 "못 봤다"는 다른 사실이지만 둘 다 배포를 막는다.
let secretsOutput = '';
try {
  secretsOutput = sh('pnpm', [
    '--filter', '@ccc/api', 'exec', 'wrangler', 'secret', 'list', '--env', 'production',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  secretsOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`;
}
const secretGate = secretsVerdict(secretsOutput);
if (secretGate.unreadable) {
  fail(
    '운영 시크릿 이름을 조회하지 못했다 (없는 것과 다른 사실이지만, 확인 없이는 배포하지 않는다).',
    '먼저 손으로 본다: pnpm --filter @ccc/api exec wrangler secret list --env production (wrangler 로그인 확인)',
  );
}
if (!secretGate.ok) {
  fail(
    `필수 운영 시크릿이 없다: ${secretGate.missing.join(', ')} — 배포가 초록이어도 런타임에 터진다.`,
    `등록(값 stdout 금지): pnpm --filter @ccc/api exec wrangler secret put ${secretGate.missing[0]} --env production < 파일`,
  );
}
console.log(`  운영 시크릿 이름 확인 (필수 ${REQUIRED_PRODUCTION_SECRETS.join(', ')} 포함, ${secretGate.names.length}개)`);

console.log('\n  `red` 이 점검이 통과했다는 것은 **배포가 기술적으로 가능하다**는 뜻일 뿐이다.');
console.log('  보존·파기 파이프라인 미구현(CLAUDE.md 8장)과 D46 재개 조건은 그대로 열려 있다.');

if (PREFLIGHT_ONLY) {
  console.log('\n--preflight-only — 방아쇠는 당기지 않는다.');
  process.exit(0);
}

// ------------------------------------------------------------------ 2) 방아쇠

step('2/4 워크플로 실행');
const before = new Set(
  JSON.parse(sh('gh', ['run', 'list', '--workflow', WORKFLOW, '--limit', '20', '--json', 'databaseId']))
    .map((run) => run.databaseId),
);
sh('gh', ['workflow', 'run', WORKFLOW, '-f', `confirm=${CONFIRM_PHRASE}`]);
console.log('  실행 요청 보냄. 새 실행이 잡히기를 기다린다…');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function findNewRun() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(3000);
    const runs = JSON.parse(
      sh('gh', ['run', 'list', '--workflow', WORKFLOW, '--limit', '20', '--json', 'databaseId,url,status']),
    );
    const fresh = runs.find((run) => !before.has(run.databaseId));
    if (fresh !== undefined) return fresh;
  }
  return null;
}

const run = await findNewRun();
if (run === null) fail('새 실행을 찾지 못했다.', `gh run list --workflow ${WORKFLOW}`);
console.log(`  실행 ${run.databaseId} — ${run.url}`);

// ------------------------------------------------------------- 3) 대기 감시

step('3/4 검증·스키마 게이트 통과 대기');

/** 실행 상태와 잡 목록을 한 번에 읽는다 — 두 번 부르면 두 시점을 섞어 판정하게 된다. */
async function runState() {
  const { stdout } = await execFileAsync('gh', [
    'run', 'view', String(run.databaseId), '--json', 'status,conclusion,jobs',
  ]);
  return JSON.parse(stdout);
}

let announced = false;
let settled = false;
for (let tick = 0; tick < 400; tick += 1) {
  const state = await runState();
  const now = verdict(state);
  if (now.done) {
    if (now.error !== undefined) {
      console.error(`\n배포 실패 — ${now.error}`);
      console.error(`  ${run.url}`);
      process.exit(1);
    }
    settled = true;
    break;
  }
  if (!announced && now.waiting) {
    announced = true;
    console.log('\n  ──────────────────────────────────────────────');
    console.log('  사람이 할 일은 여기 하나다 — 승인 클릭.');
    console.log(`  ${run.url}`);
    console.log('  Review deployments → production 체크 → Approve and deploy');
    console.log('  ──────────────────────────────────────────────');
    console.log('\n  승인을 기다린다…');
  }
  await sleep(10000);
}

// 시간 초과와 성공이 구별되지 않으면 안 된다. 예전에는 루프가 끝까지 돌아도 그냥 아래
// "배포 성공"으로 떨어졌다 — 승인을 아무도 안 눌러 66분이 지난 것과 배포가 끝난 것이
// 화면에서 같은 문장이었다.
if (!settled) {
  console.error('\n대기 시간 초과 — 배포가 끝나지 않았다(승인이 안 눌렸을 가능성이 크다).');
  console.error(`  ${run.url}`);
  console.error('  승인 뒤 상태만 다시 보려면: gh run view <id> --json status,conclusion,jobs');
  process.exit(1);
}

// ------------------------------------------------------------- 4) 배포 후 확인

step('4/4 배포 후 확인');
console.log(`  배포 성공 — ${run.url}`);

// 기록은 배포 직후가 아니면 안 남는다 — 다음 배포가 오면 "지금 뭐가 올라가 있나"의 답이 덮인다.
console.log(`\n  이번 배포 = v${version} · ${originMain.slice(0, 7)}`);
console.log('  docs/releases.md 이력 표에 행을 더한다.');
console.log(`  번호를 올린 배포라면 태그도 단다: git tag -a v${version} ${originMain.slice(0, 7)} -m "운영 배포 v${version}" && git push origin v${version}`);
console.log('  번호를 안 올린 배포(문서·도구만)라면 태그는 다시 달지 않는다.');

// ── 배포 후 스모크 (CCC-117 · P1-1) ────────────────────────────────────────
// 초록 배포 ≠ 동작하는 서비스. 시크릿 이름은 배포 **전**에 이미 막았고(위 preflight),
// 여기서는 런타임을 직접 찌른다. 하나라도 실패하면 종료 코드 비0 — "배포는 성공했다"는
// 문장으로 끝나지 않는다. 실패는 다시 돌리면 되지만 거짓 성공은 안 되는 것을 된다고 믿게 만든다.

// 스모크 실패는 모아서 마지막에 한 번에 판정한다 — 첫 실패에서 멈추면 나머지 상태를 모른 채 복구하게 된다.
const smokeFailures = [];

// ① 웹이 살아 있는가 — GET / 이 200 또는 리다이렉트.
try {
  const webResponse = await fetch(WEB_PRODUCTION_URL, { redirect: 'manual' });
  const webVerdict = webSmokeVerdict(webResponse.status);
  if (webVerdict.ok) {
    console.log(`  스모크 ① 웹 GET / → ${webResponse.status} (살아 있음)`);
  } else {
    smokeFailures.push(`웹: ${webVerdict.reason}`);
  }
} catch (error) {
  smokeFailures.push(`웹: GET ${WEB_PRODUCTION_URL} 연결 실패 — ${error.message}`);
}

// ② API 가 무인증을 **거부**하는가 — 401/403(또는 Access 가로채기)이어야 통과다.
// 200 이 나오면 인증 게이트가 꺼진 채 PII 경로가 열려 있다는 뜻이다(fail-closed 증명, identity.ts).
try {
  const apiResponse = await fetch(API_PRODUCTION_URL, { redirect: 'manual' });
  const apiVerdict = apiSmokeVerdict(apiResponse.status, apiResponse.headers.get('location') ?? '');
  if (apiVerdict.ok) {
    console.log(`  스모크 ② API 무인증 → ${apiResponse.status} (fail-closed 확인)`);
  } else {
    smokeFailures.push(`API: ${apiVerdict.reason}`);
  }
} catch (error) {
  smokeFailures.push(`API: GET ${API_PRODUCTION_URL} 연결 실패 — ${error.message}`);
}

// ③ 크론이 다시 등록됐는가 — "그럴 것이다"가 아니라 등록 목록에서 문자열로 본다.
// `red` 재료는 schedules API 다(2026-08-21 v0.3.0 실측 정정). 처음에는 `wrangler
// deployments list` 를 읽었는데 그 출력에는 크론이 아예 없어 정상 배포를 항상
// 실패로 판정했다(CCC-117 미해결 노트가 경고한 그 함정). 조회에는
// CLOUDFLARE_API_TOKEN 이 필요하고, 없으면 확인 불가 = 실패다(fail-closed —
// "없다"와 "못 봤다"는 다른 사실이지만 둘 다 성공이 아니다).
let schedulesOutput = '';
if (process.env.CLOUDFLARE_API_TOKEN === undefined || process.env.CLOUDFLARE_API_TOKEN === '') {
  schedulesOutput = '';
} else {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/ccc-api/schedules`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } },
    );
    schedulesOutput = await response.text();
  } catch {
    schedulesOutput = '';
  }
}
const crons = cronVerdict(schedulesOutput);
if (crons.ok) {
  console.log('  스모크 ③ 크론 재등록 확인: */30(폴링 워치독 D8) · 0 3 * * *(PII 파기 D10)');
} else {
  smokeFailures.push(
    `크론: 등록 목록에서 ${crons.missing.join(' · ')} 를 확인하지 못했다 `
    + '(CLOUDFLARE_API_TOKEN 이 없으면 조회 자체가 불가 — 대시보드 Workers > ccc-api > Triggers 탭에서 직접 본다)',
  );
}

if (smokeFailures.length > 0) {
  console.error('\n배포 후 스모크 실패 — 배포는 올라갔지만 검증을 통과하지 못했다:');
  for (const failure of smokeFailures) console.error(`  ✗ ${failure}`);
  console.error('');
  for (const line of rollbackGuidance()) console.error(`  ${line}`);
  process.exit(1);
}
console.log('\n  스모크 3종 통과 — 배포 완료.');
