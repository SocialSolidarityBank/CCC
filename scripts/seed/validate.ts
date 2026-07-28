/**
 * 재생 diff + 복호화 검증.
 *
 * [guard allowlist 대상] 신선한 두 번째 Miniflare 에 동일 프리로드를 깔고, 방출 문장을 원래
 * batchId 그룹 단위로 재생한 뒤 캡처 DB 와 대조한다. 재생 DB 에는 실행 시각만 다르므로
 * (id·평문 값은 seed 리터럴로 동일) 시계열 컬럼(_at)만 존재 여부로 정규화해 비교한다.
 *
 * 검사:
 *  - 전 시드 테이블 행 동등(_at 정규화, held_at/intake_at/scheduled_at 은 값까지 대조).
 *  - audit_log 는 (org_id, actor_id, actor_role, action, target_table, target_id,
 *    beneficiary_id, support_case_id, detail) multiset 비교(id·created_at 제외).
 *  - 불변식: 케이스당 활성 목표 ≤3, 세션별 점수 1~3 & 케이스 귀속, 동의 레코드 20,
 *    vault 20행·key_version=2·enc_name NOT NULL.
 *  - 복호화 라운드트립: enc_name/phone/email 을 AES-GCM(12B IV prefix) 로 풀어 content 와 대조.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { bootPreloadedContext } from './harness';
import { PARTICIPANTS } from './content';

export interface EmittedStatement {
  inlinedSql: string;
  batchId: number;
}

export interface ValidationReport {
  tablesCompared: string[];
  auditMultisetSize: number;
  vaultRows: number;
  consentRecords: number;
  activeGoalsMaxPerCase: number;
  sessionsChecked: number;
  decryptedParticipants: number;
  checks: string[];
}

const STABLE_AT_COLUMNS = new Set(['held_at', 'intake_at', 'scheduled_at']);

/** 시드가 쓰는 테이블(audit_log·organization_settings 제외 — 각각 별도/프리로드). */
const SEED_TABLES = [
  'beneficiaries',
  'participant_pii_vault',
  'support_cases',
  'support_case_assignees',
  'goals',
  'sessions',
  'session_goal_scores',
  'action_items',
  'flags',
  'counseling_schedules',
  'schedule_session_goals',
  'schedule_custom_questions',
  'participant_consent_records',
  'users',
] as const;

function normalizeRow(row: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    const value = row[key];
    if (STABLE_AT_COLUMNS.has(key)) {
      normalized[key] = value;
    } else if (key.endsWith('_at')) {
      // 벽시계 컬럼: 캡처/재생 시각이 다르므로 존재 여부만 정규화한다(NULL 패턴은 보존 = 상태 정보).
      normalized[key] = value === null ? null : 'SET';
    } else {
      normalized[key] = value;
    }
  }
  return JSON.stringify(normalized);
}

async function selectAll(db: D1Database, sql: string): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(sql).all<Record<string, unknown>>();
  return result.results ?? [];
}

function multisetEqual(a: string[], b: string[]): { equal: boolean; detail?: string } {
  if (a.length !== b.length) {
    return { equal: false, detail: `count ${a.length} vs ${b.length}` };
  }
  const left = [...a].sort();
  const right = [...b].sort();
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return { equal: false, detail: `first mismatch:\n  capture: ${left[i]}\n  replay:  ${right[i]}` };
    }
  }
  return { equal: true };
}

async function replayEmitted(replayDb: D1Database, emitted: readonly EmittedStatement[]): Promise<void> {
  let index = 0;
  while (index < emitted.length) {
    const batchId = emitted[index]!.batchId;
    const group: EmittedStatement[] = [];
    while (index < emitted.length && emitted[index]!.batchId === batchId) {
      group.push(emitted[index]!);
      index += 1;
    }
    if (group.length === 1) {
      await replayDb.prepare(group[0]!.inlinedSql).run();
    } else {
      await replayDb.batch(group.map((statement) => replayDb.prepare(statement.inlinedSql)));
    }
  }
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = Buffer.from(base64Key, 'base64');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptPii(key: CryptoKey, packedBase64: string): Promise<string> {
  const packed = Buffer.from(packedBase64, 'base64');
  const iv = packed.subarray(0, 12);
  const ciphertext = packed.subarray(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function assertTablesEqual(
  captureDb: D1Database,
  replayDb: D1Database,
  checks: string[],
): Promise<void> {
  for (const table of SEED_TABLES) {
    const captureRows = (await selectAll(captureDb, `SELECT * FROM ${table}`)).map(normalizeRow);
    const replayRows = (await selectAll(replayDb, `SELECT * FROM ${table}`)).map(normalizeRow);
    const result = multisetEqual(captureRows, replayRows);
    if (!result.equal) {
      throw new Error(`[seed] 재생 diff 실패: 테이블 ${table} 불일치 — ${result.detail}`);
    }
    checks.push(`table ${table}: ${captureRows.length} rows equal`);
  }
}

async function assertAuditEqual(
  captureDb: D1Database,
  replayDb: D1Database,
  checks: string[],
): Promise<number> {
  const projection = `SELECT org_id, actor_id, actor_role, action, target_table, target_id,
                             beneficiary_id, support_case_id, detail
                      FROM audit_log`;
  const captureRows = (await selectAll(captureDb, projection)).map((row) => JSON.stringify(row));
  const replayRows = (await selectAll(replayDb, projection)).map((row) => JSON.stringify(row));
  const result = multisetEqual(captureRows, replayRows);
  if (!result.equal) {
    throw new Error(`[seed] audit_log multiset 불일치 — ${result.detail}`);
  }
  checks.push(`audit_log multiset: ${captureRows.length} rows equal`);
  return captureRows.length;
}

async function assertInvariants(replayDb: D1Database, checks: string[]): Promise<{
  activeGoalsMax: number;
  sessions: number;
  consent: number;
  vault: number;
}> {
  // 케이스당 활성 목표 ≤ 3.
  const activeGoals = await selectAll(
    replayDb,
    `SELECT support_case_id, COUNT(*) AS active FROM goals WHERE status = 'active' GROUP BY support_case_id`,
  );
  let activeGoalsMax = 0;
  for (const row of activeGoals) {
    const active = Number(row.active);
    activeGoalsMax = Math.max(activeGoalsMax, active);
    if (active > 3) {
      throw new Error(`[seed] 불변식 위반: 케이스 ${String(row.support_case_id)} 활성 목표 ${active} > 3`);
    }
  }
  checks.push(`active goals per case <= 3 (max ${activeGoalsMax})`);

  // 세션별 점수 1~3 & 모든 점수 goal 이 세션 케이스에 귀속.
  const perSession = await selectAll(
    replayDb,
    `SELECT s.id AS session_id, s.support_case_id AS case_id, COUNT(sgs.id) AS score_count
     FROM sessions s
     LEFT JOIN session_goal_scores sgs ON sgs.session_id = s.id
     GROUP BY s.id, s.support_case_id`,
  );
  for (const row of perSession) {
    const count = Number(row.score_count);
    if (count < 1 || count > 3) {
      throw new Error(`[seed] 불변식 위반: 세션 ${String(row.session_id)} 점수 수 ${count} (1~3 아님)`);
    }
  }
  const mismatched = await selectAll(
    replayDb,
    `SELECT sgs.id
     FROM session_goal_scores sgs
     JOIN sessions s ON s.id = sgs.session_id
     JOIN goals g ON g.id = sgs.goal_id
     WHERE g.support_case_id <> s.support_case_id`,
  );
  if (mismatched.length > 0) {
    throw new Error(`[seed] 불변식 위반: 세션 케이스와 다른 goal 점수 ${mismatched.length}건`);
  }
  checks.push(`per-session score count in [1,3] and goal belongs to case (${perSession.length} sessions)`);

  // 동의 레코드 20.
  const consentRow = await replayDb
    .prepare('SELECT COUNT(*) AS n FROM participant_consent_records')
    .first<{ n: number }>();
  const consent = Number(consentRow?.n ?? 0);
  if (consent !== PARTICIPANTS.length) {
    throw new Error(`[seed] 불변식 위반: 동의 레코드 ${consent} != ${PARTICIPANTS.length}`);
  }
  checks.push(`consent records == ${consent}`);

  // vault 20행 · key_version=2 · enc_name NOT NULL.
  const vaultRow = await replayDb
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN key_version = 2 THEN 1 ELSE 0 END) AS v2,
                     SUM(CASE WHEN enc_name IS NOT NULL THEN 1 ELSE 0 END) AS named
              FROM participant_pii_vault`)
    .first<{ total: number; v2: number; named: number }>();
  const vault = Number(vaultRow?.total ?? 0);
  if (vault !== PARTICIPANTS.length || Number(vaultRow?.v2) !== vault || Number(vaultRow?.named) !== vault) {
    throw new Error(
      `[seed] 불변식 위반: vault total=${vault} v2=${Number(vaultRow?.v2)} named=${Number(vaultRow?.named)} (기대 ${PARTICIPANTS.length})`,
    );
  }
  checks.push(`vault rows == ${vault}, all key_version=2, all enc_name NOT NULL`);

  return { activeGoalsMax, sessions: perSession.length, consent, vault };
}

async function assertDecryptionRoundtrip(
  replayDb: D1Database,
  piiKey: string,
  checks: string[],
): Promise<number> {
  const key = await importAesKey(piiKey);
  const rows = await selectAll(
    replayDb,
    'SELECT enc_name, enc_phone, enc_email FROM participant_pii_vault',
  );
  const decrypted: string[] = [];
  for (const row of rows) {
    const name = await decryptPii(key, String(row.enc_name));
    const phone = await decryptPii(key, String(row.enc_phone));
    const emailValue = await decryptPii(key, String(row.enc_email));
    decrypted.push(JSON.stringify({ name, phone, email: emailValue }));
  }
  const expected = PARTICIPANTS.map((participant) => JSON.stringify({
    name: participant.name,
    phone: participant.phone,
    email: participant.email,
  }));
  const result = multisetEqual(decrypted, expected);
  if (!result.equal) {
    throw new Error(`[seed] 복호화 라운드트립 실패 — ${result.detail}`);
  }
  checks.push(`decryption roundtrip: ${decrypted.length} participants match content`);
  return decrypted.length;
}

/**
 * 방출 문장을 신선한 DB 에 재생하고 캡처 DB 와 전면 대조한다. 실패 시 throw.
 */
export async function validateSeed(options: {
  captureDb: D1Database;
  emitted: readonly EmittedStatement[];
  piiKey: string;
}): Promise<ValidationReport> {
  const replay = await bootPreloadedContext();
  const checks: string[] = [];
  try {
    await replayEmitted(replay.db, options.emitted);
    await assertTablesEqual(options.captureDb, replay.db, checks);
    const auditMultisetSize = await assertAuditEqual(options.captureDb, replay.db, checks);
    const invariants = await assertInvariants(replay.db, checks);
    const decryptedParticipants = await assertDecryptionRoundtrip(replay.db, options.piiKey, checks);
    return {
      tablesCompared: [...SEED_TABLES],
      auditMultisetSize,
      vaultRows: invariants.vault,
      consentRecords: invariants.consent,
      activeGoalsMaxPerCase: invariants.activeGoalsMax,
      sessionsChecked: invariants.sessions,
      decryptedParticipants,
      checks,
    };
  } finally {
    await replay.dispose();
  }
}
