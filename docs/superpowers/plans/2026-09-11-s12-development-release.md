# S12 개발판 릴리스 구현 계획 (S12-D1)

설계 정본: `docs/superpowers/specs/2026-09-11-s12-development-release-design.md`
계약 정본: `docs/specs/S12-install-release.md` (2026-09-11 §2.3, §6 예외 반영)

## Global Constraints

- 모든 서명 객체는 중복 키 거부 파서로 읽고, 닫힌 정확 스키마를 확인하고, 서명 속성 하나만 제거한
  나머지를 RFC 8785 JCS UTF-8로 정규화한 뒤 고정 ASCII 도메인 접두를 붙여 검증한다.
- 릴리스 객체 서명은 unpadded base64url 86자, 공개키는 unpadded base64url 43자다. baseline 모듈의
  표준 Base64 88자 형식과 섞지 않는다.
- 도메인 접두: `CCC-RELEASE-MANIFEST-V1\0`, `CCC-RELEASE-BUNDLE-V1\0`,
  `CCC-EDGE-COMPONENT-MANIFEST-V1\0`.
- 문서 상한 1 MiB, 문자열 상한 4096 UTF-8 바이트를 기존 규칙과 같게 적용한다.
- `PINNED_RELEASE_ORIGIN`은 코드 상수 하나이며 명령행이나 환경변수로 덮어쓸 수 없다. 테스트는
  전용 주입 지점만 사용한다.
- 실패는 전부 fail-closed다. 어떤 실패에서도 다운로드한 바이트를 승격하거나 DB에 쓰지 않는다.
- 출력에는 URL, 토큰, 키, 서명, 연결 문자열, 공급자 원문 오류, 기관과 사람 식별값을 넣지 않는다.
- 기존 S11 journal 기본기를 재사용한다. 두 번째 journal을 만들지 않는다.
- 실제 provider 호출, 실데이터, 배포, AI, STT는 이 계획의 구현 작업 범위 밖이다. 실제 발급과 설치는
  Main이 직접 수행한다.

## Interfaces

```js
// scripts/release/release-manifest.mjs
export function verifyReleaseManifest({ document, trustStore, now, expectedTuple, bundleEntry })
export function verifyReleaseBundle({ document, rootKeys, revokedRootKeyIds, now, channel })
export function parseArtifactBasename(url)           // => { family, mode, version, platform, arch, ext }
export function requireExpectedTuple(parsed, expected)

// scripts/release/release-trust.mjs
export function loadReleaseTrustStore(value)         // closed schema, next|active|retired|revoked
export function selectSigningKey(trustStore, keyId, now, { allowRetiredForRollback })

// scripts/release/release-origin.mjs
export function fetchPinnedRelease({ fetchImpl, floorStore, now })
// => { bundle, trustedTime, floor }

// scripts/release/build-bundle.mjs  (CLI)
// scripts/release/edge-component-manifest.mjs
export function buildEdgeComponentManifest(componentRoot)
export function verifyEdgeComponentManifest({ document, stagedRoot, bundleRow, trustStore })
```

---

### Task 1: 릴리스 manifest, 묶음, tuple, 신뢰 목록

**Files:**
- Create: `scripts/release/release-manifest.mjs`
- Create: `scripts/release/release-manifest.test.mjs`
- Create: `scripts/release/release-trust.mjs`
- Create: `scripts/release/release-trust.test.mjs`

**Interfaces:** 위 Interfaces의 `release-manifest.mjs`, `release-trust.mjs`.

- [ ] **Step 1: 실패하는 계약 테스트 먼저**

`ReleaseManifestV1` 열두 필드 정확 일치, 누락과 추가 필드 거부, 중복 키 거부, 잘못된 enum 거부,
`publishedAt <= now < expiresAt`, schema 범위, HTTPS same-origin, 서명 검증, 길이 규칙을 assert한다.
`ReleaseBundleV1`은 `stable`에서 다섯 family row 요구, `dev`와 `beta`에서 1개 이상 5개 이하 허용,
중복 family 거부, `community-cloud-cli` row만 non-null `edgeComponentManifestSha256`,
`sequenceFloor`가 모든 record tuple을 덮는지, `protocol.peers` 중복과 미지 이름 거부를 assert한다.
신뢰 목록은 `next|active|retired|revoked` 상태 전이 없이 조회만 하며, unknown과 revoked 거부,
retired는 rollback 예외에서만 허용을 assert한다.

- [ ] **Step 2: 최소 구현**

`manifest-preflight.mjs`의 중복 키 거부 리더와 `@ccc/contracts`의 JCS를 재사용한다. 서명 검증은
`apps/community-cloud/src/install-manifest-verifier.ts`의 Ed25519 원시 함수를 쓰되 도메인 접두를
붙이는 경로를 이 모듈에 둔다. 파일명 파서는 한 번만 percent-decode하고 마지막 segment만 받으며
`.`, `..`, 재decode, query, fragment, 대소문자 변형, 허용되지 않은 family와 mode 조합을 거부한다.

- [ ] **Step 3: 검증**

```bash
node --test scripts/release/release-manifest.test.mjs scripts/release/release-trust.test.mjs
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/release/release-manifest.mjs scripts/release/release-manifest.test.mjs scripts/release/release-trust.mjs scripts/release/release-trust.test.mjs
git commit -m "feat(release): verify signed release manifests and bundles"
```

---

### Task 2: 고정 출처, floor, 신뢰 시각

**Files:**
- Create: `scripts/release/release-origin.mjs`
- Create: `scripts/release/release-origin.test.mjs`
- Create: `scripts/release/release-floor.mjs`
- Create: `scripts/release/release-floor.test.mjs`

**Interfaces:** 위 `release-origin.mjs`. floor 저장소는 소유자 전용 파일 하나이며 원자적으로 쓴다.

- [ ] **Step 1: 실패하는 테스트 먼저**

주입한 fetch로 다음을 assert한다. 고정 출처가 아닌 주소 거부, TLS 검증 실패 거부, `Date` 헤더 없음
또는 서명 lifetime 밖이면 `TRUSTED_TIME_UNAVAILABLE`, 저장된 `lastTrustedTime`보다 과거면
`TRUSTED_TIME_ROLLBACK`, 원격 floor가 내장 factory floor보다 낮으면 거부, 저장은 항상
`max(기존, 서명된)`. 로컬 시계로 대체하는 경로가 없음을 코드 경로로 증명한다.

- [ ] **Step 2: 최소 구현**

floor 저장소는 소유자 전용 파일에 원자적 교체로 쓰고, 손상되었거나 읽을 수 없으면 실패한다.
사용자 입력으로 경로를 받지 않는다.

- [ ] **Step 3: 검증**

```bash
node --test scripts/release/release-origin.test.mjs scripts/release/release-floor.test.mjs
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/release/release-origin.mjs scripts/release/release-origin.test.mjs scripts/release/release-floor.mjs scripts/release/release-floor.test.mjs
git commit -m "feat(release): bind pinned origin floor and trusted time"
```

---

### Task 3: Edge component manifest와 개발판 묶음 빌더

**Files:**
- Create: `scripts/release/edge-component-manifest.mjs`
- Create: `scripts/release/edge-component-manifest.test.mjs`
- Create: `scripts/release/build-bundle.mjs`
- Create: `scripts/release/build-bundle.test.mjs`
- Modify: `package.json`

**Interfaces:** 위 `edge-component-manifest.mjs`. 빌더 CLI는
`--component-root`, `--out-dir`, `--version`, `--sequence`, `--channel` 다섯 플래그만 받는다.

- [ ] **Step 1: 실패하는 테스트 먼저**

component 목록이 path UTF-8 사전순, 중복 0건, `.`과 `..`과 절대 경로와 링크 0건임을 assert한다.
`edgeArtifactSha256`가 정렬된 component record 배열의 JCS SHA-256과 같아야 하고, 문서 자체의
SHA-256이 묶음 row 값과 같아야 한다. 빌더는 개발 채널에서 실제 존재하는 family만 담고, 키를
주입으로만 받으며, 출력 파일을 배타적으로 만들고 실패 시 아무 파일도 남기지 않는다.

- [ ] **Step 2: 최소 구현**

빌더는 CLI artifact, 그 manifest, 서명된 묶음, floor 네 파일을 만든다. 서명 키는 환경변수 주입만
읽고 값을 출력하지 않는다. 성공 출력은 버전, sequence, 개수, 해시뿐이다.

- [ ] **Step 3: 검증**

```bash
node --test scripts/release/edge-component-manifest.test.mjs scripts/release/build-bundle.test.mjs
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/release/edge-component-manifest.mjs scripts/release/edge-component-manifest.test.mjs scripts/release/build-bundle.mjs scripts/release/build-bundle.test.mjs package.json
git commit -m "feat(release): build signed development release bundles"
```

---

### Task 4: apply 실행기와 첫 설치 백업 면제

**Files:**
- Create: `scripts/supabase/apply.mjs`
- Create: `scripts/supabase/apply.test.mjs`
- Modify: `scripts/supabase/bootstrap.mjs`
- Modify: `scripts/supabase/bootstrap.test.mjs`
- Modify: `apps/community-cloud/src/main.ts`
- Modify: `apps/community-cloud/test/installer-private-key.test.mjs`

**Interfaces:** `export async function applyInstallation({ authorization, providerBaseline, plan, release, inspector, journalSession, now })`

- [ ] **Step 1: 실패하는 테스트 먼저**

순서를 assert한다. 묶음, manifest, tuple, hash, Edge component 검증을 모두 통과한 뒤에만 lock을
잡고, journal `prepared`를 남기고, 승격하고, health를 확인하고, `installed`와 receipt를 쓴다.
어느 단계 실패든 DB 쓰기 0건 또는 journal이 미완료로 남고 승격 0건임을 assert한다. 첫 설치 백업
면제는 업무 표, 행, Auth 사용자, bucket, Storage 객체, 공개 routine과 type, private 표가 모두 0이고
journal이 없을 때만 적용되며 `backup: not_applicable`과 근거 수치를 남긴다. 하나라도 0이 아니면
`BACKUP_FAILED`로 막힌다.

- [ ] **Step 2: 최소 구현**

`bootstrap.mjs:212`의 stub을 실행기 호출로 바꾼다. 기존 `startInstallStep`과 `completeInstallStep`,
advisory lock을 재사용한다. `--manifest-url` 플래그를 apply에 추가하고 기존 플래그 화이트리스트
규칙을 유지한다. 릴리스 키 이름 세 개를 업무 런타임 금지 목록에 추가하고 빈 값도 거부한다.

- [ ] **Step 3: 검증**

```bash
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/apply.test.mjs scripts/supabase/bootstrap.test.mjs scripts/supabase/plan.test.mjs apps/community-cloud/test/installer-private-key.test.mjs
CCC_INSTALL_JOURNAL_TEST_DATABASE_URL=<주입> node --test scripts/supabase/install-journal.test.mjs
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/supabase/apply.mjs scripts/supabase/apply.test.mjs scripts/supabase/bootstrap.mjs scripts/supabase/bootstrap.test.mjs apps/community-cloud/src/main.ts apps/community-cloud/test/installer-private-key.test.mjs
git commit -m "feat(supabase): execute verified development installation"
```

---

### Task 5: 수집 시점 redaction 보고서와 ledger 기반 doctor

**Files:**
- Create: `scripts/supabase/report.mjs`
- Create: `scripts/supabase/report.test.mjs`
- Modify: `scripts/supabase/plan.mjs`
- Modify: `scripts/supabase/plan.test.mjs`
- Modify: `scripts/supabase/bootstrap.mjs`

**Interfaces:** `export function buildRedactedReport({ doctor, ledger, nonce })` 는 S12 §7.2의
`RedactedReportV1` 모양만 만든다.

- [ ] **Step 1: 실패하는 테스트 먼저**

보고서는 수집 시점에 redaction한다. 원문을 모았다가 나중에 치환하는 경로가 없어야 한다.
URL은 전부 `<redacted-url>`이고, 진단용 내부 ID는 보고서마다 새 nonce로 만든
`HMAC-SHA-256` 앞 12 hex이며 nonce와 원문을 저장하지 않는다. `report --output`은 실패 시 부분
파일을 남기지 않는다. doctor는 설치 journal과 receipt, 묶음 식별자를 실제로 읽어 PASS, FAIL,
NOT_RUN과 복구 문구를 낸다.

- [ ] **Step 2: 최소 구현**

`bootstrap.mjs`의 사후 문자열 검사는 남기되 보고서 경로는 수집 시점 redaction을 쓴다.

- [ ] **Step 3: 검증**

```bash
node --test scripts/supabase/report.test.mjs scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/supabase/report.mjs scripts/supabase/report.test.mjs scripts/supabase/plan.mjs scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.mjs
git commit -m "feat(supabase): report installation state without secrets"
```

---

### Task 6: StorageSigner의 매 요청 온라인 권한 확인

2026-09-11 Q가 권장안을 선택했다. S11 §2.7의 온라인 확인 계약을 적용하며, 이전 허용 결과를
캐시하거나 요청 본문의 `principal`을 신원으로 믿지 않는다.

**소유 경계**

- API 쪽: `packages/contracts/src/audio.ts`의 닫힌 DTO와 decoder,
  `packages/core/src/gateway.ts`의 기존 권한 검사 재사용,
  `packages/http-api/src/request-handler.ts`의 `POST /internal/storage/authorize`,
  `apps/api/test/storage-signer-authorization.test.ts`.
- Signer 쪽: `apps/community-cloud/src/storage-signer.ts`의 독립 handler와
  `apps/api/test/storage-signer.test.ts`. 업무 DB나 공통 업무 handler를 import하지 않는다.
- 통합: 기존 Cloud build에 독립 bundle을 연결하고 API와 Signer 사이 왕복을 검증한다.

```ts
authorizeStorageSignerOperation(env, canonicalActor, request): Promise<StorageSignerDecision>
decodeStorageSignerRequest(value: unknown): StorageSignerRequest
decodeStorageSignerDecision(value: unknown): StorageSignerDecision
```

판정은 `{ allowed: true, requestSha256, generationId, authorizedAt,
authorizationExpiresAt, expiresAt }`만 반환한다. 요청 hash는 전체 요청의 JCS SHA-256이며,
판정 유효기간은 최대 5초다. 업로드와 Agent 읽기의 URL 만료는 S8 및 현재 DB의 기한으로 제한한다.
삭제와 metadata 조회에는 URL 만료를 반환하지 않는다.

- [ ] 원래 Bearer를 기존 Identity로 다시 검증하고, 같은 기관의 현재 담당·사업 정책·동의·claim을
  gateway에서 확인한다. 조회 전용 검증에서 새 업로드나 claim을 만들지 않는다.
- [ ] 삭제와 삭제 확인은 기존 `deletion_pending` 및 정확한 삭제 시도 기록을 확인한다.
  철회가 삭제 이유일 수 있으므로 새 녹음 동의를 요구하지 않는다.
- [ ] Signer는 고정 API 주소만 호출하고 original Bearer만 전달한다. Storage 관리자 키는 보내지
  않는다. timeout·redirect·잘못된 설치 ID·요청 hash·만료·형식 오류는 Storage 호출 전에 거부한다.
- [ ] 성공 후 다음 요청에서 철회·담당 변경·lease 만료·API 장애가 발생하면 이전 허용을 재사용하지
  않고 거부하는 회귀 검사를 남긴다. Signer의 삭제 수락을 S8의 네 가지 삭제 증거로 바꾸어 적지 않는다.
- [ ] 실제 Supabase API가 URL 만료나 generation 조건을 지원하는지 확인한다. 지원하지 않는 조건을
  mock으로 충족했다고 간주하거나 임의의 성공 응답으로 대체하지 않는다.

```sh
pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/storage-signer-authorization.test.ts apps/api/test/storage-signer.test.ts
pnpm --filter @ccc/community-cloud build
pnpm --filter @ccc/community-cloud typecheck
```

현재 Community Cloud runtime의 Identity는 human용이고 `audioStore`는 연결되지 않았다.
이 사실을 JSON의 `principal`이나 테스트 resolver로 대신하지 않는다. Agent와 scheduler의 실제 인증,
AudioStore 배선, provider 배포 및 전체 설치 성공은 그 경로가 실제로 연결되어 검증되기 전에는
완료로 표기하지 않는다.

### Task 7: 업로드 상한을 판정 시각에 고정하고 signed upload를 mint한다

Task 6는 hosted Supabase의 signed upload TTL이 요청으로 정해지지 않아 업로드를 501로 닫았다.
S8 §2.2와 S11 §2.7의 2026-09-11 개정이 상한을 판정 유효기한 + 2시간으로 옮긴다.

**Files:**
- Modify: `packages/core/src/gateway.ts` (`authorizePendingStorageUpload`: `upload` 동작만 상한 CAS)
- Modify: `packages/http-api/src/request-handler.ts` (`handleAudioUploadTarget`: 상한 비교)
- Modify: `apps/community-cloud/src/storage-signer.ts` (`upload` mint와 provider 만료 증명)
- Modify: `apps/api/test/storage-signer-authorization.test.ts`, `apps/api/test/storage-signer.test.ts`

- [ ] `upload` 판정은 `UPDATE audio_objects SET upload_expires_at=?,updated_at=? WHERE id=? AND org_id=?
      AND key=? AND generation_id=? AND state='pending_upload' AND audio_delivery='protected-get'
      AND upload_expires_at>? AND upload_expires_at<? AND retention_hard_cap_at>=?` 한 문장으로 상한을
      `authorizationExpiresAt + 2h`로 옮기고, 변경 0행이면 거부한다. `head`는 아무것도 쓰지 않는다.
- [ ] 판정의 `expiresAt`은 옮긴 상한이다. 같은 object를 다시 판정하면 상한이 다시 앞으로 간다.
- [ ] `handleAudioUploadTarget`은 target의 `expiresAt`이 다시 읽은 `upload_expires_at`을 넘으면
      abandon한다. 정확히 같아야 한다는 이전 검사는 없앤다.
- [ ] signer는 판정의 `expiresAt - authorizationExpiresAt <= 2h`를 요구하고,
      `POST /storage/v1/object/upload/sign/ccc-audio/<key>`로 mint한 뒤 token의 `exp`, `url`,
      `upsert` 부재를 읽어 상한 안일 때만 같은 프로젝트의 절대 URL과 증명된 만료를 내준다.
      공식 storage-api 소스로 claim 이름을 확인하고, 확인되지 않은 claim은 거부 조건으로 둔다.
- [ ] 테스트: 상한 이동과 단조성, 보존 상한 초과 거부, head 무변경, target 상한 초과 abandon,
      provider token이 상한을 넘거나 `upsert`이거나 다른 object를 가리키면 URL 미발급.

### Task 8: 스케줄러 공유 비밀 신원과 `/internal/scheduler/run`

2026-09-12 Q 확정: S2 §2.6 공유 비밀이 정본이다(S11 §2.8 서명 token 폐기). Agent 페어링(E6-4)은 이 뒤다.

**Files:**
- Create: `packages/http-api/src/scheduler-identity.ts` (SecretStore의 `SCHEDULER_SECRET`과 상수 시간 비교, system Actor 생성, 아니면 안쪽 resolver로 위임)
- Modify: `packages/http-api/src/request-handler.ts` (`POST /internal/scheduler/run`)
- Modify: `packages/core/src/scheduled-job-runner.ts` (`dueScheduledJobKinds(nowIso)`: `audio_expiry` 5분, `counseling_memory` 2분, `pipeline_watchdog` 30분, `pii_retention` 매일 03:00 UTC 기준은 기존 `apps/api/src/cron-schedule.ts`와 같은 값)
- Modify: `apps/community-cloud/src/runtime.ts` (identity 앞단에 scheduler 신원 합성. `audioStore`가 null이면 route는 503)
- Create: `apps/api/test/scheduler-run.test.ts`

- [ ] bearer가 비밀과 다르면 안쪽 resolver로 넘기고, 같으면 S2 §2.6 개정의 system Actor를 만든다. 비밀이 SecretStore에 없으면 scheduler lane은 존재하지 않는다(모든 요청 위임).
- [ ] `/internal/scheduler/run`: POST, `Origin` 있으면 403, system+`scheduler-secret`+`scheduler:run` 아니면 403, body는 `{}` 또는 빈 JSON 객체만. 서버 시각으로 due kind를 정해 순서대로 runner를 부르고 kind별 JobReport 요약을 JSON으로 돌려준다. body의 시각을 믿지 않는다.
- [ ] scheduler Actor로 다른 업무 route를 부르면 403이다(기존 인증 경계에 kind='system' 거부가 없으면 추가).
- [ ] 테스트: 비밀 일치·불일치·부재, Origin 403, due kind 계산 경계(03:00, 5분, 30분), 업무 route 403, `/internal/storage/authorize` scheduler lane이 이 Actor로 실제 통과.

### Task 9: Signer 부재 증거 `absence` 동작

S8 §2.3의 Supabase 네 boolean 중 `absentFromList`, `absentFromMetadata`, `directReadAbsent`는 Signer만 만들 수 있다.

**Files:**
- Modify: `packages/contracts/src/audio.ts` (action에 `absence` 추가, deletion context 전용)
- Modify: `packages/core/src/gateway.ts` (scheduler lane이 `absence`를 `delete`와 같은 근거로 허용, URL 만료 없음)
- Modify: `apps/community-cloud/src/storage-signer.ts` (`verifyAbsence`)
- Modify: `apps/api/test/storage-signer.test.ts`, `apps/api/test/storage-signer-authorization.test.ts`

- [ ] 판정 뒤 세 조회를 모두 새로 한다: `POST /object/list/ccc-audio` (prefix=key의 상위 경로, search=마지막 segment, limit 소수)에 같은 이름이 없거나 있어도 head의 version이 다르면 `absentFromList`; `GET /object/info/ccc-audio/<key>?versionId=`가 404이면 `absentFromMetadata`; `GET /object/authenticated/ccc-audio/<key>?versionId=`에 `Range: bytes=0-0`으로 요청해 404이면 `directReadAbsent`. 200이 오면 body를 즉시 버리고 false다. timeout·5xx·형식 오류는 boolean이 아니라 `STORAGE_UNAVAILABLE`이다.
- [ ] 응답은 `{action:'absence', generationId, absentFromList, absentFromMetadata, directReadAbsent, verifiedAt}`뿐이다. 이름, 크기, 원음 byte, provider 문구는 내보내지 않는다.
- [ ] 테스트: 세 조회 각각 존재·부재, generation 다른 object 존재 시 list는 부재, 5xx는 실패 코드, 200 body 미소비, 허용 경로가 delete와 같은 근거(철회 뒤 유지, stale attempt 거부).

### Task 10: Signer 기반 AudioStore와 Cloud runtime 배선

Cloud runtime의 `audioStore`는 null이고 Signer 번들에는 진입점이 없다. 업무 API는 원음 byte를 만지지 않고
Signer에게 서명·삭제·부재 증거를 맡긴다. 호출자의 Bearer가 그대로 Signer로 가고 Signer가 §2.7 콜백으로
되돌아오므로, Signer 주소는 서명된 설치 manifest의 `supabaseAuthOrigin`에서만 만든다(미서명 env 주소 금지).

**Files:**
- Modify: `packages/contracts/src/runtime.ts` (`AudioStoreBinding` = `StorageSignerRequest['context']`; `get`·`delete`·`createUploadTarget`·`createDownloadTarget`에 선택 인자 `binding`; `AudioDownload.expiresAt`을 `string | null`로)
- Modify: `packages/http-api/src/request-handler.ts`, `packages/core/src/gateway.ts` (호출 자리에 binding 전달: upload target·완료 head는 `{kind:'upload', audioObjectId}`, Agent 읽기는 `{kind:'claim', jobId, claimToken, attempt}`, reconcile 삭제는 행의 `{kind:'deletion', audioObjectId, generationId, deletionAttemptId}`)
- Create: `adapters/audio-signer/` (`@ccc/audio-signer`, `createSignerAudioStore({ signerUrl, authorization, installationId, fetch?, now? })`)
- Modify: `apps/community-cloud/src/runtime.ts` (요청마다 그 요청의 Authorization으로 어댑터 생성)
- Create: `apps/community-cloud/src/storage-signer-main.ts` (Deno 진입점), Modify: `apps/community-cloud/build.mjs`, `apps/community-cloud/RUN.md`
- Create: `adapters/audio-signer/test/*.test.ts`, `apps/api/test/audio-signer.e2e.test.ts`

- [ ] 어댑터는 binding이 없거나 종류가 맞지 않으면 예외다. `put`은 항상 예외(Cloud는 byte를 받지 않는다). `get`은 Signer `head`로 metadata만 채우고 body는 읽는 즉시 오류를 내는 stream, `sha256`은 null, `expiresAt`은 null이다. `delete`는 `delete` 뒤 `absence`를 새로 호출해 네 boolean을 만들고 `verificationMethod='authenticated-get-404'`, `deletedAt`은 provider 수락 시각, `verifiedAt`은 absence 응답 시각이다. `createUploadTarget`·`createDownloadTarget`은 각각 `upload`·`agent_read`의 `{url, expiresAt}`를 그대로 돌려준다.
- [ ] 어댑터는 Signer 응답의 `x-ccc-installation-id`가 다르거나, 키가 계약과 다르거나, 실패 코드면 예외를 던진다. 허용 결과를 만들어내지 않는다. Signer 요청에는 `Origin`을 싣지 않는다.
- [ ] runtime은 `signerUrl = ${manifest.supabaseAuthOrigin}/functions/v1/ccc-storage-signer`, `authorization = 요청의 Authorization`으로 요청마다 어댑터를 만든다. Authorization이 없는 요청은 어댑터가 첫 호출에서 예외다.
- [ ] Signer 진입점은 `CCC_INSTALL_MANIFEST`·`CCC_INSTALL_SIGNING_KEYS`를 runtime과 같은 방식으로 검증하고 `SUPABASE_SERVICE_ROLE_KEY`를 요구하며, 업무 비밀(`CCC_DATABASE_URL`, `CODEX_API_KEY`, `PII_ENC_KEY`, `SCHEDULER_SECRET`)이 있으면 기동을 거부한다. Edge Function은 `verify_jwt=false`로 배포해야 하며 RUN.md에 적는다.
- [ ] 테스트: 어댑터 단위(각 동작의 요청 본문·principal·binding 오류·설치 ID 불일치·실패 코드 전파·body 미제공)와 종단 1건: 실제 `handleRequest` + 실제 Signer handler + 가짜 provider로 upload target 발급 → 완료 head → 동의 철회 → scheduler Bearer의 reconcile이 delete·absence를 거쳐 네 true로 terminal 전환.

### Task 11: E6-4 Agent 페어링과 `agent-bearer` 신원

2026-09-12 Q 순서: 스케줄러 다음. S2 §2.2 Agent 행(L64), 연결 users 행 규칙(L94), hash 결합(L96), TTL(L135-136),
`CCC_OPEN_PILOT_PLAN.md` E6-4(10분 1회 pairing code, 회전 refresh token)를 그대로 따른다.

**Files:**
- Create: `migrations/sqlite/0061_agent_credentials.sql`, `migrations/postgres/0017_agent_credentials.sql`, parity checkpoint(`apps/api/test/support/migration-parity.ts`, `migrations/parity.yaml` 재생성), `db/schema.sql` 갱신
- Modify: `packages/core/src/gateway.ts` (`issueAgentPairingCode`(관리자), `redeemAgentPairingCode`, `rotateAgentRefreshCredential`, `resolveAgentBearer`, `revokeAgentInstallation`)
- Create: `packages/http-api/src/agent-identity.ts` (`createAgentBearerResolver({ env, inner })`), routes `POST /agents/pairing-codes`(관리자), `POST /agents/pair`, `POST /agents/token`, `POST /agents/:installationId/revoke`(관리자)
- Modify: `apps/community-cloud/src/runtime.ts`, `apps/api/src/index.ts` (scheduler lane 다음, 사람 신원 앞)
- Modify: `apps/pipeline/ccc_pipeline/api_client.py`, `config.py` (Bearer + refresh 교환, 비밀 출처는 주입 가능한 인터페이스. DPAPI backend는 E5-1b 그대로 미구현이며 합성 실행은 환경변수 backend만)
- Create: `apps/api/test/agent-pairing.test.ts`, Python 테스트 갱신

- [ ] 표 `agent_credentials(id, installation_id REFERENCES agent_installations, kind CHECK('pairing_code','refresh','bearer'), token_hash 64-hex UNIQUE, issued_at, expires_at, consumed_at, revoked_at)`. 값은 저장하지 않고 sha256 hex만 둔다. `agent_installations`에 열을 더하지 않는다.
- [ ] pairing code: 관리자가 같은 기관의 활성 `role='service'` users 행을 고르면 `agent_installations` 행과 10분·1회 code를 만든다. `POST /agents/pair`는 code hash 대조 후 `consumed_at`을 CAS로 쓰고 refresh(30일)·bearer(900초)를 발급한다. 재사용은 401.
- [ ] `POST /agents/token`: refresh hash 대조 → 이전 refresh를 `consumed_at`, 새 refresh와 새 bearer 발급(rotate-on-use). 소비된 refresh 재사용은 그 설치의 모든 자격을 `revoked_at`으로 닫고 `auth_revocations`에 `pairing-revoked`를 남긴다.
- [ ] Actor: `kind='agent'`, `userId='agent:<installationId>'`, `orgId`는 설치 행, `roles=['service']`, `scopes=AGENT_SCOPES`, `authn={source:'agent-bearer', assurance:'none', sessionId:null}`. 연결 users 행이 같은 기관·활성·`service`가 아니면 403, 설치 `revoked_at`이 있으면 401. bearer는 JWT가 아니며 사람 서명 키를 쓰지 않는다.
- [ ] 기존 legacy `cloudflare-access` service 투영은 E2-7까지 남기되, `agent-bearer` 레인이 앞에 온다. job 결합(`lease_owner`, `claim_agent_id`, memory `actor_id`)은 `actor.userId`를 그대로 쓰므로 새 형식이 일관되게 흐르는지 테스트로 증명한다.
- [ ] 테스트: pairing 발급·교환·재사용 401, refresh 회전과 재사용 시 전면 폐기, bearer 900초 만료, 설치 폐기 뒤 401, 연결 행 불일치 403, bearer로 claim→heartbeat→`/internal/storage/authorize` agent lane 통과, 사람 JWT는 이 레인을 지나쳐 기존 신원으로 감.

### Task 12: 설치 apply의 provider 단계(bucket, cron, Vault, Edge secret, Signer 배포)

S11 §2.8과 설치 순서(§2 84-94)를 따른다. 지금은 `storage_bucket`·`cron_job`·`edge_secret_binding`이 이름뿐이고
apply는 `migration` 종류 component만 받는다.

**Files:**
- Create: `scripts/supabase/provider-steps.mjs` (`applyProviderSteps({ session, authorization, management, apiBase, edgeComponents, secrets, authorize })`), `scripts/supabase/management-writes.mjs`
- Modify: `scripts/supabase/install-journal.mjs` (필요 시 step SQL), `scripts/release/edge-component-manifest.mjs`·`build-bundle.mjs` (`functions/ccc-storage-signer/index.js` = `dist/storage-signer.js`를 `function` 종류로 포함)
- Create: `scripts/supabase/provider-steps.test.mjs`

- [ ] `storage_bucket`: 설치 연결 SQL로 `storage.buckets`에 `ccc-audio`(`public=false`, `file_size_limit=209715200`, `allowed_mime_types`=여섯 오디오 MIME)를 만든다. 이미 있으면 소유 태그(`ccc.installation_id`)와 비공개 여부를 확인해 같으면 완료 처리, 다르면 `RESOURCE_OWNERSHIP_MISMATCH`.
- [ ] `cron_job`: `vault.create_secret(<SCHEDULER_SECRET>, 'ccc_scheduler_secret')` 뒤 `cron.schedule('ccc_scheduler_tick','* * * * *', net.http_post(url:=<apiBase>/internal/scheduler/run, headers: Authorization Bearer(vault.decrypted_secrets에서 읽음)·x-region ap-northeast-2·content-type json, body '{}'))`. secret 값은 SQL 문자열 literal이 아니라 파라미터 바인딩으로 넘기고 로그·journal에 남기지 않는다. 기존 job은 command hash 대조.
- [ ] `edge_secret_binding`: Management API `POST /v1/projects/{ref}/secrets`로 Signer의 `CCC_INSTALL_MANIFEST`·`CCC_INSTALL_SIGNING_KEYS`·`SUPABASE_SERVICE_ROLE_KEY`(주입받은 값) 세 이름만 묶고, `POST /v1/projects/{ref}/functions/deploy?slug=ccc-storage-signer`(multipart, `verify_jwt=false`, `import_map=false`)로 staged bytes만 배포한다. 배포 응답의 함수 id·version hash를 resource digest로 기록한다. 공식 문서(`https://api.supabase.com/api/v1`)로 요청 형태를 확인하고 인용한다.
- [ ] `requireMigrationComponents`는 `migration` N개 + `function` 1개(`functions/ccc-storage-signer/index.js`)를 정확히 요구하도록 바꾸고, 다른 종류·개수는 `EDGE_COMPONENT_SET_MISMATCH`.
- [ ] 테스트: 가짜 Management API(bootstrap.test.mjs의 `withManagementApi` 확장)와 SQL 기록 seam으로 각 단계의 idempotency key, 소유 태그, 재실행 시 관찰·완료 처리, 소유 불일치 중단, secret 값이 어떤 출력·journal에도 없음, function deploy multipart 형식.

### Task 13: 설치 health, `verifyDeploymentPrerequisites`, doctor 연동

`requireHealthyInstallation`(apply.mjs 540-556)이 요구하는 증거를 실제로 만든다.

**Files:**
- Modify: `scripts/supabase/apply.mjs` (`verifyDeploymentPrerequisites`, provider step 호출 순서: migration → provider steps → health → receipt), `scripts/supabase/bootstrap.mjs` (`applyInspector.health()`), `scripts/supabase/hosted-inspector.mjs`, `scripts/supabase/plan.mjs`(doctor 출력)
- Modify: `scripts/supabase/apply.test.mjs`, `bootstrap.test.mjs`

- [ ] `verifyDeploymentPrerequisites`: edge manifest에 `function` component가 정확히 1개이고 hash가 bundle row와 맞음, 첫 설치 백업 면제(§6 2026-09-11) 또는 검증된 backup 존재, `SCHEDULER_SECRET`·`SUPABASE_SERVICE_ROLE_KEY`가 주입됨(값 미출력). 아니면 고정 코드로 거부.
- [ ] `health()`: ① `restrictedDatabase`: 설치 연결로 `pg_roles`에서 `ccc_api`의 `rolsuper=false`·`rolbypassrls=false`를 읽고, `GET <apiBase>/readyz`가 200이면 `connected=true`(runtime 기동이 ccc_api 경계를 통과했다는 뜻. RUN.md 164-166). ② `storageSignerHealthy`: `POST <supabaseAuthOrigin>/functions/v1/ccc-storage-signer`에 body 없이 요청해 401 `{"code":"UNAUTHORIZED"}`와 `x-ccc-installation-id`가 manifest와 같으면 true. ③ `edgeRegionEvidence`: 같은 응답의 `x-sb-edge-region`을 `responseRegion`·`functionRegion`으로 읽고 `ap-northeast-2`와 대조. ④ `observedOwnerOrgIdHash`는 기존 inspector 값. 어떤 값도 URL·token을 출력하지 않는다.
- [ ] doctor는 같은 health를 읽기 전용으로 보고한다(`report.mjs`의 고정 코드 집합에 새 코드가 있으면 추가).
- [ ] 테스트: health 각 항목의 실패가 `HEALTH_FAILED`로 닫히고 receipt를 쓰지 않음, prerequisites 각 조건, apply 전체 순서(가짜 release·inspector·journal로 provider step이 migration 뒤·health 앞에 오는지).

## Final Review Gate

열세 작업이 끝나면 Tasks 1-13 전체에 전용 보안 검토를 한 번 돌린다. 검토는 자기 신뢰, 서명 도메인
혼동, 출처 위조, floor 되돌리기, 시각 되돌리기, tuple 우회, Edge component 누락과 추가, 백업 면제
조건 우회, journal 이중화, 출력 누출을 각각 판정해야 한다. 중대와 중요 지적을 모두 닫은 뒤에만
Main이 실제 발급과 설치를 실행한다.
