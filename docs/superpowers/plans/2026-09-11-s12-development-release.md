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

## Final Review Gate

여섯 작업이 끝나면 Tasks 1-6 전체에 전용 보안 검토를 한 번 돌린다. 검토는 자기 신뢰, 서명 도메인
혼동, 출처 위조, floor 되돌리기, 시각 되돌리기, tuple 우회, Edge component 누락과 추가, 백업 면제
조건 우회, journal 이중화, 출력 누출을 각각 판정해야 한다. 중대와 중요 지적을 모두 닫은 뒤에만
Main이 실제 발급과 설치를 실행한다.
