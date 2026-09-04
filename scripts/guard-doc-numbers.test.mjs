import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const GUARD = resolve(import.meta.dirname, 'guard-doc-numbers.mjs');

function fixture({ migrations = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccc-doc-numbers-'));
  mkdirSync(join(root, 'docs/adr'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '| D1 | 첫 결정 | 내용 |\n');
  writeFileSync(join(root, 'docs/adr/0001-first.md'), '# ADR\n');
  if (migrations) mkdirSync(join(root, 'migrations/sqlite'), { recursive: true });
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
}

test('allows the historical sqlite migration number 0009 duplicate', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'migrations/sqlite/0009_participant_pii_email.sql'), 'SELECT 1;\n');
    writeFileSync(join(root, 'migrations/sqlite/0009_schedule_session_plan.sql'), 'SELECT 1;\n');
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a new sqlite migration number duplicate', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'migrations/sqlite/0010_first.sql'), 'SELECT 1;\n');
    writeFileSync(join(root, 'migrations/sqlite/0010_second.sql'), 'SELECT 1;\n');
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /migrations\/sqlite 0010/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when the sqlite migration SSOT is missing', () => {
  const root = fixture({ migrations: false });
  try {
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /migrations\/sqlite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
