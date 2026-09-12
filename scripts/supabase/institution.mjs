import { createHash } from 'node:crypto';
import { PlanFailure } from './plan.mjs';

/**
 * ADR-0044 D86의 기관 생성. 설치가 기관을 만들고, 첫 로그인은 기관 초기 설정(표시 이름,
 * 첫 사업)만 한다. 그 초기 설정 화면조차 `GET /capabilities`를 먼저 부르고, gateway의
 * installedAiPolicyForOrg가 program_admission_policies 행을 찾지 못하면 409
 * admission_required로 닫힌다. 그 행을 쓰는 업무 경로는 createOrganizationSettings 뿐이고
 * 거기에는 HTTP route가 없으므로, 완료된 설치에서 이 명령만이 유일한 경로다.
 *
 * 기본값은 D32의 1년 보관 유예와 기관 시간대 Seoul이다. 두 표의 install 기본값은 D77의
 * stt_mode/llm_mode 'off'이며, 기능을 켜는 것은 나중의 업무 결정이다.
 */
const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
// migrations/postgres/0001의 organization_settings.time_zone CHECK과 같은 모양.
// 제약 위반은 PROVIDER_UNREADABLE로 평탄화되므로 여기서 고정 code로 먼저 거부한다.
const TIME_ZONE = /^(?:UTC|[A-Za-z0-9_+.-]{1,60}\/[A-Za-z0-9_+./-]{1,190})$/u;
const DIGITS = /^[0-9]{1,4}$/u;

export const DEFAULT_TIME_ZONE = 'Asia/Seoul';
export const DEFAULT_PII_PURGE_GRACE_DAYS = 365;
// organization_settings.pii_purge_grace_days의 저장 상한. 이 값 자체는 유효하지만
// packages/core/src/gateway.ts의 RETENTION_POLICY_MAX_DAYS(1826)를 넘는 값은
// 준비 상태에서 retentionPolicyStatus 'review_required'로 표시된다. 기본값 365는 아니다.
const PII_PURGE_GRACE_MAX_DAYS = 3660;

// 설치자가 쓰는 업무 표. 세 표 모두 FORCE RLS이고 정책은 ccc_api에만 있으므로
// 소유자 멤버십만으로는 읽지도 쓰지도 못한다. 이 transaction 안에서만 FORCE를 내리고
// 쓰기가 끝나면 되돌린다. 실패하면 ROLLBACK이 catalog까지 원래대로 돌린다.
const GUARDED_TABLES = Object.freeze([
  'public.organization_settings', 'public.program_admission_policies', 'public.audit_log',
]);

// postgres.js의 한 호출은 한 문장만 보낸다. 순서대로 각각 실행한다.
const LIFT_GUARDS = Object.freeze(
  GUARDED_TABLES.map(table => `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`),
);
const RESTORE_GUARDS = Object.freeze(
  GUARDED_TABLES.map(table => `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
);
const GUARD_STATE_QUERY = `SELECT count(*)::integer AS forced FROM pg_catalog.pg_class
  WHERE oid = ANY (ARRAY[${GUARDED_TABLES.map(table => `'${table}'::regclass`).join(',')}])
    AND relrowsecurity AND relforcerowsecurity`;

// 두 표를 한 번에 읽는다. 대상 기관이 없어도 한 행이 돌아오므로 존재 여부를 함께 판정한다.
const STATE_QUERY = `SELECT
    settings.org_id IS NOT NULL AS settings_exists,
    policy.org_id IS NOT NULL AS policy_exists,
    settings.time_zone, settings.pii_purge_grace_days::integer AS pii_purge_grace_days,
    policy.stt_mode, policy.llm_mode
  FROM (SELECT $1::text AS org_id) AS target
  LEFT JOIN organization_settings AS settings ON settings.org_id = target.org_id
  LEFT JOIN program_admission_policies AS policy ON policy.org_id = target.org_id`;

export function institutionActorId(orgId) {
  return `install:institution:${orgId}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** argv 값 검증. 값이 없으면 D32/Seoul 기본값을 쓴다. 잘못된 값은 공급자 접근 전에 거부된다. */
export function parseInstitutionSettings({ timeZone, piiPurgeGraceDays } = {}) {
  const zone = timeZone === null || timeZone === undefined ? DEFAULT_TIME_ZONE : String(timeZone).trim();
  const rawDays = piiPurgeGraceDays === null || piiPurgeGraceDays === undefined
    ? DEFAULT_PII_PURGE_GRACE_DAYS : piiPurgeGraceDays;
  const days = typeof rawDays === 'number' || DIGITS.test(String(rawDays).trim())
    ? Number(rawDays) : Number.NaN;
  if (!TIME_ZONE.test(zone) || zone.length > 255
    || !Number.isInteger(days) || days < 1 || days > PII_PURGE_GRACE_MAX_DAYS) {
    throw new PlanFailure('OPERATION_UNSUPPORTED');
  }
  try {
    // createOrganizationSettings와 같은 확인. 런타임이 모르는 시간대는 쓰지 않는다.
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
  } catch {
    throw new PlanFailure('OPERATION_UNSUPPORTED');
  }
  return { timeZone: zone, piiPurgeGraceDays: days };
}

function report(orgId, settings, modes) {
  return {
    ok: true,
    operation: 'create-institution',
    ready: true,
    orgIdSha256: sha256Hex(orgId),
    timeZone: settings.timeZone,
    piiPurgeGraceDays: settings.piiPurgeGraceDays,
    sttMode: modes.sttMode,
    llmMode: modes.llmMode,
  };
}

/**
 * 설치 잠금을 쥔 예약 연결에서 한 transaction으로 실행한다. 두 표가 모두 있으면 저장된
 * 값을 그대로 돌려주고 아무것도 쓰지 않는다. 한쪽만 있으면 반쪽 상태를 덮어쓰지 않고
 * 고정 code로 거부한다. 거부는 예외가 아니라 결과 값으로 돌려준다. 설치 연결 wrapper가
 * 예외 code를 PROVIDER_UNREADABLE로 평탄화하기 때문이다.
 */
export async function createInstitution(session, input) {
  if (typeof session?.unsafe !== 'function') throw new PlanFailure('PROVIDER_UNREADABLE');
  const orgId = typeof input?.orgId === 'string' ? input.orgId.trim() : '';
  if (!ORG_ID.test(orgId)) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  const settings = parseInstitutionSettings(input);
  const actorId = institutionActorId(orgId);
  await session.unsafe('BEGIN');
  try {
    for (const statement of LIFT_GUARDS) await session.unsafe(statement);
    const [state] = await session.unsafe(STATE_QUERY, [orgId]);
    if (state?.settings_exists === true && state?.policy_exists === true) {
      // 같은 기관에서 다시 실행한 경우. 저장된 값을 읽어서 돌려주고 아무것도 쓰지 않는다.
      await session.unsafe('ROLLBACK');
      return report(orgId, {
        timeZone: state.time_zone, piiPurgeGraceDays: Number(state.pii_purge_grace_days),
      }, { sttMode: state.stt_mode, llmMode: state.llm_mode });
    }
    if (state?.settings_exists === true || state?.policy_exists === true) {
      await session.unsafe('ROLLBACK');
      return { ok: false, code: 'INSTITUTION_STATE_INCONSISTENT' };
    }
    await session.unsafe(
      `INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days, version)
       VALUES ($1, $2, $3, 1)`,
      [orgId, settings.timeZone, settings.piiPurgeGraceDays],
    );
    await session.unsafe(
      `INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode)
       VALUES ($1, 1, 'off', 'off')`,
      [orgId],
    );
    await session.unsafe(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, detail)
       VALUES ($1, $2, 'service', 'create', 'organization_settings', $1, $3)`,
      [orgId, actorId, JSON.stringify({
        schemaVersion: 1,
        timeZone: settings.timeZone,
        piiPurgeGraceDays: settings.piiPurgeGraceDays,
        sttMode: 'off',
        llmMode: 'off',
      })],
    );
    for (const statement of RESTORE_GUARDS) await session.unsafe(statement);
    const [guards] = await session.unsafe(GUARD_STATE_QUERY);
    if (guards?.forced !== GUARDED_TABLES.length) {
      throw new PlanFailure('RESOURCE_OWNERSHIP_MISMATCH');
    }
    await session.unsafe('COMMIT');
    return report(orgId, settings, { sttMode: 'off', llmMode: 'off' });
  } catch (error) {
    await session.unsafe('ROLLBACK').catch(() => {});
    throw error;
  }
}
