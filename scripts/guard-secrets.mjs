/**
 * 시크릿 가드 — 스테이징된 변경분을 gitleaks 로 검사한다(.gitleaks.toml 의 룰 사용).
 *
 * 검사 범위가 히스토리가 아니라 스테이징인 이유: 이미 공개된 과거 커밋은 스캔해 봐야
 * 매번 같은 것을 다시 알려줄 뿐 커밋을 막을 근거가 못 된다. 이 가드가 지키는 것은
 * "여기서부터 새로 들어가는 것"이다. 히스토리 전수는 `pnpm guard:secrets:history`.
 *
 * gitleaks 가 없으면 통과시키지 않고 실패시킨다. 시크릿 검사가 조용히 건너뛰어지면
 * 없는 것과 같기 때문이다(2026-07-28 에 룰 0개짜리 설정이 208개 커밋을 "no leaks found"
 * 로 통과시키고 있던 것을 발견했다).
 */
import { spawnSync } from 'node:child_process';

const HISTORY = process.argv.includes('--history');
const args = HISTORY
  ? ['git', '--no-banner', '--redact']
  : ['git', '--pre-commit', '--staged', '--no-banner', '--redact'];

const result = spawnSync('gitleaks', args, { stdio: 'inherit' });

if (result.error?.code === 'ENOENT') {
  console.error('시크릿 가드 실패: gitleaks 가 설치돼 있지 않다.');
  console.error('  설치: brew install gitleaks');
  console.error('  검사를 건너뛰면 시크릿 검사가 없는 것과 같으므로 통과시키지 않는다.');
  process.exit(1);
}

if (result.status !== 0) {
  console.error('시크릿 가드 실패: 위 위치에 시크릿으로 보이는 값이 있다.');
  console.error('  오탐이면 .gitleaks.toml 의 [[allowlists]] 에 근거와 함께 추가한다.');
  console.error('  진짜면 값을 제거하고 해당 키를 로테이션한다 — 값은 stdout 에 출력하지 않는다.');
  process.exit(result.status ?? 1);
}

console.log(`시크릿 가드 통과${HISTORY ? ' (전 히스토리)' : ' (스테이징 변경분)'}.`);
