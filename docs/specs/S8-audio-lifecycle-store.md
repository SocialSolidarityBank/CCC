# S8: 원음 생명주기와 AudioStore

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D77, D81, D83; ADR-0042 D84의 read-only preflight 범위; ADR-0043 D85
- 입력: `ADR-0041`, `ADR-0042`, `ADR-0043`, `CCC_OPEN_PILOT_PLAN.md`의 공통 포트·SG8·E1-3·E5-6·E6-3·E7-1a·E8-9 계약
- 산출: 세 모드가 공유하는 `AudioStore` 스트리밍 포트, 원음 상태 기계, 삭제 증거와 계약 fixture
- 관련 티켓: E1-3, E5-6, E6-3, E7-1a, E8-9

## 1. 목적

원음은 AI 재료가 되기 전까지 필요한 만큼만 보관하고, 처리 직후 삭제한다. 이 문서는 세 모드의 저장소 포트와 업로드·다운로드 권한, Q가 승인한 다음 영업일 첫 Agent 처리 기회, 경합·재시작·재조정 및 삭제 증거를 고정한다. `확정`은 이 계약과 fixture가 닫혔다는 뜻이며 실제 adapter와 운영 증거는 관련 E 티켓의 책임이다.

## 2. 인터페이스와 규칙

### 2.1 공통 스트리밍 포트

```ts
export type AudioContentType =
  | 'audio/mp4'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/x-wav'
  | 'audio/webm'
  | 'audio/x-m4a';

export interface AudioObjectMetadata {
  contentLength: number;       // 1..209_715_200 bytes, inclusive
  contentType: AudioContentType;
  expiresAt: string;            // upload authorization expiry, ISO-8601 UTC
}

export type AudioDownload = AudioObjectMetadata & {
  body: ReadableStream<Uint8Array>;
  sha256: string | null;
};

export type AudioDeleteVerificationMethod =
  | 'authenticated-get-404'
  | 'filesystem-stat-enoent'
  | 'r2-head-absent';

export interface AudioDeletionEvidence {
  keyHash: string;              // SHA-256(UTF-8 key), never the raw key
  generationId: string | null;  // provider generation/etag bound to this attempt
  objectSha256: string | null;  // Agent-computed hash; null when never verified
  deletionAttemptId: string;
  deletionRequestedAt: string;
  providerDeleteAcceptedAt: string | null;
  deletedAt: string | null;     // actual provider delete/unlink or durable cleanup acceptance time
  deleteSucceeded: boolean;
  absentFromList: boolean;
  absentFromMetadata: boolean;
  directReadAbsent: boolean;
  verificationMethod: AudioDeleteVerificationMethod;
  providerStatus?: number;
  verifiedAt: string;
}

export interface AudioStore {
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    metadata: AudioObjectMetadata,
  ): Promise<{ sha256: string }>;
  get(key: string): Promise<AudioDownload | null>;
  delete(key: string): Promise<AudioDeletionEvidence>;
  createUploadTarget(
    key: string,
    metadata: AudioObjectMetadata,
  ): Promise<{ url: string; expiresAt: string } | null>;
  createDownloadTarget(
    key: string,
    expiresInSeconds: 600,
  ): Promise<{ url: string; expiresAt: string } | null>;
}
```

- `key`는 `audio/<sessionId>/<uuid>`만 허용한다. 두 segment에는 `/`, `\\`, `..`, percent-encoded separator가 없고 `sessionId`는 `[A-Za-z0-9_-]+`, 마지막 segment는 소문자 canonical UUID다. 다른 prefix, 빈 segment, traversal, 원시 파일 경로는 거부한다.
- `contentLength`는 정확히 1 이상 `200 * 1024 * 1024` 이하(209,715,200 bytes)다. 선언 길이보다 빨리 끝나거나 한 byte라도 초과하면 저장을 폐기하고 성공을 반환하지 않는다. adapter는 한 chunk씩 읽고 SHA-256을 누적하며 200MB 본문을 Edge로 전달하거나 전량 메모리 복사하지 않는다.
- `contentType`는 위 6개 media type의 소문자 정규화 값만 허용한다. `application/octet-stream`, `video/*`, 빈 값과 허용 목록 밖 MIME은 거부한다. `;codecs=...` parameter는 media type 검증 뒤 별도 codec metadata로만 보존하고 canonical MIME은 union 밖으로 바꾸지 않는다.
- `put`의 `expiresAt`는 업로드 권한 만료이지 원음 보존·삭제 시계가 아니다. 업로드 시각+24시간이라는 hard clock을 사용하지 않는다. 보존 시계는 실제 Agent 기회의 24시간과 `retention_hard_cap_at`으로 계산한다.
- `get`의 body는 backpressure를 유지하는 단방향 stream이다. 호출자는 이를 파일로 내려받아 STT에 넘길 수 있으나 adapter는 전체 복사본을 만들지 않는다. 존재하지 않거나 권한이 없으면 `null`이며 raw provider 오류·URL을 노출하지 않는다.
- `clientAssertedSha256`는 편의를 위한 browser 주장일 뿐 신뢰 근거가 아니다. `objectSha256`는 claim 뒤 Agent가 직접 streamed `get`을 다시 읽어 계산한 값만 된다. Agent 재검증 전 삭제되는 object의 `objectSha256`는 `null`로 남기며 client 값으로 대체하지 않는다. client 값과 실제 Agent 값은 mismatch여도 각각 보존한다.
- `keyHash`는 로그·감사 행에서 key를 대체한다. 원음 bytes, signed URL, 감지 문자열은 로그와 삭제 증거에 남기지 않는다.

### 2.2 target 의미와 권한

| 동작 | Community Cloud | Local Single / Local Office | 사람·browser 권한 |
|---|---|---|---|
| upload target | 기관 소유 Supabase **private** Storage, 수명 정확히 2시간, `upsert: false` | `null`; 인증 API가 `put` stream을 직접 전달 | 로그인한 업무 client의 현재 session upload만 허용 |
| download target | live claim 확인 뒤 발급하는 Agent 전용 signed GET, 최대 600초(10분), 발급 시각·Agent 주체·만료를 `audio_objects`에 기록 | `null`; Agent가 인증 API의 streamed `get` 사용 | 사람과 browser에는 signed GET 및 human `get`을 발급하지 않음 |
| body 경로 | client·Agent와 private Storage 사이 직접 stream; Edge Function에 본문 없음 | local-service가 backpressure stream으로 전달 | public URL, 장기 URL, 익명 GET 모두 금지 |

Cloud upload target과 Local의 직접 `put`은 **유효한 recording consent와 external-STT consent가 모두 있고, 현재 healthy하며 이 기관에 eligible하고 capacity가 있는 Agent가 확인되는 경우에만** admission CAS를 통과한다. 이 CAS가 실패하면 Cloud upload target/Local upload를 거부하고 원음 object를 보관하지 않으며 D8 manual note를 즉시 공식 기록 경로로 제공한다. 통과한 Cloud target은 한 번만 유효하고 동일 key overwrite를 허용하지 않는다. upload completion은 session과 길이·MIME이 맞는 object를 `available`로 표시하되 client hash를 trusted hash로 승격하지 않는다. 직접 upload의 실제 bytes 검증은 첫 eligible claim의 Agent streamed re-hash가 담당한다. hash 불일치면 외부 STT provider를 호출하지 않고 영구 실패 cleanup을 시작하며 D8 수기 기록 경로를 제공한다.

`createDownloadTarget`는 매 mint 순간 live claim, claim generation, Agent 주체, 유효 동의 version, provider 설정·health·capacity를 확인한다. 발급 뒤 Storage가 직접 받는 bearer URL은 claim 해제·만료·동의 철회를 소급해 취소할 수 없다. 따라서 최대 600초의 bounded residual access를 허용하되 URL은 로그에 남기지 않고, lease가 끝나거나 동의가 철회된 뒤 새 URL을 mint하지 않는다. 동의 철회가 mint 뒤 발생하면 즉시 삭제 intent를 만들고 외부 STT 호출을 막으며, 이미 발급된 URL의 잔여 수명만 audit한다. 10분보다 긴 URL, human GET, Edge를 통한 body proxy는 금지한다. S5가 Agent principal·lease·heartbeat를 정의하고 이 문서는 참조만 한다.

외부 STT admission은 claim의 `effectiveConsentVersion`과 현재 유효 동의 version을 다시 대조하는 CAS 직후에만 허용한다. withdrawal CAS가 먼저 커밋되면 provider call은 0회이고, admission CAS가 먼저 커밋된 호출은 withdrawal 이후 새 호출로 간주하지 않으며 결과·삭제를 bounded residual로 조정한다. 동의 version이 없거나 stale이면 claim/start와 mint 모두 거부한다.

### 2.3 삭제 증거와 완료 판정

삭제 요청은 `audio_object_id`, `generationId`, `deletionAttemptId`를 가진 append-only 시도로 기록하고, 처리 결과 commit 뒤에는 모든 adapter에서 즉시 provider delete/unlink를 요청한다. Cloud는 upload target이 만료되기 전 terminal proof를 만들지 않으며, `upload_expires_at + 60 seconds` propagation wait 뒤 같은 generation에 re-delete하고 네 boolean을 모두 fresh하게 다시 계산한다. 각 delete 뒤 adapter의 propagation wait를 거친 한 verification cycle만 terminal CAS에 사용할 수 있다.

1. `deleteSucceeded`: 실제 object가 있으면 provider delete 2xx 또는 filesystem deletion journal의 durable accepted unlink/rename이 기록됨. never-uploaded pending key는 durable cleanup journal과 부재 검사가 함께 성립할 때만 true다.
2. `absentFromList`: provider list 또는 filesystem directory 조회에 해당 `generationId` object가 없다.
3. `absentFromMetadata`: provider metadata/head 또는 filesystem metadata 조회에 해당 generation이 없다.
4. `directReadAbsent`: 아래 adapter별 직접 읽기 증거가 성립한다.

네 값 중 하나라도 false, provider timeout/5xx, generation mismatch, propagation wait 미경과, evidence write 실패이면 terminal state로 바꾸지 않는다. 캐시된 true를 다음 cycle의 proof로 재사용하지 않으며, 성공·실패 모든 시도와 증거 write crash를 journal에서 재조정한다. `deletedAt`은 요청·판정 시각이 아니라 실제 provider delete/unlink 수락 시각이고, `verifiedAt`은 네 fresh boolean을 확인한 시각이다.

| adapter | `verificationMethod` | `directReadAbsent`의 증거 | delete acceptance |
|---|---|---|---|
| Supabase private Storage | `authenticated-get-404` | Agent/service 인증 GET이 404. list와 metadata/head는 별도 fresh 조회 | provider delete 2xx |
| encrypted filesystem | `filesystem-stat-enoent` | 암호화 파일 `stat`가 `ENOENT` | same-filesystem WAL/tombstone rename+fsync 또는 durable unlink journal |
| R2 reference adapter | `r2-head-absent` | binding `head(key)`가 부재 | binding delete 성공 응답 |

한 adapter의 부재 증거를 다른 adapter의 증거로 대체하지 않는다. generation을 식별할 수 없는 재생성 object는 evidence를 무효화하고 새 attempt로 시작한다. evidence가 네 true가 되기 전에 object가 다시 나타나면 terminal CAS는 실패해야 한다.

## 3. 정확한 상태 기계와 원음 시계

### 3.1 상태와 필드

`pending_upload`, `available`, `claimed`, `processing`, `deletion_pending`, `processed_deleted`, `unprocessed_expired`, `upload_abandoned`, `retention_capped`만 허용한다. `processed_deleted`, `unprocessed_expired`, `upload_abandoned`, `retention_capped`는 four-boolean fresh evidence가 durable하게 기록된 뒤의 terminal state다. `deletion_pending`의 closed reason enum은 `processed`, `unprocessed_expiry`, `rejected_upload`, `hash_mismatch`, `upload_abandoned`, `consent_withdrawal`, `processing_failed`, `retry_exhausted`, `retention_hard_cap`뿐이다.

`audio_objects`는 최소 `id`, `org_id`, `session_id`, `key`, `key_hash`, `state`, `generation_id`, `content_length`, `content_type`, `client_asserted_sha256`, `object_sha256`, `effective_consent_version`, `recording_consent_version`, `external_stt_consent_version`, `uploaded_at`, `upload_expires_at`, `retention_hard_cap_at`, `first_agent_available_at`, `processing_deadline_at`, `claim_id`, `claim_agent_id`, `claim_expires_at`, `processing_attempt_id`, `processing_started_at`, `processed_at`, `deletion_reason`, `deletion_attempt_id`, `next_attempt_at`, `retry_count`, `incident_outbox_key`, `manual_note_outbox_key`, `deleted_at`, `deletion_evidence`, `created_at`, `updated_at`을 가진다. provider idempotency/attempt audit는 S5의 result contract를 참조한다.

### 3.2 전이와 경합 규칙

| 현재 | 사건·원자 조건 | 다음 | 실패·경합 처리 |
|---|---|---|---|
| 없음 | recording/external-STT consent 유효 + 현재 healthy·eligible·capacity 있는 Agent 확인을 포함한 upload admission CAS 성공 후 intent 생성 | `pending_upload` | admission 실패면 원음 object를 만들지 않고 manual-note outbox만 공식 기록 |
| `pending_upload` | target upload 완료 후 길이·MIME 검증과 upload 시점에 capture한 recording/external-STT consent revision/effectiveness 재검사 | `available` | consent가 withdrawn/stale하거나 검증 실패면 `available`로 만들지 않고 `deletion_pending` (`consent_withdrawal` 또는 `rejected_upload`)로 즉시 cleanup; Cloud는 signed target expiry+60s까지 late/replayed bytes를 재조정 |
| `pending_upload` | 부분·wrong MIME·wrong length·target expiry, object가 있거나 cleanup 필요 | `deletion_pending` (`rejected_upload`/`upload_abandoned`) | objectSha는 trusted re-hash 전 null; same deletion evidence/retry path |
| `deletion_pending` (`rejected_upload`/`hash_mismatch`/`upload_abandoned`) | target expiry+60s 뒤 fresh four booleans true | `upload_abandoned` | 실제 Agent re-hash가 없을 때만 null hash 허용 |
| `available` | business-day gate 후 eligible Agent가 이 object의 claim CAS에 성공하고 configured STT provider가 healthy+capacity 있으며 recording/external-STT consent version이 CAS에 포함됨 (`retention_hard_cap_at > now`, `processing_deadline_at IS NULL OR processing_deadline_at > now`) | `claimed` 및 `first_agent_available_at` 기록 | 빈/global poll, STT off, unhealthy provider, capacity 없음, stale/withdrawn consent, 다른 object claim 실패는 기회를 만들지 않음 |
| `claimed` | claim owner가 Agent re-hash를 성공하고 processing-start CAS (`retention_hard_cap_at > now`, `processing_deadline_at > now`, consent version current) | `processing` | hash mismatch는 `deletion_pending` (`hash_mismatch`), provider call 0회, 늦은/비소유 start 거부 |
| `claimed` | lease 만료 recovery, deadline 전 | `available` | claim token 폐기·재claim 허용; first availability/deadline 보존 |
| `pending_upload`/`available`/`claimed`/`processing` | consent withdrawal CAS 승리 | `deletion_pending` (`consent_withdrawal`) | 즉시 delete/unlink intent·incident/manual-note outbox, 새 mint/provider call 0회 |
| `available`/`claimed`/`processing` | `processing_deadline_at` 도달; claim/processing token·lease와 new-mint authorization을 원자적으로 revoke | `deletion_pending` (`unprocessed_expiry`) | 즉시 delete/unlink; admin incident와 manual-note outbox를 같은 DB batch에 기록; 이미 발급된 nonrevocable URL은 expiry까지 bounded residual만 허용; CAS 승자만 가능, late claim/start/result는 거부 |
| `available`/`claimed`/`processing` | retry budget 소진 | `deletion_pending` (`retry_exhausted`) | committed result/deletion intent 중복 0건; manual note 제공 |
| `pending_upload`/`available`/`claimed`/`processing`/`deletion_pending` | `retention_hard_cap_at` 도달; claim/processing lease와 new-mint authorization을 원자적으로 revoke | `deletion_pending` (`retention_hard_cap`) | opportunity/result 유무와 무관하게 CAS 승자만 원음 delete; 즉시 delete/unlink와 admin incident/manual-note outbox를 같은 DB batch에 기록 |
| `processing` | successful STT/result commit과 processed deletion intent를 같은 DB batch/outbox 경계에서 기록하고, state·claim token·`processing_attempt_id`·current consent revision/effectiveness·`now < processing_deadline_at`·`now < retention_hard_cap_at` 조건을 만족 | `deletion_pending` (`processed`) | input/hash verification만으로 deletion intent를 만들지 않음; commit 직후 delete/unlink 요청 |
| `deletion_pending` | reason별 즉시 delete/unlink 후 adapter propagation wait와 generation-bound fresh delete/list/metadata/direct-read cycle four true | `processed_deleted` (`processed`) / `unprocessed_expired` (`unprocessed_expiry`, `consent_withdrawal`, `processing_failed`, `retry_exhausted`) / `upload_abandoned` (`rejected_upload`, `hash_mismatch`, `upload_abandoned`) / `retention_capped` (`retention_hard_cap`) | terminal CAS 한 번만 성공; incident/manual obligations가 함께 durable해야 함 |
| `deletion_pending` | boolean 일부 false, timeout, generation mismatch, evidence write 실패 | `deletion_pending` | 5분 주기 retry, exponential backoff max 1h+alert; false completion 0건 |

reason-to-terminal mapping은 닫힌다: `processed → processed_deleted`, `unprocessed_expiry → unprocessed_expired`, `consent_withdrawal → unprocessed_expired`, `processing_failed → unprocessed_expired`, `retry_exhausted → unprocessed_expired`, `rejected_upload → upload_abandoned`, `hash_mismatch → upload_abandoned`, `upload_abandoned → upload_abandoned`, `retention_hard_cap → retention_capped`. 이 매핑 밖의 deletion reason과 terminal 전이는 허용하지 않는다.

### 3.3 Q 승인 시계

Q가 ADR-0041 D81에서 승인한 `first_agent_available_at`은 **이 object에 대한 실제 기회**다. 기관 timezone은 `Asia/Seoul`로 고정하고 `kr-business-days-v1.json`이라는 versioned calendar를 사용한다. 토·일요일, 대한민국 public holiday와 substitute holiday는 비영업일이다. organization-specific closure는 calendar version에 명시된 날짜만 비영업일로 취급한다. calendar가 없거나 stale/버전 불일치면 새 upload target 발급과 business-day 계산을 fail-closed하고 관리자에게 고정 오류를 알린다.

`available` row의 다음 영업일 gate 뒤, (1) paired Agent가 이 row에 eligible하고, (2) 관리자가 명시한 STT mode/engine이 configured이며 health check를 통과하고, (3) 해당 Agent에 처리 capacity가 있고, (4) recording/external-STT consent의 유효 version이 claim CAS에 포함되고, (5) 이 row의 claim CAS가 성공한 경우에만 그 claim 성공 시각을 `first_agent_available_at`으로 기록한다. global queue poll, failed claim, empty claim, STT `off`, unhealthy/missing provider, capacity 없는 Agent, stale/withdrawn consent는 시계를 시작하지 않는다. 다른 eligible Agent가 같은 row의 claim을 먼저 성공한 경우에만 그 승자의 시각이 기회가 된다. 이 시각에 `processing_deadline_at = min(first_agent_available_at + 24h, retention_hard_cap_at)`을 한 번만 기록한다.

첫 기회가 오기 전에는 `processing_deadline_at`이 없고 expiry job이 원음을 upload+24h로 삭제할 수 없다. 첫 기회에 claim이 실패해도 시계가 시작되지 않는다. 첫 기회 뒤 deadline까지 성공 처리되지 않으면 `unprocessed_expiry`로 삭제하고 관리자 장애 상태를 남긴다. `retention_hard_cap_at = uploaded_at + 7*24h`는 absolute UTC cap이며, 기회·처리 결과 유무와 무관하게 그 시각에는 `retention_hard_cap`으로 원음을 삭제하고 incident와 manual-note outbox를 만든다. 처리 성공은 결과 commit과 함께 `processed` deletion intent를 기록하는 것이며, 삭제 요청은 그 직후 실행한다.

D8 watchdog은 org의 녹음·텍스트 queue를 합산한 마지막 successful Agent poll을 추적한다. 6시간 이상 poll이 없으면 durable administrator alert outbox를 만들고, 해소 전에는 매 24시간마다 한 번씩 재알린다. 이 poll alert는 object 기회를 만들지 않으며, manual note는 즉시 공식 기록 경로로 제공한다. provider 자동 전환과 재녹음 요구는 없다.

### 3.4 claim·delete·startup race와 reconcile

- expiry transition, claim/start, lease recovery, deletion terminal CAS는 state·claim/generation·deadline·retention cap·recording/external-STT consent version 조건을 포함한 단일 atomic CAS다. claim/start는 `retention_hard_cap_at > now`를 반드시 만족하고, 실제 기회가 시작된 row는 `processing_deadline_at > now`도 만족해야 한다. startup과 scheduler가 동시에 실행돼도 한 전이만 승리한다. deadline 또는 retention cap 도달 뒤 active claimed lease는 expiry를 이기지 못한다.
- `processing`은 result commit과 processed deletion intent가 같은 DB batch/outbox 경계에 있어야만 `deletion_pending(processed)`가 된다. Agent crash 뒤 재claim은 새 `processing_attempt_id`를 사용한다. 시스템이 보장하는 것은 committed result와 committed deletion intent의 중복 0건이며, crash 뒤 외부 STT 호출의 중복 가능성은 attempt/provider idempotency가 지원하는 범위에서만 줄이고 감사한다.
- result commit CAS는 `state=processing`, 현재 `claim_id`, `processing_attempt_id`, 현재 recording/external-STT consent revision/effectiveness, `now < processing_deadline_at`, `now < retention_hard_cap_at`을 모두 조건으로 한다. just-before-deadline만 공식화할 수 있고 at/after deadline의 결과는 거부한다.
- startup은 만료 claim/processing, deadline/cap 도래 row, `deletion_pending`, expired pending upload와 deletion journal을 모두 scan한다. object가 사라졌다는 사실만으로 `deleteSucceeded`를 true로 만들지 않으며 filesystem은 WAL/tombstone/journal로 unlink acceptance를 복구한다.
- reconcile은 5분마다 돌고 각 row의 `next_attempt_at`을 사용한다. 실패할 때 retry delay는 지수 증가해 최대 1시간이며 최대치 도달과 지속 실패는 administrator alert outbox를 만든다. restart에도 journal과 outbox를 읽어 같은 `deletionAttemptId`, incident key, manual-note key를 중복 commit하지 않는다.
- 처리 결과 commit 뒤 delete/unlink 요청은 즉시 실행한다. Cloud는 upload target expiry+60s 뒤 re-delete와 fresh verification cycle을 추가하고, Local/R2는 adapter propagation wait 뒤 fresh cycle을 수행한다.
- evidence write crash는 journal에서 attempt를 복구하고, terminal CAS 직전에 generation을 다시 비교한다. generation이 바뀌거나 object가 재출현하면 네 boolean을 폐기하고 새 cycle을 시작한다.
- expiry 전이, consent withdrawal, processing failure, retry exhaustion, retention cap, incident obligation, manual-note fallback obligation은 같은 DB batch/outbox에서 함께 durable하게 기록한다. crash가 어느 지점에서 나도 startup reconcile이 누락된 obligation을 stable key로 재생성하며 중복 incident/note를 만들지 않는다.

동의 철회가 claim 또는 mint와 경합하면 먼저 commit된 version CAS가 승리한다. 철회가 먼저면 claim/start·mint·외부 STT를 거부한다. signed GET 발급이 먼저면 직접 Storage bearer의 bounded residual만 허용하고 즉시 delete/unlink, 새 mint 금지, 외부 STT admission 거부와 `consent_withdrawal` 감사 기록을 남긴다.

## 4. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 저장소 | 기관 소유 Supabase private Storage만 사용 | 해당 PC 암호화 filesystem adapter | 서버 PC 암호화 filesystem adapter |
| upload/download target | 2h private upload / claim-scoped max 10m Agent GET | 두 target method `null` | 두 target method `null` |
| 본문 경로 | client·Agent와 private Storage 직접 stream; Edge body bytes 0 | local-service 인증 API backpressure stream | TLS 내부망 API backpressure stream |
| 직접 읽기 부재 | 인증 GET 404 | `stat` `ENOENT` | `stat` `ENOENT` |
| deletion acceptance | provider delete 2xx + fresh evidence | fsync된 WAL/tombstone/unlink journal + fresh evidence | fsync된 WAL/tombstone/unlink journal + fresh evidence |
| scheduler | Supabase pg_cron의 공통 runner, reconcile 5m | Node timer의 공통 runner, reconcile 5m | 서버 Node timer의 공통 runner, reconcile 5m |

R2 adapter는 E1-3의 계약/reference fixture로만 유지하며 Community Cloud의 정식 원음 저장소가 아니다. R2도 target method는 `null`, API는 streamed `put/get`, 직접 읽기 증거는 `head` 부재다.

## 5. 완료 조건

- [ ] stream, key grammar, 6개 MIME, 209,715,200-byte 상한, incremental hash와 target 반환 규칙이 §2에 완결되어 있다.
- [ ] Cloud private 2h upload(`upsert:false`), Agent-only max 600s GET, bearer non-revocation bound, human/browser GET 금지와 Local/R2 null target·stream API가 고정되어 있다.
- [ ] versioned Korea business calendar, object-specific real opportunity predicate, upload+24h 금지, first opportunity+24h limited by `retention_hard_cap_at = uploaded_at + 7*24h` UTC, 6h watchdog과 daily alert가 완결되어 있다.
- [ ] exact state machine에서 upload admission, claim/start/deadline/cap CAS, active-claim preemption, result-commit-before-delete, failed-upload cleanup, closed reason-to-terminal mapping, startup/reconcile race가 닫혀 있다.
- [ ] 네 fresh deletion boolean, generation/attempt binding, adapter별 acceptance/absence evidence, per-delete propagation wait와 false terminal 금지가 완결되어 있다.
- [ ] 아래 fixture 17종의 입력·기대 state/evidence/권한 결과와 검증 명령·실패 판정이 §6에 있다.

## 6. 검증 방법

구현 검증 시 저장소 루트에서 다음 명령을 실행한다.

- `pnpm test:contracts --audio=cloud`
- `pnpm test:contracts --audio=local-single`
- `pnpm test:contracts --audio=local-office`
- `pnpm test:contracts --audio=r2`
- `pnpm guard:audio-lifecycle`

각 adapter suite는 version `kr-business-days-v1.json`, timezone `Asia/Seoul`, 동일한 synthetic clock으로 실행한다.

| fixture | 입력·주입 | 기대 판정 |
|---|---|---|
| A1 valid stream | 허용 key, `audio/webm`, 1 MiB chunk stream | put/get hash 동일, bounded backpressure, `available` |
| A2 boundaries | 209,715,200 bytes와 209,715,201 bytes | 첫 입력 PASS, 둘째 reject; partial/overrun 성공 0건 |
| A3 invalid metadata | traversal key, 빈 MIME, `video/mp4`, 0 bytes | 모두 reject; rejected object는 deletion path, orphan 0건 |
| A4 Cloud targets | private bucket, `upsert:false`, mint/reuse/release | upload 정확히 2h; live claim Agent만 max 600s mint; URL은 로그 0건, release 뒤 새 mint 0건, bearer는 잔여 TTL만 허용; human GET 403/미발급; Edge body bytes 0 |
| A5 local/R2 targets | encrypted filesystem 및 R2 reference adapter | 두 target 모두 `null`; put/get streamed; filesystem `ENOENT`, R2 `head` 부재 method 일치 |
| A6 calendar and opportunity | 토·일, KR public/substitute holiday, missing/stale calendar, STT off/unhealthy, empty/global poll, ineligible/capacity 없음, withdrawn/stale consent | calendar 오류는 새 target fail-closed; 모든 negative event에서 first availability/deadline 미생성; withdrawal/stale consent가 CAS에서 이기면 claim·mint reject와 provider call 0회; eligible Agent의 object claim 성공 한 번만 real opportunity |
| A7 business clock | 금요일 2026-09-04 upload, 다음 영업일 holiday를 calendar에 주입해 화요일 첫 eligible claim | upload+24h 삭제 0건; 화요일 object-specific claim 시각에만 first availability 기록; deadline `min(opportunity+24h, uploaded+7d)`; 그 전 보존 |
| A8 no-poll watchdog | Agent successful poll 없음, 6h/24h watchdog, 7*24h UTC cap 도달 | 6h alert 1건 후 daily alert; cap 전 deadline/terminal 임의 생성 없음; cap에서 retention deletion+incident/manual-note outbox; manual note 1건, 재녹음 CTA 0건 |
| A9 immediate result deletion | claim Agent re-hash PASS, STT result commit+processed intent same batch | input/hash 확인만으로 delete 0건; result commit 직후 모든 adapter에서 delete/unlink 요청; fresh four true 뒤 `processed_deleted` |
| A10 forged hash | Cloud client asserts wrong hash; first claim re-hash mismatch | provider call 0회, client/actual hash 각각 보존, trusted object hash mismatch cleanup `deletion_pending(hash_mismatch)`; manual note, 재녹음 CTA 0건 |
| A11 claim/start/deadline race | two eligible Agents, just-before/at/after `processing_deadline_at`, delayed scheduler, active processing, late result | only just-before-deadline processing can officialize when result CAS has state/claim/attempt/current consent and both clocks; at/after deadline CAS preempts with `unprocessed_expiry`, immediate delete, admin incident/manual-note outbox; late claim/start/result reject; committed result/deletion intent duplicate 0건 |
| A12 deletion/reconcile crash | delete/unlink 뒤 evidence write crash, one fresh absence false, generation reappearance, restart | stale true 재사용 0건; journal 복구·5m retry·max1h alert; same attempt/outbox idempotent; fresh four true+generation match일 때만 terminal; duplicate incident/note 0건 |
| A13 upload admission | recording 또는 external-STT consent 없음, healthy eligible Agent 없음, provider unhealthy/capacity 없음 | upload target/직접 put reject; 원음 object 0건; manual-note outbox 1건; client/body가 Storage에 도달하지 않음 |
| A14 consent and cap race | URL mint 뒤 withdrawal, claim/start withdrawal race, result 직전 withdrawal, `retention_hard_cap_at` exact boundary | 새 mint/provider call 0건 after withdrawal CAS; issued URL residual only; cap CAS가 active lease/result와 무관하게 `retention_hard_cap`으로 승리; just-before cap officializes only with result CAS; at/after cap late result reject; reason별 terminal mapping과 four fresh evidence 적용 |
| A15 mint-withdraw-late-upload | Cloud upload target mint 후 consent 철회, signed target을 재사용한 late upload와 completion | consent revision 재검사 실패, `available` 전이·STT call 0건; late bytes는 `consent_withdrawal` cleanup; target expiry+60s 뒤 fresh four evidence |
| A16 local-midstream-withdrawal | Local `put` streamed body 중간에 consent 철회 | stream abort/discard, `available` 전이·STT call 0건; `consent_withdrawal` incident/manual-note outbox; 원음 orphan 0건 |
| A17 processing failure vs retry exhaustion | provider preflight permanent failure, transient failures until retry budget exhausted, result commit crash | permanent path는 `processing_failed`로 즉시 delete+incident/manual-note; transient path는 `retry_exhausted`로 terminal mapping; processed result/deletion intent 중복 0건 |

A1~A17 중 하나라도 four boolean이 fresh true가 아닌 상태에서 terminal을 만들거나, upload+24h로 A7을 삭제하거나, `uploaded_at + 7*24h` UTC cap을 넘기거나, retention cap 사유가 아닌데 full opportunity window 전에 삭제하거나, human/public/long URL·stale consent call·re-record CTA·provider automatic fallback이 관찰되면 suite와 `guard:audio-lifecycle`은 실패한다. 기존 assertion 삭제·skip·완화도 실패다.

## 7. 이번에 안 하는 것

- 실제 Supabase apply/install과 서울 리전·Auth·RLS baseline은 SG11/E6-1b가 소유한다(ADR-0042 read-only `plan`은 보존).
- Agent principal, pairing, lease·heartbeat, result commit과 provider attempt semantics는 SG5/E5-1a가 소유한다.
- DPAPI와 key 위치는 SG9, `.cccx` 첨부 export/import와 복구는 SG10이 소유한다. 이 문서는 해당 계약을 복제하지 않고 AudioStore 경계만 참조한다.
- STT engine 선택·benchmark·Azure 외부 이전 조건은 D77·SG13·E5-2/E5-3 범위다. 실패 시 manual note 규칙은 이 문서에서 유지한다.
- 실제 adapter 구현, migrations, provider 계정과 운영 삭제 영수증은 E1-3/E5-6/E6-3/E7-1a/E8-9의 산출물이며 이 문서의 `확정` 조건이 아니다.
