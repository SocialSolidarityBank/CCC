/**
 * 배포 모드별 테스트 입구 (E1-6, 계획 247·564행).
 *
 *   pnpm test:runtime --mode=<community-cloud|local-single|local-office> [--spec=SG4 ...]
 *   pnpm test:golden  --mode=<...> [--spec=... --cases=... --restore ...]
 *
 * 모드마다 suite 를 이 표에 등록한다. E6~E10 이 채우기 전까지는 전부 비어 있고, 비어 있는
 * 모드는 `UNAVAILABLE` 을 찍고 0 이 아닌 코드로 끝난다. 미구현을 통과로 보고하지 않는다.
 *
 * 종료 코드: 0 통과 / 1 인자 오류 또는 suite 실패 / 2 UNAVAILABLE.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODES = ['community-cloud', 'local-single', 'local-office'];
export const KINDS = ['runtime', 'golden'];

/**
 * 등록된 suite. 값은 실행할 argv(배열)이고 추가 플래그(--spec 등)가 뒤에 그대로 붙는다.
 * null 이면 아직 없다. 소유 티켓: E6(community-cloud), E7(local-single), E8(local-office).
 */
export const SUITES = {
  runtime: { 'community-cloud': null, 'local-single': null, 'local-office': null },
  golden: { 'community-cloud': null, 'local-single': null, 'local-office': null },
};

export function parseArgs(argv) {
  const [kind, ...rest] = argv;
  const modeArg = rest.find((arg) => arg.startsWith('--mode='));
  const passthrough = rest.filter((arg) => !arg.startsWith('--mode='));
  return { kind, mode: modeArg === undefined ? null : modeArg.slice('--mode='.length), passthrough };
}

/** 실행 계획을 돌려준다. 실제 spawn 은 호출자가 한다(테스트가 spawn 없이 판정을 볼 수 있게). */
export function plan(argv, suites = SUITES) {
  const { kind, mode, passthrough } = parseArgs(argv);
  if (!KINDS.includes(kind)) return { status: 'usage', code: 1, message: `unknown kind '${kind}'. expected: ${KINDS.join(' | ')}` };
  if (mode === null) return { status: 'usage', code: 1, message: `--mode is required. expected: ${MODES.join(' | ')}` };
  if (!MODES.includes(mode)) return { status: 'usage', code: 1, message: `unknown mode '${mode}'. expected: ${MODES.join(' | ')}` };
  const suite = suites[kind][mode];
  if (suite === null) return { status: 'unavailable', code: 2, message: `UNAVAILABLE kind=${kind} mode=${mode}` };
  return { status: 'run', code: 0, argv: [...suite, ...passthrough] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const decision = plan(process.argv.slice(2));
  if (decision.status !== 'run') {
    console.error(decision.message);
    process.exitCode = decision.code;
  } else {
    const [command, ...args] = decision.argv;
    const result = spawnSync(command, args, { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  }
}
