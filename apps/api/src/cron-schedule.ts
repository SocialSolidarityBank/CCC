/**
 * wrangler.toml [triggers].crons와 일치해야 한다.
 * index.ts(엔트리 모듈)에서 문자열을 export하면 workerd가 엔트리포인트로
 * 해석해 기동을 거부하므로 별도 모듈에 둔다.
 */
export const WATCHDOG_CRON = '*/30 * * * *';
export const PURGE_CRON = '0 3 * * *';
