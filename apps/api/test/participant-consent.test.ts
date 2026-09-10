import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  ForbiddenError,
  appendSupportCaseConsentEvent,
  createBeneficiaryWithInitialSupportCase,
  getIntakeRecordContext,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  type Actor,
  type SupportCaseCreationResult,
} from '@ccc/core/gateway';
import {
  CONSENT_COPY,
  CONSENT_COPY_VERSION,
  CONSENT_DOMAINS,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type CurrentConsentState,
} from '@ccc/contracts/consent';
import { grantTestPractitionerRole, setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';

// S7 이후 동의의 정본은 케이스별 6종 consent_events 다. 등록 시점의 원자 기록 계약은
// preregistration-consent.contract.test.ts 가 고정하고, 이 파일은 **등록 이후의 수명**을
// 고정한다: 철회·재동의, 누가 쓸 수 있는지, 인테이크 1단계가 무엇을 읽는지, 그리고
// 옛 participant_consent_records 표에 아직 남아 있는 스키마 가드(자기 가입 경로가 쓴다).
//
// support_cases 의 옛 동의 시각 컬럼은 더 이상 아무 권위도 갖지 않으므로 읽지 않는다.

const { counselor, admin, unassignedCounselor } = testActors;
const t = setupD1();

const INTAKE_AT = '2026-07-16T09:00:00.000Z';
const PRIVACY: ConsentDomain = 'personal_data_collection_use';
const RECORDING: ConsentDomain = 'counseling_recording';

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

async function register(actor: Actor = counselor): Promise<SupportCaseCreationResult> {
  const input = actor.role === 'admin'
    ? { programId: testProgramId(actor.orgId), intakeAt: INTAKE_AT, initialAssigneeUserId: actor.userId }
    : { programId: testProgramId(actor.orgId), intakeAt: INTAKE_AT };
  return createBeneficiaryWithInitialSupportCase(t.env, actor, await registrationInput(t.env, actor, input));
}

async function stateOf(actor: Actor, supportCaseId: string, domain: ConsentDomain): Promise<CurrentConsentState> {
  const current = (await getSupportCaseConsent(t.env, actor, supportCaseId)).find((item) => item.domain === domain);
  if (current === undefined) throw new Error(`missing consent state for ${domain}`);
  return current;
}

async function disclosureFor(
  actor: Actor,
  supportCaseId: string,
  domain: ConsentDomain,
): Promise<ConsentDisclosureSnapshot> {
  const disclosures = await issueSupportCaseConsentDisclosures(t.env, actor, supportCaseId);
  const disclosure = disclosures.find((item) => item.domain === domain);
  if (disclosure === undefined) throw new Error(`missing consent disclosure for ${domain}`);
  return disclosure;
}

/** 철회는 지금 유효한 동의를 그대로 지목한다 — 수신자·목적·개정 번호가 어긋나면 게이트웨이가 거부한다. */
async function withdraw(actor: Actor, supportCaseId: string, domain: ConsentDomain): Promise<void> {
  const current = await stateOf(actor, supportCaseId, domain);
  const disclosure = await disclosureFor(actor, supportCaseId, domain);
  await appendSupportCaseConsentEvent(t.env, actor, supportCaseId, {
    domain,
    decision: 'withdraw',
    provider: current.provider,
    providerLegalRecipient: current.providerLegalRecipient,
    providerCountry: current.providerCountry,
    purpose: current.purpose,
    retentionDuration: current.retentionDuration,
    copyVersion: disclosure.copyVersion,
    copyHash: disclosure.copyHash,
    disclosureSnapshotId: disclosure.snapshotId,
    effectiveAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
    correctionOfEventId: null,
    expectedRevision: current.revision,
  });
}

/** 재동의는 그 시점 고지에 새로 묶는다 — 옛 동의 행을 되살리지 않는다(append-only). */
async function grant(actor: Actor, supportCaseId: string, domain: ConsentDomain): Promise<void> {
  const disclosure = await disclosureFor(actor, supportCaseId, domain);
  await appendSupportCaseConsentEvent(t.env, actor, supportCaseId, {
    domain,
    decision: 'grant',
    provider: disclosure.provider,
    providerLegalRecipient: disclosure.providerLegalRecipient,
    providerCountry: disclosure.country,
    purpose: disclosure.purpose,
    retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
    copyVersion: disclosure.copyVersion,
    copyHash: disclosure.copyHash,
    disclosureSnapshotId: disclosure.snapshotId,
    effectiveAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
    correctionOfEventId: null,
    expectedRevision: null,
  });
}

async function eventCount(supportCaseId: string): Promise<number> {
  const row = await t.db.prepare(
    'SELECT COUNT(*) AS count FROM consent_events WHERE support_case_id = ?',
  ).bind(supportCaseId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

describe('당사자 등록이 남기는 6종 동의 (S7)', () => {
  it('binds every domain to the issued disclosure and stamps the staff actor as recorder', async () => {
    await t.reset();
    const creation = await register();

    const states = await getSupportCaseConsent(t.env, counselor, creation.supportCaseId);
    expect(states.map((state) => state.domain)).toEqual([...CONSENT_DOMAINS]);
    for (const state of states) {
      expect(state).toMatchObject({
        state: 'granted',
        provider: CONSENT_COPY[state.domain].provider,
        purpose: CONSENT_COPY[state.domain].purpose,
        revision: 1,
      });
    }
    // 국외 처리 고지는 수신 국가를 실어 나른다 — 여기가 비면 국외 이전 고지가 무의미해진다.
    expect(states.every((state) => state.providerCountry !== null)).toBe(true);

    const recorders = await t.db.prepare(
      'SELECT DISTINCT recorded_by FROM consent_events WHERE support_case_id = ?',
    ).bind(creation.supportCaseId).all<{ recorded_by: string }>();
    expect(recorders.results).toEqual([{ recorded_by: counselor.userId }]);
  });

  it('keeps the participant completion guard intact (exactly 3 provenance audits)', async () => {
    await t.reset();
    // 6종 동의가 같은 배치에 들어와도 beneficiaries_complete_guard 를 깨지 않는지 —
    // 완료 전환 시점의 당사자 감사 3건 불변식이 유지되는지 확인한다.
    const creation = await register();
    const beneficiary = await t.db.prepare(
      'SELECT initialization_state FROM beneficiaries WHERE id = ?',
    ).bind(creation.beneficiaryId).first<{ initialization_state: string }>();
    expect(beneficiary?.initialization_state).toBe('complete');

    const provenance = await t.db.prepare(
      `SELECT action FROM audit_log
       WHERE beneficiary_id = ? AND action IN ('create', 'assign')
         AND target_table IN ('beneficiaries', 'support_cases', 'support_case_assignees')
       ORDER BY id`,
    ).bind(creation.beneficiaryId).all<{ action: string }>();
    expect(provenance.results.map((r) => r.action)).toEqual(['create', 'create', 'assign']);
  });

  it('is append-only: consent events reject UPDATE and DELETE', async () => {
    await t.reset();
    const creation = await register();
    const event = await t.db.prepare(
      'SELECT id FROM consent_events WHERE support_case_id = ? LIMIT 1',
    ).bind(creation.supportCaseId).first<{ id: string }>();
    const id = String(event?.id);

    await expect(t.db.prepare('UPDATE consent_events SET decision = ? WHERE id = ?')
      .bind('decline', id).run()).rejects.toThrow('consent_events_append_only');
    await expect(t.db.prepare('DELETE FROM consent_events WHERE id = ?')
      .bind(id).run()).rejects.toThrow('consent_events_append_only');
  });
});

describe('철회와 재동의 (append-only 수명)', () => {
  it('withdraws one domain without touching the others and keeps the granted history', async () => {
    await t.reset();
    const creation = await register();

    await withdraw(counselor, creation.supportCaseId, RECORDING);

    expect((await stateOf(counselor, creation.supportCaseId, RECORDING)).state).toBe('not_granted');
    expect((await stateOf(counselor, creation.supportCaseId, PRIVACY)).state).toBe('granted');
    // 철회는 행을 고치지 않고 한 건 더 쌓는다 — 등록 6건 + 철회 1건.
    expect(await eventCount(creation.supportCaseId)).toBe(7);
    const history = await t.db.prepare(
      `SELECT decision, revision FROM consent_events
       WHERE support_case_id = ? AND domain = ? ORDER BY event_sequence`,
    ).bind(creation.supportCaseId, RECORDING).all<{ decision: string; revision: number }>();
    expect(history.results).toEqual([
      { decision: 'grant', revision: 1 },
      { decision: 'withdraw', revision: 2 },
    ]);
  });

  it('re-grants a withdrawn domain against the disclosure issued at that moment', async () => {
    await t.reset();
    const creation = await register();
    await withdraw(counselor, creation.supportCaseId, RECORDING);

    await grant(counselor, creation.supportCaseId, RECORDING);

    const current = await stateOf(counselor, creation.supportCaseId, RECORDING);
    expect(current).toMatchObject({ state: 'granted', revision: 3 });
    // 재동의는 옛 근거를 되살리지 않는다 — 새 고지 스냅샷에 묶인 새 행이다.
    const events = await t.db.prepare(
      `SELECT disclosure_snapshot_id FROM consent_events
       WHERE support_case_id = ? AND domain = ? ORDER BY event_sequence`,
    ).bind(creation.supportCaseId, RECORDING).all<{ disclosure_snapshot_id: string }>();
    expect(new Set(events.results.map((row) => row.disclosure_snapshot_id)).size).toBe(3);
  });

  it('shows the withdrawal on the read-only intake first step', async () => {
    await t.reset();
    const creation = await register();
    const before = await getIntakeRecordContext(t.env, counselor, creation.supportCaseId);
    expect(before.consent.every((state) => state.state === 'granted')).toBe(true);

    await withdraw(counselor, creation.supportCaseId, PRIVACY);

    const after = await getIntakeRecordContext(t.env, counselor, creation.supportCaseId);
    expect(after.consent.find((state) => state.domain === PRIVACY)?.state).toBe('not_granted');
    // 나머지 다섯은 그대로다 — 화면이 "하나 철회 = 전부 철회"로 읽으면 안 된다.
    expect(after.consent.filter((state) => state.state === 'granted')).toHaveLength(5);
  });

  it('refuses a withdrawal aimed at a stale revision', async () => {
    await t.reset();
    const creation = await register();
    const stale = await stateOf(counselor, creation.supportCaseId, RECORDING);
    await withdraw(counselor, creation.supportCaseId, RECORDING);
    const disclosure = await disclosureFor(counselor, creation.supportCaseId, RECORDING);

    await expect(appendSupportCaseConsentEvent(t.env, counselor, creation.supportCaseId, {
      domain: RECORDING,
      decision: 'withdraw',
      provider: stale.provider,
      providerLegalRecipient: stale.providerLegalRecipient,
      providerCountry: stale.providerCountry,
      purpose: stale.purpose,
      retentionDuration: stale.retentionDuration,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: stale.revision,
    })).rejects.toThrow();
    expect(await eventCount(creation.supportCaseId)).toBe(7);
  });
});

describe('동의를 쓸 수 있는 사람 (등록과 같은 권한 층)', () => {
  it('refuses a counselor who is not assigned to the case and leaves the state untouched', async () => {
    await t.reset();
    const creation = await register();

    await expect(withdraw(unassignedCounselor, creation.supportCaseId, PRIVACY))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect((await stateOf(counselor, creation.supportCaseId, PRIVACY)).state).toBe('granted');
  });

  it('lets an institution admin append on behalf of the institution', async () => {
    await t.reset();
    await grantTestPractitionerRole(t.db, admin);
    const creation = await register();

    await withdraw(admin, creation.supportCaseId, RECORDING);

    expect((await stateOf(admin, creation.supportCaseId, RECORDING)).state).toBe('not_granted');
    const recorded = await t.db.prepare(
      `SELECT recorded_by FROM consent_events
       WHERE support_case_id = ? AND domain = ? ORDER BY event_sequence DESC LIMIT 1`,
    ).bind(creation.supportCaseId, RECORDING).first<{ recorded_by: string }>();
    expect(recorded?.recorded_by).toBe(admin.userId);
  });
});

describe('GET /support-cases/:id/consent · POST /support-cases/:id/consent-events', () => {
  it('serves the six canonical states over the route', async () => {
    await t.reset();
    const creation = await register();
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent`,
      { headers: headersFor(counselor) },
    ), t.env);
    expect(response.status).toBe(200);
    const body = await response.json() as { consent: CurrentConsentState[] };
    expect(body.consent.map((state) => [state.domain, state.state]))
      .toEqual(CONSENT_DOMAINS.map((domain) => [domain, 'granted']));
  });

  it('keeps a recorded time on the hub after every domain is withdrawn (기록 시각이지 동의 시각이 아니다)', async () => {
    await t.reset();
    const creation = await register();
    for (const domain of CONSENT_DOMAINS) await withdraw(counselor, creation.supportCaseId, domain);

    const response = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      { headers: headersFor(counselor) },
    ), t.env);
    expect(response.status).toBe(200);
    const programs = await response.json() as Array<{ consentRecordedAt: string | null }>;
    // 동의 시각에서 역산했다면 여기가 null 이 된다 — 방금 남긴 철회 기록이 사라져 보인다.
    expect(programs[0]?.consentRecordedAt).not.toBeNull();
    expect((await stateOf(counselor, creation.supportCaseId, PRIVACY)).state).toBe('not_granted');
  });

  it('refuses an unassigned counselor appending over the route', async () => {
    await t.reset();
    const creation = await register();
    const current = await stateOf(counselor, creation.supportCaseId, PRIVACY);
    const disclosure = await disclosureFor(counselor, creation.supportCaseId, PRIVACY);
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent-events`,
      {
        method: 'POST',
        headers: headersFor(unassignedCounselor),
        body: JSON.stringify({
          domain: PRIVACY,
          decision: 'withdraw',
          provider: current.provider,
          providerLegalRecipient: current.providerLegalRecipient,
          providerCountry: current.providerCountry,
          purpose: current.purpose,
          retentionDuration: current.retentionDuration,
          copyVersion: disclosure.copyVersion,
          copyHash: disclosure.copyHash,
          disclosureSnapshotId: disclosure.snapshotId,
          effectiveAt: new Date().toISOString(),
          idempotencyKey: crypto.randomUUID(),
          correctionOfEventId: null,
          expectedRevision: current.revision,
        }),
      },
    ), t.env);
    expect(response.status).toBe(403);
    expect((await stateOf(counselor, creation.supportCaseId, PRIVACY)).state).toBe('granted');
  });

  it('rejects an event whose decision is not one of the four', async () => {
    await t.reset();
    const creation = await register();
    const disclosure = await disclosureFor(counselor, creation.supportCaseId, PRIVACY);
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent-events`,
      {
        method: 'POST',
        headers: headersFor(counselor),
        body: JSON.stringify({
          domain: PRIVACY,
          decision: 'yes',
          provider: null,
          providerLegalRecipient: null,
          providerCountry: null,
          purpose: null,
          retentionDuration: null,
          copyVersion: CONSENT_COPY_VERSION,
          copyHash: disclosure.copyHash,
          disclosureSnapshotId: disclosure.snapshotId,
          effectiveAt: new Date().toISOString(),
          idempotencyKey: crypto.randomUUID(),
          correctionOfEventId: null,
          expectedRevision: null,
        }),
      },
    ), t.env);
    expect(response.status).toBe(400);
  });
});

// 자기 가입(completeParticipantSignup)은 아직 이 표에 쓴다. 표가 살아 있는 한 가드도 살아 있어야
// 한다 — 등록 경로가 더는 쓰지 않는다는 이유로 가드를 지우면 남은 쓰기 경로가 무방비가 된다.
describe('participant_consent_records schema guards (자기 가입 경로가 아직 쓰는 표)', () => {
  const CREATED_AT = '2026-07-16 09:00:00';

  it('rejects a recorder who is not an active human user', async () => {
    await t.reset();
    const creation = await register();
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, recorded_by, recorded_at, created_at
       ) VALUES ('c-ghost', ?, ?, ?, 'ghost@example.invalid', ?, ?)`,
    ).bind(counselor.orgId, creation.beneficiaryId, creation.supportCaseId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('rejects a support case that does not belong to the beneficiary', async () => {
    await t.reset();
    const first = await register();
    const second = await register();
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, recorded_by, recorded_at, created_at
       ) VALUES ('c-mismatch', ?, ?, ?, ?, ?, ?)`,
    ).bind(counselor.orgId, first.beneficiaryId, second.supportCaseId, counselor.userId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('rejects an item consent time that differs from recorded_at', async () => {
    await t.reset();
    const creation = await register();
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, consent_recording_at, recorded_by, recorded_at, created_at
       ) VALUES ('c-skew', ?, ?, ?, '2020-01-01 00:00:00', ?, ?, ?)`,
    ).bind(counselor.orgId, creation.beneficiaryId, creation.supportCaseId, counselor.userId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('rejects a privacy consent snapshot without server notice evidence', async () => {
    await t.reset();
    const creation = await register();
    const recordedAt = '2026-07-16T10:00:00.000Z';

    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id,
         consent_recording_at, consent_text_ai_at, consent_privacy_at,
         recorded_by, recorded_at, created_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
      'consent-without-privacy-evidence',
      counselor.orgId,
      creation.beneficiaryId,
      creation.supportCaseId,
      recordedAt,
      counselor.userId,
      recordedAt,
      recordedAt,
    ).run()).rejects.toThrow('participant_schema_violation');
  });
});
