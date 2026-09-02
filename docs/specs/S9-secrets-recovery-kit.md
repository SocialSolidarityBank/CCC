# S9: 시크릿과 Recovery Kit

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D78, D82, D83; ADR-0042 D84; ADR-0038; `CCC_OPEN_PILOT_PLAN.md`의 SG9 및 E4-4a, E4-4b, E4-5
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `CCC_OPEN_PILOT_PLAN.md`, `docs/specs/S2-auth-capability-manifest.md`, `docs/specs/S4-local-service-profiles.md`, `docs/specs/S10-cccx-format.md`
- 산출: Core·Platform·Python SecretStore의 소유 경계, Windows DPAPI CurrentUser 규칙, Recovery Kit v1 payload·복원·재래핑 계약. 실제 adapter와 Windows 실행물은 관련 E 티켓이 소유한다.
- 관련 티켓: E4-4a, E4-4b, E4-5, E5-1b, E6-7, E7-3, E8-1, E8-2, E8-5

## 1. 목적

호출하는 런타임만 시크릿을 읽도록 Core, Platform, Python Agent의 소유와 저장 위치를 분리한다. Local Single과 Local Office의 키를 해당 Windows 계정의 DPAPI `CurrentUser`로 보호하고, 다른 SID의 새 PC에서도 passphrase로 Recovery Kit를 복원하되 원래의 안정 사용자 ID, 역할, 담당 배정을 바꾸지 않는다. 백업·복원과 키 회전은 암호화된 새 파일의 검증과 원자적 교체가 끝날 때까지 성공을 보고하지 않는다.

이 문서의 `확정`은 인터페이스, 금지 규칙, payload, 모드 차이, fixture, 검증 명령이 닫혔다는 뜻이다. 시크릿 adapter, DPAPI 호출, 실제 Windows·서버 교체 결과는 `구현 검증 완료`와 관련 E 티켓의 소유다.

## 2. 인터페이스와 규칙

### 2.1 소유 분류와 저장 위치

공통 `SecretStore` 서명과 `CoreSecretName`·`PlatformSecretName`의 합집합은 ADR-0041 D78의 정본을 그대로 사용한다. SG9는 그 포트의 구현이 어느 경계에만 접근하는지 정한다.

| 분류 | 이름 | 읽을 수 있는 런타임 | Community Cloud | Local Single / Local Office | Python Agent |
|---|---|---|---|---|---|
| Core | `CODEX_API_KEY` | `packages/core`가 호출하는 AI adapter | 기관 Edge secret | 해당 Local 실행 계정의 DPAPI `CurrentUser` | 읽지 않음 |
| Core | `PII_ENC_KEY` | Core의 PII vault 경계 | 기관 Edge secret | local-service 실행 계정의 DPAPI `CurrentUser` | 읽지 않음 |
| Core | `NOTIFY_WEBHOOK_URL` | Core 알림 adapter | 기관 Edge secret | local-service 실행 계정의 DPAPI `CurrentUser` | 읽지 않음 |
| Platform | `DB_MASTER_KEY` | DB adapter와 Local/Cloud 조립 루트 | 기관 Edge secret 또는 기관이 관리하는 platform secret store 한 곳 | local-service 계정의 DPAPI `CurrentUser` | 읽지 않음 |
| Platform | `FILE_ENC_KEY` | encrypted file adapter와 Local/Cloud 조립 루트 | 기관 Edge secret 또는 기관이 관리하는 platform secret store 한 곳 | local-service 계정의 DPAPI `CurrentUser` | 읽지 않음 |
| Platform | `OFFICE_CA_KEY` | Local Office TLS adapter만 | `null` | Office 전용 Windows Service 계정의 DPAPI `CurrentUser`; Single은 `null` | 읽지 않음 |
| Platform | `SUPABASE_SERVICE_ROLE_KEY` | Community Cloud API 조립 루트와 Supabase adapter만 | 기관 Edge secret | Local에서는 존재하지 않음 | 읽지 않음 |
| Python | `AZURE_SPEECH_KEY` | `apps/pipeline/ccc_pipeline/stt`의 Azure adapter | Agent의 DPAPI `CurrentUser` | Agent의 DPAPI `CurrentUser` | Python SecretStore만 |
| Python | `AGENT_REFRESH_TOKEN` | Agent pairing client | Agent의 DPAPI `CurrentUser` | Agent의 DPAPI `CurrentUser` | Python SecretStore만 |
| Python | `HF_TOKEN` | 명시적으로 허용된 Agent model downloader | Agent의 DPAPI `CurrentUser` | Agent의 DPAPI `CurrentUser` | Python SecretStore만 |

`Core`는 Platform 또는 Python 이름을 import하거나 조회하지 않는다. `apps/cloud-api`와 `apps/local-service` 및 platform adapter만 Platform을 조립하며, Python 이름은 TypeScript `SecretStore`에 존재하지 않는다. 개발용 환경변수 backend는 synthetic 개발 실행에만 허용하고, 정식 Local·Agent 설치는 위 DPAPI 경계를 사용한다. 같은 평문 키를 두 저장소에 복제하지 않는다. Recovery Kit는 이 규칙의 예외인 평문 저장소가 아니라, 아래 CCCR envelope 안에만 들어가는 암호화된 export다.

### 2.2 키 material과 버전

앱 내부의 recovery 경계는 D78의 문자열 `SecretStore.get`를 상속하지 않고 아래 byte 전용 포트를 사용한다. `SecretBytes`는 mutable `Uint8Array`이며 SecretStore·복원 서비스의 runtime API에서 JS `string`, base64 string, `Buffer`를 사용하지 않는다.

```ts
type SecretBytes = Uint8Array; // mutable; 호출 경계를 넘겨 보관하지 않음

interface RecoverySecretStore {
  getBytesWithVersion(
    name: 'DB_MASTER_KEY' | 'FILE_ENC_KEY' | 'PII_ENC_KEY' | 'OFFICE_CA_KEY',
  ): Promise<{ bytes: SecretBytes; version: number } | null>;
}
```

DB·파일·PII 키는 생성 시 CSPRNG로 만든 32-byte AES-256 material이며 version은 양의 정수이고 ciphertext와 함께 기록한다. `PII_ENC_KEY`의 version은 환경변수 이름과 동일한 의미의 `PII_KEY_VERSION`으로 관리한다. 매 export마다 Argon2id salt 16 bytes와 AES-256-GCM nonce 12 bytes를 CSPRNG로 새로 만든다. 같은 derived key에 salt 또는 nonce를 재사용하면 실패한다.

Recovery Kit plaintext payload는 JSON/base64가 아니라 RFC 8949 §4.2 deterministic encoding 프로파일의 canonical CBOR다. CBOR map은 definite length, duplicate key 0건, unknown key 0건, RFC 8949 결정적 key ordering을 사용하며 암호화된 payload 안의 key material은 CBOR byte string으로만 저장한다. non-canonical map, duplicate key, indefinite-length item은 reject한다. 아래 `CborByteString`은 serialization 개념이며 parse 즉시 mutable `SecretBytes`로 바뀐다.

```ts
type CborByteString = Uint8Array; // CBOR major type 2; wire-only byte string
type HashBytes = CborByteString;  // SHA-256 32 bytes

interface VersionedSecretCbor {
  key: CborByteString;
  version: number;
}

interface OfficeCaBundleCbor {
  key: CborByteString;              // PKCS#8/DER private key
  version: number;
  certificateDer: CborByteString;
  chainDer: CborByteString[];
  fingerprintSha256: HashBytes;
  subject: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  nameConstraints: string[];
}

interface ActorContinuityEntry {
  actorId: string;
  kind: 'human' | 'agent' | 'system';
  roleIds: string[];
  assignmentIds: string[];
  credentialRefHashes: HashBytes[]; // credential 값이 아닌 opaque hash
  mfa: { required: boolean; enrolled: boolean; methodRefHashes: HashBytes[] };
  active: boolean;
}

interface IdentityContinuityCbor {
  mode: 'community-cloud' | 'local-single' | 'local-office';
  stableUserId: string | null; // Single만 값; S2의 안정 ID
  actors: ActorContinuityEntry[]; // Cloud/Office의 모든 actor를 빠짐없이 열거
}

interface RecoveryKitPayloadV1Cbor {
  payloadVersion: 1;
  schemaVersion: number;       // 복원 대상 logical DB schema
  schemaDigest: HashBytes;     // S10 schema digest와 일치
  mode: 'community-cloud' | 'local-single' | 'local-office'; // source mode
  kitId: string;
  s10PayloadSha256: HashBytes; // S10 payloadSha256의 32-byte 값
  sourceInstallationId: string;
  sourceOrgId: string | null;
  createdAt: string;
  generation: number;          // monotonic high-water
  previousKitHash: HashBytes | null;
  stableUserId: string | null; // Single만 값; S2 §2.2의 설치 시 ID
  dbMasterKey: VersionedSecretCbor;
  fileMasterKey: VersionedSecretCbor;
  piiEncKey: VersionedSecretCbor; // version는 PII_KEY_VERSION
  officeCaKey: OfficeCaBundleCbor | null;
  identityContinuity: IdentityContinuityCbor;
}
```

`VersionedSecretCbor`와 `OfficeCaBundleCbor`는 canonical CBOR serialization 경계에서만 존재한다. 복호화된 payload를 가진 application service는 CBOR byte string을 `SecretBytes` 및 mutable certificate buffers로 decode한 뒤 CBOR/JSON object를 보관하지 않는다. 모든 `SecretBytes`, passphrase, Argon2 출력, decrypted payload, CA buffers, error buffers는 모든 성공·실패 경로의 `finally`에서 zeroize한다. crash dump는 Local 및 Agent process에서 비활성화한다.

`stableUserId`의 생성·Actor 매핑·SID와의 비결합 규칙은 S2 §2.2가 정본이다. Recovery는 이를 새 UUID로 재생성하지 않고 payload 값을 그대로 설치의 human Actor에 사용한다. Local Single의 `identityContinuity`는 `stableUserId` 외에 SID·credential·MFA 값을 담지 않는다. Cloud와 Office는 S2/ADR-0038의 모든 actor, role, assignment, credential reference hash, MFA required/enrolled/method mapping을 `identityContinuity.actors`에 빠짐없이 담되 credential 자체·raw subject·PII는 담지 않는다. DB의 전체 users/roles/assignments와 이 mapping이 모두 일치해야 하며, SID·email·새 install UUID로 권한을 재계산하거나 actor를 병합하지 않는다. `schemaVersion`과 `schemaDigest`가 대상 설치가 지원하는 값과 다르거나 필드·버전이 누락·중복되면 복원하지 않는다.

### 2.3 DPAPI CurrentUser 경계

| 주체 | DPAPI scope | 보호 대상 | 다른 계정의 결과 |
|---|---|---|---|
| Local Single의 local-service | `CurrentUser`로 현재 로그인한 interactive Windows 사용자 SID | Core·Platform local secret record | 복호화 실패; secret material을 반환하지 않음 |
| Local Office의 server service | `CurrentUser`로 전용 Windows Service 계정 SID | DB/file/PII key, `OFFICE_CA_KEY`, Core local secrets | interactive 관리자·다른 서비스 SID에서 복호화 실패 |
| Agent | `CurrentUser`로 Agent 실행 계정 SID | `AZURE_SPEECH_KEY`, `AGENT_REFRESH_TOKEN`, `HF_TOKEN` | 사람 계정과 다른 Agent SID에서 복호화 실패 |

DPAPI record에는 secret name allowlist, key version, schema version, DPAPI blob만 둔다. `LocalMachine` scope, machine key, SID를 직접 저장하거나 SID에서 stable ID를 유도하는 방식은 금지한다. 계정이 바뀐 새 PC의 import는 source DPAPI blob을 target 계정이 직접 복호화하는 절차가 아니다. passphrase로 Recovery Kit의 CCCR envelope를 검증한 뒤 target 계정의 `CurrentUser`로 새 DPAPI blob을 만들어 재래핑한다.
같은 SID라도 관리자 password 변경이나 Office service-account reset 뒤 DPAPI `unprotect`가 실패하면 `secret_access_denied`로 중단하고 Recovery Kit를 요구한다. 실패한 key를 새 key로 자동 교체하거나 빈 vault를 만들어 계속하지 않는다. Kit 검증과 target 계정 재래핑이 명시적으로 끝나기 전에는 어떤 replacement key도 생성·활성화하지 않는다.
### 2.4 복원·재래핑 작업의 선행 권한

복원, Kit 생성, passphrase 재래핑, data-key rotation, CA-only recovery는 어떤 키를 읽거나 쓰기 전에 작업 권한을 확인한다. 권한 확인이나 audit event가 실패하면 `RecoverySecretStore.getBytesWithVersion`, DPAPI unprotect/protect, Edge secret read/write, DB/file/PII/CA shadow write를 호출하지 않는다.

| 모드·작업 주체 | 선행 조건 | 감사와 일회성 조건 |
|---|---|---|
| Community Cloud 기관 `technical-admin` | S2의 authenticated Actor와 관리자 MFA가 현재 유효하고 recovery capability가 해당 기관·작업에 scope됨 | 시작·성공·실패를 audit에 기록하며, capability와 MFA assertion은 재사용하지 않음 |
| Local Office interactive 관리자 | `technical-admin` 역할 + 관리자 MFA가 local-service에서 확인됨 | 기존 서버의 recovery는 audit event를 먼저 남김. 깨끗한 서버 bootstrap은 물리적으로 전달된 one-time capability를 한 번 소비해야 함 |
| Local Single interactive 사용자 | Windows interactive 사용자, 앱 잠금 해제, local recovery capability가 모두 유효함 | clean-PC restore는 one-time physical bootstrap capability를 한 번 소비하고, capability 원문은 저장·로그하지 않음 |

```ts
interface RecoveryAuthorization {
  actorId: string;
  mode: 'community-cloud' | 'local-single' | 'local-office';
  mfaVerified: boolean;
  appUnlocked: boolean;
  capabilityHash: string;
  physicalBootstrap: boolean;
  auditEventId: string;
  cleanTarget: {
    signedLatestGenerationFloor: SecretBytes;
    latestGenerationFloor: number;
    targetTpmPublicKey: SecretBytes;
    nonce: SecretBytes;
    expiresAt: string;
    centralRedemptionId: string;
  } | null;
}
```

`RecoveryAuthorization`은 검증 후 폐기하는 ephemeral authorization 자료다. `mfaVerified`·`appUnlocked`·`physicalBootstrap`의 조합이 해당 모드 표와 다르면 거부한다. 깨끗한 target restore는 online organization-owned signed latest-generation floor와 target TPM/device public key에 bound된 one-time capability(`nonce`, `expiresAt`)를 요구한다. capability는 중앙에서 single-use redeem된 뒤에만 key read/write가 시작되며, offline clean-target restore는 fail closed다. 기존 target은 local active-generation high-water를 사용한다. `physicalBootstrap=true`인 capability는 consume 기록을 원자적으로 남긴 뒤 다시 사용할 수 없고, target machine에 설치된 capability file에 복사하지 않는다.

snapshot 전에 maintenance write fence를 acquire하고 이미 접수된 write를 drain한 뒤 source generation을 pin한다. fence는 모든 old-generation write를 차단하며 new shadow의 전체 hash·vault·authorized save 검증과 active pointer flip이 끝날 때까지 유지한다. 따라서 acknowledged old-generation write가 shadow 또는 복원 결과에서 사라질 수 없다.

```ts
interface RecoveryWriteFence {
  acquire(): Promise<{ sourceGeneration: number; release(): Promise<void> }>;
  drainAcknowledgedWrites(): Promise<void>;
}
```

### 2.5 저장·출력 금지와 오류


다음 위치에는 시크릿 값, passphrase, 복호화된 키, raw DPAPI/CA material을 한 byte도 남기지 않는다.

| 위치 | 금지 | 대신 |
|---|---|---|
| DB와 파일 | secret 값, passphrase, raw SID, 평문 vault/key table, 평문 임시 파일 | DB/file ciphertext와 DPAPI blob; 키는 호출 중 메모리에서만 사용 |
| 로그·stdout·stderr·crash dump·telemetry | 값, key 이름+값 쌍, passphrase, SID, token, vendor 원문 오류·stack | 고정 error code, request/operation hash, timestamp만 |
| UI·DTO·URL·browser storage | 값, passphrase, key hash로 복원 가능한 material, DPAPI blob | 고정된 복구 안내와 비밀 없는 상태 code |
| CLI 인자·환경변수 | 정식 설치의 key/passphrase 입력 | secure prompt 또는 descriptor/stdin; Cloud는 provider secret injection |
| Windows 보호 범위 | `LocalMachine`, 공유 service 계정, 임의 파일 ACL 완화 | 주체별 `CurrentUser` + 최소 ACL |

오류는 원인별 code만 외부에 내고 공급자 메시지는 redaction한다.

```ts
type SecretErrorCode =
  | 'secret_missing'
  | 'secret_access_denied'
  | 'secret_invalid'
  | 'recovery_kit_invalid'
  | 'recovery_kit_integrity_failed'
  | 'recovery_restore_blocked';
```

화면 문구는 `보안 설정을 확인할 수 없어 작업을 완료하지 못했습니다.` 또는 `복원 검증에 실패해 기존 상태를 유지했습니다.` 중 하나만 사용한다. 로그에는 code·operation·requestId hash·timestamp만 있으며 secret name, path, SID, passphrase 길이와 암호화 library의 원문 오류를 넣지 않는다. 누락·권한 부족·무결성 실패를 내부 판정할 수는 있지만 외부 문자열로 키 존재 여부를 추측하게 하지 않는다.

### 2.6 Recovery Kit v1 envelope

Recovery Kit v1은 `.cccx` data export와 구별되는 파일이며 다음 고정 wire layout을 사용한다.

```text
magic[5] || headerLength[4] || canonicalHeader[headerLength] ||
ciphertext[ciphertextBytes] || gcmTag[16]

magic = 43 43 43 52 01                 // ASCII "CCCR" + version 1
headerLength = unsigned 32-bit big-endian byte count
```

Recovery Kit header는 아래 필드만 가지며 canonical JSON의 key order와 whitespace는 S10의 canonical JSON 규칙을 사용한다. `headerLength`는 framing field이고 header JSON에 다시 넣지 않는다.

```ts
interface RecoveryKitHeaderV1 {
  formatVersion: 1;
  payloadBytes: number;
  ciphertextBytes: number;
  payloadSha256: string;       // lowercase 64-hex; S10 canonical CBOR hash
  argon2id: {
    saltB64: string;           // unpadded RFC4648 base64url; decoded 16 bytes
    memoryKiB: 65536;
    iterations: 3;
    parallelism: 1;
  };
  aes256Gcm: { nonceB64: string }; // unpadded RFC4648 base64url; decoded 12 bytes
}
```
`ciphertextBytes`와 실제 ciphertext 길이가 같아야 하고, `headerLength`는 1~4096 bytes, `payloadBytes`·`ciphertextBytes`는 0보다 크고 각각 64 MiB 이하인 safe integer여야 한다. `payloadSha256`는 복호화한 canonical CBOR payload의 SHA-256을 lowercase 64-hex로 표현한 값과 byte-for-byte 일치해야 한다. `saltB64`와 `nonceB64`는 padding 없는 RFC4648 base64url이어야 하며 decode 결과가 각각 16/12 bytes가 아니면 실패한다. Argon2id와 AES-256-GCM의 parameter 값은 SG10 v1과 같지만 S9는 SG10 `.cccx` header/framing을 재사용하지 않는다. 즉 Recovery Kit의 header는 위 schema로 독립적으로 닫힌다.

GCM AAD는 `ASCII("CCC-RECOVERY-KIT\0v1") || magic || uint32be(headerLength) || canonicalHeaderBytes`로 domain-separate하고 magic·length·header를 모두 authenticate한다. header parse, length bound, tag, payload hash, `formatVersion` 중 하나라도 실패하면 복호화 결과를 사용하지 않는다. passphrase는 Unicode scalar 기준 16자 이상이어야 하며 trim·자동 보정하지 않는다. passphrase는 secure prompt/descriptor에서 한 번 받아 Argon2id를 수행하는 동안에만 mutable bytes로 존재하고, 저장·복사·로그·fixture 출력·복원 metadata에 포함하지 않는다. 16자 미만, 빈 입력, unknown payload field, 지원하지 않는 source/target mode 조합은 `recovery_kit_invalid` 또는 `recovery_kit_integrity_failed`로 끝난다. `mode`는 payload를 만든 source mode이고, restore 요청의 target mode는 S10/ADR-0041 D83의 허용된 migration 방향으로 별도 검증한다.

### 2.7 Backup, restore, rewrap 포트

백업·복원은 D83의 공통 Application Service이며 `Database`·`AudioStore` 등 일곱 저수준 포트에 추가하지 않는다. 구현은 아래 결과 불변조건을 지킨다.
백업/복원 서비스가 어떤 작업명을 사용하더라도 `restored`는 아래 모든 검사 뒤에만 산출한다. 특히 vault decrypt 또는 authorized record save가 실패한 백업·복원 실행은 성공한 백업으로 보고할 수 없다.

```ts
interface RestoreRequest {
  kitPath: string;
  passphrase: SecretBytes;    // secure input; 호출 뒤 즉시 zeroize
  targetMode: 'community-cloud' | 'local-single' | 'local-office';
  authorization: RecoveryAuthorization;
}

interface RestoreChecks {
  kitIntegrity: boolean;
  keysRewrapped: boolean;
  schemaDigestEqual: boolean;          // S10 schemaDigest와 target
  modeInstallationOrgEqual: boolean;   // source/target binding
  databaseContentHash: boolean;        // 모든 기존 row의 canonical hash
  fileContentHash: boolean;            // 모든 기존 file의 ciphertext/content hash
  plaintextContentHash: boolean;       // 복호화된 DB/file/PII content hash
  allVaultEnvelopes: boolean;          // vault envelope 전부 decrypt/re-encrypt
  authorizedRecordSave: boolean;
  roleAssignmentContinuity: boolean;
  actorCredentialVerifierMapping: boolean; // 모든 actor
  loginMfaReenrollment: boolean;       // 또는 감사된 disable+reinvite
  officeCaRecovered: boolean;
  activationCommitted: boolean;
}

type RestoreStatus =
  | 'staged'
  | 'data_restored'
  | 'operational_restored'
  | 'ca_recovery_pending'
  | 'failed';

interface RestoreReport {
  status: RestoreStatus;
  checks: RestoreChecks;
  stableUserId: string | null;
  mode: 'community-cloud' | 'local-single' | 'local-office'; // targetMode
  generation: number;
  errorCode: SecretErrorCode | null;
}
```

`RestoreRequest.passphrase`는 메모리 수명만 표시한 계약 필드이며 저장 가능한 설정·DTO가 아니다. `status='data_restored'`는 `kitIntegrity`, `keysRewrapped`, `schemaDigestEqual`, `modeInstallationOrgEqual`, `databaseContentHash`, `fileContentHash`, `plaintextContentHash`, `allVaultEnvelopes`, `authorizedRecordSave`, `roleAssignmentContinuity`, `actorCredentialVerifierMapping`, `activationCommitted`가 모두 `true`일 때만 허용한다. `status='operational_restored'`는 여기에 모든 active actor의 실제 login/MFA 재등록(`loginMfaReenrollment`) 또는 명시적 감사 disable+reinvite, 그리고 target mode가 `local-office`이면 `officeCaRecovered=true`를 더 요구한다. Cloud/Office의 actor mapping과 login/MFA가 하나라도 실패하거나 vault decrypt·권한 있는 record save가 실패하면 `operational_restored` 또는 일반 `restored`를 절대 보고하지 않고 target의 기존 active generation을 유지한다. Office CA만 실패하면 `ca_recovery_pending`으로만 보고하며, 이 값도 operational_restored가 아니다.

`databaseContentHash`는 S10 backup의 모든 기존 DB row를 canonical row encoding으로 다시 hash한 값이고, `fileContentHash`는 모든 file ciphertext와 manifest hash를 대조한 값이다. `plaintextContentHash`는 old key로 복호화한 DB/file/PII의 plaintext canonical content hash를 target generation에서 다시 계산한 값이다. `allVaultEnvelopes`는 한 sample이 아니라 모든 PII vault envelope를 old key로 decrypt하고 target key generation으로 re-encrypt한 뒤 각 envelope와 plaintext hash를 확인한 값이다. `schemaDigestEqual`과 `modeInstallationOrgEqual`은 S10 metadata, source installation/org, target authorization scope를 함께 대조한다.

### 2.8 Atomic write, replace와 key rotation

모든 복원과 rotation은 Kit 파일만 바꾸는 것이 아니라 generation-staged transaction으로 수행한다. DPAPI/Edge key records, DB, encrypted files, PII vault, Office CA와 Kit는 같은 `generation`과 단일 active pointer를 사용한다.

```ts
type RecoveryJournalPhase =
  | 'prepared'
  | 'shadow_written'
  | 'rewritten'
  | 'verified'
  | 'activated'
  | 'rolled_back';

interface RecoveryGenerationJournal {
  schemaVersion: 1;
  operation: 'restore' | 'passphrase-rewrap' | 'data-key-rotation' | 'ca-only-recovery';
  kitId: string;
  oldGeneration: number;
  newGeneration: number;
  previousKitHash: string | null;
  phase: RecoveryJournalPhase;
  componentHashes: {
    dpapiOrEdge: string;
    database: string;
    files: string;
    pii: string;
    officeCa: string | null;
    kit: string;
  };
}

interface ActiveGenerationPointer {
  schemaVersion: 1;
  generation: number;
  kitId: string;
  kitHash: string;
  activatedAt: string;
}
```

journal에는 plaintext secret, passphrase, SID, credential, vault plaintext를 넣지 않는다. `target high-water`는 현재 active generation보다 낮거나 같은 generation, `previousKitHash`가 현재 chain과 맞지 않는 Kit를 replay/downgrade로 거부한다. 단, 명시적인 disaster override capability와 step-up MFA를 받은 technical-admin이 사유를 audit에 남긴 경우에만 override를 허용하며, 이때도 현재 state와 새 Kit의 전체 content hash·vault·authorized save 검증은 생략하지 않는다. source installation/org와 `kitId`, S10 `payloadSha256`, `createdAt`도 trusted target metadata와 대조한다.

정상 순서는 다음과 같다.

1. §2.4 작업 권한과 audit를 먼저 통과시킨 뒤 `RecoveryWriteFence.acquire()`와 `drainAcknowledgedWrites()`를 실행해 source generation을 pin한다. fence를 유지한 채 source envelope를 열고 payload를 `SecretBytes`로 decode한다. 입력 passphrase, Argon2 output, decrypted payload, CA buffers와 error buffers는 모든 성공·실패 경로의 `finally`에서 zeroize한다.
2. pinned old generation을 읽어 schema digest, source/target binding, DB의 모든 기존 row canonical hash, 모든 file ciphertext와 plaintext content hash, 모든 PII vault envelope 및 plaintext hash, role/assignment와 actor credential/MFA continuity를 계산한다. 누락·불일치이면 old active pointer를 유지하고 중단한다.
3. new generation의 DPAPI/Edge key records, DB shadow, file shadow, PII shadow, CA shadow와 new Kit를 작성한다. old와 new를 동시에 보존하되 어느 client도 new shadow를 active로 읽지 않는다.
4. new generation에서 DB/file 전체 ciphertext·plaintext hash, 모든 vault decrypt/re-encrypt와 plaintext hash, authorized record save/read, actors/roles/assignments, 모든 actor credential verifier와 login/MFA 재등록 또는 감사 disable+reinvite, Office CA key/certificate pair·chain·fingerprint·client trust, Kit magic/header/tag/hash를 모두 검증한다. 하나라도 실패하면 new shadow를 폐기하고 old generation을 유지한다.
5. journal을 `verified`로 flush한 뒤 active pointer 하나만 atomic replace하여 new generation을 활성화하고, pointer·journal을 다시 읽어 검증한다. 이 시점 전에는 `data_restored`나 `operational_restored`를 보고하지 않는다.
6. pointer flip과 active generation 전체 검증이 성공한 뒤에만 fence를 release하고, 복구 window가 확인된 뒤 old generation을 retire한다. fence release 전 old-generation write는 모두 drain되어야 한다.

passphrase rotation은 DB/file/PII/CA key material과 version을 바꾸지 않고 새 passphrase로 envelope와 generation journal만 재래핑한다. data-key rotation은 old ciphertext를 old version으로 decrypt하고 모든 shadow content를 new version으로 re-encrypt한 뒤 새 Kit를 검증한다. Office CA-only recovery도 같은 shadow/verify/activate 절차를 따르며 DB·role·assignment를 덮어쓰지 않는다.

재시작 판정은 다음과 같다.

| 중단 지점 | 재시작 동작 | 허용 상태 |
|---|---|---|
| `prepared` 또는 `shadow_written` | new shadow/journal을 폐기하고 old pointer 유지 | old generation만 active |
| `rewritten` 또는 `verified` | new 전체 hash와 journal을 다시 검증; 실패하면 new 폐기 | 검증 성공 때만 activation 재개 |
| `activated` | pointer가 old/new 중 하나인지 읽고 active generation 전체 검증 | new가 완전하면 finalize, 아니면 old로 atomic rollback |
| pointer 누락·두 pointer·journal hash 불일치 | 업무 API와 키 read/write를 fail closed하고 old/new 전체 검증 후 한 pointer만 복구 | `data_restored`·`operational_restored` 금지; 모호한 상태는 `failed` |

어느 단계에서도 old Kit를 먼저 삭제하거나 검증 전 new Kit를 canonical 경로로 노출하지 않는다. Kit 파일 자체는 같은 destination directory에서 `ciphertext temp → file flush/fsync → reopen verify → atomic replace → reopen verify` 순서를 지키며, crash 시 검증 가능한 old 또는 new 하나만 남는다.

Office에서 `officeCaKey`가 `null`이면 CA를 새로 만들어 기존 fingerprint를 가장하지 않는다. Office source Kit의 non-null CA slot을 복원하면 CA private key와 E8-2가 소유한 certificate chain metadata를 함께 검증해 같은 HTTPS identity를 유지한다. data restore가 끝난 후 CA만 분실된 경우에는 non-null slot을 가진 별도 Recovery Kit를 passphrase로 검증해 target service account의 DPAPI `CurrentUser`에 원자적으로 재래핑할 수 있다. 이 CA-only 작업은 기존 DB·role·assignment를 덮어쓰지 않으며, CA 검증 전에는 `operational_restored`를 반환하지 않는다.

## 3. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| Core/Platform 저장 | 기관 Supabase/Edge secret; provider-managed storage key는 이 경계 밖으로 내보내지 않음 | interactive 사용자 local-service의 DPAPI `CurrentUser` | 전용 Windows Service 계정의 DPAPI `CurrentUser` |
| Python Agent | Agent PC의 Python DPAPI `CurrentUser`; Azure key와 refresh token은 Edge/TS로 가지 않음 | Agent PC의 Python DPAPI `CurrentUser` | Agent PC의 Python DPAPI `CurrentUser` |
| `officeCaKey` | 항상 `null` | 항상 `null`; Office 승격 시 새 Kit에 non-null을 넣음 | CA private key slot non-null이어야 기존 HTTPS identity 복구 |
| human ID | Supabase Auth `sub` → users directory; S2 규칙 | Kit의 `stableUserId`를 그대로 유지; SID와 분리 | 백업 DB의 users/role/assignment ID를 그대로 유지; 서비스 계정은 human Actor가 아님 |
| 다른 SID/계정 복원 | Cloud Auth가 관리하며 DPAPI 없음 | passphrase envelope를 target SID에서 열고 target `CurrentUser`로 재래핑 | source service SID로 raw DPAPI decrypt하지 않고 target service SID로 재래핑 |
| 복원 단계 | `data_restored`: full hashes/vault/authorized save/continuity; `operational_restored`: 모든 actor credential verifier와 login/MFA 또는 감사 disable+reinvite | `data_restored`: stable ID + full hashes/vault/save; `operational_restored`: app unlock과 stable Actor 실제 사용 | `data_restored`: full hashes/vault/save/continuity; `operational_restored`: 모든 actor login/MFA + CA/client trust/기존 URL |
| 복원 권한 | technical-admin + 유효한 MFA + 기관 scope capability + audit | 앱 잠금 해제 + local interactive recovery capability; clean PC는 one-time physical bootstrap | technical-admin + 관리자 MFA + audit; clean server는 one-time physical bootstrap |
| 연속성 검증 | 모든 users/roles/assignments와 `identityContinuity.actors` 및 credential/MFA mapping | `stableUserId` 하나와 Single Actor/assignment의 logical ID | 모든 users/roles/assignments, credential/MFA mapping과 CA chain/fingerprint |

세 모드 모두 키는 호출 위치에만 두고, 백업 산출물에는 Recovery Kit CCCR envelope의 암호문만 둔다. `.cccx` table/file import의 암호화와 staging journal은 S10, Cloud backup/restore 실행은 E6-7, Single runtime과 새 PC 복원은 E7-3, Office CA·서버 교체는 E8-2/E8-5가 소유한다. 역할·담당 판정은 ADR-0038과 공통 gateway가 소유한다.

## 4. 계약 fixture와 기대 판정

모든 fixture는 synthetic 데이터만 사용하고, key material은 테스트 harness가 고정 seed로 만든 32-byte 값이다. 실제 기관 key, token, SID, passphrase는 fixture와 증거에 넣지 않는다. 모든 error assertion은 원문 문자열이 아니라 code와 redaction 여부를 비교한다.

| ID | 입력과 실행 | 기대 판정 |
|---|---|---|
| F01 payload shape/version | `payloadVersion=1`, `schemaVersion=44`, `schemaDigest`, source mode `local-single`, `kitId=kit-1`, 32-byte `s10PayloadSha256`, `sourceInstallationId=install-1`, `sourceOrgId=null`, fixed `createdAt`, `generation=7`, `previousKitHash=null`, CBOR byte-string DB/file/PII versions `3/5/2`, `officeCaKey=null`, S2 stable ID | deterministic canonical CBOR parse 성공. JSON/base64 key material, field 누락·중복·추가, 0/음수 generation/version, 잘못된 byte length/hash, source metadata 불일치, unsupported schema는 실패 |
| F02 passphrase/randomness boundary | 15 Unicode scalar passphrase, 16 scalar passphrase, 같은 key로 두 Kit export와 passphrase/payload 포함 write, deterministic RNG와 nonce/salt reuse 주입 | 15자는 `recovery_kit_invalid`; 16자는 성공. 각 export의 salt 16B와 nonce 12B가 CSPRNG로 서로 다르고 같은 derived key에 재사용되지 않는다. deterministic RNG 또는 salt/nonce reuse는 실패하며 passphrase는 DB/file/log/UI/temp/recovery report 어느 곳에도 저장되지 않고 Argon2/decrypted/error buffers는 finally에서 zeroize |
| F03 same-account DPAPI | Single·Office·Agent 각각 owner account로 DPAPI record write → read; 같은 SID의 password/service-account reset 뒤 unprotect failure도 실행 | owner 계정에서 지정 key/version 복호화 성공. reset 뒤 실패는 `secret_access_denied`와 Kit 요구이며 replacement key 생성·빈 vault 진행은 실패 |
| F04 cross-account DPAPI | account-A SID로 만든 DPAPI blob을 account-B SID와 Office interactive 관리자 SID에서 각각 read | 두 read 모두 `secret_access_denied`, key bytes·SID·vendor 오류 0건. 같은 machine이라는 이유로 성공하거나 `LocalMachine`을 사용하면 실패 |
| F05 different-SID Single restore | account-A Kit를 account-B 깨끗한 PC에서 online organization-owned signed latest-generation floor, target TPM public key+nonce+expiry에 bound된 중앙 single-use capability와 passphrase로 open; target DPAPI 재래핑; `stableUserId=single-user-1`, role `worker`, assignment `case-1` 복원 | source raw DPAPI decrypt 없이 target blob 생성. capability redeem 전 key read/write 0건, stable ID·role·assignment와 full content hash가 logical match이고 authorized save/login 성공. offline clean-target, 새 UUID/SID Actor가 생기면 실패 |
| F06 full restore fail-closed | F05에서 전체 DB rows 중 1건의 row hash, 전체 files 중 1건의 ciphertext 또는 plaintext hash, 모든 vault envelope 중 1건, vault decrypt, authorized record save, actor credential verifier/login/MFA를 각각 실패시킴 | 각 실행 `failed`, `data_restored`·`operational_restored` 0건, old DB/files/PII/Kit/pointer 보존. 전체 집합을 확인하지 않거나 어느 boolean false인데 restored이면 실패 |
| F07 generation atomicity | write fence acquire/drain/pin 뒤 DPAPI/Edge, DB, files, PII, CA shadow와 old/new Kit를 두 generation으로 만들고 acknowledged old write 및 각 journal phase 직전/직후 중단 | fence release 전 acknowledged old write가 보존되고, 재시작 matrix대로 old 또는 완전 검증된 new 하나만 active. truncated/mixed shadow, 두 pointer, pointer-before-verify는 실패 |
| F08 key rotation rewrap | old DB/file/PII versions `3/5/2`와 새 passphrase, 이어서 new data versions `4/6/3`를 각각 실행 | passphrase-only는 key/version 불변, fresh salt/nonce envelope만 변경. data rotation은 all-content old decrypt → new shadow → full verify → activation이며 중간 실패 시 old 유지 |
| F09 Office CA slot and later recovery | Single Kit의 `officeCaKey=null`을 Office data target에 복원; non-null CA Kit에는 key, exact cert/chain DER, fingerprint, subject/serial/validity/name constraints를 넣어 target service SID에 CA-only import | null slot은 `ca_recovery_pending`이며 가짜 fingerprint 금지. non-null pair/chain/client trust 검증 뒤에만 CA 활성화, 기존 HTTPS URL/fingerprint 일치, DB/assignment 변경 0건 |
| F10 redacted errors | malformed magic/header, wrong passphrase, unknown schema, missing secret, provider access-denied를 각각 실행 | 외부 code만 고정 code로 반환하고 secret value/name, passphrase, SID, vendor text, decrypted/error buffers가 관측되지 않음; crash dump 0건 |
| F11 operation authorization | Cloud/Office에서 technical-admin 또는 MFA/audit 누락, Single app-lock/recovery capability 누락, clean machine one-time physical bootstrap 재사용을 각각 실행 | 모든 실패가 첫 key read/write 전 차단되고 `RecoverySecretStore.getBytesWithVersion`, DPAPI, Edge, DB/file/PII/CA shadow 호출 0건. capability 재사용은 거부 |
| F12 replay/high-water | existing target local high-water `7`에 generation `6`, `7` replay, wrong `previousKitHash`, 다른 source org/install, downgrade Kit을 실행; clean target에는 offline/expired/unredeemed floor capability도 실행; audited disaster override도 실행 | 기존 target과 clean target 모두 기본 fail closed와 old pointer 유지. 명시적 step-up disaster override만 허용되며 그때도 online signed floor와 full current-state/content/vault/authorized checks를 다시 통과해야 함 |

## 5. 완료 조건

- [ ] Core·Platform·Python secret 이름, 호출 주체, 세 모드 저장 위치와 DPAPI `CurrentUser` scope가 §2.1 및 §3에 완결되어 있다.
- [ ] byte-only `RecoverySecretStore.getBytesWithVersion`, mutable `SecretBytes`/zeroize·crash-dump 차단과 `PII_ENC_KEY`/`PII_KEY_VERSION`, DB/file key version, stable ID 및 Cloud/Office exhaustive actor·credential/MFA mapping이 §2.2에 완결되어 있다.
- [ ] DPAPI same-SID reset 실패와 `LocalMachine`, DB·파일·로그·UI·CLI·crash dump의 금지 및 redacted error code가 §2.3~§2.5에 완결되어 있다.
- [ ] Recovery Kit magic, standalone CCCR header wire schema/length bounds, deterministic canonical CBOR payload byte strings, fresh salt/nonce, S10-compatible crypto parameters, domain-separated AAD, 16자 passphrase 비저장이 §2.6에 완결되어 있다.
- [ ] 다른 SID 복원, operation authorization·online clean-target floor 선행 검사, full DB/file ciphertext·plaintext/vault content hash, role/assignment continuity, vault decrypt·authorized record save 없이는 `data_restored` 또는 `operational_restored`가 될 수 없는 불변조건이 §2.4 및 §2.7에 완결되어 있다.
- [ ] generation-staged DPAPI/Edge·DB·files·PII·CA journal, maintenance fence/drain, single active pointer, high-water/replay guard, restart rollback, passphrase/data-key rewrap와 later CA recovery가 §2.8에 완결되어 있다.
- [ ] F01~F12의 입력, 기대 성공·실패, redaction·rollback·replay/randomness 판정이 §4에 완결되어 있다.
- [ ] 검증 명령과 각 명령의 실패 판정이 §6에 적혀 있으며, 이 문서를 `확정`으로 올리기 위해 구현 artifact나 실제 Windows 결과를 요구하지 않는다.

## 6. 검증 방법

구현 검증 시 저장소 루트에서 실행한다. 실제 키와 기관 데이터는 사용하지 않으며, 명령 결과와 증거 파일은 관련 E 티켓이 기록한다.

- `pnpm test:contracts --secrets`: F01~F03과 F10의 name allowlist, byte-only `getBytesWithVersion`, mutable `SecretBytes`, payload schema/version, 32-byte key, `PII_KEY_VERSION`, nullable CA slot, zeroization 계약을 검사한다. 필드·version·encoding·zeroize가 다르면 FAIL이다.
- `pnpm test:security --dpapi --modes=single,office,agent`: F03~F04를 실제 Windows 계정에서 검사한다. `LocalMachine` 사용, same-SID reset 뒤 replacement key 생성, cross-account decrypt 성공, raw SID/key/error 노출이 한 건이라도 있으면 FAIL이다.
- `pnpm test:contracts --recovery-kit`: F01~F06, F09~F10, F12의 deterministic canonical CBOR, CCCR wire header/AAD, fresh salt/nonce, payload/schema hash, passphrase boundary, cross-SID rewrap, exhaustive identity continuity, full DB/file/vault verification, data/operational restore split, CA pair/client trust, high-water/replay를 검사한다. vault decrypt·authorized save·기존 content hash·actor login/MFA 중 하나라도 실패한 뒤 `data_restored` 또는 `operational_restored`가 나오면 FAIL이다.
- `pnpm test:security --recovery-authorization`: F11의 Cloud/Office technical-admin+MFA+audit, Single app-lock/capability, clean-machine online signed floor와 target TPM-bound one-time physical bootstrap을 검사한다. authorization 전 key read/write, offline clean-target, capability 재사용이 있으면 FAIL이다.
- `pnpm test:atomicity --recovery-kit --crash-points=all-generations`: F07~F08의 maintenance fence/drain, DPAPI/Edge, DB, files, PII, CA, Kit shadow와 단일 active pointer를 모든 crash point에서 검사한다. truncated/mixed artifact, 두 active pointer, 검증 전 activation, old acknowledged write loss는 FAIL이다.
- `pnpm guard:secrets`: source, fixture, docs artifact scan에서 실제 secret·passphrase·raw SID·base64 runtime storage·forbidden storage 경로가 1건이라도 발견되면 FAIL이다.
- `pnpm test:golden --restore --mode=local-single` 및 `pnpm test:golden --restore --mode=local-office`: F05~F09의 새 PC·서버 교체 flow를 검사한다. 모든 기존 DB row/file ciphertext와 plaintext/vault hash, 동일 stable ID 또는 exhaustive actor mapping, 신규 authorized record save, 실제 actor login/MFA 또는 감사 disable+reinvite, Office CA fingerprint·client trust·기존 URL까지 모두 `operational_restored`여야 한다.

위 명령은 `확정`을 증명하는 실행 결과가 아니라 구현 검증 명령이다. 명령의 실제 증거가 없으면 이 문서는 여전히 `확정`이고 관련 E 티켓은 `구현 검증 완료`가 아니다. 기존 assertion 삭제·skip·완화, 평문 fallback, secret error 원문 출력은 어떤 결과에서도 PASS로 인정하지 않는다.

## 7. 이번에 안 하는 것

- `.cccx` manifest/JSONL/attachment ZIP, SG10 staging journal과 재시작 import는 S10이 소유하며 이 문서에서 다시 정의하지 않는다.
- `SecretStore` 구현, Node/Deno/Windows DPAPI binding, embedded Agent와 실제 key injection은 E4-4a, E4-4b, E5-1b가 소유한다.
- Community Cloud의 provider backup/restore 실행은 E6-7, Local Single의 설치·복원 실행은 E7-3, Office TLS·CA 발급과 서버 교체 실행은 E8-2/E8-5가 소유한다.
- 키 rotation을 위한 UI, 원격 secret escrow, password manager 연동, 사용자의 passphrase recovery, multi-server HA는 이번 계약에 넣지 않는다.
- 이 문서는 실제 기관의 key, passphrase, SID, role assignment 또는 복원 결과를 저장하지 않으며, 다른 S9 정본 파일·구현 shim·deprecated alias를 만들지 않는다.
