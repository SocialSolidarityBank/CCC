# S12: 설치·릴리스

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76~D83, ADR-0042 D84, `CCC_OPEN_PILOT_PLAN.md` SG12
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `CCC_OPEN_PILOT_PLAN.md`, SG8 `AudioStore`, SG9 Recovery Kit, SG10 `.cccx`, SG11 Supabase Edge
- 산출: 다섯 artifact family의 설치·업데이트·rollback 계약, 서명 manifest/bundle, 정식 릴리스 증거, 진단 redaction 규칙
- 관련 티켓: E5-7, E6-5a, E6-5b, E6-7, E7-4, E7-6a, E7-6b, E8-3, E8-9, E9-1, E10-1, E10-2, E10-3, E10-4, E10-5, E10-6

## 1. 목적

Community Cloud 명령과 세 가지 Local 설치 표면을 같은 코어 릴리스 규칙으로 배포한다. 모든 업데이트는 manifest·ReleaseBundle·Ed25519·플랫폼 서명·hash·schema·만료·anti-downgrade를 먼저 검증하고, 유지보수 barrier 안에서 검증된 백업과 peer health 확인 없이는 적용하지 않는다. `확정`은 아래 인터페이스, 규칙, fixture, 명령과 기대 판정을 닫은 상태이며 실제 설치기·서명·복원 결과는 관련 E 티켓의 구현 증거다.

## 2. 릴리스 표면과 artifact

### 2.1 명령

Community Cloud 명령은 `ccc cloud` 하나의 실행 파일로 제공한다. 자격증명은 명령행에 받지 않으며, Supabase 관리 토큰은 `SUPABASE_ACCESS_TOKEN` 환경변수로만 읽고 프로젝트 식별자는 `--project-ref` 또는 `CCC_SUPABASE_PROJECT_REF`로 받는다(D84). 모든 명령은 기본적으로 한국어 고정 메시지와 종료 코드만 출력하며 `--json`은 §7의 redacted schema만 출력한다.

| 명령 | 동작 | 성공 조건 | 실패 시 동작 |
|---|---|---|---|
| `ccc cloud install --manifest-url <url> [--project-ref <ref>]` | 정식 Cloud CLI와 기관 Supabase Edge 배포에 필요한 signed artifact를 검증하고 설치한다. 첫 동작은 D84 read-only `plan`이며 plan의 변경은 없다. | bundle/manifest, tuple, hash, schema, key, URL origin, backup/health gate 모두 PASS | 어떤 파일·Edge resource도 적용하지 않고 고정 code를 반환한다 |
| `ccc cloud doctor [--json]` | 설치 버전, bundle/manifest ledger, 서명, schema, credential 이름/권한, Edge/Auth/RLS/private Storage/peer health를 읽는다. | 검사별 PASS/FAIL/NOT_RUN과 복구 행동을 출력한다 | 원문 오류·비밀·기관/사용자 식별값 없이 상태만 출력한다 |
| `ccc cloud update [--channel stable\|beta]` | 승인된 origin의 최신 ReleaseBundle과 manifest를 받아 §6 순서로 coordinated update를 한다. | 모든 관련 peer가 같은 bundle/protocol을 협상하고 모든 gate PASS | 다운로드·교체 없이 이전 설치를 유지한다 |
| `ccc cloud rollback --last-known-good` | ledger에 기록된 직전 known-good bundle, 재검증된 cache, verified backup만 coordinated 복원한다. 임의 URL이나 임의 구버전은 받지 않는다. | 모든 관련 peer rollback health와 journal 완료 | 현재 설치를 유지하고 `ROLLBACK_FAILED`를 기록한다 |
| `ccc cloud report --output <path> [--json]` | redacted doctor 결과, bundle/manifest/서명/health/rollback 증거를 파일로 만든다. | §7 schema와 redaction 검사를 통과한 보고서만 쓴다 | 파일을 불완전하게 쓰지 않고 비밀 없는 실패 code를 반환한다 |

`install`과 `update`는 online-only다. 매 실행마다 하나의 `PINNED_RELEASE_ORIGIN`에서 TLS-authenticated `Date`, 최신 offline-root-signed floor와 ReleaseBundle을 새로 받아야 하며 network/origin/시간 증거가 없으면 local clock으로 대체하지 않고 fail-closed 한다. 유일한 offline 동작은 `rollback --last-known-good`이며, service ledger에 기록된 정확한 bundle/cache/backup을 §4.3의 key retirement 규칙까지 재검증한 뒤에만 실행한다. 모든 명령은 `--no-verify`, `--ignore-expiry`, `--allow-downgrade`, `--skip-backup`, `--skip-health`, `--trust-key`, `--trust-publisher`, `--offline` 옵션을 제공하지 않는다. Cloud 설치의 plan이 서울 리전, 읽기 권한, 기존 데이터, 지원 버전, 실행 전후 fingerprint를 통과하지 못하면 설치를 시작하지 않는다(ADR-0042 D84).

### 2.2 artifact family와 대상 플랫폼

정식 artifact는 다음 다섯 family이며 파일명은 `{family}-{mode}-{version}-{platform}-{arch}.{ext}` 규칙을 따른다. manifest의 `artifactUrl`은 이 파일을 가리키고 `artifactBytes`는 다운로드한 바이트 수와 정확히 같아야 한다.

| family | 산출물 | 정식 대상 | 포함·소유 범위 |
|---|---|---|---|
| `community-cloud-cli` | 실행 가능한 CLI archive/installer | macOS 14+ `arm64`, `x64`; Windows 11+ `x64`; Ubuntu 22.04+ `x64` | `install`, `doctor`, `update`, `rollback`, `report`, Supabase Edge 배포 호출. 기관 데이터·원음은 포함하지 않는다 |
| `local-single` | Electron + NSIS `Setup.exe` | Windows 11+ `x64` | 암호화 SQLite와 로컬 파일 경계. 외부 NIC listen은 0건이어야 한다 |
| `local-office-server` | Office 서버 `Setup.exe` | Windows 11+ `x64` 서버 PC | 내부망 HTTPS, 로컬 CA 우선/기관 인증서 우선, 암호화 SQLite, 서버 scheduler. 공개 포트와 평문 HTTP는 0건이다 |
| `local-office-client` | Office 클라이언트 `Setup.exe` | Windows 11+ `x64` 클라이언트 PC | 정적 client와 서버 endpoint 설정. 서버 비밀·DB·원음은 포함하지 않는다 |
| `processing-agent` | Agent `Setup.exe` | Windows 11+ `x64` | embedded Python 3.12, ffmpeg, Agent SecretStore, checksum 검증 downloader. 세 deployment mode 각각에 mode-bound manifest를 발행하며 모델은 §5의 signed model manifest 경로로만 받는다 |

Windows artifact는 `Setup.exe`와 설치 후 실행되는 모든 PE 파일을 Authenticode로 서명해야 한다. 파일명 확장자가 `.exe` 또는 `.dll`이 아니어도 PE header가 발견되면 서명 대상이다. macOS/Linux/Cloud archive는 OS 패키지 서명과 별개로 manifest와 ReleaseBundle Ed25519를 반드시 통과해야 한다. `development` artifact는 `dev` 또는 `beta` channel에서만 사용하며 정식(`formal`) release와 동일한 적용 검증을 통과해도 제출·운영 정식 artifact가 될 수 없다.

## 3. signed manifest v1과 artifact identity

### 3.1 schema와 canonical signing

manifest v1의 허용 top-level field는 아래 열두 개뿐이다. 누락·추가 field, 잘못된 type, 알 수 없는 enum은 거부한다.

```ts
type ReleaseManifestV1 = {
  version: string;          // strict SemVer, prerelease는 channel과 일치
  sequence: string;         // 1 이상인 unsigned 64-bit decimal string
  channel: 'stable' | 'beta' | 'dev';
  artifactUrl: string;      // HTTPS, pinned origin의 same-origin URL
  artifactSha256: string;   // lowercase hexadecimal 64 chars
  artifactBytes: number;    // positive safe integer
  minSchemaVersion: number; // non-negative integer
  maxSchemaVersion: number; // minSchemaVersion 이상인 integer
  publishedAt: string;      // UTC RFC3339 instant
  expiresAt: string;        // UTC RFC3339 instant, publishedAt보다 이후
  signingKeyId: string;     // release trust store의 active key id
  ed25519Signature: string; // unpadded base64url Ed25519 signature, exactly 86 chars
};
```

모든 signed closed object는 raw JSON을 duplicate-key 거부 parser로 읽고 exact schema/type을 확인한 뒤, parsed object를 clone해 그 object의 단 하나의 signature property만 제거하고, 그 remainder를 RFC 8785 JCS로 canonicalize한 UTF-8 bytes 앞에 고정 domain prefix를 붙여 sign/verify한다. 서명 property가 없거나 두 번 있거나 wrong type/길이이거나 unpadded base64url canonical encoding이 아니면 거부한다. 대상은 `ReleaseManifestV1`의 `ed25519Signature`, `ReleaseBundleV1`의 `offlineRootSignature`, `TrustStoreUpdateV1`의 `offlineRootSignature`, `EdgeComponentManifestV1`의 `ed25519Signature`, `SignedModelManifestV1`의 `ed25519Signature`다. 각 object schema와 nested object/array schema는 closed exact schema이며 알 수 없는 field·중복 key를 허용하지 않는다. `sequence`, `prevSequence`, `minimumSequence`는 `^(0|[1-9][0-9]*)$` decimal string을 `BigInt`로 검사해 `0` 이상 `2^64-1` 이하만 허용하고 JSON number로 읽지 않는다. manifest/bundle의 `sequence`는 추가로 1 이상이어야 한다. 모든 SHA-256/digest는 lowercase hexadecimal 64 chars, 모든 Ed25519 signature는 unpadded base64url 64-byte 값(정확히 86 chars), Ed25519 public key는 unpadded base64url 32-byte 값(정확히 43 chars)이다. domain prefix는 manifest `CCC-RELEASE-MANIFEST-V1\0`, bundle `CCC-RELEASE-BUNDLE-V1\0`, trust update `CCC-TRUST-STORE-UPDATE-V1\0`, Edge manifest `CCC-EDGE-COMPONENT-MANIFEST-V1\0`, model manifest `CCC-MODEL-MANIFEST-V1\0`로 고정한다. `publishedAt < expiresAt`이고 lifetime은 30일 이하여야 한다. `artifactUrl`은 명령에 내장된 `PINNED_RELEASE_ORIGIN`과 scheme/host/port가 정확히 같아야 하고 redirect는 같은 origin만 허용한다.

### 3.2 strict tuple binding

manifest에는 identity field를 추가하지 않는다. 대신 updater binary가 가진 변경 불가능한 `ExpectedArtifactTuple`과 URL basename을 모두 비교한다. mode도 URL basename에 포함해 서명된 artifact와 로컬 설치 목적을 한 번에 결속한다.

```ts
type ArtifactFamily =
  | 'community-cloud-cli' | 'local-single' | 'local-office-server'
  | 'local-office-client' | 'processing-agent';
type DeploymentMode = 'community-cloud' | 'local-single' | 'local-office';
type ReleasePlatform = 'macos' | 'windows' | 'ubuntu';
type ReleaseArch = 'arm64' | 'x64';
type ExpectedArtifactTuple = {
  family: ArtifactFamily;
  mode: DeploymentMode;
  platform: ReleasePlatform;
  arch: ReleaseArch;
};
```

parser는 URL을 한 번 percent-decode한 path의 마지막 segment만 허용하고, `.`·`..`·두 번째 decode·query/fragment·대소문자 변형을 거부한다. 알려진 family와 그 family에 허용된 mode를 먼저 제거한 뒤 남은 version/platform/arch를 strict SemVer와 허용 토큰으로 파싱하며, 정규식은 다음 grammar와 동치여야 한다: `{family}-{mode}-{strictSemVer}-{platform}-{arch}.{ext}`. 허용 family/mode 쌍은 Cloud CLI→community-cloud, Single→local-single, Office server/client→local-office, Agent→community-cloud 또는 local-single 또는 local-office다. 허용 suffix는 `macos-{arm64|x64}.tar.gz`, `ubuntu-x64.tar.gz`, `windows-x64.exe`이며, Agent는 세 mode 각각에 대해 설치 context와 동일한 basename을 요구한다. parser 결과의 네 tuple 값이 `ExpectedArtifactTuple`과 하나라도 다르면 `ARTIFACT_IDENTITY_MISMATCH`이고 다운로드·압축 해제·적용은 0건이다. tuple은 사용자 입력과 manifest 값으로 덮어쓸 수 없다.

### 3.3 적용 전 manifest gate

candidate는 ReleaseBundle의 해당 entry로 지목되어야 하며, bundle 서명 확인 전에는 manifest를 적용 대상으로 만들지 않는다. manifest는 다음 순서로 검증한다.

1. JSON shape, exact tuple, HTTPS origin, `publishedAt <= monotonicTrustedTime < expiresAt`, `minSchemaVersion <= currentSchema <= maxSchemaVersion`을 검증한다. 미래 발행, 만료, local clock으로 판단할 수 없는 시간은 실패다.
2. embedded release trust store에서 `signingKeyId`를 찾고 Ed25519 서명을 검증한다. unknown, `revoked`, validity window 밖 key는 거부한다. `retired` key는 새 install/update에서 거부하며, §4.3의 사전 ledgered historical cached rollback 예외만 허용한다.
3. artifact를 service-owned staging에만 다운로드하고 bytes와 SHA-256을 다시 계산한다. `artifactBytes` 또는 `artifactSha256` 불일치는 `HASH_MISMATCH`다.
4. §5의 재귀 추출·PE 탐색·Authenticode 검사와 model manifest 검사를 끝낸다.
5. local cross-channel ledger와 signed sequence floor를 검증한다. floor보다 낮은 sequence, 같은 version에서 낮은 sequence, 현재 설치보다 낮은 version, 또는 channel 전환으로 version/sequence가 낮아지는 후보는 `DOWNGRADE_BLOCKED`다. 같은 tuple·version·sequence·hash는 재적용하지 않는 멱등 no-op다.

## 4. ReleaseBundle, trust store와 시간

### 4.1 offline-root-signed ReleaseBundleV1

모든 formal 설치·업데이트는 다음 bundle을 함께 받는다. Bundle signature는 release key가 아니라 별도로 고정된 offline root가 서명하며, 다섯 family row와 각 대상 artifact의 manifest/hash/bytes를 빠짐없이 index한다.

```ts
type ReleaseBundleV1 = {
  schemaVersion: 1;
  bundleId: string;
  version: string;
  sequence: string;
  channel: 'stable' | 'beta' | 'dev';
  publishedAt: string;
  expiresAt: string;
  protocol: {
    apiName: 'ccc-http-api';
    apiVersion: string;
    contractsSha256: string;
    peers: Array<{
      name: 'cloud-cli' | 'edge' | 'office-server' | 'office-client' | 'agent';
      protocolVersion: string;
      contractsSha256: string;
    }>;
  };
  entries: Array<{
    family: ArtifactFamily;
    artifacts: Array<{
      manifestUrl: string;
      manifestSha256: string;
      edgeComponentManifestSha256: string | null;
      mode: DeploymentMode;
      platform: ReleasePlatform;
      arch: ReleaseArch;
      artifactSha256: string;
      artifactBytes: number;
      minSchemaVersion: number;
      maxSchemaVersion: number;
    }>;
  }>; // 서로 다른 다섯 family를 각각 정확히 한 row로 둔다
  sequenceFloor: Array<{
    family: ArtifactFamily;
    mode: DeploymentMode;
    platform: ReleasePlatform;
    arch: ReleaseArch;
    minimumSequence: string;
  }>;
  modelManifestSha256: string;
  offlineRootSignature: string;
};
```

Bundle signature input은 ASCII domain prefix `CCC-RELEASE-BUNDLE-V1\0`와 RFC 8785 JCS UTF-8 bytes의 연결이며, `offlineRootSignature`는 unpadded base64url 64-byte 값이다. `entries`에는 정확히 다섯 distinct family row, 각 row에는 대상 tuple별 중복 없는 `manifestUrl`/manifest hash/artifact hash/bytes record이 있어야 한다. `community-cloud-cli` row의 `edgeComponentManifestSha256`는 non-null이며 정확한 embedded `EdgeComponentManifestV1` file bytes 전체의 lowercase SHA-256과 정확히 같아야 하고, 나머지 family row는 null이어야 한다. embedded manifest 내부의 `edgeArtifactSha256`는 component-record aggregate이며 S11 install/apply receipt가 노출하는 유일한 Edge aggregate 값과 비교하는 규칙은 §5.1에만 있다. `sequenceFloor`에는 모든 record의 tuple이 있어야 한다. `protocol.peers`에는 설치 대상 relevant peer마다 정확히 하나의 record가 있어야 하며 누락·중복·알 수 없는 peer name은 거부한다. `version`, `sequence`, `channel`, lifetime과 entry manifest URL/hash/bytes는 각 manifest와 일치해야 한다. Bundle lifetime도 30일 이하이고 `publishedAt <= monotonicTrustedTime < expiresAt`를 만족해야 한다.

`protocol`은 허용 범위(range)가 아니다. 설치된 모든 관련 peer와 후보가 `apiName`, `apiVersion`, `contractsSha256`, peer name별 `protocolVersion`·`contractsSha256`를 정확히 일치시켜야 한다. 적용 전 각 peer가 `{ bundleId, sequence, apiVersion, contractsSha256 }`를 handshake하고, 하나라도 mismatch/미응답이면 `PEER_PROTOCOL_MISMATCH`로 중단한다. Cloud와 Office의 coordinated rollback도 같은 handshake를 통과해야 하며, 부분 bundle·mixed protocol을 서비스 상태로 남기지 않는다.

### 4.2 cross-channel monotonic ledger와 trusted time

local ledger key는 channel을 제외한 `(family, mode, platform, arch)` tuple이다. ledger는 tuple별 `highestSeenVersion`, `highestSeenSequence`, `highestSeenChannel`, `highestSeenHash`, `knownGoodBundleId`, `knownGoodArtifactHash`, `lastTrustedTime`을 service-owned 보호 저장소에 원자적으로 기록한다. 서명·hash·bundle·floor 검증을 통과한 candidate의 version/sequence는 적용 실패와 관계없이 최고값만 기록해 replay를 막는다. candidate는 이 cross-channel 최고값과 현재 설치 모두와 비교해야 한다. **Stable 설치 또는 stable ledger에서는 beta/dev로 전환하지 않는다.** beta/dev 설치에서 stable로 전환할 때만 stable candidate의 version이 현재보다 높거나 같고 sequence가 cross-channel 최고값보다 높아야 한다. 모든 channel transition은 bundle protocol/health를 통과해야 하며 version/sequence를 낮출 수 없다.

`sequenceFloor`는 offline-root 서명으로만 신뢰한다. clean machine은 하나의 `PINNED_RELEASE_ORIGIN`에 고정된 `/.well-known/ccc/release-bundle.json` endpoint에서 현재 bundle의 latest floor와 TLS-authenticated HTTP `Date`를 함께 받아 검증한 뒤 floor를 초기 ledger로 설치한다. 기존 machine의 online install/update도 매 실행마다 이 endpoint와 TLS `Date`를 다시 받아야 한다. TLS chain/hostname이 pinned origin과 일치하고, 응답 `Date`가 signed `publishedAt <= Date < expiresAt` 안에 있어야 한다. bundled installer에 offline-root가 승인한 nondecreasing factory floor가 내장되어야 하며, 원격 floor가 factory floor보다 낮으면 거부하고 factory floor도 기존 floor보다 낮아지지 않는다. 기존 machine은 `max(existingFloor, signedFloor)`만 저장한다. floor보다 낮은 candidate는 current 설치가 비어 있어도 거부한다. bundle/manifest의 `publishedAt`와 `expiresAt`로 만든 trusted time은 `lastTrustedTime = max(lastTrustedTime, publishedAt, 성공한 trusted server Date)`로만 전진한다. 기존 machine의 offline update/install은 금지한다. 유일한 offline rollback은 persisted `lastTrustedTime`과 persisted floor만 사용하며 현재 local clock을 trusted source로 쓰지 않고 trusted time을 전진시키지 않는다. clean machine에서 pinned origin, TLS server `Date`, 서명된 floor 중 하나라도 없거나 검증할 수 없으면 candidate의 local clock을 믿지 않고 `TRUSTED_TIME_UNAVAILABLE`로 fail-closed 한다. local clock이 `lastTrustedTime`보다 과거로 움직이면 `TRUSTED_TIME_ROLLBACK`으로 모든 install/update/rollback을 중단하며 우회 옵션은 없다. bundle/manifest lifetime은 30일 이하로 bounded 된다.

### 4.3 TrustStoreUpdateV1과 publisher pinning

trust store와 publisher record의 변경은 아래 offline-root-signed update만 허용한다. release key, 관리자, 환경변수, 명령행으로 trust store를 직접 수정할 수 없다.

```ts
type TrustOperation =
  | { op: 'add-release-key'; keyId: string; publicKey: string; notBefore: string; notAfter: string }
  | { op: 'activate-release-key'; keyId: string }
  | { op: 'retire-release-key'; keyId: string; retiredAt: string; reason: string }
  | { op: 'revoke-release-key'; keyId: string; revokedAt: string; reason: string }
  | { op: 'add-publisher'; publisherId: string; organization: string; thumbprint: string; notBefore: string; notAfter: string }
  | { op: 'revoke-publisher'; publisherId: string; revokedAt: string; reason: string };
type TrustStoreUpdateV1 = {
  schemaVersion: 1;
  updateId: string;
  sequence: string;
  prevSequence: string;
  issuedAt: string;
  expiresAt: string;
  prevDigest: string;
  resultDigest: string;
  operations: TrustOperation[];
  offlineRootSignature: string; // unpadded base64url, exactly 86 chars
};
```
`sequence`는 이전 trust update 최고값보다 엄격히 커야 하고 `prevSequence`는 trust-update ledger의 현재 최고 sequence와 정확히 같아야 한다. `operations`는 하나 이상의 operation을 가져야 한다. `prevDigest`와 `resultDigest`는 각각 current/result canonical trust store의 lowercase hexadecimal SHA-256 64 chars와 정확히 일치해야 한다. ledger에는 적용된 `updateId`, `sequence`, `resultDigest`를 원자적으로 기록한다. TrustStoreUpdate signature input은 ASCII domain prefix `CCC-TRUST-STORE-UPDATE-V1\0`와 RFC 8785 JCS UTF-8 bytes의 연결이며, `issuedAt <= monotonicTrustedTime < expiresAt`, lifetime 30일 이하를 만족해야 한다. root 서명 없는 mutation, digest 불일치, revoked/retired key 재활성화, sequence 감소는 0건 적용이다.
release key record는 `{ keyId, publicKey(unpadded base64url 32-byte, 43 chars), status(next|active|retired|revoked), notBefore, notAfter, retiredAt?, revokedAt?, revocationReason? }`다. release key의 add, activate, retire, revoke는 모두 offline root가 서명한 TrustStoreUpdateV1 operation으로만 수행하며, ReleaseBundle에는 key mutation이 없다. retired key는 새 manifest를 서명할 수 없다. 단, retirement 전에 ledger에 기록된 정확한 hash/sequence의 역사적 cached rollback artifact는 해당 manifest/bundle의 signature timestamp인 `publishedAt`가 `retiredAt` 및 key `notAfter` 이전이고, §5의 hash/sign/file-ID를 재검증한 경우에만 retired key로 검증할 수 있다. revoked key는 manifest, artifact, cached rollback을 포함해 어떤 것도 검증할 수 없다. Windows PE의 Authenticode leaf는 trust store의 `publisherId='ccc-open-pilot'` active record와 organization·thumbprint가 일치하고, trusted chain·timestamp·revocation 검사를 통과해야 한다. CCC publisher identity의 rotation/revocation도 TrustStoreUpdateV1로만 한다.


staging과 cache는 updater service가 만든 protected directory만 사용한다(Windows `C:\ProgramData\CCC\update\{staging,cache}`, Unix `$XDG_STATE_HOME/ccc/update/{staging,cache}`). 디렉터리와 파일은 service identity 소유, 사용자 쓰기 권한 0, ACL/mode는 service만 read/write/execute 가능해야 한다. 모든 path component에서 symlink, Windows reparse point, hardlink, `..`, absolute path, device name, archive link entry를 거부한다. cache path는 사용자 입력을 받지 않는다.

archive는 protected staging에 재귀적으로만 추출하고 어떤 파일도 추출 중 실행하지 않는다. 각 entry는 regular file/directory인지와 root containment를 검사한다. 추출 후 확장자가 아니라 DOS `MZ`, `e_lfanew`, `PE\0\0` header를 파싱해 모든 PE를 발견한다. 발견된 모든 PE와 installer는 Authenticode 서명·timestamp·trusted chain·revocation·CCC publisher pin을 각각 검증한다. 하나라도 unsigned, test/self-signed, publisher mismatch, revoked, chain 불명확이면 `AUTHENTICODE_INVALID`이고 실행·promotion은 0건이다.

hash와 signature 검사는 같은 read-only open handle에서 수행한다. reader는 handle로 SHA-256/size를 계산하고 file ID·device(Windows file index/volume 포함)·link count를 기록한 뒤, 같은 handle에 대해 서명 검증을 끝내고 `fsync`한다. promotion 직전 같은 handle의 file ID, size, mtime/immutable marker를 다시 확인하며 변경·교체·link count 증가가 있으면 폐기한다. path를 다시 열어 hash와 서명을 분리 검증하는 구현은 금지한다. atomic rename 뒤 destination file ID를 다시 확인한다. cached rollback도 매번 manifest/bundle signature, hash/size, PE 서명을 같은-handle 규칙으로 재검증한다.
### 5.1 Community Cloud EdgeComponentManifestV1

`community-cloud-cli` artifact에는 Edge 배포물을 밖에서 다시 받지 않도록 아래 closed manifest와 모든 component bytes가 함께 들어 있어야 한다.

```ts
type EdgeComponentManifestV1 = {
  schemaVersion: 1;
  protocolVersion: string;
  components: Array<{
    kind: 'function' | 'template' | 'migration';
    path: string;
    artifactBytes: number;
    artifactSha256: string;
  }>;
  edgeArtifactSha256: string;
  signingKeyId: string;
  ed25519Signature: string; // unpadded base64url, exactly 86 chars
};
```

manifest와 nested component record는 exact schema이며 `components`는 path UTF-8 lexicographic order, 중복 0건, `.`·`..`·absolute path·symlink/link entry 0건이어야 한다. `kind`별 function/template/migration path를 빠짐없이 열거하고 `edgeArtifactSha256`는 정렬된 component record 배열의 RFC 8785 JCS UTF-8 bytes SHA-256이다. signature input은 ASCII domain prefix `CCC-EDGE-COMPONENT-MANIFEST-V1\0`와 그 JCS bytes의 연결이다. manifest 자체의 lowercase SHA-256은 ReleaseBundle `community-cloud-cli` row의 non-null `edgeComponentManifestSha256`와 정확히 같아야 한다.

CLI는 먼저 §3~§5의 bundle/manifest/tuple/hash 검증을 끝낸 뒤 signed CLI artifact를 protected staging에 재귀 추출하고, staging에서 발견한 Edge component bytes만 Supabase apply에 전달한다. staged manifest의 `path`, `kind`, bytes, hash와 aggregate `edgeArtifactSha256`, `schemaVersion`, `protocolVersion`을 모두 로컬 embedded manifest와 staged file bytes로 검증한 뒤, aggregate `edgeArtifactSha256` 하나만 SG11 install/apply receipt의 값과 비교한다. missing/extra/altered component, aggregate mismatch, receipt aggregate mismatch이면 `EDGE_COMPONENT_SET_MISMATCH`로 health/ledger commit 전에 중단한다. CLI는 component를 별도 network URL, 현재 checkout, 작업 디렉터리에서 읽거나 보충하지 않는다. 네트워크는 검증을 마친 staged bytes를 기관 Supabase에 적용하는 API 호출에만 사용한다.


### 5.2 Signed model manifest

E10-2가 소유하는 model manifest는 다음 signed shape을 사용한다.

```ts
type SignedModelManifestV1 = {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  artifactSha256: string;
  origin: string;              // pinned HTTPS origin
  licenseExpression: string;
  artifactBytes: number;
  runtimeCompatibility: {
    platform: 'windows';
    arch: 'x64';
    python: '3.12';
    agentVersion: string;
    runtime: string;
  };
  signingKeyId: string;
  ed25519Signature: string; // unpadded base64url Ed25519 signature, exactly 86 chars
};
```

model downloader는 exact `modelId`와 `revision`, origin allowlist, hash/bytes, license expression, runtime compatibility를 검증하고 bundle의 `modelManifestSha256`와 일치할 때만 받는다. SignedModelManifest signature input은 ASCII domain prefix `CCC-MODEL-MANIFEST-V1\0`와 RFC 8785 JCS UTF-8 bytes의 연결이며 signature/key/hash/bytes 검증이 먼저다. mismatch, unknown/revoked key, incompatible runtime, unapproved license 또는 checksum 오류는 모델 설치·실행을 0건으로 만든다. model manifest는 agent release owner(E10-2)가 관리하며 앱 release owner가 대신 승인하지 않는다.

## 6. coordinated update, maintenance barrier와 rollback

모든 mode는 아래 application-service 계약과 순서를 지킨다.

```ts
type MaintenanceScope = 'community-cloud' | 'local-single' | 'local-office';
type MaintenanceLease = { token: string; scope: MaintenanceScope; bundleId: string; acquiredAt: string };
interface MaintenanceBarrier {
  acquire(scope: MaintenanceScope, bundleId: string): Promise<MaintenanceLease>;
  drain(lease: MaintenanceLease, timeoutMs: 120000): Promise<{ drained: boolean; inFlight: number }>;
  release(lease: MaintenanceLease): Promise<void>;
}
```

`token`은 service 내부 값이며 report/stdout에 출력하지 않는다. `drain`이 `drained=false`를 반환하거나 barrier ownership이 사라지면 `MAINTENANCE_DRAIN_TIMEOUT`으로 중단하고 신규 write 거부를 해제한 뒤 backup/교체를 시작하지 않는다. Cloud barrier는 기관별 distributed lock, Office barrier는 서버 queue와 두 client acknowledgement, Single barrier는 local service lock으로 구현한다. Cloud와 Office는 peer 전부가 lease를 확인해야 한다.

모든 mode는 다음 순서를 지킨다.
1. service가 `maintenance` lock을 획득하고 신규 write를 `MAINTENANCE` 고정 code로 거부한다. 이미 시작된 write는 drain timeout 안에 commit까지 기다린다. timeout이면 barrier를 풀고 backup·교체를 시작하지 않는다. 요청을 조용히 버리거나 partially commit하지 않는다.
2. 관련 Cloud/Office peer와 bundle/protocol handshake를 하고, 모든 peer가 barrier를 수락할 때까지 대기한다. Cloud는 기관 Supabase에서 distributed lock과 worker drain acknowledgement를, Office는 서버 write queue와 두 client의 acknowledgement를 사용한다. Single도 local service lock을 사용한다.
3. SG10 `.cccx` service로 DB·파일·설정의 complete backup을 만들고 hash, schema, bundle identity를 기록한 뒤 restore-read 검증을 끝낸다. barrier는 backup 시작부터 health 또는 rollback 종료까지 유지한다.
4. 각 relevant artifact를 protected staging에서 §3~§5 순서로 검증하고 update journal에 `prepared`를 기록한 후, bundle 단위로 atomic promotion한다. 한 entry라도 실패하면 promotion 0건이다.
5. candidate와 모든 peer가 health negotiation을 한다. version, schema, bundle ID, protocol, DB read, SecretStore key-name availability(값 출력 0건), mode endpoint, scheduler와 Agent status가 모두 PASS여야 한다. Cloud는 authenticated `GET /capabilities`, Edge/Auth/RLS/private Storage를 포함하고 Office는 TLS endpoint와 두 client를 포함한다.
6. 성공한 bundle만 `known-good`와 ledger에 기록하고 journal을 완료한 뒤 barrier를 해제한다. barrier 해제 뒤 새 write를 받는다.

health는 최대 120초, 2초 간격으로 확인한다. health 실패·peer mismatch·journal 오류가 나면 barrier를 유지한 채 pre-update journal, 정확히 검증된 known-good cache와 SG10 backup을 coordinated restore하고 모든 peer rollback health를 다시 협상한다. rollback까지 PASS하면 이전 bundle만 known-good로 남긴다. rollback health도 실패하면 `ROLLBACK_FAILED`를 기록하고 Cloud/Office를 fail-closed recovery mode로 두며 write를 재개하지 않는다. 외부 manifest에서 구버전을 다시 받아 적용하는 경로는 없고, rollback은 이전에 검증된 bundle/cache/backup의 내부 recovery다.

## 7. 정식 release 증거, 진단과 redaction

### 7.1 formal release gate와 owner

release profile은 `formal` 또는 `development`다. `formal`은 `channel=stable`이고 다섯 artifact family를 포함한 release bundle이며, 모든 증거가 같은 version/sequence/bundle/artifact hash를 가리켜야 PASS다. Windows family를 bundle에서 빼거나 unsigned artifact로 대체한 formal release는 만들거나 제출할 수 없다.
| owner | 소유 계약·증거 |
|---|---|
| E6-5a | Community Cloud `install`, `doctor`, `update`, `rollback`, redacted `report` 명령과 서명/rollback 검증 |
| E5-7 | Windows Agent installer, embedded Python/ffmpeg, checksum model downloader |
| E7-4 | Local Single Electron/NSIS x64 installer, Agent 후설치, AI Off doctor, clean Windows install/uninstall |
| E7-6a | Ed25519 manifest, 단조 version, update 전 backup, apply와 health-failure rollback core |
| E7-6b | 실제 Authenticode Single/Office package 적용 및 unsigned/downgrade 거부 |
| E8-3 | Local Office client installer, CurrentUser CA trust, server URL/shortcut, client 2대 |
| E8-9 | Local Office server installer, service account/profile, firewall, TLS, health, uninstall |
| E6-7 | Community Cloud backup/restore, complete `.cccx` backup and clean-project restore |
| E9-1 | mode/AI axis manifest selection and clean-machine setup orchestration |
| E10-1 | CI matrix and truthful release result reporting across modes/platforms |
| E10-2 | SBOM, NOTICE, license allowlist/conditional evidence, secret/manifest scan, Agent Python SBOM과 signed model manifest evidence |
| E10-3 | OV/EV 또는 Artifact Signing으로 Single/Office server/client/Agent installer 서명 |
| E10-4 | install/update/rollback/restore 매뉴얼과 Policy Kit를 실제 명령·계약에 맞춤 |
| E10-5 | 세 모드 update 후 health-failure rollback 및 데이터/금고 복원 훈련 |
| E10-6 | 다섯 family formal bundle과 제출 패키지, SBOM/매뉴얼/보고서/합성 시연 조립 |

formal bundle에는 다음이 모두 있어야 한다.

1. 모든 Windows PE와 installer의 Authenticode 결과(인증서 주체, CCC publisher ID/organization/thumbprint, timestamp, chain/revocation). 개인키와 token은 증거에 넣지 않는다.
2. 각 artifact의 CycloneDX 1.6 JSON SBOM, direct/transitive dependency, version, supplier, license expression, component hash와 dependency graph, artifact 내부와 evidence bundle 양쪽의 NOTICE.
3. Python SBOM은 `processing-agent` release owner가 소유한다. embedded CPython, 표준 라이브러리 배포물, Python package lock, wheel, native extension, ffmpeg 호출/배포 component까지 포함해 Agent artifact hash에 묶는다.
4. 모든 formal bundle에 conditional-license assessment가 있어야 한다. LGPL/GPL 또는 기타 조건부 의무가 있으면 `licenses/conditional-evidence.json`에 component/version/hash, license, configure/build flags, corresponding source archive/commit, source offer/배포 위치, NOTICE를 기록한다. 조건부 license가 없다는 판정도 SBOM expression, 검토자, 검토 시각으로 기록한다. assessment 또는 obligation evidence 누락은 formal FAIL이다.
5. clean-machine restore drill 증거: synthetic fixture ID, source version/schema, backup `.cccx` hash, 새 PC destination version/schema, row/file hash 비교와 PASS 시각. backup 생성만으로는 PASS가 아니다.
6. ReleaseBundle, manifest, floor, embedded `EdgeComponentManifestV1`, local component detail verification, S11 aggregate receipt comparison, model manifest, protocol negotiation, anti-downgrade, maintenance drain, backup/restore, update health와 forced-health-failure rollback의 각 PASS/FAIL.

### 7.2 doctor/report redaction

`doctor`와 `report`는 수집 단계부터 redaction한다. 원문 로그를 수집한 뒤 나중에 문자열 치환하는 방식은 허용하지 않는다. 고정 진단 code는 `MANIFEST_EXPIRED`, `TRUSTED_TIME_UNAVAILABLE`, `TRUSTED_TIME_ROLLBACK`, `SIGNING_KEY_UNKNOWN`, `SIGNING_KEY_REVOKED`, `SIGNATURE_INVALID`, `BUNDLE_SIGNATURE_INVALID`, `BUNDLE_ENTRY_INVALID`, `EDGE_COMPONENT_SET_MISMATCH`, `AUTHENTICODE_INVALID`, `ARTIFACT_IDENTITY_MISMATCH`, `ARTIFACT_NOT_INDEXED`, `HASH_MISMATCH`, `SCHEMA_INCOMPATIBLE`, `DOWNGRADE_BLOCKED`, `PEER_PROTOCOL_MISMATCH`, `MAINTENANCE_DRAIN_TIMEOUT`, `BACKUP_FAILED`, `HEALTH_FAILED`, `ROLLBACK_FAILED`, `TRUST_UPDATE_INVALID`, `MODEL_MANIFEST_INVALID`, `SBOM_MISSING`, `LICENSE_EVIDENCE_MISSING`, `RESTORE_DRILL_MISSING`, `CREDENTIAL_MISSING`, `CREDENTIAL_INVALID`, `CREDENTIAL_INSUFFICIENT`다.

```ts
type RedactedReportV1 = {
  schemaVersion: 1;
  generatedAt: string;
  mode: DeploymentMode;
  family: string;
  installedVersion: string;
  installedSequence: string;
  channel: 'stable' | 'beta' | 'dev';
  checks: Array<{ name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN'; code: string | null }>;
  artifacts: Array<{ version: string; sequence: string; sha256: string; signingKeyId: string; authenticode: 'valid' | 'invalid' | 'not_applicable' }>;
  redaction: { algorithm: 'hmac-sha256'; scope: 'report-local'; secrets: 'omitted'; urls: 'omitted' };
};
```

secret 값, private key, DPAPI plaintext, Bearer/JWT/refresh token, DB connection string, service-role key, webhook, signed URL, audio key, 원문 오류, command argument, file content, user/participant/worker/기관명, email, phone, address, 상담 text/audio는 stdout/stderr·JSON·report에 절대 넣지 않는다. URL은 전체 `<redacted-url>`로 바꾸고, 진단에 필요한 내부 ID는 report마다 새 nonce를 만들고 `HMAC-SHA-256(nonce, value)` 앞 12 hex만 사용한다. nonce와 원문은 저장하지 않는다. secret name, version, sequence, artifact hash, signing key ID, status/code는 비밀이 아니므로 허용한다.

## 8. fixture와 검증 방법

`확정` 판정용 fixture는 synthetic 데이터와 가짜 key/certificate만 사용하며 실데이터를 사용하지 않는다.

| fixture | 입력 | 기대 판정 |
|---|---|---|
| `manifest-valid` | active key, 유효 lifetime, 같은 origin, strict tuple, 범위 내 schema, 정확한 bytes/hash | bundle/family/protocol gate PASS 후 backup·health 단계로 진행 |
| `manifest-expired` | `monotonicTrustedTime >= expiresAt` | `MANIFEST_EXPIRED`, 적용 0건 |
| `manifest-unknown-key` / `manifest-revoked-key` | trust store에 없는 key / revoked key signature | 각각 `SIGNING_KEY_UNKNOWN`/`SIGNING_KEY_REVOKED`, 적용 0건 |
| `artifact-identity-mismatch` | expected family/mode/platform/arch tuple과 다른 basename | `ARTIFACT_IDENTITY_MISMATCH`, 다운로드·추출·적용 0건 |
| `artifact-corrupt` | manifest hash/bytes와 다른 staging bytes | `HASH_MISMATCH`, 교체·실행 0건 |
| `artifact-unsigned-pe` | 확장자는 `.dat`이나 PE header인 unsigned file | `AUTHENTICODE_INVALID`, 실행·promotion 0건 |
| `artifact-path-links` | symlink/reparse/hardlink/`..` archive entry | protected extraction 거부, 적용 0건 |
| `artifact-downgrade-cross-channel` | 다른 channel의 낮은 version/sequence 또는 signed floor 미만 | `DOWNGRADE_BLOCKED`, backup·교체 0건 |
| `stable-channel-switch` | stable 설치가 높은 version/sequence의 beta/dev를 요청 | `DOWNGRADE_BLOCKED`, channel 전환·교체 0건 |
| `artifact-schema-incompatible` | current schema가 min/max 밖 | `SCHEMA_INCOMPATIBLE`, 적용 0건 |
| `bundle-missing-family` | 다섯 family가 아닌 bundle | `BUNDLE_ENTRY_INVALID`, coordinated apply 0건 |
| `bundle-peer-mismatch` | API protocol hash 또는 peer record 불일치 | `PEER_PROTOCOL_MISMATCH`, coordinated apply 0건 |
| `bundle-invalid-signature` / `bundle-entry-invalid` | offline root signature 또는 manifest URL/hash/bytes/index 오류 | 각각 `BUNDLE_SIGNATURE_INVALID`/`BUNDLE_ENTRY_INVALID`, coordinated apply 0건 |
| `edge-component-set-mismatch` | signed `EdgeComponentManifestV1`의 altered/missing/extra component, 로컬 path/kind/bytes/hash/schema/protocol 불일치 또는 S11 aggregate `edgeArtifactSha256` 불일치 | `EDGE_COMPONENT_SET_MISMATCH`, Edge deploy·health·ledger commit 0건 |
| `publisher-mismatch` | Authenticode chain은 유효하지만 CCC publisher identity가 다름/폐기됨 | `AUTHENTICODE_INVALID`, 실행·promotion 0건 |
| `trust-update-invalid` | root signature, prevDigest, resultDigest, prevSequence 또는 sequence 오류 | `TRUST_UPDATE_INVALID`, trust store mutation 0건 |
| `key-rotation-overlap` | root-authorized update로 next key를 추가한 뒤 active를 유지하고, retired key historical rollback과 revoked key rollback을 각각 검증 | historical hash/sequence가 retirement 전에 ledgered 된 retired key는 PASS, revoked key는 적용 0건 |
| `clock-rollback` | persisted `lastTrustedTime`보다 과거인 local clock | `TRUSTED_TIME_ROLLBACK`, install/update/rollback 0건 |
| `floor-or-time-unavailable` | clean machine에서 pinned origin, TLS server `Date`, signed floor 중 하나 없음/검증 실패 | `TRUSTED_TIME_UNAVAILABLE`, candidate 적용 0건 |
| `model-manifest-incompatible` | E10-2 ID/revision/hash/origin/license/size/runtime 중 하나 불일치 | model 설치·실행 0건 |
| `maintenance-drain-timeout` | inflight write가 drain deadline 안에 commit하지 않음 | `MAINTENANCE_DRAIN_TIMEOUT`, backup·교체·write loss 0건 |
| `health-rollback` | 서명·hash·backup·drain은 PASS, 새 health만 의도적으로 FAIL | coordinated known-good 복원, rollback health PASS, journal에 증거 |
| `evidence-incomplete` | Windows signature, Python SBOM, conditional assessment, restore drill 중 하나 누락 | formal release FAIL |
| `clean-machine` | 새 Windows 11 x64 PC 각각에 bundled installer의 nondecreasing factory floor를 확인하고, `PINNED_RELEASE_ORIGIN`에서 TLS-authenticated `Date`와 offline-root-signed latest floor를 받아 Single, Office server/client, Agent를 설치한 뒤 synthetic backup/restore·update를 수행 | 원격 floor가 factory floor 이상, server `Date`가 signed lifetime 안, 서명/tuple/protocol PASS, 설치 직후 `sttMode=off`, STT 승인 전 `sttEngine=null`, health PASS, 외부 NIC listen/public port/plain HTTP 0건 |
| `cloud-clean-machine` | 새 macOS/Windows/Linux 환경에서 `PINNED_RELEASE_ORIGIN`의 TLS `Date`와 offline-root-signed latest floor를 검증한 뒤 Cloud CLI install/doctor/update/rollback을 수행하고 기관 소유 Supabase synthetic project의 D84 plan fingerprint를 비교 | floor/time proof가 모두 PASS, secret 없는 출력, 서울/private Storage/Auth/RLS health PASS, update/rollback PASS, fingerprint drift·credential leak 0건 |

구현 검증 때 저장소 루트에서 아래 명령을 실행한다.

```bash
pnpm test:contracts --release
pnpm verify:release-manifest
pnpm verify:release-bundle
pnpm verify:release-signatures
pnpm verify:release-sbom
pnpm verify:release-licenses
pnpm test:release-clean-machine
pnpm test:release-rollback
pnpm test:release-redaction
```

## 9. 완료 조건

- [ ] 다섯 artifact family와 모든 대상 platform/arch, Cloud 명령, mode mapping과 strict URL tuple parser가 문서에 완결되어 있다.
- [ ] ReleaseManifestV1의 정확한 12 field, canonical bytes, key/time/hash/schema gate가 문서에 완결되어 있다.
- [ ] offline-root-signed ReleaseBundleV1이 다섯 family의 manifest/hash/bytes, sequence floor, exact API/protocol peer compatibility를 index한다.
- [ ] cross-channel monotonic ledger, signed floor, monotonic trusted-time, trust-store rotation/revocation과 CCC publisher pinning이 문서에 완결되어 있다.
- [ ] protected ACL staging/cache, recursive no-execute extraction, extension-independent PE discovery, same-handle hash/sign/file-ID promotion 검사가 문서에 완결되어 있다.
- [ ] maintenance write barrier/drain, SG10 backup-before-update, coordinated apply/health/rollback과 write-loss 금지 규칙이 문서에 완결되어 있다.
- [ ] E10-2 signed model manifest의 ID/revision/hash/origin/license/size/runtime compatibility가 문서에 완결되어 있다.
- [ ] fixture 입력·기대 판정, 정식 owner 표, verification commands와 formal gate가 문서에 완결되어 있다.
- [ ] unsigned, expired, unknown-key, downgraded, wrong-hash, incompatible-schema artifact가 한 번이라도 적용되는 구현은 실패다. formal은 Windows signature, SBOM/NOTICE, conditional-license assessment, Python SBOM, restore drill 중 하나라도 없으면 실패다.
- [ ] 모든 signed object가 duplicate-key 거부, RFC 8785 JCS UTF-8, closed exact schema, fixed signature domain, lowercase hash와 fixed unpadded base64url 길이를 사용한다.
- [ ] Stable→beta/dev 전환이 높은 version/sequence에서도 거부되고, clean-machine의 pinned origin/TLS `Date`/signed floor와 installer factory floor 규칙 및 offline persisted trusted time이 문서에 완결되어 있다.
- [ ] offline install/update가 항상 `TRUSTED_TIME_UNAVAILABLE`로 fail-closed되고, offline rollback은 local ledger-bound exact known-good만 허용한다.
- [ ] retired key는 retirement 전에 ledgered historical cache rollback만 검증할 수 있고 revoked key는 rollback을 포함해 어떤 검증도 할 수 없다.
- [ ] `community-cloud-cli`의 closed `EdgeComponentManifestV1`, aggregate hash와 ReleaseBundle/S11 aggregate receipt 비교, staged-bytes-only deploy 및 altered/missing/extra component 차단이 문서에 완결되어 있다.

## 10. 모드 차이와 이번에 안 하는 것

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 설치 표면 | `ccc cloud` 명령, D84 read-only plan 선행 | Electron NSIS | 서버 `Setup.exe` + 클라이언트 `Setup.exe` |
| 업데이트 대상 | CLI와 기관 소유 Supabase Edge template/resource | 한 PC의 앱·암호화 DB/파일 | 서버 앱·DB와 별도 client artifact |
| maintenance/health | 기관 distributed barrier, authenticated API/capabilities, Edge/Auth/RLS/private Storage, Agent peer | local service barrier, DB, SecretStore, scheduler | 서버 barrier/drain, TLS endpoint, DB, SecretStore, scheduler, 2 client peer |
| rollback | coordinated bundle + SG10 backup | 로컬 known-good bundle/cache + SG10 backup | 서버/client coordinated bundle + SG10 backup |

S8의 원음 시계·삭제 증거, S9의 DPAPI/Recovery Kit, S10의 암호화 envelope·journal, S11의 Supabase Edge/Auth/RLS/Storage template은 이 문서에서 재정의하지 않고 해당 계약을 참조한다. 모델 품질·STT 게이트(STT-G1~G3), AI Packet 내용(S6/S15), 법무 동의 문구(S7/S14), 실제 installer 구현과 인증서 발급은 각 owner 티켓의 범위다. 다만 이 항목들의 증거가 formal release gate에 걸릴 때 누락을 숨기거나 개발 artifact로 정식 표기하지 않는다.
