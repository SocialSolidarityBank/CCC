declare module 'better-sqlite3-multiple-ciphers' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    readonly reader: boolean;
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): RunResult;
  }

  export interface Transaction<T> {
    (): T;
    immediate(): T;
  }

  export default class NativeDatabase {
    constructor(filename: string, options?: { fileMustExist?: boolean; timeout?: number });
    prepare(sql: string): Statement;
    transaction<T>(operation: () => T): Transaction<T>;
    exec(sql: string): this;
    key(key: Buffer): number;
    defaultSafeIntegers(enabled?: boolean): this;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): this;
  }
}
