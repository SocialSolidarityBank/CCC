-- ============================================================================
-- 마이그레이션 0030 — intake_at 정합 복구 (CCC-56 · 2026-08-08)
--
-- 왜 필요한가. 당사자 등록 액션이 폼에 없는 intakeAt 을 등록 시각으로 채워 보내
-- (actions.ts 구 canonicalUtcDateTimeOrNow), 모든 신규 케이스가 "인테이크 완료"로
-- 기록됐다. intake_at 의 계약은 "인테이크 완료 시각, NULL 이면 아직 없음"이다
-- (gateway ScheduleCandidate) — 이 오염이 상담 등록 위저드의 기본 유형 오판,
-- "인테이크 두 번" 오경고, 상담 기록 화면의 인테이크 작성 버튼과의 신호 모순을 만들었다.
--
-- 무엇을 하나. 같은 PR 에서 코드 경로를 닫았고(등록 라우트가 intakeAt 키를 거부,
-- 채움은 createIntakeRecord 저장 배선으로 이동), 이 마이그레이션은 이미 저장된 행을
-- 계약대로 되돌린다:
--   * kind='intake' 세션이 있는 케이스 → 그 세션의 상담일(held_at)
--   * 없는 케이스 → NULL (아직 인테이크 전)
-- 인테이크는 케이스당 1회 규칙이 있으나(gateway 1회 가드), 가드 도입 전 데이터를
-- 대비해 MIN 으로 가장 이른 회차에 못박는다. updated_at 은 건드리지 않는다 —
-- 실무자 편집이 아니라 표기 복구이고, 값 비교 기반 동시성 제어가 없는 컬럼이다.
-- ============================================================================

UPDATE support_cases
SET intake_at = (
  SELECT MIN(s.held_at)
  FROM sessions AS s
  WHERE s.org_id = support_cases.org_id
    AND s.support_case_id = support_cases.id
    AND s.kind = 'intake'
);
