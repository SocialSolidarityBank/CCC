// E6-4 Agent 페어링. S2 §2.2 L64·L94·L96 과 §2.4 L135-136 의 계약을 고정한다.
// 합성 자격만 쓴다. 저장은 hash 뿐이고 평문은 발급 응답에만 있다는 것도 함께 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import { ActorAuthenticationError, type Actor as IdentityActor } from '@ccc/contracts/runtime';
import {
  ForbiddenError,
  agentActorUserId,
  createCase,
  createManualSession,
  issueAgentPairingCode,
  redeemAgentPairingCode,
  resolveAgentBearer,
  revokeAgentInstallation,
  recordSttReadiness,
  rotateAgentRefreshCredential,
  type AgentCredentialGrant,
  type AgentRuntime,
} from '@ccc/core/gateway';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import { createAgentBearerResolver } from '@ccc/http-api/agent-identity';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId, type TestApiEnv } from './support/d1';
import {
  agentManifestEnv,
  claimRequest,
  registerFixtureRecording,
  seedCanonicalSttConsent,
  seedNerQualification,
  sha256Hex,
} from './support/agent-jobs';
import { registrationInput } from './support/registration';

const { admin, counselor, otherOrgAdmin, service } = testActors;
const BEARER_TTL_MS = 900_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const CLOUD_RUNTIME: AgentRuntime = {
  route: 'community-cloud-agent',
  sttEngine: 'local',
  sttEngineId: 'qwen3-asr',
  audioDelivery: 'protected-get',
};
const humanActor: IdentityActor = {
  kind: 'human',
  userId: counselor.userId,
  orgId: counselor.orgId,
  roles: ['worker'],
  scopes: [],
  authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'fixture-session' },
};
const adminActor: IdentityActor = {
  ...humanActor,
  userId: admin.userId,
  roles: ['institution-admin'],
};

const t = setupD1();
let env: TestApiEnv;

beforeEach(async () => {
  await t.reset();
  env = await agentManifestEnv(t.env, { mode: 'community-cloud', stt: 'local' });
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
    deploymentMode: 'community-cloud',
    sttMode: 'local',
    llmMode: 'off',
  });
  // 설치가 요구하는 연결 users 행(S2 L94). 테스트 디렉터리에는 service 행이 없다.
  await t.db.prepare('INSERT INTO users (id, org_id, email, role, active) VALUES (?, ?, ?, ?, 1)')
    .bind(service.userId, service.orgId, service.userId, service.role).run();
});

/** agent-bearer 레인 뒤에 고정 사람 신원을 둔 resolver. 사람 자격은 정확히 한 값이다. */
function resolver(inner: IdentityActor = humanActor): ActorResolver {
  return createAgentBearerResolver({
    inner: async (request) => {
      if (request.headers.get('authorization') !== 'Bearer human-jwt-fixture') {
        throw new ActorAuthenticationError();
      }
      return inner;
    },
  });
}

async function post(
  path: string,
  body: unknown,
  options: { bearer?: string; actor?: IdentityActor } = {},
): Promise<Response> {
  return handleRequest(new Request(`https://api.example.invalid${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
    },
    body: JSON.stringify(body),
  }), env, resolver(options.actor ?? humanActor));
}

/** 발급은 gateway(관리자 경로는 따로 본다), 교환은 자격만 들고 가는 공개 경로다. */
async function pair(): Promise<{ pairingCode: string; installationId: string; grant: AgentCredentialGrant }> {
  const issued = await issueAgentPairingCode(env, admin, { actorUserId: service.userId });
  const response = await post('/agents/pair', { pairingCode: issued.pairingCode });
  expect(response.status, await response.clone().text()).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const grant = await response.json() as AgentCredentialGrant;
  expect(grant.installationId).toBe(issued.installationId);
  return { pairingCode: issued.pairingCode, installationId: issued.installationId, grant };
}

async function createSession(): Promise<string> {
  const participant = await createCase(env, counselor, await registrationInput(env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  const session = await createManualSession(env, counselor, participant.id, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-10T10:00:00.000Z',
    channel: 'in_person',
    memo: 'Synthetic pairing fixture.',
    gasScores: [],
  });
  const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=? AND org_id=?')
    .bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
  if (scope === null) throw new Error('missing support case fixture');
  // readiness 는 Agent 자신의 신원으로 보고한다 — 종단 테스트가 bearer 레인으로 남긴다.
  await seedCanonicalSttConsent(env, counselor, scope.support_case_id);
  return session.id;
}

describe('E6-4 pairing credentials', () => {
  it('stores only hashes and spends the pairing code exactly once', async () => {
    const { pairingCode, grant } = await pair();
    const rows = (await t.db.prepare('SELECT kind, token_hash, consumed_at FROM agent_credentials ORDER BY kind')
      .all<{ kind: string; token_hash: string; consumed_at: string | null }>()).results;
    expect(rows.map((row) => row.kind)).toEqual(['bearer', 'pairing_code', 'refresh']);
    expect(rows.find((row) => row.kind === 'pairing_code')).toMatchObject({
      token_hash: await sha256Hex(pairingCode),
    });
    expect(rows.find((row) => row.kind === 'pairing_code')?.consumed_at).not.toBeNull();
    // 어떤 행에도 평문이 없다.
    const persisted = JSON.stringify(rows);
    for (const secret of [pairingCode, grant.bearerToken, grant.refreshToken]) {
      expect(persisted).not.toContain(secret);
    }
    // 같은 issuedAt 에서 파생하므로 두 만료의 차이가 두 TTL 을 동시에 증명한다.
    expect(Date.parse(grant.refreshExpiresAt) - Date.parse(grant.bearerExpiresAt))
      .toBe(REFRESH_TTL_MS - BEARER_TTL_MS);
    expect(Date.parse(grant.bearerExpiresAt)).toBeLessThanOrEqual(Date.now() + BEARER_TTL_MS);

    const reuse = await post('/agents/pair', { pairingCode });
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ error: 'actor_authentication_required' });
  });

  it('rotates the refresh credential and closes the installation when a spent value returns', async () => {
    const { grant, installationId } = await pair();
    const rotation = await post('/agents/token', { refreshToken: grant.refreshToken });
    expect(rotation.status).toBe(201);
    const rotated = await rotation.json() as AgentCredentialGrant;
    expect(rotated.refreshToken).not.toBe(grant.refreshToken);
    expect(rotated.bearerToken).not.toBe(grant.bearerToken);
    expect(await resolveAgentBearer(env, rotated.bearerToken)).toMatchObject({
      userId: agentActorUserId(installationId),
    });

    const reuse = await post('/agents/token', { refreshToken: grant.refreshToken });
    expect(reuse.status).toBe(401);
    // 재사용은 그 설치의 모든 자격을 닫는다 — 회전으로 받은 새 값까지.
    await expect(resolveAgentBearer(env, rotated.bearerToken)).rejects.toThrow(ActorAuthenticationError);
    expect((await post('/agents/token', { refreshToken: rotated.refreshToken })).status).toBe(401);
    expect(await t.db.prepare("SELECT reason FROM auth_revocations WHERE kind='actor' AND subject=?")
      .bind(agentActorUserId(installationId)).first()).toEqual({ reason: 'pairing-revoked' });
  });

  it('closes the installation when a concurrent rotation consumed the same refresh first', async () => {
    const { grant, installationId } = await pair();
    // 경쟁을 재현한다: 회전의 CAS 가 돌기 직전에 다른 요청이 같은 행을 소비한다.
    const prepare = env.DB.prepare.bind(env.DB);
    let raced = false;
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql);
      if (raced || !sql.startsWith('UPDATE agent_credentials SET consumed_at')) return statement;
      raced = true;
      return {
        bind: (...values: unknown[]) => {
          const bound = statement.bind(...values as string[]);
          return {
            run: async () => {
              await t.db.prepare(
                "UPDATE agent_credentials SET consumed_at = ? WHERE kind = 'refresh' AND consumed_at IS NULL",
              ).bind(new Date().toISOString()).run();
              return bound.run();
            },
          } as unknown as PreparedStatement;
        },
      } as unknown as PreparedStatement;
    });

    await expect(rotateAgentRefreshCredential(env, grant.refreshToken)).rejects.toThrow(ActorAuthenticationError);
    // 진 쪽이 맨 401 로 끝나지 않는다 — 재사용과 같은 종결이 일어난다(S2 §2.4 L136).
    expect(await t.db.prepare("SELECT reason FROM auth_revocations WHERE kind='actor' AND subject=?")
      .bind(agentActorUserId(installationId)).first()).toEqual({ reason: 'pairing-revoked' });
    expect(await t.db.prepare(
      'SELECT count(*) AS live FROM agent_credentials WHERE installation_id=? AND revoked_at IS NULL',
    ).bind(installationId).first()).toEqual({ live: 0 });
  });

  it('refuses an expired bearer, a revoked installation and a linked row that stopped being a service principal', async () => {
    const { grant, installationId } = await pair();
    expect(await resolveAgentBearer(env, grant.bearerToken)).toEqual({
      kind: 'agent',
      userId: agentActorUserId(installationId),
      orgId: service.orgId,
      roles: ['service'],
      scopes: ['jobs:claim', 'jobs:heartbeat', 'jobs:result', 'jobs:release', 'audio:read', 'source:read'],
      authn: { source: 'agent-bearer', assurance: 'none', sessionId: null },
    });
    // 자격 행은 불변이라 시간을 옮길 수 없다. 만료 경계는 만료된 자격을 심어서 본다.
    const expired = 'synthetic-expired-bearer';
    await t.db.prepare(
      `INSERT INTO agent_credentials (id, installation_id, kind, token_hash, issued_at, expires_at)
       VALUES (?, ?, 'bearer', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), installationId, await sha256Hex(expired),
      new Date(Date.now() - BEARER_TTL_MS - 1_000).toISOString(), new Date(Date.now() - 1_000).toISOString(),
    ).run();
    await expect(resolveAgentBearer(env, expired)).rejects.toThrow(ActorAuthenticationError);
    // 모르는 값은 이 레인의 결론이 아니라 사람 레인으로 흐른다.
    expect(await resolveAgentBearer(env, 'synthetic-unknown-bearer')).toBeNull();

    await t.db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(service.userId).run();
    await expect(resolveAgentBearer(env, grant.bearerToken)).rejects.toThrow(ForbiddenError);
    await t.db.prepare('UPDATE users SET active = 1 WHERE id = ?').bind(service.userId).run();

    const revoked = await revokeAgentInstallation(env, admin, installationId);
    await expect(resolveAgentBearer(env, grant.bearerToken)).rejects.toThrow(ActorAuthenticationError);
    expect((await post('/agents/token', { refreshToken: grant.refreshToken })).status).toBe(401);
    // 폐기는 단방향이고 두 번째 요청은 같은 시각을 그대로 돌려준다.
    expect((await revokeAgentInstallation(env, admin, installationId)).revokedAt).toBe(revoked.revokedAt);
  });

  it('keeps issue and revoke inside the administrator surface of one organization', async () => {
    const { grant, installationId } = await pair();
    await expect(issueAgentPairingCode(env, counselor, { actorUserId: service.userId }))
      .rejects.toThrow(ForbiddenError);
    await expect(issueAgentPairingCode(env, admin, { actorUserId: counselor.userId }))
      .rejects.toThrow(ForbiddenError);
    await expect(revokeAgentInstallation(env, otherOrgAdmin, installationId)).rejects.toThrow(ForbiddenError);

    const issued = await post('/agents/pairing-codes', { actorUserId: service.userId }, {
      bearer: 'human-jwt-fixture', actor: adminActor,
    });
    expect(issued.status, await issued.clone().text()).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const body = await issued.json() as { installationId: string; pairingCode: string };
    expect(body.pairingCode).not.toBe('');

    const revoked = await post(`/agents/${body.installationId}/revoke`, {}, {
      bearer: 'human-jwt-fixture', actor: adminActor,
    });
    expect(revoked.status).toBe(200);
    // 깨진 퍼센트 인코딩은 업무 오류(400)다 — 다른 id route 와 같은 답이다.
    const malformed = await post('/agents/%E0%A4%A/revoke', {}, {
      bearer: 'human-jwt-fixture', actor: adminActor,
    });
    expect(malformed.status, await malformed.clone().text()).toBe(400);
    // Agent 자신은 이 표면에 들어오지 못한다(S2 §2.2 L83).
    expect((await post('/agents/pairing-codes', { actorUserId: service.userId }, { bearer: grant.bearerToken })).status)
      .toBe(403);
  });

  it('carries the bearer through claim, heartbeat and the storage authorize agent lane', async () => {
    const { grant, installationId } = await pair();
    const sessionId = await createSession();
    const stored = await registerFixtureRecording(env, counselor, service, sessionId, CLOUD_RUNTIME);
    const qualification = await seedNerQualification(t.db);
    // claim 후보는 이 신원이 보고한 readiness 를 요구한다. 장비 신원이 곧 자격이다.
    const readiness = await post('/pipeline/readiness', {
      schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
    }, { bearer: grant.bearerToken });
    expect(readiness.status, await readiness.clone().text()).toBe(200);
    const claimed = await post('/pipeline/jobs/claim', claimRequest(qualification), { bearer: grant.bearerToken });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const jobs = (await claimed.json() as { jobs: Array<{ jobId: string; claimToken: string; attempt: number }> }).jobs;
    const job = jobs[0];
    if (job === undefined) throw new Error('expected a claimed audio job');
    // job 결합은 Actor.userId 를 그대로 쓴다(S2 L64 형식이 그대로 흐르는지).
    expect(await t.db.prepare('SELECT lease_owner FROM agent_jobs WHERE id = ?').bind(job.jobId).first())
      .toEqual({ lease_owner: agentActorUserId(installationId) });

    const heartbeat = await post(`/pipeline/jobs/${job.jobId}/heartbeat`, {
      claimToken: job.claimToken, attempt: job.attempt,
    }, { bearer: grant.bearerToken });
    expect(heartbeat.status, await heartbeat.clone().text()).toBe(200);

    const authorize = await post('/internal/storage/authorize', {
      bucket: 'ccc-audio',
      objectKey: stored.key,
      action: 'agent_read',
      principal: 'agent',
      objectSha256: null,
      context: { kind: 'claim', jobId: job.jobId, claimToken: job.claimToken, attempt: job.attempt },
    }, { bearer: grant.bearerToken });
    expect(authorize.status, await authorize.clone().text()).toBe(200);
    expect(await authorize.json()).toMatchObject({ allowed: true, generationId: stored.generationId });
  });

  it('lets a human bearer pass the agent lane to the existing identity', async () => {
    await pair();
    const me = await handleRequest(new Request('https://api.example.invalid/me', {
      headers: { authorization: 'Bearer human-jwt-fixture' },
    }), env, resolver());
    expect(me.status, await me.clone().text()).toBe(200);
    expect(await me.json()).toMatchObject({ id: counselor.userId, orgId: counselor.orgId });
    const unknown = await handleRequest(new Request('https://api.example.invalid/me', {
      headers: { authorization: 'Bearer synthetic-unknown-bearer' },
    }), env, resolver());
    expect(unknown.status).toBe(401);
  });
});
