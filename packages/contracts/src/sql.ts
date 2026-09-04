export class SqlLexicalError extends Error {
  override readonly name = 'SqlLexicalError';

  constructor() {
    super('invalid SQL syntax');
  }
}

export interface ScannedSql {
  postgresSql: string;
  parameterCount: number;
}

type ScanState = 'code' | 'single' | 'double' | 'line-comment' | 'block-comment';

export function scanSqlPlaceholders(sql: string): ScannedSql {
  let state: ScanState = 'code';
  let parameterCount = 0;
  let postgresSql = '';

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index]!;
    const next = sql[index + 1];

    if (state === 'single') {
      postgresSql += current;
      if (current === "'" && next === "'") {
        postgresSql += next;
        index += 1;
      } else if (current === "'") {
        state = 'code';
      }
      continue;
    }

    if (state === 'double') {
      postgresSql += current;
      if (current === '"' && next === '"') {
        postgresSql += next;
        index += 1;
      } else if (current === '"') {
        state = 'code';
      }
      continue;
    }

    if (state === 'line-comment') {
      postgresSql += current;
      if (current === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      postgresSql += current;
      if (current === '*' && next === '/') {
        postgresSql += next;
        index += 1;
        state = 'code';
      }
      continue;
    }

    if (current === "'") {
      state = 'single';
      postgresSql += current;
    } else if (current === '"') {
      state = 'double';
      postgresSql += current;
    } else if (current === '-' && next === '-') {
      state = 'line-comment';
      postgresSql += current + next;
      index += 1;
    } else if (current === '/' && next === '*') {
      state = 'block-comment';
      postgresSql += current + next;
      index += 1;
    } else if (current === '`' || (current === '?' && next !== undefined && /[0-9]/.test(next))) {
      throw new SqlLexicalError();
    } else if (current === '?') {
      parameterCount += 1;
      postgresSql += `$${parameterCount}`;
    } else {
      postgresSql += current;
    }
  }

  if (state === 'single' || state === 'double' || state === 'block-comment') {
    throw new SqlLexicalError();
  }

  return { postgresSql, parameterCount };
}
