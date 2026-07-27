-- ============================================================================
-- 비영리 사례관리 프로그램 — Cloudflare D1(SQLite) 스키마 스냅샷 v0.8
--
-- 이 파일 = migrations/0001_init.sql부터 0008_participant_consent_records.sql까지를
--   순서대로 적용한 누적 결과다.
--   * 마이그레이션(migrations/*.sql)이 런타임·테스트의 진실 원천이다(test 하네스가
--     migrations 디렉터리를 적용한다). 이 schema.sql은 그 누적 결과의 읽기용 스냅샷이며,
--     새 마이그레이션을 순서대로 적용한 구조와 동등해야 한다.
--   * 이미 적용된 마이그레이션(0001·0002)은 편집 금지이며, 새 스키마 변경은 새
--     마이그레이션을 추가한 뒤 이 스냅샷에도 반영한다.
--
-- 근거 문서: CLAUDE.md 3장(데이터 설계 원칙) + 9장(설계 결정 D1~D15) + 2장(인증·역할)
-- 공통 규약:
--   * 날짜/시각은 UTC 텍스트("YYYY-MM-DD HH:MM:SS")로 저장한다.
--   * ID는 앱(gateway)에서 생성한 UUID 텍스트. 예외 2곳 —
--     beneficiaries.id(=cases.id)는 가명 ID(레거시 'A017' 또는 동물 슬러그
--     'swallow-003' — 0007 확장, D20. 신규 발급은 슬러그 형식),
--     audit_log.id는 자동 증가 정수(추가 전용 순서 보장).
--   * 모든 테이블에 org_id를 둔다(D1: 내부 전용이지만 멀티테넌트 문은 열어 둠).
--   * 행 삭제(DELETE)는 원칙적으로 쓰지 않는다. 종료·해제는 시각 컬럼으로
--     기록해 이력을 보존한다. 유일한 예외는 D10의 pii_vault 파기(값만 비움).
--   * D1은 외래키(FOREIGN KEY, 테이블 간 참조 무결성 검사)를 기본 활성화한다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- cases — 케이스 원장. 수혜자 1명당 1건, 실명 없이 가명 ID로만 식별한다.
-- ----------------------------------------------------------------------------
CREATE TABLE cases (
  id                   TEXT PRIMARY KEY,              -- 가명 ID (예: 'A017')
  org_id               TEXT NOT NULL,                 -- 기관 ID (D1)
  program_type         TEXT NOT NULL DEFAULT 'financial_support_v1',
                                                      -- 스키마 3층 중 '템플릿' 식별자
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'closed')),
  intake_at            TEXT,                          -- 인테이크(첫 상담) 일시
  -- D15: 분리 동의. NULL이면 미동의 → 해당 경로 비활성
  consent_recording_at TEXT,                          -- 녹음·음성 분석 동의 시각
  consent_text_ai_at   TEXT,                          -- 텍스트 AI 정리 동의 시각
  -- D10: 보존·파기
  closed_at            TEXT,                          -- 종결 시각
  closed_reason        TEXT,                          -- 종결 사유
  purge_due            TEXT,                          -- PII 파기 예정일 = closed_at + 유예기간(미결: 6개월~1년)
  -- 스키마 3층 중 '확장 슬롯': 케이스별 자유 필드. 통계·브리핑에서 제외 (JSON)
  extra                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cases_org    ON cases (org_id, status);
-- 파기 배치 작업용: 종결됐고 파기 예정일이 지난 케이스 탐색 (D10)
CREATE INDEX idx_cases_purge  ON cases (purge_due) WHERE closed_at IS NOT NULL;


-- ----------------------------------------------------------------------------
-- pii_vault — 실명·연락처·계좌 금고. 케이스당 1행, 앱 레벨 AES-GCM 암호화 (D3).
--   * enc_* 컬럼에는 base64(IV || 암호문 || 인증태그)만 저장한다. 평문 금지.
--   * 조회(복호화)는 관리자 권한 전용이며 반드시 audit_log 'decrypt_pii' 기록 (D14).
--   * D10 파기: 행을 지우지 않고 enc_* 값만 NULL로 비우고 purged_at을 기록한다.
--     가명 기록(cases 이하)은 통계용으로 그대로 보존된다.
-- ----------------------------------------------------------------------------
CREATE TABLE pii_vault (
  case_id      TEXT PRIMARY KEY REFERENCES cases (id),
  org_id       TEXT NOT NULL,
  enc_name     TEXT,                                  -- 실명 (암호문)
  enc_phone    TEXT,                                  -- 연락처 (암호문)
  enc_account  TEXT,                                  -- 계좌 (암호문)
  key_version  INTEGER NOT NULL DEFAULT 1,            -- 암호화 키 세대 (키 교체 대비)
  purged_at    TEXT,                                  -- D10 파기 완료 시각
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ----------------------------------------------------------------------------
-- case_assignees — 케이스 담당 실무자 매핑 (D7). 공동 담당·이관을 행 추가로 표현한다.
--   * 이관 시 기존 행을 지우지 않고 unassigned_at을 채운 뒤 새 행을 만든다
--     → "언제 누가 담당했나" 이력이 그대로 남는다.
--   * 접근 규칙(gateway가 강제): 관리자이거나, 이 테이블에 활성 행(unassigned_at IS NULL)이
--     있는 담당 실무자만 해당 케이스를 열람·수정할 수 있다.
-- ----------------------------------------------------------------------------
CREATE TABLE case_assignees (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  case_id       TEXT NOT NULL REFERENCES cases (id),
  user_id       TEXT NOT NULL,                        -- Cloudflare Access 사용자 식별자(이메일)
  role          TEXT NOT NULL DEFAULT 'primary'
                CHECK (role IN ('primary', 'secondary')),  -- 주담당 / 공동 담당
  assigned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at TEXT,                                 -- 해제·이관 시각 (NULL = 현재 담당)
  UNIQUE (id)
);

-- 같은 사람이 같은 케이스에 이중으로 '활성' 배정되는 것 방지
CREATE UNIQUE INDEX uq_assignees_active ON case_assignees (case_id, user_id)
  WHERE unassigned_at IS NULL;
CREATE INDEX idx_assignees_user ON case_assignees (user_id)
  WHERE unassigned_at IS NULL;


-- ----------------------------------------------------------------------------
-- goals — 상담 목표 (케이스당 활성 1~3개, 개수 제한은 gateway가 검사).
--   * D12: 목표 문구는 수정 금지. 바꾸려면 기존 목표를 종료(사유 기록)하고
--     새 목표를 신설한다. 아래 트리거가 title 수정을 DB 차원에서 차단한다.
--   * replaced_by_goal_id로 구목표→신목표를 연결해 GAS 추이 그래프의
--     이력 연속성을 보존한다 (브리핑 요구사항 1번의 '목표 종료 시점 표시').
-- ----------------------------------------------------------------------------
CREATE TABLE goals (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  case_id             TEXT NOT NULL REFERENCES cases (id),
  title               TEXT NOT NULL,                  -- 측정 가능한 문장 (인테이크에서 확정)
  scale_criteria      TEXT,                           -- GAS -2~+2 단계별 기준 (JSON)
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'closed')),
  closed_reason       TEXT,                           -- 종료 사유 (D12: 달성/상황 변화/재설정 등)
  closed_at           TEXT,
  replaced_by_goal_id TEXT REFERENCES goals (id),     -- 신설 목표 연결 (없으면 NULL)
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_goals_case ON goals (case_id, status);

-- D12 강제: 목표 문구는 DB 차원에서도 수정 불가
CREATE TRIGGER goals_title_immutable
BEFORE UPDATE OF title ON goals
BEGIN
  SELECT RAISE(ABORT, 'D12: goal title is immutable — close and create a new goal');
END;


-- ----------------------------------------------------------------------------
-- sessions — 상담 세션 기록. 수기 메모와 AI 산출물을 한 행에 나란히 둔다.
--   * D5: memo(수기 메모)는 저장 즉시 공식 기록. 승인 대상이 아니다.
--   * R2: ai_* 컬럼(AI 산출물)은 approved_at이 채워지기 전까지 브리핑·통계·
--     보고서에 나가지 않는다. 이 필터는 gateway 조회 함수에 내장된다.
--   * R4/D11: emotion_scores에는 숫자만 저장한다("불안하다" 같은 문장 금지).
--     수혜자 발화만 집계. JSON 형태(음성·텍스트·통합 점수 + 시계열)는 2단계에서 확정.
--   * R3: transcript는 PII 2단 마스킹(등록값 치환 + 로컬 NER)이 끝난 텍스트만 저장.
-- ----------------------------------------------------------------------------
CREATE TABLE sessions (
  id                           TEXT PRIMARY KEY,
  org_id                       TEXT NOT NULL,
  case_id                      TEXT NOT NULL REFERENCES cases (id),
  counselor_id                 TEXT NOT NULL,         -- 작성 실무자 (Access 식별자)
  held_at                      TEXT NOT NULL,         -- 상담 일시
  channel                      TEXT NOT NULL DEFAULT 'in_person'
                               CHECK (channel IN ('in_person', 'phone', 'video')),
                                                      -- D4: v1 녹음 파이프라인은 대면만,
                                                      -- 전화·화상은 수기 경로
  -- 수기 기록 (즉시 공식, D5)
  memo                         TEXT,
  -- AI 파이프라인 산출물 (승인 전 비공식, R2)
  ai_status                    TEXT NOT NULL DEFAULT 'none'
                               CHECK (ai_status IN
                                 ('none',          -- 녹음 없음 (수기만)
                                  'uploaded',      -- R2 업로드 완료, 처리 대기
                                  'processing',    -- Mac Mini 처리 중
                                  'review_ready',  -- 검토 대기 (SLA 도달점, D8)
                                  'approved')),    -- 승인 완료 (approved_at과 함께 갱신)
  transcript                   TEXT,                 -- 마스킹 완료된 전사 (R3)
  audio_r2_key                 TEXT,                 -- R2 원본 키 (30일 후 자동 삭제)
  ai_summary                   TEXT,                 -- 3줄 요약 초안
  ai_schema                    TEXT,                 -- 분류 스키마 초안 (JSON, 코어+템플릿)
  ai_contrast                  TEXT,                 -- 대조 3종 결과 (JSON: 메모에 없는 내용 /
                                                     -- 음성에 없는 내용 / 미논의 목표)
  emotion_scores               TEXT,                 -- 감정 점수 (JSON, 숫자만, R4·D11)
  speaker_mapping_confirmed_at TEXT,                 -- 화자 매핑 실무자 확인 (D11)
  approved_at                  TEXT,                 -- 승인 시각 (R2 관문)
  approved_by                  TEXT,                 -- 승인 실무자
  -- 확장 슬롯 (JSON, 통계·브리핑 제외)
  extra                        TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_case    ON sessions (case_id, held_at DESC);
-- "승인 대기 N건" 배지용 (D5)
CREATE INDEX idx_sessions_pending ON sessions (case_id)
  WHERE ai_status = 'review_ready';


-- ----------------------------------------------------------------------------
-- session_goal_scores — [제안: 9번째 테이블] 세션×목표별 GAS 점수.
--   * 브리핑 1번(목표별 GAS 추이 그래프)과 통계의 원천 데이터.
--     sessions 안 JSON으로도 넣을 수 있지만, 별도 테이블이어야
--     점수 범위(-2~+2)를 DB가 강제하고 목표별 추이 조회가 단순해진다.
--   * D6: score는 실무자가 직접 매긴다. AI는 evidence_quote(근거 발언 발췌)만 제안.
-- ----------------------------------------------------------------------------
CREATE TABLE session_goal_scores (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  session_id     TEXT NOT NULL REFERENCES sessions (id),
  goal_id        TEXT NOT NULL REFERENCES goals (id),
  score          INTEGER NOT NULL CHECK (score BETWEEN -2 AND 2),  -- GAS 5단계
  evidence_quote TEXT,                                -- AI가 발췌 제안한 근거 발언 (D6)
  scored_by      TEXT NOT NULL,                       -- 점수 매긴 실무자 (AI 불가, D6)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, goal_id)                        -- 세션당 목표별 점수는 1개
);

CREATE INDEX idx_scores_goal ON session_goal_scores (goal_id);


-- ----------------------------------------------------------------------------
-- ai_gas_evidence — [코어] 세션×목표별 AI 근거 발췌 (D6).
--   * D6: AI는 GAS 점수를 매기지 않는다. 목표별 근거 발언 발췌(quote)만 제안하고,
--     실무자는 이를 참고해 session_goal_scores.score를 직접 정한다.
--   * quote는 마스킹 완료본만 저장한다(R3: 등록 PII 치환). 재수집 시 세션 단위로
--     기존 행을 지우고 다시 넣는다(gateway가 처리).
-- ----------------------------------------------------------------------------
CREATE TABLE ai_gas_evidence (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  goal_id    TEXT NOT NULL REFERENCES goals (id),
  quote      TEXT NOT NULL,                          -- 마스킹된 근거 발췌 (D6·R3)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gas_evidence_session ON ai_gas_evidence (session_id);


-- ----------------------------------------------------------------------------
-- action_items — 액션 아이템. 브리핑 3번(미해결 목록)의 원천.
-- ----------------------------------------------------------------------------
CREATE TABLE action_items (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  case_id     TEXT NOT NULL REFERENCES cases (id),
  session_id  TEXT REFERENCES sessions (id),          -- 어느 상담에서 나왔는지 (수동 등록이면 NULL)
  description TEXT NOT NULL,
  owner       TEXT NOT NULL DEFAULT 'counselor'
              CHECK (owner IN ('counselor', 'beneficiary', 'org')),  -- 담당 주체
  due_date    TEXT,                                   -- 기한
  resolved_at TEXT,                                   -- 해결 시각 (NULL = 미해결)
  resolved_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_actions_open ON action_items (case_id) WHERE resolved_at IS NULL;


-- ----------------------------------------------------------------------------
-- flags — 리스크 플래그 (D9). 브리핑 4번(최우선 배치)의 원천.
--   * flag_type은 사전 정의 고정 유형만 허용 — 아래 5종은 8장 미결 사항의 '초안'이며
--     현장 검증 후 확정한다(변경 시 마이그레이션 필요).
--   * AI 제안(source='ai')은 전사 발언 인용(quote)이 필수다 — 사실 표시이지 진단이 아님.
--   * review_status: 실무자가 맞음(confirmed)/틀림(rejected)을 확인한다.
--     실무자가 직접 만든 플래그는 생성 즉시 confirmed로 저장한다(gateway 처리).
-- ----------------------------------------------------------------------------
CREATE TABLE flags (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  case_id       TEXT NOT NULL REFERENCES cases (id),
  session_id    TEXT REFERENCES sessions (id),
  flag_type     TEXT NOT NULL
                CHECK (flag_type IN
                  ('crisis_utterance',         -- 위기 발언
                   'contact_loss_risk',        -- 연락 두절 위험
                   'housing_livelihood_shock', -- 주거·생계 급변
                   'debt_deterioration',       -- 부채 악화
                   'repeated_noncompliance')), -- 약속 불이행 반복
  quote         TEXT,                                 -- 전사 발언 인용
  source        TEXT NOT NULL DEFAULT 'ai'
                CHECK (source IN ('ai', 'counselor')),
  review_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- D9: AI 제안은 인용 필수
  CHECK (source = 'counselor' OR quote IS NOT NULL)
);

CREATE INDEX idx_flags_case ON flags (case_id, review_status);


-- ----------------------------------------------------------------------------
-- audit_log — 감사 로그 (D14). 열람·변경·PII 복호화·내보내기 전부 기록.
--   * 추가 전용(append-only): 아래 트리거가 UPDATE/DELETE를 DB 차원에서 차단한다.
--   * 기록은 gateway 공용 함수에 내장된다 (R1) — 앱 코드가 따로 부르지 않는다.
--   * detail(JSON)에 PII 값 자체를 넣는 것은 금지 (R3). 필드명 수준까지만.
--   * action 값 예: read / create / update / close / approve / assign / transfer /
--     decrypt_pii / purge_pii / export
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,     -- 순서 보장용 자동 증가
  org_id       TEXT NOT NULL,
  actor_id     TEXT NOT NULL,                         -- 행위자 (Access 사용자 또는 서비스 토큰)
  actor_role   TEXT NOT NULL
               CHECK (actor_role IN ('admin', 'counselor', 'service')),
  action       TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id    TEXT,
  case_id      TEXT,                                  -- 케이스 단위 감사 조회용
  detail       TEXT,                                  -- 부가 정보 (JSON, PII 값 금지)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_case  ON audit_log (case_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);

-- D14 강제: append-only
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'D14: audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'D14: audit_log is append-only');
END;


-- ----------------------------------------------------------------------------
-- users — 사용자 디렉터리 (마이그레이션 0002). Cloudflare Access 신원 → 앱 역할 매핑.
--   * 운영에서 Access가 검증한 JWT의 email(사람) 또는 common_name(서비스 토큰)을
--     이 테이블에서 조회해 {userId, orgId, role}을 얻는다. 없거나 active=0이면 접근 거부.
--   * email은 전역 UNIQUE — 신원 해석은 org를 알기 전 이메일만으로 일어난다(인증 전 단계).
--   * service 역할 행은 Mac Mini 파이프라인의 Access 서비스 토큰(client id·common_name)이다 (D13).
--   * 행 삭제는 쓰지 않는다. 비활성화는 active=0으로 기록한다.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL
             CHECK (role IN ('admin', 'counselor', 'service')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_org ON users (org_id, active);

-- ============================================================================
-- Migration 0003 — Phase 1 additive text-AI provenance and provider registry
--
-- This migration is additive. It intentionally does not alter 0001/0002 tables
-- or authorize any text-AI work: feature flags and gateway consent checks remain
-- the activation boundary. All stored AI content is already masked/pseudonymous.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pilot_text_ai_consent_evidence — bounded Phase-1 pilot evidence only.
-- This is not the Phase-2 signed consent lifecycle or a revocation ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_text_ai_consent_evidence (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  case_id         TEXT NOT NULL REFERENCES cases (id),
  notice_version  TEXT NOT NULL CHECK (length(trim(notice_version)) > 0),
  notice_sha256   TEXT NOT NULL CHECK (length(trim(notice_sha256)) > 0),
  evidence_ref    TEXT NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  evidence_sha256 TEXT NOT NULL CHECK (length(trim(evidence_sha256)) > 0),
  captured_by     TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pilot_text_ai_consent_case
  ON pilot_text_ai_consent_evidence (org_id, case_id, effective_at DESC);

CREATE TRIGGER IF NOT EXISTS pilot_text_ai_consent_evidence_no_update
BEFORE UPDATE ON pilot_text_ai_consent_evidence
BEGIN
  SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS pilot_text_ai_consent_evidence_no_delete
BEFORE DELETE ON pilot_text_ai_consent_evidence
BEGIN
  SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only');
END;

-- ----------------------------------------------------------------------------
-- Provider configuration and activation provenance. Configuration records are
-- immutable. An activation may only transition once from active to deactivated;
-- switching or rolling back inserts a new activation row and preserves history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  adapter_id          TEXT NOT NULL CHECK (length(trim(adapter_id)) > 0),
  adapter_version     TEXT NOT NULL CHECK (length(trim(adapter_version)) > 0),
  config_hash         TEXT NOT NULL CHECK (length(trim(config_hash)) > 0),
  approval_refs_json  TEXT NOT NULL CHECK (length(trim(approval_refs_json)) > 0),
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, adapter_id, adapter_version, config_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_org
  ON ai_provider_configs (org_id, adapter_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS ai_provider_configs_no_update
BEFORE UPDATE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_configs_no_delete
BEFORE DELETE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_provider_activations (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL,
  config_id              TEXT NOT NULL REFERENCES ai_provider_configs (id),
  previous_activation_id TEXT REFERENCES ai_provider_activations (id),
  activated_by           TEXT NOT NULL,
  activated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at         TEXT,
  CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_activations_org
  ON ai_provider_activations (org_id, activated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_provider_activations_one_active_org
  ON ai_provider_activations (org_id)
  WHERE deactivated_at IS NULL;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_scope_guard
BEFORE INSERT ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider configuration organization mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_provider_configs AS config
    WHERE config.id = NEW.config_id
      AND config.org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'phase1: prior provider activation must be retired in the same organization')
  WHERE NEW.previous_activation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ai_provider_activations AS prior
      WHERE prior.id = NEW.previous_activation_id
        AND prior.org_id = NEW.org_id
        AND prior.deactivated_at IS NOT NULL
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_only_deactivate
BEFORE UPDATE ON ai_provider_activations
WHEN NEW.id IS NOT OLD.id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.config_id IS NOT OLD.config_id
  OR NEW.previous_activation_id IS NOT OLD.previous_activation_id
  OR NEW.activated_by IS NOT OLD.activated_by
  OR NEW.activated_at IS NOT OLD.activated_at
  OR OLD.deactivated_at IS NOT NULL
  OR NEW.deactivated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activation is immutable except retirement');
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_no_delete
BEFORE DELETE ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activations are append-only');
END;
-- ----------------------------------------------------------------------------
-- Immutable masked source snapshots are recorded by the service boundary before
-- any provider outbound. They contain only locally NER-masked text after the
-- gateway's registered-PII substitution; source identifiers remain opaque.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_masked_source_snapshots (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  case_id                  TEXT NOT NULL REFERENCES cases (id),
  session_id               TEXT NOT NULL REFERENCES sessions (id),
  masked_text              TEXT NOT NULL CHECK (length(masked_text) > 0),
  sha256                   TEXT NOT NULL
                           CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  masking_pipeline_version TEXT NOT NULL CHECK (length(trim(masking_pipeline_version)) > 0),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_masked_source_snapshots_scope
  ON ai_masked_source_snapshots (org_id, case_id, session_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_scope_guard
BEFORE INSERT ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM sessions
    WHERE sessions.id = NEW.session_id
      AND sessions.org_id = NEW.org_id
      AND sessions.case_id = NEW.case_id
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_no_update
BEFORE UPDATE ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_no_delete
BEFORE DELETE ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_masked_source_evidence_items (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES ai_masked_source_snapshots (id),
  org_id         TEXT NOT NULL,
  case_id        TEXT NOT NULL REFERENCES cases (id),
  session_id     TEXT NOT NULL REFERENCES sessions (id),
  source_ref     TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_sha256  TEXT NOT NULL
                 CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_quote TEXT NOT NULL CHECK (length(evidence_quote) > 0),
  source_start   INTEGER NOT NULL CHECK (source_start >= 0),
  source_end     INTEGER NOT NULL CHECK (source_end > source_start),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (snapshot_id, source_ref, source_start, source_end)
);

CREATE INDEX IF NOT EXISTS idx_ai_masked_source_evidence_items_scope
  ON ai_masked_source_evidence_items (org_id, case_id, session_id, snapshot_id, source_start);

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_insert_guard
BEFORE INSERT ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    JOIN sessions
      ON sessions.id = snapshot.session_id
     AND sessions.org_id = snapshot.org_id
     AND sessions.case_id = snapshot.case_id
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.org_id = NEW.org_id
      AND snapshot.case_id = NEW.case_id
      AND snapshot.session_id = NEW.session_id
  );

  SELECT RAISE(ABORT, 'phase1: masked source evidence hash mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.sha256 = NEW.source_sha256
  );

  SELECT RAISE(ABORT, 'phase1: masked source evidence span mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND NEW.source_end <= length(snapshot.masked_text)
      AND substr(
        snapshot.masked_text,
        NEW.source_start + 1,
        NEW.source_end - NEW.source_start
      ) = NEW.evidence_quote
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_no_update
BEFORE UPDATE ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_no_delete
BEFORE DELETE ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only');
END;

-- ----------------------------------------------------------------------------
-- Immutable AI work and draft provenance. Phase 1 has only text_ai_briefing;
-- later work kinds require a forward migration rather than a silent expansion.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_work_items (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  case_id    TEXT NOT NULL REFERENCES cases (id),
  session_id TEXT NOT NULL REFERENCES sessions (id),
  kind       TEXT NOT NULL CHECK (kind = 'text_ai_briefing'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_ai_work_items_org_case
  ON ai_work_items (org_id, case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_work_items_session
  ON ai_work_items (session_id, kind);

CREATE TRIGGER IF NOT EXISTS ai_work_items_scope_guard
BEFORE INSERT ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work item case or session scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM sessions
    WHERE sessions.id = NEW.session_id
      AND sessions.org_id = NEW.org_id
      AND sessions.case_id = NEW.case_id
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_work_items_no_update
BEFORE UPDATE ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work items are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_work_items_no_delete
BEFORE DELETE ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work items are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_draft_versions (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  version              INTEGER NOT NULL CHECK (version > 0),
  parent_version_id    TEXT REFERENCES ai_draft_versions (id),
  summary_text         TEXT NOT NULL,
  questions_json        TEXT NOT NULL
                        CHECK (json_valid(questions_json) AND json_type(questions_json) = 'array'),
  source_snapshot_id   TEXT REFERENCES ai_masked_source_snapshots (id),
  source_snapshot_hash TEXT,
  consent_evidence_id  TEXT REFERENCES pilot_text_ai_consent_evidence (id),
  provider_config_id   TEXT REFERENCES ai_provider_configs (id),
  model_id             TEXT,
  prompt_version       TEXT,
  schema_version       TEXT,
  origin               TEXT NOT NULL
                       CHECK (origin IN ('generated', 'legacy_import')),
  creation_mode        TEXT NOT NULL
                       CHECK (creation_mode IN ('provider_generated', 'human_edited', 'legacy_import')),
  grounding_status     TEXT NOT NULL
                       CHECK (grounding_status IN ('grounded', 'legacy_unverified')),
  created_by           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_item_id, version),
  CHECK (
    (origin = 'generated'
      AND creation_mode IN ('provider_generated', 'human_edited')
      AND grounding_status = 'grounded'
      AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL
      AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL
      AND model_id IS NOT NULL
      AND prompt_version IS NOT NULL
      AND schema_version IS NOT NULL
      AND created_by IS NOT NULL)
      AND json_array_length(questions_json) BETWEEN 2 AND 3
    OR
    (origin = 'legacy_import'
      AND creation_mode = 'legacy_import'
      AND grounding_status = 'legacy_unverified'
      AND source_snapshot_id IS NULL
      AND source_snapshot_hash IS NULL
      AND consent_evidence_id IS NULL
      AND provider_config_id IS NULL
      AND model_id IS NULL
      AND prompt_version IS NULL
      AND schema_version IS NULL
      AND created_by IS NULL)
      AND json_array_length(questions_json) = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_work
  ON ai_draft_versions (work_item_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_source_snapshot
  ON ai_draft_versions (source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_provider_config
  ON ai_draft_versions (provider_config_id)
  WHERE provider_config_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_evidence_links (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES ai_draft_versions (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_evidence_links_draft
  ON ai_evidence_links (draft_version_id, claim_key);

CREATE TABLE IF NOT EXISTS ai_review_events (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  draft_version_id     TEXT NOT NULL REFERENCES ai_draft_versions (id),
  decision             TEXT NOT NULL
                       CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES ai_draft_versions (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR
    (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_review_events_work
  ON ai_review_events (work_item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_terminal_draft
  ON ai_review_events (draft_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id)
  WHERE decision = 'approved';

-- Versions are sequential and may only descend from the current pending draft.
CREATE TRIGGER IF NOT EXISTS ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((
    SELECT MAX(version) + 1
    FROM ai_draft_versions
    WHERE work_item_id = NEW.work_item_id
  ), 1);

  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
    OR (NEW.version > 1 AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS parent
      WHERE parent.id = NEW.parent_version_id
        AND parent.work_item_id = NEW.work_item_id
        AND parent.version = NEW.version - 1
    ));

  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.questions_json)
    WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.questions_json)
    GROUP BY json_each.value
    HAVING COUNT(*) > 1
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM ai_review_events
      WHERE ai_review_events.draft_version_id = NEW.parent_version_id
    );

  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_masked_source_snapshots AS snapshot
        ON snapshot.id = NEW.source_snapshot_id
       AND snapshot.org_id = work.org_id
       AND snapshot.case_id = work.case_id
       AND snapshot.session_id = work.session_id
       AND snapshot.sha256 = NEW.source_snapshot_hash
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN pilot_text_ai_consent_evidence AS evidence
        ON evidence.id = NEW.consent_evidence_id
       AND evidence.org_id = work.org_id
       AND evidence.case_id = work.case_id
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin = 'generated'
    AND NEW.consent_evidence_id IS NOT (
      SELECT evidence.id
      FROM ai_work_items AS work
      JOIN pilot_text_ai_consent_evidence AS evidence
        ON evidence.org_id = work.org_id
       AND evidence.case_id = work.case_id
      WHERE work.id = NEW.work_item_id
        AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC
      LIMIT 1
    );

  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_provider_configs AS config
        ON config.id = NEW.provider_config_id
       AND config.org_id = work.org_id
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated'
    AND NEW.creation_mode = 'human_edited'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS parent
      WHERE parent.id = NEW.parent_version_id
        AND parent.work_item_id = NEW.work_item_id
        AND parent.origin = 'generated'
        AND parent.provider_config_id IS NEW.provider_config_id
        AND parent.source_snapshot_id IS NEW.source_snapshot_id
        AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
        AND parent.questions_json IS NEW.questions_json
        AND parent.model_id IS NEW.model_id
        AND parent.prompt_version IS NEW.prompt_version
        AND parent.schema_version IS NEW.schema_version
    );

  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated'
    AND NEW.creation_mode = 'provider_generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_provider_configs AS config
        ON config.id = NEW.provider_config_id
       AND config.org_id = work.org_id
      JOIN ai_provider_activations AS activation
        ON activation.config_id = config.id
       AND activation.org_id = work.org_id
      WHERE work.id = NEW.work_item_id
        AND activation.deactivated_at IS NULL
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

-- Evidence is masked, belongs only to an active generated draft, and cannot be
-- appended after that draft became stale or terminal.
CREATE TRIGGER IF NOT EXISTS ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.origin = 'generated'
      AND draft.grounding_status = 'grounded'
  );

  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work
      ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = draft.source_snapshot_id
     AND snapshot.org_id = work.org_id
     AND snapshot.case_id = work.case_id
     AND snapshot.session_id = work.session_id
     AND snapshot.sha256 = draft.source_snapshot_hash
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id
     AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256
     AND item.org_id = work.org_id
     AND item.case_id = work.case_id
     AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref
     AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start
     AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (
    SELECT 1
    FROM ai_review_events
    WHERE ai_review_events.draft_version_id = NEW.draft_version_id
  )
    OR EXISTS (
      SELECT 1
      FROM ai_draft_versions AS newer
      JOIN ai_draft_versions AS draft
        ON draft.id = NEW.draft_version_id
      WHERE newer.work_item_id = draft.work_item_id
        AND newer.version > draft.version
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only');
END;

-- Reviews may only close the current draft. Supersession must name exactly the
-- next version. A generated approval cannot be evidence-free; legacy imports
-- are intentionally exempt because 0004 must not fabricate grounding evidence.
CREATE TRIGGER IF NOT EXISTS ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.work_item_id = NEW.work_item_id
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected')
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS newer
      JOIN ai_draft_versions AS draft
        ON draft.id = NEW.draft_version_id
      WHERE newer.work_item_id = NEW.work_item_id
        AND newer.version > draft.version
    );

  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS draft
      JOIN ai_draft_versions AS replacement
        ON replacement.id = NEW.replacement_draft_id
      WHERE draft.id = NEW.draft_version_id
        AND replacement.work_item_id = draft.work_item_id
        AND replacement.version = draft.version + 1
    );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS later
      JOIN ai_draft_versions AS replacement
        ON replacement.id = NEW.replacement_draft_id
      WHERE later.work_item_id = NEW.work_item_id
        AND later.version > replacement.version
    );

  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded'
    AND EXISTS (
      SELECT 1
      FROM ai_review_events
      WHERE ai_review_events.draft_version_id = NEW.replacement_draft_id
    );

  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);

  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ai_evidence_links
      WHERE ai_evidence_links.draft_version_id = NEW.draft_version_id
    );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ai_evidence_links
      WHERE ai_evidence_links.draft_version_id = NEW.draft_version_id
        AND ai_evidence_links.claim_key NOT GLOB 'question_[0-9]*'
    );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS draft
      WHERE draft.id = NEW.draft_version_id
        AND draft.origin = 'generated'
        AND EXISTS (
          SELECT 1
          FROM json_each(draft.questions_json) AS question
          WHERE NOT EXISTS (
            SELECT 1
            FROM ai_evidence_links AS evidence
            WHERE evidence.draft_version_id = draft.id
              AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1)
          )
        )
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI review events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI review events are append-only');
END;

-- ============================================================================
-- Migration 0004 — Phase 1 immutable AI cutover and legacy continuity
--
-- No down migration is provided. Recovery after this cutover is feature-off and
-- forward-fix: manual records and approved briefing projections remain readable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Refuse any pre-existing non-canonical AI lineage. A prior import is reusable
-- only when its deterministic ids, exact summary bytes, counts, actor, and time
-- all prove that it is the historical approved session summary. This deliberately
-- trips ai_work_items.kind's CHECK on bad state without mutating user records.
-- ----------------------------------------------------------------------------
INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
LEFT JOIN sessions AS historical
  ON historical.id = work.session_id
 AND historical.org_id = work.org_id
 AND historical.case_id = work.case_id
WHERE historical.id IS NULL
   OR historical.approved_at IS NULL
   OR historical.ai_summary IS NULL
   OR work.id != 'legacy-import-work:' || historical.id
   OR work.kind != 'text_ai_briefing'
   OR work.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN sessions AS historical ON historical.id = work.session_id
LEFT JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE (SELECT COUNT(*) FROM ai_draft_versions WHERE work_item_id = work.id) != 1
   OR draft.id != 'legacy-import-draft:' || historical.id
   OR draft.version != 1
   OR draft.parent_version_id IS NOT NULL
   OR CAST(draft.summary_text AS BLOB) != CAST(historical.ai_summary AS BLOB)
   OR CAST(draft.questions_json AS BLOB) != CAST('[]' AS BLOB)
   OR draft.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE draft.source_snapshot_id IS NOT NULL
   OR draft.source_snapshot_hash IS NOT NULL
   OR draft.consent_evidence_id IS NOT NULL
   OR draft.provider_config_id IS NOT NULL
   OR draft.model_id IS NOT NULL
   OR draft.prompt_version IS NOT NULL
   OR draft.schema_version IS NOT NULL
   OR draft.origin != 'legacy_import'
   OR draft.creation_mode != 'legacy_import'
   OR draft.grounding_status != 'legacy_unverified'
   OR draft.created_by IS NOT NULL
   OR CAST(draft.questions_json AS BLOB) != CAST('[]' AS BLOB)
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN sessions AS historical ON historical.id = work.session_id
LEFT JOIN ai_review_events AS review ON review.work_item_id = work.id
WHERE (SELECT COUNT(*) FROM ai_review_events WHERE work_item_id = work.id) != 1
   OR review.id != 'legacy-import-review:' || historical.id
   OR review.draft_version_id != 'legacy-import-draft:' || historical.id
   OR review.decision != 'approved'
   OR review.replacement_draft_id IS NOT NULL
   OR review.actor_id IS NOT historical.approved_by
   OR review.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE EXISTS (
  SELECT 1
  FROM ai_evidence_links
  WHERE ai_evidence_links.draft_version_id = draft.id
)
LIMIT 1;

-- ----------------------------------------------------------------------------
-- Import every pre-cutover approved summary exactly once. The source text is
-- selected directly from sessions.ai_summary so SQLite preserves its stored
-- bytes; no evidence, model, prompt, or grounding metadata is fabricated.
-- ----------------------------------------------------------------------------
INSERT INTO ai_work_items (
  id,
  org_id,
  case_id,
  session_id,
  kind,
  created_at
)
SELECT
  'legacy-import-work:' || sessions.id,
  sessions.org_id,
  sessions.case_id,
  sessions.id,
  'text_ai_briefing',
  sessions.approved_at
FROM sessions
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS existing
    WHERE existing.session_id = sessions.id
      AND existing.kind = 'text_ai_briefing'
  );

INSERT INTO ai_draft_versions (
  id,
  work_item_id,
  version,
  parent_version_id,
  summary_text,
  questions_json,
  source_snapshot_id,
  source_snapshot_hash,
  consent_evidence_id,
  provider_config_id,
  model_id,
  prompt_version,
  schema_version,
  origin,
  creation_mode,
  grounding_status,
  created_by,
  created_at
)
SELECT
  'legacy-import-draft:' || sessions.id,
  work.id,
  1,
  NULL,
  sessions.ai_summary,
  '[]',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'legacy_import',
  'legacy_import',
  'legacy_unverified',
  NULL,
  sessions.approved_at
FROM sessions
JOIN ai_work_items AS work
  ON work.session_id = sessions.id
 AND work.kind = 'text_ai_briefing'
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS existing
    WHERE existing.work_item_id = work.id
  );

INSERT INTO ai_review_events (
  id,
  work_item_id,
  draft_version_id,
  decision,
  replacement_draft_id,
  actor_id,
  created_at
)
SELECT
  'legacy-import-review:' || sessions.id,
  work.id,
  draft.id,
  'approved',
  NULL,
  sessions.approved_by,
  sessions.approved_at
FROM sessions
JOIN ai_work_items AS work
  ON work.session_id = sessions.id
 AND work.kind = 'text_ai_briefing'
JOIN ai_draft_versions AS draft
  ON draft.work_item_id = work.id
 AND draft.version = 1
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_review_events AS existing
    WHERE existing.work_item_id = work.id
  );

-- These are the exact 0004-owned objects. The migration runner provides the
-- version-level rerun boundary; dropping only these names prevents stale SQL
-- definitions from surviving a cutover replay.
DROP TRIGGER IF EXISTS sessions_approved_ai_compatibility_immutable;
DROP TRIGGER IF EXISTS ai_draft_versions_legacy_import_cutover_guard;
DROP TRIGGER IF EXISTS sessions_direct_ai_approval_update_guard;
DROP TRIGGER IF EXISTS sessions_direct_ai_approval_insert_guard;
DROP VIEW IF EXISTS grounded_ai_quality_v1;
DROP VIEW IF EXISTS approved_ai_briefing_v1;

CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.origin = 'legacy_import'
BEGIN
  SELECT RAISE(ABORT, 'phase1: runtime legacy AI import is prohibited');
END;

-- Every ordinary approval is official continuity, regardless of whether it was
-- generated with grounding or imported from the pre-cutover session columns.
CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.case_id AS case_id,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.questions_json AS questions_json,
  draft.summary_text AS ai_summary,
  draft.source_snapshot_id AS source_snapshot_id,
  draft.source_snapshot_hash AS source_snapshot_hash,
  draft.consent_evidence_id AS consent_evidence_id,
  draft.provider_config_id AS provider_config_id,
  draft.model_id AS model_id,
  draft.prompt_version AS prompt_version,
  draft.schema_version AS schema_version,
  draft.origin AS origin,
  draft.creation_mode AS creation_mode,
  draft.grounding_status AS grounding_status,
  draft.created_by AS draft_created_by,
  draft.created_at AS draft_created_at,
  review.id AS review_event_id,
  review.actor_id AS approved_by,
  review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work
  ON work.id = review.work_item_id
JOIN ai_draft_versions AS draft
  ON draft.id = review.draft_version_id
 AND draft.work_item_id = work.id
WHERE review.decision = 'approved';

-- Quality claims deliberately exclude imported legacy records. This projection
-- is never the official briefing continuity path.
CREATE VIEW grounded_ai_quality_v1 AS
SELECT *
FROM approved_ai_briefing_v1
WHERE origin = 'generated'
  AND grounding_status = 'grounded';

-- Post-cutover, sessions.ai_* remains compatibility-only. A new official value
-- must already have an immutable approved review with matching bytes/actor/time.
CREATE TRIGGER sessions_direct_ai_approval_insert_guard
BEFORE INSERT ON sessions
WHEN NEW.ai_status = 'approved'
  OR NEW.ai_summary IS NOT NULL
  OR NEW.approved_at IS NOT NULL
  OR NEW.approved_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'phase1: direct session AI approval is prohibited');
END;

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (
  NEW.ai_status = 'approved'
  OR NEW.ai_summary IS NOT OLD.ai_summary
  OR NEW.approved_at IS NOT OLD.approved_at
  OR NEW.approved_by IS NOT OLD.approved_by
)
AND NOT (
  NEW.ai_status = 'approved'
  AND NEW.approved_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM approved_ai_briefing_v1 AS briefing
    WHERE briefing.session_id = NEW.id
      AND briefing.summary_text IS NEW.ai_summary
      AND briefing.approved_by IS NEW.approved_by
      AND briefing.approved_at IS NEW.approved_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review');
END;

CREATE TRIGGER sessions_approved_ai_compatibility_immutable
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN OLD.approved_at IS NOT NULL
  AND (
    NEW.ai_status IS NOT OLD.ai_status
    OR NEW.ai_summary IS NOT OLD.ai_summary
    OR NEW.approved_at IS NOT OLD.approved_at
    OR NEW.approved_by IS NOT OLD.approved_by
  )
BEGIN
  SELECT RAISE(ABORT, 'phase1: approved session AI compatibility fields are immutable');
END;


-- ============================================================================
-- Migration 0005 — participant / SupportCase expand (runtime routes remain off)
--
-- This is an additive compatibility migration. It creates and deterministically
-- backfills the participant graph, but does not replace the legacy case graph;
-- 0006 performs that FK-on cutover. Every failure uses a fixed, content-free
-- error string so neither PII nor submitted record content can escape SQL.
-- ============================================================================

-- Organization-wide retention and IANA time-zone configuration. There is no
-- guessed default: canonical runtime writes fail until an explicit setting exists.
CREATE TABLE organization_settings (
  org_id                TEXT PRIMARY KEY,
  time_zone             TEXT NOT NULL
                          CHECK (
                            length(trim(time_zone)) BETWEEN 3 AND 255
                            AND time_zone NOT GLOB '*[^A-Za-z0-9_+./-]*'
                            AND (time_zone = 'UTC' OR instr(time_zone, '/') > 0)
                          ),
  pii_purge_grace_days  INTEGER NOT NULL
                          CHECK (pii_purge_grace_days BETWEEN 1 AND 3660),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 0023: 관리자 온보딩(CCC-32)이 저장하는 기관·첫 사업 표시 이름. NULL 이면 화면은
-- labels.ts 하드코딩 라벨로 폴백한다. programs 테이블 없음 — 이름만 진짜(스펙 #78).
ALTER TABLE organization_settings ADD COLUMN org_name TEXT
  CHECK (org_name IS NULL OR length(trim(org_name)) BETWEEN 1 AND 80);
ALTER TABLE organization_settings ADD COLUMN program_display_name TEXT
  CHECK (program_display_name IS NULL OR length(trim(program_display_name)) BETWEEN 1 AND 120);

ALTER TABLE users ADD COLUMN time_zone TEXT
  CHECK (
    time_zone IS NULL OR (
      length(trim(time_zone)) BETWEEN 3 AND 255
      AND time_zone NOT GLOB '*[^A-Za-z0-9_+./-]*'
      AND (time_zone = 'UTC' OR instr(time_zone, '/') > 0)
    )
  );

-- 0011: 직원 표시 이름(D31). 화면 표기용 — PII 금고 대상 아님. 미입력이면 NULL(이메일 폴백).
ALTER TABLE users ADD COLUMN name TEXT;

-- 0017: 마지막에 선택한 사업(D35 · ADR-0014 '개정' 2번). `/` 직행 목적지다.
-- 본인 계정의 화면 설정이라 이 컬럼의 쓰기는 audit_log 에 남기지 않는다 — 근거는
-- migrations/0017_user_last_program_type.sql 주석. NULL 이거나 사라진 사업이면 첫 사업 폴백.
ALTER TABLE users ADD COLUMN last_program_type TEXT;

-- A beneficiary is the permanent participant identity. 가명 ID는 두 형식을 허용한다
-- (0007 확장 단계, D20 · ADR-0004): 레거시 'A' + 3자리 이상 숫자, 또는 동물 슬러그
-- (소문자 영단어) + '-' + 3자리 이상 숫자. 어느 형식이든 다른 당사자·케이스에
-- 재사용하지 않는다. 동물 슬러그 큐레이션 목록(단일 출처)은 db/animal-slugs.ts.
CREATE TABLE beneficiaries (
  id                   TEXT PRIMARY KEY
                       CHECK (
                         (id GLOB 'A[0-9][0-9][0-9]*' AND substr(id, 2) NOT GLOB '*[^0-9]*')
                         OR (
                           id GLOB '[a-z]*-[0-9][0-9][0-9]*'
                           AND id NOT GLOB '*-*-*'
                           AND substr(id, 1, instr(id, '-') - 1) NOT GLOB '*[^a-z]*'
                           AND substr(id, instr(id, '-') + 1) NOT GLOB '*[^0-9]*'
                         )
                       ),
  org_id               TEXT NOT NULL,
  initialization_state TEXT NOT NULL DEFAULT 'pending'
                       CHECK (initialization_state IN ('pending', 'complete')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_beneficiaries_org_initialization
  ON beneficiaries (org_id, initialization_state, id);

-- SupportCase is the canonical owner for records and AI provenance. A legacy
-- case has exactly one deterministic legacy-import SupportCase during expand.
CREATE TABLE support_cases (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  beneficiary_id           TEXT NOT NULL REFERENCES beneficiaries (id),
  legacy_case_id           TEXT UNIQUE,
  program_type             TEXT NOT NULL DEFAULT 'financial_support_v1',
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'closed')),
  intake_at                TEXT,
  consent_recording_at     TEXT,
  consent_text_ai_at       TEXT,
  closed_at                TEXT,
  closed_reason            TEXT,
  closed_by_actor_id       TEXT,
  extra                    TEXT,
  creation_kind            TEXT NOT NULL
                           CHECK (creation_kind IN ('legacy_import', 'initial', 'subsequent')),
  creation_submission_id   TEXT,
  creation_payload_hash    TEXT
                           CHECK (
                             creation_payload_hash IS NULL OR
                             (length(creation_payload_hash) = 64
                              AND creation_payload_hash NOT GLOB '*[^0-9a-f]*')
                           ),
  created_by_actor_id      TEXT,
  source_support_case_id   TEXT REFERENCES support_cases (id),
  initial_assignee_user_id TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (creation_kind IN ('legacy_import', 'initial')
      AND creation_submission_id IS NULL
      AND creation_payload_hash IS NULL
      AND created_by_actor_id IS NULL
      AND source_support_case_id IS NULL
      AND initial_assignee_user_id IS NULL)
    OR
    (creation_kind = 'subsequent'
      AND length(trim(creation_submission_id)) > 0
      AND creation_payload_hash IS NOT NULL
      AND length(trim(created_by_actor_id)) > 0
      AND length(trim(initial_assignee_user_id)) > 0)
  ),
  CHECK (
    (creation_kind = 'legacy_import' AND legacy_case_id IS NOT NULL)
    OR (creation_kind <> 'legacy_import' AND legacy_case_id IS NULL)
  ),
  CHECK (
    creation_kind = 'legacy_import'
    OR (status = 'active' AND closed_at IS NULL AND closed_reason IS NULL AND closed_by_actor_id IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL
     AND closed_by_actor_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_support_cases_one_initial_per_beneficiary
  ON support_cases (beneficiary_id) WHERE creation_kind = 'initial';
CREATE UNIQUE INDEX uq_support_cases_actor_submission
  ON support_cases (org_id, created_by_actor_id, creation_submission_id)
  WHERE creation_submission_id IS NOT NULL;
CREATE INDEX idx_support_cases_beneficiary_status
  ON support_cases (beneficiary_id, status, created_at DESC);

-- PII belongs to the beneficiary, not a case. Ciphertext is copied byte-for-byte
-- from legacy storage; this table never contains plaintext or retention context
-- that reveals a date/value in audit detail.
CREATE TABLE participant_pii_vault (
  beneficiary_id                    TEXT PRIMARY KEY REFERENCES beneficiaries (id),
  org_id                            TEXT NOT NULL,
  enc_name                          TEXT,
  enc_phone                         TEXT,
  enc_account                       TEXT,
  key_version                       INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  version                           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  purge_due                         TEXT,
  purged_at                         TEXT,
  purged_by                         TEXT,
  purged_by_role                    TEXT CHECK (purged_by_role IN ('admin', 'service')),
  retention_changed_by              TEXT,
  retention_context_support_case_id TEXT REFERENCES support_cases (id),
  retention_change_kind             TEXT NOT NULL
                                    CHECK (retention_change_kind IN (
                                      'legacy_import', 'create',
                                      'schedule_pii_purge_due',
                                      'cancel_pii_purge_due', 'purge_pii',
                                      're_register_pii'
                                    )),
  retention_changed_at              TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (purged_at IS NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (retention_change_kind = 'legacy_import' AND purged_at IS NOT NULL
      AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (purged_at IS NOT NULL AND purged_by IS NOT NULL AND purged_by_role IN ('admin', 'service'))
  ),
  CHECK (
    retention_change_kind = 'legacy_import'
    OR purged_at IS NULL
    OR (enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL)
  )
);
CREATE INDEX idx_participant_pii_vault_due
  ON participant_pii_vault (purge_due) WHERE purged_at IS NULL AND purge_due IS NOT NULL;

CREATE TABLE support_case_assignees (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'primary'
                  CHECK (role IN ('primary', 'secondary')),
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at   TEXT
);
CREATE UNIQUE INDEX uq_support_case_assignees_active
  ON support_case_assignees (support_case_id, user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_support_case_assignees_user
  ON support_case_assignees (user_id) WHERE unassigned_at IS NULL;

CREATE TABLE counseling_schedules (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  scheduled_at          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_session_id  TEXT,
  created_by_actor_id   TEXT NOT NULL,
  updated_by_actor_id   TEXT,
  completed_by_actor_id TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (status IN ('scheduled', 'cancelled', 'no_show') AND completed_session_id IS NULL
      AND completed_by_actor_id IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND completed_session_id IS NOT NULL
      AND completed_by_actor_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX idx_counseling_schedules_support_case
  ON counseling_schedules (support_case_id, status, scheduled_at);

-- New audit provenance is additive during expand. 0006 rewrites legacy audit
-- rows into these fields without issuing UPDATE against append-only audit_log.
ALTER TABLE audit_log ADD COLUMN beneficiary_id TEXT;
ALTER TABLE audit_log ADD COLUMN support_case_id TEXT;

-- Deterministic legacy backfill. These INSERTs run before runtime guards so a
-- historical row may be complete/legacy_import without fabricating actors,
-- submissions, receipts, approvals, hashes, or PII retention provenance.
INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
SELECT id, org_id, 'complete', created_at, updated_at
FROM cases;

INSERT INTO support_cases (
  id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
  consent_recording_at, consent_text_ai_at, closed_at, closed_reason,
  closed_by_actor_id, extra, creation_kind, creation_submission_id,
  creation_payload_hash, created_by_actor_id, source_support_case_id,
  initial_assignee_user_id, created_at, updated_at
)
SELECT
  'legacy-support-case:' || id, org_id, id, id, program_type, status, intake_at,
  consent_recording_at, consent_text_ai_at, closed_at, closed_reason,
  NULL, extra, 'legacy_import', NULL, NULL, NULL, NULL, NULL, created_at, updated_at
FROM cases;

INSERT INTO participant_pii_vault (
  beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
  purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
  retention_context_support_case_id, retention_change_kind, retention_changed_at,
  created_at, updated_at
)
SELECT
  vault.case_id, vault.org_id, vault.enc_name, vault.enc_phone, vault.enc_account,
  vault.key_version, 1, legacy_case.purge_due, vault.purged_at, NULL, NULL, NULL,
  NULL, 'legacy_import', vault.updated_at, vault.created_at, vault.updated_at
FROM pii_vault AS vault
JOIN cases AS legacy_case ON legacy_case.id = vault.case_id;

INSERT INTO support_case_assignees (
  id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
)
SELECT
  assignee.id, assignee.org_id, support_case.id, assignee.user_id, assignee.role,
  assignee.assigned_at, assignee.unassigned_at
FROM case_assignees AS assignee
JOIN support_cases AS support_case
  ON support_case.legacy_case_id = assignee.case_id;

-- Runtime guards are installed only after the historical copy has completed.
CREATE TRIGGER beneficiaries_insert_pending_guard
BEFORE INSERT ON beneficiaries
WHEN NEW.initialization_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;

CREATE TRIGGER support_cases_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'initial' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND initialization_state = 'pending'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND initialization_state = 'complete'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NOT EXISTS (
    SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_actor_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.initial_assignee_user_id
        AND org_id = NEW.org_id
        AND active = 1
        AND role IN ('admin', 'counselor')
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND (
      NEW.source_support_case_id IS NULL
      OR NEW.initial_assignee_user_id <> NEW.created_by_actor_id
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'admin'
    AND NEW.source_support_case_id IS NOT NULL;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases AS source_case
    WHERE source_case.id = NEW.source_support_case_id
      AND source_case.org_id = NEW.org_id
      AND source_case.beneficiary_id = NEW.beneficiary_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NEW.status <> 'active';
END;

CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id, org_id, beneficiary_id, legacy_case_id, creation_kind,
                 creation_submission_id, creation_payload_hash, created_by_actor_id,
                 source_support_case_id, initial_assignee_user_id ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status
  OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason
  OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed'
     OR NEW.closed_at IS NULL OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.closed_by_actor_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER support_case_assignees_insert_guard
BEFORE INSERT ON support_case_assignees
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND creation_kind = 'subsequent'
  )
    AND NEW.role = 'primary'
    AND EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND creation_kind = 'subsequent'
      AND NOT EXISTS (
        SELECT 1 FROM support_case_assignees
        WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
      )
    )
    AND (NEW.role <> 'primary' OR NEW.user_id <> (
      SELECT initial_assignee_user_id FROM support_cases WHERE id = NEW.support_case_id
    ));
END;

CREATE TRIGGER support_case_assignees_unassign_guard
BEFORE UPDATE OF id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
ON support_case_assignees
WHEN NEW.id IS NOT OLD.id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.role IS NOT OLD.role
  OR NEW.assigned_at IS NOT OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL
  OR NEW.unassigned_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER counseling_schedules_insert_guard
BEFORE INSERT ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER counseling_schedules_update_guard
BEFORE UPDATE ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.org_id IS NOT OLD.org_id
     OR NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.support_case_id IS NOT OLD.support_case_id
     OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
     OR NEW.version <> OLD.version + 1;
END;

CREATE TRIGGER participant_pii_vault_insert_guard
BEFORE INSERT ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind <> 'create';
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL
    AND NEW.purge_due IS NOT NULL
    AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purge_due IS NOT NULL
    AND NEW.purge_due IS NULL
    AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purged_at IS NULL
    AND OLD.purge_due IS NOT NULL
    AND NEW.purge_due IS OLD.purge_due
    AND NEW.purged_at IS NOT NULL
    AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii'
    AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purged_at IS NOT NULL
    AND NEW.purge_due IS NULL
    AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL
    AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL
    AND NEW.enc_phone IS NOT NULL
    AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.retention_changed_by AND org_id = NEW.org_id
        AND active = 1 AND role IN ('admin', 'counselor')
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.retention_changed_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
        AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT datetime(
      (SELECT closed_at FROM support_cases
       WHERE id = NEW.retention_context_support_case_id),
      '+' || (SELECT pii_purge_grace_days
              FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    (NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.purged_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    ))
    OR
    (NEW.purged_by_role = 'service' AND NEW.purged_by = 'system:purge')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND OLD.purge_due > datetime('now');
END;

CREATE TRIGGER participant_pii_vault_no_revive_guard
BEFORE UPDATE ON participant_pii_vault
WHEN OLD.purged_at IS NOT NULL AND NEW.retention_change_kind <> 're_register_pii'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM participant_pii_vault
    WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id
  );

  UPDATE participant_pii_vault
     SET purge_due = datetime(
           NEW.closed_at,
           '+' || (SELECT pii_purge_grace_days
                   FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
         ),
         version = version + 1,
         retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at,
         updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id
     AND purged_at IS NULL
     AND purge_due IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM support_cases
       WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
     );
END;

CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = NULL,
         version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at,
         updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id
     AND purged_at IS NULL
     AND purge_due IS NOT NULL;
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}'
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}'
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  VALUES (
    NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
    NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL
  );
END;

CREATE TRIGGER audit_log_participant_provenance_guard
BEFORE INSERT ON audit_log
WHEN NEW.beneficiary_id IS NOT NULL
  OR NEW.support_case_id IS NOT NULL
  OR NEW.action IN ('purge_pii_noop', 'reveal_participant_pii')
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'purge_pii_noop' AND NOT (
    NEW.target_table = 'participant_pii_vault'
    AND NEW.target_id = NEW.beneficiary_id
    AND NEW.support_case_id IS NULL
    AND NEW.detail = '{"reason":"not_eligible_or_already_purged"}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id AND active = 1 AND role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = NEW.beneficiary_id
        AND (
          purged_at IS NOT NULL
          OR purge_due IS NULL
          OR purge_due > datetime('now')
          OR EXISTS (
            SELECT 1 FROM support_cases
            WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
          )
        )
    )
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'reveal_participant_pii' AND NOT (
    NEW.target_table = 'participant_pii_vault'
    AND NEW.target_id = NEW.beneficiary_id
    AND NEW.detail = '{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id AND active = 1 AND role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
        AND status = 'active'
    )
  );
END;


-- ============================================================================
-- Migration 0006 — participant / SupportCase FK-on cutover
--
-- The private `_next` graph is built and reconciled before publication. FK
-- enforcement stays on for the entire DAG; the migration runner executes this
-- section as one atomic D1 batch, so assertion failure leaves the legacy graph intact.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE participant_support_case_cutover_assertions (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- Every 0005 backfill is reconciled bidirectionally against its legacy source
-- before the legacy graph is dropped. This detects post-expand divergence as
-- well as partial or stale copies.
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'support_case_program_type', 0
WHERE EXISTS (
  SELECT 1 FROM support_cases
  WHERE program_type <> 'financial_support_v1'
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_beneficiary_copy_forward', 0
WHERE EXISTS (
  SELECT legacy_case.id, legacy_case.org_id, 'complete',
         legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
  EXCEPT
  SELECT beneficiary.id, beneficiary.org_id, beneficiary.initialization_state,
         beneficiary.created_at, beneficiary.updated_at
  FROM beneficiaries AS beneficiary
  JOIN support_cases AS support_case
    ON support_case.beneficiary_id = beneficiary.id
   AND support_case.org_id = beneficiary.org_id
  WHERE support_case.creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_beneficiary_copy_reverse', 0
WHERE EXISTS (
  SELECT beneficiary.id, beneficiary.org_id, beneficiary.initialization_state,
         beneficiary.created_at, beneficiary.updated_at
  FROM beneficiaries AS beneficiary
  JOIN support_cases AS support_case
    ON support_case.beneficiary_id = beneficiary.id
   AND support_case.org_id = beneficiary.org_id
  WHERE support_case.creation_kind = 'legacy_import'
  EXCEPT
  SELECT legacy_case.id, legacy_case.org_id, 'complete',
         legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_support_case_copy_forward', 0
WHERE EXISTS (
  SELECT
    'legacy-support-case:' || legacy_case.id, legacy_case.org_id, legacy_case.id,
    legacy_case.id, legacy_case.program_type, legacy_case.status, legacy_case.intake_at,
    legacy_case.consent_recording_at, legacy_case.consent_text_ai_at, legacy_case.closed_at,
    legacy_case.closed_reason, NULL, legacy_case.extra, 'legacy_import', NULL, NULL,
    NULL, NULL, NULL, legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
  EXCEPT
  SELECT
    id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
    consent_recording_at, consent_text_ai_at, closed_at, closed_reason, closed_by_actor_id,
    extra, creation_kind, creation_submission_id, creation_payload_hash,
    created_by_actor_id, source_support_case_id, initial_assignee_user_id, created_at, updated_at
  FROM support_cases
  WHERE creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_support_case_copy_reverse', 0
WHERE EXISTS (
  SELECT
    id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
    consent_recording_at, consent_text_ai_at, closed_at, closed_reason, closed_by_actor_id,
    extra, creation_kind, creation_submission_id, creation_payload_hash,
    created_by_actor_id, source_support_case_id, initial_assignee_user_id, created_at, updated_at
  FROM support_cases
  WHERE creation_kind = 'legacy_import'
  EXCEPT
  SELECT
    'legacy-support-case:' || legacy_case.id, legacy_case.org_id, legacy_case.id,
    legacy_case.id, legacy_case.program_type, legacy_case.status, legacy_case.intake_at,
    legacy_case.consent_recording_at, legacy_case.consent_text_ai_at, legacy_case.closed_at,
    legacy_case.closed_reason, NULL, legacy_case.extra, 'legacy_import', NULL, NULL,
    NULL, NULL, NULL, legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_pii_vault_copy_forward', 0
WHERE EXISTS (
  SELECT
    legacy_vault.case_id, legacy_vault.org_id, legacy_vault.enc_name, legacy_vault.enc_phone,
    legacy_vault.enc_account, legacy_vault.key_version, 1, legacy_case.purge_due,
    legacy_vault.purged_at, NULL, NULL, NULL, NULL, 'legacy_import',
    legacy_vault.updated_at, legacy_vault.created_at, legacy_vault.updated_at
  FROM pii_vault AS legacy_vault
  JOIN cases AS legacy_case ON legacy_case.id = legacy_vault.case_id
  EXCEPT
  SELECT
    beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
    purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
    retention_context_support_case_id, retention_change_kind, retention_changed_at,
    created_at, updated_at
  FROM participant_pii_vault
  WHERE retention_change_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_pii_vault_copy_reverse', 0
WHERE EXISTS (
  SELECT
    beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
    purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
    retention_context_support_case_id, retention_change_kind, retention_changed_at,
    created_at, updated_at
  FROM participant_pii_vault
  WHERE retention_change_kind = 'legacy_import'
  EXCEPT
  SELECT
    legacy_vault.case_id, legacy_vault.org_id, legacy_vault.enc_name, legacy_vault.enc_phone,
    legacy_vault.enc_account, legacy_vault.key_version, 1, legacy_case.purge_due,
    legacy_vault.purged_at, NULL, NULL, NULL, NULL, 'legacy_import',
    legacy_vault.updated_at, legacy_vault.created_at, legacy_vault.updated_at
  FROM pii_vault AS legacy_vault
  JOIN cases AS legacy_case ON legacy_case.id = legacy_vault.case_id
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_assignment_copy_forward', 0
WHERE EXISTS (
  SELECT
    legacy_assignment.id, legacy_assignment.org_id,
    'legacy-support-case:' || legacy_assignment.case_id,
    legacy_assignment.user_id, legacy_assignment.role, legacy_assignment.assigned_at,
    legacy_assignment.unassigned_at
  FROM case_assignees AS legacy_assignment
  EXCEPT
  SELECT
    assignment.id, assignment.org_id, assignment.support_case_id, assignment.user_id,
    assignment.role, assignment.assigned_at, assignment.unassigned_at
  FROM support_case_assignees AS assignment
  JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
  WHERE support_case.creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_assignment_copy_reverse', 0
WHERE EXISTS (
  SELECT
    assignment.id, assignment.org_id, assignment.support_case_id, assignment.user_id,
    assignment.role, assignment.assigned_at, assignment.unassigned_at
  FROM support_case_assignees AS assignment
  JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
  WHERE support_case.creation_kind = 'legacy_import'
  EXCEPT
  SELECT
    legacy_assignment.id, legacy_assignment.org_id,
    'legacy-support-case:' || legacy_assignment.case_id,
    legacy_assignment.user_id, legacy_assignment.role, legacy_assignment.assigned_at,
    legacy_assignment.unassigned_at
  FROM case_assignees AS legacy_assignment
);

-- Parent first: every private edge below targets the `_next` parent graph.
CREATE TABLE support_cases_next (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  beneficiary_id           TEXT NOT NULL REFERENCES beneficiaries (id),
  legacy_case_id           TEXT UNIQUE,
  program_type             TEXT NOT NULL DEFAULT 'financial_support_v1'
                           CHECK (program_type IN ('financial_support_v1')),
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'closed')),
  intake_at                TEXT,
  consent_recording_at     TEXT,
  consent_text_ai_at       TEXT,
  closed_at                TEXT,
  closed_reason            TEXT,
  closed_by_actor_id       TEXT,
  extra                    TEXT,
  creation_kind            TEXT NOT NULL
                           CHECK (creation_kind IN ('legacy_import', 'initial', 'subsequent')),
  creation_submission_id   TEXT,
  creation_payload_hash    TEXT
                           CHECK (
                             creation_payload_hash IS NULL OR
                             (length(creation_payload_hash) = 64
                              AND creation_payload_hash NOT GLOB '*[^0-9a-f]*')
                           ),
  created_by_actor_id      TEXT,
  source_support_case_id   TEXT REFERENCES support_cases_next (id),
  initial_assignee_user_id TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (
    (creation_kind IN ('legacy_import', 'initial')
      AND creation_submission_id IS NULL
      AND creation_payload_hash IS NULL
      AND created_by_actor_id IS NULL
      AND source_support_case_id IS NULL
      AND initial_assignee_user_id IS NULL)
    OR
    (creation_kind = 'subsequent'
      AND length(trim(creation_submission_id)) > 0
      AND creation_payload_hash IS NOT NULL
      AND length(trim(created_by_actor_id)) > 0
      AND length(trim(initial_assignee_user_id)) > 0)
  ),
  CHECK (
    (creation_kind = 'legacy_import' AND legacy_case_id IS NOT NULL)
    OR (creation_kind = 'initial'
        AND (legacy_case_id IS NULL OR legacy_case_id = beneficiary_id))
    OR (creation_kind = 'subsequent' AND legacy_case_id IS NULL)
  ),
  CHECK (
    creation_kind = 'legacy_import'
    OR (status = 'active' AND closed_at IS NULL AND closed_reason IS NULL AND closed_by_actor_id IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL
     AND closed_by_actor_id IS NOT NULL)
  )
);

WITH RECURSIVE support_case_order(id, depth) AS (
  SELECT id, 0 FROM support_cases WHERE source_support_case_id IS NULL
  UNION ALL
  SELECT child.id, parent.depth + 1
  FROM support_cases AS child
  JOIN support_case_order AS parent ON parent.id = child.source_support_case_id
)
INSERT INTO support_cases_next
SELECT support_case.*
FROM support_cases AS support_case
JOIN support_case_order AS ordered ON ordered.id = support_case.id
ORDER BY ordered.depth;

CREATE TABLE participant_pii_vault_next (
  beneficiary_id                    TEXT PRIMARY KEY REFERENCES beneficiaries (id),
  org_id                            TEXT NOT NULL,
  enc_name                          TEXT,
  enc_phone                         TEXT,
  enc_account                       TEXT,
  key_version                       INTEGER NOT NULL CHECK (key_version > 0),
  version                           INTEGER NOT NULL CHECK (version > 0),
  purge_due                         TEXT,
  purged_at                         TEXT,
  purged_by                         TEXT,
  purged_by_role                    TEXT CHECK (purged_by_role IN ('admin', 'service')),
  retention_changed_by              TEXT,
  retention_context_support_case_id TEXT REFERENCES support_cases_next (id),
  retention_change_kind             TEXT NOT NULL
                                    CHECK (retention_change_kind IN (
                                      'legacy_import', 'create',
                                      'schedule_pii_purge_due',
                                      'cancel_pii_purge_due', 'purge_pii',
                                      're_register_pii'
                                    )),
  retention_changed_at              TEXT NOT NULL,
  created_at                        TEXT NOT NULL,
  updated_at                        TEXT NOT NULL,
  CHECK (
    (purged_at IS NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (retention_change_kind = 'legacy_import' AND purged_at IS NOT NULL
      AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (purged_at IS NOT NULL AND purged_by IS NOT NULL AND purged_by_role IN ('admin', 'service'))
  ),
  CHECK (
    retention_change_kind = 'legacy_import'
    OR purged_at IS NULL
    OR (enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL)
  )
);
INSERT INTO participant_pii_vault_next SELECT * FROM participant_pii_vault;

CREATE TABLE support_case_assignees_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
  assigned_at     TEXT NOT NULL,
  unassigned_at   TEXT
);
INSERT INTO support_case_assignees_next SELECT * FROM support_case_assignees;

CREATE TABLE goals_next (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  support_case_id     TEXT NOT NULL REFERENCES support_cases_next (id),
  title               TEXT NOT NULL,
  scale_criteria      TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  closed_reason       TEXT,
  closed_at           TEXT,
  replaced_by_goal_id TEXT REFERENCES goals_next (id),
  created_at          TEXT NOT NULL
);
WITH RECURSIVE goal_order(id, depth) AS (
  SELECT id, 0 FROM goals WHERE replaced_by_goal_id IS NULL
  UNION ALL
  SELECT goal.id, replacement.depth + 1
  FROM goals AS goal
  JOIN goal_order AS replacement ON replacement.id = goal.replaced_by_goal_id
)
INSERT INTO goals_next (
  id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
  closed_at, replaced_by_goal_id, created_at
)
SELECT
  goal.id, goal.org_id, support_case.id, goal.title, goal.scale_criteria,
  goal.status, goal.closed_reason, goal.closed_at, goal.replaced_by_goal_id,
  goal.created_at
FROM goals AS goal
JOIN goal_order AS ordered ON ordered.id = goal.id
JOIN support_cases AS support_case ON support_case.legacy_case_id = goal.case_id
ORDER BY ordered.depth;

CREATE TABLE sessions_next (
  id                           TEXT PRIMARY KEY,
  org_id                       TEXT NOT NULL,
  support_case_id              TEXT NOT NULL REFERENCES support_cases_next (id),
  counselor_id                 TEXT NOT NULL,
  held_at                      TEXT NOT NULL,
  channel                      TEXT NOT NULL CHECK (channel IN ('in_person', 'phone', 'video')),
  memo                         TEXT,
  submission_id                TEXT,
  submission_hash              TEXT CHECK (
                                 submission_hash IS NULL OR
                                 (length(submission_hash) = 64
                                  AND submission_hash NOT GLOB '*[^0-9a-f]*')
                               ),
  submitted_by                 TEXT,
  ai_status                    TEXT NOT NULL
                               CHECK (ai_status IN ('none', 'uploaded', 'processing', 'review_ready', 'approved')),
  transcript                   TEXT,
  audio_r2_key                 TEXT,
  ai_summary                   TEXT,
  ai_schema                    TEXT,
  ai_contrast                  TEXT,
  emotion_scores               TEXT,
  speaker_mapping_confirmed_at TEXT,
  approved_at                  TEXT,
  approved_by                  TEXT,
  extra                        TEXT,
  -- 기록 종류(CCC-7 · 마이그레이션 0014). 일정(session_kind, 0010)과 값 어휘 통일.
  kind                         TEXT NOT NULL DEFAULT 'regular'
                               CHECK (kind IN ('regular', 'intake')),
  -- 인테이크 서술형 항목 격리 JSON(CCC-7). 코어 3층: 통계·브리핑 쿼리에 노출 금지.
  intake_details               TEXT,
  -- 정기 기록지 서술형 항목 격리 JSON(CCC-10 · 마이그레이션 0016). 이번 상담 목표(미연결
  -- 회차)·지난 이후 변화·위기 안전 서술·담당 실무자 의견. 통계·브리핑 쿼리에 노출 금지.
  record_details               TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  CHECK (
    (submission_id IS NULL AND submission_hash IS NULL AND submitted_by IS NULL)
    OR
    (length(trim(submission_id)) > 0 AND submission_hash IS NOT NULL
     AND length(trim(submitted_by)) > 0)
  )
);
INSERT INTO sessions_next (
  id, org_id, support_case_id, counselor_id, held_at, channel, memo,
  submission_id, submission_hash, submitted_by, ai_status, transcript,
  audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
  speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
)
SELECT
  session.id, session.org_id, support_case.id, session.counselor_id,
  session.held_at, session.channel, session.memo, NULL, NULL, NULL,
  session.ai_status, session.transcript, session.audio_r2_key, session.ai_summary,
  session.ai_schema, session.ai_contrast, session.emotion_scores,
  session.speaker_mapping_confirmed_at, session.approved_at, session.approved_by,
  session.extra, session.created_at, session.updated_at
FROM sessions AS session
JOIN support_cases AS support_case ON support_case.legacy_case_id = session.case_id;

CREATE TABLE counseling_schedules_next (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases_next (id),
  scheduled_at          TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  version               INTEGER NOT NULL CHECK (version > 0),
  completed_session_id  TEXT REFERENCES sessions_next (id),
  created_by_actor_id   TEXT NOT NULL,
  updated_by_actor_id   TEXT,
  completed_by_actor_id TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (
    (status IN ('scheduled', 'cancelled', 'no_show') AND completed_session_id IS NULL
      AND completed_by_actor_id IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND completed_session_id IS NOT NULL
      AND completed_by_actor_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
INSERT INTO counseling_schedules_next SELECT * FROM counseling_schedules;

CREATE TABLE session_goal_scores_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  session_id      TEXT NOT NULL REFERENCES sessions_next (id),
  goal_id         TEXT NOT NULL REFERENCES goals_next (id),
  score           INTEGER NOT NULL CHECK (score BETWEEN -2 AND 2),
  evidence_quote  TEXT,
  scored_by       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (session_id, goal_id)
);
INSERT INTO session_goal_scores_next SELECT * FROM session_goal_scores;

CREATE TABLE ai_gas_evidence_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions_next (id),
  goal_id    TEXT NOT NULL REFERENCES goals_next (id),
  quote      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO ai_gas_evidence_next SELECT * FROM ai_gas_evidence;

CREATE TABLE action_items_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT REFERENCES sessions_next (id),
  description     TEXT NOT NULL,
  owner           TEXT NOT NULL CHECK (owner IN ('counselor', 'beneficiary', 'org')),
  due_date        TEXT,
  resolved_at     TEXT,
  resolved_by     TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO action_items_next (
  id, org_id, support_case_id, session_id, description, owner, due_date,
  resolved_at, resolved_by, created_at
)
SELECT
  item.id, item.org_id, support_case.id, item.session_id, item.description,
  item.owner, item.due_date, item.resolved_at, item.resolved_by, item.created_at
FROM action_items AS item
JOIN support_cases AS support_case ON support_case.legacy_case_id = item.case_id;

CREATE TABLE flags_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT REFERENCES sessions_next (id),
  flag_type       TEXT NOT NULL CHECK (flag_type IN (
                    'crisis_utterance', 'contact_loss_risk',
                    'housing_livelihood_shock', 'debt_deterioration',
                    'repeated_noncompliance')),
  quote           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('ai', 'counselor')),
  review_status   TEXT NOT NULL CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  CHECK (source = 'counselor' OR quote IS NOT NULL)
);
INSERT INTO flags_next (
  id, org_id, support_case_id, session_id, flag_type, quote, source,
  review_status, reviewed_by, reviewed_at, created_at
)
SELECT
  flag.id, flag.org_id, support_case.id, flag.session_id, flag.flag_type,
  flag.quote, flag.source, flag.review_status, flag.reviewed_by, flag.reviewed_at,
  flag.created_at
FROM flags AS flag
JOIN support_cases AS support_case ON support_case.legacy_case_id = flag.case_id;

CREATE TABLE pilot_text_ai_consent_evidence_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  notice_version  TEXT NOT NULL CHECK (length(trim(notice_version)) > 0),
  notice_sha256   TEXT NOT NULL CHECK (length(trim(notice_sha256)) > 0),
  evidence_ref    TEXT NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  evidence_sha256 TEXT NOT NULL CHECK (length(trim(evidence_sha256)) > 0),
  captured_by     TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
INSERT INTO pilot_text_ai_consent_evidence_next (
  id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
  evidence_sha256, captured_by, effective_at, created_at
)
SELECT
  evidence.id, evidence.org_id, support_case.id, evidence.notice_version,
  evidence.notice_sha256, evidence.evidence_ref, evidence.evidence_sha256,
  evidence.captured_by, evidence.effective_at, evidence.created_at
FROM pilot_text_ai_consent_evidence AS evidence
JOIN support_cases AS support_case ON support_case.legacy_case_id = evidence.case_id;

CREATE TABLE ai_masked_source_snapshots_next (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  support_case_id          TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id               TEXT NOT NULL REFERENCES sessions_next (id),
  masked_text              TEXT NOT NULL CHECK (length(masked_text) > 0),
  sha256                   TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  masking_pipeline_version TEXT NOT NULL CHECK (length(trim(masking_pipeline_version)) > 0),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
INSERT INTO ai_masked_source_snapshots_next (
  id, org_id, support_case_id, session_id, masked_text, sha256,
  masking_pipeline_version, created_by, created_at
)
SELECT
  snapshot.id, snapshot.org_id, support_case.id, snapshot.session_id,
  snapshot.masked_text, snapshot.sha256, snapshot.masking_pipeline_version,
  snapshot.created_by, snapshot.created_at
FROM ai_masked_source_snapshots AS snapshot
JOIN support_cases AS support_case ON support_case.legacy_case_id = snapshot.case_id;

CREATE TABLE ai_masked_source_evidence_items_next (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES ai_masked_source_snapshots_next (id),
  org_id         TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id     TEXT NOT NULL REFERENCES sessions_next (id),
  source_ref     TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_sha256  TEXT NOT NULL CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_quote TEXT NOT NULL CHECK (length(evidence_quote) > 0),
  source_start   INTEGER NOT NULL CHECK (source_start >= 0),
  source_end     INTEGER NOT NULL CHECK (source_end > source_start),
  created_at     TEXT NOT NULL,
  UNIQUE (snapshot_id, source_ref, source_start, source_end)
);
INSERT INTO ai_masked_source_evidence_items_next (
  id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
  evidence_quote, source_start, source_end, created_at
)
SELECT
  item.id, item.snapshot_id, item.org_id, support_case.id, item.session_id,
  item.source_ref, item.source_sha256, item.evidence_quote, item.source_start,
  item.source_end, item.created_at
FROM ai_masked_source_evidence_items AS item
JOIN support_cases AS support_case ON support_case.legacy_case_id = item.case_id;

CREATE TABLE ai_work_items_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT NOT NULL REFERENCES sessions_next (id),
  kind            TEXT NOT NULL CHECK (kind = 'text_ai_briefing'),
  created_at      TEXT NOT NULL,
  UNIQUE (session_id, kind)
);
INSERT INTO ai_work_items_next (
  id, org_id, support_case_id, session_id, kind, created_at
)
SELECT
  work.id, work.org_id, support_case.id, work.session_id, work.kind, work.created_at
FROM ai_work_items AS work
JOIN support_cases AS support_case ON support_case.legacy_case_id = work.case_id;

CREATE TABLE ai_draft_versions_next (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items_next (id),
  version              INTEGER NOT NULL CHECK (version > 0),
  parent_version_id    TEXT REFERENCES ai_draft_versions_next (id),
  summary_text         TEXT NOT NULL,
  questions_json       TEXT NOT NULL CHECK (json_valid(questions_json) AND json_type(questions_json) = 'array'),
  source_snapshot_id   TEXT REFERENCES ai_masked_source_snapshots_next (id),
  source_snapshot_hash TEXT,
  consent_evidence_id  TEXT REFERENCES pilot_text_ai_consent_evidence_next (id),
  provider_config_id   TEXT REFERENCES ai_provider_configs (id),
  model_id             TEXT,
  prompt_version       TEXT,
  schema_version       TEXT,
  origin               TEXT NOT NULL CHECK (origin IN ('generated', 'legacy_import')),
  creation_mode        TEXT NOT NULL CHECK (creation_mode IN ('provider_generated', 'human_edited', 'legacy_import')),
  grounding_status     TEXT NOT NULL CHECK (grounding_status IN ('grounded', 'legacy_unverified')),
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (work_item_id, version),
  CHECK (
    (origin = 'generated' AND creation_mode IN ('provider_generated', 'human_edited')
      AND grounding_status = 'grounded' AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL AND model_id IS NOT NULL
      AND prompt_version IS NOT NULL AND schema_version IS NOT NULL
      AND created_by IS NOT NULL AND json_array_length(questions_json) BETWEEN 2 AND 3)
    OR
    (origin = 'legacy_import' AND creation_mode = 'legacy_import'
      AND grounding_status = 'legacy_unverified' AND source_snapshot_id IS NULL
      AND source_snapshot_hash IS NULL AND consent_evidence_id IS NULL
      AND provider_config_id IS NULL AND model_id IS NULL AND prompt_version IS NULL
      AND schema_version IS NULL AND created_by IS NULL
      AND json_array_length(questions_json) = 0)
  )
);
WITH RECURSIVE draft_order(id, depth) AS (
  SELECT id, 0 FROM ai_draft_versions WHERE parent_version_id IS NULL
  UNION ALL
  SELECT child.id, parent.depth + 1
  FROM ai_draft_versions AS child
  JOIN draft_order AS parent ON parent.id = child.parent_version_id
)
INSERT INTO ai_draft_versions_next
SELECT draft.*
FROM ai_draft_versions AS draft
JOIN draft_order AS ordered ON ordered.id = draft.id
ORDER BY ordered.depth;

CREATE TABLE ai_evidence_links_next (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES ai_draft_versions_next (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items_next (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL,
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);
INSERT INTO ai_evidence_links_next SELECT * FROM ai_evidence_links;

CREATE TABLE ai_review_events_next (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items_next (id),
  draft_version_id     TEXT NOT NULL REFERENCES ai_draft_versions_next (id),
  decision             TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES ai_draft_versions_next (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL,
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);
INSERT INTO ai_review_events_next SELECT * FROM ai_review_events;

CREATE TABLE audit_log_next (
  id                INTEGER PRIMARY KEY,
  org_id            TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  actor_role        TEXT NOT NULL CHECK (actor_role IN ('admin', 'counselor', 'service')),
  action            TEXT NOT NULL,
  target_table      TEXT NOT NULL,
  target_id         TEXT,
  beneficiary_id    TEXT REFERENCES beneficiaries (id),
  support_case_id   TEXT REFERENCES support_cases_next (id),
  case_id           TEXT,
  detail            TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO audit_log_next (
  id, org_id, actor_id, actor_role, action, target_table, target_id,
  beneficiary_id, support_case_id, case_id, detail, created_at
)
SELECT
  audit.id, audit.org_id, audit.actor_id, audit.actor_role, audit.action,
  audit.target_table, audit.target_id,
  COALESCE(audit.beneficiary_id, support_case.beneficiary_id),
  COALESCE(audit.support_case_id, support_case.id), audit.case_id,
  audit.detail, audit.created_at
FROM audit_log AS audit
LEFT JOIN support_cases AS support_case
  ON support_case.legacy_case_id = audit.case_id;

-- Every rebuilt table is reconciled bidirectionally before the legacy graph is
-- dropped. Mapped legacy owners use scalar lookups so an orphan source row
-- remains in the expected set instead of disappearing through an inner join.
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'participant_graph_rows_and_keys', 0
WHERE EXISTS (
  SELECT * FROM support_cases
  EXCEPT
  SELECT * FROM support_cases_next
)
OR EXISTS (
  SELECT * FROM support_cases_next
  EXCEPT
  SELECT * FROM support_cases
)
OR EXISTS (
  SELECT * FROM participant_pii_vault
  EXCEPT
  SELECT * FROM participant_pii_vault_next
)
OR EXISTS (
  SELECT * FROM participant_pii_vault_next
  EXCEPT
  SELECT * FROM participant_pii_vault
)
OR EXISTS (
  SELECT * FROM support_case_assignees
  EXCEPT
  SELECT * FROM support_case_assignees_next
)
OR EXISTS (
  SELECT * FROM support_case_assignees_next
  EXCEPT
  SELECT * FROM support_case_assignees
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.title, source.scale_criteria, source.status, source.closed_reason,
         source.closed_at, source.replaced_by_goal_id, source.created_at
  FROM goals AS source
  EXCEPT
  SELECT id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
         closed_at, replaced_by_goal_id, created_at
  FROM goals_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
         closed_at, replaced_by_goal_id, created_at
  FROM goals_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.title, source.scale_criteria, source.status, source.closed_reason,
         source.closed_at, source.replaced_by_goal_id, source.created_at
  FROM goals AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.counselor_id, source.held_at, source.channel, source.memo,
         NULL, NULL, NULL, source.ai_status, source.transcript, source.audio_r2_key,
         source.ai_summary, source.ai_schema, source.ai_contrast, source.emotion_scores,
         source.speaker_mapping_confirmed_at, source.approved_at, source.approved_by,
         source.extra, source.created_at, source.updated_at
  FROM sessions AS source
  EXCEPT
  SELECT id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, transcript,
         audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
         speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
  FROM sessions_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, transcript,
         audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
         speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
  FROM sessions_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.counselor_id, source.held_at, source.channel, source.memo,
         NULL, NULL, NULL, source.ai_status, source.transcript, source.audio_r2_key,
         source.ai_summary, source.ai_schema, source.ai_contrast, source.emotion_scores,
         source.speaker_mapping_confirmed_at, source.approved_at, source.approved_by,
         source.extra, source.created_at, source.updated_at
  FROM sessions AS source
)
OR EXISTS (
  SELECT * FROM counseling_schedules
  EXCEPT
  SELECT * FROM counseling_schedules_next
)
OR EXISTS (
  SELECT * FROM counseling_schedules_next
  EXCEPT
  SELECT * FROM counseling_schedules
)
OR EXISTS (
  SELECT * FROM session_goal_scores
  EXCEPT
  SELECT * FROM session_goal_scores_next
)
OR EXISTS (
  SELECT * FROM session_goal_scores_next
  EXCEPT
  SELECT * FROM session_goal_scores
)
OR EXISTS (
  SELECT * FROM ai_gas_evidence
  EXCEPT
  SELECT * FROM ai_gas_evidence_next
)
OR EXISTS (
  SELECT * FROM ai_gas_evidence_next
  EXCEPT
  SELECT * FROM ai_gas_evidence
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.description, source.owner, source.due_date,
         source.resolved_at, source.resolved_by, source.created_at
  FROM action_items AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, description, owner, due_date,
         resolved_at, resolved_by, created_at
  FROM action_items_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, description, owner, due_date,
         resolved_at, resolved_by, created_at
  FROM action_items_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.description, source.owner, source.due_date,
         source.resolved_at, source.resolved_by, source.created_at
  FROM action_items AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.flag_type, source.quote, source.source,
         source.review_status, source.reviewed_by, source.reviewed_at, source.created_at
  FROM flags AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, flag_type, quote, source,
         review_status, reviewed_by, reviewed_at, created_at
  FROM flags_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, flag_type, quote, source,
         review_status, reviewed_by, reviewed_at, created_at
  FROM flags_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.flag_type, source.quote, source.source,
         source.review_status, source.reviewed_by, source.reviewed_at, source.created_at
  FROM flags AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.notice_version, source.notice_sha256, source.evidence_ref,
         source.evidence_sha256, source.captured_by, source.effective_at, source.created_at
  FROM pilot_text_ai_consent_evidence AS source
  EXCEPT
  SELECT id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
         evidence_sha256, captured_by, effective_at, created_at
  FROM pilot_text_ai_consent_evidence_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
         evidence_sha256, captured_by, effective_at, created_at
  FROM pilot_text_ai_consent_evidence_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.notice_version, source.notice_sha256, source.evidence_ref,
         source.evidence_sha256, source.captured_by, source.effective_at, source.created_at
  FROM pilot_text_ai_consent_evidence AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.masked_text, source.sha256,
         source.masking_pipeline_version, source.created_by, source.created_at
  FROM ai_masked_source_snapshots AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, masked_text, sha256,
         masking_pipeline_version, created_by, created_at
  FROM ai_masked_source_snapshots_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, masked_text, sha256,
         masking_pipeline_version, created_by, created_at
  FROM ai_masked_source_snapshots_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.masked_text, source.sha256,
         source.masking_pipeline_version, source.created_by, source.created_at
  FROM ai_masked_source_snapshots AS source
)
OR EXISTS (
  SELECT source.id, source.snapshot_id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.source_ref, source.source_sha256, source.evidence_quote,
         source.source_start, source.source_end, source.created_at
  FROM ai_masked_source_evidence_items AS source
  EXCEPT
  SELECT id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
         evidence_quote, source_start, source_end, created_at
  FROM ai_masked_source_evidence_items_next
)
OR EXISTS (
  SELECT id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
         evidence_quote, source_start, source_end, created_at
  FROM ai_masked_source_evidence_items_next
  EXCEPT
  SELECT source.id, source.snapshot_id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.source_ref, source.source_sha256, source.evidence_quote,
         source.source_start, source.source_end, source.created_at
  FROM ai_masked_source_evidence_items AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.kind, source.created_at
  FROM ai_work_items AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, kind, created_at
  FROM ai_work_items_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, kind, created_at
  FROM ai_work_items_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.kind, source.created_at
  FROM ai_work_items AS source
)
OR EXISTS (
  SELECT * FROM ai_draft_versions
  EXCEPT
  SELECT * FROM ai_draft_versions_next
)
OR EXISTS (
  SELECT * FROM ai_draft_versions_next
  EXCEPT
  SELECT * FROM ai_draft_versions
)
OR EXISTS (
  SELECT * FROM ai_evidence_links
  EXCEPT
  SELECT * FROM ai_evidence_links_next
)
OR EXISTS (
  SELECT * FROM ai_evidence_links_next
  EXCEPT
  SELECT * FROM ai_evidence_links
)
OR EXISTS (
  SELECT * FROM ai_review_events
  EXCEPT
  SELECT * FROM ai_review_events_next
)
OR EXISTS (
  SELECT * FROM ai_review_events_next
  EXCEPT
  SELECT * FROM ai_review_events
)
OR EXISTS (
  SELECT source.id, source.org_id, source.actor_id, source.actor_role, source.action,
         source.target_table, source.target_id,
         COALESCE(source.beneficiary_id, (
           SELECT support_case.beneficiary_id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         COALESCE(source.support_case_id, (
           SELECT support_case.id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         source.case_id, source.detail, source.created_at
  FROM audit_log AS source
  EXCEPT
  SELECT id, org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
  FROM audit_log_next
)
OR EXISTS (
  SELECT id, org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
  FROM audit_log_next
  EXCEPT
  SELECT source.id, source.org_id, source.actor_id, source.actor_role, source.action,
         source.target_table, source.target_id,
         COALESCE(source.beneficiary_id, (
           SELECT support_case.beneficiary_id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         COALESCE(source.support_case_id, (
           SELECT support_case.id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         source.case_id, source.detail, source.created_at
  FROM audit_log AS source
)
OR EXISTS (
  SELECT 1
  FROM audit_log AS source
  WHERE source.case_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM support_cases_next AS support_case
      WHERE support_case.legacy_case_id = source.case_id
    )
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'goals_scope', 0
WHERE EXISTS (
  SELECT 1 FROM goals_next AS goal
  JOIN support_cases_next AS support_case ON support_case.id = goal.support_case_id
  WHERE goal.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'sessions_scope', 0
WHERE EXISTS (
  SELECT 1 FROM sessions_next AS session
  JOIN support_cases_next AS support_case ON support_case.id = session.support_case_id
  WHERE session.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'session_goal_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM session_goal_scores_next AS score
  JOIN sessions_next AS session ON session.id = score.session_id
  JOIN goals_next AS goal ON goal.id = score.goal_id
  WHERE score.org_id <> session.org_id
     OR score.org_id <> goal.org_id
     OR session.support_case_id <> goal.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_snapshot_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_masked_source_snapshots_next AS snapshot
  JOIN sessions_next AS session ON session.id = snapshot.session_id
  WHERE snapshot.org_id <> session.org_id
     OR snapshot.support_case_id <> session.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_work_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_work_items_next AS work
  JOIN sessions_next AS session ON session.id = work.session_id
  WHERE work.org_id <> session.org_id
     OR work.support_case_id <> session.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'audit_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM audit_log_next AS audit
  JOIN support_cases_next AS support_case ON support_case.id = audit.support_case_id
  WHERE audit.org_id <> support_case.org_id
     OR audit.beneficiary_id IS NOT support_case.beneficiary_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'assignment_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM support_case_assignees_next AS assignment
  JOIN support_cases_next AS support_case ON support_case.id = assignment.support_case_id
  WHERE assignment.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'one_active_primary_assignment', 0
WHERE EXISTS (
  SELECT 1
  FROM support_cases_next AS support_case
  LEFT JOIN support_case_assignees_next AS assignment
    ON assignment.support_case_id = support_case.id
   AND assignment.role = 'primary'
   AND assignment.unassigned_at IS NULL
  GROUP BY support_case.id
  HAVING COUNT(assignment.id) <> 1
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'schedule_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM counseling_schedules_next AS schedule
  JOIN support_cases_next AS support_case ON support_case.id = schedule.support_case_id
  LEFT JOIN sessions_next AS session ON session.id = schedule.completed_session_id
  WHERE schedule.org_id <> support_case.org_id
     OR schedule.beneficiary_id <> support_case.beneficiary_id
     OR (schedule.completed_session_id IS NOT NULL
         AND (session.org_id <> schedule.org_id
              OR session.support_case_id <> schedule.support_case_id))
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'record_child_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM action_items_next AS item
  JOIN sessions_next AS session ON session.id = item.session_id
  WHERE item.session_id IS NOT NULL
    AND (item.org_id <> session.org_id
         OR item.support_case_id <> session.support_case_id)
)
OR EXISTS (
  SELECT 1
  FROM flags_next AS flag
  JOIN sessions_next AS session ON session.id = flag.session_id
  WHERE flag.session_id IS NOT NULL
    AND (flag.org_id <> session.org_id
         OR flag.support_case_id <> session.support_case_id)
)
OR EXISTS (
  SELECT 1
  FROM ai_masked_source_evidence_items_next AS item
  JOIN ai_masked_source_snapshots_next AS snapshot ON snapshot.id = item.snapshot_id
  WHERE item.org_id <> snapshot.org_id
     OR item.support_case_id <> snapshot.support_case_id
     OR item.session_id <> snapshot.session_id
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'support_case_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM support_cases AS source
  JOIN support_cases_next AS target ON target.id = source.id
  WHERE target.creation_payload_hash IS NOT source.creation_payload_hash
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_snapshot_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_masked_source_snapshots AS source
  JOIN ai_masked_source_snapshots_next AS target ON target.id = source.id
  WHERE target.sha256 IS NOT source.sha256
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_draft_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_draft_versions AS source
  JOIN ai_draft_versions_next AS target ON target.id = source.id
  WHERE target.source_snapshot_hash IS NOT source.source_snapshot_hash
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'manual_submission_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM sessions_next
  WHERE submission_id IS NOT NULL OR submission_hash IS NOT NULL OR submitted_by IS NOT NULL
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_support_cases_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('support_cases_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_participant_pii_vault_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('participant_pii_vault_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_sessions_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('sessions_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_ai_review_events_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('ai_review_events_next'));

-- Views and triggers referencing the legacy graph must be removed before the
-- old DAG is dismantled. Provider registry objects remain untouched.
DROP VIEW approved_ai_briefing_v1;
DROP VIEW grounded_ai_quality_v1;
DROP TRIGGER sessions_approved_ai_compatibility_immutable;
DROP TRIGGER ai_draft_versions_legacy_import_cutover_guard;
DROP TRIGGER sessions_direct_ai_approval_update_guard;
DROP TRIGGER sessions_direct_ai_approval_insert_guard;
DROP TRIGGER audit_log_participant_provenance_guard;
DROP TRIGGER participant_pii_vault_purge_audit;
DROP TRIGGER participant_pii_vault_cancel_audit;
DROP TRIGGER participant_pii_vault_schedule_audit;
DROP TRIGGER support_cases_cancel_pii_purge_due;
DROP TRIGGER support_cases_schedule_pii_purge_due;
DROP TRIGGER participant_pii_vault_no_revive_guard;
DROP TRIGGER participant_pii_vault_retention_guard;
DROP TRIGGER participant_pii_vault_insert_guard;
DROP TRIGGER counseling_schedules_update_guard;
DROP TRIGGER counseling_schedules_insert_guard;
DROP TRIGGER support_case_assignees_unassign_guard;
DROP TRIGGER support_case_assignees_insert_guard;
DROP TRIGGER support_cases_close_guard;
DROP TRIGGER support_cases_immutable_identity_guard;
DROP TRIGGER support_cases_insert_guard;
DROP TRIGGER beneficiaries_complete_guard;
DROP TRIGGER beneficiaries_insert_pending_guard;
DROP TRIGGER goals_title_immutable;
DROP TRIGGER pilot_text_ai_consent_evidence_no_update;
DROP TRIGGER pilot_text_ai_consent_evidence_no_delete;
DROP TRIGGER ai_masked_source_snapshots_scope_guard;
DROP TRIGGER ai_masked_source_snapshots_no_update;
DROP TRIGGER ai_masked_source_snapshots_no_delete;
DROP TRIGGER ai_masked_source_evidence_items_insert_guard;
DROP TRIGGER ai_masked_source_evidence_items_no_update;
DROP TRIGGER ai_masked_source_evidence_items_no_delete;
DROP TRIGGER ai_work_items_scope_guard;
DROP TRIGGER ai_work_items_no_update;
DROP TRIGGER ai_work_items_no_delete;
DROP TRIGGER ai_draft_versions_insert_guard;
DROP TRIGGER ai_draft_versions_no_update;
DROP TRIGGER ai_draft_versions_no_delete;
DROP TRIGGER ai_evidence_links_insert_guard;
DROP TRIGGER ai_evidence_links_no_update;
DROP TRIGGER ai_evidence_links_no_delete;
DROP TRIGGER ai_review_events_insert_guard;
DROP TRIGGER ai_review_events_no_update;
DROP TRIGGER ai_review_events_no_delete;
DROP TRIGGER audit_log_no_update;
DROP TRIGGER audit_log_no_delete;

-- Drop the legacy DAG child-first, then publish the private graph parent-first.
DROP TABLE ai_review_events;
DROP TABLE ai_evidence_links;
DROP TABLE ai_draft_versions;
DROP TABLE ai_work_items;
DROP TABLE ai_masked_source_evidence_items;
DROP TABLE ai_masked_source_snapshots;
DROP TABLE pilot_text_ai_consent_evidence;
DROP TABLE session_goal_scores;
DROP TABLE ai_gas_evidence;
DROP TABLE action_items;
DROP TABLE flags;
DROP TABLE sessions;
DROP TABLE goals;
DROP TABLE counseling_schedules;
DROP TABLE support_case_assignees;
DROP TABLE participant_pii_vault;
DROP TABLE audit_log;
DROP TABLE case_assignees;
DROP TABLE pii_vault;
DROP TABLE cases;
DROP TABLE support_cases;

ALTER TABLE support_cases_next RENAME TO support_cases;
ALTER TABLE participant_pii_vault_next RENAME TO participant_pii_vault;
ALTER TABLE support_case_assignees_next RENAME TO support_case_assignees;
ALTER TABLE goals_next RENAME TO goals;
ALTER TABLE sessions_next RENAME TO sessions;
ALTER TABLE counseling_schedules_next RENAME TO counseling_schedules;
ALTER TABLE session_goal_scores_next RENAME TO session_goal_scores;
ALTER TABLE ai_gas_evidence_next RENAME TO ai_gas_evidence;
ALTER TABLE action_items_next RENAME TO action_items;
ALTER TABLE flags_next RENAME TO flags;
ALTER TABLE pilot_text_ai_consent_evidence_next RENAME TO pilot_text_ai_consent_evidence;
ALTER TABLE ai_masked_source_snapshots_next RENAME TO ai_masked_source_snapshots;
ALTER TABLE ai_masked_source_evidence_items_next RENAME TO ai_masked_source_evidence_items;
ALTER TABLE ai_work_items_next RENAME TO ai_work_items;
ALTER TABLE ai_draft_versions_next RENAME TO ai_draft_versions;
ALTER TABLE ai_evidence_links_next RENAME TO ai_evidence_links;
ALTER TABLE ai_review_events_next RENAME TO ai_review_events;
ALTER TABLE audit_log_next RENAME TO audit_log;
-- Legacy case IDs remain read-compatible for Phase-1 exports. New writes must
-- use the canonical participant/SupportCase gateway and fail closed here.
CREATE VIEW cases AS
SELECT
  support_case.legacy_case_id AS id,
  support_case.org_id,
  support_case.program_type,
  support_case.status,
  support_case.intake_at,
  support_case.consent_recording_at,
  support_case.consent_text_ai_at,
  support_case.closed_at,
  support_case.closed_reason,
  vault.purge_due,
  support_case.extra,
  support_case.created_at,
  support_case.updated_at
FROM support_cases AS support_case
LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id = support_case.beneficiary_id
 AND vault.org_id = support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL;

CREATE TRIGGER cases_legacy_insert_unsupported
INSTEAD OF INSERT ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_update_unsupported
INSTEAD OF UPDATE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_delete_unsupported
INSTEAD OF DELETE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE VIEW case_assignees AS
SELECT
  assignment.id,
  assignment.org_id,
  support_case.legacy_case_id AS case_id,
  assignment.user_id,
  assignment.role,
  assignment.assigned_at,
  assignment.unassigned_at
FROM support_case_assignees AS assignment
JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
WHERE support_case.legacy_case_id IS NOT NULL;

CREATE TRIGGER case_assignees_legacy_insert_unsupported
INSTEAD OF INSERT ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_update_unsupported
INSTEAD OF UPDATE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_delete_unsupported
INSTEAD OF DELETE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;


-- Canonical indexes and ownership-scope guards.
CREATE UNIQUE INDEX uq_support_cases_one_initial_per_beneficiary
  ON support_cases (beneficiary_id) WHERE creation_kind = 'initial';
CREATE UNIQUE INDEX uq_support_cases_actor_submission
  ON support_cases (org_id, created_by_actor_id, creation_submission_id)
  WHERE creation_submission_id IS NOT NULL;
CREATE INDEX idx_support_cases_beneficiary_status
  ON support_cases (beneficiary_id, status, created_at DESC);
CREATE INDEX idx_participant_pii_vault_due
  ON participant_pii_vault (purge_due) WHERE purged_at IS NULL AND purge_due IS NOT NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_active
  ON support_case_assignees (support_case_id, user_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_primary
  ON support_case_assignees (support_case_id) WHERE role = 'primary' AND unassigned_at IS NULL;
CREATE INDEX idx_support_case_assignees_user
  ON support_case_assignees (user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_counseling_schedules_support_case
  ON counseling_schedules (support_case_id, status, scheduled_at);
CREATE INDEX idx_goals_support_case ON goals (support_case_id, status);
CREATE INDEX idx_sessions_support_case ON sessions (support_case_id, held_at DESC);
CREATE INDEX idx_sessions_pending ON sessions (support_case_id) WHERE ai_status = 'review_ready';
CREATE UNIQUE INDEX uq_sessions_manual_submission
  ON sessions (org_id, support_case_id, submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX idx_scores_goal ON session_goal_scores (goal_id);
CREATE INDEX idx_gas_evidence_session ON ai_gas_evidence (session_id);
CREATE INDEX idx_actions_open ON action_items (support_case_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_flags_support_case ON flags (support_case_id, review_status);
CREATE INDEX idx_pilot_text_ai_consent_support_case
  ON pilot_text_ai_consent_evidence (org_id, support_case_id, effective_at DESC);
CREATE INDEX idx_ai_masked_source_snapshots_scope
  ON ai_masked_source_snapshots (org_id, support_case_id, session_id, created_at DESC);
CREATE INDEX idx_ai_masked_source_evidence_items_scope
  ON ai_masked_source_evidence_items (org_id, support_case_id, session_id, snapshot_id, source_start);
CREATE INDEX idx_ai_work_items_org_support_case
  ON ai_work_items (org_id, support_case_id, created_at DESC);
CREATE INDEX idx_ai_work_items_session ON ai_work_items (session_id, kind);
CREATE INDEX idx_ai_draft_versions_work ON ai_draft_versions (work_item_id, version DESC);
CREATE INDEX idx_ai_draft_versions_source_snapshot
  ON ai_draft_versions (source_snapshot_id) WHERE source_snapshot_id IS NOT NULL;
CREATE INDEX idx_ai_draft_versions_provider_config
  ON ai_draft_versions (provider_config_id) WHERE provider_config_id IS NOT NULL;
CREATE INDEX idx_ai_evidence_links_draft ON ai_evidence_links (draft_version_id, claim_key);
CREATE INDEX idx_ai_review_events_work ON ai_review_events (work_item_id, created_at DESC);
CREATE UNIQUE INDEX uq_ai_review_events_terminal_draft ON ai_review_events (draft_version_id);
CREATE UNIQUE INDEX uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id) WHERE decision = 'approved';
CREATE INDEX idx_audit_beneficiary ON audit_log (beneficiary_id, created_at);
CREATE INDEX idx_audit_support_case ON audit_log (support_case_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);

CREATE TRIGGER goals_title_immutable
BEFORE UPDATE OF title ON goals
BEGIN
  SELECT RAISE(ABORT, 'D12: goal title is immutable — close and create a new goal');
END;

CREATE TRIGGER session_goal_scores_scope_guard
BEFORE INSERT ON session_goal_scores
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions AS session
    JOIN goals AS goal ON goal.id = NEW.goal_id
    WHERE session.id = NEW.session_id
      AND session.org_id = NEW.org_id
      AND goal.org_id = NEW.org_id
      AND session.support_case_id = goal.support_case_id
  );
END;

CREATE TRIGGER ai_gas_evidence_scope_guard
BEFORE INSERT ON ai_gas_evidence
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions AS session
    JOIN goals AS goal ON goal.id = NEW.goal_id
    WHERE session.id = NEW.session_id
      AND session.org_id = NEW.org_id
      AND goal.org_id = NEW.org_id
      AND session.support_case_id = goal.support_case_id
  );
END;

CREATE TRIGGER action_items_session_scope_guard
BEFORE INSERT ON action_items
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;

CREATE TRIGGER flags_session_scope_guard
BEFORE INSERT ON flags
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;

CREATE TRIGGER sessions_manual_submission_guard
BEFORE INSERT ON sessions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.submission_id IS NULL OR NEW.submission_hash IS NULL OR NEW.submitted_by IS NULL
     OR NEW.counselor_id <> NEW.submitted_by;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases AS support_case
    JOIN beneficiaries AS beneficiary ON beneficiary.id = support_case.beneficiary_id
    WHERE support_case.id = NEW.support_case_id
      AND support_case.org_id = NEW.org_id
      AND support_case.status = 'active'
      AND beneficiary.initialization_state = 'complete'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.submitted_by
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.submitted_by AND role = 'admin'
  )
    AND NOT EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id
        AND user_id = NEW.submitted_by
        AND unassigned_at IS NULL
    );
END;

CREATE TRIGGER sessions_manual_submission_audit
AFTER INSERT ON sessions
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT session.org_id, session.submitted_by, users.role,
         'submit_manual_record', 'sessions', session.id,
         support_case.beneficiary_id, session.support_case_id, NULL, datetime('now')
  FROM sessions AS session
  JOIN support_cases AS support_case ON support_case.id = session.support_case_id
  JOIN users ON users.id = session.submitted_by
  WHERE session.id = NEW.id;
END;

-- ----------------------------------------------------------------------------
-- session_life_area_snapshots — 생활 6영역 회차별 스냅샷 (CCC-8 · 마이그레이션 0013).
--   * 회차(세션)마다 6영역(경제·주거·일·건강·심리·가족)의 그 시점 상태를 쌓는다.
--     '변화 없음' 영역도 직전 세션 값을 복사해 행을 남긴다 — 어느 회차를 열어도
--     그 시점 6영역 상태를 바로 조회할 수 있다(복사·검증은 gateway 가 원자 배치로 처리).
--   * status 는 실무자 기입 상태값(5값)이다. 감정 점수(R4)·리스크 플래그(D9) 와 무관.
--   * 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D(D1~D6).
-- ----------------------------------------------------------------------------
CREATE TABLE session_life_area_snapshots (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  area_key   TEXT NOT NULL
             CHECK (area_key IN
               ('economy', 'housing', 'employment', 'health', 'mental_health', 'family')),
  status     TEXT NOT NULL
             CHECK (status IN
               ('okay', 'strained', 'crisis', 'not_applicable', 'declined')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, area_key)
);

CREATE INDEX idx_life_area_session ON session_life_area_snapshots (session_id);

CREATE TRIGGER beneficiaries_insert_pending_guard
BEFORE INSERT ON beneficiaries
WHEN NEW.initialization_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;
CREATE TRIGGER support_cases_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'legacy_import';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM beneficiaries
                    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'initial' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'pending'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'complete'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.initial_assignee_user_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND (NEW.source_support_case_id IS NULL OR NEW.initial_assignee_user_id <> NEW.created_by_actor_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'admin'
    AND NEW.source_support_case_id IS NOT NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases AS source_case
    WHERE source_case.id = NEW.source_support_case_id AND source_case.org_id = NEW.org_id
      AND source_case.beneficiary_id = NEW.beneficiary_id
      AND source_case.status = 'active'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND NOT EXISTS (
      SELECT 1
      FROM support_cases AS source_case
      JOIN support_case_assignees AS assignment
        ON assignment.support_case_id = source_case.id
       AND assignment.org_id = source_case.org_id
      WHERE source_case.id = NEW.source_support_case_id
        AND source_case.org_id = NEW.org_id
        AND source_case.beneficiary_id = NEW.beneficiary_id
        AND source_case.status = 'active'
        AND assignment.user_id = NEW.created_by_actor_id
        AND assignment.unassigned_at IS NULL
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NEW.status <> 'active';
END;

CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id, org_id, beneficiary_id, legacy_case_id, creation_kind,
                 creation_submission_id, creation_payload_hash, created_by_actor_id,
                 source_support_case_id, initial_assignee_user_id ON support_cases
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed' OR NEW.closed_at IS NULL
     OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.closed_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER support_case_assignees_insert_guard
BEFORE INSERT ON support_case_assignees
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.support_case_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM users
                    WHERE id = NEW.user_id AND org_id = NEW.org_id
                      AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (SELECT 1 FROM support_cases
                WHERE id = NEW.support_case_id AND creation_kind = 'subsequent')
    AND NOT EXISTS (SELECT 1 FROM support_case_assignees
                    WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL)
    AND (NEW.role <> 'primary' OR NEW.user_id <> (
      SELECT initial_assignee_user_id FROM support_cases WHERE id = NEW.support_case_id
    ));
END;

CREATE TRIGGER support_case_assignees_unassign_guard
BEFORE UPDATE OF id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
ON support_case_assignees
WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.role IS NOT OLD.role OR NEW.assigned_at IS NOT OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL OR NEW.unassigned_at IS NULL
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER counseling_schedules_insert_guard
BEFORE INSERT ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM users
                    WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
                      AND active = 1 AND role IN ('admin', 'counselor'));
END;

CREATE TRIGGER counseling_schedules_update_guard
BEFORE UPDATE ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
     OR NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.support_case_id IS NOT OLD.support_case_id
     OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
     OR NEW.version <> OLD.version + 1;
END;

CREATE TRIGGER participant_pii_vault_insert_guard
BEFORE INSERT ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM beneficiaries
                    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind <> 'create';
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL AND NEW.purge_due IS NOT NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NULL AND OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL
    AND NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
    AND NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii' AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL AND NEW.enc_phone IS NOT NULL AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role = 'admin');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id AND status = 'active');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT datetime(
      (SELECT closed_at FROM support_cases
       WHERE id = NEW.retention_context_support_case_id),
      '+' || (SELECT pii_purge_grace_days
              FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    (NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1 FROM users WHERE id = NEW.purged_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    ))
    OR
    (NEW.purged_by_role = 'service' AND NEW.purged_by = 'system:purge')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND EXISTS (
    SELECT 1 FROM support_cases WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND OLD.purge_due > datetime('now');
END;

CREATE TRIGGER participant_pii_vault_no_revive_guard
BEFORE UPDATE ON participant_pii_vault
WHEN OLD.purged_at IS NOT NULL AND NEW.retention_change_kind <> 're_register_pii'
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (SELECT 1 FROM participant_pii_vault
                WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id);
  UPDATE participant_pii_vault
     SET purge_due = datetime(NEW.closed_at, '+' || (
           SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = NEW.org_id
         ) || ' days'),
         version = version + 1, retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL AND purge_due IS NULL
     AND NOT EXISTS (SELECT 1 FROM support_cases
                     WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active');
END;

CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = NULL, version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL AND purge_due IS NOT NULL;
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  VALUES (NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
          NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL, datetime('now'));
END;

CREATE TRIGGER audit_log_participant_provenance_guard
BEFORE INSERT ON audit_log
WHEN NEW.beneficiary_id IS NOT NULL OR NEW.support_case_id IS NOT NULL
  OR NEW.action IN ('purge_pii_noop', 'reveal_participant_pii')
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'purge_pii_noop' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.support_case_id IS NULL
    AND NEW.detail = '{"reason":"not_eligible_or_already_purged"}'
    AND EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND org_id = NEW.org_id
                AND active = 1 AND role = 'admin')
    AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id = NEW.beneficiary_id
                AND (
                  purged_at IS NOT NULL
                  OR purge_due IS NULL
                  OR purge_due > datetime('now')
                  OR EXISTS (
                    SELECT 1 FROM support_cases
                    WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
                  )
                ))
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'reveal_participant_pii' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.detail = '{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id
        AND active = 1 AND role = NEW.actor_role
        AND role IN ('admin', 'counselor')
    )
    AND (
      NEW.actor_role = 'admin'
      OR EXISTS (
        SELECT 1 FROM support_case_assignees
        WHERE support_case_id = NEW.support_case_id AND org_id = NEW.org_id
          AND user_id = NEW.actor_id AND unassigned_at IS NULL
      )
    )
    AND EXISTS (SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
                AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
                AND status = 'active')
  );
END;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;

-- Phase-1 provenance is retained verbatim; only the owner edge is renamed to
-- support_case_id. These triggers continue to prohibit direct or ungrounded AI.
CREATE TRIGGER pilot_text_ai_consent_evidence_no_update
BEFORE UPDATE ON pilot_text_ai_consent_evidence
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;
CREATE TRIGGER pilot_text_ai_consent_evidence_no_delete
BEFORE DELETE ON pilot_text_ai_consent_evidence
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;

CREATE TRIGGER ai_masked_source_snapshots_scope_guard
BEFORE INSERT ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;
CREATE TRIGGER ai_masked_source_snapshots_no_update
BEFORE UPDATE ON ai_masked_source_snapshots
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;
CREATE TRIGGER ai_masked_source_snapshots_no_delete
BEFORE DELETE ON ai_masked_source_snapshots
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;

CREATE TRIGGER ai_masked_source_evidence_items_insert_guard
BEFORE INSERT ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    JOIN sessions ON sessions.id = snapshot.session_id
                 AND sessions.org_id = snapshot.org_id
                 AND sessions.support_case_id = snapshot.support_case_id
    WHERE snapshot.id = NEW.snapshot_id AND snapshot.org_id = NEW.org_id
      AND snapshot.support_case_id = NEW.support_case_id AND snapshot.session_id = NEW.session_id
  );
  SELECT RAISE(ABORT, 'phase1: masked source evidence hash mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM ai_masked_source_snapshots AS snapshot
                    WHERE snapshot.id = NEW.snapshot_id AND snapshot.sha256 = NEW.source_sha256);
  SELECT RAISE(ABORT, 'phase1: masked source evidence span mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id AND NEW.source_end <= length(snapshot.masked_text)
      AND substr(snapshot.masked_text, NEW.source_start + 1,
                 NEW.source_end - NEW.source_start) = NEW.evidence_quote
  );
END;
CREATE TRIGGER ai_masked_source_evidence_items_no_update
BEFORE UPDATE ON ai_masked_source_evidence_items
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;
CREATE TRIGGER ai_masked_source_evidence_items_no_delete
BEFORE DELETE ON ai_masked_source_evidence_items
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;

CREATE TRIGGER ai_work_items_scope_guard
BEFORE INSERT ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work item case or session scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;
CREATE TRIGGER ai_work_items_no_update
BEFORE UPDATE ON ai_work_items
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;
CREATE TRIGGER ai_work_items_no_delete
BEFORE DELETE ON ai_work_items
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;

CREATE TRIGGER ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((SELECT MAX(version) + 1 FROM ai_draft_versions
                                 WHERE work_item_id = NEW.work_item_id), 1);
  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
     OR (NEW.version > 1 AND NOT EXISTS (
       SELECT 1 FROM ai_draft_versions AS parent
       WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
         AND parent.version = NEW.version - 1
     ));
  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (SELECT 1 FROM json_each(NEW.questions_json)
                WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0)
     OR EXISTS (SELECT 1 FROM json_each(NEW.questions_json)
                GROUP BY json_each.value HAVING COUNT(*) > 1);
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM ai_review_events
                WHERE draft_version_id = NEW.parent_version_id);
  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = NEW.source_snapshot_hash
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id = NEW.consent_evidence_id AND evidence.org_id = work.org_id
     AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin = 'generated' AND NEW.consent_evidence_id IS NOT (
    SELECT evidence.id
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.org_id = work.org_id AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
      AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'human_edited' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
      AND parent.origin = 'generated' AND parent.provider_config_id IS NEW.provider_config_id
      AND parent.source_snapshot_id IS NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
      AND parent.questions_json IS NEW.questions_json AND parent.model_id IS NEW.model_id
      AND parent.prompt_version IS NEW.prompt_version AND parent.schema_version IS NEW.schema_version
  );
  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'provider_generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id = config.id
                                                AND activation.org_id = work.org_id
    WHERE work.id = NEW.work_item_id AND activation.deactivated_at IS NULL
  );
END;
CREATE TRIGGER ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only'); END;
CREATE TRIGGER ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
BEGIN SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only'); END;

CREATE TRIGGER ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft
                    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
                      AND draft.grounding_status = 'grounded');
  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = draft.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = draft.source_snapshot_hash
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256 AND item.org_id = work.org_id
     AND item.support_case_id = work.support_case_id AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.draft_version_id)
     OR EXISTS (
       SELECT 1 FROM ai_draft_versions AS newer
       JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
       WHERE newer.work_item_id = draft.work_item_id AND newer.version > draft.version
     );
END;
CREATE TRIGGER ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;
CREATE TRIGGER ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft
                    WHERE draft.id = NEW.draft_version_id AND draft.work_item_id = NEW.work_item_id);
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected') AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS newer
    JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
    WHERE newer.work_item_id = NEW.work_item_id AND newer.version > draft.version
  );
  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS draft
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE draft.id = NEW.draft_version_id AND replacement.work_item_id = draft.work_item_id
      AND replacement.version = draft.version + 1
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS later
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE later.work_item_id = NEW.work_item_id AND later.version > replacement.version
  );
  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.replacement_draft_id);
  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);
  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (SELECT 1 FROM ai_evidence_links WHERE draft_version_id = NEW.draft_version_id);
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (SELECT 1 FROM ai_evidence_links
                    WHERE draft_version_id = NEW.draft_version_id
                      AND claim_key NOT GLOB 'question_[0-9]*');
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
      AND EXISTS (
        SELECT 1 FROM json_each(draft.questions_json) AS question
        WHERE NOT EXISTS (SELECT 1 FROM ai_evidence_links AS evidence
                          WHERE evidence.draft_version_id = draft.id
                            AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1))
      )
  );
END;
CREATE TRIGGER ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;
CREATE TRIGGER ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.origin = 'legacy_import'
BEGIN SELECT RAISE(ABORT, 'phase1: runtime legacy AI import is prohibited'); END;

CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.support_case_id AS support_case_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  support_case.beneficiary_id AS beneficiary_id,
  support_case.program_type AS support_case_program_type,
  support_case.status AS support_case_status,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.questions_json AS questions_json,
  draft.summary_text AS ai_summary,
  draft.source_snapshot_id AS source_snapshot_id,
  draft.source_snapshot_hash AS source_snapshot_hash,
  draft.consent_evidence_id AS consent_evidence_id,
  draft.provider_config_id AS provider_config_id,
  draft.model_id AS model_id,
  draft.prompt_version AS prompt_version,
  draft.schema_version AS schema_version,
  draft.origin AS origin,
  draft.creation_mode AS creation_mode,
  draft.grounding_status AS grounding_status,
  draft.created_by AS draft_created_by,
  draft.created_at AS draft_created_at,
  review.id AS review_event_id,
  review.actor_id AS approved_by,
  review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work ON work.id = review.work_item_id
JOIN support_cases AS support_case ON support_case.id = work.support_case_id
JOIN ai_draft_versions AS draft ON draft.id = review.draft_version_id
                             AND draft.work_item_id = work.id
WHERE review.decision = 'approved';

CREATE VIEW grounded_ai_quality_v1 AS
SELECT * FROM approved_ai_briefing_v1
WHERE origin = 'generated' AND grounding_status = 'grounded';

CREATE TRIGGER sessions_direct_ai_approval_insert_guard
BEFORE INSERT ON sessions
WHEN NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT NULL
  OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'phase1: direct session AI approval is prohibited'); END;

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
 AND NOT (
   NEW.ai_status = 'approved' AND NEW.approved_at IS NOT NULL AND EXISTS (
     SELECT 1 FROM approved_ai_briefing_v1 AS briefing
     WHERE briefing.session_id = NEW.id AND briefing.summary_text IS NEW.ai_summary
       AND briefing.approved_by IS NEW.approved_by AND briefing.approved_at IS NEW.approved_at
   )
 )
BEGIN SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review'); END;

CREATE TRIGGER sessions_approved_ai_compatibility_immutable
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN OLD.approved_at IS NOT NULL
 AND (NEW.ai_status IS NOT OLD.ai_status OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
BEGIN SELECT RAISE(ABORT, 'phase1: approved session AI compatibility fields are immutable'); END;

-- Durable cutover manifest, followed by final no-suffix/FK/hash/manifest probes.
CREATE TABLE participant_support_case_cutover_manifest (
  migration_id             TEXT PRIMARY KEY CHECK (migration_id = '0006_participant_support_case_cutover'),
  beneficiary_count        INTEGER NOT NULL,
  support_case_count       INTEGER NOT NULL,
  session_count            INTEGER NOT NULL,
  approved_ai_count        INTEGER NOT NULL,
  pii_vault_count          INTEGER NOT NULL,
  legacy_case_map_count    INTEGER NOT NULL,
  completed_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO participant_support_case_cutover_manifest (
  migration_id, beneficiary_count, support_case_count, session_count,
  approved_ai_count, pii_vault_count, legacy_case_map_count
)
SELECT
  '0006_participant_support_case_cutover',
  (SELECT COUNT(*) FROM beneficiaries),
  (SELECT COUNT(*) FROM support_cases),
  (SELECT COUNT(*) FROM sessions),
  (SELECT COUNT(*) FROM approved_ai_briefing_v1),
  (SELECT COUNT(*) FROM participant_pii_vault),
  (SELECT COUNT(*) FROM support_cases WHERE legacy_case_id IS NOT NULL);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'final_manifest', 0
WHERE NOT EXISTS (
  SELECT 1 FROM participant_support_case_cutover_manifest
  WHERE migration_id = '0006_participant_support_case_cutover'
    AND beneficiary_count = (SELECT COUNT(*) FROM beneficiaries)
    AND support_case_count = (SELECT COUNT(*) FROM support_cases)
    AND session_count = (SELECT COUNT(*) FROM sessions)
    AND approved_ai_count = (SELECT COUNT(*) FROM approved_ai_briefing_v1)
    AND pii_vault_count = (SELECT COUNT(*) FROM participant_pii_vault)
    AND legacy_case_map_count = (SELECT COUNT(*) FROM support_cases WHERE legacy_case_id IS NOT NULL)
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'final_fk', 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

DROP TABLE participant_support_case_cutover_assertions;

CREATE TABLE participant_support_case_cutover_probe (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO participant_support_case_cutover_probe (id, ok)
SELECT 'no_private_suffixes', 0
WHERE EXISTS (
  SELECT 1 FROM sqlite_master
  WHERE type IN ('table', 'index', 'trigger', 'view')
    AND (name GLOB '*_next' OR name GLOB '*_legacy')
);
INSERT INTO participant_support_case_cutover_probe (id, ok)
SELECT 'final_fk_after_publication', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);
DROP TABLE participant_support_case_cutover_probe;

-- ============================================================================
-- Migration 0008 — 당사자 동의 기록 (D15 · D23 · 티켓 #19)
--
-- 당사자 등록 시 받은 항목별 동의(녹음·텍스트 AI 분리, D15)를 일시·기록자와 함께
-- 저장하는 전용 기록 테이블. 문안·서명은 저장하지 않는다(D23 — 오프라인 동의의 "기록"만).
-- support_cases.consent_*_at(파이프라인 게이트)은 그대로 두고, 이 표가 그 위에
-- "누가 언제 그 결정을 기록했나"를 덧붙인다. 등록 게이트웨이가 두 곳을 한 배치에서 함께 쓴다.
-- 추가(additive) 전용 — 0001~0007 구조를 바꾸지 않는다.
-- ============================================================================
CREATE TABLE participant_consent_records (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  consent_recording_at  TEXT,                                 -- 녹음·음성 분석 동의 시각 (NULL = 미동의, D15)
  consent_text_ai_at    TEXT,                                 -- 텍스트 AI 정리 동의 시각 (NULL = 미동의, D15)
  consent_privacy_at    TEXT,                                 -- 필수 통합 동의(개인정보 수집·이용) 시각 (NULL = 미동의, CCC-7 · 0014)
  recorded_by           TEXT NOT NULL,                        -- 기록자 (Access 사용자)
  recorded_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_participant_consent_records_scope
  ON participant_consent_records (org_id, beneficiary_id, support_case_id, recorded_at DESC);

CREATE TRIGGER participant_consent_records_insert_guard
BEFORE INSERT ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.consent_recording_at IS NOT NULL AND NEW.consent_recording_at <> NEW.recorded_at)
     OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at <> NEW.recorded_at)
     OR (NEW.consent_privacy_at IS NOT NULL AND NEW.consent_privacy_at <> NEW.recorded_at);
END;

CREATE TRIGGER participant_consent_records_no_update
BEFORE UPDATE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;

CREATE TRIGGER participant_consent_records_no_delete
BEFORE DELETE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;

-- ----------------------------------------------------------------------------
-- 0009 — 상담 일정의 세션 목표·맞춤형 질문 (D28 · D29 · 티켓 #35)
-- 일정별 세션 목표(케이스 목표 선택 연결, 복수·미연결 허용)와 맞춤형 질문을 담는다.
-- GAS 는 여전히 케이스 목표(goals)에만 — 이 표는 문구와 연결만(점수 없음).
-- ----------------------------------------------------------------------------
CREATE TABLE schedule_session_goals (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  schedule_id       TEXT NOT NULL REFERENCES counseling_schedules (id),
  support_case_id   TEXT NOT NULL REFERENCES support_cases (id),
  case_goal_id      TEXT REFERENCES goals (id),            -- NULL = 미연결 (D28)
  body              TEXT NOT NULL,                         -- 이번 회차에서 다룰 것
  ordinal           INTEGER NOT NULL,
  created_by        TEXT NOT NULL,                         -- 작성 실무자 (Access 사용자)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id, ordinal)
);

CREATE INDEX idx_schedule_session_goals_schedule
  ON schedule_session_goals (schedule_id, ordinal);

CREATE TABLE schedule_custom_questions (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  schedule_id       TEXT NOT NULL REFERENCES counseling_schedules (id),
  support_case_id   TEXT NOT NULL REFERENCES support_cases (id),
  body              TEXT NOT NULL,                         -- 실무자가 직접 적는 질문
  ordinal           INTEGER NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id, ordinal)
);

CREATE INDEX idx_schedule_custom_questions_schedule
  ON schedule_custom_questions (schedule_id, ordinal);

CREATE TRIGGER schedule_session_goals_insert_guard
BEFORE INSERT ON schedule_session_goals
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.case_goal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM goals
      WHERE id = NEW.case_goal_id
        AND org_id = NEW.org_id
        AND support_case_id = NEW.support_case_id
        AND status = 'active'
    );
END;

CREATE TRIGGER schedule_custom_questions_insert_guard
BEFORE INSERT ON schedule_custom_questions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

-- ============================================================================
-- Migration 0009 — 당사자 PII 금고에 이메일 추가 (D3 · D24 · ADR-0005 · 티켓 #32)
--
-- participant_pii_vault 에 enc_email 컬럼을 덧붙인다. 이름·연락처·계좌와 동일한 앱
-- 레벨 AES-GCM 암호문(D3)만 저장하며, 평문은 어디에도 남기지 않는다. 화면 소비는 후속
-- 티켓(#37)이 맡고, 이 단계는 저장·복호화·파기 경로만 연다. ALTER ADD COLUMN 은 기존
-- 데이터·CHECK·트리거를 건드리지 않고 컬럼을 테이블 끝에 덧붙인다(추가 전용). 파기 시
-- enc_email 을 함께 NULL 로 비우는 책임은 게이트웨이 파기 SQL 에 있다. 이 CREATE 스크립트는
-- 마이그레이션 0001~0009 누적 결과와 동일해야 하므로 0009 를 마지막 절로 이어 붙인다.
-- ============================================================================
ALTER TABLE participant_pii_vault ADD COLUMN enc_email TEXT;
-- ----------------------------------------------------------------------------
-- 0010 — 상담 유형·상담 방법 (session_kind · channel) (D4 · D21 · 티켓 #36)
-- 상담 일정에 '기본 상담(regular)/인테이크(intake)' 분기와 상담 방법을 추가한다.
-- channel 은 v1 대면 전용(D4). 이 channel(약속의 진행 방법)은 sessions.channel
-- (진행된 세션 기록의 채널)과 다른 개념이며 phone/video 는 후자에만 허용된다.
-- 추가 전용: ALTER 는 기존 행을 regular·in_person 으로 백필한다.
-- ----------------------------------------------------------------------------
ALTER TABLE counseling_schedules
  ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (session_kind IN ('regular', 'intake'));

ALTER TABLE counseling_schedules
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'in_person'
    CHECK (channel IN ('in_person'));
-- ----------------------------------------------------------------------------
-- 0012 — 미해결 액션 4상태 처리 어휘 (CCC-5 · 티켓 #54 · 설계 v0.2)
-- 정기 기록지의 미해결 액션 원클릭 처리를 위해 action_items 에 처리 어휘를 덧붙인다.
-- 기존 resolved_at·resolved_by 는 유지하며 '완료(done)' 처리 시에만 함께 채운다
-- (미해결 목록·resolved 불리언 의미 보존). 나머지 상태는 resolved_at 을 NULL 로
-- 남겨 미해결로 유지하되 처리 이력(상태·한 줄·일시·회차)을 아래 컬럼에 남긴다.
-- 추가 전용: ALTER 는 기존 행을 NULL 로 백필한다.
-- ----------------------------------------------------------------------------
ALTER TABLE action_items ADD COLUMN resolution_status TEXT
  CHECK (resolution_status IN ('done', 'in_progress', 'not_done', 'hold'));

ALTER TABLE action_items ADD COLUMN resolution_note TEXT;

ALTER TABLE action_items ADD COLUMN resolution_at TEXT;

ALTER TABLE action_items ADD COLUMN resolution_session_id TEXT REFERENCES sessions (id);
-- ----------------------------------------------------------------------------
-- 0015 — 인테이크 기본정보 PII 4종 (CCC-9 · 티켓 #54 · 설계 v0.3 ①)
-- 생년월일·거주 지역·긴급 연락처·성별을 실명·연락처와 같은 금고에 AES-GCM 암호문으로
-- 저장한다(D3). 파기 시 함께 NULL 로 비우는 책임은 게이트웨이 파기 SQL 에 있다
-- (0009 enc_email 선례 — CHECK 확장 없음). 추가 전용.
-- ----------------------------------------------------------------------------
ALTER TABLE participant_pii_vault ADD COLUMN enc_birth_date TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_region TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_emergency_contact TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_gender TEXT;
-- ----------------------------------------------------------------------------
-- 0020 — 개인정보 수집·이용 동의 시각 (D44 · 2026-07-29)
-- 동의 3종을 같은 층에 맞춘다: 녹음·텍스트 AI 는 support_cases 에 "현재값"이 있고
-- participant_consent_records(0008·0014)에 append-only 이력이 쌓이는데, 개인정보 동의는
-- 0014 로 이력 쪽에만 들어가 있었다. 이 ALTER 가 빠진 현재값 컬럼을 채운다.
-- 녹음 동의와 달리 파이프라인 게이트가 아니다 — 미동의여도 등록·상담은 진행된다(D15).
-- 철회는 이 값을 NULL 로 되돌리고 행위는 이력 표에 새 행으로 남는다(D14·D23).
-- 추가 전용: ALTER 는 기존 행을 NULL(미동의)로 백필한다 — 받지 않은 동의를 만들지 않는다.
-- ----------------------------------------------------------------------------
ALTER TABLE support_cases ADD COLUMN consent_privacy_at TEXT;

-- ----------------------------------------------------------------------------
-- 0021 — 초대 토큰 (D39 · ADR-0016 · CCC-29 — 구 0018, 리베이스 시 리네임)
-- 당사자 가입 링크(사업+발급 실무자 묶음)와 실무자 초대 링크의 공용 기반.
-- 토큰이 곧 자격(로그인 없음): 32바이트 난수 hex, 발급·소비는 gateway 만(R1)
-- + 전건 감사(D14). status 는 issued → used 단방향, 만료 정책은 D26 법률 검토
-- 후 실제 인증 설계와 함께. 상세 주석: migrations/0021_invite_tokens.sql.
-- ----------------------------------------------------------------------------
CREATE TABLE invite_tokens (
  token                   TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('participant', 'counselor')),
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

-- ----------------------------------------------------------------------------
-- 0024: 전체 목표 (D45 · CCC-41). 케이스당 1개·수정 가능·점수 없음(D33) — goals 테이블
-- (세부 목표, title 수정 금지)과 층이 다르므로 케이스 행의 컬럼이다. NULL = 설정 전.
-- 권한(담당 실무자만)·200자 상한·감사(D14)는 게이트웨이가 강제한다(R1).
-- ----------------------------------------------------------------------------
ALTER TABLE support_cases ADD COLUMN overall_goal TEXT;

-- ----------------------------------------------------------------------------
-- 0027: 내용 불일치 저장 구조 (D45 · ADR-0018 · CCC-43). 기록 공식화 시점(수기 저장·
-- AI 승인)에 검출해 저장하고 브리핑 영역 ③은 저장된 결과만 읽는다. AI 는 판단하지
-- 않으므로(R5) 양쪽 원문 인용 + 회차 참조만 담는다. resolution_* 3컬럼은 처리 3종
-- (CCC-42)의 예약 자리 — NULL = 미처리. 인용·회차는 트리거로 불변, 처리된 행은 삭제
-- 불가(접힌 이력 보존). 상세 근거는 migrations/0027_session_discrepancies.sql.
-- ----------------------------------------------------------------------------
CREATE TABLE session_discrepancies (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  support_case_id    TEXT NOT NULL REFERENCES support_cases (id),
  kind               TEXT NOT NULL CHECK (kind IN ('cross_session', 'within_session')),
  trigger_session_id TEXT NOT NULL REFERENCES sessions (id),
  left_session_id    TEXT NOT NULL REFERENCES sessions (id),
  left_quote         TEXT NOT NULL CHECK (length(trim(left_quote)) BETWEEN 1 AND 500),
  right_session_id   TEXT NOT NULL REFERENCES sessions (id),
  right_quote        TEXT NOT NULL CHECK (length(trim(right_quote)) BETWEEN 1 AND 500),
  detected_at        TEXT NOT NULL,
  resolution_status  TEXT CHECK (resolution_status IN ('situation_changed', 'record_error', 'confirmed')),
  resolved_by        TEXT,
  resolved_at        TEXT,
  created_at         TEXT NOT NULL,
  CHECK (kind <> 'within_session' OR left_session_id = right_session_id),
  CHECK (kind <> 'cross_session' OR left_session_id <> right_session_id),
  CHECK (
    (resolution_status IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (resolution_status IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX idx_session_discrepancies_case
  ON session_discrepancies (org_id, support_case_id, resolution_status);
CREATE INDEX idx_session_discrepancies_trigger
  ON session_discrepancies (org_id, trigger_session_id);

CREATE TRIGGER session_discrepancies_content_immutable
BEFORE UPDATE ON session_discrepancies
WHEN OLD.id <> NEW.id
  OR OLD.org_id <> NEW.org_id
  OR OLD.support_case_id <> NEW.support_case_id
  OR OLD.kind <> NEW.kind
  OR OLD.trigger_session_id <> NEW.trigger_session_id
  OR OLD.left_session_id <> NEW.left_session_id
  OR OLD.left_quote <> NEW.left_quote
  OR OLD.right_session_id <> NEW.right_session_id
  OR OLD.right_quote <> NEW.right_quote
  OR OLD.detected_at <> NEW.detected_at
  OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'session_discrepancies: detected content is immutable');
END;

CREATE TRIGGER session_discrepancies_resolved_no_delete
BEFORE DELETE ON session_discrepancies
WHEN OLD.resolution_status IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'session_discrepancies: resolved rows are retained history');
END;
