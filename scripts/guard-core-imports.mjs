/**
 * 공통 패키지 경계 가드 (E1-6, 계획 62·129행).
 *
 * 세 규칙을 결정론으로 본다.
 *   1. `packages/*` 는 플랫폼 모듈을 import 하지 않는다: `@cloudflare/*`, `@supabase/*`,
 *      `electron`, `node:*`, `cloudflare:*`, `bun:*`, `miniflare`, `wrangler`.
 *   2. 의존 방향은 `apps -> adapters -> packages` 다. packages 는 adapters·apps 를,
 *      adapters 는 apps 를 import 하지 않는다. 상대 경로로 자기 패키지 밖을 가리키는 것도 같다.
 *   3. 워크스페이스 패키지 사이 순환 의존이 없다(package.json dependencies + 실제 import).
 *   4. `packages/core` 는 PlatformSecretName 을 한 글자도 참조하지 않는다.
 *
 * 실행: node scripts/guard-core-imports.mjs   (pnpm guard:core-imports)
 * 함수는 테스트가 가짜 트리로 부를 수 있게 export 한다.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_SPECIFIERS = /^(@cloudflare\/|@supabase\/|electron(\/|$)|node:|cloudflare:|bun:|miniflare(\/|$)|wrangler(\/|$))/;
const PLATFORM_SECRET_NAMES = ['DB_MASTER_KEY', 'FILE_ENC_KEY', 'OFFICE_CA_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SCHEDULER_SECRET'];
const LAYER_RANK = { packages: 0, adapters: 1, apps: 2 };
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs']);
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

const normalize = (path) => path.split(sep).join('/');

async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(path);
  }
  return files;
}

/** 루트의 packages/adapters/apps 아래 package.json 을 읽어 워크스페이스 패키지 목록을 만든다. */
export async function discoverWorkspace(root) {
  const packages = [];
  for (const layer of Object.keys(LAYER_RANK)) {
    let entries;
    try {
      entries = await readdir(join(root, layer), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, layer, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      packages.push({
        name: manifest.name,
        layer,
        dir,
        declared: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
          .filter((name) => name.startsWith('@ccc/')),
      });
    }
  }
  return packages;
}

function specifierPackage(specifier, packages) {
  return packages.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)) ?? null;
}

/** 워크스페이스 전체를 검사해 위반 문자열 배열을 돌려준다. 비어 있으면 통과다. */
export async function auditWorkspace(root) {
  const packages = await discoverWorkspace(root);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const violations = [];
  const edges = new Map(packages.map((pkg) => [pkg.name, new Set(pkg.declared)]));

  for (const pkg of packages) {
    const srcDir = join(pkg.dir, 'src');
    for (const file of await listFiles(srcDir)) {
      const path = normalize(relative(root, file));
      const content = await readFile(file, 'utf8');

      if (pkg.layer === 'packages' && pkg.name === '@ccc/core') {
        for (const name of PLATFORM_SECRET_NAMES) {
          if (content.includes(name)) violations.push(`${path}: packages/core must not reference PlatformSecretName ${name}`);
        }
      }

      for (const match of content.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];
        const line = content.slice(0, match.index).split('\n').length;

        if (pkg.layer === 'packages' && PLATFORM_SPECIFIERS.test(specifier)) {
          violations.push(`${path}:${line}: packages/* must not import platform module '${specifier}'`);
          continue;
        }

        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (relative(pkg.dir, target).startsWith('..')) {
            violations.push(`${path}:${line}: relative import '${specifier}' leaves ${normalize(relative(root, pkg.dir))}`);
          }
          continue;
        }

        const dependency = specifierPackage(specifier, packages);
        if (dependency === null || dependency.name === pkg.name) continue;
        edges.get(pkg.name).add(dependency.name);
        if (LAYER_RANK[dependency.layer] > LAYER_RANK[pkg.layer]) {
          violations.push(`${path}:${line}: ${pkg.layer} must not import ${dependency.layer} package '${specifier}' (apps -> adapters -> packages)`);
        }
        if (!pkg.declared.includes(dependency.name)) {
          violations.push(`${path}:${line}: '${dependency.name}' is imported but not declared in ${normalize(relative(root, join(pkg.dir, 'package.json')))}`);
        }
      }
    }
  }

  // 순환: 선언 + 실제 import 를 합친 그래프에서 DFS.
  const state = new Map();
  const stack = [];
  const visit = (name) => {
    if (!byName.has(name)) return;
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'active') {
      violations.push(`workspace cycle: ${[...stack.slice(stack.indexOf(name)), name].join(' -> ')}`);
      return;
    }
    state.set(name, 'active');
    stack.push(name);
    for (const next of edges.get(name) ?? []) visit(next);
    stack.pop();
    state.set(name, 'done');
  };
  for (const pkg of packages) visit(pkg.name);

  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await auditWorkspace(resolve(process.cwd()));
  if (violations.length > 0) {
    console.error('core import guard failed:');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exitCode = 1;
  } else {
    console.log('core import guard passed.');
  }
}
