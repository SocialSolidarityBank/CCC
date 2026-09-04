/**
 * 미리보기 수동 배포 몰이꾼 (2026-09-04).
 *
 * 왜 스크립트인가. 2026-09-04 에 브랜치를 손으로 프리뷰에 올려 두고 검수를 맡겼는데, 그 사이
 * 다른 PR 셋이 main 에 머지되면서 Deploy Preview 워크플로가 프리뷰를 main 으로 세 번 덮어썼다.
 * 검수자는 "반영이 안 되고 옛 버전으로 회귀했다"로 읽었다. docs/ops.md 는 이미 "작업본이
 * origin/main 과 같은지 확인하라"고 적어 두었지만 사람이 그 줄을 건너뛰었다. 문서는 확률이고
 * 스크립트는 결정론이다(token-audit 과 같은 이유).
 *
 * 하는 일:
 *   1) 프리뷰가 비추는 것은 main 이다. HEAD 가 origin/main 과 다르면 **막는다.**
 *      브랜치를 굳이 올려야 하면 --branch 를 명시하고, 다음 main 푸시에 덮인다는 경고를
 *      받아들인 것으로 친다. 그 경우도 origin/main 을 품고 있어야 한다(뒤처진 브랜치는 막는다).
 *   2) 빌드 도장(NEXT_PUBLIC_CCC_BUILD_STAMP)을 워크플로와 같은 형식으로 찍는다.
 *      /preview 잠금 화면이 로그인 없이 그 도장을 보여 준다.
 *   3) api → web 순서로 배포한다(워크플로와 같다). 프리뷰 D1 마이그레이션은 여기서도
 *      먼저 적용한다(코드가 스키마보다 앞서면 런타임에서 터진다).
 *   4) 배포 뒤 /preview 를 받아 도장이 실렸는지 확인한다.
 *
 * 사용: node scripts/deploy-preview.mjs            (HEAD == origin/main 일 때만)
 *       node scripts/deploy-preview.mjs --branch   (브랜치 임시 프리뷰, 덮어쓰기 감수)
 *       node scripts/deploy-preview.mjs --preflight-only
 */
import { execFileSync } from 'node:child_process';

const PREVIEW_URL = 'https://ccc-preview.account-855.workers.dev/preview';
const BRANCH_MODE = process.argv.includes('--branch');
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only');

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
}

function run(command, args, env = {}) {
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
}

function fail(message, hint) {
  console.error(`\n사전 점검 실패 — ${message}`);
  if (hint !== undefined) console.error(`  ${hint}`);
  process.exit(1);
}

function step(label) {
  console.log(`\n== ${label}`);
}

// ── 1) 작업본이 무엇인가 ─────────────────────────────────────────────────────
step('사전 점검: 작업본');
sh('git', ['fetch', 'origin', '--quiet']);
if (sh('git', ['status', '--porcelain']).length > 0) {
  fail('커밋되지 않은 변경이 있다.', '배포는 작업본을 올린다. 커밋하거나 stash 한 뒤 다시 돌린다.');
}
const head = sh('git', ['rev-parse', 'HEAD']);
const main = sh('git', ['rev-parse', 'origin/main']);
const ref = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const behindMain = Number(sh('git', ['rev-list', '--count', `HEAD..origin/main`]));

if (head !== main && !BRANCH_MODE) {
  fail(
    `HEAD(${ref} ${head.slice(0, 7)})가 origin/main(${main.slice(0, 7)})과 다르다.`,
    '프리뷰는 main 을 비춘다. 브랜치 검수는 PR 을 머지하는 것이 곧 배포다. 임시로 올려야 하면 --branch 를 붙이되, 다음 main 푸시가 덮어쓴다.',
  );
}
if (behindMain > 0) {
  fail(
    `${ref} 가 origin/main 보다 ${behindMain} 커밋 뒤처져 있다.`,
    '뒤처진 브랜치를 올리면 main 의 다른 작업이 프리뷰에서 사라진다. origin/main 을 먼저 머지한다.',
  );
}
if (BRANCH_MODE) {
  console.log(`\n${'⚠'.repeat(3)} 브랜치 프리뷰다: ${ref} @ ${head.slice(0, 7)}`);
  console.log('   다음 main 푸시(Deploy Preview 워크플로)가 이 배포를 덮어쓴다. 검수자에게 도장을 알려 준다.');
}

const stamp = `${head === main ? 'main' : ref} @ ${head.slice(0, 7)} · ${new Date().toISOString().slice(0, 16)}Z`;
console.log(`빌드 도장: ${stamp}`);

if (PREFLIGHT_ONLY) {
  console.log('\n--preflight-only: 여기서 멈춘다.');
  process.exit(0);
}

// ── 2) 배포 ──────────────────────────────────────────────────────────────────
step('프리뷰 D1 마이그레이션');
run('pnpm', ['--filter', '@ccc/api', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'ccc-preview', '--env', 'preview', '--remote']);
step('API 배포 (ccc-api-preview)');
run('pnpm', ['--filter', '@ccc/api', 'exec', 'wrangler', 'deploy', '--env', 'preview']);
step('WEB 빌드 + 배포 (ccc-preview)');
run('pnpm', ['--filter', '@ccc/web', 'exec', 'opennextjs-cloudflare', 'build'], { NEXT_PUBLIC_CCC_BUILD_STAMP: stamp });
run('pnpm', ['--filter', '@ccc/web', 'exec', 'opennextjs-cloudflare', 'deploy', '--env', 'preview']);

// ── 3) 배포 후 확인 ──────────────────────────────────────────────────────────
step('배포 후 확인: 도장');
const response = await fetch(PREVIEW_URL, { headers: { 'cache-control': 'no-cache' } });
const html = await response.text();
if (!html.includes(head.slice(0, 7))) {
  fail(`${PREVIEW_URL} 에 도장(${head.slice(0, 7)})이 없다.`, '잠시 뒤 다시 받아 보고, 그래도 없으면 Actions 의 Deploy Preview 가 사이에 끼었는지 본다.');
}
console.log(`확인: ${PREVIEW_URL} 가 ${stamp} 를 서빙한다.`);
