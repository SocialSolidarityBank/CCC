import { describe, expect, it } from 'vitest';
import { scanSqlPlaceholders, SqlLexicalError } from '@ccc/contracts/sql';

describe('SQL placeholder scanner', () => {
  it('numbers only bare placeholders outside literals, identifiers, and comments', () => {
    const sql = `SELECT 'it''s ?' AS literal,
      "question?""column" AS doubled_identifier,
      "question?column" AS identifier,
      ? AS first_value,
      ? AS second_value -- ?
      /* ? */`;

    expect(scanSqlPlaceholders(sql)).toEqual({
      postgresSql: `SELECT 'it''s ?' AS literal,
      "question?""column" AS doubled_identifier,
      "question?column" AS identifier,
      $1 AS first_value,
      $2 AS second_value -- ?
      /* ? */`,
      parameterCount: 2,
    });
  });

  it.each([
    'SELECT ?1',
    'SELECT `value?`',
    "SELECT 'unterminated",
    'SELECT "unterminated',
    'SELECT 1 /* unterminated',
  ])('rejects invalid common-subset SQL before execution: %s', (sql) => {
    expect(() => scanSqlPlaceholders(sql)).toThrow(SqlLexicalError);
  });
});
