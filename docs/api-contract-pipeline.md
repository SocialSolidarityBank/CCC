# Mac Mini 파이프라인 API 계약

이 문서는 Mac Mini가 사례관리 API와 통신할 때 지켜야 하는 1단계-b 계약이다. Mac Mini는 D1과 R2에 직접 연결하지 않고, 항상 Workers API만 호출한다.

## 범위와 인증

- 운영 환경에서는 Workers가 Cloudflare Access가 서명한 JWT(`Cf-Access-Jwt-Assertion` 헤더)를 검증한 뒤 행위자를 판별한다. 검증 내용: RS256 서명(팀 도메인 JWKS `https://<team>/cdn-cgi/access/certs`, 모듈 캐시 ~1h·미지의 kid면 재조회) + `iss = https://<ACCESS_TEAM_DOMAIN>` + `aud`에 `ACCESS_AUD` 포함 + `exp`/`nbf`(±60s). 구현: `apps/api/src/access-jwt.ts`(검증) + `apps/api/src/identity.ts`(행위자 판별).
- 검증된 신원은 반드시 **users 디렉터리**에 있어야 한다. 사람 로그인은 JWT의 `email`, 서비스 토큰(Mac Mini)은 `common_name`으로 조회한다. 디렉터리에 없거나 비활성(`active=0`)이면 Access를 통과했더라도 `403`(앱 프로비저닝 안 됨). 행위자의 `{userId, orgId, role}`은 이 디렉터리 행에서 나온다(자세한 건 아래 "사용자 디렉터리 관리").
- fail closed: `ACCESS_TEAM_DOMAIN`·`ACCESS_AUD` 환경 변수가 설정되기 전(계정 개설 전, D16)에는 운영 API가 전부 `401`로 잠긴다. 이 두 값은 Access 애플리케이션 생성 후 `wrangler.toml [env.production.vars]`에 채운다. 서명·`iss`·`aud`·`exp` 검증 실패와 헤더 누락도 `401`이다.
- 로컬 개발에서는 `LOCAL_ACTOR_HEADER_MODE=true`로만 동작한다. 이때는 `X-CCC-User-Id`, `X-CCC-Org-Id`, `X-CCC-Role: service` 헤더를 명시한다(users 디렉터리 조회 없이 헤더를 그대로 신뢰한다).
- `admin`, `counselor` 역할은 작업 조회와 산출물 저장을 호출할 수 없다. 인증 정보가 없으면 `401`, 서비스 역할이 아니면 `403`을 응답한다.
- 요청과 응답에는 가명 ID만 포함한다. 실명, 연락처, 계좌, `audio_r2_key`는 응답하지 않는다.

## 처리 상태

세션의 AI 처리 상태는 아래 순서로 사용한다.

| 상태 | 의미 |
| --- | --- |
| `none` | 녹음 작업이 등록되지 않았다. |
| `uploaded` | 상담사가 녹음 업로드를 등록했다. Mac Mini가 폴링할 수 있다. |
| `processing` | 처리 중 상태로 예약되어 있다. 2단계에서 작업 시작 기록을 연결한다. |
| `review_ready` | 전사, 대조 3종, 감정 지표, AI 산출물이 저장돼 상담사 검토를 기다린다. |
| `approved` | 상담사가 승인해 AI 산출물이 공식 기록이 됐다. |

`POST /pipeline/jobs/:id/artifacts`는 `uploaded` 또는 `processing` 작업을 `review_ready`로 바꾼다. AI 산출물은 상담사 승인 전까지 브리핑과 통계에 쓰이지 않는다.

## 엔드포인트

### `GET /pipeline/jobs`

`uploaded` 또는 `processing` 상태이며 오디오 등록이 있는 작업을 오래된 순서로 돌려준다. 호출할 때마다 감사 로그에 `poll_pipeline`이 기록된다. 이 감사 로그의 가장 최근 시각이 D8의 "Mac Mini가 마지막으로 폴링한 시각" 데이터 원천이다. 아래 `GET /pipeline/health`와 스케줄 워치독이 이 기록을 기준으로 무폴링을 판정한다(기본 6시간, `PIPELINE_STALE_HOURS`로 조정).

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

서비스 역할이 등록된 녹음 원본을 내려받는 중계 경로다(2단계-a 구현). Mac Mini에 R2 자격 증명이나 버킷 직접 접근 권한을 주지 않고, Workers가 R2에서 읽어 바이트만 흘려준다.

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

### `POST /pipeline/jobs/:id/artifacts`

Mac Mini가 로컬에서 전사와 2차 NER 마스킹을 끝낸 뒤 호출한다. 등록된 PII 값의 1차 치환은 gateway 안에서 한 번 더 수행한다. 본문은 아래 필드를 모두 포함해야 한다.

```json
{
  "transcript": "NER 마스킹을 마친 전사",
  "aiSummary": "AI 산출물 요약",
  "aiSchema": {},
  "aiContrast": {
    "missingFromMemo": [],
    "missingFromAudio": [],
    "undiscussedGoals": []
  },
  "emotionScores": {
    "speech": 0.42,
    "text": 0.71
  },
  "flagProposals": [
    {
      "flagType": "contact_loss_risk",
      "quote": "마스킹된 전사 인용문"
    }
  ],
  "gasEvidence": [
    {
      "goalId": "demo-goal-001",
      "evidenceQuote": "마스킹된 전사 인용문"
    }
  ]
}
```

- `emotionScores`에는 유한한 숫자와 숫자 배열 또는 객체만 넣는다. 감정 상태를 설명하는 문장은 넣지 않는다.
- `flagProposals.quote`와 `gasEvidence.evidenceQuote`는 비어 있으면 안 된다.
- `gasEvidence.goalId`는 해당 세션의 케이스에 속한 목표여야 한다. AI는 근거 발췌만 제안하며 GAS 점수는 정하지 않는다.
- `aiSchema`는 상담 템플릿 스펙(D29) 확정 전까지 구조를 정하지 않는 확장 슬롯이다.
- 성공하면 본문 없이 `204`를 응답한다. 형식이나 규칙이 맞지 않으면 `400`, 서비스 역할이 아니면 `403`을 응답한다.

### `GET /pipeline/health`

폴링 워치독의 조회 경로다(D8). 관리자 전용이며 자기 조직 기준으로 최신 `poll_pipeline` 감사 시각과 무폴링 여부를 돌려준다. `admin`이 아니면 `403`, 인증 정보가 없으면 `401`.

- `lastPolledAt`: 가장 최근 `poll_pipeline` 감사 시각(ISO, UTC). 폴링 이력이 없으면 `null`. (`audit_log.created_at`은 SQLite `datetime('now')` 형식 `'YYYY-MM-DD HH:MM:SS'`(UTC)이라, 비교 시 UTC로 파싱한다.)
- `pendingJobCount`: 오디오가 등록됐지만 아직 처리 안 된 세션 수(`uploaded`·`processing`).
- `thresholdHours`: 판정 임계값(기본 6, `PIPELINE_STALE_HOURS`로 조정).
- `status` / `stale`:
  - `ok` — 임계값 안에 최근 폴링이 있음. `stale=false`.
  - `stale` — 임계값 초과 무폴링이거나, 대기 작업이 있는데 폴링 이력 자체가 없음. `stale=true`(관리자 알림 대상).
  - `inactive` — 폴링 이력도 없고 대기 작업도 없음. `stale=false`(감시 대상 아님).

```json
{
  "orgId": "org_demo",
  "lastPolledAt": "2026-07-10T02:00:00.000Z",
  "stale": true,
  "status": "stale",
  "pendingJobCount": 1,
  "thresholdHours": 6
}
```

조회 자체가 감사 로그에 `read`(`target_table=pipeline_health`)로 기록된다(D14).

### 스케줄 워치독 (cron)

30분마다 도는 Workers `scheduled` 핸들러가 전 조직의 폴링 건강도를 계산하고, `stale`인 조직마다 관리자 알림 시임(`notifyAdmins`)을 호출한다. 각 점검은 감사 로그에 `watchdog_check`(`actor_id=system:watchdog`, `actor_role=service`)로 남는다. `system:*` 행위자는 HTTP 요청 없이 `scheduled` 핸들러에서만 쓰이는 읽기 전용 내부 진입점이며, 남기는 쓰기는 append-only 감사뿐이다. 알림 채널(이메일·Slack)은 아직 없어 지금은 `console.error("[WATCHDOG ALERT] …")`로만 남긴다 — 연동은 `apps/api/src/notify.ts` 한 곳에 붙인다. 자세한 운영·환경 변수는 `docs/ops.md` 참고.

## 녹음 업로드 (상담사·관리자)

Mac Mini가 아니라 웹앱(상담사·관리자)이 호출하는 경로다. 파이프라인 작업이 여기서 만들어진다.

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

- `role`은 `admin` · `counselor` · `service` 중 하나. 서비스 토큰(Mac Mini)은 `service`로, `email`에 토큰의 client id / common_name을 넣는다.
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
