import { describe, expect, it } from 'vitest';
import { ParticipantsApi, decodeParticipantHub, decodeParticipantList } from './participants';
import { BusinessError } from './errors';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const authorizedProgram = {
  id: CASE_ID, beneficiaryId: 'swallow-003', programId: 'program-1', programName: '금전 지원',
  programType: 'financial_support_v1', status: 'active', intakeAt: null, creationKind: 'initial',
  sourceSupportCase: null, participantName: '김합성', participantPhone: '010-0000-0000',
  authorized: true, assigneeNames: ['담당 실무자'],
  consentRecordedAt: null, closedAt: null, upcomingSchedule: null,
};
const restrictedProgram = {
  id: CASE_ID, beneficiaryId: 'swallow-003', programId: 'program-1', programName: '금전 지원',
  programType: 'financial_support_v1', status: 'active', authorized: false, assigneeNames: ['다른 실무자'],
};

describe('participant list and hub contracts', () => {
  it('reads email and program names from the list instead of extra hub calls', () => {
    const [item] = decodeParticipantList({ results: [{
      beneficiaryId: 'swallow-003', status: 'active', programCount: 2, name: '김합성',
      phone: '010-0000-0000', email: 'synthetic@example.invalid', programNames: ['금전 지원', '주거 지원'],
      newSignup: false,
    }] });
    expect(item).toMatchObject({ email: 'synthetic@example.invalid', programNames: ['금전 지원', '주거 지원'] });
    expect(() => decodeParticipantList({ results: [{
      beneficiaryId: 'swallow-003', status: 'active', programCount: 2, name: null, phone: null,
      email: null, newSignup: false,
    }] })).toThrow(BusinessError);
  });

  it('keeps the restricted hub free of birth date and progress', () => {
    const hub = decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: true, participantName: '김합성',
      participantPhone: '010-0000-0000', participantEmail: null, programs: [restrictedProgram],
    }, 'swallow-003');
    expect(hub.restricted).toBe(true);
    expect(hub.participantBirthDate).toBeNull();
    expect(hub.sessionCount).toBeNull();
    expect(hub.programs[0]?.authorized).toBe(false);
  });

  it('rejects a restricted payload that smuggles counselling content back in', () => {
    expect(() => decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: true, participantName: null, participantPhone: null,
      participantEmail: null, participantBirthDate: '1980-03-05', programs: [restrictedProgram],
    }, 'swallow-003')).toThrow(BusinessError);
    expect(() => decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: true, participantName: null, participantPhone: null,
      participantEmail: null,
      programs: [{ ...restrictedProgram, consentRecordedAt: '2026-09-01T00:00:00.000Z' }],
    }, 'swallow-003')).toThrow(BusinessError);
  });

  it('reads the full hub progress axes only when the server sends them', () => {
    const hub = decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: false, participantName: '김합성',
      participantPhone: '010-0000-0000', participantEmail: 'synthetic@example.invalid',
      participantBirthDate: '1980-03-05', status: 'active', closedAt: null,
      sessionCount: 3, lastSessionAt: '2026-09-02T01:00:00.000Z',
      programs: [authorizedProgram, restrictedProgram],
    }, 'swallow-003');
    expect(hub).toMatchObject({ participantBirthDate: '1980-03-05', sessionCount: 3, status: 'active' });
    expect(hub.programs[1]?.authorized).toBe(false);
    expect(() => decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: false, participantName: null, participantPhone: null,
      participantEmail: null, participantBirthDate: null, status: 'active', closedAt: null,
      lastSessionAt: null, programs: [],
    }, 'swallow-003')).toThrow(BusinessError);
  });
});

describe('여섯 영역 동의 컷오버', () => {
  it('등록 요청에 옛 동의 2종 키를 싣지 않는다', async () => {
    const sent: { path: string; body: unknown }[] = [];
    const transport = {
      request: async (path: string, _method?: string, body?: unknown) => {
        sent.push({ path, body });
        return { beneficiaryId: 'otter-011', supportCaseId: CASE_ID, assignmentRole: 'primary', replayed: false };
      },
    };
    const api = new ParticipantsApi(transport as never);
    await api.register({
      programId: CASE_ID, idempotencyKey: CASE_ID, consentEvents: [{ domain: 'counseling_recording' }],
      emergencyReason: '연락 두절 위험', name: '김합성',
    });
    const body = sent[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort())
      .toEqual(['consentEvents', 'emergencyReason', 'idempotencyKey', 'name', 'programId']);
    expect(body).not.toHaveProperty('consentPrivacy');
    expect(body).not.toHaveProperty('consentRecordingAi');
  });

  it('실제 서버가 보내는 사업 키 묶음을 그대로 받는다', () => {
    // 실런타임 응답 키다. 옛 `consent` 는 없고 `sourceSupportCase` 는 값이 null 이어도 온다.
    const hub = decodeParticipantHub({
      beneficiaryId: 'swallow-001', restricted: false, participantName: '김합성',
      participantPhone: '010-0000-0000', participantEmail: null, participantBirthDate: null,
      status: 'active', closedAt: null, sessionCount: 0, lastSessionAt: null,
      programs: [{
        id: CASE_ID, beneficiaryId: 'swallow-001', programType: 'financial_support_v1', status: 'active',
        intakeAt: null, creationKind: 'initial', sourceSupportCase: null, participantName: '김합성',
        participantPhone: '010-0000-0000', authorized: true, assigneeNames: [], consentRecordedAt: null,
        upcomingSchedule: null, programId: 'program-1', programName: '금전 지원', closedAt: null,
      }],
    }, 'swallow-001');
    expect(hub.programs[0]?.authorized).toBe(true);
    // 옛 키가 다시 들어오면 계약 위반으로 막는다(느슨한 검사로 바꾸지 않는다).
    expect(() => decodeParticipantHub({
      beneficiaryId: 'swallow-001', restricted: false, participantName: null, participantPhone: null,
      participantEmail: null, participantBirthDate: null, status: 'active', closedAt: null,
      sessionCount: 0, lastSessionAt: null,
      programs: [{ ...authorizedProgram, consent: { privacy: true, recordingAi: false } }],
    }, 'swallow-001')).toThrow(BusinessError);
  });

  it('옛 동의 값을 화면 자료로 내보내지 않는다', () => {
    const hub = decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: false, participantName: '김합성',
      participantPhone: '010-0000-0000', participantEmail: null, participantBirthDate: null,
      status: 'active', closedAt: null, sessionCount: 0, lastSessionAt: null,
      programs: [authorizedProgram],
    }, 'swallow-003');
    expect(hub.programs[0]).not.toHaveProperty('consent');
    expect(hub.programs[0]).not.toHaveProperty('consentRecordedAt');
  });
});
