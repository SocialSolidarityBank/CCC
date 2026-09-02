import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import test from 'node:test';

import { createLocalInspector } from './local-inspector.mjs';

const workdir = process.env.CCC_SUPABASE_LOCAL_WORKDIR;

const execFileAsync = promisify(execFile);

async function localDatabaseUrl() {
  const { stdout } = await execFileAsync('supabase', ['status', '--output', 'json'], { cwd: workdir });
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  return JSON.parse(stdout.slice(start, end + 1)).DB_URL;
}

test('real local Supabase accepts the complete inspection query in a read-only transaction', {
  skip: workdir === undefined ? 'CCC_SUPABASE_LOCAL_WORKDIR is not set' : false,
}, async () => {
  const inspector = createLocalInspector({ workdir });
  const observed = await inspector.inspect();

  assert.equal(observed.project.status, 'LOCAL');
  assert.equal(observed.connection.readOnly, true);
  assert.equal(observed.connection.databaseReadable, true);
  assert.equal(observed.state.userTableCount, 0);
  assert.equal(observed.state.bucket.exists, false);
});

test('schema, policy, bucket, and institution data markers change with observed state', {
  skip: workdir === undefined ? 'CCC_SUPABASE_LOCAL_WORKDIR is not set' : false,
}, async () => {
  const sql = postgres(await localDatabaseUrl(), { max: 1, onnotice: () => {} });
  const inspector = createLocalInspector({ workdir });
  try {
    await sql.unsafe('DROP TABLE IF EXISTS public.ccc_preflight_fingerprint_fixture CASCADE');
    await sql.unsafe('CREATE TABLE public.ccc_preflight_fingerprint_fixture (id bigint PRIMARY KEY)');
    await sql.unsafe('ALTER TABLE public.ccc_preflight_fingerprint_fixture ENABLE ROW LEVEL SECURITY');
    await sql.unsafe('CREATE POLICY ccc_preflight_policy ON public.ccc_preflight_fingerprint_fixture USING (id > 0)');
    await sql.unsafe("INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('ccc-preflight-fingerprint-fixture', 'ccc-preflight-fingerprint-fixture', false, null) ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = null");
    await sql.unsafe('INSERT INTO public.ccc_preflight_fingerprint_fixture (id) VALUES (1)');
    await sql.unsafe('SELECT pg_catalog.pg_stat_force_next_flush()');
    const before = await inspector.inspect();

    await sql.unsafe('ALTER TABLE public.ccc_preflight_fingerprint_fixture ADD COLUMN note text');
    await sql.unsafe('ALTER POLICY ccc_preflight_policy ON public.ccc_preflight_fingerprint_fixture USING (id > 1)');
    await sql.unsafe("UPDATE storage.buckets SET file_size_limit = 4096 WHERE id = 'ccc-preflight-fingerprint-fixture'");
    await sql.unsafe("UPDATE public.ccc_preflight_fingerprint_fixture SET note = 'changed' WHERE id = 1");
    await sql.unsafe('SELECT pg_catalog.pg_stat_force_next_flush()');
    const after = await inspector.inspect();

    assert.notEqual(after.state.schemaFingerprint, before.state.schemaFingerprint);
    assert.notEqual(after.state.policyFingerprint, before.state.policyFingerprint);
    assert.notEqual(after.state.bucketFingerprint, before.state.bucketFingerprint);
    assert.notEqual(after.state.institutionDataFingerprint, before.state.institutionDataFingerprint);
  } finally {
    await sql.unsafe('DROP TABLE IF EXISTS public.ccc_preflight_fingerprint_fixture CASCADE').catch(() => {});
    await sql.end({ timeout: 1 }).catch(() => {});
  }
});
