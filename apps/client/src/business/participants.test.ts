import { describe, expect, it } from 'vitest';
import { decodeParticipantHub, decodeParticipantList } from './participants';
import { BusinessError } from './errors';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const authorizedProgram = {
  id: CASE_ID, beneficiaryId: 'swallow-003', programId: 'program-1', programName: '금전 지원',
  programType: 'financial_support_v1', status: 'active', intakeAt: null, creationKind: 'initial',
  sourceSupportCase: null, participantName: '김합성', participantPhone: '010-0000-0000',
  authorized: true, assigneeNames: ['담당 실무자'], consent: { privacy: true, recordingAi: false },
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

  it('keeps the restricted hub free of birth date, progress and consent', () => {
    const hub = decodeParticipantHub({
      beneficiaryId: 'swallow-003', restricted: true, participantName: '김합성',
      participantPhone: '010-0000-0000', participantEmail: null, programs: [restrictedProgram],
    }, 'swallow-003');
    expect(hub.restricted).toBe(true);
    expect(hub.participantBirthDate).toBeNull();
    expect(hub.sessionCount).toBeNull();
    expect(hub.programs[0]?.consent).toBeNull();
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
      programs: [{ ...restrictedProgram, consent: { privacy: true, recordingAi: true } }],
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
