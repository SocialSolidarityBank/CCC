/**
 * 운영 배포 몰이꾼 (2026-08-01 Q 결정).
 *
 * **승인 게이트는 그대로 둔다.** 이 스크립트가 없애는 것은 사람이 눌러야 하는 클릭 중
 * *승인 하나를 뺀 전부*다 — 사전 점검 · 방아쇠 · 대기 감시 · 배포 후 확인. 승인은 "누가
 * 운영 배포를 허락했는가"의 유일한 증적이고, 그것을 대화 기록이 대신하지 못한다.
 *
 * 하는 일:
 *   1) preflight — 작업본이 origin/main 과 같은가 · main CI 가 초록인가 · 운영 D1 에
 *      미적용 마이그레이션이 없는가. 워크플로도 같은 것을 보지만, **여기서 먼저 보면
 *      승인을 기다리게 한 뒤에 떨어지는 낭비를 막는다.**
 *   2) 방아쇠 — workflow_dispatch (확인 문구 포함)
 *   3) 대기 감시 — 승인 대기에 걸리면 눌러야 할 주소를 정확히 찍어 준다
 *   4) 배포 후 — 시크릿 **이름** 존재 확인(값은 읽지 않는다) · 크론 재등록 안내
 *
 * `red` 이 스크립트는 **배포해도 되는지**를 판단하지 않는다. 보존·파기 파이프라인
 * 미구현(CLAUDE.md 8장)과 D46 재개 조건은 여전히 열려 있다. 스키마가 맞는 것과 실서비스를
 * 시작해도 되는 것은 다른 문제다.
 *
 * 사용: node scripts/deploy-production.mjs [--preflight-only]
 */
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verdict } from './deploy-verdict.mjs';

const execFileAsync = promisify(execFile);
const WORKFLOW = 'deploy-production.yml';
const CONFIRM_PHRASE = 'deploy-production';
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only');

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

// `wrangler deploy` 는 시크릿이 없어도 성공한다 — 워커가 런타임에 터질 뿐이다.
// 그래서 초록을 "동작한다"로 읽지 않고 **이름**을 직접 확인한다(값은 읽지 않는다).
try {
  const secrets = sh('pnpm', [
    '--filter', '@ccc/api', 'exec', 'wrangler', 'secret', 'list', '--env', 'production',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const names = [...secrets.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  console.log(`  운영 시크릿 이름 ${names.length}개: ${names.join(', ') || '(없음)'}`);
  if (!names.includes('PII_ENC_KEY')) {
    console.log('  `red` PII_ENC_KEY 가 없다 — 배포는 초록이어도 PII 경로가 런타임에 터진다.');
  }
} catch {
  console.log('  ⚠ 시크릿 이름 확인 실패 — wrangler 로그인 상태를 확인한다(배포 자체는 성공했다).');
}
console.log('  크론 재등록됨: */30(폴링 워치독 D8) · 0 3 * * *(PII 파기 D10)');
