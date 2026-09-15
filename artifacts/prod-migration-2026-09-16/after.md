# 운영 D1 마이그레이션 — 적용 결과 (2026-09-16)

`CI=true pnpm exec wrangler d1 migrations apply ccc --env production --remote`
(Infisical 주입 셸, `CLOUDFLARE_API_TOKEN=$CLOUDFLARE_WORKERS_API_TOKEN`)
**19개 전부 성공 (0054~0072).** 남은 미적용 0건(`✅ No migrations to apply!`).

## 적용 전 users 2행 확인 (본문·이메일 전체는 열지 않음)

| role | active | 도메인 | created |
| --- | --- | --- | --- |
| admin | 1 | bss.or.kr | 2026-07-10 |
| service | 1 | `*.access` (Cloudflare Access 서비스 계정) | 2026-07-10 |

admin 1개는 실사용 staff 계정, service 1개는 Access 서비스 계정이다. 옛 시드 아님.

## 데이터는 그대로다

| 표 | 적용 전 | 적용 후 |
| --- | --- | --- |
| participant_pii_vault | 0 | **0** |
| support_cases | 0 | **0** |
| sessions | 0 | **0** |
| users | 2 | **2** |
| audit_log | 0 | **0** |
| flags | 0 | **0** |
| counseling_schedules | 0 | **0** |
| d1_migrations | 52 | **71** |

## 새 스키마가 실제로 들어갔는지 (오늘 작업에 얽힌 것 위주)

| 확인 | 결과 |
| --- | --- |
| staff_invites (0058) | 있음 |
| privacy_purge_events · privacy_purge_open_support_cases (0071·0072) | 있음 |
| program_admission_policies · program_admission_guards · programs · program_staff (0054) | 있음 |
| participant_registration_receipts · participant_consent_records | 있음 |
| ai_masked_source_snapshots · ai_masked_source_evidence_items · ner_release_qualification_receipts (0069 계열) | 있음 |
| manual_record_revisions · manual_action_outcomes · manual_question_outcomes (0063·0064) | 있음 |
| intake_record_revisions · schedule_question_revisions · schedule_custom_questions (0062·0064) | 있음 |
| case_assignees · support_case_assignees · team_memberships · teams (0066·0067 계열) | 있음 |

## 되돌리는 법

적용 **직전** 북마크(2026-10-16 까지 유효, D1 Time Travel 30일):

    000012b2-00000000-000050e7-0c0fb6b7576e5026b8cd176c8d8beee8

    pnpm exec wrangler d1 time-travel restore ccc --env production --bookmark=000012b2-00000000-000050e7-0c0fb6b7576e5026b8cd176c8d8beee8
