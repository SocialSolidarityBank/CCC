# 처리 장비 파이프라인 API 계약

이 문서는 처리 장비가 사례관리 API와 통신할 때 지켜야 하는 1단계-b 계약이다. 처리 장비는 D1과 R2에 직접 연결하지 않고, 항상 Workers API만 호출한다. (용어: 이 문서가 "Mac Mini"라 부르던 기계가 **처리 장비**다 — 2026-07-31 D51, CONTEXT.md 참조.)

> `green` **v2 로 전환됨 (2026-09-05 · E5-1a · S5).** 오디오와 텍스트는 `agent_jobs` 한 상태기계를 쓰고, 장비는 `POST /pipeline/jobs/claim` 으로만 일을 받는다. 계약 정본은 `docs/specs/S5-agent-job-contract-v2.md` 이고 이 문서는 운영 관점 요약이다. v1 의 `GET /pipeline/jobs`, `/pipeline/text-jobs/**`, service 용 `POST /sessions/:id/ai/source` 는 없앴다.

## 범위와 인증

- 운영 환경에서는 `adapters/identity-access`가 Cloudflare Access JWT(`Cf-Access-Jwt-Assertion` 헤더)를 검증해 canonical `Actor`를 만든다. 검증 내용은 RS256 서명(팀 도메인 JWKS `https://<team>/cdn-cgi/access/certs`, 모듈 캐시 약 1시간, 미지의 kid면 재조회), `iss = https://<ACCESS_TEAM_DOMAIN>`, `aud`에 `ACCESS_AUD` 포함, `exp`/`nbf`(±60초)다. `apps/api/src/index.ts`가 adapter를 조립하고 현행 gateway 앞에서 기존 단일 role로 투영한다.
- 검증된 principal은 반드시 **users 디렉터리**에 있어야 한다. 사람 로그인은 JWT의 `email`, 임시 Access 서비스 principal은 `common_name`으로 조회한다. 디렉터리에 없거나 비활성 또는 actor 회수 상태면 Access를 통과했어도 `403`이다. canonical `Actor`는 `{kind,userId,orgId,roles,scopes,authn}`만 가지며 email, common_name, token을 복사하지 않는다.
- fail closed: `ACCESS_TEAM_DOMAIN`·`ACCESS_AUD`가 없거나 서명·`iss`·`aud`·`exp` 검증이 실패하거나 헤더가 없으면 `401`이다. 검증에 필요한 JWKS, 사용자 디렉터리, 회수 원장을 읽지 못하면 자격 오류로 위장하지 않고 `503 service_unavailable`로 닫힌다.
- 로컬 개발에서는 `LOCAL_ACTOR_HEADER_MODE=true`로만 동작한다. 이때는 `X-CCC-User-Id`, `X-CCC-Org-Id`, `X-CCC-Role: service` 헤더를 명시한다(users 디렉터리 조회 없이 헤더를 그대로 신뢰한다).
- `admin`, `counselor` 역할은 작업 조회와 산출물 저장을 호출할 수 없다. 인증 정보가 없으면 `401`, 서비스 역할이 아니면 `403`을 응답한다.
- 요청과 응답에는 가명 ID만 포함한다. 실명, 연락처, 계좌, `audio_r2_key`는 응답하지 않는다.

## 처리 상태

세션의 AI 처리 상태는 아래 순서로 사용한다.

| 상태 | 의미 |
| --- | --- |
| `none` | 녹음 작업이 등록되지 않았다. |
| `uploaded` | 상담사가 녹음 업로드를 등록했다. 처리 장비가 폴링할 수 있다. |
| `processing` | 처리 중 상태로 예약되어 있다. 2단계에서 작업 시작 기록을 연결한다. |
| `review_ready` | 전사, 대조 3종, 감정 지표, AI 산출물이 저장돼 상담사 검토를 기다린다. |
| `approved` | 상담사가 승인해 AI 산출물이 공식 기록이 됐다. |

`POST /pipeline/jobs/:jobId/result`는 마스킹 스냅샷과 숫자형 처리 메타데이터, 후속 AI 초안을 모두 저장한 뒤 `uploaded` 또는 `processing` 작업을 `review_ready`로 바꾸고 작업을 `succeeded`로 닫는다. 같은 payload hash 재전송은 `resultId`가 달라도 중복 저장 없이 `204`이고, 다른 hash는 `409 result_conflict`다. AI 산출물은 실무자 승인 전까지 브리핑과 통계에 쓰이지 않는다.

## 엔드포인트 (Agent 작업 계약 v2)

전부 `service` 자격이 필요하고, claim 뒤의 모든 호출은 그 claim 의 `claimToken` 과 `attempt` 를 함께 보낸다. 본문이 없는 GET 은 `X-CCC-Job-Claim`·`X-CCC-Job-Attempt` 헤더로 자격을 싣는다 — URL 에는 토큰을 넣지 않는다. 오류 본문은 `{error, jobId, retryable}` 고정 형태이며 원문·PII·시크릿을 담지 않는다(S5 §2.6).

| method | path | 하는 일 |
|---|---|---|
| `POST` | `/pipeline/jobs/claim` | 오디오·텍스트 큐를 엄격히 교대로 섞어 임대한다. `limit` 은 2~50(생략 시 10). 호출 자체가 D8 폴링 신호(`poll_pipeline` 감사)다 |
| `POST` | `/pipeline/jobs/:jobId/heartbeat` | 임대를 연장한다. 상한은 `min(now+15분, claimedAt+2시간, 처리 기한, 7일 절대 상한)` |
| `POST` | `/pipeline/jobs/:jobId/release` | 종료 신호. `transient`(재큐잉, 3회까지) · `blocked`(NER 회복 대기, attempt 불변) · `permanent`(실패 코드 고정) |
| `POST` | `/pipeline/jobs/:jobId/mask-dictionary` | 등록 PII 치환용 일회성 사전. 같은 claim·attempt 재전송은 만료 전까지 같은 응답, 그 밖에는 `dictionary_already_consumed` |
| `GET` | `/pipeline/jobs/:jobId/source` | 텍스트 작업의 공식 원문(1차 치환 완료). `Cache-Control: no-store` |
| `GET` | `/pipeline/jobs/:jobId/audio` | 원음 전달. Local 두 모드는 no-store 바이트 스트림, Community Cloud 는 signed GET 발급기(E6-3)가 붙기 전까지 `503` |
| `POST` | `/pipeline/jobs/:jobId/audio/verify` | 스트림 재해시 결과를 저장한다. 업로드 시 주장 해시와 어긋나면 작업을 `audio_hash_mismatch` 로 닫고 외부 호출은 0건이다 |
| `POST` | `/pipeline/jobs/:jobId/egress/authorize` | Azure 전송 허가. 외부 STT 동의 영역이 붙기 전(SG7·E4-6)까지 `consent_not_effective` 로 닫힌다 |
| `POST` | `/pipeline/jobs/:jobId/egress/in-flight` | 전송 직전 at-most-once marker. 같은 tuple 의 `authorized` 행만 `in_flight` 로 바꾼다 |
| `POST` | `/pipeline/jobs/:jobId/result` | 결과 제출. 성공은 본문 없는 `204` |

claim 요청은 S6 attestation 과 E5-4 release 영수증을 함께 싣는다. 둘 중 하나가 없거나 만료·불일치면 상태를 바꾸지 않고 `local_ner_unavailable` 로 닫는다. STT 축이 `off` 이거나 승인 registry 에 없으면 `sttEngine` 이 `null` 이고 오디오 작업은 claim 되지 않는다(D77).

결과 본문(`AudioResult`·`TextResult`)은 S6 metadata(`maskingPipelineVersion`·`maskingPipelineHash`·`nerAvailable`·attestation ID·결과 hash·release 영수증 ID)와 hash 3종(`sha256`, `evidenceHash`, `payloadSha256`)을 모두 운반한다. 오디오 결과는 `transcriptReliable`·`transcriptWarnings` 를 생략할 수 없다. `reason` 에는 고정 코드만 넣는다 — 자유 문장이나 전사 발췌는 2차 마스킹을 거치지 않으므로 거부한다(R3). 전화번호·이메일·주민번호·계좌형 값이 원형으로 남아 있으면 거부한다. 요약과 대조는 Workers 가 저장된 마스킹 스냅샷만 재료로 만든다.

v2 는 `schemaVersion: 2` 하나만 받는다. `400` 을 payload 변환 신호로 해석하지 않으며, 경고 문장을 전사에 끼워 넣는 레거시 재전송은 없다(S5 §2.7).

### `GET /pipeline/health`

폴링 워치독의 조회 경로다(D8). 관리자 전용이며 자기 조직 기준으로 최신 `poll_pipeline` 감사 시각과 무폴링 여부를 돌려준다. `admin`이 아니면 `403`, 인증 정보가 없으면 `401`.

- `lastPolledAt`: 가장 최근 `poll_pipeline` 감사 시각(ISO, UTC). 폴링 이력이 없으면 `null`. (`audit_log.created_at`은 SQLite `datetime('now')` 형식 `'YYYY-MM-DD HH:MM:SS'`(UTC)이라, 비교 시 UTC로 파싱한다.)
- `lastCompletedAt`: 가장 최근 완료 시각(ISO, UTC) — 오디오 완료(`recording_result_commits.finalized_at`)와 텍스트 일감 완료(`ai_text_work_queue.completed_at`)의 최댓값. 완료 이력이 없으면 `null`.
- `pendingJobCount`: 오디오가 등록됐지만 아직 처리 안 된 세션 수(`uploaded`·`processing`).
- `pendingTextWorkCount`: 텍스트 일감 큐의 미완료(`pending`·`processing`) 건수 — 임대(0036)가 만료된 채 멈춘 `processing` 행도 포함한다.
- `pendingTotalCount`: 두 큐 합산 대기 건수(판정 기준).
- `oldestPendingSince` / `oldestPendingHours`: 가장 오래된 대기 작업의 시각(ISO)과 대기 시간(시간). 대기 작업이 없으면 둘 다 `null`.
- `thresholdHours`: 무폴링 판정 임계값(기본 6, `PIPELINE_STALE_HOURS`로 조정).
- `queueThresholdHours`: 큐 적체 판정 임계값(`PIPELINE_QUEUE_STALE_HOURS`, 미설정이면 `thresholdHours`와 동일).
- `status` / `stale` / `staleReasons`:
  - `ok` — 임계값 안에 최근 폴링이 있고 큐 적체도 없음. `stale=false`, `staleReasons=[]`.
  - `stale` — `stale=true`(관리자 알림 대상). 사유는 `staleReasons` 배열에 1개 이상:
    - `poll_overdue` — 임계값 초과 무폴링.
    - `never_polled` — 대기 작업이 있는데 폴링 이력 자체가 없음.
    - `queue_backlog` — 폴링이 최신이어도 가장 오래된 대기 작업이 `queueThresholdHours`를 초과해 묵음.
  - `inactive` — 폴링 이력도 없고 대기 작업도 없음. `stale=false`(감시 대상 아님).

```json
{
  "orgId": "org_demo",
  "lastPolledAt": "2026-07-10T02:00:00.000Z",
  "lastCompletedAt": "2026-07-09T23:00:00.000Z",
  "stale": true,
  "status": "stale",
  "staleReasons": ["queue_backlog"],
  "pendingJobCount": 1,
  "pendingTextWorkCount": 2,
  "pendingTotalCount": 3,
  "oldestPendingSince": "2026-07-09T20:00:00.000Z",
  "oldestPendingHours": 8.5,
  "thresholdHours": 6,
  "queueThresholdHours": 6
}
```

조회 자체가 감사 로그에 `read`(`target_table=pipeline_health`)로 기록된다(D14).

### 스케줄 워치독 (cron)

30분마다 도는 Workers `scheduled` 핸들러가 전 조직의 폴링 건강도를 계산하고, `stale`인 조직마다 관리자 알림 시임(`notifyAdmins`)을 호출한다. 각 점검은 감사 로그에 `watchdog_check`(`actor_id=system:watchdog`, `actor_role=service`)로 남는다. `system:*` 행위자는 HTTP 요청 없이 `scheduled` 핸들러에서만 쓰이는 읽기 전용 내부 진입점이며, 남기는 쓰기는 append-only 감사뿐이다. 알림 채널(이메일·Slack)은 아직 없어 지금은 `console.error("[WATCHDOG ALERT] …")`로만 남긴다 — 연동은 `apps/api/src/notify.ts` 한 곳에 붙인다. 자세한 운영·환경 변수는 `docs/ops.md` 참고.

## 녹음 업로드 (상담사·관리자)

처리 장비가 아니라 웹앱(상담사·관리자)이 호출하는 경로다. 파이프라인 작업이 여기서 만들어진다.

### `PUT /sessions/:id/audio`

케이스 담당자(또는 관리자)가 대면 상담 녹음 원본을 올린다. 본문은 오디오 바이트 그대로다(JSON 아님).

- 인증: 사람(상담사·관리자) 역할. 케이스 접근 권한은 gateway `registerRecording`이 강제한다(라우트에서 임의 검사하지 않음). 서비스 역할은 이 경로를 쓰지 않는다.
- `Content-Type`은 허용 목록만 받는다: `audio/mp4`, `audio/mpeg`, `audio/wav`(`audio/x-wav`), `audio/webm`, `audio/x-m4a`. 그 외는 `400`.
- 본문은 비어 있으면 안 되고(`400`), 최대 200 MB다(`Content-Length`가 있으면 선검사, 실제 바이트로도 재검사, 초과 시 `400`).
- 처리 순서: 콘텐츠 검증 → R2 저장(`audio/<sessionId>/<uuid>`, PII 없는 키, `Content-Type`은 httpMetadata로 보관) → `registerRecording` 호출. 등록이 실패하면(권한 없음, 녹음 미동의, 이미 승인된 세션, 대면 아님 등) 방금 올린 R2 객체를 지우고 오류를 그대로 돌려준다(고아 오디오 방지).
- 성공하면 세션 응답을 `200`으로 돌려준다. 응답에 `audio_r2_key`는 싣지 않는다. 등록 규칙 위반은 `400`, 권한 없음/미동의는 `registerRecording`의 검사에 따라 `400`·`403`, 인증 없음은 `401`.

## 사용자 디렉터리 관리 (관리자 전용)

운영 인증이 매핑하는 users 디렉터리를 관리하는 경로다. 전부 관리자 전용이고 자기 조직만 다룬다(gateway가 강제). 모든 변경은 `audit_log`에 남는다(D14). 아니면 `401`(인증 없음)·`403`(관리자 아님).

### `GET /users`

자기 조직의 사용자 목록을 이메일 순으로 돌려준다. 각 항목은 `{ id, orgId, email, role, active }`이고 Local 계정의 `email`은 `null`일 수 있다.

### `POST /users`

사용자를 프로비저닝한다(생성 또는 역할 갱신). `email`이 신원 키다(전역 UNIQUE).

```json
{ "email": "counselor@example.org", "role": "counselor", "userId": "optional-explicit-id" }
```

- `role`은 `admin` · `counselor` · `service` 중 하나. 서비스 토큰(처리 장비)은 `service`로, `email`에 토큰의 client id / common_name을 넣는다.
- 이메일이 처음이면 새로 만든다(`userId`를 주면 그 값을, 없으면 UUID를 id로 쓴다). 이미 있으면 역할을 갱신하고 `active=1`로 재활성화한다(이때 `userId` 인자는 무시). 비활성화 전에 발급된 Access credential은 회수 원장 때문에 계속 403이며, 사용자는 Cloudflare Access에서 로그아웃한 뒤 다시 로그인해 새 credential을 받아야 한다.
- 마지막 활성 관리자를 관리자가 아닌 역할로 강등하려 하면 `400`. 다른 조직 소속 이메일은 `403`.
- 성공 시 `201`로 갱신된 사용자 행을 돌려준다. 형식 오류는 `400`.

### `POST /users/:id/deactivate`

사용자를 비활성화한다(행 삭제 없이 `active=0`). 같은 원자 batch에서 `admin-disable` actor 회수를 append하므로 기존 Access credential은 앱 접근이 거부된다.

- 자기 자신은 비활성화 불가(`400`), 마지막 활성 관리자도 비활성화 불가(`400`).
- 성공 시 `200`으로 비활성화된 사용자 행을 돌려준다. 재활성화 뒤에는 Cloudflare Access 로그아웃과 재로그인이 필요하다.

## 운영 전 확인 항목

1. Cloudflare Access 서비스 토큰과 역할, 조직 헤더 주입 방식을 설정한다.
2. `AUDIO_BUCKET`을 실제 R2 버킷으로 만들고, 오디오 원본 30일 수명 규칙(lifecycle)을 계정 수준에서 적용한다. (오디오 중계 자체는 2단계-a에서 구현됨.)
3. 무폴링 관리자 알림은 구현됨(`GET /pipeline/health` + 30분 cron 워치독, D8). 남은 일은 실제 알림 채널(이메일·Slack)을 `apps/api/src/notify.ts`에 붙이는 것뿐이다. cron은 Cloudflare 계정 개설 후 배포로 활성화된다.
