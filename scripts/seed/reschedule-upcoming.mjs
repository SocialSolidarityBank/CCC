/**
 * 예정 일정(`status='scheduled'`)을 기준일부터 다시 펴는 SQL 을 만든다.
 *
 * 왜 있나: 시드는 한 번 적용하면 끝이고, `counseling_schedules.scheduled_at` 은 그 시점의
 * 절대값이다. '다가오는 일정'은 **오늘 + 향후 7일(8일 창, 기관 시간대)** 만 보므로 시간이
 * 흐르면 화면이 실무자·관리자 양쪽 모두 빈다. 시드를 다시 만드는 것으로는 **이미 넣은 DB 가
 * 고쳐지지 않는다**(id 중복 · `audit_log` append-only · FK 로 삭제 불가 — 진짜 롤백은
 * Time Travel 뿐). 그래서 낡을 때마다 다시 돌리는 도구가 따로 필요하다.
 *
 * 쓰는 법(값이 stdout 에 닿는 시크릿은 없다):
 *   node scripts/seed/reschedule-upcoming.mjs --org=bss > /tmp/reschedule.sql
 *   # apps/api 에서 검토 후 적용
 *   wrangler d1 execute ccc-preview --env preview --remote --file /tmp/reschedule.sql
 *
 * 지키는 규칙 3개(전부 실패로 배운 것):
 *  1. `status='scheduled'` 만 옮긴다. `completed` 를 미래로 옮기면 이미 있는 상담 기록
 *     (`sessions.held_at`)과 어긋난다. 스키마 CHECK 가 scheduled 에는 세션이 붙어 있지
 *     않음을 보장하므로(`completed_session_id IS NULL`) 딸려 오는 것이 없다.
 *  2. `version = version + 1` 을 함께 쓴다. `counseling_schedules_update_guard` 가 `OF` 절
 *     없이 모든 UPDATE 에 걸려 있어 버전을 올리지 않으면 `participant_schema_violation`
 *     으로 거부된다.
 *  3. 순위를 **임시 표에 먼저 굳힌다.** 한 UPDATE 안에서 `scheduled_at` 을 읽어 순위를
 *     매기면서 같은 열을 고치면, SQLite 가 행을 하나씩 처리하는 동안 이미 고친 값이 뒤
 *     행의 순위 계산에 섞인다 — 결과가 조용히 뒤엉킨다.
 *
 * 창이 8일인데 21일에 걸쳐 펴는 이유: 한 주에 몰아 두면 그 주가 지나는 순간 다시 빈다.
 * 넓게 펴 두면 날이 갈수록 뒤엣것이 창 안으로 들어온다. 그래도 기간이 끝나면 또 낡으므로
 * 이 스크립트는 **한 번 쓰고 버리는 것이 아니라 상비 도구**다.
 */

/** 기본 분산 기간(일). 8일 창보다 넉넉해야 한 주가 지나도 남는다. */
const DEFAULT_SPREAD_DAYS = 21;

/** 슬롯 시각(UTC). 기관 시간대 Asia/Seoul 기준 10:00 · 13:00 에 대응한다. */
const FIRST_SLOT_HOUR_UTC = 1;
const SECOND_SLOT_OFFSET_HOURS = 3;

/** 계획을 굳힐 임시 표 이름. 마지막에 지운다. */
const PLAN_TABLE = 'seed_reschedule_plan';

/** SQL 문자열 리터럴로 감싼다(작은따옴표만 이스케이프하면 충분한 값들만 들어온다). */
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** `YYYY-MM-DD` 형식과 실제 존재하는 날짜인지 확인한다. */
function assertDateOnly(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`[reschedule] ${label} 는 YYYY-MM-DD 형식이어야 합니다: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`[reschedule] ${label} 가 존재하지 않는 날짜입니다: ${value}`);
  }
}

/** 기관 시간대(기본 Asia/Seoul) 기준 오늘 날짜를 `YYYY-MM-DD` 로 돌려준다. */
export function todayInTimeZone(now, timeZone = 'Asia/Seoul') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * 재배치 SQL 을 만든다.
 *
 * @param {object} options
 * @param {string} options.orgId 기관 ID(시드는 `bss`, 테스트는 `org_demo`).
 * @param {string} options.from 첫 슬롯이 놓일 날짜(`YYYY-MM-DD`, 기관 시간대 기준).
 * @param {string} options.updatedAt `updated_at` 에 찍을 ISO 시각.
 * @param {number} [options.spreadDays] 분산 기간(일). 기본 21.
 * @returns {{ sql: string, statements: string[] }} 전체 파일과 문장 배열(문장은 순서대로 실행).
 */
export function buildRescheduleSql({ orgId, from, updatedAt, spreadDays = DEFAULT_SPREAD_DAYS }) {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    throw new Error('[reschedule] orgId 가 필요합니다.');
  }
  assertDateOnly(from, 'from');
  if (!Number.isInteger(spreadDays) || spreadDays < 1) {
    throw new Error(`[reschedule] spreadDays 는 1 이상의 정수여야 합니다: ${spreadDays}`);
  }
  if (Number.isNaN(new Date(updatedAt).getTime())) {
    throw new Error(`[reschedule] updatedAt 이 유효한 시각이 아닙니다: ${updatedAt}`);
  }

  const org = quote(orgId);
  const base = quote(`${from} 00:00:00`);
  // rn(0부터)·total 로 날짜를 고르고, 같은 날에 둘이 겹치면 두 번째를 오후로 민다.
  // 정수 나눗셈이라 rank 최대(total-1)에서도 spreadDays 를 넘지 않는다.
  const dayShift = `'+' || (p.rn * ${spreadDays} / p.total) || ' days'`;
  const hourShift = `'+' || (${FIRST_SLOT_HOUR_UTC} + (p.rn % 2) * ${SECOND_SLOT_OFFSET_HOURS}) || ' hours'`;

  const statements = [
    `DROP TABLE IF EXISTS ${PLAN_TABLE}`,
    `CREATE TABLE ${PLAN_TABLE} (id TEXT PRIMARY KEY, new_at TEXT NOT NULL)`,
    // 순위·총계를 먼저 굳힌다(위 주석 3번). 정렬은 기존 순서를 보존해 이야기 흐름을 유지한다.
    [
      `INSERT INTO ${PLAN_TABLE} (id, new_at)`,
      `SELECT p.id,`,
      `       strftime('%Y-%m-%dT%H:%M:%S.000Z', datetime(${base}, ${dayShift}, ${hourShift}))`,
      `  FROM (SELECT id,`,
      `               ROW_NUMBER() OVER (ORDER BY scheduled_at, id) - 1 AS rn,`,
      `               COUNT(*) OVER () AS total`,
      `          FROM counseling_schedules`,
      `         WHERE org_id = ${org} AND status = 'scheduled') AS p`,
    ].join('\n'),
    [
      `UPDATE counseling_schedules`,
      `   SET scheduled_at = (SELECT new_at FROM ${PLAN_TABLE} WHERE ${PLAN_TABLE}.id = counseling_schedules.id),`,
      `       version = version + 1,`,
      `       updated_at = ${quote(updatedAt)}`,
      ` WHERE org_id = ${org}`,
      `   AND status = 'scheduled'`,
      `   AND id IN (SELECT id FROM ${PLAN_TABLE})`,
    ].join('\n'),
    `DROP TABLE ${PLAN_TABLE}`,
    // 적용 직후 눈으로 확인할 값(wrangler 가 결과를 표로 찍는다).
    [
      `SELECT 'rescheduled' AS check_name, COUNT(*) AS value, MIN(scheduled_at) AS first_at, MAX(scheduled_at) AS last_at`,
      `  FROM counseling_schedules WHERE org_id = ${org} AND status = 'scheduled'`,
    ].join('\n'),
  ];

  const header = [
    `-- 예정 일정 재배치 (생성 시각 ${updatedAt})`,
    `-- 기관 ${orgId} · 기준일 ${from} · 분산 ${spreadDays}일 · status='scheduled' 만 이동`,
    `-- 생성: node scripts/seed/reschedule-upcoming.mjs --org=${orgId} --from=${from} --days=${spreadDays}`,
    `-- 적용: wrangler d1 execute <DB> --env <env> --remote --file <이 파일>`,
    `-- completed 일정은 건드리지 않는다(상담 기록 held_at 과 어긋난다).`,
    '',
  ].join('\n');

  return { sql: `${header}${statements.map((statement) => `${statement};`).join('\n\n')}\n`, statements };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (match === null) throw new Error(`[reschedule] 알 수 없는 인자: ${arg}`);
    options[match[1]] = match[2] ?? 'true';
  }
  return options;
}

// CLI 진입(직접 실행할 때만 — 테스트는 buildRescheduleSql 만 쓴다).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const { sql } = buildRescheduleSql({
    orgId: args.org ?? 'bss',
    from: args.from ?? todayInTimeZone(now),
    updatedAt: now.toISOString(),
    spreadDays: args.days === undefined ? DEFAULT_SPREAD_DAYS : Number.parseInt(args.days, 10),
  });
  process.stdout.write(sql);
}
