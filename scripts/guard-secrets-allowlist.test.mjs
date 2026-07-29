/**
 * 허용목록 회귀 테스트 — 오탐 2건은 계속 면제하되, 그 파일이 통째로 가려지지 않는지 고정한다.
 *
 * 왜 필요한가: gitleaks 는 `dir`/`file` 모드에서 전역 allowlist 의 `paths` 를
 * **파일 통째 제외**로 취급한다(`condition` 과 `regexes` 를 무시). 그래서 예전처럼
 * paths 를 쓰면 "이 값 2개를 봐준다" 가 아니라 "이 파일을 아예 안 본다" 가 되고,
 * 하필 그 대상이 자격증명이 실수로 들어가기 가장 쉬운 apps/api/wrangler.toml 이었다.
 * 룰이 0개일 때는 무해했지만 스캐너를 켜는 순간 함정이 되므로 값 기준으로 바꿨고,
 * 이 테스트가 그 결정을 지킨다.
 *
 * 실행: node scripts/guard-secrets-allowlist.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCESS_AUD = '3dbacf213494f7624c00676ce62742c414528997fd2a23c21e926c16d79404d2';
const TEST_PII_KEY = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';
// 기본 룰(github-pat)에 걸리는 값 — ghp_ 뒤 36자, entropy 검사를 통과하도록 무작위 배열.
// 실제 자격증명이 아니라 형식만 맞춘 더미다.
const PLANTED = 'ghp_NbrnTP3fAbnFbmOHnKYaXRvj7uff0LYTH8xI'; // gitleaks:allow

const probe = mkdtempSync(join(tmpdir(), 'ccc-allowlist-'));
const failures = [];

function scan() {
  const args = ['dir', '-c', join(probe, '.gitleaks.toml'), '--no-banner', '--redact', '-f', 'json', '-r', '-', probe];
  const r = spawnSync('gitleaks', args, { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') {
    console.error('허용목록 테스트 건너뜀 불가: gitleaks 가 없다. 설치: brew install gitleaks');
    process.exit(1);
  }
  // gitleaks exit code: 0 = no leaks, 1 = leaks found, 그 외 = 실행 자체 실패.
  if (r.status !== 0 && r.status !== 1) {
    console.error(`허용목록 테스트 실패: gitleaks 가 비정상 종료했다 (exit ${r.status}).`);
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  try {
    return JSON.parse(r.stdout || '[]');
  } catch {
    console.error('허용목록 테스트 실패: gitleaks 출력이 JSON 으로 파싱되지 않는다.');
    console.error(r.stdout);
    process.exit(1);
  }
}

try {
  copyFileSync(join(repoRoot, '.gitleaks.toml'), join(probe, '.gitleaks.toml'));

  mkdirSync(join(probe, 'apps/api/test/support'), { recursive: true });
  // 허용목록이 면제해야 하는 값 2개
  writeFileSync(join(probe, 'apps/api/wrangler.toml'), `ACCESS_AUD = "${ACCESS_AUD}"\n`);
  writeFileSync(join(probe, 'apps/api/test/support/d1.ts'), `export const TEST_PII_KEY = '${TEST_PII_KEY}';\n`);

  const clean = scan();
  if (clean.length > 0) {
    failures.push(`오탐 2건이 면제되지 않았다: ${clean.map((f) => f.File).join(', ')}`);
  }

  // 같은 파일에 '면제 대상이 아닌' 값을 심는다 — 반드시 잡혀야 한다.
  writeFileSync(
    join(probe, 'apps/api/wrangler.toml'),
    `ACCESS_AUD = "${ACCESS_AUD}"\nSOME_TOKEN = "${PLANTED}"\n`,
  );
  const planted = scan();
  const caught = planted.some((f) => String(f.File).endsWith('wrangler.toml'));
  if (!caught) {
    failures.push(
      'wrangler.toml 에 심은 비면제 시크릿이 검출되지 않았다 — 허용목록이 파일을 통째로 가리고 있다. '
      + '전역 allowlist 에 paths 를 쓰지 않았는지 확인할 것.',
    );
  }
} finally {
  rmSync(probe, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('허용목록 회귀 테스트 실패:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('허용목록 회귀 테스트 통과 (오탐 2건 면제 + 파일 전체는 계속 스캔됨).');
