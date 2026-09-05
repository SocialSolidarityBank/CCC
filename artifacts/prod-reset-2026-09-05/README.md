# 내부 클로즈드 베타 운영 데이터 초기화

2026-09-05 Q 승인으로 운영 D1 `ccc`의 기존 업무 데이터와 감사 이력을 비웠다. 보존 범위는 `account@bss.or.kr` 관리자 1명, 기존 활성 서비스 계정 1개, 관리자 권한 2개와 기관 설정이다. `@bss.or.kr`과 `@ggbss.or.kr`은 모두 기관 계정이며, 도메인을 더미 판별 기준으로 쓰지 않았다. 다른 직원 계정은 처음부터 등록하는 흐름을 확인하기 위해 승인된 범위에서 삭제했다.

## 실행 대상과 결과

- D1: `ccc`, ID `554dd4ef-c45b-4649-bc88-a7f103f3fc5c`
- 실행 기반: `ops/prod-beta-reset`, `origin/main`의 `089682a`
- 실행: `apps/api`에서 `wrangler d1 execute ccc --env production --remote --file <검토한 일회성 SQL>`
- 결과: 201개 명령 성공, 16.01ms, 1회 실행. 응답 리전은 APAC, colo는 ICN이었다.
- 웹/API 코드는 배포하지 않았다. 운영 앱 버전은 v0.6.0 그대로다.
- 미리보기 DB와 원음 버킷은 변경하지 않았다.

| 표 | 초기화 전 | 독립 재조회 결과 |
| --- | ---: | ---: |
| users | 29 | 2 |
| user_role_assignments | 38 | 2 |
| organization_settings | 1 | 1 |
| beneficiaries | 22 | 0 |
| support_cases | 22 | 0 |
| participant_pii_vault | 22 | 0 |
| support_case_assignees | 34 | 0 |
| sessions | 64 | 0 |
| counseling_schedules | 74 | 0 |
| goals | 40 | 0 |
| session_goal_scores | 128 | 0 |
| flags | 4 | 0 |
| action_items | 12 | 0 |
| participant_consent_records | 21 | 0 |
| audit_log | 590 | 0 |
| d1_migrations | 47 | 47 |
| participant_support_case_cutover_manifest | 1 | 1 |

48개 표를 모두 재조회했다. 위 보존 표 5개 외에는 전부 0행이다. 마이그레이션 이력과 컷오버 완료 표는 업무 데이터가 아닌 스키마 이력으로 보존했다.

여기서 독립 재조회는 import 응답의 성공 표시와 별도로 D1에 읽기 전용 질의를 보냈다는 뜻이다. 외부 검증자가 직접 운영에 접속했다는 뜻은 아니다. 전체 건수와 전후 스키마 해시는 [verification.json](verification.json)에 기록했다. 기관 식별자는 `bss`다. 계정별 개인정보를 공개 레포에 복사하지 않으며, 정확한 이전 행은 아래 암호화 백업으로 확인한다.

관리자와 서비스 계정의 모든 필드, 관리자 권한 2행, 기관 설정 1행을 실행 전 값과 비교해 동일함을 확인했다. 관리자 권한은 활성 `institution_admin`과 `institution_technical_admin`이다. 서비스 계정은 처리 장비의 Access 신원이며, 크론은 별도의 `system:*` 신원을 사용한다.

## 무결성 및 원음 확인

- 테이블 48개, 뷰 4개, 트리거 138개, 명시적 인덱스 79개의 정의를 실행 전후 비교했다. 269개 모두 동일했다.
- `PRAGMA foreign_key_check` 결과는 실행 전후 모두 0건이었다.
- `wrangler d1 migrations list ccc --env production --remote` 결과는 `No migrations to apply`였다.
- 초기화 전 세션 64개 중 `audio_r2_key`가 있는 행은 0개였다.
- 운영 `ccc-audio` 버킷을 원격 R2 바인딩의 `list`로 조회했다. 객체 0개, 0바이트였으며 삭제 요청은 하지 않았다.

삭제를 막는 기본 표 트리거 27개는 단일 D1 import 안에서만 내렸다가 원문 그대로 복원했다. 일반 애플리케이션의 append-only 규칙은 변경하지 않았다. SQL은 실행 전의 모든 표 건수와 관리자 신원, 활성 권한, 미설정 기관명을 검사하고, 실행 후 건수와 외래키를 다시 검사하도록 만들었다. 실패했던 이전 삭제 SQL은 폐기했다. 실제 실행 SQL은 백업 디렉터리의 `prod-beta-reset-2026-09-05.executed.sql`로 보존하며, 상시 운영 스크립트나 마이그레이션으로 Git에 넣지는 않는다.

## 백업과 되돌림

실행 직전 Time Travel 북마크:

```text
00000b20-00000000-000050dd-4280fcc95421fa27603eb69610be3bfb
```

실행 후 북마크:

```text
00000b20-0000000e-000050dd-0a1887521e5e6887fac3ba1737bf94f1
```

승인 후 되돌릴 때는 `apps/api`에서 다음 명령을 쓴다. 초기화 뒤 새로 입력한 데이터도 덮어쓰므로 재승인 없이 실행하지 않는다. 북마크의 유효기간은 계정 플랜의 Time Travel 보관 기간에 따른다.

```bash
pnpm exec wrangler d1 time-travel restore ccc --env production --bookmark=00000b20-00000000-000050dd-4280fcc95421fa27603eb69610be3bfb
```

별도 암호화 백업도 실행한 맥의 `$HOME/.local/share/ccc/backups/`에 보관했다. 디렉터리는 0700, 파일은 0600이다. 파일명은 `prod-beta-reset-2026-09-05.aesgcm.json`이며 AES-256-GCM, 실행 당시 Infisical prod `PII_ENC_KEY`를 사용했다. 디스크에서 다시 읽은 암호문을 복호화해 내보낸 원본과 일치함을 확인했다. 원본 평문 SQL 파일은 즉시 삭제했으며, 백업은 Git에 포함하지 않았다. 키를 교체할 때는 이 백업의 복구에 필요한 당시 키도 안전하게 보존해야 한다.

D1 export에는 뷰 4개가 모두 있지만, `case_assignees_legacy_delete_unsupported` 트리거가 3,161행에 먼저 나오고 대상 뷰 `case_assignees`는 4,549행에 나온다. 그래서 원본 export를 순서대로 복원하면 `no such table: main.case_assignees`로 실패한다. 같은 백업 디렉터리에 의존 순서로 정리한 전체 스키마를 `prod-beta-reset-2026-09-05.schema.sql`로 보관했다. 복구 리허설은 그 스키마의 표/인덱스/뷰를 만든 다음 export의 데이터 INSERT를 적재하고 트리거를 복원하는 순서로 수행했다. 이 공개 문서는 실행 요약이며, Time Travel 만료 뒤의 복구를 자동 실행하는 도구는 제공하지 않는다. 그런 복구는 Q 재승인 후 당시 키로 백업을 복호화하고, 같은 순서를 격리된 DB에서 재검증한 다음 진행한다.

| 검증 대상 | SHA-256 |
| --- | --- |
| 원본 export, 657,949바이트 | `37b71515f2a683e5d329760c7884aecbd49daf5766f13e3bf6d22649689d3495` |
| 전체 스키마 보조 파일 | `f02bd4af99c0b4a2e3f479bd3130404361957084728c79ac158baee8a3a82570` |
| 실행한 초기화 SQL | `41568f16926e82cc8e42a637db78a9305eddbe4d8a987d130abed752794cfb65` |

## 리허설과 검증 범위

1. 전체 운영 백업과 정확한 스키마를 메모리 DB에 복원했다. 외래키 검사를 통과했다.
2. 동일 데이터를 Miniflare D1에 넣고 초기화 전체 뒤에 고의 오류를 추가했다. 사용자 29명, 케이스 22개와 전체 스키마가 원상 복원됐다.
3. 고의 오류 없이 같은 SQL을 실행해 보존 건수, 업무 데이터 0건, 스키마 동일, 외래키 0건을 확인했다. 복원된 권한 삭제 방지 트리거가 다시 삭제를 거부했다.
4. 독립 검토가 지적한 활성 관리자 권한 검사와 NULL 안전 삭제 조건을 반영한 뒤 D1 리허설을 다시 통과했다.
5. 일회성 API 스모크는 로컬의 폐기 가능한 Miniflare D1과 API Worker 모듈에서 실행했다. 최소 계정 상태, 실제 Access 인증 어댑터, 테스트용 서명 JWT와 JWKS 훅을 사용했다. 기관/사업명 설정, 관리자 직접 직원 등록, 등록된 직원의 빈 케이스 조회, 삭제된 직원의 403 거부, 공개 초대의 404 차단을 확인했다. 운영 배포나 운영 DB에는 테스트 요청과 검증용 직원을 넣지 않았다.

브라우저의 운영 `/onboarding` 접속은 Cloudflare Access 로그인 화면까지 확인했다. 로그인된 실제 관리자 세션의 화면 검증은 하지 못했다. 테스트용 JWT 스모크를 실제 사용자 로그인 완료로 해석하지 않는다.

## 시드 재유입 방지 검증

- `node --test scripts/seed/apply.test.mjs`: 운영 대상 거부를 통과했다.
- `pnpm seed:generate:local`: 임시 테스트 키로 15명/61회차를 생성하고 게이트웨이 캡처와 재생 대조를 통과했다.
- 생성한 `preload.sql`과 `seed.sql` 전체를 최소 운영 보존 상태의 별도 D1에 각각 적용했다. 둘 다 거부됐고 사용자 2명, 당사자 0명 상태와 스키마가 유지됐다.
- 같은 SQL 전체를 새 미리보기 D1에 순서대로 적용해 15케이스/61회차와 외래키 위반 0건을 확인했다. 실제 원격 미리보기에는 적용하지 않았다.
- `pnpm test:scripts`: 27개 통과. `pnpm guard:db` 통과.

지원 대상은 로컬 미리보기와 `ccc-preview`로 제한했다. 원시 DB 관리자 권한으로 SQL을 수정하거나 직접 실행하는 행위까지 막는 접근제어는 아니다. 상세 계약은 [시드 RUNBOOK](../../scripts/seed/RUNBOOK.md)에 둔다.

## 베타 시작 경로

`account@bss.or.kr`로 [운영 초기 설정](https://ccc.account-855.workers.dev/onboarding)에 로그인해 기관명과 사업명을 입력한다. 기존 설정에서 두 이름은 NULL로 남아 있다. 이어서 관리자 화면의 직원 **직접 등록**을 사용한다. 직원은 Cloudflare Access 정책에도 허용된 이메일이어야 한다.

링크 초대는 `PUBLIC_SIGNUP_ENABLED`를 당사자 공개 가입과 공유하므로 이번 초기화에서는 열지 않았다. 직접 등록은 이 스위치 없이 동작한다.

이 기록은 내부 베타 초기화의 실행 증거다. 실제 당사자 개인정보 운영에 필요한 기존 동의 및 보안 검토를 완료했다는 뜻은 아니다.
