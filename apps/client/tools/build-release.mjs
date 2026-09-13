// 업무 클라이언트 배포 빌드 (D80·D83·S2 §2.9). 새 앱이 아니라 기존 vite 빌드를 감싼 명령이다.
//
// 실행(레포 루트에서):
//   pnpm --filter @ccc/client run build:release -- --config <배포설정.json> [--out <디렉터리>]
//   같은 명령: bun apps/client/tools/build-release.mjs --config <배포설정.json>
//
// 실행기는 bun 이다. 이 파일이 `@ccc/contracts` 의 TypeScript 정본을 그대로 읽어 서명을 검증하기
// 때문이고, 하네스 도구들과 같은 규약이다.
//
// 이 명령이 하는 일은 넷이다.
//   1. 배포 담당이 서명한 install manifest 를 공개 키로 **검증**한다. 여기서 서명하지 않는다.
//   2. 검증한 값으로 vite production 빌드를 돌린다(`VITE_CCC_INSTALL_SIGNING_KEYS` 주입).
//   3. `/ccc-install-manifest.json` 과 `/ccc-bootstrap.json` 을 산출물에 넣는다.
//      bootstrap 은 manifest 에서 파생하며 손으로 적지 않는다.
//   4. 정적 서버가 켜야 하는 header 를 `ccc-deploy-headers.json` 으로 적는다(S2 §2.9 고정 문구).
//
// 이 파일과 설정 예시에는 비밀값이 없다. 서명 개인 키는 배포 담당이 갖고 이 명령에 넣지 않는다.
// 호스트 이름을 코드에 박지 않는다. 전부 서명된 manifest 에서 읽는다.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignedInstallManifest, parsePublicBootstrap, assertBootstrapMatchesManifest, resolveEffectiveApiBase } from '@ccc/contracts/install-manifest';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(`build-release: ${message}`);
  process.exit(1);
}

const configPath = arg('--config');
if (configPath === undefined) fail('--config <배포설정.json> 이 필요합니다.');
const configFile = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
const configDir = dirname(configFile);

let config;
try {
  config = JSON.parse(readFileSync(configFile, 'utf8'));
} catch {
  fail(`설정 파일을 읽지 못했습니다: ${configFile}`);
}

const { manifestPath, publicKeys } = config;
if (typeof manifestPath !== 'string' || manifestPath === '') fail('설정의 manifestPath 가 없습니다.');
if (typeof publicKeys !== 'object' || publicKeys === null || Object.keys(publicKeys).length === 0) {
  fail('설정의 publicKeys 가 없습니다. 공개 키만 넣습니다.');
}

const manifestFile = isAbsolute(manifestPath) ? manifestPath : resolve(configDir, manifestPath);
let manifestJson;
try {
  manifestJson = JSON.parse(readFileSync(manifestFile, 'utf8'));
} catch {
  fail(`서명된 manifest 를 읽지 못했습니다: ${manifestFile}`);
}

// 1. 검증. 서명, 만료, 모드별 필드가 여기서 걸린다.
let manifest;
try {
  manifest = await verifySignedInstallManifest(manifestJson, { publicKeys, now: new Date() });
} catch (error) {
  fail(`manifest 검증 실패: ${error?.code ?? error?.message ?? 'unknown'}`);
}
if (manifest.mode !== 'community-cloud') {
  fail(`이 명령은 community-cloud 산출물만 만듭니다(받은 값: ${manifest.mode}).`);
}
if (!manifest.allowedOrigins.includes(manifest.clientOrigin)) {
  fail('allowedOrigins 가 clientOrigin 을 포함하지 않습니다.');
}

const outDirArg = arg('--out');
const outDir = outDirArg === undefined
  ? join(clientRoot, 'dist')
  : (isAbsolute(outDirArg) ? outDirArg : resolve(process.cwd(), outDirArg));

// 2. 빌드. 공개 키만 환경변수로 들어간다.
const build = spawnSync(
  'pnpm',
  ['--filter', '@ccc/client', 'exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'],
  { stdio: 'inherit', env: { ...process.env, VITE_CCC_INSTALL_SIGNING_KEYS: JSON.stringify(publicKeys) } },
);
if (build.status !== 0) fail('vite build 실패');

// 3. 공개 문서 둘. bootstrap 은 manifest 에서 파생하고 계약으로 다시 확인한다.
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'ccc-install-manifest.json'), `${JSON.stringify(manifestJson, null, 2)}\n`);
const bootstrap = { apiBase: manifest.apiBase, mode: manifest.mode };
assertBootstrapMatchesManifest(parsePublicBootstrap(bootstrap), manifest);
writeFileSync(join(outDir, 'ccc-bootstrap.json'), `${JSON.stringify(bootstrap, null, 2)}\n`);

// 4. 정적 서버가 켜야 하는 header. 문구는 S2 §2.9 고정이고 두 origin 만 manifest 에서 온다.
const apiBase = resolveEffectiveApiBase(manifest, null);
const authOrigin = manifest.supabaseAuthOrigin;
const headers = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    // apiBase 는 경로 접두사로 쓴다. 끝에 `/` 가 없으면 CSP 는 그 경로 하나만 허용해
    // `/api/v1/capabilities` 같은 실제 호출이 막힌다(실측으로 확인).
    `connect-src 'self' ${apiBase.replace(/\/$/, '')}/ ${authOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "form-action 'self'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};
writeFileSync(join(outDir, 'ccc-deploy-headers.json'), `${JSON.stringify({
  note: '정적 서버가 모든 응답에 켜야 하는 header. Cache-Control 은 두 공개 문서와 index.html 에만 적용한다.',
  clientOrigin: manifest.clientOrigin,
  allowedOrigins: manifest.allowedOrigins,
  apiBase,
  supabaseAuthOrigin: authOrigin,
  headers,
}, null, 2)}\n`);

console.log(`build-release: ${outDir} 준비 완료`);
console.log(`  clientOrigin  ${manifest.clientOrigin}`);
console.log(`  apiBase       ${apiBase}`);
console.log(`  authOrigin    ${authOrigin}`);
console.log(`  installation  ${manifest.installationId} (sequence ${manifest.sequence}, 만료 ${manifest.expiresAt})`);
