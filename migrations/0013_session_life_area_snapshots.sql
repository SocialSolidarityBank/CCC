-- ============================================================================
-- Migration 0013 — 생활 6영역 회차별 스냅샷 (CCC-8 · 티켓 #54 · 정기 기록지 설계 v0.1)
--
-- 참여자의 생활 상황 6영역(경제·생계 / 주거 / 일·고용·학업 / 건강 / 심리·정서 /
-- 가족·관계·돌봄)을 회차(세션)마다 "그 시점의 상태" 로 쌓는 자식 테이블을 신설한다.
-- 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D(D1~D6, 영역·상태
-- 정의) + docs/intake/intake-form-design-v0.md §1-④ + session-record-form-design-v0.md
-- §④(정기 상담은 "변화 없음 원클릭" — 델타만 갱신).
--
-- 저장 방식은 회차별 전체 스냅샷이다: '변화 없음' 영역도 직전 세션 스냅샷 값을 그대로
-- 복사해 행을 남겨, 어느 회차를 열어도 그 시점의 6영역 상태를 바로 조회할 수 있다.
-- 복사·검증 로직은 db/gateway.ts(createCounselingRecord)가 세션 INSERT 와 같은 배치로
-- 원자적으로 처리한다(R1: D1 접근 단일 관문). 스냅샷 구조 자체는 기록 종류(인테이크·
-- 정기)와 무관하게 재사용 가능하다 — 인테이크 기준선(CCC-7)도 같은 테이블을 쓴다.
--
--   * area_key — 6영역 고정 키(CHECK). 세션당 영역별 1행(UNIQUE).
--   * status   — 5값 상태(CHECK): okay(괜찮음) / strained(긴장) / crisis(위기) /
--                not_applicable(해당없음) / declined(답변거부). D9(리스크)·R4(감정) 와
--                무관한 상담사 기입 상태값이다 — 감정 점수가 아니다.
--   * note     — 선택 한 줄 메모(NULL 허용).
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0012 테이블·트리거를 바꾸지 않는다.
-- db/schema.sql(누적본)에도 같은 정의를 반영한다.
-- ============================================================================

CREATE TABLE session_life_area_snapshots (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  area_key   TEXT NOT NULL
             CHECK (area_key IN
               ('economy',        -- 경제·생계
                'housing',        -- 주거
                'employment',     -- 일·고용·학업
                'health',         -- 건강(신체)
                'mental_health',  -- 심리·정서·스트레스
                'family')),       -- 가족·관계·돌봄
  status     TEXT NOT NULL
             CHECK (status IN
               ('okay',           -- 괜찮음
                'strained',       -- 긴장
                'crisis',         -- 위기
                'not_applicable', -- 해당없음
                'declined')),     -- 답변거부
  note       TEXT,               -- 선택 한 줄
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, area_key)  -- 세션당 영역별 스냅샷은 1개
);

-- 세션별 스냅샷 조회(기록 응답)와 "최신 스냅샷 보유 세션" 탐색(직전 상태 복사)용.
CREATE INDEX idx_life_area_session ON session_life_area_snapshots (session_id);
