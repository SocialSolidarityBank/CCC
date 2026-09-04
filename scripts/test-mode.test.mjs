/**
 * 모드 입구 계약 테스트 — 미구현 모드가 통과로 새지 않는지 고정한다.
 * 실행: node --test scripts/test-mode.test.mjs   (pnpm test:scripts)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MODES, plan } from './test-mode.mjs';

const script = fileURLToPath(new URL('./test-mode.mjs', import.meta.url));

test('every unimplemented mode is UNAVAILABLE with exit 2 for both kinds', () => {
  for (const kind of ['runtime', 'golden']) {
    for (const mode of MODES) {
      const decision = plan([kind, `--mode=${mode}`]);
      assert.equal(decision.status, 'unavailable', `${kind} ${mode}`);
      assert.equal(decision.code, 2);
      assert.equal(decision.message, `UNAVAILABLE kind=${kind} mode=${mode}`);
    }
  }
});

test('missing, unknown mode, and unknown kind are usage errors with exit 1', () => {
  assert.equal(plan(['runtime']).code, 1);
  assert.equal(plan(['runtime', '--mode=cloud']).code, 1);
  assert.equal(plan(['smoke', '--mode=local-single']).code, 1);
});

test('a registered suite runs with passthrough flags appended', () => {
  const suites = { runtime: { 'local-single': ['node', 'suite.mjs'] }, golden: {} };
  const decision = plan(['runtime', '--mode=local-single', '--spec=SG4', '--cases=100'], suites);
  assert.equal(decision.status, 'run');
  assert.deepEqual(decision.argv, ['node', 'suite.mjs', '--spec=SG4', '--cases=100']);
});

test('the process exit code carries the decision', () => {
  const unavailable = spawnSync(process.execPath, [script, 'golden', '--mode=local-office'], { encoding: 'utf8' });
  assert.equal(unavailable.status, 2);
  assert.match(unavailable.stderr, /^UNAVAILABLE kind=golden mode=local-office/);
  assert.equal(spawnSync(process.execPath, [script, 'runtime'], { encoding: 'utf8' }).status, 1);
});
