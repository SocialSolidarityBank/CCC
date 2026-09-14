# relayer Auth 드리프트 정합화 설계

- 상태: 제품 설계 승인. 2026-09-14 Q가 아래 Auth 정합화 설계와 구현 전용 범위를 승인했다.
- 목적: 별도로 승인해 적용한 `disable_signup=true`와 수동 여섯 자리 초대 템플릿을 기존 설치 journal이 정확히 채택하게 한다.
- 적용 대상: 이미 설치가 끝난 hosted Community Cloud 한정.
- 이번 문서의 범위: 설계와 다음 구현의 수용 기준만 고정한다. 코드 구현, live Supabase 변경, journal 적용, 초대 발송, 배포는 하지 않는다.
- 관련 정본: [ADR-0050](../../adr/0050-relayer-assisted-onboarding.md), [S11](../../specs/S11-supabase-edge-template.md), [relayer 온보딩 설계](2026-09-13-relayer-onboarding-design.md).

## 문제

현재 N02 project doctor는 설치 journal의 `phase='installed'`를 확인하지만 `DRIFT_BLOCKED`와 `DRIFT_DETECTED`만 반환한다. 설치 뒤 별도 승인을 받아 Supabase Auth의 `disable_signup`을 `false`에서 `true`로 바꾸고 수동 여섯 자리 초대 템플릿을 적용했기 때문이다.

기존 설치 상태 지문은 bounded Auth 설정에 `disable_signup`을 포함하므로 이 변경을 drift로 감지한다. 반면 초대 템플릿 본문은 기존 Auth fingerprint 입력에 포함하지 않는다. 따라서 journal의 `state_fingerprint`만 현재 값으로 덮으면 어떤 변경을 채택했는지 증명할 수 없고, 템플릿을 Auth fingerprint에 새로 넣으면 기존 설치 지문을 같은 계산으로 재현할 수 없다.

새 동작 `reconcile-auth-config`는 허용된 두 Auth 변경이 정확히 존재하고 나머지 상태가 이전 journal과 같음을 먼저 증명한 뒤, 공급자 설정을 건드리지 않고 설치 메타데이터만 한 번 전진시킨다.

## 불변 조건

1. 기존 `private.ccc_install_authorizations`, `private.ccc_release_history`의 행은 수정하거나 삭제하지 않는다. 기존 completed step, receipt, resource, migration 행도 수정하거나 삭제하지 않는다.
2. `disable_signup=false`로 되돌리거나 public signup을 다시 열지 않는다.
3. 기존 journal hash를 직접 고쳐 drift를 숨기지 않는다. 이전 지문의 재현, 현재 지문의 계산, 새 승인 이력과 completed `auth_config` step을 한 계약으로 기록한다.
4. 공급자 Auth PATCH, 초대 이메일 전송, Auth 사용자 생성, migration, release, deployment와 provider control-plane write는 모두 0건이다. 허용되는 공급자 접근은 현재 상태를 읽는 기존 Management Auth GET과 database read-only query뿐이다.
5. 운영 secret의 정본 이름은 Infisical의 `RELAYER_*`다. 실행기는 process injection 경계에서만 기존 코드 입력인 `CCC_*` 또는 `SUPABASE_*` 이름으로 연결한다. 이 작업은 secret을 읽거나 저장하지 않고 코드 식별자를 전역 개명하지 않는다.
6. 보통의 doctor와 apply는 drift 상태에서 계속 fail-closed다. `reconcile-auth-config`만 아래의 좁은 증명에 성공했을 때 journal 채택을 허용한다.

## 동작 인터페이스

공개 설치 도구의 동작 이름은 하나다.

```text
node scripts/onboarding/cloud.mjs reconcile-auth-config
```

기존 N02 입력인 `CCC_ONBOARDING_REQUEST`, `CCC_ONBOARDING_JOURNAL`, `CCC_ONBOARDING_INSTALLATION`과 S11의 서명, trust, provider baseline, installer DB 연결 입력을 그대로 소비한다. 임의 설정 객체, 템플릿 본문 인자, journal hash 인자나 provider PATCH payload는 추가하지 않는다. 외부 secret runner가 `RELAYER_*` 정본을 기존 이름에 주입하는 일은 이 명령 바깥의 실행 경계가 맡는다.

동작은 `target='hosted'`인 Community Cloud만 받는다. Local Single, Local Office와 local Supabase에는 `TARGET_UNSUPPORTED`를 반환하고 관찰이나 쓰기를 시작하지 않는다.

최초 정합화에는 현재 시각에도 유효한 새 signed manifest와 approval이 필요하다. 새 pair는 현재 journal과 다음 값이 모두 같아야 한다.

- `installationId`
- `institutionId`와 `institutionIdHash`
- `projectRef`와 `projectRefHash`
- `expectedOwnerOrgId`와 `expectedOwnerOrgIdHash`
- `runtimeConfigurationSha256`
- `contractVersion`
- journal의 `resourcesSha256`, `migrationsSha256`, `planFingerprint`가 가리키는 기존 설치 계약

새 `runtimeSequence`는 journal의 현재 값보다 엄격히 커야 한다. 만료, 서명, 폐기 목록, manifest와 approval 결합도 기존 `requireSignedOwnerPreflight` 규칙으로 다시 확인한다. 같은 sequence는 아래의 완료 증거가 이미 정확히 존재하는 idempotent readback에서만 허용한다.

## exact Auth 설정과 공유 모듈

실행 코드의 초대 템플릿 literal은 신규 `scripts/supabase/auth-config.mjs` 한 곳에만 둔다. `scripts/onboarding/first-admin.mjs`의 readiness와 `reconcile-auth-config`가 이 모듈을 import한다. 테스트도 템플릿 본문을 다시 복사하지 않고 모듈의 공개된 검사 결과와 고정 hash를 사용한다.

승인된 본문은 UTF-8, 줄 사이 LF 네 개, 마지막 줄 뒤 개행 없음인 다음 408 byte다.

```html
<h2>Relayer 관리자 초대</h2>
<p>아래 링크를 열고 이 이메일 주소와 여섯 자리 인증 코드를 입력해 관리자 계정을 설정하세요.</p>
<p><a href="{{ .RedirectTo }}">관리자 계정 설정</a></p>
<p>인증 코드: <strong>{{ .Token }}</strong></p>
<p>이 코드는 한 번만 사용할 수 있으며 만료되면 설치 담당자에게 새 초대를 요청해 주세요.</p>
```

이 byte의 SHA-256은 `6b5639d037932528297ebba1becf112e8b10c49e85caef0b10c9e25447c72c55`다. 모듈은 literal에서 실행 시 hash를 계산하며 같은 값을 별도 상수 literal로 복제하지 않는다. 현재 provider body는 먼저 이 literal과 byte-equal인지 검사한다. 같지 않으면 hash 일치 여부와 무관하게 실패한다.

같은 모듈이 현재 hosted inspector의 bounded Auth fingerprint 입력도 소유한다. 키와 순서는 현행과 같고 추가하거나 빼지 않는다.

```text
disable_signup
external_anonymous_users_enabled
external_email_enabled
mailer_autoconfirm
mfa_max_enrolled_factors
mfa_totp_enroll_enabled
mfa_totp_verify_enabled
refresh_token_rotation_enabled
security_captcha_enabled
jwt_exp
site_url
sessions_single_per_user
```

각 누락값을 `null`로 정규화한 ordered object를 `JSON.stringify`한 UTF-8 byte의 SHA-256이 Auth fingerprint다. 초대 템플릿은 이 fingerprint 입력에 넣지 않고 별도 `inviteTemplateSha256` 증거로만 다룬다. 이 규칙으로 기존 설치 fingerprint 계산을 바꾸지 않는다.

현재 Auth는 다음 두 조건을 모두 만족해야 한다.

- `disable_signup === true`
- `mailer_templates_invite_content`가 위 exact body와 byte-equal

`external_anonymous_users_enabled`를 포함한 나머지 bounded Auth 값은 현재 관찰값을 그대로 사용한다. 정합화가 어떤 값을 원하는 상태로 추정하거나 보정하지 않는다.

## 쓰기 전 증명

### 1. 잠금 전 읽기 전용 계획

1. 새 signed pair를 검증하고 N02 생성 journal, 현재 Supabase project와 owner를 같은 설치에 결합한다.
2. hosted inspector로 현재 Auth, DB, provider inventory, Storage, cron과 설치 메타데이터를 읽는다.
3. `renewAuthorization=true`로 기존 doctor 계약을 실행한다. journal은 존재하고 `phase='installed'`여야 한다.
4. 최초 정합화 후보에서 doctor blocker의 집합은 정확히 `DRIFT_BLOCKED`, `DRIFT_DETECTED` 두 개여야 한다. 순서는 의미가 없지만 다른 blocker가 하나라도 있으면 그 고정 code로 실패한다. provider baseline, resource ownership, migration checksum, journal, receipt 또는 release 오류를 두 drift code 뒤에 숨기지 않는다.
5. 현재 Auth의 exact template과 `disable_signup=true`를 확인한다.

### 2. 이전 설치 지문 재현

현재 read-only observation을 `currentObservation`이라 한다.

1. 공유 모듈로 현재 bounded Auth object와 `currentAuthFingerprint`를 계산한다.
2. bounded Auth object를 복사하고 `disable_signup` 값 하나만 `false`로 바꾼다. 다른 키, 누락값, 순서와 observation 필드는 byte 단위로 유지한다.
3. 같은 Auth fingerprint 함수로 `priorAuthFingerprint`를 계산한다.
4. `currentObservation`을 복사해 `state.authFingerprint` 하나만 `priorAuthFingerprint`로 바꾼다.
5. 기존 `installationStateFingerprint(observation, providerBaseline)`으로 `priorStateFingerprint`를 계산한다.
6. `priorStateFingerprint`가 installed journal의 현재 `stateFingerprint`와 정확히 같아야 한다. 다르면 `AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH`이며 write는 0건이다.
7. 원래 `currentObservation`으로 `currentStateFingerprint`를 계산한다. 이 값은 `priorStateFingerprint`와 달라야 하며, 현재 normal doctor의 `DRIFT_DETECTED` 원인이어야 한다.

이 증명은 현재 관찰에서 `disable_signup` 하나만 과거 값으로 되돌렸을 때 기존 journal이 재현되는지를 묻는다. 다른 Auth 필드, DB catalog, RLS, bucket, cron, provider inventory 또는 owner가 함께 바뀌었으면 이전 지문과 같아질 수 없다. 템플릿은 기존 fingerprint 밖에 있으므로 exact body 검사와 별도 hash 증거가 이를 보완한다.

### 3. advisory lock 뒤 재관찰

초기 증명이 끝나면 기존 `withInstallLock`으로 `projectRefHash` advisory lock을 얻는다. lock을 얻은 뒤 provider와 DB를 다시 읽고 다음 전체 조건을 재검증한다.

- signed pair가 여전히 유효하고 같은 digest 및 stable binding이다.
- runtime sequence가 최초 정합화에서는 여전히 journal보다 크다.
- current Auth가 `disable_signup=true`와 exact template이다.
- doctor blocker 집합이 여전히 정확히 두 drift code뿐이다.
- prior 및 current state fingerprint가 잠금 전 값과 같다.
- journal, authorization history, completed steps, receipt, release history, resources와 migrations가 잠금 전과 같다.

값이 바뀌면 `PLAN_STATE_CHANGED`로 끝낸다. advisory lock은 같은 설치 도구의 동시 쓰기를 막는 장치이고 provider 외부 변경을 막는다고 가정하지 않는다. 그래서 잠금 뒤 재관찰을 생략하지 않는다.

## 원자적 journal 채택

잠금 뒤 검증을 통과하면 하나의 DB transaction이 다음 세 동작만 순서대로 수행한다.

1. `private.ccc_install_authorizations`에 새 signed pair의 표준 authorization-history 행을 INSERT한다.
2. `private.ccc_install_steps`에 completed `auth_config` 행 하나를 INSERT한다.
3. `private.ccc_install_journal`의 승인 pointer와 `state_fingerprint`만 UPDATE한다.

`auth_config` step은 다음 값을 가진다.

| 열 | 값 |
|---|---|
| `step` | `auth_config` |
| `idempotency_key` | `hashCanonical({ operation: 'reconcile-auth-config', installationId, priorStateFingerprint, currentStateFingerprint, inviteTemplateSha256 })` |
| `status` | `completed` |
| `ownership_tags` | 빈 배열 |
| `provider_resource_id_hashes` | 빈 배열 |
| `provider_resource_digests` | `[priorStateFingerprint, currentStateFingerprint, inviteTemplateSha256]`의 정확한 순서 |
| `state_fingerprint` | `currentStateFingerprint` |
| `started_at`, `completed_at` | 같은 transaction의 DB 시각 |

템플릿 본문은 어떤 DB 열에도 저장하지 않는다. 기존 `ccc_install_steps`의 idempotency key, digest 배열과 state fingerprint가 세 hash를 모두 담을 수 있으므로 schema migration은 만들지 않는다.

journal UPDATE 허용 열은 기존 authorization renewal이 갱신하는 `runtime_manifest_sha256`, `approval_sha256`, `runtime_sequence`, `expires_at`, `updated_at`과 이번에 필요한 `state_fingerprint`뿐이다. stable 값인 `runtime_configuration_sha256`, `installation_id`, 기관 및 project hash, `resources_sha256`, `migrations_sha256`, `phase`, `current_step`, `plan_fingerprint`, `database_fingerprint`, `last_error_code`는 바꾸지 않는다.

transaction은 journal 행을 `FOR UPDATE`로 다시 읽고 signed pair를 commit 직전 한 번 더 검증한다. INSERT 충돌, 기존 step 불일치, authorization 철회 또는 pointer 변경이 있으면 전부 rollback한다. 기존 authorization, completed step, receipt, release history, resource와 migration 행은 그대로 남는다.

commit 뒤 normal doctor를 읽기 전용으로 한 번 실행한다. 다른 문제가 없다면 journal의 새 `state_fingerprint`가 현재 observation과 같아 두 drift blocker가 사라진다. 이 사후 확인 실패는 이미 commit된 증거를 지우거나 provider를 변경하지 않고 고정 오류로 보고한다. 다음 실행은 아래 readback 계약으로 실제 commit 여부를 확인한다.

## idempotency와 응답 유실 복구

같은 signed pair로 다시 실행할 때 runtime sequence가 journal과 같아도 다음 증거가 모두 맞으면 쓰기 없이 `AUTH_CONFIG_ALREADY_RECONCILED`를 반환한다.

- journal pointer의 manifest, approval, sequence, expiry와 state fingerprint가 입력 pair 및 현재 observation과 같다.
- 같은 sequence의 authorization-history 행이 입력 pair와 정확히 같다.
- 계산한 idempotency key의 completed `auth_config` step이 하나 있고 digest 배열, state fingerprint와 시각 형식이 위 계약과 같다.
- 현재 `disable_signup=true`, exact template과 normal doctor 상태가 유지된다.

행이 일부만 있거나 같은 key의 내용이 다르거나 같은 sequence가 다른 pair를 가리키면 성공으로 보정하지 않는다. `INSTALL_STEP_MISMATCH`, `INSTALL_JOURNAL_INVALID` 또는 `INSTALL_AUTHORIZATION_MISMATCH`로 실패하고 write는 0건이다.

DB commit 뒤 CLI 응답을 잃어도 다음 실행이 새 authorization row, completed step과 journal pointer를 읽어 완료를 확정한다. 이메일을 다시 보내거나 Auth 설정을 다시 적용하지 않는다. 다른 템플릿 body, 다른 template hash, 다른 pair 또는 unrelated drift는 idempotent repeat가 아니며 거부한다.

## 고정 결과와 오류 code

| code | 종류 | 조건 | write |
|---|---|---|---:|
| `AUTH_CONFIG_RECONCILED` | 성공 | 최초 transaction과 사후 readback 완료 | journal transaction 1회 |
| `AUTH_CONFIG_ALREADY_RECONCILED` | 성공 | 같은 pair와 세 durable 증거의 exact readback | 0 |
| `TARGET_UNSUPPORTED` | 오류 | hosted Community Cloud가 아님 | 0 |
| `AUTH_RECONCILE_TEMPLATE_MISMATCH` | 오류 | provider template 누락 또는 exact body 불일치 | 0 |
| `AUTH_RECONCILE_AUTH_STATE_MISMATCH` | 오류 | 현재 `disable_signup`이 `true`가 아니거나 bounded Auth 상태를 만들 수 없음 | 0 |
| `AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH` | 오류 | `disable_signup=false`만 대입한 이전 지문이 journal과 다름 | 0 |
| `INSTALL_AUTHORIZATION_MISMATCH` | 오류 | pair 불일치, stable binding 변경, 최초 실행의 같은 또는 낮은 sequence, 완료 증거 없는 같은 sequence | 0 |
| `INSTALL_LOCK_BUSY` | 오류 | project advisory lock을 얻지 못함 | 0 |
| `PLAN_STATE_CHANGED` | 오류 | 잠금 전후 observation, journal 또는 authorization이 달라짐 | 0 |
| `INSTALL_STEP_MISMATCH` | 오류 | 같은 idempotency key의 step 증거가 다름 | 0 |
| `INSTALL_JOURNAL_INVALID` | 오류 | installed journal, authorization history 또는 readback 구조가 불완전함 | 0 |

서명, 만료, owner, provider baseline, resource, migration, receipt와 release 검사는 기존 고정 code를 그대로 반환한다. 특히 `OWNER_EVIDENCE_MISSING`, `OWNER_MISMATCH`, `PROVIDER_BASELINE_MISMATCH`, `RESOURCE_OWNERSHIP_MISMATCH`, `MIGRATION_CHECKSUM_MISMATCH`, `INSTALL_NOT_FOUND`, `INSTALL_INCOMPLETE`, `RELEASE_PREREQUISITES_MISSING`을 새 drift code 하나로 뭉개지 않는다. normal doctor blocker가 여러 개면 기존 doctor의 고정 우선순위에서 첫 code를 반환하며 어느 경우에도 write하지 않는다.

## redacted 출력

최초 성공과 idempotent readback은 stdout에 exact key를 가진 JSON 한 건만 쓴다. 아래 hash는 형식만 보이는 합성값이다.

```json
{
  "schemaVersion": 1,
  "operation": "reconcile-auth-config",
  "target": "hosted",
  "status": "reconciled",
  "code": "AUTH_CONFIG_RECONCILED",
  "changed": true,
  "installationIdSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "runtimeSequence": 2,
  "priorStateFingerprint": "1111111111111111111111111111111111111111111111111111111111111111",
  "stateFingerprint": "2222222222222222222222222222222222222222222222222222222222222222",
  "inviteTemplateSha256": "6b5639d037932528297ebba1becf112e8b10c49e85caef0b10c9e25447c72c55"
}
```

repeat는 `status="already-reconciled"`, `code="AUTH_CONFIG_ALREADY_RECONCILED"`, `changed=false`만 달라진다. `runtimeSequence`는 실제 pair의 safe integer이고 hash는 실행 때 계산한 lowercase SHA-256이다.

오류는 stderr에 다음 exact shape만 쓰고 stdout은 비운다.

```json
{"error":{"code":"AUTH_RECONCILE_TEMPLATE_MISMATCH"}}
```

project ref, 기관 ID, owner ID, URL, Auth 설정 body, 템플릿 body, manifest, approval, signature, token, 연결 문자열, provider 응답과 원문 오류는 출력, 로그와 exception message에 넣지 않는다. provider에서 받은 알 수 없는 오류는 기존 redacted code로 바꾸고 원문을 연결하지 않는다.

## likely touched files와 소유권

이 목록은 다음 구현의 예상 범위다. 구현 계획 문서나 작성 슬롯 승인은 아니다.

| 파일 | 변경 책임 | 소유 |
|---|---|---|
| `scripts/supabase/auth-config.mjs` 신규 | exact template 한 벌, bounded Auth key 순서, fingerprint 및 template hash 계산 | S11 Supabase 설치 작성자 |
| `scripts/supabase/auth-config.test.mjs` 신규 | exact byte/hash, 과거 fingerprint 대입, body 불일치 검사 | S11 Supabase 설치 작성자 |
| `scripts/onboarding/first-admin.mjs` | 로컬 template literal 제거, shared readiness 소비 | onboarding 레인 |
| `scripts/onboarding/first-admin.test.mjs` | template 사본 제거, shared 계약을 사용한 readiness 회귀 | onboarding 레인 |
| `scripts/supabase/hosted-inspector.mjs` | 기존 Auth fingerprint를 shared 모듈로 계산하고 redacted reconciliation evidence 제공 | S11 Supabase 설치 작성자 |
| `scripts/supabase/plan.mjs` | normal doctor를 완화하지 않고 exact reconciliation proof 평가 함수 추가 | S11 Supabase 설치 작성자 |
| `scripts/supabase/install-journal.mjs` | 한 transaction의 authorization INSERT, completed step INSERT, pointer UPDATE와 readback | S11 Supabase 설치 작성자 |
| `scripts/supabase/install-journal.test.mjs` | 원자성, append-only 보존, repeat와 response-loss DB 회귀 | S11 Supabase 설치 작성자 |
| `scripts/supabase/bootstrap.mjs` | 내부 operation routing, fixed code와 redacted result | S11 Supabase 설치 작성자 |
| `scripts/supabase/bootstrap.test.mjs` | hosted-only와 provider write 0 통합 회귀 | S11 Supabase 설치 작성자 |
| `scripts/onboarding/cloud.mjs` | N02 공개 `reconcile-auth-config` 명령과 기존 생성 대상 결합 | onboarding 레인 |
| `scripts/onboarding/cloud.test.mjs` | N02 명령 입력, 출력과 no-write 회귀 | onboarding 레인 |

`apps/client`, core, HTTP, contracts, migration, release artifact, lockfile, UI/CSS와 DESIGN 소유 파일은 건드리지 않는다. `scripts/supabase/**`는 공유 설치 경계이므로 onboarding 구현자가 독단으로 수정하지 않고 현재 S11 설치 작성자와 단일 작성 슬롯을 정한 뒤 반영한다.

## test-first 구현 순서

구현은 아래 실패 검사를 먼저 추가하고 각 검사가 의도한 이유로 실패하는지 확인한 뒤 최소 코드를 작성한다. live Supabase, 실제 이메일과 실제 secret은 사용하지 않는다.

1. **성공 전이**: installed journal의 지문은 `disable_signup=false` 관찰로 만들고 현재 synthetic provider 관찰은 `true`와 exact template로 둔다. sequence가 하나 큰 fresh pair로 실행해 authorization-history 1행과 completed `auth_config` step 1행이 추가되고 허용 journal 열만 바뀌는지 확인한다. normal doctor의 두 drift blocker가 사라져야 한다.
2. **잘못된 템플릿, zero writes**: 누락, 한 byte 차이, `ConfirmationURL`, `TokenHash`, query와 fragment 변형을 각각 거부한다. DB row count와 journal이 byte-equivalent이고 provider PATCH, invite와 email send가 0건이어야 한다.
3. **이전 지문 증명 실패, zero writes**: 현재 observation의 다른 bounded Auth 값, DB fingerprint, policy, bucket, cron과 provider inventory를 하나씩 바꾼다. `AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH`이며 DB 및 provider write가 0건이어야 한다.
4. **unrelated doctor blocker, zero writes**: `PROVIDER_BASELINE_MISMATCH`, `RESOURCE_OWNERSHIP_MISMATCH`, `MIGRATION_CHECKSUM_MISMATCH`, receipt 또는 release blocker를 주입한다. 각 기존 code를 보존하고 authorization, step과 journal write가 모두 0건인지 확인한다.
5. **stale 및 same sequence 거부**: 낮은 sequence, 완료 증거가 없는 같은 sequence, 같은 sequence의 다른 manifest/approval, stable runtime configuration 변경을 `INSTALL_AUTHORIZATION_MISMATCH`로 거부한다. 각 경우 write는 0건이다.
6. **repeat idempotency**: 성공 전이 뒤 같은 pair로 다시 실행한다. `AUTH_CONFIG_ALREADY_RECONCILED`, `changed=false`를 받고 authorization-history, steps와 journal의 row/value가 늘거나 바뀌지 않아야 한다.
7. **interruption 및 response-loss readback**: transaction commit 직후 응답 전달만 실패시킨다. 같은 pair 재실행이 authorization row, completed step과 pointer를 읽어 already-reconciled를 반환하고 중복 INSERT와 provider 호출을 하지 않는지 확인한다.
8. **provider/email 부작용 0**: fetch spy는 기존 Auth config GET과 database read-only query만 허용한다. Auth PATCH, `/auth/v1/invite`, admin user create, template update, migration, deployment 및 다른 provider write endpoint 호출은 모두 0건이어야 한다.
9. **잠금 뒤 변경**: 첫 증명과 advisory lock 뒤 재관찰 사이에 Auth, journal 또는 signed pair를 바꾼다. `PLAN_STATE_CHANGED` 또는 기존 authorization code로 실패하고 transaction이 시작되지 않는지 확인한다.
10. **redaction**: 성공 및 모든 오류 직렬화에 template body, provider body, project ref, 기관/owner ID, URL, token, signature와 secret fixture가 0건인지 확인한다.

순서는 pure `auth-config` 검사, disposable PostgreSQL journal transaction 검사, bootstrap과 onboarding command 통합 검사다. 테스트가 필요로 하는 provider는 read-only fake이고 DB 검사는 기존 disposable PostgreSQL harness를 재사용한다. 별도 framework, schema migration, provider adapter와 범용 reconciliation abstraction은 만들지 않는다.

## 수용 기준

- exact 현재 Auth 상태와 정확히 재현한 prior journal 상태가 모두 증명된 hosted 설치만 채택한다.
- 최초 채택은 fresh higher-sequence signed pair, authorization-history INSERT, completed `auth_config` step과 journal pointer UPDATE가 한 transaction으로 끝난다.
- 같은 pair의 반복과 response loss는 durable evidence readback으로 수렴하며 다른 body, hash, pair 또는 drift는 거부한다.
- public signup은 계속 닫혀 있고 provider/email write는 0건이다.
- 기존 append-only 행과 모든 기존 step, receipt, resource, migration 및 release history가 그대로다.
- 템플릿 실행 literal은 shared Supabase-side 모듈 한 곳에만 있고 journal과 출력에는 body가 없다.
- normal doctor와 apply의 fail-closed drift 규칙을 완화하지 않는다.
