# E5-1a Agent 작업 계약 v2 구현 계획

**목표:** S5의 audio/text 작업을 하나의 영속 상태기계로 합치고, 처리 Agent를 claim 기반 v2 API로 완전 전환한다.

**결정:** `agent_jobs`가 claim, lease, heartbeat, release, result CAS와 두 큐 공정성의 단일 정본이다. 기존 `sessions`와 `ai_text_work_queue`는 업무 원본과 과거 이력을 보존하지만 새 처리 상태를 소유하지 않는다. v1 서비스 경로와 400 레거시 페이로드 재시도는 제거한다.

**범위 밖:** Azure SDK 호출, Supabase signed GET, 실제 NER 판정과 release qualification 발급, 여섯 동의 영역 구현, AudioStore 삭제 조정의 실구현은 각 후속 티켓이 소유한다. E5-1a는 이 경계를 계약에 고정하고 미구현 의존성이 필요한 경로를 fail-closed 한다.

## Task 1: v2 계약과 저장 구조

**Files**
- Create: `packages/contracts/src/agent-jobs.ts`
- Modify: `packages/contracts/package.json`
- Create: `migrations/sqlite/0048_agent_jobs.sql`
- Modify: `CCC_OPEN_PILOT_PLAN.md`
- Modify: `docs/specs/S7-consent-six-domains.md`
- Create: `apps/api/test/agent-job-contract.test.ts`

1. S5 F1, F2, F3의 claim, 공정성, heartbeat, release 기대값을 실패 테스트로 먼저 작성한다.
2. S5의 DTO, 상태, 오류 literal, strict parser를 `@ccc/contracts/agent-jobs`에 추가한다.
3. `agent_jobs`와 결과, dictionary, Azure egress의 최소 영속 필드를 SQLite migration으로 추가한다. claim token은 원문이 아니라 SHA-256만 저장한다.
4. 기존 미완료 audio/text 작업을 backfill하고 새 업무 생성 시 `agent_jobs`도 같은 batch에서 만들 수 있는 키와 제약을 둔다.
5. SQLite `0048`을 사용하므로 아직 미구현인 consent와 audio 예약 번호를 각각 `0049`, `0050`으로 옮긴다. PostgreSQL 번호는 E3-4 baseline이 이 표를 흡수하므로 바꾸지 않는다.

## Task 2: 코어 상태기계

**Files**
- Modify: `packages/core/src/gateway.ts`
- Modify: `apps/api/test/agent-job-contract.test.ts`

1. 기존 exported pipeline 함수의 LSP references를 확인한다.
2. 두 queue head를 `enqueued_at, job_id`로 읽고 audio/text를 엄격히 교대하는 순수 선택 함수를 추가한다.
3. claim 후보 복구, 동의와 route/engine gate, attempt 상한, claim token hash 저장을 한 `Database.batch()` 경계로 처리한다.
4. heartbeat, transient/blocked/permanent release, 자연 만료 recovery를 `jobId, orgId, claim token hash, attempt` CAS로 구현한다.
5. result는 JCS payload hash와 evidence hash를 검증하고 snapshot 저장, job terminal 전환, 기존 session/text 원본 상태 반영을 한 batch로 처리한다.
6. 동일 payload hash는 `204`, 다른 hash는 `result_conflict`, 옛 claim은 `stale_claim`, 아직 clear되지 않은 자연 만료 claim은 `lease_expired`로 구분한다.

## Task 3: HTTP v2와 접근 경계

**Files**
- Modify: `packages/http-api/src/request-handler.ts`
- Create: `apps/api/test/agent-job-contract.modes.test.ts`
- Modify: 관련 identity 또는 access 테스트

1. S5 F4부터 F8까지 동의 철회, 중복 결과, bounded retry, NER fail-closed, 세 모드 전달과 actor 교차 접근 테스트를 먼저 작성한다.
2. `POST /pipeline/jobs/claim`과 claim-bound heartbeat, release, source, mask dictionary, audio verify, egress authorize/in-flight, result 라우트를 추가한다.
3. 모든 job route는 service actor와 scope를 요구하고 사람 actor를 거부한다. service actor의 업무 API 접근 거부도 고정한다.
4. Local 두 모드는 no-store API stream, Community Cloud는 signer가 없으면 fail-closed 한다.
5. `/pipeline/text-jobs/**`와 service용 `/sessions/:id/ai/source`를 allowlist에서 제거한다.

## Task 4: Python Agent 완전 전환

**Files**
- Modify: `apps/pipeline/ccc_pipeline/api_client.py`
- Modify: `apps/pipeline/ccc_pipeline/worker.py`
- Modify: `apps/pipeline/ccc_pipeline/repetition.py`
- Modify: `apps/pipeline/tests/test_api_client_worker.py`
- Modify: `apps/pipeline/tests/test_worker_transcript_quality.py`

1. API client가 v2 claim 응답만 받고 모든 후속 요청에 claim token과 attempt를 보내도록 테스트를 바꾼다.
2. worker가 claim 순서를 그대로 처리하고 live claim마다 성공 `result` 또는 실패 `release` 하나만 보내게 한다.
3. text 작업은 source를 받아 마스킹한 뒤 `TextResult` 하나로 제출한다. 별도 snapshot/complete 호출을 삭제한다.
4. audio 작업은 전달 bytes를 해시 검증한 뒤 configured engine만 한 번 호출한다. provider 또는 engine 자동 전환은 두지 않는다.
5. generic 400 재시도, legacy warning 삽입, v1 client 메서드를 삭제한다.

## Task 5: 문서와 검증

**Files**
- Modify: `docs/api-contract-pipeline.md`
- Modify: 필요한 package 또는 test-suite 설정

1. 운영 API 문서를 v2 endpoint, 오류, 자격증명 경계로 갱신하고 S5를 정본으로 연결한다.
2. `PYTHONPATH=apps/pipeline python3 -m unittest discover -s apps/pipeline/tests -v`를 실행한다.
3. S5가 지정한 두 Vitest 파일, 전체 API 테스트, typecheck, build를 실행한다.
4. `guard:db`, `guard:sql-dialect`, `guard:core-imports`, `guard:secrets`, `test:scripts`, `test:contracts`, `test:security`, `release:verify`를 실행한다.
5. Ponytail review와 독립 코드 리뷰를 거쳐 불필요한 호환 경로를 제거하고 다시 검증한다.
6. PR을 열어 CI를 확인한 뒤 Linear CCC-228을 In Review로 옮긴다.
