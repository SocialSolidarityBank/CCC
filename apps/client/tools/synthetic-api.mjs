// 합성 전용 업무 API와 인증 서버. 실제 기관 자료, 실제 인증, 실제 사업자 연결은 없다.
// 미리보기와 브라우저 검수가 같은 응답을 쓰도록 한 곳에 둔다.

const USER_ID = 'a800424b-7cb1-49f5-8bb4-8989d586c455';
const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const CLOSED_CASE_ID = '7c1f5b02-9a2e-4d8b-9f6a-1c3b5d7e9f21';
const SCHEDULE_ID = '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80';
const SESSION_ID = '91ac47d2-38b5-4f0c-9a71-2d5e6f8a0b13';

export function createSyntheticState() {
  return {
    role: 'worker',
    mfaLevel: 'aal1',
    basicInfoVersion: 3,
    planVersion: 2,
    overallGoal: '월세 체납을 정리하고 안정적인 소득을 만든다',
    consent: { privacy: true, recordingAi: false },
    admissionCopyHash: null,
    admissionConfirmed: false,
    calls: [],
  };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'access-control-expose-headers': 'X-CCC-Installation-Id',
    'access-control-max-age': '60',
  };
}

function accessToken(state) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: USER_ID, aud: 'authenticated', role: 'authenticated', aal: state.mfaLevel, amr: [],
    session_id: 'synthetic-session', iat, exp: iat + 3600,
  })}.c3ludGhldGlj`;
}

function authUser() {
  return {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid',
    created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {},
    factors: [{
      id: 'totp-factor', factor_type: 'totp', status: 'verified', friendly_name: '합성 인증 앱',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }],
  };
}

/** 합성 Supabase Auth. 비밀번호를 검사하지 않고 어떤 실제 계정도 만들지 않는다. */
export function handleAuth(request, state, clientOrigin) {
  const url = new URL(request.url);
  const cors = corsHeaders(clientOrigin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const session = () => ({
    access_token: accessToken(state), refresh_token: 'synthetic-refresh-token',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer', user: authUser(),
  });
  if (url.pathname === '/auth/v1/token') return json(session(), 200, cors);
  if (url.pathname === '/auth/v1/user') return json(authUser(), 200, cors);
  if (url.pathname.endsWith('/challenge')) {
    return json({ id: 'challenge', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }, 200, cors);
  }
  if (url.pathname.endsWith('/verify')) {
    return request.json().then((body) => {
      if (body.code !== '123456') {
        return json({ code: 'mfa_verification_failed', error_code: 'mfa_verification_failed', msg: 'synthetic' }, 422, cors);
      }
      state.mfaLevel = 'aal2';
      const { expires_at: _computed, ...verified } = session();
      return json(verified, 200, cors);
    });
  }
  return json({ code: 'not_found' }, 404, cors);
}

function readiness(state) {
  return {
    orgId: 'org-1', orgName: '합성 기관', settingsState: 'present', creatorLinkState: 'linked',
    initialSetupState: 'complete',
    firstProgramAdmissionState: state.admissionConfirmed ? 'admitted' : 'not_admitted',
    firstProgram: {
      id: 'program-1', displayName: '금전 지원', programType: 'financial_support_v1',
      admissionState: state.admissionConfirmed ? 'ready' : 'confirmation_required',
      status: 'active', version: state.admissionConfirmed ? 4 : 3,
    },
    installationState: 'available', retentionPolicyStatus: 'configured',
    consentCopy: {
      version: 'synthetic-consent-v1', status: 'available',
      domains: [
        'personal_data_collection_use', 'sensitive_information_processing', 'counseling_recording',
        'external_stt_processing', 'external_llm_cross_border_processing', 'voice_original_retention_period',
      ].map((domain) => ({ domain, disclosureAvailable: true })),
    },
  };
}

function scheduleCard(instant, status = 'scheduled') {
  return {
    id: SCHEDULE_ID, supportCaseId: CASE_ID, beneficiaryId: 'swallow-003', scheduledAt: instant,
    programType: 'financial_support_v1', status, sessionKind: 'regular', channel: 'in_person',
    participantName: '김합성', participantPhone: '010-0000-0000', completedSessionId: null,
  };
}

function monthWindow(month) {
  // 이번 달이면 오늘 날짜에도 한 건을 둬 주간 보기가 비어 보이지 않게 한다. 전부 합성이다.
  const today = new Date().toISOString().slice(0, 10);
  const cards = [
    scheduleCard(`${month}-15T01:00:00.000Z`),
    { ...scheduleCard(`${month}-02T02:00:00.000Z`, 'completed'),
      id: '0b7d4a92-1c3e-4f58-9a2b-6d8e0f1a2b34', completedSessionId: SESSION_ID },
  ];
  if (today.slice(0, 7) === month) {
    cards.push({ ...scheduleCard(`${today}T04:00:00.000Z`), id: '3f6c8a51-2b4d-4e79-8c1a-5d7e9f0a2b46' });
  }
  return {
    date: `${month}-01`, timeZone: 'Asia/Seoul',
    startUtc: `${month}-01T00:00:00.000Z`, endUtc: `${month}-28T00:00:00.000Z`,
    schedules: cards,
  };
}

/** 합성 업무 API. 어떤 실제 저장소에도 쓰지 않고 상태는 이 프로세스 안에만 있다. */
export function handleApi(request, state, options) {
  const { clientOrigin, installationId, basePath, admissionCopyHash, admissionCopyVersion } = options;
  const url = new URL(request.url);
  const cors = corsHeaders(clientOrigin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!url.pathname.startsWith(basePath)) return json({ error: 'not_found' }, 404, cors);
  const path = url.pathname.slice(basePath.length);
  state.calls.push(`${request.method} ${path}`);
  if (request.headers.get('authorization') === null) return json({ error: 'actor_authentication_required' }, 401, cors);

  if (path === '/capabilities') {
    return json(options.capabilities, 200, { ...cors, 'X-CCC-Installation-Id': installationId });
  }
  if (path === '/me') {
    return json({
      id: 'user-1', orgId: 'org-1', email: null, name: null, active: true,
      role: state.role === 'worker' ? 'counselor' : 'admin', lastProgramType: null,
      roles: [state.role === 'worker' ? 'worker' : 'institution-admin'], institution: readiness(state),
    }, 200, cors);
  }
  if (path === '/assignment-requests') return json({ requests: [] }, 200, cors);
  if (path === '/auth/logout') return new Response(null, { status: 204, headers: cors });
  if (path === '/participants' && request.method === 'GET') {
    return json({ results: [
      { beneficiaryId: 'swallow-003', status: 'active', programCount: 2, name: '김합성', phone: '010-0000-0000', newSignup: true },
      { beneficiaryId: 'otter-011', status: 'closed', programCount: 1, name: null, phone: null, newSignup: false },
    ] }, 200, cors);
  }
  if (path === '/program-options') {
    return json({ programs: [
      { id: 'program-1', displayName: '금전 지원', programType: 'financial_support_v1', admissionState: state.admissionConfirmed ? 'ready' : 'confirmation_required' },
      { id: 'program-2', displayName: '주거 지원', programType: 'financial_support_v1', admissionState: 'undecided' },
    ] }, 200, cors);
  }
  if (path === '/participants/swallow-003/hub') {
    return json({
      beneficiaryId: 'swallow-003', participantName: '김합성', participantPhone: '010-0000-0000',
      participantEmail: 'synthetic@example.invalid',
      programs: [
        { id: CASE_ID, beneficiaryId: 'swallow-003', programType: 'financial_support_v1', status: 'active',
          intakeAt: '2026-02-01T00:00:00.000Z', creationKind: 'initial', sourceSupportCase: null,
          participantName: '김합성', participantPhone: '010-0000-0000', authorized: true,
          assigneeNames: ['담당 실무자'], consent: state.consent, consentRecordedAt: '2026-09-01T00:00:00.000Z',
          upcomingSchedule: { id: SCHEDULE_ID, scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'regular' } },
        { id: CLOSED_CASE_ID, beneficiaryId: 'swallow-003', programType: 'financial_support_v1', status: 'closed',
          intakeAt: '2026-01-05T00:00:00.000Z', creationKind: 'subsequent', sourceSupportCase: null,
          participantName: '김합성', participantPhone: '010-0000-0000', authorized: false,
          assigneeNames: ['다른 실무자'], consent: { privacy: true, recordingAi: true },
          consentRecordedAt: null, upcomingSchedule: null },
      ],
    }, 200, cors);
  }
  if (path === '/participants/swallow-003/basic-info') {
    if (request.method === 'PUT') state.basicInfoVersion += 1;
    return json({
      beneficiaryId: 'swallow-003', supportCaseContextId: CASE_ID, version: state.basicInfoVersion,
      name: '김합성', phone: '010-0000-0000', email: null, account: null,
      birthDate: '1980-03-05', region: '서울', gender: null,
    }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/consent` && request.method === 'PUT') {
    return request.json().then((body) => {
      state.consent = { privacy: body.privacy === true, recordingAi: body.recordingAi === true };
      return json({ supportCaseId: CASE_ID, ...state.consent, recordedAt: new Date().toISOString() }, 200, cors);
    });
  }
  if (path === `/support-cases/${CASE_ID}/overall-goal` && request.method === 'PUT') {
    return request.json().then((body) => {
      state.overallGoal = typeof body.overallGoal === 'string' && body.overallGoal !== '' ? body.overallGoal : null;
      return json({ supportCaseId: CASE_ID, overallGoal: state.overallGoal }, 200, cors);
    });
  }
  if (path === '/schedules/month') {
    const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
    return json(monthWindow(month), 200, cors);
  }
  if (path === '/schedules/candidates') {
    return json({ candidates: [{
      beneficiaryId: 'swallow-003', supportCaseId: CASE_ID, programType: 'financial_support_v1',
      participantName: '김합성', participantPhone: '010-0000-0000',
      participantEmail: 'synthetic@example.invalid', intakeAt: '2026-02-01T00:00:00.000Z',
    }] }, 200, cors);
  }
  if (path === '/schedules' && request.method === 'POST') {
    return request.json().then((body) => json({
      id: SCHEDULE_ID, beneficiaryId: body.beneficiaryId, supportCaseId: body.supportCaseId,
      scheduledAt: body.scheduledAt, status: 'scheduled', version: 1,
    }, 201, cors));
  }
  if (path === `/schedules/${SCHEDULE_ID}/plan`) {
    if (request.method === 'PUT') {
      return request.json().then((body) => {
        if (body.expectedVersion !== state.planVersion) return json({ error: 'conflict' }, 409, cors);
        state.planVersion += 1;
        return json({
          scheduleId: SCHEDULE_ID, version: state.planVersion,
          sessionGoals: body.sessionGoals.map((goal, index) => ({
            id: `goal-${index}`, body: goal.body, caseGoalId: null, caseGoalTitle: null,
            caseGoalStatus: null, ordinal: index,
          })),
        }, 200, cors);
      });
    }
    return json({
      scheduleId: SCHEDULE_ID, beneficiaryId: 'swallow-003', supportCaseId: CASE_ID,
      scheduledAt: '2026-09-20T01:00:00.000Z', status: 'scheduled', version: state.planVersion,
      sessionKind: 'regular', channel: 'in_person',
      sessionGoals: [{ id: 'goal-0', body: '체납 정리 진행 상황 확인', caseGoalId: null, caseGoalTitle: null, ordinal: 0 }],
      customQuestions: [{ id: 'question-0', body: '지난주 상담 이후 달라진 점이 있나요', ordinal: 0 }],
    }, 200, cors);
  }
  if (path === `/participants/swallow-003/programs/${CASE_ID}/briefing`) {
    return json({
      beneficiaryId: 'swallow-003', focusSupportCaseId: CASE_ID, overallGoal: state.overallGoal,
      activeGoals: [{ id: 'goal-a', title: '월세 체납 정리' }],
      canEditOverallGoal: true, participant: { name: '김합성', phone: '010-0000-0000' },
      sections: [{
        sourceSupportCase: { id: CASE_ID, programType: 'financial_support_v1', status: 'active' },
        gasTrend: [],
        lastSessionSummary: { source: 'memo', text: '지난 회차 수기 메모', pendingApprovalCount: 1 },
        pendingReviewSessionIds: [SESSION_ID],
        openActionItems: [{ id: 'action-1', description: '주민센터 서류 제출', owner: 'beneficiary', dueDate: '2026-09-18', sessionId: SESSION_ID }],
        flags: [{ id: 'flag-1', flagType: 'debt_worsening', source: 'ai', reviewStatus: 'confirmed', sessionId: SESSION_ID, quote: '이번 달에도 이자를 못 냈어요' }],
        aiSuggestions: [{ title: '체납 고지서 확인', reason: '지난 회차에 고지서를 아직 못 봤다고 했습니다', sessionId: SESSION_ID, heldAt: '2026-09-02T01:00:00.000Z', sourceQuotes: [] }],
        sessionRows: [{ sessionId: SESSION_ID, heldAt: '2026-09-02T01:00:00.000Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '고지서를 아직 확인하지 못했다고 함' }],
        discrepancies: [{ id: 'discrepancy-1', kind: 'cross_session', left: '월세 45만원', right: '월세 50만원', detectedAt: '2026-09-02T02:00:00.000Z', resolution: null }],
      }],
      focusUpcomingSchedule: {
        id: SCHEDULE_ID, scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'regular', channel: 'in_person',
        sessionGoals: [{ body: '체납 정리 진행 상황 확인', caseGoalId: null, caseGoalTitle: null, caseGoalStatus: null }],
        customQuestions: [{ body: '지난주 상담 이후 달라진 점이 있나요' }],
      },
    }, 200, cors);
  }
  if (path === '/programs' && request.method === 'GET') {
    return json({
      programs: [{
        id: 'program-1', orgId: 'org-1', displayName: '금전 지원', status: 'active',
        programType: 'financial_support_v1', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
        version: state.admissionConfirmed ? 4 : 3, confirmation: null,
        admissionState: state.admissionConfirmed ? 'ready' : 'confirmation_required', staff: [],
      }],
      staffOptions: [],
      admissionCopy: { version: admissionCopyVersion, hash: state.admissionCopyHash ?? admissionCopyHash, copy: {} },
      installation: {
        deploymentMode: 'community-cloud', sttMode: 'off', llmMode: 'off',
        policyVersion: 2, configHash: 'synthetic-config-hash',
      },
    }, 200, cors);
  }
  if (path.startsWith('/programs/') && request.method === 'PATCH') {
    return request.json().then((body) => {
      state.admissionConfirmed = true;
      return json({ program: {
        id: 'program-1', orgId: 'org-1', displayName: '금전 지원', status: 'active',
        programType: 'financial_support_v1', storageMode: body.storageMode, processingMode: body.processingMode,
        version: 4, admissionState: 'ready', staff: [],
        confirmation: { by: 'user-1', at: new Date().toISOString(), storageMode: body.storageMode,
          processingMode: body.processingMode, ...body.confirmation },
      } }, 200, cors);
    });
  }
  return json({ error: 'not_found' }, 404, cors);
}

export const SYNTHETIC_IDS = { USER_ID, CASE_ID, SCHEDULE_ID, SESSION_ID };
