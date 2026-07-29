import { execFileSync, spawnSync } from 'node:child_process';

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('Git hooks are installed from .githooks/.');

const gitleaksCheck = spawnSync('which', ['gitleaks']);
if (gitleaksCheck.status !== 0) {
  console.warn('');
  console.warn('경고: gitleaks 가 설치돼 있지 않다.');
  console.warn('  설치: brew install gitleaks');
  console.warn('  설치 전까지는 pre-commit 의 시크릿 가드(pnpm guard:secrets)가 커밋마다 실패한다.');
  console.warn('');
}
