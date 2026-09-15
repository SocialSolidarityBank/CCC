# 운영 D1 마이그레이션 — 적용 전 기준점 (2026-09-16)

Q 승인 출고 배포. 0054~0072 19건 적용 전에 되돌릴 좌표를 먼저 남긴다.

## 되돌리는 법 (D1 Time Travel)

적용 직전 북마크:

    000012b2-00000000-000050e7-0c0fb6b7576e5026b8cd176c8d8beee8

복구 명령 (apps/api 에서, Infisical 주입 셸 안):

    pnpm exec wrangler d1 time-travel restore ccc --env production --bookmark=000012b2-00000000-000050e7-0c0fb6b7576e5026b8cd176c8d8beee8

D1 Time Travel 은 30일 보관이다. 이 북마크는 2026-10-16 까지 유효하다.

## 적용 전 행 수

| 표 | 행 수 |
| --- | --- |
| participant_pii_vault | 0 |
| support_cases | 0 |
| sessions | 0 |
| users | 2 |
| audit_log | 0 |
| flags | 0 |
| counseling_schedules | 0 |
| d1_migrations | 52 |

`yellow` 운영 D1 은 사실상 비어 있다 — 시드 정리가 이미 끝난 상태로 보인다 [추정].
users 2개만 남아 있다(본문은 열지 않았다).

## 적용 대상 19개

0054 0055 0056 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 0070 0071 0072

`wrangler d1 migrations list ccc --env production --remote` 출력과 일치한다.
마지막 적용은 0053 이다(d1_migrations 52행 + 시스템 행 [추정]).
