import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PlanFailure } from '../supabase/plan.mjs';
import {
  assertSameApprovedStage,
  initialView,
  viewFromSupabaseResult,
} from './flow.mjs';

const binding = {
  mode: 'community-cloud', stageId: 'installation',
  targetSha256: 'a'.repeat(64), desiredSha256: 'b'.repeat(64),
  observedSha256: 'c'.repeat(64),
};

// Dropping any comparison would authorize a different scope or stale observation.
test('관찰한 설치 상태가 바뀌면 이전 승인을 쓸 수 없다', () => {
  assert.throws(() => assertSameApprovedStage(binding, binding, {
    ...binding, observedSha256: 'd'.repeat(64),
  }), { code: 'PLAN_STATE_CHANGED' });
  const changes = {
    mode: 'local-single', stageId: 'storage',
    targetSha256: 'd'.repeat(64), desiredSha256: 'e'.repeat(64),
    observedSha256: 'f'.repeat(64),
  };
  for (const [field, value] of Object.entries(changes)) {
    const changed = { ...binding, [field]: value };
    assert.throws(() => assertSameApprovedStage(binding, changed, binding),
      { code: 'PLAN_STATE_CHANGED' }, `planned.${field}`);
    assert.throws(() => assertSameApprovedStage(binding, binding, changed),
      { code: 'PLAN_STATE_CHANGED' }, `observed.${field}`);
  }
  // Content equality is not an execution capability or a signed authorization.
  assert.equal(assertSameApprovedStage(binding, { ...binding }, { ...binding }), undefined);
});

test('비어 있거나 확장된 승인과 잘못된 해시는 일치해도 거부한다', () => {
  for (const invalid of [
    null, {}, [], { ...binding, mode: 'hosted' },
    { ...binding, stageId: 'constructor' },
    { ...binding, stageId: ['installation'] },
    { ...binding, targetSha256: null },
    { ...binding, desiredSha256: 'b'.repeat(63) },
    { ...binding, observedSha256: ['c'.repeat(64)] },
    { ...binding, parameters: { command: 'private-input-must-not-escape' } },
  ]) {
    assert.throws(() => assertSameApprovedStage(invalid, invalid, invalid), error => {
      assert.equal(error.code, 'STAGE_BINDING_INVALID');
      assert.ok(!error.message.includes('private-input-must-not-escape'));
      return true;
    });
  }
});

test('빈 결과는 입력 대기이고 기존 오류는 단계 안내로만 변환한다', () => {
  assert.equal(viewFromSupabaseResult('community-cloud', null).status, 'needs_input');
  const missing = viewFromSupabaseResult('community-cloud', {
    error: new PlanFailure('CREDENTIAL_MISSING'),
  });
  assert.equal(missing.status, 'needs_input');
  assert.equal(missing.stageId, 'environment');
  assert.notEqual(missing.questionId, null);
  const denied = viewFromSupabaseResult('community-cloud', {
    error: { code: 'OWNER_MISMATCH', message: 'private-provider-body' },
  });
  assert.equal(denied.status, 'blocked');
  assert.equal(denied.stageId, 'installation');
  assert.ok(!JSON.stringify(denied).includes('private-provider-body'));
  const unknown = viewFromSupabaseResult('community-cloud', {
    error: { code: 'private-unrecognized-code' },
  });
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.checks[0].code, 'UNKNOWN_CHECK_CODE');
  assert.ok(!JSON.stringify(unknown).includes('private-unrecognized-code'));
});

const plan = {
  operation: 'plan', target: 'hosted', readOnly: true, ready: true, unchanged: true,
  stateFingerprint: 'a'.repeat(64), planFingerprint: 'b'.repeat(64),
  blockers: [],
};

test('읽기 전용 계획 통과는 설치 완료가 아니고 누락되거나 낡은 결과는 차단한다', () => {
  const ready = viewFromSupabaseResult('community-cloud', plan);
  assert.equal(ready.status, 'needs_approval');
  assert.equal(ready.stageId, 'installation');
  for (const invalid of [
    {}, { ...plan, readOnly: false }, { ...plan, unchanged: false },
    { ...plan, ready: false }, { ...plan, stateFingerprint: '' },
    { ...plan, blockers: [{ code: 'private-code', message: 'private-body' }] },
    { ...plan, parameters: { command: 'private-command' } },
  ]) {
    const view = viewFromSupabaseResult('community-cloud', invalid);
    assert.equal(view.status, 'blocked');
    assert.ok(!JSON.stringify(view).includes('private-'));
  }
  const region = viewFromSupabaseResult('community-cloud', {
    ...plan, ready: false, blockers: [{ code: 'REGION_MISMATCH' }],
  });
  assert.equal(region.stageId, 'cloud-resources');
  assert.equal(region.status, 'blocked');
  assert.equal(viewFromSupabaseResult('local-single', { ...plan, target: 'local' }).status, 'blocked');
});

test('설치 검사와 업무 runtime 준비를 구분하고 알 수 없는 안내도 차단한다', () => {
  const doctor = {
    operation: 'doctor', readOnly: true, ready: true,
    stateFingerprint: 'a'.repeat(64), installed: { state: 'installed' },
    health: { installedHealthy: true, runtimeReady: false },
    blockers: [], notices: [{ code: 'RUNTIME_NOT_READY' }],
  };
  const view = viewFromSupabaseResult('community-cloud', doctor);
  assert.equal(view.stageId, 'installation');
  assert.equal(view.status, 'verified');
  assert.ok(view.checks.some(check => check.code === 'RUNTIME_NOT_READY' && check.status === 'NOT_RUN'));
  assert.equal(viewFromSupabaseResult('community-cloud', { ...doctor, health: null }).status, 'blocked');
  assert.equal(viewFromSupabaseResult('community-cloud', {
    ...doctor, notices: [{ code: 'private-new-notice' }],
  }).status, 'blocked');
  assert.throws(() => initialView('constructor'), { code: 'ONBOARDING_INPUT_INVALID' });
});

function cli(args, input = '') {
  return spawnSync(process.execPath, [new URL('./cli.mjs', import.meta.url).pathname, ...args], {
    input, encoding: 'utf8', env: {}, timeout: 5_000,
  });
}

test('무자격 CLI는 입력 대기이며 계획과 취소 뒤에도 실행이나 완료를 만들지 않는다', () => {
  const first = cli(['--mode', 'community-cloud', '--format', 'json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'needs_input');
  const session = cli([], '1\n1\nplan\n이대로 설정\nprivate-user-question\ncancel\nexit\n');
  assert.equal(session.status, 0, session.stderr);
  assert.match(session.stdout, /needs_input/u);
  assert.match(session.stdout, /EXECUTION_UNAVAILABLE/u);
  assert.match(session.stdout, /CANCELLED/u);
  assert.match(session.stdout, /CLOSED/u);
  assert.doesNotMatch(session.stdout, /private-user-question|verified|running|needs_approval/u);
  const bad = cli(['--target', 'private-url']);
  assert.equal(bad.status, 2);
  assert.doesNotMatch(bad.stdout + bad.stderr, /private-url/u);
});

test('readline의 터미널 입력도 원문을 출력하지 않고 종료한다', () => {
  const terminal = spawnSync(process.execPath, [
    '--import', 'data:text/javascript,process.stdin.isTTY=true',
    new URL('./cli.mjs', import.meta.url).pathname, '--mode', 'community-cloud',
  ], { input: 'private-terminal-input\nexit\n', encoding: 'utf8', env: {}, timeout: 5_000 });
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.match(terminal.stdout, /CLOSED/u);
  assert.doesNotMatch(terminal.stdout + terminal.stderr, /private-terminal-input/u);
});
