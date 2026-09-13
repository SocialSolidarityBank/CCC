-- E6-4 Agent 페어링 자격. S2 §2.2 L64·L96 은 "서버에는 hash 와 installation binding만"
-- 이라고 못 박는다. 그래서 이 표는 sha256 hex 만 갖고, 평문 값은 발급 응답에 한 번만
-- 존재한다. `agent_installations` 에는 열을 더하지 않는다 — 등록 행 계약(0045)은 그대로다.
--
-- 세 종류의 수명은 S2 §2.4 L135-136 과 CCC_OPEN_PILOT_PLAN E6-4 의 값이다.
--   pairing_code  10분, 1회(consumed_at)
--   refresh       30일, rotate-on-use(이전 값 소비 + 새 행 발급)
--   bearer        900초
-- bearer 의 idle 제한 15분(L135)에는 별도 열을 두지 않는다. 절대 수명이 정확히 같은
-- 900초라 15분을 쉰 bearer 는 이미 만료된 bearer 이고, 두 조건이 한 열로 겹친다.
--
-- 재사용 판정도 열이 아니라 이 표의 모양이 만든다: 소비는 consumed_at 1회 쓰기이고
-- 회전은 새 행 INSERT 이므로, 이전 값을 다시 내밀면 consumed_at 이 있는 행에 맞는다.
CREATE TABLE agent_credentials (
  id              TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL REFERENCES agent_installations (installation_id),
  kind            TEXT NOT NULL CHECK (kind IN ('pairing_code', 'refresh', 'bearer')),
  token_hash      TEXT NOT NULL UNIQUE
                    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at       TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  consumed_at     TEXT,
  revoked_at      TEXT
);

-- 설치 단위 전면 폐기(pairing revoke, refresh 재사용)가 읽는 유일한 접근 경로.
CREATE INDEX idx_agent_credentials_installation
  ON agent_credentials (installation_id, kind, revoked_at);

-- 자격의 신원(설치·종류·hash·발급·만료)은 불변이고 consumed_at·revoked_at 은 한 번만
-- 쓰는 단방향 값이다. 값을 되돌리거나 바꾸는 UPDATE 와 모든 DELETE 는 중단한다.
-- NULL 비교가 조건을 통째로 NULL 로 만들어 가드를 비껴가지 않도록 `IS` 를 쓴다.
CREATE TRIGGER agent_credentials_transition_guard
BEFORE UPDATE ON agent_credentials
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.installation_id = OLD.installation_id
  AND NEW.kind = OLD.kind
  AND NEW.token_hash = OLD.token_hash
  AND NEW.issued_at = OLD.issued_at
  AND NEW.expires_at = OLD.expires_at
  AND (OLD.consumed_at IS NULL OR NEW.consumed_at IS OLD.consumed_at)
  AND (OLD.revoked_at IS NULL OR NEW.revoked_at IS OLD.revoked_at)
)
BEGIN SELECT RAISE(ABORT, 'agent_credential_immutable'); END;

CREATE TRIGGER agent_credentials_no_delete
BEFORE DELETE ON agent_credentials
BEGIN SELECT RAISE(ABORT, 'agent_credential_immutable'); END;
