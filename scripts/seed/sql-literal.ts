/**
 * 캡처된 파라미터화 문장을 인라인 SQL 리터럴로 직렬화한다(순수 함수).
 *
 * 게이트웨이는 `?` 바인드 플레이스홀더로만 쓰므로, 재생 가능한 seed.sql 을 만들려면
 * 바인딩 값을 안전하게 이스케이프해 문장 안으로 접어 넣어야 한다. 이 모듈은 D1 접근을
 * 전혀 하지 않는다 — 문자열 변환만 담당한다(guard allowlist 대상 아님).
 *
 * 안전 규칙(전부 위반 시 hard-fail — seed 를 만들다 죽는 편이 잘못된 seed 를 내보내는 것보다 낫다):
 * - 허용 파라미터 타입은 string | number | null 뿐이다.
 * - number 는 Number.isSafeInteger 만 허용(부동소수·정밀도 손실 차단).
 * - string 은 작은따옴표를 두 배로 이스케이프하고, NUL 문자는 거부한다.
 * - 플레이스홀더 치환은 작은따옴표 문자열 영역을 건너뛰며 좌→우로 bare `?` 만 바꾸고,
 *   치환 수가 파라미터 수와 정확히 같은지 확인한다.
 * - `?1` 같은 번호형 플레이스홀더가 방출 문장에 나타나면 거부한다(읽기 전용 SELECT 만
 *   번호형을 쓰며 그건 절대 방출되지 않는다 — 방출되면 캡처 필터 버그다).
 */

export type SqlParam = string | number | null;

const NUL = String.fromCharCode(0);

export class SqlLiteralError extends Error {
  constructor(message: string) {
    super(`sql-literal: ${message}`);
    this.name = 'SqlLiteralError';
  }
}

/** 단일 바인딩 값을 SQL 리터럴 토큰으로 변환한다. */
export function toSqlLiteral(value: SqlParam): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new SqlLiteralError(`number parameter is not a safe integer: ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.indexOf(NUL) !== -1) {
      throw new SqlLiteralError('string parameter contains a NUL character');
    }
    return `'${value.replace(/'/g, "''")}'`;
  }
  throw new SqlLiteralError(`unsupported parameter type: ${typeof value}`);
}

/**
 * 파라미터화 SQL 과 바인딩 배열을 받아 인라인 리터럴 문장을 만든다.
 * 반환 문자열에는 끝의 세미콜론이나 주석이 붙지 않는다(호출부가 조립한다).
 */
export function inlineSql(sql: string, params: readonly SqlParam[]): string {
  let out = '';
  let inString = false;
  let placeholderIndex = 0;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;

    if (inString) {
      if (ch === "'") {
        // 문자열 내부의 '' 는 이스케이프된 작은따옴표다 — 두 글자를 그대로 흘려보내고 문자열을 유지한다.
        if (sql[i + 1] === "'") {
          out += "''";
          i += 1;
          continue;
        }
        inString = false;
      }
      out += ch;
      continue;
    }

    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '?') {
      const next = sql[i + 1];
      if (next !== undefined && next >= '0' && next <= '9') {
        throw new SqlLiteralError('numbered placeholder (?N) must never be emitted');
      }
      if (placeholderIndex >= params.length) {
        throw new SqlLiteralError('more placeholders than parameters');
      }
      out += toSqlLiteral(params[placeholderIndex]!);
      placeholderIndex += 1;
      continue;
    }

    out += ch;
  }

  if (inString) {
    throw new SqlLiteralError('unterminated string literal in source SQL');
  }
  if (placeholderIndex !== params.length) {
    throw new SqlLiteralError(
      `placeholder/parameter count mismatch: substituted ${placeholderIndex} of ${params.length}`,
    );
  }
  return out;
}

/** SQL 문장의 첫 키워드(대문자)를 뽑는다. 선행 공백·라인 주석을 건너뛴다. */
export function firstKeyword(sql: string): string {
  let rest = sql;
  // 선행 공백과 `-- ...` 라인 주석을 반복 제거한다.
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    if (trimmed.startsWith('--')) {
      const newline = trimmed.indexOf('\n');
      rest = newline === -1 ? '' : trimmed.slice(newline + 1);
      continue;
    }
    rest = trimmed;
    break;
  }
  const match = rest.match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : '';
}
