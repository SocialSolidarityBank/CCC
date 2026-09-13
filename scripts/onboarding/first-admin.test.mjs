import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  beginFirstAdmin,
  createSupabaseAuthAdmin,
  planFirstAdmin,
  resumeFirstAdmin,
} from './first-admin.mjs';

const email = 'first.admin@example.invalid';
const subject = '00000000-0000-4000-8000-000000000001';
const marker = 'm'.repeat(64);
const hash = 'a'.repeat(64);

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'relayer-first-admin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = {
    now: Date.parse('2026-09-13T12:00:00.000Z'),
    institution: 'missing',
    firstAdmin: 'empty',
    users: [],
    sends: 0,
    links: [],
  };
  let held = false;
  const services = {
    // Try-lock semantics of the session-scoped project advisory lock the default services use.
    withLock: async run => {
      if (held) throw Object.assign(new Error('FIRST_ADMIN_IN_PROGRESS'), { code: 'FIRST_ADMIN_IN_PROGRESS' });
      held = true;
      try { return await run(); } finally { held = false; }
    },
    now: () => state.now,
    marker: () => marker,
    verifyInstallation: async () => ({
      projectRefSha256: hash,
      runtimeManifestSha256: 'b'.repeat(64),
      approvalSha256: 'c'.repeat(64),
      stateFingerprint: 'd'.repeat(64),
      productionReady: true,
    }),
    inspectFirstAdmin: async () => ({ state: state.firstAdmin }),
    inspectInstitution: async () => state.institution === 'present'
      ? { state: 'ready', sttMode: 'off', llmMode: 'off' }
      : state.institution === 'missing' ? { state: 'missing' } : { state: state.institution },
    createInstitution: async () => {
      state.institution = 'present';
      return { ok: true, ready: true, sttMode: 'off', llmMode: 'off' };
    },
    listAuthUsers: async () => state.users.map(user => ({ ...user, userMetadata: { ...user.userMetadata } })),
    inviteAuthUser: async ({ marker: sentMarker }) => {
      state.sends += 1;
      const user = {
        id: subject,
        email,
        invitedAt: new Date(state.now).toISOString(),
        confirmedAt: null,
        lastSignInAt: null,
        userMetadata: { relayerFirstAdmin: sentMarker },
      };
      state.users.push(user);
      return user;
    },
    inviteTtlSeconds: async () => 3600,
    linkFirstAdmin: async identity => {
      if (state.firstAdmin !== 'linked') {
        state.links.push(identity);
        state.firstAdmin = 'linked';
      }
      return {
        ok: true,
        ready: true,
        userIdSha256: 'e'.repeat(64),
        emailSha256: 'f'.repeat(64),
        authSubjectSha256: '1'.repeat(64),
      };
    },
    ...overrides,
  };
  return {
    state,
    services,
    options: {
      request: { schemaVersion: 1, requestId: '00000000-0000-4000-8000-000000000099' },
      installation: { projectRef: 'abcdefghijklmnopqrst' },
      journalPath: join(directory, 'cloud.json'),
      email,
      name: '첫 관리자',
    },
  };
}

test('승인 전에는 기관 생성과 초대 발송을 하지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  assert.equal(plan.summary.emailSha256.length, 64);
  assert.equal(JSON.stringify(plan).includes(email), false);
  assert.equal(state.institution, 'missing');
  assert.equal(state.sends, 0);
  await assert.rejects(
    () => beginFirstAdmin(options, services),
    error => error.code === 'FIRST_ADMIN_APPROVAL_REQUIRED',
  );
  assert.equal(state.institution, 'missing');
  assert.equal(state.sends, 0);
});

test('발송 응답 유실과 같은 요청 재개는 초대를 다시 보내지 않는다', async t => {
  let loseResponse = true;
  const { options, services, state } = await fixture(t, {
    inviteAuthUser: async input => {
      state.sends += 1;
      state.users.push({
        id: subject,
        email,
        invitedAt: new Date(state.now).toISOString(),
        confirmedAt: null,
        lastSignInAt: null,
        userMetadata: { relayerFirstAdmin: input.marker },
      });
      if (loseResponse) {
        loseResponse = false;
        throw Object.assign(new Error('provider response was lost'), { code: 'PROVIDER_UNREADABLE' });
      }
      return state.users[0];
    },
  });
  const plan = await planFirstAdmin(options, services);
  const sent = await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  assert.equal(sent.status, 'invited');
  assert.equal(state.sends, 1);
  const resumed = await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  assert.equal(resumed.status, 'invited');
  assert.equal(state.sends, 1);

  const journal = await readFile(`${options.journalPath}.first-admin.invited`, 'utf8');
  assert.equal(journal.includes(email), false);
  assert.equal(journal.includes(subject), false);
  assert.equal(journal.includes(marker), false);
  assert.notEqual(JSON.parse(journal).sentAt, null);
  const claim = await readFile(`${options.journalPath}.first-admin.submission`, 'utf8');
  assert.equal(claim.includes(email), false);
  assert.equal(claim.includes(subject), false);
  assert.equal(claim.includes(marker), false);
});

test('승인 기록 뒤 중단되면 재개가 기관 생성부터 이어서 초대는 한 번만 보낸다', async t => {
  let interrupted = true;
  const { options, services, state } = await fixture(t, {
    createInstitution: async () => {
      if (interrupted) {
        interrupted = false;
        throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      }
      state.institution = 'present';
      return { ok: true, ready: true, sttMode: 'off', llmMode: 'off' };
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  assert.equal(state.sends, 0);
  const resumed = await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  assert.equal(resumed.status, 'invited');
  assert.equal(state.sends, 1);
});

test('승인 뒤 Auth 대상이 바뀌면 재개한 invite는 다시 보내지 않는다', async t => {
  let interrupted = true;
  const { options, services, state } = await fixture(t, {
    createInstitution: async () => {
      if (interrupted) {
        interrupted = false;
        throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      }
      state.institution = 'present';
      return { ok: true, ready: true, sttMode: 'off', llmMode: 'off' };
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  state.users.push({
    id: subject,
    email,
    invitedAt: new Date(state.now).toISOString(),
    confirmedAt: null,
    lastSignInAt: null,
    userMetadata: {},
  });
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'FIRST_ADMIN_EMAIL_TAKEN',
  );
  assert.equal(state.sends, 0);
});

test('기관 생성 뒤 상태가 달라지면 재개한 invite는 보내지 않는다', async t => {
  let ttlCalls = 0;
  const { options, services, state } = await fixture(t, {
    inviteTtlSeconds: async () => {
      ttlCalls += 1;
      if (ttlCalls === 3) throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      return 3600;
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  state.institution = 'inconsistent';
  services.inviteTtlSeconds = async () => 3600;
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'INSTITUTION_STATE_INCONSISTENT',
  );
  assert.equal(state.sends, 0);
});

test('동시에 재개한 invite 중 하나만 잠금을 얻고 다른 하나는 진행 중으로 멈춘다', async t => {
  let ttlCalls = 0;
  const { options, services, state } = await fixture(t, {
    inviteTtlSeconds: async () => {
      ttlCalls += 1;
      if (ttlCalls === 3) throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      return 3600;
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  services.inviteTtlSeconds = async () => 3600;
  const outcomes = await Promise.allSettled([
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
  ]);
  assert.equal(state.sends, 1);
  assert.equal(outcomes.some(outcome => outcome.status === 'fulfilled'
    && outcome.value.status === 'invited'), true);
  assert.equal(outcomes.some(outcome => outcome.status === 'rejected'
    && outcome.reason.code === 'FIRST_ADMIN_IN_PROGRESS'), true);
});

test('잠금 세션이 끊겨 두 프로세스가 같은 단계에 들어와도 발송은 한 번뿐이다', async t => {
  let ttlCalls = 0;
  const { options, services, state } = await fixture(t, {
    withLock: run => run(),
    inviteTtlSeconds: async () => {
      ttlCalls += 1;
      if (ttlCalls === 3) throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      return 3600;
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  services.inviteTtlSeconds = async () => 3600;
  const outcomes = await Promise.allSettled([
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
  ]);
  assert.equal(state.sends, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.some(outcome => outcome.status === 'rejected'
    && outcome.reason.code === 'FIRST_ADMIN_INVITE_OUTCOME_UNKNOWN'), true);
  assert.equal((await resumeFirstAdmin(options, services)).status, 'invited');
});

test('잠금을 잃은 발송 콜백이 늦게 돌아와도 더 나아간 완료 기록을 되돌리지 않는다', async t => {
  let release;
  const { options, services, state } = await fixture(t, {
    withLock: run => run(),
    inviteAuthUser: async ({ marker: sentMarker }) => {
      state.sends += 1;
      const user = {
        id: subject,
        email,
        invitedAt: new Date(state.now).toISOString(),
        confirmedAt: new Date(state.now + 60_000).toISOString(),
        lastSignInAt: new Date(state.now + 120_000).toISOString(),
        userMetadata: { relayerFirstAdmin: sentMarker },
      };
      state.users.push(user);
      await new Promise(resolve => { release = resolve; });
      return user;
    },
  });
  const plan = await planFirstAdmin(options, services);
  const stale = beginFirstAdmin({ ...options, approved: plan.binding }, services);
  while (release === undefined) await new Promise(resolve => setTimeout(resolve, 5));
  state.now += 180_000;
  assert.equal((await resumeFirstAdmin(options, services)).status, 'bound');
  release();
  await assert.rejects(stale, error => error.code === 'FIRST_ADMIN_STATE_INCONSISTENT');
  assert.equal(state.sends, 1);
  assert.equal(state.links.length, 1);
  assert.equal((await resumeFirstAdmin(options, services)).status, 'bound');
});

test('approved 단계의 느린 경쟁 프로세스가 발송 기록을 되돌리지 않는다', async t => {
  let creates = 0;
  const { options, services, state } = await fixture(t, {
    createInstitution: async () => {
      creates += 1;
      if (creates === 1) {
        throw Object.assign(new Error('process interrupted'), { code: 'PROCESS_INTERRUPTED' });
      }
      if (creates === 3) await new Promise(resolve => setTimeout(resolve, 50));
      state.institution = 'present';
      return { ok: true, ready: true, sttMode: 'off', llmMode: 'off' };
    },
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'PROCESS_INTERRUPTED',
  );
  await Promise.allSettled([
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
    beginFirstAdmin({ ...options, approved: plan.binding }, services),
  ]);
  assert.equal(state.sends, 1);
  assert.equal((await resumeFirstAdmin(options, services)).status, 'invited');
});

test('초대 표식이 다른 이메일의 사용자에게 붙으면 결속하지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].email = 'different.user@example.invalid';
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.users[0].lastSignInAt = new Date(state.now).toISOString();

  await assert.rejects(
    () => resumeFirstAdmin(options, services),
    error => error.code === 'FIRST_ADMIN_INVITEE_MISMATCH',
  );
  assert.equal(state.links.length, 0);
});

test('응답 유실 뒤 같은 이메일이지만 초대 표식이 없는 사용자는 결속하지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].userMetadata = {};
  await assert.rejects(
    () => resumeFirstAdmin(options, services),
    error => error.code === 'FIRST_ADMIN_INVITEE_MISMATCH',
  );
  assert.equal(state.links.length, 0);
});

test('수락한 사용자의 확인된 subject를 결속하고 aal1 첫 로그인을 막지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.users[0].lastSignInAt = new Date(state.now).toISOString();

  const linked = await resumeFirstAdmin(options, services);
  assert.deepEqual(linked, {
    operation: 'first-admin',
    ready: true,
    status: 'bound',
    institutionReady: true,
    invitationSent: true,
    invitationAccepted: true,
    identityBound: true,
    mfa: 'optional',
    onboardingSttMode: 'off',
    onboardingLlmMode: 'off',
    emailSha256: 'f'.repeat(64),
    authSubjectSha256: '1'.repeat(64),
    userIdSha256: 'e'.repeat(64),
  });
  assert.deepEqual(state.links, [{ authSubject: subject, email, name: '첫 관리자' }]);

  const again = await resumeFirstAdmin(options, services);
  assert.equal(again.status, 'bound');
  assert.equal(state.links.length, 1);

  const journal = JSON.parse(await readFile(`${options.journalPath}.first-admin.bound`, 'utf8'));
  assert.notEqual(journal.acceptedAt, null);
  assert.notEqual(journal.boundAt, null);
});

test('초대 수락은 첫 로그인과 따로 기록하고 수락 뒤에는 만료로 되돌리지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.now += 3600_001;
  const accepted = await resumeFirstAdmin(options, services);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.invitationAccepted, true);
  assert.equal(accepted.identityBound, false);
  assert.equal(state.links.length, 0);
  const journal = JSON.parse(await readFile(`${options.journalPath}.first-admin.accepted`, 'utf8'));
  assert.notEqual(journal.acceptedAt, null);
  assert.equal(journal.boundAt, null);
});

test('연결 커밋 뒤 응답 유실은 같은 영수증을 읽어 완료한다', async t => {
  let loseResponse = true;
  const { options, services, state } = await fixture(t);
  const originalLink = services.linkFirstAdmin;
  services.linkFirstAdmin = async identity => {
    const result = await originalLink(identity);
    if (loseResponse) {
      loseResponse = false;
      throw Object.assign(new Error('link response was lost'), { code: 'PROVIDER_UNREADABLE' });
    }
    return result;
  };
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.users[0].lastSignInAt = new Date(state.now).toISOString();
  await assert.rejects(
    () => resumeFirstAdmin(options, services),
    error => error.code === 'PROVIDER_UNREADABLE',
  );
  const recovered = await resumeFirstAdmin(options, services);
  assert.equal(recovered.status, 'bound');
  assert.equal(recovered.ready, true);
  assert.equal(state.links.length, 1);
});

test('완료 기록 재개는 기존 연결 영수증의 해시가 다르면 성공으로 보지 않는다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.users[0].lastSignInAt = new Date(state.now).toISOString();
  await resumeFirstAdmin(options, services);
  services.linkFirstAdmin = async () => ({
    ok: true,
    ready: true,
    userIdSha256: '2'.repeat(64),
    emailSha256: '3'.repeat(64),
    authSubjectSha256: '4'.repeat(64),
  });
  await assert.rejects(
    () => resumeFirstAdmin(options, services),
    error => error.code === 'FIRST_ADMIN_STATE_INCONSISTENT',
  );
});

test('완료 기록의 링크 필드에 다른 값이 끼면 보고하지 않고 거부한다', async t => {
  const { options, services, state } = await fixture(t);
  const plan = await planFirstAdmin(options, services);
  await beginFirstAdmin({ ...options, approved: plan.binding }, services);
  state.users[0].confirmedAt = new Date(state.now).toISOString();
  state.users[0].lastSignInAt = new Date(state.now).toISOString();
  await resumeFirstAdmin(options, services);
  const path = `${options.journalPath}.first-admin.bound`;
  const journal = JSON.parse(await readFile(path, 'utf8'));
  journal.link.unexpected = 'must-not-be-reported';
  await writeFile(path, JSON.stringify(journal), { mode: 0o600 });
  await assert.rejects(
    () => resumeFirstAdmin(options, services),
    error => error.code === 'FIRST_ADMIN_JOURNAL_INVALID',
  );
});

test('만료된 초대와 기존 최초 관리자는 발송 또는 결속 없이 거부한다', async t => {
  await t.test('만료', async t => {
    const { options, services, state } = await fixture(t);
    const plan = await planFirstAdmin(options, services);
    await beginFirstAdmin({ ...options, approved: plan.binding }, services);
    state.now += 3600_001;
    await assert.rejects(
      () => resumeFirstAdmin(options, services),
      error => error.code === 'FIRST_ADMIN_INVITE_EXPIRED',
    );
    assert.equal(state.links.length, 0);
  });

  await t.test('기존 관리자', async t => {
    const { options, services, state } = await fixture(t);
    state.firstAdmin = 'linked';
    await assert.rejects(
      () => planFirstAdmin(options, services),
      error => error.code === 'FIRST_ADMIN_EXISTS',
    );
    assert.equal(state.sends, 0);
  });
});

test('기관 반쪽 상태를 덮어쓰거나 초대를 보내지 않는다', async t => {
  const { options, services, state } = await fixture(t, {
    createInstitution: async () => ({ ok: false, code: 'INSTITUTION_STATE_INCONSISTENT' }),
  });
  const plan = await planFirstAdmin(options, services);
  await assert.rejects(
    () => beginFirstAdmin({ ...options, approved: plan.binding }, services),
    error => error.code === 'INSTITUTION_STATE_INCONSISTENT',
  );
  assert.equal(state.sends, 0);
});

test('Supabase Auth 관리자 경계는 초대와 관찰 결과만 좁혀 돌려준다', async () => {
  const requests = [];
  const rawUser = {
    id: subject,
    email,
    invited_at: '2026-09-13T12:00:00.000Z',
    confirmed_at: null,
    last_sign_in_at: null,
    user_metadata: { relayerFirstAdmin: marker, unrelated: 'ignored' },
  };
  const auth = createSupabaseAuthAdmin({
    authOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
    projectRef: 'abcdefghijklmnopqrst',
    serviceRoleKey: 'service-role-secret-value',
    managementAccessToken: 'management-secret-value',
    redirectTo: 'https://app.example.invalid/auth/invite',
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      requests.push({ url, init });
      if (url.hostname === 'api.supabase.com') {
        return new Response(JSON.stringify({ mailer_otp_exp: 3600, disable_signup: true }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (init.method === 'POST') {
        assert.deepEqual(JSON.parse(init.body), {
          email, data: { relayerFirstAdmin: marker },
        });
        return new Response(JSON.stringify(rawUser), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ users: [rawUser] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-total-count': '1' },
      });
    },
  });

  assert.equal(await auth.inviteTtlSeconds(), 3600);
  const invited = await auth.inviteAuthUser({ email, marker });
  assert.deepEqual(invited, {
    id: subject,
    email,
    invitedAt: rawUser.invited_at,
    confirmedAt: null,
    lastSignInAt: null,
    userMetadata: { relayerFirstAdmin: marker },
  });
  assert.deepEqual(await auth.listAuthUsers(), [invited]);
  assert.equal(requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal(requests.some(request => request.url.search.includes(email)), false);
  assert.equal(
    requests.find(request => request.init.method === 'POST')?.url.searchParams.get('redirect_to'),
    'https://app.example.invalid/auth/invite',
  );
});

test('서명된 클라이언트의 초대 수락 경로가 없으면 Auth 초대를 만들지 않는다', () => {
  assert.throws(
    () => createSupabaseAuthAdmin({
      authOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
      projectRef: 'abcdefghijklmnopqrst',
      serviceRoleKey: 'service-role-secret-value',
      managementAccessToken: 'management-secret-value',
      fetch: async () => new Response('{}'),
    }),
    error => error.code === 'FIRST_ADMIN_CALLBACK_UNAVAILABLE',
  );
});

test('공개 Auth 가입이 열려 있으면 첫 관리자 초대를 시작하지 않는다', async () => {
  const auth = createSupabaseAuthAdmin({
    authOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
    projectRef: 'abcdefghijklmnopqrst',
    serviceRoleKey: 'service-role-secret-value',
    managementAccessToken: 'management-secret-value',
    redirectTo: 'https://app.example.invalid/auth/invite',
    fetch: async () => new Response(JSON.stringify({
      mailer_otp_exp: 3600,
      disable_signup: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(
    () => auth.inviteTtlSeconds(),
    error => error.code === 'FIRST_ADMIN_OPEN_SIGNUP_ENABLED',
  );
});

test('Supabase 공급자 오류 원문은 고정 code 밖으로 나오지 않는다', async () => {
  const auth = createSupabaseAuthAdmin({
    authOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
    projectRef: 'abcdefghijklmnopqrst',
    serviceRoleKey: 'service-role-secret-value',
    managementAccessToken: 'management-secret-value',
    redirectTo: 'https://app.example.invalid/auth/invite',
    fetch: async () => new Response(JSON.stringify({
      message: 'provider-private-detail', token: 'provider-secret',
    }), { status: 500, headers: { 'content-type': 'application/json' } }),
  });
  const failure = await auth.listAuthUsers().catch(error => error);
  assert.equal(failure.code, 'PROVIDER_UNREADABLE');
  assert.equal(JSON.stringify(failure).includes('provider-private-detail'), false);
  assert.equal(JSON.stringify(failure).includes('provider-secret'), false);
});

