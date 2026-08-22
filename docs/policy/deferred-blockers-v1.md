# 미루는 차단 항목 후속 명세 v2

작성일 2026-08-16, 갱신일 2026-08-22. 이 문서는 ADR-0035에서 미룬 차단 항목 둘의 근거와 착수 지점을 남긴다. 기관 관리자 접근 범위는 D74와 ADR-0038로, 보존·파기 절차는 CCC-121로 해소했다.

## 1. 보존·파기 절차 `green` 해소 (2026-08-22, CCC-121)

D32·D46이 요구한 6단계를 `migrations/0041_pii_retention_lifecycle.sql`과 `db/gateway.ts`에 구현했다. 보존기한 도래만으로 값을 지우던 종전 경로는 더 이상 HTTP나 cron에 배선되지 않는다.

### 1.1 현재 동작

1. **보존 시계**: 마지막 활성 케이스가 종결되면 기존 트리거가 `purge_due`를 채운다.
2. **자동 아카이브**: 매일 03:00 UTC cron은 `processParticipantPiiRetention`을 호출한다. 도래분 암호문을 `participant_pii_archives`로 옮기고 기존 금고에서는 비우되 `purged_at`은 기록하지 않는다.
3. **접근 제한**: 아카이브 당사자는 일반 목록, 검색, 케이스 조회, PII 복호화 경로에서 제외된다. 새 케이스가 생기면 스키마 트리거가 암호문과 접근 상태를 원복한다.
4. **검토 큐**: 기관 관리자는 `GET /pii-retention/reviews`에서 자기 기관의 검토 대기분만 본다.
5. **보존 사유 확인**: `decision=retain`은 연장 동의, 진행 중 업무, 법적 보존 사유 중 하나와 설명, 재검토일을 요구한다. 법적 사유가 아니면 종결 후 5년 상한을 넘길 수 없다. 재검토일이 오면 cron이 다시 대기 상태로 올린다.
6. **관리자 승인 후 파기**: `decision=purge`는 기관 관리자와 `PII_PURGE_ENABLED=1`을 모두 요구한다. 승인된 한 건만 비우고 가명 기록은 남긴다.

### 1.2 감사와 검증

- 감사 전이: `schedule_pii_purge_due`, `archive_pii`, `retain_archived_pii` 또는 `requeue_pii_retention`, `restore_archived_pii`, `approve_pii_purge`, `purge_pii`
- 테넌트 경계: 검토 큐와 결정 모두 `org_id`로 제한하고 기관 관리자만 허용한다.
- 회귀 테스트: `apps/api/test/retention-lifecycle.test.ts`가 아카이브, 접근 제한, 보존, 재검토, 승인 파기, 재참여 복원을 한 흐름으로 검증한다.

### 1.3 남은 별도 게이트

이 코드 차단 항목은 해소됐다. 실제 상담 데이터 투입 전 법률 검토 재개와 내부 보존 규정 근거 확인은 기존 운영 게이트로 남으며, 구현을 다시 종전 즉시 파기 방식으로 되돌리는 사유가 아니다.

## 2. 기관 관리자 접근 범위

### 2.1 해소된 차이

`green` **기관 관리자의 평상시 초과 열람은 D74와 ADR-0038 구현으로 해소했다(2026-08-22).**

`assertSupportCaseAccess`와 레거시 상담 내용 관문은 더 이상 `admin` 역할만으로 통과시키지 않는다. 상담 내용 읽기는 활성 담당 배정 또는 기관 관리자가 수동 부여한 팀 감독 관계에서만 열리고, 상담 내용 쓰기는 활성 담당 배정에서만 열린다. 기관 관리자의 PII와 운영 기능은 별도 관문으로 분리해 유지했다.

복수 역할 원장과 팀, 팀 소속, 감독 권한 스키마는 `migrations/0040_roles_team_scope.sql`에 있다. 기존 `admin`은 기관 관리자와 기관 기술 관리자로, 기존 `counselor`는 실무자로 백필한다.

### 2.2 검증 증거

- `apps/api/test/support-case-access-deny-audit.test.ts`: 담당이 아닌 기관 관리자 거부, 활성 팀 감독 열람, 감독 종료 뒤 거부, 감독자의 쓰기 거부
- `apps/api/test/role-access-schema.test.ts`: 복수 역할 백필, 기관 경계 위반 거부, 마지막 필수 관리자 보호
- `apps/api/test/audio.test.ts`, `discrepancies.test.ts`, `routes.test.ts`, `gateway-domain.test.ts`: 담당이 아닌 기관 관리자의 녹음, AI 검토, 불일치 처리, 브리핑 열람 거부

### 2.3 남은 긴급 접근

긴급 접근 엔드포인트는 아직 없다. 따라서 기관 관리자는 담당 배정이 없는 상담 내용을 긴급 상황에도 열 수 없으며, 불완전하게 열어 두는 대신 닫힌 상태로 실패한다.

긴급 접근이 필요해지는 운영 단계에서 `apps/api/src/request-handler.ts`에 사유, 시간 제한, 케이스 범위, 전건 감사, 담당 실무자 통지를 모두 갖춘 별도 경로를 추가한다. 이 경로는 평상시 접근 관문에 `admin` 우회를 되살리는 방식으로 구현하지 않는다.

## 3. 미루지 않은 것

이 문서가 전체 그림을 담도록, 같은 배치에서 실제로 처리한 항목을 적는다.

- `records/` 를 `.gitignore` 에 추가해 공개 레포로의 상담 녹음 유입을 차단했다.
- 감정 분석 계산을 `worker.py` 의 `EMOTION_DEFERRED` 상수로 멈췄다(D64). 스키마, 데이터, `emotion.py` 모듈, 테스트는 전부 그대로 두고 계산만 정지했다.
- 기관 관리자 평상시 초과 열람을 차단하고 복수 역할, 팀 감독 권한 골격을 추가했다(D74, ADR-0038). 긴급 접근은 별도 fail-closed 후속으로 남겼다.
