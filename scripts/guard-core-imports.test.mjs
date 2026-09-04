/**
 * 경계 가드 회귀 테스트 — 검사가 헛돌지 않는지 고정한다. 전부 일부러 어긋난 트리를
 * 임시 디렉터리에 만들고 빨간불이 뜨는지 본다. 통과만 확인하는 항목은 하나(깨끗한 트리)뿐이다.
 *
 * 실행: node --test scripts/guard-core-imports.test.mjs   (pnpm test:scripts)
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditWorkspace } from './guard-core-imports.mjs';

async function tree(spec) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-guard-'));
  for (const [path, content] of Object.entries(spec)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const manifest = (name, deps = []) => JSON.stringify({
  name,
  dependencies: Object.fromEntries(deps.map((dep) => [dep, 'workspace:*'])),
});

const clean = {
  'packages/contracts/package.json': manifest('@ccc/contracts'),
  'packages/contracts/src/database.ts': 'export type Database = {};\n',
  'packages/core/package.json': manifest('@ccc/core', ['@ccc/contracts']),
  'packages/core/src/gateway.ts': "import type { Database } from '@ccc/contracts/database';\nimport { x } from './helper';\n",
  'packages/core/src/helper.ts': 'export const x = 1;\n',
  'adapters/db-d1/package.json': manifest('@ccc/db-d1', ['@ccc/contracts']),
  'adapters/db-d1/src/index.ts': "import type { Database } from '@ccc/contracts/database';\nimport type { D1Database } from '@cloudflare/workers-types';\n",
  'apps/api/package.json': manifest('@ccc/api', ['@ccc/core', '@ccc/db-d1']),
  'apps/api/src/index.ts': "import { adapt } from '@ccc/db-d1';\nimport { g } from '@ccc/core/gateway';\nimport { readFile } from 'node:fs';\n",
};

async function violationsFor(overrides) {
  const root = await tree({ ...clean, ...overrides });
  try {
    return await auditWorkspace(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('clean tree passes; adapters and apps may use platform modules', async () => {
  assert.deepEqual(await violationsFor({}), []);
});

test('packages/* importing a platform module is a violation', async () => {
  for (const specifier of ['@cloudflare/workers-types', '@supabase/supabase-js', 'electron', 'node:fs', 'cloudflare:workers', 'miniflare']) {
    const violations = await violationsFor({
      'packages/core/src/helper.ts': `import '${specifier}';\nexport const x = 1;\n`,
    });
    assert.equal(violations.length, 1, specifier);
    assert.match(violations[0], /platform module/);
  }
});

test('packages importing adapters or apps breaks the dependency direction', async () => {
  const fromAdapter = await violationsFor({
    'packages/core/package.json': manifest('@ccc/core', ['@ccc/contracts', '@ccc/db-d1']),
    'packages/core/src/helper.ts': "import { adapt } from '@ccc/db-d1';\nexport const x = 1;\n",
  });
  assert.ok(fromAdapter.some((v) => /packages must not import adapters/.test(v)), fromAdapter.join('\n'));

  const adapterFromApp = await violationsFor({
    'adapters/db-d1/package.json': manifest('@ccc/db-d1', ['@ccc/contracts', '@ccc/api']),
    'adapters/db-d1/src/index.ts': "import { x } from '@ccc/api';\n",
  });
  assert.ok(adapterFromApp.some((v) => /adapters must not import apps/.test(v)), adapterFromApp.join('\n'));
});

test('relative import escaping the package directory is a violation', async () => {
  const violations = await violationsFor({
    'packages/core/src/helper.ts': "import { adapt } from '../../../adapters/db-d1/src/index';\nexport const x = 1;\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /leaves packages\/core/);
});

test('undeclared workspace import is a violation', async () => {
  const violations = await violationsFor({
    'packages/core/package.json': manifest('@ccc/core'),
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /not declared/);
});

test('workspace cycle is a violation', async () => {
  const violations = await violationsFor({
    'packages/contracts/package.json': manifest('@ccc/contracts', ['@ccc/core']),
  });
  assert.ok(violations.some((v) => /workspace cycle: @ccc\/(core|contracts) -> /.test(v)), violations.join('\n'));
});

test('packages/core referencing a PlatformSecretName is a violation', async () => {
  const violations = await violationsFor({
    'packages/core/src/helper.ts': "export const x = env.SUPABASE_SERVICE_ROLE_KEY;\n",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /PlatformSecretName SUPABASE_SERVICE_ROLE_KEY/);
});
