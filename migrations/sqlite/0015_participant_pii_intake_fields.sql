-- ============================================================================
-- Migration 0015 — 인테이크 기본정보 PII 4종 (CCC-9 · 티켓 #54 · 인테이크 설계 v0.3 ①)
--
-- 인테이크 ① 시작 단계의 "기본정보 더 적기"(P4 접힘)가 받는 생년월일·거주 지역·긴급
-- 연락처·성별을 실명·연락처·계좌·이메일과 같은 금고에 같은 방식으로 저장한다:
-- 앱 레벨 AES-GCM 암호문만 컬럼에 남기고 평문은 어디에도 두지 않는다(D3). 새 암호화
-- 경로를 만들지 않고 기존 encryptPii/decryptPii 헬퍼(키 = Workers 시크릿 PII_ENC_KEY,
-- PII_KEY_VERSION)를 그대로 재사용한다.
--
-- 왜 확장 슬롯 JSON(sessions.intake_details)이 아니라 금고인가: 이 4종은 서술이 아니라
-- 개인 식별 정보다. 파기(D10·D32)·복호화 감사(D14)·AI 전송 마스킹(R3·D2)이 모두 금고
-- 단위로 동작하므로, 금고 밖에 두면 파기·감사에서 새는 사각지대가 생긴다.
--
-- 0009(enc_email)와 동일한 추가 전용 패턴이다. SQLite 의 ALTER TABLE ADD COLUMN 은
-- 기존 데이터·CHECK·트리거를 건드리지 않고 컬럼을 테이블 끝에 덧붙이며, NULL 허용이라
-- 기존 행은 그대로 둔다. 파기 시 이 4개 컬럼도 함께 NULL 로 비우는 책임은 게이트웨이
-- 파기 SQL(purgePii · purgeDuePii · purgeParticipantPiiForActor)에 있다 — 0009 가
-- enc_email 을 테이블 CHECK 에 넣지 않은 선례를 그대로 따른다(CHECK 확장은 테이블
-- 재생성을 요구하므로 추가 전용 원칙을 깬다).
--
-- 쓰기 경로는 인테이크 저장(createIntakeRecord)의 원자 배치 안이며, 이 4개 컬럼만
-- 갱신한다 — 실명·연락처·계좌·이메일은 이 경로로 절대 쓰지 않는다(기존 admin 전용
-- updateParticipantPii 유지). 읽기는 인테이크 작성 컨텍스트 조회이며 복호화 전건
-- decrypt_pii 감사를 남긴다(D14).
--
-- db/schema.sql(누적본)에도 같은 ALTER 절을 이어 붙인다(0009·0010·0012 와 동일 방식).
-- ============================================================================

ALTER TABLE participant_pii_vault ADD COLUMN enc_birth_date TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_region TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_emergency_contact TEXT;

ALTER TABLE participant_pii_vault ADD COLUMN enc_gender TEXT;
