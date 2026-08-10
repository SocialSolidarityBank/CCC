/**
 * 배포 판정 회귀 테스트 — **거짓 성공을 다시 내지 않는지**를 고정한다.
 *
 * 첫 항목이 이 파일의 존재 이유다. 2026-08-10 에 실제로 그 응답을 받고 "배포 성공"을
 * 출력했으며, 그때 배포 잡은 시작조차 하지 않았다. 아래 모양은 그날 API 가 준 것 그대로다.
 *
 * 실행: node scripts/deploy-verdict.test.mjs   (pnpm guard:deploy-verdict)
 */
import { verdict } from './deploy-verdict.mjs';

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
};

// 그날의 응답. 검증 잡 셋은 끝났고 배포 잡은 승인 대기다. 실행 status 가 잠깐 completed 로
// 보고되는 것이 함정이었다 — 이 두 줄이 예전 판정을 속인 입력이다.
const 찰나 = {
  status: 'completed',
  conclusion: null,
  jobs: [
    { name: 'confirm', status: 'completed', conclusion: 'success' },
    { name: 'verify', status: 'completed', conclusion: 'success' },
    { name: 'schema-gate', status: 'completed', conclusion: 'success' },
    { name: 'deploy-production', status: 'waiting', conclusion: null },
  ],
};
const v찰나 = verdict(찰나);
check('배포 잡이 안 돌았으면 성공이 아니다', !(v찰나.done && v찰나.error === undefined),
  `실제: ${JSON.stringify(v찰나)}`);
check('그 상태는 실패로 잡힌다', v찰나.done === true && typeof v찰나.error === 'string',
  `실제: ${JSON.stringify(v찰나)}`);

// 승인 전 정상 대기 — 실행이 아직 안 끝난 모양.
const 대기 = {
  status: 'waiting',
  conclusion: null,
  jobs: [
    { name: 'schema-gate', status: 'completed', conclusion: 'success' },
    { name: 'deploy-production', status: 'waiting', conclusion: null },
  ],
};
const v대기 = verdict(대기);
check('승인 대기는 끝난 것이 아니다', v대기.done === false, JSON.stringify(v대기));
check('승인 대기는 안내를 띄운다', v대기.waiting === true, JSON.stringify(v대기));

// 진짜 성공 — 2026-08-10 13:18 실행 31370313724 의 최종 모양.
const 성공 = {
  status: 'completed',
  conclusion: 'success',
  jobs: [
    { name: 'confirm', status: 'completed', conclusion: 'success' },
    { name: 'verify', status: 'completed', conclusion: 'success' },
    { name: 'schema-gate', status: 'completed', conclusion: 'success' },
    { name: 'deploy-production', status: 'completed', conclusion: 'success' },
  ],
};
const v성공 = verdict(성공);
check('배포 잡이 성공이면 끝이다', v성공.done === true && v성공.error === undefined, JSON.stringify(v성공));

// 배포 잡 자체가 실패.
const v실패 = verdict({
  status: 'completed', conclusion: 'failure',
  jobs: [{ name: 'deploy-production', status: 'completed', conclusion: 'failure' }],
});
check('배포 잡 실패는 실패다', v실패.done === true && v실패.error !== undefined, JSON.stringify(v실패));

// 승인을 거부하거나 취소한 경우 — 배포 잡에 결론이 없는 채로 실행이 끝난다.
const v취소 = verdict({
  status: 'completed', conclusion: 'cancelled',
  jobs: [{ name: 'deploy-production', status: 'completed', conclusion: null }],
});
check('취소는 성공이 아니다', v취소.done === true && v취소.error !== undefined, JSON.stringify(v취소));

// 아직 검증 중.
const v진행 = verdict({
  status: 'in_progress', conclusion: null,
  jobs: [{ name: 'verify', status: 'in_progress', conclusion: null }],
});
check('검증 중은 끝난 것이 아니다', v진행.done === false, JSON.stringify(v진행));
check('검증 중에는 승인 안내를 띄우지 않는다', v진행.waiting !== true, JSON.stringify(v진행));

if (failures.length) {
  console.error(`배포 판정 테스트 실패 ${failures.length}건:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('배포 판정 테스트 통과');
