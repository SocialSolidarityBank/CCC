import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { createD1Database } from '../../adapters/db-d1/src/index.ts';
import { handleRequest } from '../../packages/http-api/src/request-handler.ts';

const directory = mkdtempSync(join(tmpdir(), 'ccc291-consumer-'));
const runtime = new Miniflare({ compatibilityDate: '2026-07-06', modules: true, d1Databases: ['DB'],
  d1Persist: directory, script: 'export default { fetch() { return new Response("synthetic"); } };' });
let server;
try {
  const raw = await runtime.getD1Database('DB');
  for (const migration of await readD1Migrations(join(process.cwd(), 'migrations/sqlite'))) {
    await raw.batch(migration.queries.map((sql) => raw.prepare(sql)));
  }
  const db = createD1Database(raw), at = '2026-09-01T00:00:00.000Z';
  const actor = { orgId: 'source-smoke', userId: 'source-reader', role: 'counselor' as const };
  await db.batch([
    db.prepare("INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days) VALUES (?,'UTC',180)").bind(actor.orgId),
    db.prepare('INSERT INTO programs(id,org_id) VALUES (?,?)').bind('source-program', actor.orgId),
    db.prepare("INSERT INTO users(id,org_id,email,role,active) VALUES (?,?,'source@example.invalid','counselor',1)").bind(actor.userId, actor.orgId),
    db.prepare("INSERT INTO beneficiaries(id,org_id,initialization_state,created_at,updated_at) VALUES ('A990',?,'pending',?,?)").bind(actor.orgId, at, at),
    db.prepare("INSERT INTO support_cases(id,org_id,beneficiary_id,legacy_case_id,program_id,status,creation_kind,created_at,updated_at) VALUES ('source-case',?,'A990','A990','source-program','active','initial',?,?)").bind(actor.orgId, at, at),
    db.prepare("INSERT INTO support_case_assignees(id,org_id,support_case_id,user_id,role,status,assigned_at) VALUES ('source-assignment',?,'source-case',?,'primary','active',?)").bind(actor.orgId, actor.userId, at),
    ...[['create','beneficiaries','A990',null],['create','support_cases','source-case','source-case'],['assign','support_case_assignees','source-assignment','source-case']].map(([action,table,id,supportCaseId]) => db.prepare('INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,created_at) VALUES (?,?,\'counselor\',?,?,?,\'A990\',?,?)').bind(actor.orgId,actor.userId,action,table,id,supportCaseId,at)),
    db.prepare("UPDATE beneficiaries SET initialization_state='complete' WHERE id='A990'"),
    db.prepare("INSERT INTO sessions(id,org_id,support_case_id,counselor_id,held_at,channel,memo,submission_id,submission_hash,submitted_by,ai_status,created_at,updated_at) VALUES ('source-session',?,'source-case',?,?,'in_person','synthetic source','source-submit',?,?,'none',?,?)").bind(actor.orgId,actor.userId,at,'a'.repeat(64),actor.userId,at,at),
    db.prepare("INSERT INTO ai_text_work_queue(id,org_id,support_case_id,session_id,reason,status,enqueued_at,completed_at) VALUES ('source-queue',?,'source-case','source-session','manual_record','done',?,?)").bind(actor.orgId,at,at),
    db.prepare("INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,enqueued_at,required_consent,result_id,result_payload_sha256,result_accepted_at,updated_at,source_generation,source_sha256,source_length,checked_start,checked_end) SELECT 'source-job',org_id,support_case_id,'source-session','source-queue','text','succeeded',?,'[]','synthetic-result',?,?,?,generation,?,16,0,7 FROM counseling_memory_cases WHERE support_case_id='source-case'").bind(at,'b'.repeat(64),at,at,'c'.repeat(64)),
  ]);
  server = createServer(async (incoming,outgoing) => {
    const response = await handleRequest(new Request(`http://127.0.0.1${incoming.url}`), { DB: db, installationMode: 'community-cloud' }, async () => incoming.headers['x-smoke-foreign'] ? { ...actor, orgId:'foreign' } : actor);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/sessions/source-session/processing`;
  console.log('CCC291_SMOKE_READY');
  const firstResponse = await fetch(url); assert.equal(firstResponse.status,200);
  const before = await firstResponse.json(); assert.equal(before.state,'partial'); assert.deepEqual(before.checkedRange,{start:0,end:7});
  await db.prepare("UPDATE support_cases SET overall_goal='synthetic revised source' WHERE id='source-case'").run();
  const secondResponse = await fetch(url); assert.equal(secondResponse.status,200);
  const after = await secondResponse.json(); assert.equal(after.state,'stale'); assert.equal(after.sourceChanged,true); assert.deepEqual(after.checkedRange,before.checkedRange);
  assert.equal((await fetch(url,{headers:{'x-smoke-foreign':'1'}})).status,403);
  const audit = await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE json_extract(detail,'$.purpose')='text_processing_status'").first(); assert.equal(audit?.count,2);
  console.log(JSON.stringify({proof:'CCC291_CONSUMER_SMOKE',http:[200,200,403],states:[before.state,after.state],checkedRange:after.checkedRange,auditReads:2,providerCalls:0}));
} finally {
  if (server) await new Promise<void>((resolve,reject) => server.close((error) => error ? reject(error) : resolve()));
  await runtime.dispose(); rmSync(directory,{recursive:true,force:true});
}
