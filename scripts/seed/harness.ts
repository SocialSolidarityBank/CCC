/**
 * Miniflare 부트 + 마이그레이션 적용 + raw 프리로드.
 *
 * [guard allowlist 대상] apps/api/test/support/d1.ts 의 createD1TestContext 를 재사용해
 * Miniflare 를 띄우고 migrations/ 를 적용한다(readD1Migrations 가 트리거 BEGIN…END 를 안전
 * 분할). provisionDirectory:false 로 테스트 디렉터리는 만들지 않고, 미리보기 fixture('bss')를
 * 직접 프리로드한다. 프리로드는 캡처하지 않는다(캡처 프록시로 감싸기 전 raw D1 에 건다).
 *
 * 반환 env 는 직접 구성한다: PII_ENC_KEY 는 process.env 에서 받고(값 로그 금지),
 * PII_KEY_VERSION 은 미리보기 fixture 키 세대 '2'로 고정한다.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { createD1Database } from '@ccc/db-d1';
import { createD1TestContext } from '../../apps/api/test/support/d1';
import type { Env } from '@ccc/core/gateway';
import { preloadStatements } from './preload-data';
import { D1Capture } from './capture';

/** 미리보기 fixture PII 키 세대(D3). vault.key_version 이 이 값으로 기록된다. */
export const SEED_PII_KEY_VERSION = '2';

/** 필수 환경 변수를 값 노출 없이 요구한다. 미설정이면 명시 실패한다. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `[seed] 환경 변수 ${name} 가 설정되지 않았습니다. 실행 예:\n`
        + `  PII_ENC_KEY=<base64 32B> pnpm seed:generate:local\n`
        + `(원격 미리보기는 RUNBOOK의 seed:generate:preview 경로를 쓰세요.)`,
    );
  }
  return value;
}

/**
 * PII_ENC_KEY 가 base64 32바이트인지 검증한다. 값은 절대 로그·에러 메시지에 넣지 않는다(R3).
 * 길이만 확인해 잘못된 키를 조기에 걸러낸다(게이트웨이도 암호화 시 재검증한다).
 */
export function assertPiiKeyMaterial(key: string): void {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(key, 'base64');
  } catch {
    throw new Error('[seed] PII_ENC_KEY 는 base64 문자열이어야 합니다(값은 표시하지 않습니다).');
  }
  if (decoded.byteLength !== 32) {
    throw new Error(
      `[seed] PII_ENC_KEY 는 base64 디코드 시 32바이트여야 합니다(현재 ${decoded.byteLength}B, 값은 표시하지 않습니다).`,
    );
  }
}

export interface PreloadedContext {
  db: D1Database;
  dispose(): Promise<void>;
}

/**
 * Miniflare 컨텍스트를 만들고 마이그레이션 적용 후 미리보기 fixture 를 raw 프리로드한다.
 * 반환 db 는 캡처하지 않은 실 D1 이다(캡처가 필요하면 buildSeedEnv 로 감싼다).
 */
export async function bootPreloadedContext(): Promise<PreloadedContext> {
  const context = await createD1TestContext({ provisionDirectory: false });
  const db = context.db as unknown as D1Database;
  for (const statement of preloadStatements()) {
    await db.prepare(statement.sql).bind(...statement.params).run();
  }
  return { db, dispose: context.dispose };
}

/** 캡처 프록시로 감싼 게이트웨이 Env 를 만든다. PII_ENC_KEY 는 process.env 에서 받는다. */
export function buildSeedEnv(db: D1Database, capture: D1Capture): Env {
  const key = requireEnv('PII_ENC_KEY');
  assertPiiKeyMaterial(key);
  return {
    DB: createD1Database(capture.wrap(db)),
    PII_ENC_KEY: key,
    PII_KEY_VERSION: SEED_PII_KEY_VERSION,
  };
}

export interface CaptureHarness {
  /** 게이트웨이 함수에 넘기는 env(캡처 프록시 포함). */
  env: Env;
  /** 시나리오가 단계 주석을 붙이는 캡처 인스턴스. */
  capture: D1Capture;
  /** 캡처 side 상태를 검증에서 읽기 위한 raw D1(캡처하지 않음). */
  captureDb: D1Database;
  dispose(): Promise<void>;
}

/** 프리로드된 캡처 하니스(env + 캡처 + raw DB) 를 만든다. */
export async function createCaptureHarness(): Promise<CaptureHarness> {
  const context = await bootPreloadedContext();
  const capture = new D1Capture();
  const env = buildSeedEnv(context.db, capture);
  return { env, capture, captureDb: context.db, dispose: context.dispose };
}
