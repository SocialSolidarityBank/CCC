-- ============================================================================
-- 마이그레이션 0002 — users (사용자 디렉터리)
--
-- 근거: CLAUDE.md 2장(인증: Cloudflare Access, 역할 관리자·상담사) + D1(멀티테넌트 문) + D7(접근 모델) + D13(Mac Mini = service).
-- 운영 인증 흐름:
--   Cloudflare Access가 사람 로그인은 이메일로, 서비스 토큰(Mac Mini)은 client id /
--   common_name으로 검증한 JWT를 넘긴다. 앱은 그 식별자를 이 테이블에서 조회해
--   {userId, orgId, role}로 매핑한다. 디렉터리에 없거나 비활성(active=0)인 신원은
--   Access를 통과했더라도 앱 접근을 거부한다(프로비저닝 안 됨).
--   * email 컬럼은 사람은 로그인 이메일, 서비스 토큰은 토큰의 client id / common name을 담는다.
--   * email은 전역 UNIQUE다: 신원 해석(findUserByEmail)은 org를 알기 전 이메일만으로
--     일어나므로(인증 전 단계), 이메일 하나가 정확히 한 신원에 대응해야 한다.
--   * 행 삭제는 쓰지 않는다(0001 공통 규약). 비활성화는 active=0으로 기록한다.
-- ============================================================================

CREATE TABLE users (
  id         TEXT PRIMARY KEY,                       -- 앱(gateway)이 발급한 UUID
  org_id     TEXT NOT NULL,                          -- 조직 ID (D1)
  email      TEXT NOT NULL UNIQUE,                   -- 사람=로그인 이메일 / 서비스 토큰=client id·common_name
  role       TEXT NOT NULL
             CHECK (role IN ('admin', 'counselor', 'service')),
  active     INTEGER NOT NULL DEFAULT 1,             -- 1=활성, 0=비활성(비활성 신원은 접근 거부)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 조직별 활성 사용자 조회(디렉터리 목록·마지막 관리자 판정)용.
CREATE INDEX idx_users_org ON users (org_id, active);
