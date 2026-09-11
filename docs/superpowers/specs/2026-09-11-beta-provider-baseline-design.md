# Community Cloud 개발판 provider baseline 설계

작성: 2026-09-11
상태: Q의 채팅 설계 승인 반영, 문서 검토 대기
관련 계약: ADR-0048 D89, S2, S11, S12

## 1. 문제와 목표

실제 Relayer Supabase 프로젝트의 서명된 read-only `plan`은 기관, 프로젝트, 소유자, 서울 리전,
DB, Auth, Storage 접근과 전후 지문을 확인했다. 업무 표와 행, Auth 사용자, Storage bucket은 모두
0건이었다. 그러나 Supabase가 관리하는 기본 객체 101개와 grant 903개를 승인할 서명된 기준선이
없어서 `EXISTING_PROJECT_NOT_CLEAN`으로 중단했다.

schema 이름이 `auth`, `storage`, `extensions`라는 사실만으로 객체를 신뢰하지 않는다. 목표는
Supabase 관리 객체와 grant의 정확한 목록을 공식 소스와 대조하고, beta 전용 개발 신뢰로 서명해
read-only `plan`이 안전하게 판단하도록 하는 것이다.

완료 기준은 다음과 같다.

1. live inventory와 서명 기준선이 정확히 같을 때만 `plan.ready=true`가 된다.
2. 객체, grant, 프로젝트, 소유자, 리전, DB 버전, 서명, 만료 중 하나라도 다르면 fail-closed다.
3. `plan.readOnly=true`, `plan.unchanged=true`, DB 쓰기 0건을 유지한다.
4. 이 개발 신뢰는 `beta`에만 유효하며 `stable` 또는 `formal`을 서명하거나 승인할 수 없다.

## 2. 범위

포함한다.

- Community Cloud의 Supabase provider baseline 생성, 서명, 검증
- beta 전용 root와 release key의 분리
- Supabase 공식 소스와 live read-only inventory의 대조
- S11 read-only plan의 정확한 baseline 비교
- 키, baseline, 오류 출력의 redaction과 업무 런타임 격리

포함하지 않는다.

- DB migration, journal bootstrap, `ccc_api` 생성과 권한 부여
- 실제 Cloud apply, Azure 배포, hosted Auth 사용자 초대
- S12 `formal`의 offline root, 다섯 artifact family, Authenticode, SBOM
- Local Single과 Local Office 설치기
- STT 또는 AI 활성화
- 비교용 Supabase 프로젝트 추가 생성

DB 쓰기는 이 설계 승인에 포함되지 않는다. 기준선 구현 뒤 signed read-only plan 결과를 다시 확인하고
별도 승인을 받아야 한다.

## 3. 신뢰 구조

### 3.1 외부 신뢰

설치기는 `CCC_BETA_TRUST_ROOT_KEYS`의 `rootKeyId -> raw Ed25519 public key`만 신뢰 시작점으로
사용한다. 이 값은 설치 담당자가 기관에 대해 구성한 외부 입력이다. 서명 객체가 자기 root public key를
싣거나 새로운 root를 등록할 수 없다.

개발판 root 개인키와 release 개인키는 RELAYER SecretStore에서 설치 서명 프로세스에만 주입한다.
업무 API, 브라우저, 정적 client, Azure Container App에는 전달하지 않는다. 다음 이름은 업무 런타임의
forbidden binding에 추가한다.

- `CCC_BETA_ROOT_SIGNING_PRIVATE_KEY`
- `CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY`
- `CCC_PROVIDER_BASELINE`
- `CCC_BETA_RELEASE_TRUST`

공개 root map과 release public key도 업무 처리에 필요하지 않으므로 배포 allowlist에 넣지 않는다.

### 3.2 `BetaTrustRootV1`

이 객체는 외부 beta root가 release key 하나에 권한을 주는 닫힌 객체다. 이름과 달리 root public key를
싣지 않는다.

```ts
type BetaTrustRootV1 = {
  schemaVersion: 1;
  profile: 'development';
  channel: 'beta';
  provider: 'supabase';
  projectRefSha256: string;
  ownerOrgIdSha256: string;
  region: 'ap-northeast-2';
  rootKeyId: string;
  releaseKeyId: string;
  releasePublicKey: string;
  notBefore: string;
  expiresAt: string;
  ed25519Signature: string;
};
```

서명 입력은 `ed25519Signature`를 뺀 exact object의 RFC 8785 JCS UTF-8 앞에
`CCC-BETA-TRUST-ROOT-V1\0`을 붙인 바이트다. root key 폐기, 기간 밖, 다른 profile, channel,
provider, 프로젝트, 소유자, 리전은 `BETA_TRUST_INVALID`로 거부한다.

`notBefore <= now < expiresAt`이어야 하며 trust lifetime은 최대 30일이다. trust의 `expiresAt`은
S2 manifest와 비공개 설치 승인서의 더 이른 만료를 넘을 수 없다. `CCC_BETA_REVOKED_ROOT_KEY_IDS`에
있는 rootKeyId는 기간 안이어도 거부한다.

`releasePublicKey`는 raw Ed25519 32바이트의 canonical standard Base64 44자다. 두 객체의
`ed25519Signature`는 Ed25519 64바이트의 canonical standard Base64 88자다. hash 필드는 모두
소문자 hexadecimal SHA-256 64자다.

### 3.3 `SupabaseProviderBaselineV1`

```ts
type ProviderObjectRecord = {
  kind: 'schema' | 'relation' | 'routine' | 'type' | 'catalog';
  schema: string;
  identity: string;
  owner: string;
  definitionSha256: string;
  provenance: 'extension' | 'initial_privilege' | 'supabase_managed';
};

type ProviderGrantRecord = {
  kind: 'schema' | 'relation' | 'column' | 'routine' | 'type' | 'default' | 'role';
  schema: string;
  objectIdentity: string;
  grantor: string;
  grantee: string;
  privilege: string;
  grantable: boolean;
  inheritOption: boolean | null;
  setOption: boolean | null;
  provenance: 'initial_privilege' | 'supabase_managed';
};

type SupabaseProviderBaselineV1 = {
  schemaVersion: 1;
  profile: 'development';
  channel: 'beta';
  provider: 'supabase';
  baselineVersion: string;
  projectRefSha256: string;
  ownerOrgIdSha256: string;
  region: 'ap-northeast-2';
  databaseVersion: string;
  sourceEvidenceSha256: string;
  emptyBusinessState: {
    userTableCount: 0;
    userRowEstimate: 0;
    authUserCount: 0;
    bucketCount: 0;
    storageObjectCount: 0;
  };
  objects: ProviderObjectRecord[];
  grants: ProviderGrantRecord[];
  objectInventorySha256: string;
  grantInventorySha256: string;
  issuedAt: string;
  expiresAt: string;
  signingKeyId: string;
  ed25519Signature: string;
};
```

배열은 UTF-8 lexicographic order로 정렬하고 중복을 거부한다. OID처럼 프로젝트마다 달라지는 값은
identity에 쓰지 않는다. relation은 schema, 이름, relkind, 보안 속성, definition hash로 식별한다.
routine은 schema, 이름, identity arguments, return type, definition hash로 식별한다. grant는 object
identity와 grantor, grantee, privilege, grantable을 모두 비교한다.

한 객체나 grant의 문자열은 UTF-8 4,096바이트 이하이며 `objects`는 최대 5,000개, `grants`는
최대 20,000개다. 문서 전체의 1 MiB 상한이 먼저 적용된다. `baselineVersion`, key ID, identity는
빈 문자열, NUL, 경로 구분자와 제어 문자를 거부한다.

각 inventory hash는 해당 정렬 배열의 RFC 8785 JCS UTF-8 SHA-256이다. baseline 서명 입력은
`ed25519Signature`를 뺀 exact object의 RFC 8785 JCS UTF-8 앞에
`CCC-SUPABASE-PROVIDER-BASELINE-V1\0`을 붙인 바이트다.

baseline lifetime도 최대 30일이며, `issuedAt <= now < expiresAt`이어야 한다. baseline의
`expiresAt`은 `BetaTrustRootV1`, S2 manifest, 비공개 설치 승인서 중 가장 이른 만료를 넘을 수 없다.

### 3.4 `ProviderSourceEvidenceV1`

기존 두 저장소만 공식 근거로 인정한 가정은 실제 프로젝트와 맞지 않았다. 관리형 서비스 schema와
PostgreSQL 기본 role은 Auth, Storage, Realtime 서비스 저장소 또는 PostgreSQL 공식 저장소에서 정의된다.

```ts
type ProviderSourceEvidenceRecordV1 = {
  kind: 'schema' | 'relation' | 'routine' | 'type' | 'catalog'
    | 'column' | 'default' | 'role';
  identitySha256: string;
  sourceUrl:
    | 'https://github.com/supabase/supabase'
    | 'https://github.com/supabase/postgres'
    | 'https://github.com/supabase/auth'
    | 'https://github.com/supabase/storage'
    | 'https://github.com/supabase/realtime'
    | 'https://github.com/postgres/postgres';
  sourceRevision: string;
  sourcePath: string;
  sourceSha256: string;
};

type ProviderSourceEvidenceV1 = {
  schemaVersion: 1;
  provider: 'supabase';
  databaseVersion: string;
  records: ProviderSourceEvidenceRecordV1[];
};
```

문서와 각 record는 닫힌 key 집합을 사용한다. `sourceRevision`은 record가 가리키는 저장소의 변경 불가능한
40자 소문자 hexadecimal commit이며 문서 전체에는 공통 revision을 두지 않는다. `identitySha256`은
해당 `supabase_managed` 객체 또는 grant의 provenance를 뺀 exact record를 RFC 8785 JCS로 직렬화한
UTF-8 SHA-256이다. 모든 `supabase_managed` record는 정확히 하나의 evidence record와 일대일로
대응하며 중복 identity를 거부한다. `extension`과 `initial_privilege` record에는 evidence row를 두지 않는다.

`identitySha256`와 `sourceSha256`은 64자 소문자 hexadecimal이고, `sourcePath`는 비어 있지 않은 정규화된
상대 경로여야 한다. record 문자열은 UTF-8 4,096바이트 이하이며 전체 문서는 1 MiB 이하이다. 생성기는
이 문서를 검증할 뿐 source를 fetch하지 않는다.

## 4. 기준선 생성

기준선 생성기는 쓰기 권한을 사용하지 않는다.

1. 서명된 설치 승인서와 beta trust를 먼저 검증한다.
2. Supabase 공식 CA와 `verify-full`로 session pooler 5432에 연결한다.
3. `BEGIN READ ONLY` 안에서 모든 non-system schema의 schema, relation, routine, type, catalog object,
   schema/table/column/routine/type/default/role grant를 읽는다.
4. `pg_depend`의 extension membership과 `pg_init_privs`를 기계적으로 분류한다.
5. 남은 `supabase_managed` 후보를 위 여섯 공식 저장소의 record별 고정 commit과 source evidence로
   대조한다. 공식 소스에서 근거를 찾지 못한 객체나 grant가 하나라도 있으면 기준선을 만들지 않는다.
6. 업무 표와 행, Auth 사용자, bucket, Storage object가 모두 0인지 다시 확인한다.
7. 첫 관찰과 두 번째 관찰의 canonical inventory hash가 같을 때만 서명한다.

`sourceEvidenceSha256`가 가리키는 증거에는 record별 공식 저장소 URL, 고정 commit, 대조한 source path와
각 파일의 SHA-256, live database version을 기록한다. 값, token, 연결 문자열, 사용자 자료는 넣지 않는다.

## 5. 설치 plan 검증

`CCC_PROVIDER_BASELINE`과 `CCC_BETA_RELEASE_TRUST`는 JSON 문자열 또는 명시적 local file로만 받는다.
각 입력은 1 MiB 이하, duplicate-key 거부, exact schema, UTF-8이어야 한다.

검증 순서는 다음과 같다.

1. 외부 root map으로 `BetaTrustRootV1`을 검증한다.
2. trust가 위임한 release public key로 `SupabaseProviderBaselineV1`을 검증한다.
3. profile, channel, provider, 프로젝트, 소유자, 리전, DB 버전, 기간을 검증한다.
4. owner-aware read-only provider 관찰을 두 번 실행한다.
5. live objects와 grants를 baseline 배열과 정확히 비교한다.
6. live inventory의 집계 해시와 baseline의 두 집계 해시를 비교한다.
7. `emptyBusinessState`와 기존 S11 cleanliness 조건을 모두 확인한다.
8. 두 관찰의 inventory와 S11 state fingerprint가 같을 때만 plan을 만든다.

추가 객체, 누락 객체, 정의 변경, 추가 grant, grantable 변경, role membership 변경은 모두
`PROVIDER_BASELINE_MISMATCH`다. 새 값을 현재 기준선에 자동으로 추가하거나 이름 기반 예외로 넘기지 않는다.
DB 버전 또는 Supabase 관리 구성이 바뀌면 기존 기준선을 갱신하지 않고 새 baselineVersion을 발급한다.

baseline은 read-only plan을 통과시키는 근거일 뿐이다. S12 release artifact와 backup, rollback 증거를
대신하지 않으며 apply 권한도 만들지 않는다.

## 6. 오류와 출력

공개 plan 출력에는 다음 값만 싣는다.

- beta trust와 baseline의 검증 여부
- baselineVersion
- object와 grant의 기대 건수와 실제 건수
- 두 inventory SHA-256
- 고정 blocker code

객체 이름 목록, grant 원문, public key, 서명 원문, 승인서 원문, 연결 문자열, token은 출력하지 않는다.
허용하는 새 code는 다음 세 개다.

- `BETA_TRUST_INVALID`
- `PROVIDER_BASELINE_INVALID`
- `PROVIDER_BASELINE_MISMATCH`

## 7. 구현 경계

최소 구현 파일은 다음과 같다.

- `scripts/supabase/provider-baseline.mjs`
- `scripts/supabase/provider-baseline.test.mjs`
- `scripts/supabase/hosted-inspector.mjs`
- `scripts/supabase/plan.mjs`
- `scripts/supabase/bootstrap.mjs`
- `apps/community-cloud/src/main.ts`
- `apps/community-cloud/test/installer-private-key.test.mjs`

S2 manifest 형식과 `packages/contracts`는 바꾸지 않는다. provider baseline 형식은 설치기 전용이라
브라우저 계약에 넣지 않는다. 기존 `EXISTING_PROJECT_NOT_CLEAN`과 unowned object/grant 검사는 삭제하지
않고, 유효한 baseline이 모든 항목과 정확히 일치하는 경우에만 그 관찰을 승인된 provider 기본값으로
분류한다.

## 8. 검증

영구 계약 테스트는 다음 실패를 각각 증명한다.

- unknown root, revoked root, 잘못된 root signature
- `stable` 또는 `formal`로 바꾼 trust
- release key 바꿔치기와 baseline signature 위조
- 프로젝트, 소유자, 리전, DB 버전 불일치
- 만료, 미래 발행, duplicate key, unknown field, 잘못된 배열 순서와 중복
- provider schema에 숨긴 table, routine, type
- relation definition hash 변경
- default grant, role membership, grantable 변경
- 기대보다 하나 많은 객체와 하나 적은 객체
- 첫 관찰과 두 번째 관찰 사이의 inventory 변경
- 업무 표, 행, Auth 사용자, bucket, Storage object 존재
- 업무 런타임에 beta root 또는 release 개인키를 빈 값으로라도 주입

성공 fixture는 exact baseline 한 건뿐이다. 구현 검증 뒤 실제 Relayer 프로젝트에서 signed read-only
`plan`을 다시 실행한다. 통과 결과는 `ready=true`, `readOnly=true`, `unchanged=true`, DB 쓰기 0건이어야
한다.
