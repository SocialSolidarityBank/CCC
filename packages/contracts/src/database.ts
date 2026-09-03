export interface Database {
  prepare(sql: string): PreparedStatement;
  batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]>;
}

export interface PreparedStatement {
  bind(...values: Bindable[]): PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<DatabaseResult<T>>;
  run(): Promise<DatabaseResult<unknown>>;
}

export interface DatabaseResult<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}

export type Bindable = string | number | null | Uint8Array;

export interface DatabaseError extends Error {
  kind: 'constraint' | 'syntax' | 'bind_arity' | 'unsupported';
  constraintSubtype?: 'unique' | 'primary_key' | 'foreign_key' | 'check' | 'trigger';
  applicationCode?: string;
}
