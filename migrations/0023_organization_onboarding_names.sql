-- ============================================================================
-- 마이그레이션 0023 — 기관·첫 사업 표시 이름 (CCC-32 · 스펙 #78 US 1·2, D39/ADR-0016)
--
-- 관리자 온보딩 2단계 화면(조직 이름 → 첫 사업 이름)이 저장하는 값 두 개다.
-- 스펙의 저장 깊이 결정을 그대로 따른다: **이름만 진짜 저장**하고 programs 테이블은
-- 만들지 않는다 — 내부 사업 유형은 금전지원형 v1 고정이라, 사업 "표시 이름" 하나면
-- 사이드바·화면 전체가 입력값을 되비출 수 있다.
--
-- 왜 organization_settings 인가 — 스펙이 "조직 설정 저장소 활용"으로 정했고, 이 표가
-- 이미 기관 단위 설정(시간대·PII 유예기간)의 자리다. 표를 새로 만들면 기관 설정이
-- 두 곳으로 갈라진다.
--
-- NULL 허용(백필 없음): 값이 없으면 화면은 기존 하드코딩 라벨(labels.ts — 사회연대은행 /
-- 마이크로크레딧)로 폴백한다. 온보딩을 거치지 않은 기존 환경이 깨지지 않는다.
--
-- 마이그레이션 번호가 0020 다음인데 0023 인 이유: 0021·0022 는 열린 PR #5(참여자
-- 초대·자기 가입)가 선점했다 — 번호 충돌로 어느 한쪽이 리베이스를 다시 하지 않게 비켜 간다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 기존 테이블·트리거를 바꾸지 않는다.
-- ============================================================================

ALTER TABLE organization_settings ADD COLUMN org_name TEXT
  CHECK (org_name IS NULL OR length(trim(org_name)) BETWEEN 1 AND 80);

ALTER TABLE organization_settings ADD COLUMN program_display_name TEXT
  CHECK (program_display_name IS NULL OR length(trim(program_display_name)) BETWEEN 1 AND 120);
