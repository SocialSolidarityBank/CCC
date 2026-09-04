/**
 * 계약·보안 스위트 입구 (S2 §5, E1-7).
 *
 *   pnpm test:contracts --capabilities | --database | --audio-store
 *   pnpm test:security  --bootstrap
 *
 * 플래그가 없으면 그 kind 의 스위트를 전부 돌린다. 모르는 플래그는 usage(1) 로 끝난다.
 * 각 항목은 apps/api vitest 파일 하나다. 새 스위트(--auth, --jwt, --browser-boundary)는
 * 소유 티켓이 표에 추가한다.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITES = {
  contracts: {
    capabilities: 'apps/api/test/capabilities.contract.test.ts',
    database: 'apps/api/test/database-contract.test.ts',
    'audio-store': 'apps/api/test/audio-store.contract.test.ts',
  },
  security: {
    bootstrap: 'apps/api/test/install-manifest.security.test.ts',
  },
};

const VITEST = ['pnpm', '--workspace-root', 'exec', 'vitest', 'run', '--config', 'apps/api/vitest.config.ts'];

/** 실행 계획. spawn 은 호출자가 한다. */
export function plan(argv, suites = SUITES) {
  const [kind, ...flags] = argv;
  const table = suites[kind];
  if (table === undefined) return { status: 'usage', code: 1, message: `unknown kind '${kind}'. expected: ${Object.keys(suites).join(' | ')}` };
  const names = flags.map((flag) => flag.replace(/^--/, ''));
  const unknown = names.find((name) => table[name] === undefined);
  if (unknown !== undefined) return { status: 'usage', code: 1, message: `unknown suite '--${unknown}'. expected: ${Object.keys(table).map((name) => `--${name}`).join(' | ')}` };
  const files = (names.length === 0 ? Object.keys(table) : names).map((name) => table[name]);
  return { status: 'run', code: 0, argv: [...VITEST, ...files] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const decision = plan(process.argv.slice(2));
  if (decision.status !== 'run') {
    console.error(decision.message);
    process.exitCode = decision.code;
  } else {
    const [command, ...args] = decision.argv;
    process.exitCode = spawnSync(command, args, { stdio: 'inherit' }).status ?? 1;
  }
}
