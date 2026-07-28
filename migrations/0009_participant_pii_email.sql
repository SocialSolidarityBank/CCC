-- ============================================================================
-- Migration 0009 — 참여자 PII 금고에 이메일 추가 (D3 · D24 · ADR-0005 · 티켓 #32)
--
-- participant_pii_vault 에 enc_email 컬럼을 추가한다. 이름·연락처·계좌와 동일한
-- 앱 레벨 AES-GCM 암호문(D3)만 저장하며, 평문은 어디에도 남기지 않는다. 화면 소비는
-- 후속 티켓(#37 참여자 등록)이 맡고, 이 마이그레이션은 저장·복호화·파기 경로만 연다.
--
-- SQLite 의 ALTER TABLE ADD COLUMN 은 기존 데이터·CHECK·트리거를 건드리지 않고
-- 컬럼을 테이블 끝에 덧붙인다(0005 의 users.time_zone·audit_log.beneficiary_id 와
-- 같은 추가 전용 패턴). NULL 허용이므로 기존 행은 그대로 두고, 파기 시 enc_email 을
-- 함께 NULL 로 비우는 책임은 게이트웨이 파기 SQL(purgeParticipantPiiForActor)에 있다.
-- db/schema.sql 은 이 컬럼을 테이블 정의 마지막 컬럼으로 반영해 누적 결과와 일치시킨다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0008 테이블·트리거를 바꾸지 않는다.
-- ============================================================================

ALTER TABLE participant_pii_vault ADD COLUMN enc_email TEXT;
