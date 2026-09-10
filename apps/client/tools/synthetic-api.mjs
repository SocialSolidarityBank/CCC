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
    assignmentRequested: false,
    goals: [{ id: 'a7f1c9d2-4b6e-4a30-8c52-1d3e5f70b284', title: '월세 체납 정리', status: 'active', closedReason: null, closedAt: null,
      revisions: [{ title: '월세 체납 정리', editedByName: '담당 실무자', editedAt: '2026-08-20T00:00:00.000Z' }],
      sessionGoals: [], linkedSessions: [{ sessionId: SESSION_ID, heldAt: '2026-09-02T01:00:00.000Z', oneLiner: null }] }],
    actionItems: [],
    discrepancyResolution: null,
    caseClosed: null,
    intake: null,
    submissions: new Map(),
    records: [],
    draftDecision: null,
    scheduleVersion: 2,
    consentEvents: new Map(),
    lastRegistration: null,
    retentionPolicy: { orgId: 'org-1', piiPurgeGraceDays: 365, version: 1 },
    assignees: [
      { id: '5d0c1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f', supportCaseId: CASE_ID, userId: USER_ID, role: 'primary',
        status: 'active', acceptanceRequestedBy: null, acceptedAt: '2026-02-01T00:00:00.000Z', transferReason: null,
        notifiedBy: null, notifiedAt: null, assignedAt: '2026-02-01T00:00:00.000Z', unassignedAt: null },
      { id: '8c2d1f04-5a3b-4e62-9d17-4f8a0b1c2d35', supportCaseId: CASE_ID, userId: 'a1c3f5e7-1234-4a5b-8c9d-0e1f2a3b4c5d',
        role: 'secondary', status: 'requested', acceptanceRequestedBy: 'a1c3f5e7-1234-4a5b-8c9d-0e1f2a3b4c5d',
        acceptedAt: null, transferReason: '같은 지역 사례를 맡고 있습니다', notifiedBy: null, notifiedAt: null,
        assignedAt: '2026-09-09T00:00:00.000Z', unassignedAt: null },
    ],
    accounts: [
      { id: 'a1c3f5e7-1234-4a5b-8c9d-0e1f2a3b4c5d', email: 'worker@example.invalid', name: '실무자 하나',
        active: true, roles: ['worker'], supervisedTeamIds: [], assignmentCount: 2 },
      { id: 'b2d4f6a8-2345-4b6c-9d0e-1f2a3b4c5d6e', email: 'tech@example.invalid', name: '기술 관리자',
        active: true, roles: ['technical-admin'], supervisedTeamIds: [], assignmentCount: 0 },
    ],
    retention: [{
      beneficiaryId: 'swallow-003', status: 'pending', archivedAt: '2026-09-01T00:00:00.000Z',
      reviewDueAt: '2026-09-20T00:00:00.000Z', retentionCapDueAt: '2027-09-01T00:00:00.000Z',
      reasonKind: null, retainUntil: null,
    }],
    calls: [],
  };
}

const CONSENT_DOMAINS = [
  'personal_data_collection_use', 'sensitive_information_processing', 'counseling_recording',
  'external_stt_processing', 'external_llm_cross_border_processing', 'voice_original_retention_period',
];

/** 합성 고지문. 실제 기관 문안이 아니고 실제 사업자 연결도 없다. */
function syntheticDisclosure(domain) {
  const external = domain === 'external_stt_processing' || domain === 'external_llm_cross_border_processing';
  return {
    snapshotId: `d0000000-0000-4000-8000-${String(CONSENT_DOMAINS.indexOf(domain) + 1).padStart(12, '0')}`,
    scopeBinding: { orgId: 'org-1', programId: 'program-1', issuerId: USER_ID, supportCaseId: CASE_ID },
    domain,
    fullKoreanCopy: `합성 고지문입니다. ${domain} 영역의 처리 목적과 보관 기간을 설명합니다.`,
    provider: external ? (domain === 'external_stt_processing' ? 'azure' : 'openai') : 'institution',
    providerLegalRecipient: external ? '합성 사업자' : '기관',
    country: external ? 'KR' : null,
    purpose: null, retentionProfile: 'p1y', retentionDuration: 'p1y',
    copyVersion: 'synthetic-consent-v1', copyHash: `hash-${domain}`,
    issuedAt: '2026-09-09T00:00:00.000Z', expiresAt: '2027-09-09T00:00:00.000Z',
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
  if (url.pathname === '/auth/v1/token') {
    // 새 비밀번호 로그인은 언제나 aal1에서 시작한다. 앞선 검수가 올려 둔 상태를 물려받으면
    // 추가 인증을 건너뛴 것처럼 보여 하네스가 제품 증거를 오염시킨다.
    // refresh_token 교환은 지금 검증된 세션의 단계를 그대로 유지한다.
    if (url.searchParams.get('grant_type') === 'password') {
      state.mfaLevel = 'aal1';
      // 검수용 역할 선택. 합성 계정 이름만 보고 정하며 실제 권한 판정은 서버 몫이다.
      return request.json().then((body) => {
        state.role = typeof body?.email === 'string' && body.email.startsWith('admin@') ? 'institution-admin' : 'worker';
        return json(session(), 200, cors);
      }).catch(() => json(session(), 200, cors));
    }
    return json(session(), 200, cors);
  }
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
  // 넘침(+N건) 확인용으로 같은 날에 넷을 둔다. 전부 합성이다.
  for (const [index, hour] of ['05', '06', '07', '08'].entries()) {
    cards.push({
      ...scheduleCard(`${month}-18T${hour}:00:00.000Z`),
      id: `6a2b4c8${index}-1d3e-4f57-9b2c-7e8f0a1b2c3d`,
    });
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
      { beneficiaryId: 'swallow-003', status: 'active', programCount: 2, name: '김합성', phone: '010-0000-0000',
        email: 'synthetic@example.invalid', programNames: ['금전 지원', '주거 지원'], newSignup: true },
      { beneficiaryId: 'otter-011', status: 'closed', programCount: 1, name: null, phone: null,
        email: null, programNames: ['금전 지원'], newSignup: false },
    ] }, 200, cors);
  }
  if (path === '/program-options') {
    return json({ programs: [
      { id: 'program-1', displayName: '금전 지원', programType: 'financial_support_v1', admissionState: state.admissionConfirmed ? 'ready' : 'confirmation_required' },
      { id: 'program-2', displayName: '주거 지원', programType: 'financial_support_v1', admissionState: 'undecided' },
    ] }, 200, cors);
  }
  if (path === '/participants' && request.method === 'POST') {
    return request.json().then((body) => {
      // 실제 서버와 같은 순서다: 개인정보 동의가 없고 긴급 사유도 없으면 하드 게이트가 막는다(D46).
      state.lastRegistration = Object.keys(body).sort();
      const emergency = typeof body.emergencyReason === 'string' && body.emergencyReason.trim() !== '';
      if (!emergency && body.consentPrivacy !== true) {
        return json({ error: 'privacy_consent_required' }, 422, cors);
      }
      return json({
        beneficiaryId: 'otter-011', supportCaseId: '9bd2a1c4-3f57-4a26-8e19-0b4c6d8e1f20',
        assignmentRole: 'primary', replayed: false,
      }, 201, cors);
    });
  }
  if (path === '/debug/last-registration' && request.method === 'GET') {
    return json({ keys: state.lastRegistration ?? [] }, 200, cors);
  }
  if (path === '/participants/swallow-003/hub') {
    return json({
      beneficiaryId: 'swallow-003', restricted: false, participantName: '김합성', participantPhone: '010-0000-0000',
      participantEmail: 'synthetic@example.invalid', participantBirthDate: '1980-03-05',
      status: 'active', closedAt: null, sessionCount: 1, lastSessionAt: '2026-09-02T01:00:00.000Z',
      programs: [
        { id: CASE_ID, beneficiaryId: 'swallow-003', programId: 'program-1', programName: '금전 지원',
          programType: 'financial_support_v1', status: 'active',
          intakeAt: '2026-02-01T00:00:00.000Z', creationKind: 'initial', sourceSupportCase: null,
          participantName: '김합성', participantPhone: '010-0000-0000', authorized: true,
          assigneeNames: ['담당 실무자'], consent: state.consent, consentRecordedAt: '2026-09-01T00:00:00.000Z',
          closedAt: null,
          upcomingSchedule: { id: SCHEDULE_ID, scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'regular' } },
        { id: CLOSED_CASE_ID, beneficiaryId: 'swallow-003', programId: 'program-2', programName: '주거 지원',
          programType: 'financial_support_v1', status: 'closed', authorized: false,
          assigneeNames: ['다른 실무자'] },
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
  if (path === `/support-cases/${CASE_ID}/consent` && request.method === 'GET') {
    return json({ consent: CONSENT_DOMAINS.map((domain) => {
      const event = state.consentEvents.get(domain) ?? null;
      return {
        domain,
        state: event === null ? 'unconfirmed' : event.decision === 'grant' ? 'granted' : 'not_granted',
        provider: syntheticDisclosure(domain).provider,
        providerLegalRecipient: syntheticDisclosure(domain).providerLegalRecipient,
        providerCountry: syntheticDisclosure(domain).country,
        purpose: syntheticDisclosure(domain).purpose,
        retentionDuration: syntheticDisclosure(domain).retentionDuration,
        effectiveAt: event?.effectiveAt ?? null, eventId: event?.id ?? null,
        revision: event?.revision ?? null, eventSequence: event?.sequence ?? null,
      };
    }) }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/consent/disclosures` && request.method === 'GET') {
    return json({ disclosures: CONSENT_DOMAINS.map(syntheticDisclosure) }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/consent-events` && request.method === 'POST') {
    return request.json().then((body) => {
      if (!CONSENT_DOMAINS.includes(body.domain)) return json({ error: 'invalid_request' }, 400, cors);
      const disclosure = syntheticDisclosure(body.domain);
      if (body.copyHash !== disclosure.copyHash || body.disclosureSnapshotId !== disclosure.snapshotId) {
        return json({ error: 'invalid_request' }, 400, cors);
      }
      const previous = state.consentEvents.get(body.domain) ?? null;
      const event = {
        id: `f1000000-0000-4000-8000-${String(state.consentEvents.size + 1).padStart(12, '0')}`,
        decision: body.decision, effectiveAt: body.effectiveAt,
        revision: (previous?.revision ?? 0) + 1, sequence: state.consentEvents.size + 1,
      };
      state.consentEvents.set(body.domain, event);
      return json(event, 201, cors);
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
        openActionItems: [{ id: 'action-1', description: '주민센터 서류 제출', owner: 'beneficiary', dueDate: '2026-09-18', sessionId: SESSION_ID },
          ...state.actionItems.map((item) => ({ id: item.id, description: item.description, owner: item.owner, dueDate: item.dueDate, sessionId: null }))],
        flags: [{ id: 'flag-1', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'confirmed', sessionId: SESSION_ID, quote: '이번 달에도 이자를 못 냈어요' }],
        aiSuggestions: [{ title: '체납 고지서 확인', reason: '지난 회차에 고지서를 아직 못 봤다고 했습니다', sessionId: SESSION_ID, heldAt: '2026-09-02T01:00:00.000Z', sourceQuotes: [] }],
        sessionRows: [{ sessionId: SESSION_ID, heldAt: '2026-09-02T01:00:00.000Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '고지서를 아직 확인하지 못했다고 함' }],
        discrepancies: [{ id: 'discrepancy-1', kind: 'cross_session', left: '월세 45만원', right: '월세 50만원',
          detectedAt: '2026-09-02T02:00:00.000Z',
          resolution: state.discrepancyResolution === null ? null : { status: state.discrepancyResolution } }],
      }],
      focusUpcomingSchedule: {
        id: SCHEDULE_ID, scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'regular', channel: 'in_person',
        sessionGoals: [{ body: '체납 정리 진행 상황 확인', caseGoalId: null, caseGoalTitle: null, caseGoalStatus: null }],
        customQuestions: [{ body: '지난주 상담 이후 달라진 점이 있나요' }],
      },
    }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/records` && request.method === 'GET') {
    const approved = state.draftDecision === 'approved';
    return json({
      records: [
        {
          id: SESSION_ID, supportCaseId: CASE_ID, heldAt: '2026-09-02T01:00:00.000Z', channel: 'in_person',
          memo: '고지서를 아직 확인하지 못했다고 함', kind: 'regular', createdAt: '2026-09-02T02:00:00.000Z',
          gasScores: [], actionItems: [{ id: 'action-1', description: '주민센터 서류 제출', owner: 'beneficiary', dueDate: '2026-09-18', resolved: false }],
          flags: [{ id: 'flag-1', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'confirmed', quote: '이번 달에도 이자를 못 냈어요' }],
          lifeAreaSnapshot: [], managerOpinion: null,
          aiOneLiner: approved ? '체납 정리 계획을 다시 세우기로 함' : null,
          memoExcerpt: '고지서를 아직 확인하지 못했다고 함', sessionGoals: [], discrepancies: [],
        },
        ...state.records,
      ],
      goals: state.goals.map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, closedReason: goal.closedReason })),
      schedule: { id: SCHEDULE_ID, beneficiaryId: 'swallow-003', supportCaseId: CASE_ID,
        scheduledAt: '2026-09-20T01:00:00.000Z', status: 'scheduled', version: state.scheduleVersion, completedSessionId: null },
      recordErrorSessionIds: [], overallGoal: state.overallGoal, caseStatus: 'active',
      programType: 'financial_support_v1',
    }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/records` && request.method === 'POST') {
    return request.json().then((body) => {
      const known = state.submissions.get(body.submissionId);
      if (known !== undefined) return json({ record: known, replayed: true }, 200, cors);
      if (body.expectedScheduleVersion !== undefined && body.expectedScheduleVersion !== state.scheduleVersion) {
        return json({ error: 'conflict' }, 409, cors);
      }
      const saved = { id: `record-${state.submissions.size + 1}`, heldAt: body.heldAt, channel: body.channel, memo: body.memo };
      state.submissions.set(body.submissionId, saved);
      state.records.push({
        id: saved.id, supportCaseId: CASE_ID, heldAt: body.heldAt, channel: 'in_person', memo: body.memo,
        kind: 'regular', createdAt: new Date().toISOString(), gasScores: [],
        actionItems: (body.actions ?? []).map((action, index) => ({
          id: `new-action-${index}`, description: action.description, owner: action.owner,
          dueDate: action.dueDate ?? null, resolved: false,
        })),
        flags: (body.flags ?? []).map((flag, index) => ({
          id: `new-flag-${index}`, flagType: flag.flagType, source: 'counselor', reviewStatus: 'confirmed', quote: null,
        })),
        lifeAreaSnapshot: [], managerOpinion: null, aiOneLiner: null,
        memoExcerpt: String(body.memo).slice(0, 60), sessionGoals: [], discrepancies: [],
      });
      return json({ record: saved, replayed: false }, 201, cors);
    });
  }
  if (path === `/sessions/${SESSION_ID}/ai` && request.method === 'GET') {
    return json({
      version: 1, origin: 'agent', creationMode: 'recording', summaryText: '체납 정리 진행 상황을 확인했다',
      claims: [{ claimKey: 'claim-1', section: 'session_goal_discussion', text: '고지서 확인을 다음 주까지 하기로 함' }],
      oneLiner: '체납 정리 계획을 다시 세우기로 함', reviewDecision: state.draftDecision,
      questions: [{ title: '고지서 확인 여부', reason: '지난 회차에 미확인이라고 함' }],
      evidence: [{ id: 'evidence-1', claimKey: 'claim-1', quote: '아직 고지서를 못 봤어요' }],
      contrast: [
        { axis: 'missing_in_memo', status: 'applied', findings: [{ description: '이자 연체 언급', materialKind: 'transcript', quote: '이자를 못 냈어요' }] },
        { axis: 'undiscussed_goals', status: 'no_material', findings: [] },
      ],
      regenerateAvailable: false, regenerateSourceSnapshotId: null, transcriptQuality: null,
    }, 200, cors);
  }
  if (/^\/sessions\/[^/]+\/ai\/drafts\/\d+\/review$/.test(path) && request.method === 'POST') {
    return request.json().then((body) => {
      if (body.expectedVersion !== 1) return json({ error: 'stale_draft_version' }, 409, cors);
      state.draftDecision = body.decision;
      return json({
        version: 1, origin: 'agent', creationMode: 'recording', summaryText: '체납 정리 진행 상황을 확인했다',
        claims: [], oneLiner: '체납 정리 계획을 다시 세우기로 함', reviewDecision: body.decision,
        questions: [], evidence: [], contrast: [],
      }, 200, cors);
    });
  }
  if (/^\/support-cases\/[^/]+\/assignment-requests$/.test(path) && request.method === 'POST') {
    return request.json().then((body) => {
      if (state.assignmentRequested) return json({ error: 'conflict' }, 409, cors);
      if (typeof body.reason !== 'string' || body.reason.trim() === '') return json({ error: 'invalid_request' }, 400, cors);
      state.assignmentRequested = true;
      return json({
        id: '8c2d1f04-5a3b-4e62-9d17-4f8a0b1c2d35', supportCaseId: CLOSED_CASE_ID, userId: 'user-1',
        role: 'secondary', status: 'requested', acceptanceRequestedBy: 'user-1', acceptedAt: null,
        transferReason: body.reason, notifiedBy: null, notifiedAt: null, assignedAt: new Date().toISOString(),
      }, 201, cors);
    });
  }
  if (path === '/organization/profile' && request.method === 'GET') {
    return json({ orgId: 'org-1', orgName: '합성 기관', programDisplayName: '합성 사업' }, 200, cors);
  }
  if (path === '/settings/counseling-memory' && request.method === 'GET') {
    return json({
      enabled: false, version: 1, pendingCases: 2, blockedCases: 1, failedCases: 0, lastSuccessAt: null,
    }, 200, cors);
  }
  if (path.startsWith('/audit-log') && request.method === 'GET') {
    return json({ items: [{
      id: 1, actorId: USER_ID, actorRole: 'admin', action: 'read_participant_pii',
      targetTable: 'participant_pii_vault', beneficiaryId: 'swallow-003', supportCaseId: CASE_ID,
      createdAt: '2026-09-09T01:00:00.000Z',
    }], nextCursor: null }, 200, cors);
  }
  if (path === '/pii-retention/reviews' && request.method === 'GET') {
    return json({ reviews: state.retention }, 200, cors);
  }
  if (/^\/pii-retention\/reviews\/[^/]+$/.test(path) && request.method === 'POST') {
    return request.json().then((body) => {
      const target = state.retention[0];
      if (body.decision === 'retain') {
        target.status = 'retained';
        target.reasonKind = body.reasonKind;
        target.retainUntil = body.retainUntil;
      } else {
        target.status = 'purged';
      }
      return json(target, 200, cors);
    });
  }
  if (path === '/settings/assignments/cases' && request.method === 'GET') {
    return json({ items: [{
      supportCaseId: CASE_ID, beneficiaryId: 'swallow-003', name: '김합성', phone: '010-0000-0000',
      programName: '합성 사업', status: 'active', intakeAt: '2026-02-01T00:00:00.000Z',
    }], nextCursor: null }, 200, cors);
  }
  if (path === `/settings/assignments/cases/${CASE_ID}` && request.method === 'GET') {
    return json({ assignees: state.assignees }, 200, cors);
  }
  if (/^\/support-cases\/[^/]+\/assignment-requests\/[^/]+\/review$/.test(path) && request.method === 'POST') {
    return request.json().then((body) => {
      const id = path.split('/')[4];
      const target = state.assignees.find((entry) => entry.id === id);
      if (target === undefined || target.status !== 'requested') return json({ error: 'conflict' }, 409, cors);
      if (body.decision === 'reject') {
        if (typeof body.reason !== 'string' || body.reason === '') return json({ error: 'invalid_request' }, 400, cors);
        target.status = 'ended';
        target.transferReason = body.reason;
      } else {
        target.status = 'active';
        target.role = body.decision === 'transfer' ? 'primary' : 'secondary';
        target.acceptedAt = new Date().toISOString();
      }
      return json(target, 200, cors);
    });
  }
  if (path === '/settings/retention-policy') {
    if (request.method === 'GET') return json(state.retentionPolicy, 200, cors);
    if (request.method === 'PUT') {
      return request.json().then((body) => {
        if (body.expectedVersion !== state.retentionPolicy.version) return json({ error: 'conflict' }, 409, cors);
        state.retentionPolicy = {
          ...state.retentionPolicy,
          piiPurgeGraceDays: body.piiPurgeGraceDays,
          version: state.retentionPolicy.version + 1,
        };
        return json(state.retentionPolicy, 200, cors);
      });
    }
  }
  if (/^\/settings\/accounts\/[^/]+\/roles$/.test(path) && request.method === 'PATCH') {
    return request.json().then((body) => {
      const id = decodeURIComponent(path.split('/')[3]);
      const account = state.accounts.find((entry) => entry.id === id);
      if (account === undefined) return json({ error: 'not_found' }, 404, cors);
      if (account.roles.join(',') !== [...body.expectedRoles].sort().join(',')) {
        return json({ error: 'conflict' }, 409, cors);
      }
      account.roles = [...body.roles].sort();
      return json(account, 200, cors);
    });
  }
  if (/^\/settings\/accounts\/[^/]+\/deactivate$/.test(path) && request.method === 'POST') {
    return request.json().then(() => {
      const id = decodeURIComponent(path.split('/')[3]);
      const account = state.accounts.find((entry) => entry.id === id);
      if (account === undefined) return json({ error: 'not_found' }, 404, cors);
      account.active = false;
      return json(account, 200, cors);
    });
  }
  if (path === '/settings/accounts' && request.method === 'GET') {
    return json({
      accounts: state.accounts,
      permissions: { canManageRoles: true, canManageAccounts: true }, nextCursor: null,
    }, 200, cors);
  }
  if (path === '/participants/swallow-003/goal-tree' && request.method === 'GET') {
    return json({ cases: [{
      sourceSupportCase: { id: CASE_ID, programType: 'financial_support_v1', status: state.caseClosed === null ? 'active' : 'closed' },
      overallGoal: state.overallGoal,
      overallGoalRevisions: [{ title: state.overallGoal, editedByName: '담당 실무자', editedAt: '2026-08-20T00:00:00.000Z' }],
      goals: state.goals,
    }] }, 200, cors);
  }
  if (path === `/cases/${CASE_ID}/goals` && request.method === 'POST') {
    return request.json().then((body) => {
      const id = `f${state.goals.length + 1}c1c9d2-4b6e-4a30-8c52-1d3e5f70b28${state.goals.length + 4}`;
      state.goals.push({ id, title: body.title, status: 'active', closedReason: null, closedAt: null,
        revisions: [{ title: body.title, editedByName: '담당 실무자', editedAt: new Date().toISOString() }],
        sessionGoals: [], linkedSessions: [] });
      return json({ id, caseId: CASE_ID, title: body.title, scaleCriteria: null, status: 'active',
        closedReason: null, closedAt: null, replacedByGoalId: null }, 201, cors);
    });
  }
  if (/^\/goals\/[^/]+\/title$/.test(path) && request.method === 'PUT') {
    const goalId = path.split('/')[2];
    return request.json().then((body) => {
      const goal = state.goals.find((entry) => entry.id === goalId);
      if (goal === undefined) return json({ error: 'not_found' }, 404, cors);
      goal.revisions = [{ title: body.title, editedByName: '담당 실무자', editedAt: new Date().toISOString() }, ...goal.revisions];
      goal.title = body.title;
      return json({ id: goal.id, caseId: CASE_ID, title: goal.title, scaleCriteria: null, status: goal.status,
        closedReason: goal.closedReason, closedAt: goal.closedAt, replacedByGoalId: null }, 200, cors);
    });
  }
  if (/^\/goals\/[^/]+\/upcoming-links$/.test(path) && request.method === 'GET') {
    return json({ upcomingCount: 1 }, 200, cors);
  }
  if (/^\/goals\/[^/]+\/close$/.test(path) && request.method === 'POST') {
    const goalId = path.split('/')[2];
    return request.json().then((body) => {
      const goal = state.goals.find((entry) => entry.id === goalId);
      if (goal === undefined) return json({ error: 'not_found' }, 404, cors);
      goal.status = 'closed';
      goal.closedReason = body.reason;
      goal.closedAt = new Date().toISOString();
      return json({ id: goal.id, caseId: CASE_ID, title: goal.title, scaleCriteria: null, status: 'closed',
        closedReason: goal.closedReason, closedAt: goal.closedAt, replacedByGoalId: null }, 200, cors);
    });
  }
  if (path === `/cases/${CASE_ID}/action-items` && request.method === 'POST') {
    return request.json().then((body) => {
      const id = `c${state.actionItems.length + 1}a1c9d2-4b6e-4a30-8c52-1d3e5f70b2a${state.actionItems.length + 4}`;
      state.actionItems.push({ id, description: body.description, owner: body.owner, dueDate: body.dueDate ?? null, sessionId: null });
      return json({ id, caseId: CASE_ID, sessionId: null, description: body.description, owner: body.owner,
        dueDate: body.dueDate ?? null, resolvedAt: null }, 201, cors);
    });
  }
  if (/^\/support-cases\/[^/]+\/discrepancies\/[^/]+\/resolution$/.test(path) && request.method === 'PUT') {
    return request.json().then((body) => {
      state.discrepancyResolution = body.status;
      return json({ id: 'discrepancy-1', resolution: { status: body.status } }, 200, cors);
    });
  }
  if (path === `/support-cases/${CASE_ID}/closure` && request.method === 'GET') {
    return json({
      supportCaseId: CASE_ID, beneficiaryId: 'swallow-003', status: state.caseClosed === null ? 'active' : 'closed',
      closedAt: state.caseClosed?.at ?? null, closedReason: state.caseClosed?.reason ?? null,
      purgeDue: state.caseClosed === null ? null : '2027-09-10', purgedAt: null, hasOtherActiveSupportCase: false,
    }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/close` && request.method === 'POST') {
    return request.json().then((body) => {
      state.caseClosed = { reason: body.reason, at: new Date().toISOString() };
      return json({ id: CASE_ID, status: 'closed', closedAt: state.caseClosed.at }, 200, cors);
    });
  }
  if (path === `/support-cases/${CASE_ID}/records/intake` && request.method === 'GET') {
    return json({
      beneficiaryId: 'swallow-003', supportCaseId: CASE_ID,
      participant: { name: '김합성', phone: '010-0000-0000', email: 'synthetic@example.invalid' },
      sessionSequence: state.intake === null ? 1 : 2, hasIntake: state.intake !== null,
      extendedPii: { birthDate: '1980-03-05', region: '서울', emergencyContact: null, gender: null },
      consent: state.consent, saved: state.intake, overallGoal: state.overallGoal,
      schedule: { id: SCHEDULE_ID, beneficiaryId: 'swallow-003', supportCaseId: CASE_ID,
        scheduledAt: '2026-09-20T01:00:00.000Z', status: 'scheduled', version: state.scheduleVersion,
        completedSessionId: null },
    }, 200, cors);
  }
  if (path === `/support-cases/${CASE_ID}/records/intake` && (request.method === 'POST' || request.method === 'PUT')) {
    return request.json().then((body) => {
      const replayed = request.method === 'POST' && state.intake !== null;
      state.intake = {
        sessionId: '4d2b6f81-9c3a-4e57-8b16-2f7d9a0c1e35', heldAt: body.heldAt, channel: 'in_person',
        answers: body.answers ?? [], debts: body.debts ?? [], linkedOrgs: body.linkedOrgs ?? [],
        additionalItems: body.additionalItems ?? [], managerOpinion: body.managerOpinion ?? null,
      };
      const record = { id: state.intake.sessionId, heldAt: body.heldAt, channel: 'in_person', kind: 'intake' };
      return request.method === 'POST'
        ? json({ record, replayed }, replayed ? 200 : 201, cors)
        : json({ record }, 200, cors);
    });
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
