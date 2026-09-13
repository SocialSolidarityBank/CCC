import { createHash, randomUUID } from 'node:crypto';
import { PlanFailure } from './plan.mjs';

/**
 * ADR-0044 D86의 첫 관리자 연결. 설치가 기관을 만들고, 첫 로그인이 기관 초기 설정이다.
 * 브라우저 양식으로는 첫 관리자를 만들 수 없으므로 이 연결만이 유일한 경로다.
 * 이메일과 Auth subject는 operator가 argv로 전달한 값이며 보고서에는 해시만 담는다.
 */
const AUTH_SUBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EMAIL = /^[^\s@;,'"\\]{1,64}@[A-Za-z0-9][A-Za-z0-9.-]{0,180}\.[A-Za-z]{2,24}$/u;
const NAME = /^[^\p{Cc}\p{Cf}]{1,120}$/u;
const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const HASH = /^[0-9a-f]{64}$/u;

export const FIRST_ADMIN_ACTION = 'first_admin_linked';
// 설치자가 쓰는 업무 표. 세 표 모두 FORCE RLS이고 정책은 ccc_api에만 있으므로
// 소유자 멤버십만으로는 읽지도 쓰지도 못한다. 이 transaction 안에서만 FORCE를 내리고
// 쓰기가 끝나면 되돌린다. 실패하면 ROLLBACK이 catalog까지 원래대로 돌린다.
const GUARDED_TABLES = Object.freeze(['public.users', 'public.user_role_assignments', 'public.audit_log']);

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
// 표준 역할 부여는 users insert의 users_seed_independent_roles_after_insert가 만든다.
// 첫 관리자도 업무 경로의 관리자와 같은 canonical 행을 가져야 하므로 직접 넣지 않고
// 그 결과를 확인한다. 0건이면 연결을 완성하지 않는다.
const SEEDED_ADMIN_QUERY = `SELECT count(*)::integer AS seeded FROM user_role_assignments
  WHERE org_id = $1 AND user_id = $2 AND role = 'institution_admin' AND revoked_at IS NULL`;

// getInstitutionReadiness가 읽는 영수증과 같은 조건. 여기서 0건이어야 첫 연결이다.
const RECEIPT_QUERY = `SELECT receipt.target_id, receipt.detail,
    holder.auth_subject, holder.email, holder.active, holder.role,
    EXISTS (SELECT 1 FROM user_role_assignments AS held
      WHERE held.user_id = holder.id AND held.org_id = holder.org_id
        AND held.role = 'institution_admin' AND held.revoked_at IS NULL) AS holds_admin
  FROM audit_log AS receipt
  LEFT JOIN users AS holder ON holder.id = receipt.target_id AND holder.org_id = receipt.org_id
  WHERE receipt.org_id = $1 AND receipt.actor_id = $2 AND receipt.actor_role = 'service'
    AND receipt.action = '${FIRST_ADMIN_ACTION}' AND receipt.target_table = 'users'
  LIMIT 2`;
const DIRECTORY_QUERY = `SELECT
  EXISTS (SELECT 1 FROM user_role_assignments AS held
    JOIN users AS holder ON holder.id = held.user_id AND holder.org_id = held.org_id
    WHERE held.org_id = $1 AND held.role = 'institution_admin' AND held.revoked_at IS NULL) AS admin_exists,
  EXISTS (SELECT 1 FROM users WHERE auth_subject = $2) AS subject_taken,
  EXISTS (SELECT 1 FROM users WHERE email = $3) AS email_taken`;

export function firstAdminActorId(orgId) {
  return `install:first-admin:${orgId}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** argv 값 검증. 대문자 uuid는 runtime의 subject 문자열과 해시가 달라지므로 거부한다. */
export function parseFirstAdminIdentity({ authSubject, email, name = null } = {}) {
  const subject = typeof authSubject === 'string' ? authSubject.trim() : '';
  const address = typeof email === 'string' ? email.trim() : '';
  const display = name === null || name === undefined ? null : String(name).trim();
  if (!AUTH_SUBJECT.test(subject) || address.length > 254 || !EMAIL.test(address)
    || (display !== null && !NAME.test(display))) {
    throw new PlanFailure('OPERATION_UNSUPPORTED');
  }
  return { authSubject: subject, email: address, name: display };
}

function receiptMatches(row, identity) {
  if (row === undefined || typeof row.detail !== 'string') return false;
  let detail;
  try {
    detail = JSON.parse(row.detail);
  } catch {
    return false;
  }
  return detail !== null && typeof detail === 'object' && !Array.isArray(detail)
    && Object.keys(detail).length === 3 && detail.schemaVersion === 1
    && typeof detail.emailSha256 === 'string' && HASH.test(detail.emailSha256)
    && typeof detail.authSubjectSha256 === 'string' && HASH.test(detail.authSubjectSha256)
    && detail.emailSha256 === sha256Hex(identity.email)
    && detail.authSubjectSha256 === sha256Hex(identity.authSubject)
    && row.auth_subject === identity.authSubject && row.email === identity.email
    && Number(row.active) === 1 && row.role === 'admin' && row.holds_admin === true
    && typeof row.target_id === 'string' && row.target_id.length > 0;
}

function report(userId, identity) {
  return {
    ok: true,
    operation: 'link-first-admin',
    ready: true,
    userIdSha256: sha256Hex(userId),
    emailSha256: sha256Hex(identity.email),
    authSubjectSha256: sha256Hex(identity.authSubject),
  };
}

/**
 * 설치 잠금을 쥔 예약 연결에서 한 transaction으로 실행한다. 정책이 ccc_api만 허용하므로
 * 세 업무 표의 FORCE RLS를 이 transaction 안에서만 내리고 쓰기가 끝나면 되돌린다.
 * 거부는 예외가 아니라 결과 값으로 돌려준다. 설치 연결 wrapper가 예외 code를
 * PROVIDER_UNREADABLE로 평탄화하기 때문이다.
 */
export async function linkFirstAdmin(session, input) {
  if (typeof session?.unsafe !== 'function') throw new PlanFailure('PROVIDER_UNREADABLE');
  const orgId = typeof input?.orgId === 'string' ? input.orgId.trim() : '';
  if (!ORG_ID.test(orgId)) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  const identity = parseFirstAdminIdentity(input);
  const actorId = firstAdminActorId(orgId);
  await session.unsafe('BEGIN');
  try {
    for (const statement of LIFT_GUARDS) await session.unsafe(statement);
    const receipts = await session.unsafe(RECEIPT_QUERY, [orgId, actorId]);
    if (receipts.length === 1 && receiptMatches(receipts[0], identity)) {
      // 같은 subject와 이메일로 다시 실행한 경우. 아무것도 쓰지 않고 같은 해시를 돌려준다.
      await session.unsafe('ROLLBACK');
      return report(receipts[0].target_id, identity);
    }
    if (receipts.length > 0) {
      await session.unsafe('ROLLBACK');
      return { ok: false, code: 'FIRST_ADMIN_EXISTS' };
    }
    const [directory] = await session.unsafe(DIRECTORY_QUERY, [orgId, identity.authSubject, identity.email]);
    if (directory?.admin_exists === true) {
      await session.unsafe('ROLLBACK');
      return { ok: false, code: 'FIRST_ADMIN_EXISTS' };
    }
    if (directory?.subject_taken !== false || directory?.email_taken !== false) {
      await session.unsafe('ROLLBACK');
      return {
        ok: false,
        code: directory?.subject_taken === true ? 'FIRST_ADMIN_SUBJECT_TAKEN' : 'FIRST_ADMIN_EMAIL_TAKEN',
      };
    }
    const userId = randomUUID();
    await session.unsafe(
      `INSERT INTO users (id, org_id, email, role, active, name, auth_subject)
       VALUES ($1, $2, $3, 'admin', 1, $4, $5)`,
      [userId, orgId, identity.email, identity.name, identity.authSubject],
    );
    const [seeded] = await session.unsafe(SEEDED_ADMIN_QUERY, [orgId, userId]);
    if (seeded?.seeded !== 1) throw new PlanFailure('RESOURCE_OWNERSHIP_MISMATCH');
    await session.unsafe(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, detail)
       VALUES ($1, $2, 'service', $3, 'users', $4, $5)`,
      [orgId, actorId, FIRST_ADMIN_ACTION, userId, JSON.stringify({
        schemaVersion: 1,
        emailSha256: sha256Hex(identity.email),
        authSubjectSha256: sha256Hex(identity.authSubject),
      })],
    );
    for (const statement of RESTORE_GUARDS) await session.unsafe(statement);
    const [guards] = await session.unsafe(GUARD_STATE_QUERY);
    if (guards?.forced !== GUARDED_TABLES.length) {
      throw new PlanFailure('RESOURCE_OWNERSHIP_MISMATCH');
    }
    await session.unsafe('COMMIT');
    return report(userId, identity);
  } catch (error) {
    await session.unsafe('ROLLBACK').catch(() => {});
    throw error;
  }
}
