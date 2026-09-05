import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
// 숨김 디렉터리(.claude 워크트리, .omc 등 도구 상태)는 프로젝트 소스가 아니므로 전부 제외한다.
const ignoredDirectories = new Set(['coverage', 'dist', 'node_modules']);
const isIgnoredDirectory = (name) => name.startsWith('.') || ignoredDirectories.has(name);
const sourceRoots = ['adapters', 'apps', 'db', 'packages', 'scripts'].map((path) => resolve(root, path));
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
// 업무 SQL 은 packages/core 의 gateway facade 에만 둔다(R1·D78). raw driver 호출은
// adapters/db-*, migration/schema 검사, 계약 테스트 하니스에만 허용한다. 시드 툴은
// 게이트웨이 공개 함수를 경유해 쓰고, raw 접근은 하니스 계층(Miniflare 부트·프리로드·
// 캡처 프록시·재생 diff) 세 파일만 예외다. apps/* 와 packages/http-api 는 차단된다.
const allowedFiles = new Set([
  'packages/core/src/gateway.ts',
  'adapters/db-d1/src/index.ts',
  'adapters/db-sqlite/src/index.ts',
  'scripts/guard-db-gateway.mjs',
  'scripts/guard-sql-dialect.mjs',
  'scripts/seed/harness.ts',
  'scripts/seed/capture.ts',
  'scripts/seed/validate.ts',
]);

function normalize(path) {
  return path.split(sep).join('/');
}

function isFixtureOrMigration(path) {
  // 예외는 실제 테스트 경로로만 앵커한다. 단순 '/test/' 부분일치는 임의 디렉터리
  // (예: src/test/…)를 통째로 면제해 가드를 우회시킬 수 있어 쓰지 않는다.
  return path.startsWith('migrations/')
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)      // *.test.ts / *.spec.ts 등
    || path.split('/').includes('__tests__')          // __tests__ 디렉터리
    || /^(?:apps|adapters)\/[^/]+\/tests?\//.test(path); // <layer>/<pkg>/test|tests/…
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const child = resolve(directory, entry.name);
      if (!isIgnoredDirectory(entry.name)) {
        files.push(...await sourceFiles(child));
      }
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(resolve(directory, entry.name));
    }
  }

  return files;
}

function findingsFor(content, path) {
  const findings = [];
  const checks = [
    { pattern: /\benv\s*\.\s*DB\b/g, label: 'env.DB' },
    // 대괄호 접근도 잡는다: env["DB"] / env['DB']
    { pattern: /\benv\s*\[\s*['"]DB['"]\s*\]/g, label: 'env["DB"]' },
    // 이 코드베이스에서 .prepare(는 D1 스테이트먼트에만 쓴다. gateway 밖이면 전부 차단.
    // (const db = env["DB"]; db.prepare(...) 같은 우회를 잡기 위함)
    { pattern: /\.\s*prepare\s*\(/g, label: '.prepare(' },
  ];

  for (const check of checks) {
    for (const match of content.matchAll(check.pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push(`${path}:${line}: direct ${check.label} access is only allowed in packages/core/src/gateway.ts`);
    }
  }

  return findings;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await sourceFiles(sourceRoot)) {
    const path = normalize(relative(root, file));
    if (allowedFiles.has(path) || isFixtureOrMigration(path)) continue;
    violations.push(...findingsFor(await readFile(file, 'utf8'), path));
  }
}

if (violations.length > 0) {
  console.error('DB gateway guard failed:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log('DB gateway guard passed.');
}
