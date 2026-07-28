/**
 * D1 캡처 프록시 — 실제 게이트웨이가 실행하는 쓰기 SQL 을 순서대로 기록한다.
 *
 * [guard allowlist 대상] 이 파일만 raw D1(실 D1Database)을 감싼다. 시드 툴의 나머지는
 * 전부 게이트웨이 공개 함수를 경유한다(R1). 프록시는:
 *   - prepare(sql) / batch(stmts) 만 구현하고 raw/exec/withSession/dump 는 throw 한다
 *     (게이트웨이가 그 경로를 쓰지 않음이 검증됨 — 새 경로가 생기면 즉시 드러난다).
 *   - .run() 은 실행이 성공한 뒤에만 {sql, params, via:'run'} 을 기록한다. UNIQUE 충돌로
 *     실패한 문장/배치는 아무것도 실행되지 않으므로(재시도 루프) 기록도 하지 않는다.
 *   - .first()/.all() 은 passthrough 하되 읽기로 기록하고, 첫 키워드가 INSERT/UPDATE/DELETE 면
 *     hard-fail 한다(쓰기가 읽기 메서드로 새는 것을 차단).
 *   - batch() 는 wrapped 문장을 unwrap → 실 batch 실행 → 성공 시에만 배열 순서대로 기록하고,
 *     결과 객체는 원본 그대로 반환한다(게이트웨이가 results[i].meta.changes 를 검사).
 *
 * 시나리오는 엄격히 순차 실행하므로(Promise.all 금지) 기록 순서 = 실제 실행 순서다.
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { firstKeyword, type SqlParam } from './sql-literal';

export interface WriteEntry {
  sql: string;
  params: SqlParam[];
  via: 'run' | 'batch';
  /** 같은 batchId 를 공유하면 한 원자 배치에서 나온 문장이다. run() 은 각자 고유 batchId. */
  batchId: number;
  participantId: string;
  step: number;
}

export interface ReadEntry {
  sql: string;
  participantId: string;
  step: number;
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(`capture: ${message}`);
    this.name = 'CaptureError';
  }
}

interface StatementMeta {
  sql: string;
  params: SqlParam[];
  real: D1PreparedStatement;
}

function assertSqlParams(params: readonly unknown[]): SqlParam[] {
  return params.map((value) => {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    throw new CaptureError(`unsupported bind parameter type: ${typeof value}`);
  });
}

function assertReadOnly(sql: string): void {
  const keyword = firstKeyword(sql);
  if (keyword === 'INSERT' || keyword === 'UPDATE' || keyword === 'DELETE') {
    throw new CaptureError(`write statement leaked through a read method: ${keyword}`);
  }
}

export class D1Capture {
  readonly writes: WriteEntry[] = [];
  readonly reads: ReadEntry[] = [];
  private opCounter = 0;
  private context: { participantId: string; step: number } = { participantId: 'preload', step: 0 };
  private readonly meta = new WeakMap<object, StatementMeta>();

  /** 시나리오가 단계 경계에서 호출해 이후 기록에 붙일 주석 컨텍스트를 바꾼다. */
  mark(participantId: string, step: number): void {
    this.context = { participantId, step };
  }

  private nextOpId(): number {
    this.opCounter += 1;
    return this.opCounter;
  }

  private wrapStatement(real: D1PreparedStatement, sql: string, params: SqlParam[]): D1PreparedStatement {
    const capture = this;
    const wrapped = {
      bind(...values: unknown[]): D1PreparedStatement {
        const boundParams = assertSqlParams(values);
        return capture.wrapStatement(real.bind(...values), sql, boundParams);
      },
      async run<T = Record<string, unknown>>() {
        const result = await real.run<T>();
        const batchId = capture.nextOpId();
        capture.writes.push({ sql, params, via: 'run', batchId, ...capture.context });
        return result;
      },
      async first<T = unknown>(...args: unknown[]) {
        assertReadOnly(sql);
        capture.reads.push({ sql, ...capture.context });
        return (real.first as (...a: unknown[]) => Promise<T>)(...args);
      },
      async all<T = Record<string, unknown>>(...args: unknown[]) {
        assertReadOnly(sql);
        capture.reads.push({ sql, ...capture.context });
        return (real.all as (...a: unknown[]) => Promise<unknown>)(...args) as Promise<unknown>;
      },
      raw(): never {
        throw new CaptureError('statement.raw() is not supported by the capture proxy');
      },
    } as unknown as D1PreparedStatement;

    this.meta.set(wrapped as unknown as object, { sql, params, real });
    return wrapped;
  }

  /** 실 D1 을 감싼 캡처 프록시를 만든다. 게이트웨이 env.DB 로 넘긴다. */
  wrap(realDb: D1Database): D1Database {
    const capture = this;
    return {
      prepare(query: string): D1PreparedStatement {
        return capture.wrapStatement(realDb.prepare(query), query, []);
      },
      async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
        const metas = statements.map((statement) => {
          const found = capture.meta.get(statement as unknown as object);
          if (found === undefined) {
            throw new CaptureError('batch received a statement that did not originate from the capture proxy');
          }
          return found;
        });
        const results = await realDb.batch<T>(metas.map((entry) => entry.real));
        const batchId = capture.nextOpId();
        for (const entry of metas) {
          capture.writes.push({ sql: entry.sql, params: entry.params, via: 'batch', batchId, ...capture.context });
        }
        return results;
      },
      exec(): never {
        throw new CaptureError('db.exec() is not supported by the capture proxy');
      },
      dump(): never {
        throw new CaptureError('db.dump() is not supported by the capture proxy');
      },
      withSession(): never {
        throw new CaptureError('db.withSession() is not supported by the capture proxy');
      },
    } as unknown as D1Database;
  }
}
