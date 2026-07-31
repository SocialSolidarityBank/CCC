# 운영 D1 마이그레이션 — 적용 결과 (2026-08-01)

`pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc --env production --remote`
**15개 전부 성공.** 남은 미적용 0건(`✅ No migrations to apply!`).

## 데이터는 그대로다

| 표 | 적용 전 | 적용 후 |
| --- | --- | --- |
| participant_pii_vault | 22 (전부 미파기) | **22 (전부 미파기)** |
| 그중 purge_due 설정됨 | 0 | **0** |
| support_cases | 22 (종결 0) | **22 (종결 0)** |
| sessions | 64 | **64** |
| users | 29 | **29** |
| audit_log | 500 | **500** |

`purge_due` 가 여전히 0 인 것이 중요하다 — **보존 시계는 시작되지 않았고, 03:00 파기 크론에
걸릴 후보도 0건이다**(D10). 적용이 파기를 깨우지 않았다는 사실 확인.

## 새 스키마가 실제로 들어갔는지

| 확인 | 결과 |
| --- | --- |
| 새 표 3개(invite_tokens · session_discrepancies · session_life_area_snapshots) | 3/3 |
| PII 금고 신규 4컬럼(enc_birth_date · enc_region · enc_emergency_contact · enc_gender) | 4/4 |
| sessions 신규 3컬럼(kind · intake_details · record_details) | 3/3 |
| support_cases 신규 3컬럼(consent_privacy_at · overall_goal · emergency_registration_reason) | 3/3 |
| action_items resolution 계열 | 4 |
| users.last_program_type | 1 |
| 재생성된 트리거 2종 · 뷰 2종 | 2/2 · 2/2 |

## 되돌리는 법

적용 **직전** 북마크(2026-08-31 까지 유효, D1 Time Travel 30일):

    00000425-00000000-000050b9-f66154c5edf15ab17dca596eab303e49

    pnpm exec wrangler d1 time-travel restore ccc --bookmark=00000425-00000000-000050b9-f66154c5edf15ab17dca596eab303e49

되돌리면 위 15개가 다시 미적용 상태가 되고 데이터도 그 시점으로 돌아간다.

## 이 적용이 바꾼 상태 2가지 (다음 세션이 알아야 한다)

1. `yellow` **운영 DB 가 배포된 코드보다 앞서 있다.** 운영 워커 `ccc-api` 는 마지막 배포가
   2026-07-15 이고, DB 는 이제 0028 까지다. 지금은 문제가 아니다 — 운영 API 는 Access·
   fail-closed 로 잠겨 실사용 트래픽이 없고, 마이그레이션이 전부 덧붙이기라 옛 코드가
   깨지지도 않는다. 이 간극은 **운영 배포로 닫는 것이 정상 순서**다.
2. `yellow` **배포 워크플로의 스키마 게이트가 이제 통과한다.** 어제까지는 이 게이트가
   운영 배포를 물리적으로 막고 있었다. 이제 남은 잠금은 확인 문구와 승인(Environment
   `production`, 리뷰어 3명·main 브랜치 한정) 둘이다.

## 여전히 열려 있는 것 — 스키마 정합과 별개다

`CLAUDE.md` 8장의 **보존·파기 파이프라인 미구현**(보존 시계 설정 · 아카이브 전환 · 5년 상한
큐를 한 묶음으로), D46 의 동의 게이트 G4·G5 미착수와 법률 검토 동결은 그대로다.
**스키마를 맞춘 것이 실서비스 개시 조건을 충족했다는 뜻이 아니다.**
