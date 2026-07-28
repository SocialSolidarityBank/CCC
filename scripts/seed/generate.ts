/**
 * 오케스트레이터 — 단일 it() 블록.
 *
 * raw D1 토큰(게이트웨이 env 의 DB 바인딩 직접 접근, prepare 리터럴)을 쓰지 않는다
 * (guard 통과 대상 — raw D1 은 harness/capture/validate 계층에만 국한). 흐름:
 *   1) 캡처 하니스 부트 → 실제 게이트웨이로 시나리오 실행(쓰기 캡처)
 *   2) 방출 필터(INSERT/UPDATE만) + 파라미터 인라인 → seed.sql 조립
 *   3) unstable_splitSqlQuery 로 재분할해 문장 수 일치 assert(이스케이프 버그 검출)
 *   4) 신선한 두 번째 DB 에 재생 → 캡처 DB 와 diff + 복호화 + 불변식 검증
 *   5) 산출물 5종 기록(out/, gitignore): seed.sql·manifest.json·verify.sql·
 *      delete-best-effort.sql·capture-report.txt
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import { createCaptureHarness, requireEnv, assertPiiKeyMaterial } from './harness';
import { runScenario } from './scenario';
import { inlineSql, firstKeyword, type SqlParam } from './sql-literal';
import { validateSeed, type EmittedStatement } from './validate';
import type { WriteEntry } from './capture';
import { PARTICIPANTS, VIRTUAL_COUNSELORS } from './content';
import { OPERATIONAL_AUDIT_BASELINE, ORG_ID } from './preload-data';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

/** 향후 7일 예정 일정 판정 하한(브리핑에 바로 뜨는 기준). */
const UPCOMING_FROM = '2026-07-19T00:00:00.000Z';

interface EmittedRich extends EmittedStatement {
  participantId: string;
  step: number;
  keyword: string;
  table: string;
  params: SqlParam[];
}

function tableOf(sql: string): string {
  const match = sql.match(/^\s*(?:INSERT\s+INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  return match ? match[1]! : 'unknown';
}

/** 캡처 로그 → 방출 문장(INSERT/UPDATE만, DELETE 는 hard-fail). */
function emitStatements(writes: readonly WriteEntry[]): EmittedRich[] {
  return writes.map((write) => {
    const keyword = firstKeyword(write.sql);
    if (keyword === 'DELETE') {
      throw new Error('[seed] DELETE 문장이 캡처됨 — 방출 금지(캡처/필터 버그).');
    }
    if (keyword !== 'INSERT' && keyword !== 'UPDATE') {
      throw new Error(`[seed] 예상치 못한 쓰기 키워드: ${keyword}`);
    }
    return {
      inlinedSql: inlineSql(write.sql, write.params),
      batchId: write.batchId,
      participantId: write.participantId,
      step: write.step,
      keyword,
      table: tableOf(write.sql),
      params: write.params,
    };
  });
}

function assembleSeedSql(emitted: readonly EmittedRich[]): string {
  const header = [
    '-- CCC 운영 시드 데이터 (Miniflare 캡처 → SQL 재생)',
    '-- 전원 가상 인물·가상 데이터. 실존 인물·기관과 무관하다.',
    `-- 생성 문장 수: ${emitted.length}`,
    `-- 조직: ${ORG_ID} · 참여자 ${PARTICIPANTS.length}명 + 가상 상담사 ${VIRTUAL_COUNSELORS.length}명`,
    '-- 적용: apps/api 에서 wrangler d1 execute ccc --env production --remote --file ../../scripts/seed/out/seed.sql (원자적, -y 금지)',
    '-- 롤백: audit_log·participant_consent_records 는 append-only, support_cases/beneficiaries 는 동의 FK 로 삭제 불가.',
    '--       진짜 롤백은 Time Travel(적용 전 북마크)로만 한다.',
    '',
  ].join('\n');
  const body = emitted
    .map((entry) => `-- participant ${entry.participantId} · step ${entry.step} · batch ${entry.batchId}\n${entry.inlinedSql};`)
    .join('\n');
  return `${header}\n${body}\n`;
}

interface ParticipantManifest {
  participantId: string;
  beneficiaryId: string | null;
  supportCaseId: string | null;
  submissionIds: string[];
  rows: Record<string, string[]>;
}

function buildManifest(emitted: readonly EmittedRich[], sessionCount: number): {
  manifest: Record<string, unknown>;
  tableInsertCounts: Record<string, number>;
} {
  const tableInsertCounts: Record<string, number> = {};
  const perParticipant = new Map<string, ParticipantManifest>();

  for (const entry of emitted) {
    if (entry.keyword === 'INSERT') {
      tableInsertCounts[entry.table] = (tableInsertCounts[entry.table] ?? 0) + 1;
    }
    if (entry.participantId === 'setup' || entry.participantId === 'preload') continue;

    let record = perParticipant.get(entry.participantId);
    if (record === undefined) {
      record = { participantId: entry.participantId, beneficiaryId: null, supportCaseId: null, submissionIds: [], rows: {} };
      perParticipant.set(entry.participantId, record);
    }
    if (entry.keyword !== 'INSERT') continue;

    const rowId = entry.params.length > 0 && typeof entry.params[0] === 'string' ? entry.params[0] : null;
    if (entry.table === 'audit_log') continue;
    if (rowId !== null) {
      (record.rows[entry.table] ??= []).push(rowId);
    }
    if (entry.table === 'beneficiaries' && record.beneficiaryId === null) record.beneficiaryId = rowId;
    if (entry.table === 'support_cases' && record.supportCaseId === null) record.supportCaseId = rowId;
    if (entry.table === 'sessions' && typeof entry.params[7] === 'string') record.submissionIds.push(entry.params[7]);
  }

  const generatedAuditInserts = tableInsertCounts.audit_log ?? 0;
  const manifest: Record<string, unknown> = {
    note: '전원 가상 데이터. 테이블 카운트는 시드가 추가하는 delta(운영 기준선 별도).',
    generatedAt: new Date().toISOString(),
    org: ORG_ID,
    statementCount: emitted.length,
    participants: PARTICIPANTS.length,
    virtualCounselors: VIRTUAL_COUNSELORS.length,
    sessions: sessionCount,
    tableInsertCounts,
    audit: {
      operationalBaseline: OPERATIONAL_AUDIT_BASELINE,
      generatedInserts: generatedAuditInserts,
      triggerRowsPerSession: sessionCount,
      expectedAfterSeed: OPERATIONAL_AUDIT_BASELINE + generatedAuditInserts + sessionCount,
      note: 'sessions_manual_submission_audit 트리거가 세션당 1행을 재생성한다(방출 로그에 없음).',
    },
    perParticipant: [...perParticipant.values()],
  };
  return { manifest, tableInsertCounts };
}

function buildVerifySql(emitted: readonly EmittedRich[], sessionCount: number): string {
  const generatedAuditInserts = emitted.filter((entry) => entry.keyword === 'INSERT' && entry.table === 'audit_log').length;
  const expectedAudit = OPERATIONAL_AUDIT_BASELINE + generatedAuditInserts + sessionCount;
  const confirmedFlags = emitted.filter((entry) => entry.keyword === 'INSERT' && entry.table === 'flags').length;
  return [
    '-- 운영 적용 후 대조 쿼리. 값은 "시드가 더한 delta" 기준(운영 기준선은 별도로 더해 판단).',
    `-- 기대 delta: 참여자 +${PARTICIPANTS.length}, 세션 +${sessionCount}, 동의 +${PARTICIPANTS.length}, vault +${PARTICIPANTS.length}, confirmed 플래그 +${confirmedFlags}`,
    `-- audit_log 기대 총합(기준선 ${OPERATIONAL_AUDIT_BASELINE} 포함): ${expectedAudit}`,
    '',
    `SELECT 'beneficiaries_slug_complete' AS check_name, COUNT(*) AS value`,
    `  FROM beneficiaries WHERE org_id = '${ORG_ID}' AND id GLOB '*-*' AND initialization_state = 'complete';`,
    `SELECT 'support_cases_active', COUNT(*) FROM support_cases WHERE org_id = '${ORG_ID}' AND status = 'active';`,
    `SELECT 'sessions_total', COUNT(*) FROM sessions WHERE org_id = '${ORG_ID}';`,
    `SELECT 'consent_records', COUNT(*) FROM participant_consent_records WHERE org_id = '${ORG_ID}';`,
    `SELECT 'vault_key_version_2', COUNT(*) FROM participant_pii_vault WHERE org_id = '${ORG_ID}' AND key_version = 2;`,
    `SELECT 'flags_confirmed', COUNT(*) FROM flags WHERE org_id = '${ORG_ID}' AND review_status = 'confirmed';`,
    `SELECT 'upcoming_schedules', COUNT(*) FROM counseling_schedules`,
    `  WHERE org_id = '${ORG_ID}' AND status = 'scheduled' AND scheduled_at >= '${UPCOMING_FROM}';`,
    `SELECT 'audit_log_total', COUNT(*) FROM audit_log;`,
    '',
  ].join('\n');
}

function buildDeleteBestEffort(manifest: ParticipantManifest[]): string {
  const supportCaseIds = manifest.map((entry) => entry.supportCaseId).filter((id): id is string => id !== null);
  const beneficiaryIds = manifest.map((entry) => entry.beneficiaryId).filter((id): id is string => id !== null);
  const caseList = supportCaseIds.map((id) => `'${id}'`).join(', ');
  const beneList = beneficiaryIds.map((id) => `'${id}'`).join(', ');
  const childTablesByCase = [
    'session_goal_scores',
    'action_items',
    'flags',
    'schedule_session_goals',
    'schedule_custom_questions',
    'sessions',
    'counseling_schedules',
    'goals',
    'support_case_assignees',
  ];
  const lines = [
    '-- best-effort 삭제(자식 → 부모). 완전 롤백이 아니다.',
    '-- 삭제 불가(설계상 append-only / FK):',
    '--   * audit_log, participant_consent_records → append-only 트리거가 DELETE 를 막는다.',
    '--   * support_cases, beneficiaries → participant_consent_records 의 FK 로 삭제 불가.',
    '--   * participant_pii_vault → beneficiaries FK 체인상 남는다.',
    '-- 따라서 진짜 롤백은 적용 전에 저장한 Time Travel 북마크로만 한다(RUNBOOK 3단계).',
    '',
  ];
  if (caseList.length === 0) {
    lines.push('-- (생성된 케이스 없음)');
    return `${lines.join('\n')}\n`;
  }
  for (const table of childTablesByCase) {
    if (table === 'session_goal_scores') {
      lines.push(`DELETE FROM session_goal_scores WHERE org_id = '${ORG_ID}' AND session_id IN (`);
      lines.push(`  SELECT id FROM sessions WHERE org_id = '${ORG_ID}' AND support_case_id IN (${caseList}));`);
    } else {
      lines.push(`DELETE FROM ${table} WHERE org_id = '${ORG_ID}' AND support_case_id IN (${caseList});`);
    }
  }
  lines.push('');
  lines.push('-- 아래는 FK/append-only 로 막혀 실패한다(의도된 안전장치, 참고용 주석):');
  lines.push(`-- DELETE FROM participant_pii_vault WHERE org_id = '${ORG_ID}' AND beneficiary_id IN (${beneList});`);
  lines.push(`-- DELETE FROM support_cases WHERE org_id = '${ORG_ID}' AND id IN (${caseList});`);
  lines.push(`-- DELETE FROM beneficiaries WHERE org_id = '${ORG_ID}' AND id IN (${beneList});`);
  lines.push('');
  return lines.join('\n');
}

function buildCaptureReport(
  emitted: readonly EmittedRich[],
  tableInsertCounts: Record<string, number>,
  sessionCount: number,
  validationChecks: string[],
): string {
  const inserts = emitted.filter((entry) => entry.keyword === 'INSERT').length;
  const updates = emitted.filter((entry) => entry.keyword === 'UPDATE').length;
  const generatedAuditInserts = tableInsertCounts.audit_log ?? 0;
  const lines = [
    '# CCC 시드 캡처 리포트',
    '# (키·평문 PII 미포함 — 문장 수·구조 요약만)',
    '',
    `총 방출 문장 수: ${emitted.length} (INSERT ${inserts} / UPDATE ${updates})`,
    `참여자: ${PARTICIPANTS.length} · 가상 상담사: ${VIRTUAL_COUNSELORS.length} · 세션: ${sessionCount}`,
    '',
    '## 테이블별 INSERT 수',
    ...Object.entries(tableInsertCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([table, count]) => `  ${table}: ${count}`),
    '',
    '## audit_log 기대치',
    `  운영 기준선: ${OPERATIONAL_AUDIT_BASELINE}`,
    `  방출 audit INSERT: ${generatedAuditInserts}`,
    `  트리거 재생성(세션당 1): ${sessionCount}`,
    `  적용 후 기대 총합: ${OPERATIONAL_AUDIT_BASELINE + generatedAuditInserts + sessionCount}`,
    '',
    '## 검증 결과',
    ...validationChecks.map((check) => `  [ok] ${check}`),
    '',
    '## 알려진 특성',
    '  - 인테이크 케이스 목표는 게이트웨이 설계상 scale_criteria=NULL 이다.',
    '    (createCounselingSchedule intake 경로). scale_criteria JSON 은 목표 교체',
    '    successor(closeGoal, D12)에서만 실제 저장된다.',
    '  - listGoals 부트스트랩으로 목표 id 를 확보하므로 read 감사(action=read, goals)가',
    '    참여자당 1건씩 방출된다(D14: 열람도 감사 대상 — 정상).',
    '',
  ];
  return lines.join('\n');
}

describe('operational seed generation', () => {
  it('captures the gateway scenario, serializes seed.sql, and replays it into a fresh DB', async () => {
    const piiKey = requireEnv('PII_ENC_KEY');
    assertPiiKeyMaterial(piiKey);

    const harness = await createCaptureHarness();
    let summarySessions = 0;
    let seedSql = '';
    let emitted: EmittedRich[] = [];
    try {
      const summary = await runScenario(harness.env, harness.capture);
      summarySessions = summary.sessions;

      emitted = emitStatements(harness.capture.writes);
      expect(emitted.length).toBeGreaterThan(0);

      seedSql = assembleSeedSql(emitted);

      // 재분할 문장 수 == 방출 수(이스케이프/따옴표 버그 검출).
      const pureJoined = emitted.map((entry) => `${entry.inlinedSql};`).join('\n');
      const split = unstable_splitSqlQuery(pureJoined);
      expect(split.length).toBe(emitted.length);

      // 신선한 DB 재생 + 전면 대조.
      const report = await validateSeed({
        captureDb: harness.captureDb,
        emitted: emitted.map((entry) => ({ inlinedSql: entry.inlinedSql, batchId: entry.batchId })),
        piiKey,
      });
      expect(report.consentRecords).toBe(PARTICIPANTS.length);
      expect(report.vaultRows).toBe(PARTICIPANTS.length);
      expect(report.activeGoalsMaxPerCase).toBeLessThanOrEqual(3);
      expect(report.decryptedParticipants).toBe(PARTICIPANTS.length);

      // 산출물 기록.
      const { manifest, tableInsertCounts } = buildManifest(emitted, summarySessions);
      const perParticipant = manifest.perParticipant as ParticipantManifest[];
      await mkdir(OUT_DIR, { recursive: true });
      await Promise.all([
        writeFile(join(OUT_DIR, 'seed.sql'), seedSql, 'utf8'),
        writeFile(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
        writeFile(join(OUT_DIR, 'verify.sql'), buildVerifySql(emitted, summarySessions), 'utf8'),
        writeFile(join(OUT_DIR, 'delete-best-effort.sql'), buildDeleteBestEffort(perParticipant), 'utf8'),
        writeFile(
          join(OUT_DIR, 'capture-report.txt'),
          buildCaptureReport(emitted, tableInsertCounts, summarySessions, report.checks),
          'utf8',
        ),
      ]);

      // 방출 규모가 스펙 범위(대략 1,200~1,600) 근처인지 가볍게 확인.
      expect(emitted.length).toBeGreaterThan(600);
    } finally {
      await harness.dispose();
    }
  });
});
