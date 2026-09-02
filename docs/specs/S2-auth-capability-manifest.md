# S2: 인증과 CapabilityManifest

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D77, D80, D82, D83; ADR-0042 D84
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `CCC_OPEN_PILOT_PLAN.md`
- 산출: 세 배포 모드의 `Bearer → Actor` 계약, 서명된 설치 신뢰 경계, 인증된 `GET /capabilities`의 정본 스키마, 공개 join capability 경계
- 관련 티켓: E1-7, E2-2, E2-3, E2-5c, E4-1, E4-2, E4-3, E4-4b, E4-5, E5-1a, E6-2, E6-4, E7, E8, E9, SG4, SG5

## 1. 목적

세 모드가 같은 API와 권한 규칙을 사용하도록 Bearer를 검증된 canonical `Actor`로 바꾸는 계약을 정한다. 설치 bootstrap과 capability 응답에 시크릿·사용자·기관 식별값이 들어가지 않도록 서명과 origin 신뢰 경계를 고정한다. 공개 초대 가입은 업무 데이터 인증과 별도의 일회성 capability로 취급한다.

`확정`은 인터페이스, 규칙표, 18개 mode×STT×LLM 조합, fixture, 검증 명령이 문서로 완결되었다는 뜻이다. 실제 Auth·Electron·Office 어댑터의 실행 결과는 구현 검증 완료 단계와 해당 E 티켓의 소유다.

## 2. 인터페이스와 규칙

### 2.1 canonical Actor와 Identity 포트
소유: canonical port와 공통 DTO는 E1-7/E4-1, Supabase·Office·Single Identity와 paired migration은 E4-1/E4-2/E4-3/E7/E8, DPAPI는 E4-4b/E4-5다.
`Actor`와 `Identity`는 `packages/contracts/src/runtime.ts`의 canonical target contract다. 아래는 E1-7이 발행할 lossless Actor shape의 계약 발췌이며 S2가 별도 역할 union을 만들지 않는다.

```ts
interface Actor {
  kind: 'human' | 'agent' | 'system';
  userId: string;
  orgId: string | null;
  roles: ActorRole[];       // institution-admin | technical-admin | supervisor | worker | service
  scopes: string[];
  authn: {
    source: AuthSource;
    assurance: 'none' | 'aal1' | 'aal2' | 'app-lock' | 'mfa';
    sessionId: string | null;
  };
}

interface Identity {
  resolve(request: Request): Promise<Actor>;
  revokeAll(userId: string, reason: RevocationReason): Promise<void>;
  revokeSession(sessionId: string, reason: RevocationReason): Promise<void>;
}
```

`resolve`에는 mode 인자를 추가하지 않는다. 설치 profile이 주입한 adapter가 credential 종류로 mode를 판정하고 위 shape를 채운다. `orgId=null`은 system actor만 허용한다. `ActorRole`과 `AuthSource`는 이 canonical contracts에서 가져오며 S2에서 별도 역할 union을 발행하지 않는다.
`RevocationReason`은 `logout | password-reset | mfa-reset | admin-disable | pairing-revoked | security-event`의 closed union이다.
adapter 내부 context의 인증 원천 literal은 `supabase-jwt | cloudflare-access | single-local-bearer | office-local-bearer | agent-bearer | scheduler-secret`이다. `cloudflare-access`는 E2-7까지의 transitional 환경 adapter이며 canonical Authorization Bearer business path 밖에 있다. `scheduler-secret`은 사람 Actor로 투영하지 않는 내부 scheduler context다.

최종 business API는 `Authorization: Bearer <token>`만 받는다. E2-7 전까지는 환경이 명시적으로 transitional인 경우에만 `Cf-Access-Jwt-Assertion` 또는 preview unlock cookie를 임시 business auth로 허용하며, 이는 final Bearer-only 규칙의 명시적 예외다. URL token, `Origin: null`, `file://` 요청은 모든 환경에서 거부한다.

| 실패 상태 | HTTP | 고정 의미 |
|---|---:|---|
| Authorization 누락, malformed Bearer, signature/issuer/audience/time 실패 | 401 | 인증 material이 없거나 검증되지 않음 |
| 유효한 인증이지만 users 디렉터리 미등록, inactive, revoked | 403 | 인증 주체가 서비스에 provision되지 않음 |
| 유효한 Actor지만 역할·담당·감독·service scope 부족 | 403 | 권한 부족 |
| revocation/JWKS/identity store를 읽을 수 없음 | 503 | 상태를 확인할 수 없어 fail closed, 업무 read/write 없음 |

`resolve`가 반환한 canonical Actor에는 email, raw SID, token 원문, PII를 복사하지 않는다. `roles=[]`인 human Actor는 business route에서 403으로 처리한다. route MFA 판정은 원본 token이나 별도 전역 상태가 아니라 `Actor.authn.assurance`만 읽는다. `technical-admin`은 역할을 `institution-admin`과 합치지 않으며 설치·진단 권한만 갖고 케이스·상담·PII business route에는 403이다. human `scopes`는 gateway가 canonical roles와 담당·감독 관계로 계산한 결과만 담는다.

### 2.2 인증 방식과 canonical role 투영

| 모드 | Bearer 발급·검증 | canonical Actor 매핑 |
|---|---|---|
| Community Cloud | Supabase Auth access JWT. 모든 human role은 `aal=aal2`인 세션만 업무 Actor로 허용한다. trusted issuer, `aud=authenticated`, asymmetric JWKS, `exp`와 선택적 `nbf`를 검증한다. `sub`는 E4-1/E4-2 paired migration이 관리하는 nullable `users.auth_subject`와 대조한다. | `users.id → userId`, 기관 행 → `orgId`, JWT `aal=aal2` → `authn.assurance='aal2'`, source roles를 lossless `roles[]`에 담는다. `aal1`은 모든 human role에서 403 `mfa_required`다. |
| Local Single | Electron 앱 잠금 후 local-service가 발급하는 opaque bearer. token hash만 보관하고 DPAPI handshake를 거친 요청만 발급한다. | 설치된 유일 human account의 `stableUserId → userId`, bearer 발급 때 생성한 random opaque `sessionId → authn.sessionId`, `authn.assurance='app-lock'`, source role bundle `institution-admin`, `technical-admin`, `worker`를 분리해 `roles[]`에 담는다. `multi_user=false`다. |
| Local Office | Argon2id 로컬 계정 로그인 후, privileged role이면 MFA를 완료한 뒤 local-service가 opaque bearer를 발급한다. | 로컬 `users.id → userId`, `orgId`는 설치 기관, 세션의 `sessionId` → `authn.sessionId`, `mfaVerifiedAt` → `authn.assurance='mfa'`, source roles를 `roles[]`에 담는다. |
| 세 모드의 Agent | SG5 service principal이 pairing 후 발급하는 opaque bearer. 서버에는 hash와 installation binding만 두며 사람용 bearer와 섞지 않는다. | `kind='agent'`, `userId=agent:<installationId>`, `orgId`와 active 상태는 `agent_installations` 등록 행에서 읽고 `roles=['service']`로 투영한다. |
| 기존 Access adapter | E2-7 cutover 전 E4-1이 현행 `Cf-Access-Jwt-Assertion`을 검증한다. 이 환경 adapter는 canonical final Bearer path 밖의 임시 business auth이며 E2-7 뒤 제거한다. | Access email/common_name을 기존 users directory에 대조해 lossless `Actor`로 투영하며, 기존 접근 판정과 미등록·inactive 403 동작을 바꾸지 않는다. |
`agent_installations`의 행과 service principal의 발급·회전은 E5-1a/E6-4가 소유한다. `source:read`는 Cloud와 Local의 payload 전달 방식이 달라도 같은 S5 작업 scope로 판정한다.

roles의 업무 의미는 lossless하게 유지한다. `institution-admin`은 기관 업무와 허용된 PII 업무를 수행하고, `technical-admin`은 설치·진단·업데이트만 수행하며 케이스·상담·PII business route에는 403이다. `supervisor`는 지정 팀의 읽기 전용 감독 범위, `worker`는 활성 담당 케이스 쓰기 범위를 가진다. `service`는 아래 Agent route만 가진다. 복수 role은 합집합으로 권한을 계산하며 `roles=[]`인 human은 business route에서 403이다.

Community Cloud의 모든 human role(`institution-admin`, `technical-admin`, `supervisor`, `worker`)은 `Actor.authn.assurance='aal2'`인 세션만 허용한다. `aal1` 또는 다른 assurance는 human Actor를 만들지 않고 403 `mfa_required`다. Local Office에서는 privileged role을 투영하기 전에 `mfaVerifiedAt`이 있어야 하고 그 결과만 `Actor.authn.assurance='mfa'`로 기록한다. MFA 없는 Office 세션은 worker 업무만 가능하다. Local Single의 유일 human account는 설치 시 `institution-admin`, `technical-admin`, `worker` bundle과 practitioner self-assignment를 가지며 앱 잠금 해제 결과는 `app-lock` assurance다.

Agent service Actor의 scope는 정확히 다음 여섯 개다.

| scope | 허용 route와 전달 방식 |
|---|---|
| `jobs:claim` | `POST /pipeline/jobs/claim` |
| `jobs:heartbeat` | `POST /pipeline/jobs/:jobId/heartbeat` |
| `jobs:result` | `POST /pipeline/jobs/:jobId/result` |
| `jobs:release` | `POST /pipeline/jobs/:jobId/release` |
| `audio:read` | `GET /pipeline/jobs/:jobId/audio` |
| `source:read` | `GET /pipeline/jobs/:jobId/source` |

Cloud와 Local의 audio/source response payload는 각 `AudioStore`와 job contract가 정하며 route와 scope는 동일하다. Agent는 `GET /capabilities`, 케이스·상담·PII 금고·초대 route에 403이다. `agent_installations`가 Agent identity의 단일 source다.

```ts
interface AgentInstallation {
  installationId: string;
  orgId: string;
  actorUserId: string;       // service principal에 연결된 정확한 users.id
  pairedAt: string;
  revokedAt: string | null;
}
```
Agent installation은 반드시 같은 `orgId`의 정확한 linked users row를 가지며 그 row가 `active=1`, `role=service`, `users.id=actorUserId`여야 한다. 등록 행, linked users row, bearer의 `installationId`와 `orgId`가 하나라도 다르면 403이다.

E6-4가 이 행과 SG5 service principal을 만들고, opaque bearer hash에는 `installationId`, `orgId`, `expiresAt`, `revokedAt`을 결합한다. Agent bearer는 JWT audience나 사람용 signing key를 사용하지 않는다.

### 2.3 Supabase JWT issuer, audience, JWKS와 회전

Community Cloud Auth 설정은 설치 시 서버에 저장한 기관별 trusted deployment configuration을 기준으로 한다. `issuer`와 `jwksUri`는 이 설정에서만 읽고 public bootstrap이나 capability 응답에서 파생하지 않는다. 서버는 token의 issuer를 token 자체의 문자열로 결정하지 않는다.

```ts
interface JwtVerificationConfig {
  issuer: string;                 // exact Supabase Auth issuer
  audience: 'authenticated';
  jwksUri: string;                // 같은 Supabase 프로젝트의 trusted JWKS endpoint
  allowedAlgorithms: ['ES256', 'RS256'];
  clockSkewSeconds: 60;
  jwksCacheMaxAgeSeconds: 3600;
  unknownKidRefetchCooldownSeconds: 60;
}
```

JWT의 `iss`, `aud`, `alg`, `kid`, `sub`, `session_id`, `exp`, `role`, `is_anonymous`, `aal`을 확인한다. `nbf`는 claim이 있을 때만 ±60초 오차로 확인하고 없는 token을 거부하지 않는다. `role`은 `authenticated`, `is_anonymous`는 `false`, `session_id`는 non-empty여야 한다. 모든 Community Cloud human role(`institution-admin`, `technical-admin`, `supervisor`, `worker`)은 `aal=aal2`가 아니면 403 `mfa_required`다.

JWKS key metadata의 `alg`와 JWT header가 일치하는 ES256 또는 RS256만 허용한다. HS256 프로젝트, symmetric-only key set, key metadata 불일치, algorithm downgrade는 D84 preflight/install에서 거부하며 운영 verifier도 401로 거부한다. JWKS는 최대 1시간 캐시한다. unknown `kid`는 60초 negative cache에 넣고 cooldown 안에는 upstream fetch 없이 401로 거부한다. cooldown이 지나면 같은 trusted `jwksUri`를 한 번 재조회하고 새 키와 아직 만료되지 않은 이전 키를 검증한다. 알 수 없는 issuer, audience, kid, 만료 키 서명은 401이다.

### 2.4 세션 폐기와 TTL

`auth_revocations`는 Cloud와 local 공통 논리 계약이다. `RevocationReason`은 `logout | password-reset | mfa-reset | admin-disable | pairing-revoked | security-event`의 closed union이다. append-only write는 E4-1/E4-2 paired migration이 만들고, gateway의 인증 경계만 `revokeAll(userId, reason)`와 `revokeSession(sessionId, reason)`을 통해 기록한다. Identity adapter가 직접 table을 쓰거나 기존 행을 update/delete하지 않는다.
```ts
interface AuthRevocation {
  kind: 'session' | 'actor';
  subject: string;       // session_id 또는 canonical userId
  revokedAt: string;
  reason: RevocationReason;
}
```

| 인증 material | absolute TTL | idle TTL | 폐기 동작 |
|---|---:|---:|---|
| Supabase access JWT | 3600초 이하 | 30분 갱신 idle 제한 | `session_id`와 userId를 `auth_revocations`에서 매 요청 확인 |
| Single human bearer | 12시간 | 30분 | 앱 잠금·logout·install revoke가 token hash를 즉시 폐기 |
| Office human bearer | 12시간 | 30분 | 세션 행의 `revokedAt` 또는 user disable이 즉시 폐기 |
| Agent bearer | 900초 | 15분 | pairing revoke가 bearer와 claim을 즉시 폐기 |
| Agent refresh credential | 30일 | 30일 | rotate-on-use, 이전 값 재사용 또는 pairing revoke 시 전부 폐기 |
| Cloud scheduler credential | 30일 이내에 회전 | 해당 없음 | Vault와 Edge secret을 함께 교체하고 이전 값을 즉시 폐기 |

Supabase logout, password reset, MFA 변경, 관리자 계정 비활성화는 refresh session을 폐기하고 `session_id` 또는 actor revocation을 기록한다. revocation 상태를 읽지 못하면 503이며 업무 데이터를 반환하지 않는다. Office session 행은 opaque `sessionId`, `sessionHash`, `userId`, `issuedAt`, `expiresAt`, `mfaVerifiedAt`, `revokedAt`을 가진다. bearer의 `Actor.authn.sessionId`는 이 행의 `sessionId`이며 비어 있을 수 없다. 계정 disable, password/MFA reset, 관리자 revoke는 그 계정의 모든 세션을 폐기한다.

### 2.5 Local Single 안정 ID와 잠금 handshake

`stableUserId`는 첫 설치 시 CSPRNG로 생성한 UUIDv4(128 bit)다. SID, username, host, fingerprint, 네트워크 주소, 시간값으로 유도하지 않는다. DPAPI `CurrentUser`로 보호한 install record와 SG9 Recovery Kit에 저장하며 backup/restore와 새 PC 이전 뒤에도 같다. 이 값은 식별자이지 인증 비밀이 아니며 bootstrap, capability, 브라우저 저장소에 넣지 않는다.

앱 잠금 passphrase는 local-service가 Argon2id hash로 확인하고 DPAPI 보호 install data에 둔다. Electron main은 DPAPI 보호 handshake secret과 endpoint record를 읽고 challenge를 생성한다. renderer가 passphrase를 받지 않으며, main이 loopback `POST /auth/unlock`에 one-time challenge proof와 `X-CCC-Install-Id`를 전송할 때만 local-service가 random opaque `sessionId`를 생성해 bearer를 발급한다. `revokeSession(sessionId, reason)`은 이 ID와 token hash를 함께 폐기한다. loopback 밖의 unlock 요청, handshake 재사용, DPAPI record 불일치는 401이다. bearer와 handshake secret은 main process와 service의 memory에만 둔다.

### 2.6 Cloud scheduler 경계

Supabase `pg_cron → Edge HTTP` 호출은 사람 Actor가 아니다. `SCHEDULER_SECRET`은 rotating platform secret으로 Supabase Vault와 Edge secret에 같은 active version으로 저장하고, constant-time 비교한다. `POST /internal/scheduler/run`에서만 받고 `Origin`이 없어야 하며 browser Origin이 있으면 403이다. 성공한 호출은 내부 `SchedulerContext { actorId: 'system:scheduler'; scopes: ['scheduler:run'] }`로 바꾸어 `scheduled-job-runner`만 호출하고 canonical human Actor로 투영하지 않는다. `/internal/scheduler/run` 외 route와 업무 DB read/write에는 사용할 수 없다. Local Single/Office는 HTTP credential 없이 같은 runner를 in-process 호출한다.
소유: Cloud Edge HTTP와 CORS response는 E6-2, Agent pairing은 E6-4, local scheduler와 Electron 연결은 E7/E8이 구현한다.

### 2.7 signed bootstrap과 설치 신뢰 경계

실제 서명 파일의 고정 위치는 `apps/client/public/ccc-install-manifest.json`이다. 저장소에는 값 없는 `apps/client/public/ccc-bootstrap.json.example`만 둔다. 설치 시 생성되는 public bootstrap의 JSON 키는 정확히 둘이다.

```ts
interface PublicBootstrap {
  apiBase: string;
  mode: DeploymentMode;
}
```

이 파일에는 서명 비밀, bearer, refresh token, Supabase service role key, `orgId`, `userId`, email, 기관명, capability 값과 사용자 데이터가 없다. unsigned bootstrap은 같은 static client origin의 고정 `ccc-install-manifest.json`을 가리키는 것 외에 다른 API 또는 manifest 주소를 가리키지 않는다. `supabaseAuthOrigin`과 `supabasePublishableKey`는 bootstrap에 복사하지 않으며, client가 signed manifest 검증과 equality를 끝낸 뒤에만 직접 읽는다. trusted 값은 설치기가 검증하는 signed install manifest로만 읽는다.

```ts
interface SignedInstallManifest {
  schemaVersion: 1;
  mode: DeploymentMode;
  apiBase: string;
  clientOrigin: string;
  allowedOrigins: string[];       // exact origins; wildcard 금지
  host: string;
  scheme: 'https' | 'http' | 'ccc';
  endpointDiscovery: 'static' | 'dpapi-record';
  installationId: string;         // CSPRNG opaque ID, org/user ID 아님
  sequence: number;
  publishedAt: string;
  expiresAt: string;
  approvedSttEngineIds: readonly Array<{ id: ApprovedSttEngineId; mode: 'local' | 'azure' }>; // signed, sorted, unique; initial value []
  supabaseProjectRef: string | null;     // Community Cloud만, apiBase와 동일 project ref
  supabaseAuthOrigin: string | null;     // Community Cloud만 exact HTTPS origin
  supabasePublishableKey: string | null; // public key, signed manifest에서만 읽음
  signingKeyId: string;
  ed25519Signature: string;       // RFC 8785 JCS 나머지 필드 서명
}
```

서명 대상은 RFC 8785 JSON Canonicalization Scheme(JCS)로 정규화한 signature 제외 객체다. `approvedSttEngineIds`도 서명 대상이며 `{ id, mode }`는 ID 오름차순으로 정렬되고 중복이 없어야 한다. 각 ID는 signed registry의 exact member로만 `ApprovedSttEngineId` brand를 얻으며 mode도 함께 검증한다. `supabaseAuthOrigin`은 Community Cloud에서만 non-null이고 정확한 `https` origin이며 path, query, fragment, userinfo를 가질 수 없다. 그 host의 project ref는 `supabaseProjectRef`와 signed `apiBase`의 project ref와 같아야 한다. `supabasePublishableKey`는 `^sb_publishable_[A-Za-z0-9_-]+$` 형식 또는 JWT 세 부분을 가진 legacy key만 허용하며 legacy payload의 decoded `role`이 정확히 `anon`이어야 한다. `sb_secret_*`, `service_role` JWT, 빈 값, malformed/unknown key는 manifest에 쓰기 전에 거부한다. Local Single/Office에서는 `supabaseProjectRef`, `supabaseAuthOrigin`, `supabasePublishableKey`가 모두 null이어야 한다. client build에는 revoked signing key ID 목록을 embedded하고, manifest의 `sequence`는 설치된 값보다 단조 증가해야 하며 `publishedAt <= now < expiresAt`이어야 한다. 알 수 없는 key, 폐기된 key, expiry, sequence replay, installationId 불일치는 시작을 중지한다. `installationId`는 보호 install record와 비교하고 다른 설치에서 복사된 manifest를 거부한다.

client는 먼저 같은 origin의 signed manifest를 검증한 뒤에만 public bootstrap을 읽는다. `bootstrap.mode === signedManifest.mode === capabilities.mode`이어야 하며, Cloud/Office의 `bootstrap.apiBase === signedManifest.apiBase === effectiveApiBase`여야 한다. Single은 bootstrap의 `apiBase`와 `mode`가 서명된 `http://127.0.0.1` base와 exact equality여야 하고, 실제 random port는 DPAPI endpoint record가 같은 installationId에 대해 추가한다. 인증 뒤 `GET /capabilities`의 `X-CCC-Installation-Id` header도 signed manifest의 `installationId`와 byte-equal이어야 하며 하나라도 다르면 403으로 중지한다. public join은 unsigned bootstrap target이 아니라 이 검증과 equality가 끝난 effective `apiBase`만 사용한다.

### 2.8 CapabilityManifest 정본과 18개 조합

인증을 끝낸 human client만 `GET /capabilities`를 호출한다. Agent와 scheduler는 403이다. 응답은 `Cache-Control: no-store`이고 `X-CCC-Installation-Id` header를 포함한다. header 값은 signed manifest와 비교하며 JSON body는 아래 타입과 정확히 같은 key만 허용한다.

```ts
export type DeploymentMode = 'community-cloud' | 'local-single' | 'local-office';
export type SttMode = 'off' | 'local' | 'azure';
export type LlmMode = 'off' | 'openai';
export type ApprovedSttEngineId = string & { readonly __brand: 'ApprovedSttEngineId' };
export type SttEngine = ApprovedSttEngineId | null;
export type AgentStatus = 'connected' | 'delayed' | 'authentication_error' | 'quota_exceeded' | 'inactive';
export type CapabilityDisabledReason = 'unverified' | 'missing_key' | 'unsupported' | null;

export interface CapabilityManifest {
  schemaVersion: 1;
  mode: DeploymentMode;
  sttMode: SttMode;
  sttEngine: SttEngine;
  sttOptions: Array<{ mode: SttMode; enabled: boolean; disabledReason: CapabilityDisabledReason }>;
  llmMode: LlmMode;
  llmOptions: Array<{ mode: LlmMode; enabled: boolean; disabledReason: CapabilityDisabledReason }>;
  features: Record<'recording' | 'multi_user' | 'offline' | 'public_signup' | 'cloud_audio_temp' | 'ai_draft', boolean>;
  agentStatus: AgentStatus;
}
```

`sttOptions`는 정확히 3개이고 배열 순서는 정확히 `[off, local, azure]`, `llmOptions`는 정확히 2개이고 배열 순서는 정확히 `[off, openai]`다. 다음 불변식을 적용한다.
provider option의 disabled reason은 deterministic하다. STT local과 azure는 각각 STT-G/Q 및 Azure 외부 처리 gate 전에는 `unverified`, gate 후 signed registry entry가 없으면 `unsupported`, entry는 있지만 필요한 key가 없으면 `missing_key`다. 선택된 option은 항상 `enabled=true`와 `disabledReason=null`이다.
현재 signed approved engine registry는 비어 있다. 따라서 production pre-Q capability는 모든 mode에서 `sttMode='off'`, `sttEngine=null`이고 local과 azure option은 `enabled=false, disabledReason='unverified'`다. Q가 각 STT gate를 승인하고 signed registry에 `{id, mode}` entry를 넣은 뒤에만 해당 exact ID를 선택한다.
선택된 mode의 option은 `enabled=true, disabledReason=null`이어야 한다. 선택된 `sttMode`와 `sttEngine`은 signed registry의 같은 entry와 exact match여야 하며 local ID를 azure mode에서, azure ID를 local mode에서 재사용할 수 없다. URL, credential, arbitrary string(`://`, `?`, `@`, `Bearer`, `key` 포함)은 decoder가 거부한다.
- `llmMode='off'`는 항상 enabled다. `llmMode='openai'`는 key, Agent, 동의 gate가 모두 유효할 때만 enabled다.
- `features.ai_draft === (llmMode === 'openai')`다. AI가 켜진 선택 row의 `agentStatus`는 `connected`, `delayed`, `authentication_error`, `quota_exceeded` 중 하나이며 `inactive`일 수 없다. 두 축이 모두 off인 row의 AgentStatus는 `inactive`다.
- `features.recording`은 세 mode에서 true, `multi_user`는 Cloud/Office true와 Single false, `offline`은 Single/Office true와 Cloud false, `cloud_audio_temp`는 Cloud true와 Local false다. `public_signup`은 배포 환경 스위치가 `1`인 경우에만 true이며 그 외에는 false다.
- capability에는 key 이름·값·hash, token, endpoint credential, `orgId`, `userId`, email, provider raw error가 없다.
18개 조합 fixture는 requested tuple, synthetic signed engine registry context, actual output을 함께 고정한다. production signed registry는 현재 비어 있으므로 production pre-Q output은 모든 mode에서 `sttMode='off'`, `sttEngine=null`이고 local/azure option은 `unverified`다. 아래 `synthetic-*` registry는 fixture에만 서명해 주입하는 테스트 context이며 production registry를 미리 결정하지 않는다. fixture의 `actual llmMode`는 필요한 key, Agent, 동의 gate가 통과한 결과다.

| # | mode | synthetic signed registry | requested sttMode | requested llmMode | actual sttMode | actual sttEngine | actual llmMode | fixture AgentStatus |
|---:|---|---|---|---|---|---|---|---|
| 1 | community-cloud | registry-empty | off | off | off | null | off | inactive |
| 2 | community-cloud | registry-empty | off | openai | off | null | openai | connected |
| 3 | community-cloud | synthetic-local-whisper-medium | local | off | local | local-whisper-medium | off | connected |
| 4 | community-cloud | synthetic-local-whisper-medium | local | openai | local | local-whisper-medium | openai | connected |
| 5 | community-cloud | synthetic-azure-speech-koreacentral | azure | off | azure | azure-speech-koreacentral | off | connected |
| 6 | community-cloud | synthetic-azure-speech-koreacentral | azure | openai | azure | azure-speech-koreacentral | openai | connected |
| 7 | local-single | registry-empty | off | off | off | null | off | inactive |
| 8 | local-single | registry-empty | off | openai | off | null | openai | connected |
| 9 | local-single | synthetic-local-whisper-medium | local | off | local | local-whisper-medium | off | connected |
| 10 | local-single | synthetic-local-whisper-medium | local | openai | local | local-whisper-medium | openai | connected |
| 11 | local-single | synthetic-azure-speech-koreacentral | azure | off | azure | azure-speech-koreacentral | off | connected |
| 12 | local-single | synthetic-azure-speech-koreacentral | azure | openai | azure | azure-speech-koreacentral | openai | connected |
| 13 | local-office | registry-empty | off | off | off | null | off | inactive |
| 14 | local-office | registry-empty | off | openai | off | null | openai | connected |
| 15 | local-office | synthetic-local-whisper-medium | local | off | local | local-whisper-medium | off | connected |
| 16 | local-office | synthetic-local-whisper-medium | local | openai | local | local-whisper-medium | openai | connected |
| 17 | local-office | synthetic-azure-speech-koreacentral | azure | off | azure | azure-speech-koreacentral | off | connected |
| 18 | local-office | synthetic-azure-speech-koreacentral | azure | openai | azure | azure-speech-koreacentral | openai | connected |

### 2.9 CORS, CSP, Electron과 브라우저 저장
소유: exact CORS와 Edge response는 E6-2, custom protocol은 E7-2, Office TLS origin은 E8-2, browser transport와 service worker는 E2-2/E2-3다.

`allowedOrigins`는 `clientOrigin`을 포함하며 Cloud에서는 통상 정확히 한 origin이다. 요청의 Origin 판정은 다음과 같다.

| 요청 | 동작 |
|---|---|
| `Origin` 없음 + 유효한 non-browser Agent 또는 scheduler credential | CORS header 없이 인증 후 service route만 처리 |
| `Origin` 없음 + human bearer | CORS header 없이 처리할 수 있으나 browser 전용 route는 요청 context를 추가 확인 |
| `Origin`이 allowlist 항목과 byte-equal | 그 항목을 정확히 echo하고 아래 고정 header를 보냄 |
| `Origin: null` 또는 allowlist 밖 | 403, `Access-Control-Allow-Origin` 없음 |

allowlist 일치 시 exact 응답은 다음과 같다. origin을 임의로 반사하지 않으며 `Access-Control-Allow-Credentials` header 자체를 보내지 않는다.

```http
Access-Control-Allow-Origin: <matching exact allowed origin>
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, X-Request-ID
Access-Control-Expose-Headers: ETag, X-Request-ID, X-CCC-Installation-Id
Access-Control-Max-Age: 600
Vary: Origin
```

정적 client CSP는 다음을 사용한다.

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' <signed apiBase> <signed supabaseAuthOrigin>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; form-action 'self'
```

third-party script, inline script, `eval`, 외부 font·image·frame은 0건이다. service worker는 정적 asset과 app shell만 cache하며 token·PII·API response는 cache하지 않는다. `localStorage`, `sessionStorage`, IndexedDB, Cache API, cookie, URL query/hash/path, crash dump, console, analytics에는 bearer·refresh token·PII를 저장하지 않는다. Cloud PWA는 Supabase client `persistSession=false`, `autoRefreshToken=true`로 memory-only session을 사용하며 client initialization은 signed manifest의 `supabaseAuthOrigin`, `supabasePublishableKey`만 사용한다. reload와 새 tab은 login과 필요한 MFA를 다시 요구한다.

Electron은 `file://`와 `Origin: null`을 사용하지 않는다. `app.ready` 전에 다음처럼 `ccc`를 standard·secure scheme으로 등록하고 built client만 제공한다.

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'ccc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
// app.ready 이후 protocol.handle('ccc', serveBuiltClientOnly)
```

custom protocol의 request Origin은 `ccc://app`이어야 한다. `will-navigate`와 `setWindowOpenHandler`는 `clientOrigin`만 허용하며 API origin은 fetch 전용이고 document navigation 대상이 아니다. preload는 context isolation과 sandbox를 사용하고 bearer를 memory에서만 전달한다. Local Office는 기관 CA로 신뢰한 HTTPS same-origin client를 쓴다.

### 2.10 Public join capability

E2-5c가 legacy token-path route를 이 계약으로 cutover한다. 초대 token은 업무 bearer가 아니며 `/public/join/*`의 일회성 capability다. worker link와 participant link는 `joinKind`로 구분한다.

1. invitation URL은 반드시 `/join#t=<token>` fragment를 사용한다. fragment는 static host, API log, Referer에 전송되지 않는다. 정적 HTML 응답과 Electron/local-service 문서에 `Referrer-Policy: no-referrer`와 `<meta name="referrer" content="no-referrer">`를 적용하고 exchange/complete fetch에도 `referrerPolicy: 'no-referrer'`를 지정한다.
2. client는 fragment token을 읽어 `POST /public/join/exchange` body `{ token }`으로 한 번만 보낸다. 응답은 `{ joinKind, expiresAt, formSchemaVersion, nonce }`뿐이며 nonce는 invite ID에 묶인 CSPRNG 128 bit 이상, TTL 15분 이하, single-use다. URL은 즉시 `history.replaceState(null, '', '/join')`으로 scrub한다.
3. `POST /public/join/complete` body `{ nonce, ...form }`은 최소 가입·동의 데이터만 저장한다. participant의 self-check 정보는 이 complete 응답에 한 번만 포함하며 별도 token 재사용 endpoint를 만들지 않는다. worker complete는 Cloud에서만 허용하며 Edge Function의 Supabase service-role admin invite로 Auth user를 만들고 `users.auth_subject`를 저장한 뒤 worker가 정상 로그인하도록 한다. Local Office는 E4-3이 nonce-bound invite exchange와 Argon2id credential creation을 확정하기 전까지 403 `worker_join_unsupported`이고, E4-3 final contract를 통과한 뒤에만 worker join을 연다. Local Single의 worker invite도 `multi_user=false`이므로 403 `worker_join_unsupported`다. service-role key는 browser에 없다.
4. legacy `/invites/*` path token과 token 재사용 self-check는 E2-5c cutover 때 삭제한다. join token/nonce는 `GET /capabilities`, 케이스·상담·PII·Agent endpoint의 Bearer가 아니며 이 endpoint들은 401 또는 403이다. public join은 signed manifest 검증, bootstrap의 mode/apiBase equality, effective `apiBase` 확정 뒤에만 시작하며 capability를 조회하지 않는다.
5. join page에는 third-party resource·analytics·external link가 없다. token 원문은 static/API 로그, errors, cache, Referer, history에 남지 않는다. 가입 완료 뒤 self-check에는 내 정보·참여 사업·담당 실무자·일정·동의 상태만 있고 상담 기록·요약·GAS·flag·기관 전체 목록은 없다.
소유: join route·fragment cutover는 E2-5c, Cloud Auth user linkage와 service-role 경계는 E4-2, Local join transport는 E7/E8이다. S3는 E2-5c cutover 뒤 이 endpoint/DTO 표를 참조한다.

## 3. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| client origin | signed exact HTTPS origin | registered `ccc://app` | 기관 CA HTTPS origin |
| API origin | signed Supabase/Edge HTTPS | DPAPI endpoint record가 정한 loopback random port | 내부망 HTTPS |
| human auth | Supabase JWT + all human roles require `aal2` | OS user + Argon2id app lock + stableUserId | Argon2id local account + privileged session MFA |
| Actor source | `auth_subject → users.id` | stableUserId | local users.id |
| Agent source | SG5 service principal + agent_installations | paired local Agent + agent_installations | paired server Agent + agent_installations |
| revocation | Supabase session + `auth_revocations` | in-memory/token hash + install revoke | session rows + account revoke |
| multi_user | true | false | true |
| offline | false | true | true |
| cloud_audio_temp | true | false | false |
| public_signup | env switch `PUBLIC_SIGNUP_ENABLED=1` | env switch | env switch |

Local Single에서는 `joinKind='worker'`를 만들지 않으며, participant join만 허용한다. Cloud만 worker invitation capability를 제공하고, Local Office는 E4-3이 nonce-bound invite exchange와 Argon2id credential creation을 확정한 뒤에 연다.

세 모드는 canonical Actor, API DTO, capability key를 공유한다. 차이는 Identity·SecretStore·origin·저장소 adapter뿐이다.
- [ ] Community Cloud 모든 human role의 `aal2`, Office `mfaVerifiedAt`, Single DPAPI unlock handshake와 stableUserId, Agent six scopes와 registration source가 완결되어 있다.
- [ ] canonical `Identity.resolve(request)`, `revokeAll(userId, reason)`, `revokeSession(sessionId, reason)`를 사용하고, 세 mode의 Bearer, lossless role projection, 401/403/503 판정이 완결되어 있다.

- [ ] Supabase `session_id`, optional `nbf`, `role`, `is_anonymous`, ES256/RS256 JWKS rotation, negative cache/cooldown, revocation과 TTL이 완결되어 있다.
- [ ] signed manifest의 JCS, expiry, sequence, installationId, key revocation, nullable Supabase Auth origin/project ref/publishable key, Single dynamic endpoint discovery와 public two-key bootstrap이 완결되어 있다.
- [ ] exact CapabilityManifest schema, deterministic feature/status invariants, 18개 combination fixture가 있고 secret field가 없다.
- [ ] exact CORS/CSP, absent Origin service rule, Electron privileged protocol/navigation, browser memory-only session과 no-persistence가 완결되어 있다.
- [ ] E2-5c public join exchange/complete, fragment Referrer 방지, worker Auth linkage와 authenticated business data 분리가 완결되어 있다.
- [ ] fixture 정의와 기대 실패 판정이 §5에 있고 E1-7, E2-2, E2-3, E2-5c, E4-1, E4-2, E4-3, E4-4b, E4-5, E5-1a, E6-2, E6-4, E7, E8, E9 계약에 매핑되어 있다.

## 5. 검증 방법

- `pnpm test:contracts --auth`: `cloud-human-active`, `cloud-aal1-all-human`, `cloud-revoked-session`, `office-admin-no-mfa`, `single-stable-id`, `single-dpapi-handshake`, `agent-service`, `cloud-scheduler-secret`, `agent-linked-user-mismatch` fixture를 검사한다. malformed/invalid token은 401, valid unprovisioned/inactive/revoked 또는 linked user mismatch는 403, store unavailable은 503이어야 한다.
- `pnpm test:contracts --jwt`: `session_id`, optional `nbf`, `role`, `is_anonymous`, ES256/RS256 key metadata, HS256 rejection, old/new key rotation, unknown-kid negative cache/cooldown을 검사한다. unknown-kid마다 upstream fetch가 발생하거나 HS256이 통과하면 실패다.

- `pnpm test:contracts --capabilities`: synthetic signed-registry context를 포함한 18개 조합을 decode하고 schemaVersion, exact key set, `sttOptions` 3개 `[off, local, azure]`, `llmOptions` 2개 `[off, openai]`, branded engine membership, status/feature invariants, secret·PII field 부재를 검사한다. `stt-azure-id-as-local-reject` 또는 `stt-local-id-as-azure-reject`가 통과하거나 조합 하나라도 표현되지 않으면 실패다.
- `pnpm test:security --bootstrap`: valid/tampered/expired/sequence-replay/wrong-install/key-revoked manifest, `single-dynamic-port`, Supabase Auth origin/project-ref/key equality와 `publishable-sb-valid`, `publishable-legacy-anon`, `publishable-secret-reject`, `publishable-service-role-reject`, `publishable-malformed` fixture를 검사한다. signature mismatch, non-loopback endpoint, unsigned bootstrap apiBase 사용, local mode의 non-null Supabase field, 잘못된 publishable key가 발생하면 실패다.
- `pnpm test:security --browser-boundary`: CORS preflight와 absent Origin service call, CSP, Electron `ccc://app` Origin, API navigation denial, service-worker cache, memory-only Cloud reload, storage boundary를 검사한다. `*`, credential cookie, `Origin: null`, API document navigation, token/PII persistence가 관측되면 실패다.
- `pnpm test:golden --join`: fragment → exchange → replaceState → complete와 worker/participant flow를 검사한다. token이 static/API log·Referer·cache에 남거나 join token으로 capabilities·상담 데이터를 읽으면 실패다.

실제 기관 credential은 fixture에 사용하지 않는다. public bootstrap, signed manifest, capability, 로그와 오류에는 secret·token·PII를 넣지 않는다.

## 6. 이번에 안 하는 것

- Supabase 자원 생성·마이그레이션·기존 기관 데이터 이전은 ADR-0042 D84와 E6이 소유한다. `users.auth_subject`, nullable local `users.email`, `auth_revocations`, `agent_installations` paired migration의 저장 구조는 E4-1/E4-2가 소유한다.
- Argon2id·DPAPI·Electron shell·TLS·Agent pairing의 구현과 Windows 런타임 증거는 E4-3, E4-4b, E4-5, E6-4, E7, E8 및 SG4/SG5가 소유한다.
- 실제 UI route 구현과 PWA 이전은 E2-2, E2-3, E2-5c 이후 E2 화면 티켓이 소유한다. S2는 화면을 새로 설계하지 않는다.
- identity mapping, `auth_revocations`, `agent_installations` 저장 구조의 paired migration owner는 E4-1/E4-2다. E4-2와 E6-4는 이 구조 위에 각각 Auth와 pairing 의미를 배선한다.
- 실제 JWT signing key, Supabase access token, scheduler secret, Agent refresh token, 기관 식별값은 문서·fixture·bootstrap·capability에 넣지 않는다.
- preview의 `ccc_preview` cookie는 E2-7까지 별도 unlock environment gate에서만 발급되는 transitional business auth이며 final Bearer-only 규칙의 명시적 예외다. bearer 없는 business Actor를 production에서 선택하는 데 사용하지 않고 E2-7에서 제거한다.
