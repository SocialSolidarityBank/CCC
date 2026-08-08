import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { revealPii } from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 재개편 T7(#37): POST /participants 가 선택 이메일을 받아 pii_vault enc_email 로 저장하는지,
// 그리고 형식 오류를 400 으로 막는지 확인한다. 저장 검증은 revealPii(admin) 라운드트립으로 한다
// (게이트웨이가 AES-GCM 복호화해 원문을 돌려준다, D3 · D24 · T2 #32).

const { counselor, admin } = testActors;
const t = setupD1();


function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

function register(body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(new Request('http://localhost/participants', {
    method: 'POST',
    headers: headersFor(counselor),
    body: JSON.stringify(body),
  }), t.env);
}

describe('POST /participants 이메일 PII (#37 · T2 enc_email · D3·D24)', () => {
  it('stores the registration email and round-trips it through revealPii', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      email: 'participant@example.test',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { supportCaseId: string };

    const revealed = await revealPii(t.env, admin, created.supportCaseId);
    expect(revealed.email).toBe('participant@example.test');
    // 이메일만 보낸 등록: 이름·연락처·계좌는 NULL 로 남는다.
    expect(revealed.name).toBeNull();
    expect(revealed.phone).toBeNull();
    expect(revealed.account).toBeNull();
  });

  it('stores registration name and phone alongside email (#37 보완)', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      name: '  김성규  ',
      phone: '010-2233-1234',
      email: 'named@example.test',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { supportCaseId: string };

    const revealed = await revealPii(t.env, admin, created.supportCaseId);
    expect(revealed.name).toBe('김성규');
    expect(revealed.phone).toBe('010-2233-1234');
    expect(revealed.email).toBe('named@example.test');
    // 계좌만 이후 updateParticipantPii 로 채운다.
    expect(revealed.account).toBeNull();
  });

  it('rejects blank name with 400', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      name: '   ',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(400);
  });

  it('trims surrounding whitespace before storing the email', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      email: '  spaced@example.test  ',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { supportCaseId: string };
    const revealed = await revealPii(t.env, admin, created.supportCaseId);
    expect(revealed.email).toBe('spaced@example.test');
  });

  it('rejects a malformed email with 400', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      email: 'not-an-email',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a blank email string with 400', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      email: '   ',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(400);
  });

  it('registers without an email and leaves enc_email NULL (email is optional)', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다(여기 관심사는 이메일 PII 다).
      consentPrivacy: true,
      consentRecordingAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { supportCaseId: string };
    const revealed = await revealPii(t.env, admin, created.supportCaseId);
    expect(revealed.email).toBeNull();
  });
});
