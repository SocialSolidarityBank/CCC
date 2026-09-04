-- ============================================================================
-- 비영리 사례관리 프로그램 — Cloudflare D1(SQLite) 스키마 초안 v0.1
--
-- 근거 문서: CLAUDE.md 3장(데이터 설계 원칙) + 9장(설계 결정 D1~D15)
-- 공통 규약:
--   * 날짜/시각은 UTC 텍스트("YYYY-MM-DD HH:MM:SS")로 저장한다.
--   * ID는 앱(gateway)에서 생성한 UUID 텍스트. 예외 2곳 —
--     cases.id는 가명 ID(예: 'A017', gateway가 조직별 순번으로 발급),
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
  org_id               TEXT NOT NULL,                 -- 조직 ID (D1)
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
-- case_assignees — 케이스 담당자 매핑 (D7). 공동 담당·이관을 행 추가로 표현한다.
--   * 이관 시 기존 행을 지우지 않고 unassigned_at을 채운 뒤 새 행을 만든다
--     → "언제 누가 담당했나" 이력이 그대로 남는다.
--   * 접근 규칙(gateway가 강제): 관리자이거나, 이 테이블에 활성 행(unassigned_at IS NULL)이
--     있는 담당자만 해당 케이스를 열람·수정할 수 있다.
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
  counselor_id                 TEXT NOT NULL,         -- 작성 상담사 (Access 식별자)
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
  speaker_mapping_confirmed_at TEXT,                 -- 화자 매핑 상담사 확인 (D11)
  approved_at                  TEXT,                 -- 승인 시각 (R2 관문)
  approved_by                  TEXT,                 -- 승인 상담사
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
--   * D6: score는 상담사가 직접 매긴다. AI는 evidence_quote(근거 발언 발췌)만 제안.
-- ----------------------------------------------------------------------------
CREATE TABLE session_goal_scores (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  session_id     TEXT NOT NULL REFERENCES sessions (id),
  goal_id        TEXT NOT NULL REFERENCES goals (id),
  score          INTEGER NOT NULL CHECK (score BETWEEN -2 AND 2),  -- GAS 5단계
  evidence_quote TEXT,                                -- AI가 발췌 제안한 근거 발언 (D6)
  scored_by      TEXT NOT NULL,                       -- 점수 매긴 상담사 (AI 불가, D6)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, goal_id)                        -- 세션당 목표별 점수는 1개
);

CREATE INDEX idx_scores_goal ON session_goal_scores (goal_id);


-- ----------------------------------------------------------------------------
-- ai_gas_evidence — [코어] 세션×목표별 AI 근거 발췌 (D6).
--   * D6: AI는 GAS 점수를 매기지 않는다. 목표별 근거 발언 발췌(quote)만 제안하고,
--     상담사는 이를 참고해 session_goal_scores.score를 직접 정한다.
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
--   * review_status: 상담사가 맞음(confirmed)/틀림(rejected)을 확인한다.
--     상담사가 직접 만든 플래그는 생성 즉시 confirmed로 저장한다(gateway 처리).
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
