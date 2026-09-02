# S11: Supabase 서울 프로젝트와 Edge 경계

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D78, D80, D81, D82, D83, ADR-0042 D84
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `CCC_OPEN_PILOT_PLAN.md`, S1 Database 포트, S2 Identity/Auth, S8 AudioStore, S10 `.cccx` 포맷
- 산출: 기관 소유 Supabase 서울 프로젝트의 읽기 전용 사전 점검, 적용, Edge 경계, 설치 영수증과 drift/rollback 계약
- 관련 티켓: E6-1a, E6-1b, E6-2, E6-3, E6-5a, E6-5b

## 1. 목적

Community Cloud는 기관이 소유한 Supabase 프로젝트 하나를 사용한다. 이 문서는 프로젝트를 안전하게 확인하고 반복 적용할 수 있는 PostgreSQL, Auth, RLS, private Storage, cron, Edge 경계를 고정한다. 업무 권한은 gateway와 Identity가 소유하며, RLS와 API-only role은 브라우저 직접 접근을 차단하는 2차 방어다.

이 문서의 `확정`은 계약이 완결되었다는 뜻이다. 실제 Supabase 프로젝트 적용, Edge 실행, 백업 복원 결과는 E6 티켓의 구현 검증에서 증명한다.

## 2. 설치 경계와 명령

### 2.1 대상 프로젝트

| 항목 | 계약 |
|---|---|
| 소유 | 설치를 요청한 기관의 Supabase 조직이 소유한다. 관찰한 owner organization ID가 기관 승인 manifest의 `expectedOwnerOrgId`와 정확히 같아야 한다. |
| 리전 | `ap-northeast-2`(Seoul)만 허용한다. 리전 값이 없거나 다른 리전이면 `REGION_MISMATCH`로 중단한다. |
| 실행 백엔드 | 한 기관 프로젝트는 한 시점에 하나의 PostgreSQL 실행 백엔드만 사용한다. D1과 PostgreSQL에 이중 쓰기하지 않는다. |
| 설치 대상 | 새 프로젝트 또는 이 계약의 journal/영수증이 같은 `installationId`를 가리키는 설치만 허용한다. 기존 업무 데이터가 있는 프로젝트에는 적용하지 않는다. |
| 사전 동작 | 첫 공개 명령은 ADR-0042의 read-only `plan`이다. plan은 Management API의 프로젝트/Auth 조회와 `database/query/read-only`만 사용한다. |

기관 관리자가 승인한 S2 signed install manifest는 `institutionId`, `projectRef`, `expectedOwnerOrgId`, `installationId`, contract version, expiry, signature와 manifest digest를 묶는다. `plan`과 `apply`는 manifest signature, expiry, projectRef binding을 먼저 확인한 뒤 Management API가 관찰한 owner organization ID를 `expectedOwnerOrgId`와 비교한다. manifest가 없거나 서명이 틀리거나 owner가 다르면 `OWNER_EVIDENCE_MISSING` 또는 `OWNER_MISMATCH`로 끝내며 write는 0건이다. 관찰된 owner ID만 hash하여 영수증에 남기고 manifest 원문과 project URL은 출력하지 않는다.

공개 진입점은 다음과 같다.

```text
pnpm supabase:bootstrap -- plan --project-ref "$CCC_SUPABASE_PROJECT_REF" --install-manifest "$CCC_INSTALL_MANIFEST"
pnpm supabase:bootstrap -- apply --project-ref "$CCC_SUPABASE_PROJECT_REF" --install-manifest "$CCC_INSTALL_MANIFEST"
pnpm supabase:bootstrap -- doctor --project-ref "$CCC_SUPABASE_PROJECT_REF"
pnpm supabase:bootstrap -- rollback --project-ref "$CCC_SUPABASE_PROJECT_REF" --to "$TARGET_VERSION"
```

`apply`는 같은 입력으로 read-only plan을 다시 실행하고, plan의 시작·종료 지문이 같으며 적용 전 지문과도 같을 때만 변경한다. `doctor`는 읽기 전용이다. `rollback`은 S12의 서명된 release manifest와 이 문서의 설치 영수증 및 백업 조건을 모두 만족할 때만 실행한다.

`SUPABASE_ACCESS_TOKEN`은 환경변수에서만 읽는다. project ref는 `--project-ref` 또는 `CCC_SUPABASE_PROJECT_REF`에서 읽을 수 있지만 DB 연결 문자열, service role key, JWT signing key는 명령행 인자로 받지 않는다. 출력, 오류 출력, 임시 파일, 영수증에는 URL, token, 연결 문자열, service role key, 공급자 원문 응답을 남기지 않는다. 자격증명 오류는 ADR-0042의 `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_INSUFFICIENT`와 고정 복구 안내만 사용한다.
### 2.2 깨끗한 프로젝트 판정

최초 plan은 공급자 기본 schema와 metadata만 허용한다. 적용 전 CCC 외 table, row, object, custom function/trigger, grant, cron, Auth user, bucket 또는 다른 installation journal/receipt가 하나라도 있으면 `EXISTING_PROJECT_NOT_CLEAN`으로 거부하고 write를 0건으로 끝낸다.

적용을 시작하면 가장 먼저 durable `private.ccc_install_journal`을 `planned` 상태로 원자 기록한다. 이후 프로젝트가 “깨끗하지 않음”으로 보이더라도 다음 조건을 모두 만족하는 journal 소유 자원만 resume/reconcile 대상으로 예외 처리한다.

- journal의 `installationId`가 승인 manifest의 값과 정확히 같다.
- journal이 기록한 `projectRefHash`, `institutionIdHash`, `expectedOwnerOrgIdHash`와 manifest binding이 일치한다.
- 모든 CCC 외부 자원이 `ccc.installation_id=journal.installationId` ownership tag와 journal의 provider resource ID를 함께 가진다.

tag가 없거나 다른 installationId를 가리키거나 journal에 없는 자원은 `RESOURCE_OWNERSHIP_MISMATCH`로 거부한다. 기존 자원을 지우고 덮어쓰지 않으며, 소유 tag가 일치하는 미완성 자원만 해당 step의 idempotency key로 reconcile한다.

### 2.3 idempotent apply와 durable journal

설치는 DB와 Supabase control plane 사이에 원자 transaction이 없다는 전제를 따른다. 따라서 journal은 2-phase 상태와 provider step 단위 완료 기록을 보존한다.

`apply`의 첫 DB transaction은 논리 migration이 아닌 bootstrap metadata transaction이다. 이 transaction은 `private` schema와 `ccc_install_journal`, `ccc_install_resources`, `ccc_schema_migrations`를 만들고 journal을 `planned`로 기록한다. 이 transaction이 commit된 뒤에만 `0001_baseline.sql`을 실행하므로 baseline commit마다 migration receipt와 resume 상태를 남길 durable 저장소가 먼저 존재한다.

```ts
type InstallPhase = 'planned' | 'installing' | 'installed' | 'rollback_failed';
type InstallStep =
  | 'baseline'
  | 'platform_migration'
  | 'auth_config'
  | 'storage_bucket'
  | 'cron_job'
  | 'edge_secret_binding'
  | 'receipt';

type InstallJournal = {
  installationId: string;
  institutionIdHash: string;
  projectRefHash: string;
  expectedOwnerOrgIdHash: string;
  phase: InstallPhase;
  currentStep: InstallStep | null;
  completedSteps: Array<{ step: InstallStep; idempotencyKey: string; ownershipTags: string[]; providerResourceIds: string[]; providerResourceDigests: string[]; completedAt: string }>;
  planFingerprint: string;
  lastErrorCode: string | null;
  updatedAt: string;
};
```

적용 순서와 재시작 규칙은 다음과 같다.

1. read-only `plan`과 signed manifest를 검증하고 advisory lock을 얻는다. lock을 얻지 못하면 `INSTALL_LOCK_BUSY`로 끝낸다.
2. matching journal이 없으면 bootstrap metadata transaction을 commit하고 `planned` journal을 만든다. journal이 있으면 installationId, manifest binding, ownership tag를 검증하고 저장된 step부터 재개한다.
3. journal을 `installing`으로 바꾸고, 각 step마다 `idempotencyKey = SHA-256(installationId + step + desiredDigest)`를 먼저 기록한다.
4. bootstrap metadata commit 뒤 `0001_baseline.sql`과 이후 migration을 각각 독립 transaction으로 실행하고, 각 commit 직후 `private.ccc_schema_migrations`와 journal step 완료를 기록한다. 같은 ID checksum이 다르면 `MIGRATION_CHECKSUM_MISMATCH`로 중단한다.
5. 각 외부 provider step은 desired digest와 ownership tag를 확인한 뒤 한 번만 실행한다. 성공한 provider resource ID와 digest를 journal에 기록하고 다음 step으로 넘어간다.
6. 실패하면 현재 step, 고정 error code, observed resource ID와 tag만 journal에 남기고 `installing` 상태로 종료한다. 다음 apply는 completed step을 재실행하지 않고 관찰·reconcile한 뒤 중단 지점에서 재개한다.
7. 모든 step의 최종 지문이 일치할 때만 release receipt를 기록하고 journal을 `installed`로 바꾼다.

step 전후에 같은 provider API를 다시 읽어 desired digest와 ownership tag를 비교한다. 부분 생성이 발견되면 같은 idempotency key로 완료 처리하거나 보정하고, 다른 소유 자원이 발견되면 변경 없이 `RESOURCE_OWNERSHIP_MISMATCH`로 끝낸다. `DROP`과 광범위한 보상 삭제는 하지 않는다.

### 2.4 PostgreSQL baseline과 forward migration

`migrations/postgres/0001_baseline.sql`은 `db/schema.sql`과 S1의 논리 schema를 PostgreSQL 현재 기준선으로 만든다. 과거 SQLite migration을 순서대로 번역하거나 재생하지 않는다. 기준선에는 S1이 정한 table, column, FK, unique 제약, 필수 `org_id`, org_id index, append-only 제약과 audit/consent/AI evidence table을 포함한다.

`migrations/postgres/0002_supabase_platform.sql`은 이 문서의 플랫폼 공통 객체만 만든다.

- `private.ccc_install_receipt`와 append-only `private.ccc_release_history`
- `ccc_schema_owner`(NOLOGIN)와 `ccc_api`(LOGIN, `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`)
- `public` 업무 table에 대한 browser role의 grant 회수와 API-only role의 최소 grant
- Auth 사용자와 CCC `users.auth_user_id` 연결에 필요한 제약
- RLS enable과 org 경계 정책
- 비공개 `ccc-audio` bucket의 선언 상태와 cron 등록에 필요한 platform 설정

`migrations/postgres/0003_audio_objects.sql`은 S8/E5-6의 소유다. S11은 migration ID와 적용 순서만 참조하며 원음 시계, claim, signed URL 만료, 삭제 증거를 재정의하지 않는다. 이후 forward migration은 하나의 논리 ID에 SQLite와 PostgreSQL 두 파일을 만들고 S1의 parity 규칙을 따른다.

### 2.5 API-only role과 RLS

`ccc_api`는 브라우저가 사용할 수 없는 DB 연결 전용 role이다. API는 gateway가 검사한 actor와 기관을 transaction-local context로 설정한다.

```sql
SELECT set_config('app.org_id', $1, true);
SELECT set_config('app.actor_id', $2, true);
```

모든 tenant table의 RLS 정책은 `org_id = current_setting('app.org_id', true)`일 때만 `ccc_api`에 해당 row를 허용한다. `app.org_id`가 없거나 빈 값이면 0행을 반환한다. actor 권한과 업무 동작의 허용 여부는 gateway/Identity가 추가로 검사한다. API role을 table owner로 두지 않으며 `BYPASSRLS`를 부여하지 않는다.

RLS 규칙:

| 주체 | 업무 table direct read/write | 결과 |
|---|---|---|
| `anon` | grant 없음, policy 없음 | 항상 거부 |
| Supabase `authenticated` | grant 없음, policy 없음 | 항상 거부 |
| `ccc_api`, org context 없음 | policy 조건 불충족 | 0행 또는 거부 |
| `ccc_api`, 다른 org context | `org_id` 불일치 | 0행, cross-org 결과 0건 |
| `ccc_api`, 같은 org context | RLS 통과 후 gateway 권한 검사 | 허용된 동작만 수행 |

RLS는 업무 table마다 `ENABLE ROW LEVEL SECURITY`를 명시한다. default deny를 깨는 `USING (true)`, `WITH CHECK (true)`, browser role grant, security-definer 우회 함수는 금지한다. `storage.objects`도 public bucket으로 바꾸지 않으며 browser가 업무 object를 list/read할 Storage 정책을 만들지 않는다.

### 2.6 Supabase Auth

Auth는 Supabase Auth를 사용한다. 이메일/비밀번호 로그인, invite action link, 사용자 비활성화와 MFA의 상세 claims·issuer·audience·JWKS·AAL 규칙은 S2/E4-2를 정본으로 삼는다. S11 적용은 다음 공급자 설정을 고정한다.

- anonymous signup은 끈다.
- 기관의 초대 없는 공개 signup은 끈다.
- 이메일/비밀번호 provider를 켜고, 초대 링크에서 비밀번호를 설정하는 흐름을 허용한다.
- Auth 사용자와 CCC `users.auth_user_id`의 unique 연결 없이는 업무 API actor를 만들지 않는다.
- 관리 작업은 S2의 MFA/AAL2 조건을 통과한 actor만 gateway에서 허용한다.
- 설치 과정에서 기관 관리자 계정이나 실사용자 계정을 자동 생성하지 않는다.

Auth 설정 fingerprint가 영수증과 다르면 drift다. JWT signing secret, service role key, refresh token은 fingerprint와 출력에 포함하지 않는다.
### 2.7 시크릿 배치

시크릿은 호출하는 runtime에만 둔다. 아래 표의 “브라우저” 행을 제외한 값은 browser bundle, bootstrap, receipt, log, 오류 응답에 넣지 않는다.

| 이름 | 보관 위치 | 사용 범위 |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | install/plan 프로세스의 환경변수 | Management API read-only plan과 apply 입력, 저장·출력 금지 |
| `SUPABASE_SERVICE_ROLE_KEY` | 전용 `StorageSigner` Edge function의 secret binding | Storage 서명 동작만 허용, 업무 DB client/import·Auth 관리자·일반 request handler와 분리 |
| `PII_ENC_KEY` | 업무 Edge의 secret binding | PII 금고 호출, Agent나 browser 전달 금지 |
| `OPENAI_API_KEY` | 업무 Edge의 secret binding | `store:false` AI 호출, browser·Agent 전달 금지 |
| Azure STT key | Agent SecretStore | 명시적으로 승인된 Azure STT 호출, Edge·browser 전달 금지 |
| Supabase DB connection string | 업무 Edge/API의 server-side `SecretStore` | `ccc_api` PostgreSQL 연결, CLI 인자·browser 전달 금지 |
| Supabase project URL, publishable/anon key | browser public configuration | Supabase Auth session 수립만 허용, 업무 table/Storage direct access는 grant 없음으로 거부 |

`StorageSigner`는 `SUPABASE_SERVICE_ROLE_KEY`만 읽고 business DB client, `ccc_api`, 공통 request handler, SQL driver를 import하지 않는다. signer 입력 DTO는 아래처럼 exact field/type을 가진다.

```ts
type StorageSignerRequest = {
  bucket: 'ccc-audio';
  objectKey: string;       // S8 opaque key
  action: 'upload' | 'agent_read' | 'delete' | 'head';
  principal: 'client' | 'agent' | 'scheduler';
  objectSha256: string | null;
};
```

signer는 bucket, opaque key 형식, caller principal, 허용 action을 모두 검사하고 만료 시각을 S8 lifetime에서 서버가 계산한다. caller가 만료 시각이나 signed URL을 지정하지 않는다. 임의 bucket, table, SQL, URL, key, action을 받지 않으며 signer function 외 runtime에는 service role key가 존재하지 않는다.

secret rotation은 새 값을 먼저 전용 signer binding에 주입하고 health check를 통과한 뒤 이전 값을 폐기한다. 값 자체를 fingerprint, migration, receipt, report에 넣지 않는다.
### 2.8 private Storage와 cron

bucket 이름은 `ccc-audio`로 고정하고 `public = false`로 만든다. object key에는 이름, 이메일, 주소, session 원문 또는 기관 식별자를 넣지 않고 S8의 opaque key 규칙을 사용한다. browser에는 service role key와 signed GET을 주지 않는다. S8이 정한 제한 안에서만 짧은 signed upload와 Agent 전용 claim-scoped GET을 발급한다. signer는 object key, action, caller principal을 journal과 ownership tag에 대조한다.

오디오 byte는 Edge Function, Cloudflare Worker, API gateway를 통과하지 않는다. browser는 StorageSigner가 반환한 짧은 signed upload 권한으로 Supabase Storage에 직접 업로드하고, Agent는 claim 응답의 짧은 signed GET으로 Storage에서 직접 받는다. Edge에는 object key/hash와 JSON metadata만 전달한다. Edge route가 audio MIME, `multipart/*`, `audio/*` 또는 audio byte body를 받으면 `AUDIO_BODY_FORBIDDEN`으로 거부하고 Storage로 전달하지 않는다.

Supabase `pg_cron`과 `pg_net`은 `ccc_scheduler_tick`이라는 단일 job으로 등록한다. schedule은 `* * * * *`이며, job은 S2 Scheduler service credential adapter가 Vault에서 읽은 signing key로 매 tick 발급한 짧은 token을 사용해 내부 Edge scheduler endpoint에 JSON tick만 POST한다. Vault secret과 token은 SQL, migration log, job payload, receipt에 넣지 않는다.

Scheduler token은 S2의 service principal을 사용하고 `sub=ccc_scheduler`, scheduler audience, route scope `/internal/scheduler/tick`, `iat`, `exp`(발급 후 300초 이내), `jti` nonce를 포함한다. Edge는 issuer, signature, audience, subject, route scope, `iat/exp`와 replay store의 미사용 `jti`를 검증하고 성공한 nonce를 만료 시각까지 기록한다. token 없음/서명·만료·nonce 오류는 401, 유효하지만 audience·subject·route scope가 틀리거나 business route에 사용하면 403이다. internal scheduler route는 `Origin`이 없는 server-to-server 요청만 허용하며, browser Origin이 있으면 403이다. 일반 업무 route는 exact-origin CORS 규칙을 따른다.

job 중복 등록, 공개 HTTP endpoint, browser origin 호출, service role key를 scheduler credential로 재사용하는 구현은 금지한다. 처리 기회, claim 우선순위, purge 시각은 S8/E5-6의 AudioStore 계약이 소유하며 cron은 같은 `Scheduler.run` 포트만 호출한다.
## 3. Edge Function 계약

### 3.1 실행 한계

Edge wrapper는 Deno `serve`로 공통 `handleRequest`에 runtime adapter를 주입한다. Edge artifact는 다음 제한을 넘으면 적용하지 않는다.

| 자원 | 고정 상한 | 초과 판정 |
|---|---:|---|
| CPU | invocation당 2초 | `EDGE_CPU_LIMIT` 또는 platform timeout, 요청 실패 |
| memory | 256 MB | `EDGE_MEMORY_LIMIT` 또는 platform rejection |
| bundle | 20 MB | deploy 전 `EDGE_BUNDLE_LIMIT`, 적용하지 않음 |

Edge에는 NER, STT, LLM, 모델 파일, 원음 buffer, 장기 작업 queue를 넣지 않는다. 2차 마스킹 NER은 Agent PC에서만 실행한다. Edge는 JSON 요청의 인증, gateway 호출, signed upload 권한, scheduler tick, redacted error만 처리한다. 외부 AI 호출과 audio 처리의 fallback을 만들지 않는다.

Edge 배포는 globally distributed이며 Supabase project가 Seoul이어도 Edge 실행 위치를 hard Seoul residency로 간주하지 않는다. 기관·법무가 허용한 호출 경계는 다음 region evidence를 요구한다.

- browser API 호출과 `pg_net` 호출은 `x-region: ap-northeast-2`를 설정한다. header를 설정할 수 없는 provider 호출은 `forceFunctionRegion`을 사용한다.
- 응답의 `x-sb-edge-region`과 함수 내부 `SB_REGION`을 읽어 같은 invocation의 evidence로 기록한다. 값이 기대 region과 다르면 요청을 실패시키고 관리자 alert를 남기며, 다른 region으로 자동 reroute하지 않는다.
- `x-sb-edge-region`, `SB_REGION` evidence와 mismatch 상태는 Edge log와 receipt fingerprint에 포함한다. URL, token, payload는 포함하지 않는다.
- Edge는 SG6 검증을 통과한 masked AI Packet 또는 등록된 exact business JSON만 받는다. original audio와 unmasked text는 어떤 route에도 전달하지 않는다. residual international-transfer risk와 법적 고지는 S14/E9-3이 소유한다.

### 3.2 exact-origin CORS

`CCC_CLIENT_ORIGIN`은 scheme, host, 선택적 port만 가진 하나의 절대 origin으로 설정한다. path, wildcard, 공백, 다중 origin, `null`은 거부한다. 문자열 비교 전에 trailing slash를 제거한 canonical origin으로 검증하지만, 응답에는 설정한 canonical origin 하나만 쓴다.

허용 정책:

```text
Access-Control-Allow-Origin: configured canonical CCC_CLIENT_ORIGIN
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Authorization,Content-Type,Idempotency-Key,X-Request-Id,x-region
Access-Control-Expose-Headers: x-sb-edge-region
Access-Control-Allow-Credentials: false
Vary: Origin
```

`Origin`이 정확히 일치할 때만 preflight와 실제 응답에 CORS header를 붙인다. 다른 origin에는 `Access-Control-Allow-Origin`을 보내지 않고 403으로 끝낸다. `*`, credential cookie, origin reflection, 여러 origin을 한 header에 넣는 구현은 금지한다. CORS 설정값과 origin 원문은 로그·CLI·영수증에 쓰지 않고 fingerprint만 기록한다. CORS는 D80의 signed bootstrap `apiBase` 허용 목록을 대체하지 않는다.

### 3.3 요청 schema, body cap, 응답, 로그

모든 Edge JSON route는 `packages/contracts`에 등록된 exact route schema 하나를 사용한다. catch-all `Record<string, unknown>` route와 schema가 없는 route는 존재하지 않는다. 등록된 schema의 required key, optional key, scalar type, string format과 enum을 모두 검사하고 unknown key, missing required key, 잘못된 type, nested field의 미등록 key는 `EDGE_SCHEMA_REJECTED`로 거부한다.

```ts
type EdgeJsonScalar = string | number | boolean | null;
type EdgeJsonRoute = 'business' | 'storage-upload-grant' | 'storage-agent-read-grant' | 'scheduler-tick';
type StorageUploadGrantRequest = {
  objectKey: string;       // S8 opaque key
  objectSha256: string;    // lowercase SHA-256
  contentType: string;
  sizeBytes: number;       // non-negative integer
};
type StorageAgentReadGrantRequest = {
  objectId: string;
  claimId: string;
};
type SchedulerTickRequest = {
  kind: SchedulerKind;       // S2 SchedulerKind exact literal
  nonce: string;
  issuedAt: string;          // ISO-8601 UTC
};
```

`business`의 실제 route DTO는 `packages/contracts`가 각 route별 required/optional key와 type을 명시한다. S11 transport는 그 registry를 그대로 소비하며 body를 재해석하거나 임의 key를 추가하지 않는다. `audioObjectId`, opaque object key, hash처럼 byte가 아닌 식별 metadata는 허용하지만 `audio`, `audioBase64`, `base64`, `blob`, `bytes`, `byteArray` field와 base64 문자열, Blob/File, `Uint8Array`에 해당하는 배열·객체는 어떤 깊이에서도 거부한다.

JSON body limit은 `EDGE_JSON_BODY_MAX_BYTES = 1_048_576`(1 MiB)로 고정한다. `Content-Length`가 이를 넘으면 body를 읽거나 buffer하지 않고 `EDGE_BODY_TOO_LARGE`(413)로 거부한다. chunked body는 parser가 최대 `1_048_577`번째 byte까지만 읽어 초과를 판정하고, 전체 body를 buffer하지 않는다. limit 이하일 때만 UTF-8 JSON parse와 exact schema validation을 수행한다. `Content-Type`이 JSON이 아니거나 audio MIME, `multipart/*`, binary body이면 `AUDIO_BODY_FORBIDDEN`(415)으로 거부한다.

Edge 업무 요청은 `Authorization: Bearer` 뒤에 검증된 JWT를 붙이고 JSON body만 사용한다. 응답은 `Cache-Control: no-store`를 기본으로 한다. Storage signer와 scheduler credential은 위 DTO와 별도 narrow adapter를 사용하고 business DB client가 service role key를 읽지 않는다.

Edge log에 허용되는 필드는 D81의 `code`, `sessionIdHash`, `timestamp`와 비식별 region evidence인 `x-sb-edge-region`, `SB_REGION`뿐이다. session이 없는 요청의 `sessionIdHash`는 생략한다. request body, 원문, 감지 문자열, 이메일, 이름, 주소, JWT, Authorization header, Storage signed URL, project URL, secret, provider 원문 오류는 로그·trace·exception message에 남기지 않는다. region evidence 외의 요청 metadata도 남기지 않는다. 클라이언트 오류는 고정 code와 한국어 안내만 반환한다.

### 4.1 설치 영수증과 release history

`private.ccc_install_journal`은 설치 단계의 durable 2-phase 상태를, `private.ccc_install_receipt`는 현재 선언 상태를, append-only `private.ccc_release_history`는 설치·update·rollback 조합을 보존한다. 최초 apply도 release record를 만든다. 영수증과 history 행은 아래 binding을 원자 기록한다.

```ts
type SupabaseReleaseReceipt = {
  contract: 'S11';
  contractVersion: '0.3';
  installationId: string;
  institutionIdHash: string;
  rollbackTarget: { releaseVersion: string; releaseSequence: number; manifestDigest: string } | null;
  expectedOwnerOrgIdHash: string;
  observedOwnerOrgIdHash: string;
  releaseVersion: string;
  releaseSequence: number;
  manifestDigest: string;
  artifactSetDigest: string;
  migrationHead: string;
  schemaFingerprint: string;
  edgeRegionEvidence: {
    requestedRegion: 'ap-northeast-2';
    responseRegion: string;       // x-sb-edge-region
    functionRegion: string;       // SB_REGION
    mismatch: boolean;
  };
  providerResourceDigests: Record<string, string>;
  backupId: string | null;
  backupDigest: string | null;
  priorReceiptDigest: string | null;
  recordedAt: string;
  status: 'installed' | 'rollback_failed';
};
```

`private.ccc_install_receipt`의 현재 행은 위 필드에 더해 grants/RLS, Auth, Storage, cron, Edge artifact, CORS와 `x-sb-edge-region`/`SB_REGION` evidence fingerprint를 가진다. 모든 receipt/history/journal row는 같은 `installationId`와 manifest binding을 가져야 한다. `providerResourceDigests`에는 ownership tag가 붙은 provider ID의 digest만 넣고 URL, secret, token, user row, audio object key와 원문은 넣지 않는다. raw project ref와 client origin도 hash만 저장한다.

정상 release의 `releaseSequence`와 `manifestDigest`는 S12 signed manifest의 값과 정확히 일치한다. rollback은 더 낮은 `rollbackTarget.releaseSequence`의 검증된 artifact를 선택할 수 있지만 rollback operation 자체는 현재보다 높은 새 `releaseSequence`와 새 signed manifest를 발행한다. `releaseVersion`별 history는 삭제·update하지 않고 append-only로 남기며, `priorReceiptDigest`가 바로 앞의 승인 receipt를 연결한다. doctor와 redacted report는 hash, migration ID, release version/sequence, 상태, 시각, 고정 drift code만 반환한다.
### 4.2 drift

`doctor`는 다음 선언 상태를 canonical JSON으로 정렬한 뒤 SHA-256으로 다시 계산한다: 리전/소유 증거, migration ID와 checksum, table/column/FK/index/trigger, RLS/policy/grant, Auth provider/MFA 설정, bucket private 설정, cron schedule/endpoint binding, Edge artifact hash, `x-sb-edge-region`/`SB_REGION` evidence, client origin hash. row 값, audio bytes, JWT signing secret, URL과 key 값은 fingerprint 대상에서 제외한다.

fingerprint가 영수증과 다르면 `DRIFT_DETECTED`다. doctor는 drift category를 `schema`, `rls`, `auth`, `storage`, `cron`, `edge`, `cors`, `migration` 중 하나 이상으로 보고하지만 데이터 내용이나 secret을 출력하지 않는다. drift 상태에서 `apply`는 자동 repair, `DROP`, destructive migration, policy 완화를 하지 않고 `DRIFT_BLOCKED`로 끝낸다. 운영자는 승인된 signed release와 backup/restore 절차를 통해서만 복구한다.

### 4.3 rollback

rollback은 S12 signed manifest의 동일한 `installationId`, `projectRef`, 새 `releaseSequence`, `manifestDigest`가 현재 journal과 binding을 이루고, manifest의 `rollbackTarget`이 target `private.ccc_release_history` row 및 E6-7 backup catalog와 정확히 맞을 때만 실행한다. rollback operation의 새 sequence는 현재보다 높아야 하며, target sequence는 현재보다 낮아야 한다. 대상 receipt의 provider resource digests와 migration head를 검증한다.

rollback 전에 E6-7 restore compatibility check가 DB schema version, migration head, private Storage object format, Auth/Edge/cron metadata와 대상 receipt의 조합을 staging에서 검증한다. 호환 backup이 없거나 manifest·receipt·backup binding이 하나라도 다르면 `ROLLBACK_INCOMPATIBLE`로 끝내고 현재 설치를 변경하지 않는다. PostgreSQL forward migration에 임의의 down SQL을 실행하지 않는다.

rollback도 journal step(`prepare_backup`, `verify_manifest`, `restore_data`, `restore_provider_metadata`, `switch_release`, `verify_receipt`)을 남긴다. 각 step에 `idempotencyKey`, ownership tag, target receipt digest를 기록하며 중단 뒤 재시작하면 이미 완료된 step은 관찰·검증만 한다. restore 뒤 schema, RLS, Auth, private bucket, cron, Edge, CORS fingerprint와 target provider resource digests가 모두 일치할 때만 별도 current receipt pointer를 새 rollback receipt로 원자 전환하고, 기존 history row를 수정하지 않은 채 새 history row를 append한다.

rollback 중 다음 조건을 지킨다.

1. 새 artifact를 실행하기 전에 current receipt, target receipt, backup ID/digest와 manifest digest를 보존한다.
2. 실패하면 journal과 rollback operation history row를 `rollback_failed`로 남기고, secret/URL/PII 없이 관리자에게 고정 복구 code를 보낸다.
3. 원자적으로 복원할 수 없는 DB schema와 Storage object를 부분 삭제하지 않는다.
4. 성공한 rollback은 `priorReceiptDigest`로 직전 receipt를 연결하고 `releaseSequence`/`manifestDigest`/backup binding을 보존한다.
## 5. 세 모드 차이

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 프로젝트 | 기관 소유 Supabase `ap-northeast-2` | 없음 | 없음 |
| DB | PostgreSQL baseline + forward migration | 암호화 SQLite | 서버 PC의 암호화 SQLite |
| Auth | Supabase Auth, 기관 관리자 MFA | OS 사용자와 앱 잠금 | Argon2id 로컬 계정, 관리자 MFA |
| Storage | Supabase `ccc-audio` private bucket | 암호화 파일 저장소 | 서버의 암호화 파일 저장소 |
| Scheduler | `pg_cron` → 내부 Edge JSON tick | Node timer | 서버 Scheduler |
| Edge/CORS | Deno Edge, exact client origin, audio body 금지 | 없음 | 없음 |
| 영수증 | S11 hash receipt와 drift/rollback | S9/S10의 모드 metadata | S9/S10의 모드 metadata |

오디오 수명, 삭제 증거, signed URL의 만료와 claim은 세 모드 공통 S8 계약을 따른다. `.cccx`의 envelope, JSONL, 첨부, hash, 암호화와 복구는 S10 계약을 따른다.

## 6. 완료 조건

- [ ] ADR-0042의 read-only plan이 apply보다 먼저 실행되고, plan 전후 지문 변경과 잘못된 리전·기존 project·자격증명 오류를 각각 차단한다.
- [ ] Edge가 globally distributed임을 명시하고 hard Seoul residency로 오인하지 않는다. browser/API와 `pg_net`은 `x-region: ap-northeast-2`(불가 시 `forceFunctionRegion`)를 보내며, `x-sb-edge-region`과 `SB_REGION`을 log/receipt에 기록하고 mismatch는 `EDGE_REGION_MISMATCH` 실패·alert 후 자동 reroute하지 않는다. residual international-transfer risk는 S14/E9-3이 소유한다.
- [ ] S2 signed install manifest의 `institutionId`·`projectRef`·`expectedOwnerOrgId` binding과 관찰 owner organization ID가 정확히 일치할 때만 적용하며, missing/wrong evidence는 0 write로 거부한다.
- [ ] `ap-northeast-2`의 기관 소유 프로젝트만 적용되며, 허용된 공급자 기본 객체 외의 기존 table, row, object, grant, cron이 있으면 0 write로 거부한다. 단, 동일 `installationId` journal과 ownership tag가 있는 미완성 자원만 resume/reconcile한다.
- [ ] PostgreSQL `0001_baseline.sql`, `0002_supabase_platform.sql`과 이후 forward migration, migration ID/checksum ledger, durable install journal, S1 parity 규칙이 문서에 고정되어 있다. S8의 `0003_audio_objects.sql`은 참조만 한다.
- [ ] `anon`과 `authenticated`의 업무 table/storage direct read가 거부되고, `ccc_api`의 다른 org context에서 cross-org 결과가 0건이며, API role이 `BYPASSRLS`나 table owner가 아니다.
- [ ] Supabase Auth 설정, Auth 사용자 mapping, 관리자 MFA 경계가 S2/E4-2를 참조하고, 설치가 실사용자 계정을 자동 생성하지 않는다.
- [ ] `ccc-audio`가 private이며 audio byte가 Edge를 통과하지 않는다. Edge가 audio/multipart/binary body, base64/blob/byte-array field, unknown JSON key, 1 MiB 초과 body를 각각 거부한다.
- [ ] `pg_cron`의 `ccc_scheduler_tick`이 중복 없이 등록되고, S2 Vault service credential의 짧은 audience/route-scoped token, nonce replay 방지, no-Origin 규칙과 401/403 판정이 적용된다.
- [ ] Edge CPU 2초, memory 256 MB, bundle 20 MB 상한과 NER/STT/LLM/audio 금지가 적용 계약에 포함되어 있다.
- [ ] exact `CCC_CLIENT_ORIGIN`만 CORS에 허용되고 `*`, origin reflection, credentials cookie가 없으며 업무 응답에 `Cache-Control: no-store`가 있다.
- [ ] browser에는 publishable/anon Auth key만 노출할 수 있고 service role key, DB URL, Management token, `PII_ENC_KEY`, OpenAI key, Azure key가 전달되지 않는다. service role key는 StorageSigner 외 runtime에 없다.
- [ ] 설치 journal, hash-only receipt와 append-only release history가 installId, release version/sequence, manifest digest, schema/provider digests, backup ID/digest와 prior receipt를 묶고, drift는 자동 repair 없이 차단하며 rollback은 compatibility를 확인한 뒤에만 전환한다.

## 7. fixture와 검증 방법

구현 검증은 저장소 루트에서 pinned Supabase CLI 2.116.0 disposable stack 또는 기관 소유가 확인된 synthetic project에만 실행한다. 운영 project와 실계정은 fixture에 사용하지 않는다.

| fixture | 설정 | 기대 결과 |
|---|---|---|
| `clean-seoul` | `ap-northeast-2`, 공급자 기본 schema만 존재 | plan PASS, apply PASS, receipt 1행 |
| `region-evidence` | browser/API and `pg_net` set `x-region: ap-northeast-2` (or `forceFunctionRegion`), response/`SB_REGION` mismatch | `EDGE_REGION_MISMATCH`, failure + alert, no automatic reroute; globally distributed Edge is not hard Seoul residency |
| `wrong-owner` | 깨끗한 Seoul project지만 observed owner organization ID가 manifest `expectedOwnerOrgId`와 다름 | `OWNER_MISMATCH`, 모든 write 0건 |
| `owner-evidence-missing` | signed install manifest가 없거나 signature/expiry/binding이 틀림 | `OWNER_EVIDENCE_MISSING`, 모든 write 0건 |
| `provider-step-failure` | baseline·platform·Auth·Storage·cron·Edge secret 각 step 직후 provider 오류 주입 | journal `installing`, ownership tag/resource ID 보존, retry가 중복 없이 resume |
| `owned-journal-resume` | matching installationId journal과 matching ownership tag가 있는 partial resource | dirty refusal 없이 reconcile, completed step 재실행 0건 |
| `foreign-partial-resource` | journal에 없는 provider resource 또는 다른 installationId tag | `RESOURCE_OWNERSHIP_MISMATCH`, resource 변경·삭제 0건 |
| `wrong-region` | region을 Seoul 외 값으로 응답 | `REGION_MISMATCH`, 모든 write 0건 |
| `existing-app` | CCC 외 public table, row, grant 또는 object 1개 | `EXISTING_PROJECT_NOT_CLEAN`, 모든 write 0건 |
| `repeat-apply` | 동일 receipt와 동일 migration checksum으로 apply 2회 | 두 번째 변경 0건, receipt fingerprint 동일 |
| `plan-race` | plan 후 apply 전에 catalog 변경 | `PLAN_STATE_CHANGED`, migration 0건 |
| `migration-tamper` | 적용된 migration ID의 checksum 변경 | `MIGRATION_CHECKSUM_MISMATCH`, 기존 row 보존 |
| `rls-cross-org` | anon, authenticated, org A/B의 API context로 동일 table 조회 | browser direct read 거부, org B 결과 0건 |
| `edge-boundary` | JSON exact DTO, unknown key, base64/blob/byte-array field, audio MIME, multipart, binary body, 1 MiB+1 body, 21 MB bundle | valid DTO만 처리, schema/body는 `EDGE_SCHEMA_REJECTED` 또는 `EDGE_BODY_TOO_LARGE`, audio는 `AUDIO_BODY_FORBIDDEN`, bundle은 `EDGE_BUNDLE_LIMIT` |
| `cors-origin` | exact origin, 다른 origin, `null`, wildcard 설정 | exact만 허용, 나머지 ACAO 없음/거부 |
| `drift-and-rollback` | policy/bucket/cron/artifact를 receipt와 다르게 변경한 뒤 signed 이전 version 제공 | doctor drift 보고, unsigned/무백업 rollback 거부, 승인된 rollback 뒤 receipt 일치 |
| `secret-log-scan` | synthetic JWT, key-like strings, URL, PII와 원문을 요청·오류에 섞음 | log/stdout/stderr/receipt에 값 0건, 고정 code만 남음 |
| `scheduler-auth` | missing, invalid, expired, replayed token, wrong audience/subject/route, no-Origin request, browser Origin request | missing/invalid/replay는 401, valid wrong scope 또는 browser Origin은 403, fresh S2 Vault token만 tick 처리 |
| `rollback-binding` | target manifest/history/backup의 installId, sequence, digest, schema/provider compatibility 중 하나 불일치 | `ROLLBACK_INCOMPATIBLE`, current receipt와 provider state 변경 0건 |

검증 명령과 실패 판정:

```bash
pnpm supabase:bootstrap -- plan --project-ref "$CCC_SUPABASE_PROJECT_REF" --install-manifest "$CCC_INSTALL_MANIFEST"
pnpm supabase:bootstrap -- apply --project-ref "$CCC_SUPABASE_PROJECT_REF" --install-manifest "$CCC_INSTALL_MANIFEST"
pnpm supabase:bootstrap -- doctor --project-ref "$CCC_SUPABASE_PROJECT_REF"
pnpm --filter @ccc/api exec vitest run test/supabase-install.test.ts test/supabase-rls.test.ts test/edge-wrapper.test.ts
pnpm test:contracts --db=postgres
pnpm guard:secrets
```

각 fixture의 기대 code, 지문, row count가 다르면 실패다. `anon` 또는 다른 org에서 업무 row가 한 건이라도 보이거나, browser에 service role key가 나타나거나, Edge log에 PII/원문/URL/key가 한 건이라도 나타나거나, 오디오 body가 Edge 요청 또는 응답에 포함되면 실패다. 기존 테스트를 삭제·skip·완화한 경우도 실패다.

## 8. 이번에 안 하는 것

- read-only preflight 자체의 구현은 E6-1a가 소유한다. 이 문서는 ADR-0042의 입력·출력·차단 계약을 참조한다.
- 실제 baseline, forward migration, Auth adapter, RLS SQL, Storage adapter, Edge wrapper, cron 실행과 install 명령 구현은 E6-1b, E6-2, E6-3, E6-5가 소유한다.
- 원음의 보관 시계, claim-scoped URL, 삭제 증거와 retry semantics는 S8/E5-6에서 정한다.
- `.cccx` 암호화와 파일별 hash는 S10에서 정한다.
- Cloud 실데이터 전환, 법무 승인, OpenAI/Azure 제공자 선택은 S14, E9-3, E6-6b의 범위다.
