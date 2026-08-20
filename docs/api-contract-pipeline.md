# 처리 장비 파이프라인 API 계약

이 문서는 처리 장비가 사례관리 API와 통신할 때 지켜야 하는 1단계-b 계약이다. 처리 장비는 D1과 R2에 직접 연결하지 않고, 항상 Workers API만 호출한다. (용어: 이 문서가 "Mac Mini"라 부르던 기계가 **처리 장비**다 — 2026-07-31 D51, CONTEXT.md 참조.)

> `green` **반영됨 (2026-07-31 · D57·ADR-0027).** `GET /pipeline/jobs`는 여전히 `audio_r2_key IS NOT NULL`로 걸러 **녹음 일감만** 돌려준다. 오디오 없는 회차는 아래 '텍스트 일감' 큐가 맡는다 — 장비가 2차 마스킹만 하고, 사업자 호출은 Workers 가 스냅샷을 재료로 한다.

## 범위와 인증

- 운영 환경에서는 Workers가 Cloudflare Access가 서명한 JWT(`Cf-Access-Jwt-Assertion` 헤더)를 검증한 뒤 행위자를 판별한다. 검증 내용: RS256 서명(팀 도메인 JWKS `https://<team>/cdn-cgi/access/certs`, 모듈 캐시 ~1h·미지의 kid면 재조회) + `iss = https://<ACCESS_TEAM_DOMAIN>` + `aud`에 `ACCESS_AUD` 포함 + `exp`/`nbf`(±60s). 구현: `apps/api/src/access-jwt.ts`(검증) + `apps/api/src/identity.ts`(행위자 판별).
- 검증된 신원은 반드시 **users 디렉터리**에 있어야 한다. 사람 로그인은 JWT의 `email`, 서비스 토큰(처리 장비)은 `common_name`으로 조회한다. 디렉터리에 없거나 비활성(`active=0`)이면 Access를 통과했더라도 `403`(앱 프로비저닝 안 됨). 행위자의 `{userId, orgId, role}`은 이 디렉터리 행에서 나온다(자세한 건 아래 "사용자 디렉터리 관리").
- fail closed: `ACCESS_TEAM_DOMAIN`·`ACCESS_AUD` 환경 변수가 설정되기 전(계정 개설 전, D16)에는 운영 API가 전부 `401`로 잠긴다. 이 두 값은 Access 애플리케이션 생성 후 `wrangler.toml [env.production.vars]`에 채운다. 서명·`iss`·`aud`·`exp` 검증 실패와 헤더 누락도 `401`이다.
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

`POST /pipeline/jobs/:id/result`는 마스킹 스냅샷과 숫자형 처리 메타데이터, 후속 AI 초안을 모두 저장한 뒤 `uploaded` 또는 `processing` 작업을 `review_ready`로 바꾼다. 같은 결과 재전송은 중복 저장이나 후속 AI 호출 없이 `204`를 돌려준다. AI 산출물은 실무자 승인 전까지 브리핑과 통계에 쓰이지 않는다.

## 엔드포인트

### `GET /pipeline/jobs`

`uploaded` 또는 `processing` 상태이며 오디오 등록이 있는 작업을 오래된 순서로 돌려준다. 호출할 때마다 감사 로그에 `poll_pipeline`이 기록된다. 이 감사 로그의 가장 최근 시각이 D8의 "처리 장비가 마지막으로 폴링한 시각" 데이터 원천이다. 아래 `GET /pipeline/health`와 스케줄 워치독이 이 기록을 기준으로 무폴링을 판정한다(기본 6시간, `PIPELINE_STALE_HOURS`로 조정).

응답 예시:

```json
{
  "jobs": [
    {
      "id": "demo-session-001",
      "caseId": "swallow-003",
      "status": "uploaded",
      "audioAvailable": true
    }
  ]
}
```

### `GET /pipeline/jobs/:id/audio`

서비스 역할이 등록된 녹음 원본을 내려받는 중계 경로다(2단계-a 구현). 처리 장비에 R2 자격 증명이나 버킷 직접 접근 권한을 주지 않고, Workers가 R2에서 읽어 바이트만 흘려준다.

- gateway가 서비스 역할·조직 일치·오디오 등록 여부를 확인한 뒤, 조회 직전 audit_log에 `download_audio`를 기록한다(D14: 오디오 열람은 전건 감사).
- 성공하면 `200`으로 저장된 `Content-Type`(업로드 때 지정한 오디오 MIME)과 `Cache-Control: no-store` 헤더로 원본 바이트를 스트리밍한다. 응답에 `audio_r2_key`는 절대 싣지 않는다.
- 등록은 됐지만 R2 객체가 없으면 `404`.

```json
{
  "error": "audio_object_missing",
  "jobId": "demo-session-001"
}
```

- 서비스 역할이 아니면 `403`, 인증 정보가 없으면 `401`.

음성 원본 30일 자동 삭제(스펙 2·5장)는 이 중계와 무관하게 `AUDIO_BUCKET`의 R2 lifecycle 규칙(계정 수준)으로 적용한다 — Cloudflare 계정 개설 후 설정한다.

### `POST /pipeline/jobs/:id/result`

처리 장비가 로컬에서 전사와 2차 NER 마스킹을 끝낸 뒤 호출한다. 등록된 PII 값의 1차 치환은 gateway 안에서 한 번 더 수행한다. 본문은 아래 필드를 모두 포함해야 한다.

```json
{
  "maskedText": "NER 마스킹을 마친 전사",
  "sha256": "마스킹된 본문의 SHA-256 해시",
  "maskingPipelineVersion": "ner-mask-v1",
  "evidence": [
    {
      "id": "불투명 근거 ID",
      "sourceRef": "recording-transcript",
      "sourceSha256": "마스킹된 본문의 SHA-256 해시",
      "evidenceQuote": "NER 마스킹을 마친 전사",
      "sourceStart": 0,
      "sourceEnd": 16
    }
  ],
  "emotionScores": {
    "speech": 0.42,
    "text": 0.71
  }
}
```

- `emotionScores`에는 유한한 숫자와 숫자 배열 또는 객체만 넣는다. 감정 상태를 설명하는 문장은 넣지 않는다.
- `evidence`는 최소 1건이고 `maskedText`의 정확한 구간과 같은 해시를 가리켜야 한다.
- 전화번호, 이메일, 주민번호, 계좌형 값이 명백한 원형으로 남아 있으면 `400`으로 거부한다.
- 요약과 대조는 Workers가 저장된 마스킹 스냅샷만 재료로 만들어 별도 초안에 저장한다. 처리 장비는 `aiSummary`, `aiSchema`, `flagProposals`, `gasEvidence`를 제출하지 않는다.
- 같은 해시와 감정값을 다시 보내면 멱등 재생으로 처리한다. 이미 받은 결과와 다른 값은 `409`로 거부한다.
- 성공하면 본문 없이 `204`를 응답한다. 형식이나 규칙이 맞지 않으면 `400`, 서비스 역할이 아니면 `403`을 응답한다.

## 텍스트 일감 (D51 · D57 · ADR-0027 · D69 · ADR-0036 · CCC-120)

사업자로 나갈 텍스트의 **2차 마스킹**을 장비에 맡기는 큐다(`ai_text_work_queue`, 마이그레이션 0029, 사유 확장 0034, 임대·완료 스냅샷 연결 0036). 기록이 공식화될 때마다(수기 저장 · AI 정리 승인) 한 행이 쌓이고, 목표가 확정·수정되면 그 참여 사업의 미승인 회차들이 다시 쌓인다(D69. 목표 문구도 마스킹을 거쳐야 나간다). 오디오가 있는 회차의 수기 메모도 대상이다. 장비는 오디오 큐와 같은 폴링에서 함께 가져간다. 셋 다 서비스 역할 전용이며, 아니면 `403`이다.

### `GET /pipeline/text-jobs`

처리할 수 있는 일감을 오래된 순으로 최대 50건 **임대와 함께** 돌려준다. 호출 자체가 D8 폴링 신호(`poll_pipeline` 감사)가 된다 — 무폴링 감시는 두 큐 합산이다.

```json
{ "jobs": [{ "id": "…", "sessionId": "…", "reason": "manual_record", "enqueuedAt": "…", "leaseExpiresAt": "…", "attemptCount": 1 }] }
```

`reason`은 `manual_record`(수기 저장, D5), `ai_draft_approved`(AI 정리 승인, R2), `goal_revised`(목표 확정·수정, D69) 셋 중 하나다. 장비 처리 방식은 셋이 같고, 사유는 왜 이 행이 생겼는지의 기록일 뿐이다.

**폴링 = 임대다(0036 · CCC-120).** 목록에 나온 행은 그 순간 `pending → processing` 으로 바뀌고 호출한 장비(서비스 토큰 식별자)에게 임대된다. 같은 행이 두 장비에 동시에 나가지 않는다 — 다른 장비가 곧바로 폴링해도 임대 중인 행은 보이지 않는다. 임대가 `leaseExpiresAt`(현재 15분)을 넘기도록 완료되지 않으면 그 행은 다시 폴링에 노출되어 다른 장비로 넘어가고, 임대가 부여될 때마다 `attemptCount` 가 1씩 오른다(1 = 첫 시도). 자기 임대가 만료 전이라면 재폴링에 같은 행이 다시 나오지 않으므로, 받은 목록은 만료 전에 처리한다.

`leaseExpiresAt` · `attemptCount` 는 응답 필드 **추가**라 구 장비 클라이언트는 몰라도 동작한다(모르는 필드는 무시하면 된다).

**지금 처리할 수 있는 행만 나온다.** 아래 셋 중 하나라도 어긋나면 그 행은 목록에서 빠진다 — 큐는 삭제가 없어(0029), 실패할 행을 내보내면 매 폴링마다 같은 행에 걸려 영원히 쌓이기 때문이다. 조건이 갖춰지면 같은 행이 저절로 보인다.

1. `TEXT_AI_PILOT_ENABLED` 가 켜져 있다.
2. 그 참여 사업에 효력 중인 텍스트 AI 동의 근거(`pilot_text_ai_consent_evidence`)가 있다 — ② 동의를 기록하면 자동으로 생긴다(ADR-0027).
3. 마스킹할 공식 텍스트가 있다(수기 메모 또는 승인된 AI 정리). 인테이크 회차는 `memo` 가 NULL 이라 승인된 정리가 생기기 전까지 여기서 걸린다.

### `GET /pipeline/text-jobs/:id/source`

장비가 마스킹할 원문을 돌려준다 — **1차 치환(등록 PII → 가명 ID)까지 끝낸** 공식 텍스트다(수기 메모 + 승인된 AI 정리). 1차 치환은 멱등이라 스냅샷 저장 시 다시 걸어도 해시가 어긋나지 않는다. PII 복호화 1건이 감사에 남는다(D14).

회차 텍스트 앞에는 케이스 컨텍스트가 라벨 줄로 깔린다(D62 §7 · D69). 순서는 `[전체 목표]`, `[세부 목표]`(활성만), `[지원욕구 1순위]`, `[지원욕구 2순위]`, `[지원방향]`, `[회기 목표]`(이 회차가 완료로 닫은 일정의 것만)이고, 그 뒤에 회차 본문이 오며, 맨 끝에 워크인 회차의 폴백 자유 글 `[이번 상담에서 확인할 것]`이 붙는다. 값이 없는 구획은 라벨째 빠진다. 목표 문구도 여기 실려 장비 마스킹을 거친 뒤에만 사업자로 나간다(R3 · D57).

```json
{ "sessionId": "…", "text": "…" }
```

공식 텍스트가 하나도 없으면 `400`이다. 자기가 임대한 일감(또는 아직 임대되지 않은 대기 행)이 아니면 `403`이다 — 임대가 만료돼 다른 장비로 넘어간 뒤 옛 임대 주인이 부르는 경우도 여기 해당한다.

### `POST /pipeline/text-jobs/:id/complete`

스냅샷을 만든 뒤 호출한다. 성공하면 본문 없이 `204`. 완료 행은 불변이라 다시 완료할 수 없다(`403`). 원문 조회와 같은 임대 규칙이 적용된다 — 임대가 다른 장비로 넘어갔으면 `403`.

장비는 이 사이에 기존 `POST /sessions/:id/ai/source`로 2차 마스킹 스냅샷을 올린다. **그 호출이 내용 불일치 검출을 돌린다** — 스냅샷이 없는 회차는 검출 재료가 되지 않기 때문이다(R3 · ADR-0027). 근거(`evidence`)는 최소 1건이 필요하므로, 발췌할 것이 따로 없는 텍스트 일감은 마스킹된 본문 전체를 한 조각으로 보낸다.

**완료는 스냅샷과 연결된다(0036 · CCC-120).** 서버가 그 일감의 회차로 역추적해 가장 최근 마스킹 스냅샷을 `completed_snapshot_id` 로 연결한다 — 계약 순서상 완료 직전에 올린 스냅샷이 곧 이 일감의 산출물이다. 클라이언트는 스냅샷 ID 를 보낼 필요가 없어 구 장비 클라이언트도 요청 변경 없이 동작한다. 그 회차에 스냅샷이 하나도 없으면 완료를 거부한다(`400`) — 스냅샷을 올린 뒤에 부르라는 뜻이다.

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

자기 조직의 사용자 목록을 이메일 순으로 돌려준다. 각 항목: `{ id, orgId, email, role, active }`.

### `POST /users`

사용자를 프로비저닝한다(생성 또는 역할 갱신). `email`이 신원 키다(전역 UNIQUE).

```json
{ "email": "counselor@example.org", "role": "counselor", "userId": "optional-explicit-id" }
```

- `role`은 `admin` · `counselor` · `service` 중 하나. 서비스 토큰(처리 장비)은 `service`로, `email`에 토큰의 client id / common_name을 넣는다.
- 이메일이 처음이면 새로 만든다(`userId`를 주면 그 값을, 없으면 UUID를 id로 쓴다). 이미 있으면 역할을 갱신하고 `active=1`로 재활성화한다(이때 `userId` 인자는 무시 — 이메일이 신원을 특정한다).
- 마지막 활성 관리자를 관리자가 아닌 역할로 강등하려 하면 `400`. 다른 조직 소속 이메일은 `403`.
- 성공 시 `201`로 갱신된 사용자 행을 돌려준다. 형식 오류는 `400`.

### `POST /users/:id/deactivate`

사용자를 비활성화한다(행 삭제 없이 `active=0`). 이후 그 신원은 Access를 통과해도 앱 접근이 거부된다.

- 자기 자신은 비활성화 불가(`400`), 마지막 활성 관리자도 비활성화 불가(`400`).
- 성공 시 `200`으로 비활성화된 사용자 행을 돌려준다.

## 운영 전 확인 항목

1. Cloudflare Access 서비스 토큰과 역할, 조직 헤더 주입 방식을 설정한다.
2. `AUDIO_BUCKET`을 실제 R2 버킷으로 만들고, 오디오 원본 30일 수명 규칙(lifecycle)을 계정 수준에서 적용한다. (오디오 중계 자체는 2단계-a에서 구현됨.)
3. 무폴링 관리자 알림은 구현됨(`GET /pipeline/health` + 30분 cron 워치독, D8). 남은 일은 실제 알림 채널(이메일·Slack)을 `apps/api/src/notify.ts`에 붙이는 것뿐이다. cron은 Cloudflare 계정 개설 후 배포로 활성화된다.
