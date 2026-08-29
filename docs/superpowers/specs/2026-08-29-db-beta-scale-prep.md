# DB 베타 스케일 준비 스펙(사용자 1,000명, 인당 데이터 1,000건)

- 상태: 준비 스펙 (2026-08-29 작성, 구현 착수 전. 결정 포인트는 Q 확인 후 확정)
- 관계: D7·D74, D14, D65(ADR-0035), R1

## 배경

현재 마이그레이션 헤드는 `0044_assignment_lifecycle.sql`이다. D65는 D1(Cloudflare)을 지금 대체하지 않고 로컬 우선으로 두며, PostgreSQL 이전은 실운영 전 준비만 하도록 정했다(`docs/adr/0035-contest-scope-and-deployment-doors.md:78-92`). 따라서 베타 규모 검증은 SQLite 방언과 D1 바인딩을 유지한 채 로컬 `wrangler d1`에서 수행한다. 로컬 마이그레이션, 시드 생성, 적재 순서는 `docs/ops.md:79-101`에 있다.

현행 목록 조회는 대부분 `LIMIT` 없이 `.all()` 결과를 전부 메모리에 올린다. 이 사실은 단순한 UI 지연 문제가 아니라 D1 rows_read 비용, Worker 직렬화 메모리, 30초 쿼리 한도에 동시에 영향을 준다. `listTextWorkItems`만 조회에 `LIMIT 50`을 둔 예외다.

근거로 다시 연 파일은 다음과 같다.

- `db/gateway.ts:5839` `listCases`, `:7657` `listSessions`, `:8189` `listAuditLog`
- `db/gateway.ts:6032` `listAssignees`, `:6202` `listGoals`, `:7924` `listOpenActionItems`, `:8030` `listFlags`, `:8372` `listUsers`
- `db/gateway.ts:7271` `listPipelineJobs`, `:10084` `listPrivacyConsentFollowUps`, `:10153` `listEmergencyConsentDeadlines`
- `db/gateway.ts:10509` `listAuthorizedSupportCaseIdsForBeneficiary`, `:10688` `listSupportCasesForBeneficiary`, `:11019` `listAssignedParticipants`, `:11155` `listNewSignupBeneficiaryIds`
- `db/gateway.ts:12099` `listParticipantPiiRetentionReviews`, `:12702` `listScheduleCandidates`, `:15318` `listCounselingRecords`
- `db/gateway.ts:16508` `listSupportCaseAssignees`, `:16535` `listMySupportCaseAssignmentRequests`, `:16603` `listCounselorAssignments`
- 추가 확인 대상인 `db/gateway.ts:3336` `listPilotTextAiConsentEvidence`와 `:5756` `listRecordErrorSessionIds`도 `LIMIT` 없는 `.all()`을 사용한다.

`audit_log`는 `migrations/0001_init.sql:270-306`에서 추가 전용 트리거만 정의하고, 현행 인덱스는 `case_id`와 `actor_id` 선두다. `migrations/0006_participant_support_case_cutover.sql:1320-1362`에서 `beneficiary_id`, `support_case_id`, `actor_id` 선두 인덱스가 추가됐지만 `(org_id, created_at)` 선두 인덱스와 보존·아카이브 정책은 없다. `ai_masked_source_snapshots`는 같은 파일 `:1343-1346`의 `(org_id, support_case_id, session_id, created_at DESC)` 인덱스에 의존해 session 단독 탐색에는 불완전하다. `invite_tokens`에는 `expires_at`이 없고 수명 정책을 보류한다(`migrations/0021_invite_tokens.sql:19-22`).

## 1. 규모 모델

아래 숫자는 실데이터 추정이 아니라 베타 부하를 재현하기 위한 시드 모델이다. “사용자 1,000명, 인당 데이터 1,000건”을 상담사 또는 당사자 사용자당 세션성 기록 1,000건으로 해석한다. 케이스는 사용자당 하나를 기본값으로 두되, 조직별 다중 사업을 반영할 때 별도 계수로 늘린다.

| 표 | 산정식 | 베타 예상 행수 | 모델에서의 의미 |
| --- | --- | ---: | --- |
| `users` | 1,000명 | 1,000 | 기관별 관리자·실무자 포함. 역할 비율은 시드 파라미터다. |
| `beneficiaries` | 사용자당 1명 | 1,000 | PII는 합성값만 사용한다. |
| `support_cases` | 사용자당 1개 | 1,000 | 다중 사업 계수 1을 기본값으로 둔다. |
| `sessions` | 1,000명 × 1,000건 | 약 1,000,000 | 핵심 목록·정렬·조인 부하의 기준이다. |
| `action_items` | 세션당 1-3건 | 약 1,000,000-3,000,000 | 미해결 비율을 별도 파라미터로 둔다. |
| `flags` | 세션당 0.5-2건 | 약 500,000-2,000,000 | pending·confirmed·rejected 비율을 분리한다. |
| `goals` | 케이스당 3개까지 | 약 3,000 | 목표 이력과 종료 목표는 추가 계수로 만든다. |
| `counseling_schedules` | 세션당 1건 | 약 1,000,000 | 완료·취소·예정 상태를 섞는다. |
| `support_case_assignees` | 케이스당 활성 1-2행과 이력 | 약 2,000-5,000 | 이관 이력으로 행이 늘어나는 모델이다. |
| `audit_log` | 세션당 감사 이벤트 3-10건 + 관리 이벤트 | 약 3,000,000-10,000,000 | D14 열람·변경·승인·복호화 이벤트를 모두 세며, 수백만 행을 기본 위험 구간으로 본다. |
| `ai_masked_source_snapshots` | 세션당 최소 1건 | 약 1,000,000 이상 | 재처리와 버전 보존으로 세션당 여러 건이 될 수 있다. |
| `ai_masked_source_evidence_items` | snapshot당 3건 이상 | 약 3,000,000 이상 | snapshot보다 커지는 자식 행이다. |
| AI draft·review·evidence 표 | 세션당 여러 버전과 검토 이벤트 | 1,000,000 이상 | 버전·재검토를 삭제하지 않는 구조를 반영한다. |

예상 행수는 업무 이벤트 횟수와 보존 기간에 비례하며, 행 폭은 `detail`, 전사 마스킹 텍스트, JSON 증적의 길이에 따라 크게 달라진다. 그러므로 행수만으로 용량을 확정하지 않고 시드 적재 뒤 실제 `databaseSizeBytes`, 행 폭 표본, 직렬화 응답 크기를 측정한다. 특히 snapshots와 evidence는 append-only 성격과 재처리 버전 때문에 세션 수보다 커질 수 있다.

위 모델은 D7 접근 범위와 D74 역할 구분을 유지한다. 쿼리는 항상 `org_id`와 현재 행위자의 담당 범위를 함께 제한해야 하며, 페이지네이션이 권한 필터를 대신하지 않는다. R1의 공용 gateway 관문 밖에서 목록 SQL을 추가하지 않는다.

## 2. D1 공식 한도와 위험 대조

2026-08-29에 Cloudflare 공식 문서를 다시 확인했다. 수치는 요금제와 문서 개정에 따라 변할 수 있으므로 구현 착수 직전에 URL을 재확인한다.

| 항목 | 공식 수치 또는 공식 설명 | 출처 |
| --- | --- | --- |
| 데이터베이스 크기 | Workers Paid 10 GB, Free 500 MB. 개별 DB 10 GB는 상향할 수 없다. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| 테이블 행 수 | 별도 상한 없음. 개별 DB 저장 한도와 다른 플랫폼 한도의 적용을 받는다. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| 쿼리당 rows_read 과금 | Free 500만 행/일, Paid 월 250억 행 포함 후 100만 행당 $0.001. rows_read는 반환 행이 아니라 스캔한 행 수다. | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| 응답 크기 | D1 Limits에는 전체 결과 집합의 별도 최대 응답 바이트 또는 최대 반환 행 수가 기재돼 있지 않다. 대신 문자열·BLOB·테이블 행 하나는 2,000,000 bytes이며 쿼리 실행과 결과 직렬화는 Workers CPU·메모리 한도 안에서 수행된다. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| 응답 관측 | `queryBatchResponseBytes`는 컬럼명·행·메타데이터를 포함한 직렬화 응답 크기다. D1 metrics는 31일간 보관된다. | [D1 Metrics and analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/) |
| 요청·쿼리 시간 | 최대 SQL 쿼리 시간은 30초다. Cloudflare API 요청은 30초 안에 끝나야 하므로 batch 전체에도 적용된다. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Worker 호출당 쿼리 수 | Workers Paid 1,000, Free 50. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| 동시 D1 연결 | Worker invocation마다 최대 6개다. | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) |

| 위험 | 현재 규모 모델과의 대조 | 위험도 | 준비 단계 대응 |
| --- | --- | --- | --- |
| DB 저장 한도 | audit 3-10M, snapshots·evidence 4M 이상과 JSON·텍스트 폭이 누적된다. 10 GB의 실제 여유를 행 폭 측정 전에는 판단할 수 없다. | 높음 | 시드 후 `databaseSizeBytes`와 표별 크기를 측정하고 10 GB보다 충분한 운영 여유를 정한다. Free 500 MB는 베타 전체 모델에 부적합할 수 있다. |
| rows_read·비용 | org 필터와 정렬 인덱스가 없으면 수백만 행을 매번 스캔한다. 반환량이 50이어도 스캔량은 전체 표가 될 수 있다. | 높음 | keyset pagination, org 선두 복합 인덱스, D1 meta의 `rows_read` 기록을 함께 적용한다. |
| 응답·직렬화 메모리 | 전체 `.all()` 결과는 결과 배열과 JSON 직렬화를 동시에 키울 수 있다. 전체 응답의 고정 상한이 문서에 없으므로 1M 세션을 한 번에 반환하지 않는다. | 높음 | 기본 50행 페이지, 필요한 컬럼만 선택, `queryBatchResponseBytes` 관찰, 2 MB 개별 행 초과 방지. |
| 30초 요청 한도 | counseling record·one-page처럼 여러 조회를 병렬 실행하는 경로는 합산 결과와 직렬화 시간이 길어질 수 있다. | 중간-높음 | 대표 쿼리 p95와 D1 duration을 분리 측정하고 30초에 가까운 쿼리는 즉시 실패 대상으로 둔다. |
| Free rows_read 일일 한도 | 500만 행/일은 인덱스가 없는 몇 차례 full scan으로 소진될 수 있다. | 높음 | 부하 시험은 로컬에서 하고, 실운영은 요금제와 조직별 월별 rows_read 예산을 Q에서 정한다. |
| 단일 DB 직렬 처리 | D1 한 DB는 쿼리를 한 번에 하나씩 처리한다. 동시 기관 요청은 지연과 overloaded 오류를 만들 수 있다. | 중간-높음 | p95에 동시성 시나리오를 포함하고, 긴 목록보다 짧은 페이지와 인덱스를 우선한다. |

## 3. 페이지네이션 계약

### 3.1 공통 keyset cursor

모든 사용자 노출 목록과 운영 목록은 `page`·`offset`을 계약으로 추가하지 않고 keyset cursor를 사용한다. 첫 요청은 cursor 없이 보내며 기본 `pageSize=50`으로 조회한다. `pageSize`는 1 이상 50 이하만 허용하고 50을 초과하면 400으로 거절한다. 서버가 임의로 큰 값을 받아 메모리 한도를 넘기지 않게 한다.

정렬은 화면이 요구하는 기존 순서를 보존하되 동률을 피할 고유 키를 반드시 붙인다.

- 오름차순: `(created_at ASC, id ASC)`
- 내림차순: `(created_at DESC, id DESC)`
- 화면이 `held_at`, `due_date`, `scheduled_at`, `assigned_at`처럼 다른 날짜를 쓰면 `(화면 정렬키, id)`를 사용한다.
- 같은 정렬키에서 다음 페이지 조건은 오름차순이면 `sort_key > last_sort_key OR (sort_key = last_sort_key AND id > last_id)`, 내림차순이면 부등호를 반대로 한다.
- cursor는 `{sortKey, id}`만 담은 opaque base64url 값으로 주고 PII, SQL, org 식별자를 담지 않는다. 서버는 디코드한 cursor의 형식, 정렬 버전, 현재 org와 권한 범위를 다시 검증한다.
- 응답은 기존 배열을 바로 깨지 않도록 전환 계획에서 `results`와 `nextCursor`를 함께 제공하는 형식으로 정한다. `nextCursor`가 `null`이면 마지막 페이지다. 실제 API 타입 변경과 호출부 전환은 구현 단계에서 한 번에 한다.
- 페이지를 넘겨도 D7 담당 범위와 D14 조회 감사 규칙은 동일하다. 감사는 목록 호출당 기존 정책의 1건 원칙을 유지하고 cursor 자체는 detail에 넣지 않는다.

### 3.2 전수 대상 목록 함수

다음 표는 `db/gateway.ts`에 대해 `grep`으로 `export async function list...` 선언과 `.all()` 호출을 다시 확인한 결과다. 선언 라인은 현재 워크트리 기준이다. `listTextWorkItems`는 `LIMIT 50`이 있는 유일한 bounded 예외이며, 나머지는 함수 안에 `LIMIT` 없는 `.all()`이 적어도 하나 있다. 내부 보조 조회가 있는 함수는 전체 함수의 목록 반환량을 제한하는 페이지네이션 단위로 전환한다.

| 함수와 현재 선언 라인 | 현재 범위·정렬 | 페이지 키 후보 | 구현 대상 |
| --- | --- | --- | --- |
| `listPilotTextAiConsentEvidence` `:3336` | 케이스별 증적, `effective_at DESC` | `effective_at, id` | 예 |
| `listRecordErrorSessionIds` `:5756` | 케이스별 오류 세션 ID | `id` | 예 |
| `listCases` `:5839` | 기관 또는 담당자 케이스, `id` | `id` | 예 |
| `listAssignees` `:6032` | 케이스 담당 이력, `assigned_at` | `assigned_at, id` | 예 |
| `listGoals` `:6202` | 케이스 목표, `created_at` | `created_at, id` | 예 |
| `listTextWorkItems` `:6987` | 서비스 큐, 현재 `LIMIT 50` | `created_at, id` | 기존 상한 검토만 |
| `listPipelineJobs` `:7271` | 기관 파이프라인 큐, `updated_at` | `updated_at, id` | 예 |
| `listSessions` `:7657` | 케이스 세션, `held_at DESC` | `held_at, id` | 예 |
| `listOpenActionItems` `:7924` | 케이스 미해결 액션, `due_date, created_at` | `due_date, created_at, id` | 예 |
| `listFlags` `:8030` | 케이스 플래그, `created_at DESC` | `created_at, id` | 예 |
| `listAuditLog` `:8189` | 기관 또는 필터 케이스·행위자 감사, `id` | `id` 또는 `created_at, id` | 예 |
| `listUsers` `:8372` | 기관 사용자, `email` | `email, id` | 예 |
| `listPrivacyConsentFollowUps` `:10084` | 기관 동의 후속 대상, 정책 정렬 | `review_due_at, beneficiary_id` | 예 |
| `listEmergencyConsentDeadlines` `:10153` | 기관 긴급 동의 기한 | `deadline, org_id` | 예 |
| `listAuthorizedSupportCaseIdsForBeneficiary` `:10509` | 당사자 접근 가능 케이스 ID | `created_at, id` 또는 `id` | 예 |
| `listSupportCasesForBeneficiary` `:10688` | 당사자 허브 케이스, 상태·사업·id 정렬 | `status_rank, program_type, id` | 예 |
| `listAssignedParticipants` `:11019` | 담당 범위 당사자, `beneficiary` 정렬 | `beneficiary_id` | 예 |
| `listNewSignupBeneficiaryIds` `:11155` | 신규 가입 당사자 ID 집합 | `created_at, beneficiary_id` | 예 |
| `listParticipantPiiRetentionReviews` `:12099` | 기관 보존 검토 큐, `review_due_at, beneficiary_id` | `review_due_at, beneficiary_id` | 예 |
| `listScheduleCandidates` `:12702` | 일정 등록 후보, 당사자·생성일 정렬 | `beneficiary_id, created_at, id` | 예 |
| `listCounselingRecords` `:15318` | 당사자·케이스 기록과 연관 표 | 주 목록은 `held_at DESC, id DESC` | 예 |
| `listSupportCaseAssignees` `:16508` | 케이스 담당자, `assigned_at, id` | `assigned_at, id` | 예 |
| `listMySupportCaseAssignmentRequests` `:16535` | 실무자 배정 요청, `assigned_at, id` | `requested_at, id` | 예 |
| `listCounselorAssignments` `:16603` | 실무자별 당사자 배정, 케이스 정렬 | `assigned_at, id` | 예 |

`listCounselingRecords`와 `listSessions`처럼 한 화면을 구성하려고 여러 표를 함께 읽는 함수는 주 목록에만 cursor를 적용하면 자식 조회가 다시 무제한이 된다. 구현 시 자식 데이터도 주어진 페이지의 session 또는 case ID 집합에 한정하거나, 별도 페이지 계약을 둔다. 기존 화면의 무한 스크롤, 더보기 버튼, 페이지 번호와 같은 UI 선택은 이 스펙의 범위 밖이다. 이 단계의 범위는 gateway 계약과 호출부가 페이지를 전달·소비할 수 있게 하는 것이다.

## 4. 인덱스 후보와 확정 절차

후보는 현재 인덱스가 없는 `org_id` 선두를 보강하되, 동일 표에 중복 인덱스를 만들지 않도록 기존 `support_case_id` 선두 인덱스와 `EXPLAIN QUERY PLAN` 결과를 비교해 확정한다.

| 표 | 후보 인덱스 | 겨냥하는 조건·정렬 | 주의 |
| --- | --- | --- | --- |
| `audit_log` | `(org_id, created_at, id)` | 기관 전체 시간순 감사 목록과 cursor | D14 append-only라 쓰기 비용을 측정한다. |
| `audit_log` | `(org_id, support_case_id, id)` | 기관·케이스별 감사 필터 | 기존 case 선두 인덱스와 중복 여부를 확인한다. |
| `sessions` | `(org_id, ai_status, updated_at, id)` | 기관 큐와 상태 필터 | 상태별 partial index가 더 나은지 비교한다. |
| `sessions` | `(org_id, support_case_id, held_at DESC, id DESC)` | 케이스 세션 페이지 | 현재 support-case 선두 인덱스와 rows_read를 비교한다. |
| `ai_masked_source_snapshots` | `(org_id, session_id, created_at DESC, id DESC)` | session 단독 최신 snapshot | 기존 `(org_id, support_case_id, session_id, created_at DESC)`의 공백을 보완한다. |
| `action_items` | `(org_id, support_case_id, resolved_at, due_date, created_at, id)` | 미해결 케이스 목록과 정렬 | `resolved_at IS NULL` partial index와 비교한다. |
| `flags` | `(org_id, support_case_id, review_status, created_at DESC, id DESC)` | 케이스·검토 상태별 플래그 | rejected 제외 경로를 별도 partial 후보로 비교한다. |
| `goals` | `(org_id, support_case_id, created_at, id)` | 케이스 목표·이력 | 기존 support-case 인덱스에 org 선두가 없는 점을 확인한다. |
| `counseling_schedules` | `(org_id, scheduled_at, id)` | 기관 일정 창 조회 | 날짜 범위와 상태 필터의 선택도를 측정한다. |
| `counseling_schedules` | `(org_id, support_case_id, scheduled_at, id)` | 케이스 일정·완료 세션 연결 | 위 기관 전체 후보와 함께 비교한다. |
| `support_case_assignees` | `(org_id, support_case_id, unassigned_at, assigned_at, id)` | 케이스 활성·이력 담당자 | 0044의 상태 인덱스와 중복·선택도를 확인한다. |
| `support_case_assignees` | `(org_id, user_id, unassigned_at, assigned_at, id)` | 실무자 담당 케이스·당사자 | 현재 user 선두 partial 인덱스와 비교한다. |

확정 절차는 다음 순서를 지킨다.

1. 인덱스 후보가 없는 기준 DB를 동일한 시드로 만들고 대표 SQL에 `EXPLAIN QUERY PLAN`을 실행한다.
2. 후보 migration을 로컬 D1에 적용하고 같은 바인딩·같은 SQL·같은 데이터로 다시 실행한다. 출력에서 대형 표의 `SCAN`이 남는지, `SEARCH ... USING INDEX` 또는 동등한 covering plan이 나오는지 기록한다.
3. keyset 첫 페이지와 중간 cursor 페이지를 각각 측정한다. `ORDER BY`를 임시 sort하지 않고 인덱스 순서를 사용하는지 확인한다.
4. D1 binding 결과의 `meta.rows_read`, duration, 테스트 하네스의 p50·p95를 전후 비교한다. rows_read가 감소하지 않거나 쓰기 비용이 합격선을 넘으면 후보를 채택하지 않는다.
5. 채택 인덱스만 migration으로 고정하고, 기존 인덱스 제거는 실제 사용처와 rollback 절차를 확인한 뒤 별도 Q 승인 대상으로 둔다.

## 5. audit_log 수명과 보존 선택지

D14의 `audit_log` 추가 전용 원칙은 바꾸지 않는다. `migrations/0001_init.sql:295-306`의 UPDATE·DELETE 차단 트리거와 R1 gateway 기록 관문은 어느 선택에서도 유지한다. 보존 연한은 현재 결정되지 않았으므로 아래 선택지는 제안이며 확정 정책이 아니다.

| 선택지 | 장점 | 단점·위험 |
| --- | --- | --- |
| D1 한 표에 계속 보존 | 조회·권한·감사 경로가 단순하고 D14 불변 표를 하나만 유지한다. | 수백만 행이 누적돼 rows_read, 저장 공간, 인덱스 쓰기 비용이 계속 증가한다. 운영 목록에는 반드시 시간 범위와 cursor가 필요하다. |
| 월별 논리 표로 분리 | 오래된 월을 현재 hot table에서 분리해 최근 조회와 보존 작업을 작게 만들 수 있다. | SQLite migration과 gateway 라우팅이 복잡해지고 모든 월 표의 append-only 트리거·권한·조회 일관성을 유지해야 한다. 월별 분할이 실제 D1 저장·rows_read 한도를 해결하는지는 측정이 필요하다. |
| 외부 불변 저장소로 이전 | D1 용량과 hot query 부담을 줄이고 장기 보존 저장소의 정책을 따로 둘 수 있다. | D14의 원본성, 무결성 해시, 복호화 없는 검색, 접근 감사, 복구·삭제 요청과 외부 수탁자 법률 검토를 새로 정해야 한다. 외부 저장소를 정본으로 인정할지 미정이다. |

실행 시 어떤 선택이든 다음 불변 조건을 둔다. 이미 기록된 audit 행을 UPDATE·DELETE하지 않으며, 이동이 있다면 원본 ID·org·created_at·행위자·action·target·해시와 이동 감사 이벤트를 남긴다. 보존 만료와 아카이브 이전은 자동 파기와 같지 않으며, 법률상 파기 근거가 없는 상태에서 구현하지 않는다.

## 결정 포인트 (Q 확인 대상)

1. **보존 연한**: D14 감사 목적과 법률·기관 규정에 맞는 기간을 정한다. 제안값으로 5년 또는 7년을 비교할 수 있으나 Q 승인 전에는 기본값으로 코드화하지 않는다.
2. **아카이브 정본**: D1에 계속 보존할지, 월별 분리할지, 외부 불변 저장소로 이전할지 결정한다. 외부 저장소 선택 시 제공자와 수탁자 지위, 접근 주체, 해시 검증, 복구·파기 절차를 함께 승인한다.
3. **요금제와 예산**: Free 500만 rows_read/일을 베타에 허용할지, Paid 사용과 기관별 rows_read·storage 예산을 어떻게 둘지 결정한다.
4. **페이지 응답 형태**: 기존 배열을 `results`·`nextCursor` envelope로 바꾸는 시점과 하위 호환 기간을 정한다. page size 50 상한은 안전 기본값으로 제안하며 화면 상호작용은 Q가 별도로 고른다.
5. **다중 사업 계수**: 사용자당 케이스 수를 1보다 크게 모델링할지 정한다. 결정되면 cases, assignments, schedule의 시드 계수를 함께 조정한다.
6. **snapshot·evidence 보존**: 재처리 버전과 증적을 몇 세대까지 유지할지 결정한다. 삭제나 덮어쓰기는 append-only 무결성 및 AI 근거 추적과 충돌할 수 있어 보존 정책 없이 구현하지 않는다.

## 6. 측정 하네스 설계

### 6.1 합성 시드

`scripts/seed/`의 기존 `generate.ts`와 vitest 설정을 확장하는 설계만 이번 문서에 둔다. 현행 실행 위치와 적재 순서는 `docs/ops.md:88-101`을 따른다. 실제 코드는 구현 단계에서 작성한다.

- 고정 seed 값을 받는 결정적 PRNG를 사용해 UUID, 날짜, 상태, 조직 분포를 재현한다.
- 1,000명의 합성 사용자와 1,000명의 합성 당사자, 사용자당 1개 케이스를 만든다. 각 사용자에게 세션 1,000건을 균등하게 배정해 `sessions` 약 1,000,000행을 만든다.
- 세션마다 action item 1-3건, flag 0.5-2건, schedule 1건, snapshot 최소 1건, snapshot당 evidence 3건을 확률 파라미터로 생성한다. audit 이벤트는 세션당 3-10건과 관리 이벤트를 생성한다.
- 모든 이름·연락처·전사·인용은 `SYNTHETIC_*` 규칙의 가상값만 사용한다. 실데이터, 실제 이메일, 실제 음성, API 키는 시드와 로그에 넣지 않는다.
- timestamp는 최근 24개월 범위에 분산하고, `created_at` 동률을 의도적으로 만들어 `(sort_key, id)` tie-breaker를 검증한다. 한 조직에 데이터가 몰리는 worst case와 10개 조직에 분산된 일반 case를 각각 만든다.
- seed output은 기존 `scripts/seed/out/` 절차를 사용한다. 실행 전 로컬 DB를 초기화하고 migrations 0001부터 0044까지 적용해 schema drift를 막는다.

### 6.2 대표 쿼리 10개

아래는 실제 gateway 경로를 대표하는 읽기 시나리오다. 각 쿼리는 첫 페이지와 중간 cursor 페이지를 모두 측정하고, 권한 범위가 다른 관리자·담당자 케이스를 별도로 실행한다.

1. `listCases`: 기관 전체 케이스 목록과 담당자 제한 케이스 목록.
2. `listSessions`: 한 케이스의 최신 세션 50건.
3. `listAuditLog`: 기관 전체 최근 감사와 케이스 필터 감사.
4. `listAssignedParticipants`: 담당자 또는 기관 관리자 당사자 목록.
5. `listCounselingRecords`: 한 당사자의 케이스 기록 주 페이지와 연관 목표·액션·플래그.
6. `listScheduleCandidates`: 기관의 활성 상담 등록 후보.
7. `listOpenActionItems`: 한 케이스의 미해결 액션 정렬 목록.
8. `listFlags`: 한 케이스의 rejected 제외 플래그 목록.
9. `listGoals`: 한 케이스 목표와 이력 목록.
10. `listSupportCasesForBeneficiary`: 당사자 허브의 접근 가능 케이스 목록.

### 6.3 p50·p95 절차와 합격선 제안

1. 로컬 `ccc-local` DB에 동일 migration과 합성 시드를 적재한다. 테스트 명령은 레포 루트에서 seed를 생성하고, `apps/api`에서 `pnpm exec wrangler d1 execute ccc-local --local`로 preload와 seed SQL을 적용하는 현행 절차를 따른다.
2. API 또는 gateway 호출을 준비한 뒤 각 쿼리마다 5회 warm-up을 버린다. 같은 입력으로 30회 이상 측정하고, cold 첫 요청 5회와 warm 측정값을 구분한다.
3. 호출 시간은 `performance.now()`로 측정하고, 각 D1 결과의 `meta.rows_read`, `meta.rows_written`, `meta.duration`과 응답 행 수를 함께 기록한다. 응답 직렬화 크기는 가능한 경우 D1 `queryBatchResponseBytes` metrics와 맞춰 기록한다.
4. 측정값을 오름차순으로 정렬해 p50은 50번째 백분위, p95는 95번째 백분위로 계산한다. 첫 페이지와 중간 cursor, 관리자 전체 범위와 담당자 제한 범위를 서로 섞지 않는다.
5. 순차 실행 외에 동시 요청 5개와 20개를 한 번씩 실행해 D1 단일 스레드 큐의 overloaded·tail latency를 기록한다. 실패율과 오류 문자열도 결과에 남긴다.

초기 합격선 제안은 다음과 같다. 실제 운영 SLO와 요금제는 Q 승인 후 확정한다.

- 단일 목록 첫 페이지·cursor 페이지 p95: 250 ms 이하.
- 여러 자식 조회를 포함하는 `listCounselingRecords` p95: 500 ms 이하.
- 50행 목록의 indexed query `rows_read`: 반환 행의 2배 이하를 목표로 하며, 권한·조인 특성상 초과하면 `EXPLAIN QUERY PLAN` 근거를 기록한다.
- 단일 응답 직렬화 크기: 1 MB 이하를 안전 목표로 둔다. 이는 D1 공식 전체 응답 상한이 아니라 메모리 여유를 위한 제안이다.
- 대표 쿼리 10개의 30초 초과 0건, SQL 오류 0건, cursor 중복·누락 0건.
- 합성 DB 저장 크기는 Paid 10 GB 한도에 도달하기 전에 표별 증가율과 운영 보존 기간을 설명할 수 있어야 한다. Free 500 MB를 넘으면 Free에서 계속 검증하지 않는다.

## 7. 구현 단계 분할

### (a) 인덱스 migration

- 후보 표의 현재 인덱스와 중복을 확인한 뒤 `org_id` 선두 복합 인덱스만 migration으로 추가한다.
- 완료 기준: 대상 SQL 전부에 대해 `EXPLAIN QUERY PLAN` 결과와 before·after `rows_read`를 남기고, 대형 목록의 불필요한 full scan이 제거되거나 사유가 기록된다. migration을 0001부터 0044 이후 최신 상태에 재적용할 수 있고, pre-commit 문서·번호 가드를 통과한다.

### (b) gateway keyset pagination

- 위 전수 표의 모든 unbounded 목록 함수에 cursor와 1-50 page size 검증을 붙인다. `listTextWorkItems`의 기존 50 상한은 회귀 없이 유지한다.
- **호출부 화면 수정 포함**: API envelope와 cursor를 소비하도록 `apps/api/src/request-handler.ts`, `apps/web/app/lib/api.ts`, 해당 목록 화면과 타입을 함께 전환한다. 화면에서 무한 스크롤을 쓸지 더보기 버튼을 쓸지는 이 단계의 결정 대상이 아니지만, 호출부가 cursor를 버려 다시 전체 조회하는 상태는 완료로 보지 않는다.
- 완료 기준: 각 함수의 첫 페이지·중간 페이지·마지막 페이지에서 중복과 누락이 없고, 다른 org나 다른 담당 범위의 행이 cursor 조작으로 노출되지 않는다. 기존 호출부가 새 계약을 사용하며 목록 응답이 50행을 넘지 않는다.

### (c) 합성 시드와 측정

- `scripts/seed/`에 결정적 1,000 × 1,000 시드와 대표 쿼리 측정 러너를 추가한다. 로컬 `wrangler d1`만 사용하고 실데이터를 금지한다.
- 완료 기준: 같은 seed 입력이 같은 행수와 같은 분포를 만들고, 대표 쿼리 10개의 p50·p95, rows_read, duration, 응답 크기, 오류율을 한 번에 재현할 수 있다. 제안 합격선을 넘지 못한 쿼리는 원인과 다음 인덱스·쿼리 조정안을 기록한다.

### (d) audit 수명 정책 구현

- Q가 보존 연한, D1 유지 여부, 월별 분리 또는 외부 저장소, 정본·복구·파기 의미를 확정한 뒤에만 migration과 archive job을 구현한다. D14 append-only 트리거와 R1 기록 관문은 그대로 둔다.
- 완료 기준: 정책 승인 참조가 문서와 구현 설정에 연결되고, 보존 만료·이전·복구 각 단계가 별도 감사 이벤트로 관찰된다. UPDATE·DELETE로 기존 감사 행을 지우지 않으며, 아카이브 검증 실패 시 원본을 변경하지 않고 fail closed한다.
