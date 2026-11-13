import { it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { handleRequest } from '../../packages/http-api/src/request-handler';
import worker from '../../apps/api/src/index';
import { createD1TestContext, testActors, testProgramId } from '../../apps/api/test/support/d1';
import { registrationInput } from '../../apps/api/test/support/registration';
import { intakeInput } from '../../apps/api/test/support/intake';
import { createTestSigner, signedManifest } from '../../apps/api/test/support/install-manifest';

const events: unknown[] = [];
function shape(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { array: [...new Set(value.map(v => JSON.stringify(shape(v))))].map(v => JSON.parse(v)) };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,shape(v)]));
  return typeof value;
}
function summarize(label: string, request: Request, response: Response, payload: unknown) {
  events.push({ label, method: request.method, path: new URL(request.url).pathname.replace(/(\/invites\/(?:participant|worker)\/)[^/?]+/, '$1:token'), status: response.status,
    requestCredentialPresence: { authorization: request.headers.has('authorization'), cookie: request.headers.has('cookie'), access: request.headers.has('cf-access-jwt-assertion') || request.headers.has('x-ccc-access-jwt') },
    shape: shape(payload), error: payload && typeof payload === 'object' && 'error' in payload ? payload.error : null,
    cookieIssued: response.headers.has('set-cookie') });
}

it('collects actual synthetic HTTP responses and serves the pinned Next correspondence run', async () => {
  const context = await createD1TestContext();
  const signer = await createTestSigner();
  const env = { ...context.env, CCC_LLM_MODE: 'off', CCC_STT_MODE: 'off', PUBLIC_SIGNUP_ENABLED: '1',
    CCC_INSTALL_MANIFEST: JSON.stringify(await signedManifest(signer, 'community-cloud')),
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys) };
  const preview = { ...env, PREVIEW_MODE: 'true', PREVIEW_ACCESS_CODE: 'ccc201-synthetic-counselor', PREVIEW_ACTOR_EMAIL: testActors.counselor.userId,
    PREVIEW_ADMIN_ACCESS_CODE: 'ccc201-synthetic-admin', PREVIEW_ADMIN_ACTOR_EMAIL: testActors.admin.userId };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('ccc201_external_egress_forbidden');
    return originalFetch(input, init);
  };
  async function call(label: string, path: string, method = 'GET', body?: unknown, actor = testActors.counselor, actualWorkerEnv?: typeof env) {
    const request = new Request(`http://127.0.0.1${path}`, { method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const response = actualWorkerEnv ? await worker.fetch(request, actualWorkerEnv) : await handleRequest(request, env, async () => actor);
    const payload = await response.clone().json().catch(() => null);
    summarize(label, request, response, payload);
    return { response, payload };
  }
  let server: Server | undefined;
  try {
    const created = await call('registration-real-http', '/participants', 'POST', await registrationInput(env, testActors.counselor,
      { programId: testProgramId('org_demo'), name: '합성 당사자', email: 'participant@example.invalid' },
      { counseling_recording: 'decline', external_stt_processing: 'decline', external_llm_cross_border_processing: 'decline', voice_original_retention_period: 'decline' }));
    expect(created.response.status).toBe(201);
    const { beneficiaryId, supportCaseId } = created.payload;
    const intake = await call('intake-v2-real-http', `/support-cases/${supportCaseId}/records/intake`, 'POST', await intakeInput(env, testActors.counselor, supportCaseId));
    expect(intake.response.status).toBe(201);
    const manualInput = { schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-12T09:00:00.000Z', channel: 'in_person', memo: '합성 수기 기록', nextQuestions: ['다음 상담에서 확인할 합성 질문'] };
    const manual = await call('manual-v2-real-http', `/support-cases/${supportCaseId}/records`, 'POST', manualInput);
    expect(manual.response.status).toBe(201);
    const sessionId = manual.payload.record.id;
    const schedule = await call('schedule-real-http', '/schedules', 'POST', { beneficiaryId, supportCaseId, scheduledAt: '2026-09-20T09:00:00.000Z', customQuestions: ['합성 일정 질문'] });
    expect(schedule.response.status).toBe(201);
    const participantInvite = await call('invite-issuance-real-http', '/invites/participant', 'POST', { programId: testProgramId('org_demo') });
    expect(participantInvite.response.status).toBe(201);
    const inviteToken = participantInvite.payload.token;
    const paths = ['/me','/capabilities','/organization/profile','/participants','/participants/new-signup-count','/schedules/candidates',
      `/participants/${beneficiaryId}/hub`, `/participants/${beneficiaryId}/support-cases`, `/participants/${beneficiaryId}/goal-tree`,
      `/participants/${beneficiaryId}/basic-info`, `/participants/${beneficiaryId}/programs/${supportCaseId}/briefing`,
      `/support-cases/${supportCaseId}/records?official=true`, `/support-cases/${supportCaseId}/records/intake`,
      `/support-cases/${supportCaseId}/records/context`, `/support-cases/${supportCaseId}/report`, `/support-cases/${supportCaseId}/closure`,
      `/schedules/${schedule.payload.id}/plan`, '/schedules/today','/schedules/upcoming','/schedules/month?month=2026-09',
      '/assignment-requests', '/settings/counseling-memory', `/sessions/${sessionId}/ai`];
    for (const path of paths) await call('assigned-human-read', path);
    for (const path of ['/me','/users','/organization/profile','/ai/provider/status','/pii-retention/reviews','/pipeline/health']) await call('admin-read', path, 'GET', undefined, testActors.admin);
    for (const actor of [testActors.unassignedCounselor, testActors.otherOrgCounselor, testActors.service]) {
      await call(`scope-${actor.role}-${actor.orgId}`, `/support-cases/${supportCaseId}/records?official=true`, 'GET', undefined, actor);
    }
    const publicRead = await call('production-token-only', `/invites/participant/${inviteToken}`, 'GET', undefined, testActors.counselor, env);
    expect(publicRead.response.status).toBe(200);
    const closed = await call('production-signup-off', `/invites/participant/${inviteToken}`, 'GET', undefined, testActors.counselor, { ...env, PUBLIC_SIGNUP_ENABLED: undefined });
    expect(closed.response.status).toBe(404);
    const previewDenied = await call('preview-requires-cookie', `/invites/participant/${inviteToken}`, 'GET', undefined, testActors.counselor, preview);
    expect(previewDenied.response.status).toBe(401);
    const unauthenticated = await call('production-human-no-credential', '/me', 'GET', undefined, testActors.counselor, env);
    expect(unauthenticated.response.status).toBe(401);
    const unlock = await call('preview-unlock-real-worker', '/preview/unlock', 'POST', { code: preview.PREVIEW_ACCESS_CODE }, testActors.counselor, preview);
    expect(unlock.response.status).toBe(200);
    expect(Object.keys(unlock.payload).sort()).toEqual(['expiresAt','maxAgeSeconds','token']);
    const capabilities = await call('activation-stays-off', '/capabilities');
    expect(capabilities.payload.sttEngine).toBeNull();
    expect(capabilities.payload.sttMode).toBe('off');
    const missingManifest = await handleRequest(new Request('http://127.0.0.1/capabilities'),
      { ...env, CCC_INSTALL_MANIFEST: undefined }, async () => testActors.counselor);
    expect(missingManifest.status).toBe(503);
    summarize('missing-manifest-fail-closed', new Request('http://127.0.0.1/capabilities'), missingManifest, await missingManifest.json());
    const finished = Promise.withResolvers<void>();
    server = createServer(async (incoming, outgoing) => {
      try {
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1:43981');
        if (url.pathname === '/__ccc201/observations') {
          outgoing.setHeader('content-type','application/json'); outgoing.end(JSON.stringify(events)); return;
        }
        if (url.pathname === '/__ccc201/fixture') {
          outgoing.setHeader('content-type','application/json'); outgoing.end(JSON.stringify({ beneficiaryId, supportCaseId, sessionId, scheduleId: schedule.payload.id, inviteToken })); return;
        }
        if (url.pathname === '/__ccc201/finish' && incoming.method === 'POST') {
          outgoing.end('finished'); finished.resolve(); return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(url, { method: incoming.method, headers: incoming.headers as Record<string,string>,
          ...(['GET','HEAD'].includes(incoming.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) });
        const response = await worker.fetch(request, preview);
        const payload = await response.clone().json().catch(() => null);
        summarize('next-loopback-real-worker', request, response, payload);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500); outgoing.end('ccc201_probe_transport_error');
      }
    });
    await new Promise<void>(resolve => server!.listen(43981, '127.0.0.1', resolve));
    console.log('CCC201_REAL_API_READY');
    await finished.promise;
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    await context.dispose();
    writeFileSync(process.env.CCC201_OUTPUT!, JSON.stringify({ evidenceKind:'actual_request_response_and_loopback_http', events }, null, 2) + '\n');
  }
}, 1_200_000);
