-- ============================================================================
-- 마이그레이션 0021 — 초대 토큰 테이블 (D39 · ADR-0016 · CCC-29)
--
-- 번호 이력: 이 파일은 PR #5 에서 **0018** 로 태어났다. 그 사이 main 이 0020
--   (D44 동의 3종)을 먼저 머지했고, 미리보기 환경에는 0020 이 이미 적용돼 있다.
--   나중에 도착한 파일이 더 작은 번호를 다는 역순 적용을 피하려고 0021 로 올렸다.
--
-- 1차 MVP 가입 흐름의 기반. 두 종류의 초대를 한 테이블이 담는다:
--   * participant — 당사자 가입 링크(사업+발급 실무자 묶음, ADR-0016 결정 5).
--     가입 완료 시 당사자+케이스가 만들어지고 발급 실무자가 담당 실무자가 된다.
--     같은 토큰이 가입 후에는 당사자 자기 확인 페이지의 열람 자격이 된다.
--   * counselor — 실무자 초대 링크(관리자 발급, 가입 시 users 등재. CCC-33).
--
-- 토큰이 곧 자격(로그인 없음)이므로:
--   * token 은 32바이트 난수 hex(64자) — 추측·열거 불가가 보안의 전부다.
--   * 의미 정보(가입일자·사업 유형)를 토큰 문자열에 넣지 않는다(D20과 같은 이유).
--   * 발급·소비는 gateway 공용 함수만 거치고(R1) 전건 audit_log(D14).
--
-- status 는 issued → used 단방향. 만료(expires_at)는 두지 않는다 — 화면 흐름
-- 프로토타입(D39)이라 수명 정책은 실제 인증 설계(D26 법률 검토 후)와 함께 정한다.
-- used_by_* 는 가입 결과 역참조: participant 초대는 beneficiary, counselor 초대는
-- users.id 를 가리킨다(자기 확인 페이지가 토큰 → 당사자를 푸는 연결 고리).
--
-- 이 마이그레이션은 추가(additive) 전용이다. 기존 테이블·트리거를 바꾸지 않는다.
-- ============================================================================

CREATE TABLE invite_tokens (
  token                   TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('participant', 'counselor')),
  -- participant 초대에 필수(링크가 사업을 정한다), counselor 초대는 NULL.
  program_type            TEXT,
  issued_by               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used')),
  issued_at               TEXT NOT NULL DEFAULT (datetime('now')),
  used_at                 TEXT,
  used_by_beneficiary_id  TEXT,
  used_by_user_id         TEXT,
  CHECK (kind != 'participant' OR program_type IS NOT NULL)
);

CREATE INDEX idx_invite_tokens_org ON invite_tokens (org_id, kind, status);
