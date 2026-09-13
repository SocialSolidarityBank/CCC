# relayer 온보딩 구현 계획

> **실행자 지침:** `executing-plans`로 이번에 배정된 Linear 티켓 하나만 수행한다. 해당 범위 검증 → 해당 티켓 ID로 커밋 → 쉬운 한국어 완료 코멘트와 SHA → Done → 다음 세션 인계 순서를 지킨다. 막히면 범위를 줄이거나 완료 처리하지 않고 미커밋 변경과 정확한 차단 사유를 보존한 채 종료한다. 다음 티켓은 반드시 새 세션에서 시작한다. 체크리스트는 작업별 수용 기준이지 현재 완료 상태가 아니다.

**Goal:** 처음 설치와 가입, 이후 AI/STT/DB 설정을 질문, 안내, 입력, 단계 승인, 실제 실행 및 확인으로 연결한다.

**Architecture:** 기존 설치 plan/apply/doctor와 journal, 기관 준비 응답과 연결 상태 API를 재사용한다. 로컬 설치 도구, 외부 코딩 에이전트와 Cloud 화면이 같은 단계 계약을 사용하되 권한은 합치지 않는다. LLM은 설명과 안전한 질문을 담당하며 실제 변경과 완료 판정은 결정론 코드와 기존 실행 도구가 맡는다.

**Tech Stack:** 현재 Node ESM 스크립트, TypeScript 공통 계약과 HTTP/core, React PWA, 기존 Supabase 설치 도구, 기존 Local 설치 및 암호화 어댑터. 새 에이전트 프레임워크나 UI 라이브러리를 추가하지 않는다.

**Spec:** [승인된 온보딩 설계](../specs/2026-09-13-relayer-onboarding-design.md), [ADR-0050 / D91](../../adr/0050-relayer-assisted-onboarding.md)

## Global Constraints

- 기반은 `origin/main@ad218e8eafa646a524674fe4ef8cf9c20c0b68bb`다. 여섯 제품 결정은 이미 승인됐다. 다시 인터뷰하지 않는다.
- 명칭은 `relayer`다. 기존 `ccc` 패키지, 환경변수, protocol/artifact identity와 운영 주소를 전역 치환하지 않는다. 공개 도구 이름을 연결할 때 소비자를 함께 전환한다.
- Cloud는 기관 소유 Supabase 서울 저장소와 독립 업무 API다. 사용자 PC에서 필요할 때만 설치 도구를 실행하며 상주 설치 관리 프로그램을 만들지 않는다.
- 단계 묶음마다 승인한다. 자유 질문이 실행 권한, 승인 또는 완료 상태를 만들지 않는다.
- 비밀값, 전체 환경변수, 원문 로그와 상담 자료는 LLM에 보내지 않는다. 자유 입력의 안전 처리 실패는 외부 전송 0건이다.
- STT 기본 `off`, 미승인 `sttEngine=null`, 무자동전환, 사업 도입 확인과 당사자 동의를 유지한다.
- main D89의 Cloud MFA 선택과 D90의 초대 수락 신원 결속을 유지한다. 제거된 `POST /identity/link`를 복원하지 않는다.
- `apps/client`는 frontend, 공용 UI/CSS/토큰과 시안은 DESIGN 소유다. 기존 설치기, core/HTTP/contracts, root package/lockfile과 release 연결에는 작성 슬롯을 먼저 정한다.
- 이 레인의 첫 독립 작성 범위는 신규 `scripts/onboarding/**`와 온보딩 문서다. 공유 파일 때문에 막힌 부분은 소유자에게 인계하고 독립 작업은 계속한다.
- 실제 외부 자원 생성, 결제, 관리자 권한, 운영 데이터, 배포와 AI/STT 활성화는 별도 실행 승인이 필요하다. 합성 검사로 실제 설치 성공을 주장하지 않는다.
- Local Single의 정식 목표는 Windows 11 x64, 암호화 SQLite와 `127.0.0.1`이다. 로컬 Supabase 점검을 Local Single 구현으로 대신하지 않는다.

## 준비와 검증 명령

Node `>=22`와 `pnpm@11.5.3`을 사용한다. 의존성이 없을 때만 첫 명령으로 설치하며, 설치 스크립트를 실행하기 전에 두 번째 명령으로 검증 모듈을 빌드한다.

```bash
pnpm install --frozen-lockfile
pnpm --filter @ccc/community-cloud run build
```

두 번째 명령은 기존 설치 스크립트가 가져오는 `apps/community-cloud/dist/install-manifest-verifier.js`를 만든다. 이를 누락한 모듈 오류를 설치 로직 오류로 오인하지 않는다. `apps/client/build`는 추적되는 소스가 있으므로 생성물로 보고 삭제하지 않는다.

기존 관련 검사는 다음과 같다. 수정이 멈춘 뒤 해당 범위만 실행하고 프로젝트 전체 검사는 통합 시 한 번 수행한다.

```bash
node --test scripts/supabase/plan.test.mjs scripts/supabase/install-authorization.test.mjs scripts/supabase/install-journal.test.mjs scripts/supabase/first-admin.test.mjs scripts/supabase/institution.test.mjs
pnpm --filter @ccc/client run test -- src/business/institution.test.ts src/business/settings.test.ts
node scripts/guard-doc-numbers.mjs
```

## 공통 인계 형식

N01의 실행 정본은 `scripts/onboarding/flow.mjs`다. 아래 타입 표기는 그 모듈과 후속 작업의 설계 계약이며 공개 HTTP API나 TypeScript export가 아니다. 후속 작업은 이 모듈을 소비하고, HTTP/클라이언트 공용 타입을 연결할 때 contracts 소유자와 함께 단일 정의로 옮긴다. 같은 enum과 검증기를 두 벌 유지하지 않는다.

```ts
type StageId =
  | 'environment' | 'cloud-resources' | 'installation' | 'first-admin'
  | 'institution' | 'llm' | 'stt' | 'storage';
type StageStatus = 'needs_input' | 'needs_approval' | 'running' | 'verified' | 'blocked';
type StageBinding = {
  mode: 'community-cloud' | 'local-single' | 'local-office';
  stageId: StageId;
  targetSha256: string;
  desiredSha256: string;
  observedSha256: string;
};
type SetupCheck = { name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN'; code: string };
type OnboardingView = {
  schemaVersion: 1;
  mode: StageBinding['mode'];
  stageId: StageId;
  status: StageStatus;
  checks: SetupCheck[];
  questionId: string | null;
  canAsk: boolean;
};
```

`questionId`, 검사 이름과 code는 구현한 목록만 받는다. 알 수 없는 키, 임의 명령, URL과 SQL을 담는 `parameters: Record<string, unknown>` 확장 슬롯을 만들지 않는다. secret 참조와 실제 설치 대상은 PC의 비공개 입력이고 공개 view에 싣지 않는다.

단계 해시 비교는 **승인의 내용 결합 검사**일 뿐 서명, 사용자 권한과 S11 설치 승인 검증을 대신하지 않는다. 승인된 변경과 현재 관찰을 비교한 뒤에 실제 실행 경계가 유효한 권한을 다시 검사한다.

N01의 `canAsk`는 고정 도움을 요청할 수 있다는 뜻이다. 안전한 자유 질문이나 외부 모델 연결을 뜻하지 않는다. `viewFromSupabaseResult`는 신뢰된 기존 plan/doctor 결과를 공개 안내로 변환하는 함수이며, 안내 CLI가 실제 설치 검사를 실행하거나 해당 결과를 관찰했다는 뜻도 아니다.

## 작업 순서

N01 → N02 → N03이 Cloud의 첫 완주다. N04는 N01과 설치 대상이 확보된 뒤 인계 계약을 연결한다. N05/N06은 해당 연결과 core/HTTP 소유 슬롯을 받아 진행한다. N07은 기존 Local runtime과 정식 설치물에 의존한다. N08은 실제 계약이 준비된 화면만 frontend/DESIGN에 인계한다. N09에서 전체 흐름을 확인한다. Local 선행 작업이 막혀도 Cloud 작업을 중지하거나 Local을 완료 처리하지 않는다.

#### Linear 실행 티켓

번호의 숫자 순서가 아니라 아래 계획 순서와 Linear의 `blocks`를 따른다. 상태와 완료 이력은 이 표에 복제하지 않는다. N08은 frontend 인계와 DESIGN 인계를 별도 세션으로 나눴다.

| 계획 | 티켓 | 직접 선행 |
|---|---|---|
| N01 | [CCC-277: relayer 온보딩 계약과 안내 CLI 확정](https://linear.app/bss-ccc/issue/CCC-277) | 없음 |
| N02 | [CCC-279: 신규 Cloud 자원을 기존 설치기에 연결](https://linear.app/bss-ccc/issue/CCC-279) | N01 |
| N03 | [CCC-276: 최초 관리자 초대와 첫 로그인을 연결](https://linear.app/bss-ccc/issue/CCC-276) | N02 |
| N04 | [CCC-278: PC 도구와 Cloud의 일시적 설정 연결](https://linear.app/bss-ccc/issue/CCC-278) | N03 |
| N05 | [CCC-283: 안전한 자유 질문과 단계 복귀](https://linear.app/bss-ccc/issue/CCC-283) | N04 |
| N06 | [CCC-281: AI, STT, DB 연결 설정과 준비 상태 연동](https://linear.app/bss-ccc/issue/CCC-281) | N04 |
| N07 | [CCC-282: Local Single과 Local Office 설치 입구 연결](https://linear.app/bss-ccc/issue/CCC-282) | N01, CCC-266, CCC-267, CCC-257, CCC-259, CCC-263 |
| N08 frontend | [CCC-280: 온보딩 API를 업무 클라이언트에 인계](https://linear.app/bss-ccc/issue/CCC-280) | N05, N06 |
| N08 DESIGN | [CCC-285: 온보딩 화면을 DESIGN 레인에 인계](https://linear.app/bss-ccc/issue/CCC-285) | N08 frontend |
| N09 | [CCC-284: 전체 온보딩 통합 검증과 설치 안내 확정](https://linear.app/bss-ccc/issue/CCC-284) | N07, N08 DESIGN |

N07의 외부 선행은 Single service/NSIS와 Office service/client/server 설치물이다. 준비된 Cloud 화면의 인계를 N07 때문에 막지 않되, N08에서 미준비 Local 경로는 계속 잠그고 전체 설치 검증은 N09에서 따로 확인한다.

### N01. 모델 없이 작동하는 단계 안내와 승인 결합

**Files:** 신규 `scripts/onboarding/flow.mjs`, `scripts/onboarding/flow.test.mjs`, `scripts/onboarding/cli.mjs`. 읽기 재사용: `scripts/supabase/bootstrap.mjs`, `plan.mjs`, `report.mjs`.

**Consumes:** 기존 plan/doctor의 고정 실패 코드, 검사 상태와 지문. `--format json`은 기존 CLI 형식이며 `--json`은 doctor/report에만 열려 있다.

**Produces:** `OnboardingView`, 단계별 질문 목록, `assertSameApprovedStage(approved, planned, observed)`와 실행 전 결합 검사. 새 도구의 실제 입구는 개발 중 `node scripts/onboarding/cli.mjs`, 출고 때의 도구 이름은 `relayer`다.

- [ ] 기존 오류와 복구 문구를 현재 설치 단계에 대응한다. 모르는 code는 성공으로 바꾸지 않고 차단한다.
- [ ] 다음 보안 경계 회귀를 먼저 작성한다. 이는 해시 결합만 검사하며 유효한 실행 권한을 만드는 테스트가 아니다.

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSameApprovedStage } from './flow.mjs';

test('관찰한 설치 상태가 바뀌면 이전 승인을 쓸 수 없다', () => {
  const binding = {
    mode: 'community-cloud', stageId: 'installation',
    targetSha256: 'a'.repeat(64), desiredSha256: 'b'.repeat(64),
    observedSha256: 'c'.repeat(64),
  };
  assert.throws(() => assertSameApprovedStage(binding, binding, {
    ...binding, observedSha256: 'd'.repeat(64),
  }), { code: 'PLAN_STATE_CHANGED' });
});
```

- [ ] 같은 대상, 단계, 모드, 원하는 설정과 관찰 해시를 비교한다. 어느 필드든 변경되면 이전 승인을 소비하지 않는다. 결합 검사를 통과해도 실제 실행에는 별도의 권한/서명 검증이 필요하다.
- [ ] CLI의 도움말, 모드 선택, 자격 없는 초기 안내를 구현한다. 무자격 사용자는 질문과 `needs_input`을 받아야 하며 외부 write가 없어야 한다. 빈 환경이나 빈 결과를 이미 설치된 것으로 해석하지 않는다.
- [ ] `node --test scripts/onboarding/flow.test.mjs`로 경계를 확인하고, 실제 CLI를 열어 입력 → 계획 안내 → 취소 → 종료를 직접 실행한다. LLM 호출은 0건이다.

**완료:** 새 세션이 비밀값 없이 실제 CLI를 실행해 다음 필요한 입력과 차단 이유를 볼 수 있다. 이 작업만으로 전체 온보딩 완료를 보고하지 않는다.

### N02. 신규 Cloud 자원 생성에서 기존 설치기로 연결

**Files:** 신규 `scripts/onboarding/cloud.mjs`, 대응 계약 검사. 기존 `scripts/supabase/{bootstrap,manifest-preflight,apply,provider-steps,install-journal}.mjs`는 설치 담당자의 슬롯에서만 수정한다.

**Consumes:** N01 단계 결합, 설치 대상에 대해 승인된 공급자/리전/요금 구성, 승인된 자격 공급 경로. **Produces:** 생성 자원의 소유권 증거와 기존 S11 설치 승인/공개 manifest에 연결할 대상 정보, 실제 검사 결과.

- [ ] 계정 로그인과 공급자 승인 정보를 검사한다. 공급자나 리전, 요금 구성을 추정하지 않는다. 서비스별 Portwright 절차와 공식 API를 확인한 뒤 해당 공급자의 실제 생성 경로를 구현한다.
- [ ] 신규 자원 생성 전에 계정, 소유 기관, 자원 수와 과금 구성이 포함된 단계 요약을 보여준다. 사용자 승인 없이는 생성 API를 호출하지 않는다.
- [ ] 생성 응답을 잃은 경우 소유권/요청 식별로 관찰하고 재개한다. 다른 소유 자원, 기존 업무 데이터와 출처 불명 자원은 덮어쓰지 않는다.
- [ ] 생성한 대상에 대해 공개 manifest와 설치 승인을 결합한다. `requireSignedOwnerPreflight`, `buildSupabasePlan`, `withInstallLock`, `applyInstallation`과 기존 journal을 재사용한다. 별도 SQL 설치기를 만들지 않는다.
- [ ] 기존 plan의 첫 읽기 전용 검사와 적용 직전 지문 재검증을 유지한다. 현재 main의 `api_credential` 단계, StorageSigner의 온라인 권한 확인과 scheduler 계약을 옛 문서로 되돌리지 않는다.
- [ ] 취소, 잘못된 소유자, 응답 유실 뒤 재개, 계획 변경을 각각 검사한다. 외부 write 횟수와 최종 자원 소유를 단언하고, 합성 API 검사를 실제 Cloud 생성 증거와 구분한다.

**완료:** 별도 승인을 받은 비민감 시험 설치에서 신규 자원 생성 → S11 plan/apply → 실제 health까지 이어지고, 중단 재개로 중복 자원을 만들지 않는다. 실제 시험 자격이 없으면 해당 검증만 차단 상태로 남긴다.

#### N02 개발 명령과 입력

개발 진입점은 `node scripts/onboarding/cloud.mjs`다. `plan`은 생성 전 계정과 소유권 및 과금 구성을 읽고, `create`는 요약 뒤 `이대로 생성` 입력을 받아야 요청을 보낸다. `resume`는 생성 기록이 있는 요청만 관찰하며 POST를 다시 보내지 않는다. `install-plan`, `install`, `doctor`는 생성 대상의 별도 S11 승인을 확인한 뒤 기존 설치기를 호출한다. `install`도 요약 뒤 `이대로 설치` 승인을 따로 받는다. 인자에는 비밀값을 넣지 않는다.

| 환경변수 | 입력 계약 |
|---|---|
| `CCC_ONBOARDING_REQUEST` | JSON 객체. `schemaVersion: 1`, UUID `requestId`, 승인된 `institutionId`, `accountSha256`, `ownerOrgId`, `ownerOrgSlug`, `region: ap-northeast-2`, `plan: pro`, `instanceSize: micro`, 정수 `monthlyEstimateUsdCents`만 받는다. 비용은 USD 센트 단위의 예상치이며 결제 상한이 아니다. |
| `CCC_ONBOARDING_JOURNAL` | 이미 존재하는 기관 소유 비공개 디렉터리 안의 생성 기록 경로다. 디렉터리는 현재 OS 사용자 소유의 `0700`, 기록은 `0600`이며 요청과 승인 및 자원 식별자의 해시만 저장한다. 경로도 승인에 결합한다. |
| `SUPABASE_ACCESS_TOKEN` | 승인된 경로에서 현재 프로세스에만 주입한다. 계정과 조직 조회가 가능하다는 사실을 생성 승인으로 취급하지 않는다. |
| `CCC_ONBOARDING_DATABASE_PASSWORD` | 새 시험 DB만을 위한 16~256자 비밀값이다. 생성 POST에만 사용하고 출력이나 생성 기록에 저장하지 않는다. 기존 업무 DB 자격을 재사용하지 않는다. |
| `CCC_ONBOARDING_INSTALLATION` | `projectRef`와 선택적인 `installManifest`, `installApproval`, `manifestUrl`만 받는 JSON이다. manifest와 승인 문서는 기존 S11 입력과 같은 JSON 문자열 또는 로컬 파일 경로다. 서명과 신뢰 설정 및 설치 자격은 기존 주입 경로가 별도로 공급한다. |

`CCC_ONBOARDING_REQUEST`는 위 열 개 키만 받는다. `requestId`는 소문자 UUID, `accountSha256`은
Management API `/v1/profile`의 `gotrue_id` UTF-8 SHA-256이다. `institutionId`, `ownerOrgId`,
`ownerOrgSlug`는 영숫자로 시작하는 1~128자 영숫자, `_`, `-` 식별자다. `ownerOrgId`와
`ownerOrgSlug`는 같은 Supabase 기관을 가리켜야 하고 현재 계정은 그 기관의 owner 또는 administrator여야
한다. 도구가 live 응답으로 전부 다시 대조하므로 입력 자체는 권한 근거가 아니다.
`monthlyEstimateUsdCents`는 승인된 과금 검토에서 가져온 0 이상의 safe integer이고 안내에만 쓰며 결제
상한을 만들지 않는다.

설치 명령의 공통 입력은 request, journal 경로, `SUPABASE_ACCESS_TOKEN`, 필수 `projectRef`,
`CCC_ORGANIZATION_ID`, `CCC_INSTALL_SIGNING_KEYS`, 선택적인 `CCC_INSTALL_REVOKED_KEY_IDS`,
`CCC_BETA_TRUST_ROOT_KEYS`, 선택적인 `CCC_BETA_REVOKED_ROOT_KEY_IDS`,
`CCC_BETA_RELEASE_TRUST`, `CCC_PROVIDER_BASELINE`이다. manifest와 approval은 installation 객체의
`installManifest`, `installApproval`을 먼저 쓰고, 없으면 `CCC_INSTALL_MANIFEST`,
`CCC_INSTALL_APPROVAL`을 쓴다. 두 문서, beta release trust, provider baseline과
`CCC_RELEASE_TRUST_STORE`는 JSON 문자열 또는 로컬 파일 경로다. 공개키 map과 revoked ID 배열은 JSON
문자열이다.

| 명령 | 추가 필수 입력 |
|---|---|
| `plan` | request, journal 경로, `SUPABASE_ACCESS_TOKEN` |
| `create` | `plan` 입력과 첫 생성 때만 쓰는 `CCC_ONBOARDING_DATABASE_PASSWORD` |
| `resume` | request, 기존 journal, token. password를 읽거나 POST를 다시 보내지 않는다 |
| `install-plan` | 설치 공통 입력, installation의 release `manifestUrl`, `CCC_RELEASE_TRUST_STORE`, `SCHEDULER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CCC_API_DATABASE_PASSWORD` |
| `install` | `install-plan` 입력과 `CCC_INSTALL_DATABASE_URL`. 추가 CA가 필요하면 `CCC_DATABASE_CA_FILE`을 지정하고 `apps/community-cloud/with-ca.sh`로 실행한다 |
| `doctor` | 설치 공통 입력과 완료 릴리스 검증용 `CCC_RELEASE_TRUST_STORE` |

`projectRef`는 `resume`이 확인한 `relayer-${requestId}` 단일 자원의 ID다. 생성 journal에는 원문 대신
그 SHA-256만 남기며, 설치 전 `verifyCreatedInstallation`이 요청 기관, 공급자 소유 기관과 projectRef를
서명 승인서에 다시 결합한다.

| 관찰 상태 | 허용하는 다음 행동 |
|---|---|
| 생성 요청 제출 뒤 결과 불명 | 같은 request와 journal로 `resume`. 조회에 없으면 `CLOUD_CREATION_OUTCOME_UNKNOWN`에서 멈춘다 |
| 생성 자원 관찰 완료 | 별도 signed pair와 S11 입력을 준비해 `install-plan` |
| 설치 journal이 중단 상태 | `doctor`로만 관찰하고 `BACKUP_FAILED`에서 복구 담당자에게 넘긴다. `install` 재실행이나 journal 삭제로 우회하지 않는다 |
| 설치 완료 | `doctor`로 검증한다. 같은 대상의 `install` 재실행은 `BACKUP_FAILED`다 |

생성 요청의 제출 기록을 완성하고 fsync한 뒤 독점적으로 게시한 호출 하나만 전송한다. 제출 기록이 생긴 뒤 중단됐으면 실제로 POST가 시작되지 않았을 가능성도 포함해 결과 불명으로 취급한다. 프로젝트가 아직 조회되지 않아도 기록을 지우거나 새 요청으로 자동 전환하지 않는다. 재개는 요청 이름과 승인된 소유 기관을 대조하며 이미 관찰한 자원 ID의 해시가 바뀌면 거부한다. 파일 보호와 원자적 게시를 지원하지 않는 환경은 거부하며, 현재 OS에서의 검사만으로 Windows 보호를 검증했다고 보고하지 않는다.

설치 승인은 현재 상태 지문뿐 아니라 별도로 검증한 공개 manifest와 S11 승인 문서의 해시, 선택한 서명 릴리스의 해시에 결합한다. 적용 시 다시 읽은 문서나 릴리스가 바뀌면 설치 연결 전에 거부한다. 기존 `BACKUP_FAILED` 중단 설치 재개 관문을 우회하지 않는다.

이 명령은 Supabase의 신규 프로젝트 생성과 S11 연결 경계다. Pro 결제 전환, ACA 자원 생성과 업무 API 배포는 실행하지 않는다. 그 구성과 실행 승인을 별도로 확정해야 하며, 합성 생성 검사나 읽기 전용 계정 조회를 N02의 실제 설치 완료 증거로 삼지 않는다. 실제 자원 사용 승인이 없으면 위 완료 조건은 계속 미완료다.

실제 완료에는 별도 승인으로 만든 업무 runtime이 signed manifest의 `apiBase`에서 실행돼야 한다.
runtime은 제한된 `ccc_api` 연결, manifest, 공개 서명키, scheduler 비밀값, PII 암호화 키와 필요한
Supabase CA만 받는다. `doctor`는 해당 host의 `/readyz`, 설치가 배포한 StorageSigner의 인증 없는 요청
거부, 서울 리전과 `ccc_api` 비특권 상태를 함께 확인한다. runtime이나 승인이 없으면 설치 영수증만
완료된 `RUNTIME_NOT_READY`로 남기며 N02 전체를 완료 처리하지 않는다.

N02 범위 검사:

```bash
pnpm --filter @ccc/community-cloud run build
node --test scripts/onboarding/cloud.test.mjs scripts/supabase/installer-connection.test.mjs \
  scripts/supabase/provider-inventory.test.mjs scripts/supabase/provider-baseline-generate.test.mjs
node --test --test-name-pattern=N02 scripts/supabase/bootstrap.test.mjs
```

### N03. 최초 관리자 초대부터 첫 로그인까지 연결

**Files:** 신규 `scripts/onboarding/first-admin.mjs`. 기존 `scripts/supabase/first-admin.mjs`, `institution.mjs`, 클라이언트의 auth 및 초기 설정 화면은 각 소유자와 연결한다.

**Consumes:** 완료된 설치, 승인된 이메일 하나, 해당 Auth 제공자의 검증된 신원. **Produces:** 기존 `users.auth_subject`에 결합된 기관 생성자와 `InstitutionReadiness`.

- [ ] PC 설치 도구가 지정 이메일 하나로 실제 1회용 초대를 발송한다. 초대 URL, token과 원문 이메일은 모델/영수증/로그에 넣지 않는다.
- [ ] 발송, 수락, 신원 결속을 다른 사실로 다룬다. 발송 응답 유실이나 재실행에서 이미 발급 또는 수락된 초대를 관찰하고 무조건 재발송하지 않는다.
- [ ] 신원은 서명 검증된 Auth `sub`로 결속하고 이메일 일치만으로 업무 계정을 가로채지 못하게 한다. 기존 `linkFirstAdmin`의 중복/소유 검사를 재사용한다.
- [ ] 초대 만료, 다른 사용자 수락, 같은 요청 재개, 이미 있는 최초 관리자를 검사한다. 현재 D90 직원 초대 테스트도 유지하며 `POST /identity/link`를 복원하지 않는다.
- [ ] 실제 시험 이메일의 초대 수락 뒤 첫 로그인을 수행한다. Cloud MFA 선택을 유지하고, 기관 설정을 시작하기 위해 불필요한 인증 등급을 새로 강제하지 않는다.

**완료:** 수동 Auth UUID 복사 없이 최초 관리자 가입과 기관 초기 설정 입구가 이어지고, 잘못된 신원의 결속은 거부된다.

### N04. PC 도구를 열어 둔 동안만 Cloud와 인계

**Files:** 신규 `scripts/onboarding/session.mjs`. HTTP/공통 계약의 온보딩 전용 모듈과 저장 변경은 backend 작성자가 슬롯을 정해 구현한다.

**Consumes:** N01 단계 계약, 검증된 설치/기관/사용자, 현재 권한. **Produces:** 해당 실행 동안 유효한 설정 연결, 승인된 단계 요청과 검증 가능한 실행 결과. 원격 셸 API를 생산하지 않는다.

- [ ] 먼저 backend/설치 작성자와 요청 및 응답의 닫힌 형식, 만료, 대상 결합, 반복 요청 처리와 오류를 고정한다. 동일한 타입과 검증기의 사본을 만들지 않는다.
- [ ] 초기 설치 전에는 로컬 안내만 사용한다. 설치 후 연결은 사용자가 PC 도구를 직접 열었을 때만 시작하며 검증된 기관 API 외의 주소를 신뢰하지 않는다.
- [ ] 실행 허용 단계 목록을 코드가 소유한다. Cloud 요청이 임의 명령, SQL, URL, 파일 경로나 관리자 자격을 포함하면 거부한다.
- [ ] 도구 종료/인증 만료 후 새 요청을 받을 수 없게 한다. 이미 진행된 부작용은 기존 journal의 중단/관찰 경계에 남기며 강제 삭제로 복구하지 않는다.
- [ ] 다른 기관 요청, 이전 연결 재생, 승인 후 지문 변경, 종료 뒤 실행 요청을 거부하는 계약 검사를 둔다. 정상 요청에서는 결과가 같은 단계와 대상에 결합되는지 확인한다.

**완료:** 도구를 열면 설정 연결을 사용하고 닫으면 새 실행은 차단된다. 일반 Cloud 수기 업무는 계속된다. 설치 관리 서비스나 처리 Agent 권한의 확대는 없다.

### N05. 안전한 자유 질문과 현재 단계 복귀

**Files:** 신규 `scripts/onboarding/assistant.mjs` 또는 N04에서 합의한 온보딩 전용 실행 모듈. 기존 `packages/ai-runtime` 및 가림 기능은 해당 작성자와 재사용한다.

**Consumes:** 현재 `OnboardingView`, 허용된 설정 상태와 안전 처리가 끝난 질문. **Produces:** 설명 또는 허용된 단계 변경 제안. 실행 결과나 권한을 생산하지 않는다.

- [ ] 외부 전송의 exact field 목록과 거부 조건을 코드로 고정한다. 전체 context, process.env, 원문 로그를 요청에 붙이지 않는다.
- [ ] 자유 입력은 검증된 전송 전 처리 경로를 통과시킨다. 경로가 없거나 실패하면 원문을 전송하지 않고 고정 안내를 제공한다. 설정 도우미를 상담 AI Packet의 우회 경로로 사용하지 않는다.
- [ ] OpenAI 연결 전과 장애 후에는 고정 안내를 유지한다. 다른 제공자로 자동 전환하지 않는다.
- [ ] 자유 질문을 하는 동안 현재 입력과 단계가 유지되게 한다. 설정 변경 제안은 승인 요약으로 돌려보내며 자동 적용하지 않는다.
- [ ] 합성 비밀값과 개인정보를 넣어 전송 경계 및 로그에 원문이 없는지 검사한다. 악성 도구 지시를 질문에 넣어도 단계 실행이 발생하지 않아야 한다.
- [ ] 별도 승인된 비민감 모델 호출에서 질문 → 답변 → 기존 단계 복귀를 확인한다. 합성/모델 대역 검사를 실제 LLM 성공으로 보고하지 않는다.

**완료:** 안전 처리가 준비된 정상 경로에서는 자유 질문이 실제로 작동하고, 미준비/장애에서는 원문 전송 없이 안내가 이어진다. 구조화된 안내만 구현하고 자유 질문 전체를 완료 처리하지 않는다.

### N06. AI/STT/DB 재설정과 업무 준비 연결

**Files:** 신규 `scripts/onboarding/connections.mjs`. 기존 `packages/core/src/gateway.ts`, `packages/http-api/src/{capabilities,request-handler}.ts`, `packages/contracts/src/{institution,program-admission,capabilities}.ts`는 backend 작성자가 소유한다.

**Consumes:** `InstitutionReadiness`, `GET /capabilities`, `GET /ai/provider/status`, 기존 AI activation과 Agent readiness. **Produces:** 연결 검사, 필요한 변경 계획과 실제 적용 뒤 관찰된 준비 상태.

- [ ] 현재 단계별 쓰기 경로를 대조한다. `POST /ai/provider/activate-runtime`은 배포된 설정의 등록/활성화이지 임의 API 키나 설치 정책을 저장하는 엔드포인트가 아니다.
- [ ] 비밀값의 안전한 공급, 제공자 검사, 설치 정책 변경과 활성화를 분리한다. 설치 정책 writer가 없으면 backend에서 정확한 권한, expectedVersion과 감사 계약을 먼저 구현한다.
- [ ] 변경할 설정과 진행 중 일감의 영향, 다시 확인해야 할 사업을 승인 전에 보여준다. 미승인 엔진이나 동의 없는 경로를 화면만 켜지게 하지 않는다.
- [ ] DB 연결 점검/복구와 저장 위치 이전을 다른 경로로 분리한다. 이전은 기존 암호화 백업, 복원과 `.cccx` 계약을 따르며 일반 연결 폼이 임의 DB 교체를 수행하지 않는다.
- [ ] 키 연결 성공/AI 사용 불가, Agent 미준비, 미승인 STT, 사업 재확인, 동의 거부, 변경 경쟁을 각각 검사한다.

**완료:** 저장된 설정과 실제 사용 가능 여부가 일치하고, AI를 끈 상태에서도 준비된 수기 업무는 열린다. 기술 준비 실패와 기관의 사용 미승인을 구별한다.

### N07. Local Single과 Office의 실제 설치 입구 연결

**Files:** 신규 `scripts/onboarding/local.mjs`와 설치 안내. Local 실행/설치 소유자의 실제 진입점 및 release bundle, client install discovery와 연결한다.

**Consumes:** 검증된 S4/S12 Local 실행기와 서명 설치물, S9 복구 및 키 계약. **Produces:** 모드별 질문과 실제 설치/연결/준비 결과.

- [ ] 기존 E7/E8 담당자가 가진 실제 local-service, Electron/NSIS 설치기와 실행 증거를 먼저 받는다. `scripts/supabase/local-inspector.mjs`는 이 입력이 아니다.
- [ ] 운영체제와 기존 설치를 확인하고 지원되지 않는 환경에서 정식 설치를 진행하지 않는다. 기존 데이터와 복구 자료를 보존한다.
- [ ] 저장소를 받은 코딩 에이전트가 같은 설치 명령을 사용하게 한다. relayer 내부 LLM 연결을 이 절차의 선행으로 요구하지 않는다.
- [ ] Single은 암호화 SQLite, OS 사용자/앱 잠금, loopback과 실제 클라이언트 접속을 확인한다. Office는 서버/클라이언트, 내부망 HTTPS와 계정/복구 차이를 적용한다.
- [ ] Local client rejection은 실제 실행 경로와 인증 계약이 연결된 뒤 frontend에서 전환한다. 거부만 제거하거나 평문 SQLite로 우회하지 않는다.

**완료:** 깨끗한 지원 Windows에서 실제 설치와 첫 사용을 완주한다. Local 선행 설치기가 없으면 해당 수용 기준은 해당 E 티켓에 의존하는 미완료로 명시하고, 이 레인에서 임의의 대체 제품을 만들지 않는다.

### N08. 기존 화면에 안내와 대화를 연결

**Files:** frontend 소유 `apps/client/src/screens/{institution,settings}.tsx`, `business/{institution,settings-modules,navigation}.ts*`, 관련 신규 온보딩 UI. 공용 wire/CSS는 DESIGN에 인계한다.

**Consumes:** 앞 단계에서 검증된 실제 API, 거부 코드, 상태와 권한. **Produces:** 처음 설치 후 기관 준비와 기존 `연결 상태` 안에서 이어지는 설정 경험.

- [ ] frontend 레인이 각 메서드, 응답, 헤더, 입력 상한과 오류를 직접 확인한다. 아직 없는 계약에 성공 화면을 붙이지 않는다.
- [ ] 기존 `연결 상태`를 확장하고 별도 AI 설정 페이지를 병설하지 않는다. 단계, 현재 질문/입력, 승인 요약, 실행 결과와 자유 질문을 한 흐름으로 연결한다.
- [ ] 지나온 단계만 돌아갈 수 있는 `WireSteps`와 기존 공용 부품을 사용한다. 비밀값 입력은 채팅과 분리하고 접근성 이름과 키보드 동작을 보존한다.
- [ ] DESIGN 인계는 목표, 파일/URL, API, 거부/상태, 문구, 적용 규칙, 렌더 수용 기준, 제외/선행 소유자의 여덟 항목을 채운 파일로 전달한다.
- [ ] 실제 브라우저에서 질문 중단/복귀, 변경 취소, 실패/재개, LLM 꺼짐, 도구 미연결과 단계 이동을 확인한다. 390px과 데스크톱, 라이트/다크의 기능 상태를 확인하고 실제 연결 검증과 합성 렌더를 구분한다.

**완료:** 소유 레인에서 실제 화면과 실행 계약을 함께 검증한 인계를 받는다. 온보딩 워크트리가 잠긴 화면 코드를 직접 수정하지 않는다.

### N09. 통합 검증과 사용자 설치 안내

**Files:** 실제 설치 안내, 기존 release/설치 문서와 온보딩 회귀. 새 실행 상태 파일을 루트에 만들지 않는다.

- [ ] Cloud 신규 설치, 기존 설치 재개, 최초 관리자, 기관 초기 설정, AI 없는 수기 시작, 설정 변경을 실제 표면에서 확인한다.
- [ ] Local Single과 Office의 자기 범위 설치 증거를 연결한다. 미승인 STT, 개인정보 관문과 별도 자원 사용 승인이 없는 시험은 성공으로 바꾸지 않는다.
- [ ] 사용자 문서에는 실제로 존재하고 검증된 `relayer` 명령만 싣는다. 필요한 human-only 동의, 고정 복구 안내, 비밀값 비노출과 도구 종료를 설명한다.
- [ ] 변경된 공개 이름/인터페이스는 모든 소비자를 함께 전환하고 장기 호환 별칭을 남기지 않는다. 설치 artifact/protocol 식별자는 별도 버전 계약 없이는 개명하지 않는다.
- [ ] 관련 검사와 실제 smoke가 끝난 뒤 임시 검증 파일을 정리하고, 구현 결과는 커밋과 실행 티켓에 남긴다. push/PR/merge/배포는 별도 지시를 따른다.

**완료:** 설계의 아홉 수용 기준에 각각 실제 증거 또는 정확한 외부 관문이 연결된다. 스크립트가 실행됐다는 사실, 단위 검사와 합성 렌더를 전체 설치 성공으로 묶지 않는다.

## 매 세션의 정확한 시작점

[핸드오프](2026-09-13-relayer-onboarding-handoff.md)를 읽고 배정된 티켓, 현재 커밋과 미커밋 변경, 해당 티켓의 선행 조건부터 확인한다. N01의 기존 코드를 새로 만들지 않는다. N01 완료 뒤의 다음 구현은 별도 세션의 N02다. 승인된 여섯 제품 결정을 재질문하지 않으며, 새로운 권한/데이터 경계 또는 잠긴 파일 소유권을 바꿔야 하는 경우에만 해당 지점에서 확인받는다. 실제 외부 시험 승인이 없으면 그 관문을 완료로 표시하지 않는다.
