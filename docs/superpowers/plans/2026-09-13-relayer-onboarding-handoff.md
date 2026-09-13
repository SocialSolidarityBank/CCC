# relayer 온보딩 새 세션 핸드오프

## 여기서 시작한다

이 문서는 이전 대화를 읽지 않은 새 구현 세션을 위한 시작 지시다. 작업은 **relayer 온보딩**이며 진행 중인 베타 오케스트레이터 작업을 인수하는 것이 아니다.

| 항목 | 값 |
|---|---|
| 워크트리 | `/Users/seongqkim/DEVELOPER/PROJECTS/CCC-new/.worktrees/onboarding` |
| 브랜치 | `feat/relayer-onboarding` |
| 생성 기준 | fetch로 확인한 `origin/main@ad218e8eafa646a524674fe4ef8cf9c20c0b68bb` |
| 기준 커밋 제목 | `초대 수락이 계정을 결속한다 (D90) (#334)` |
| 결정 | ADR-0050 / D91 |
| 실행 단위 | 한 구현 세션에서 배정된 Linear 티켓 하나만 처리한다. 티켓 색인은 [구현 계획](2026-09-13-relayer-onboarding-implementation.md)의 "Linear 실행 티켓"에 있다 |
| 구현 경계 | N01의 안내 전용 CLI, 단계 모델과 승인 내용 결합은 `scripts/onboarding/`에 있다. 실제 설치, 외부 자원 생성, 자유 질문과 설정 실행은 후속 티켓 범위다 |

## 먼저 읽을 순서

1. 이 워크트리의 `CLAUDE.md`, 특히 D89/D90/D91과 온보딩 작업 레인. 현재 사용자/global 소유권 잠금도 따른다.
2. [ADR-0050](../../adr/0050-relayer-assisted-onboarding.md)
3. [승인된 전체 설계](../specs/2026-09-13-relayer-onboarding-design.md)
4. [구현 계획](2026-09-13-relayer-onboarding-implementation.md)
5. `CONTEXT.md`의 relayer, 온보딩, 설정 도우미, 설치 도구.

이 다섯 파일에 이번 그릴링 결과를 옮겼다. 이전 세션의 `local://` 문서나 채팅 복원을 요구하지 않는다.

## 이미 확정된 결정

프로젝트와 도구 이름은 소문자 `relayer`다. Cloud는 최초 자원 생성부터 설치까지 돕고 설치 도구는 사용자 PC에서 필요할 때만 실행한다. 의미 있는 단계 묶음마다 승인받고, 자유 질문에 답한 뒤 원래 입력과 단계로 돌아온다. 상주 설치 관리 프로그램을 기본으로 만들지 않는다. Local Single은 사용자의 코딩 에이전트가 저장소의 설치 절차를 실행하는 입구를 제공한다. 상세와 안전 경계는 ADR-0050이 정본이다.

이 선택들을 다시 질문하지 않는다. 실제 외부 자원/비용/권한, 운영 데이터, 배포와 AI/STT 활성화는 별도 실행 승인이 필요하다.

## N01의 파일 경계

아래는 N01(CCC-277)의 최초 커밋 대상이다. 기존 세션이 남긴 의도된 변경을 삭제하거나 clean, reset, stash 또는 다른 브랜치 checkout으로 없애지 않는다. 이후 세션에서는 Git과 Linear에서 실제 완료 상태를 확인한다.

- 수정: `CLAUDE.md`의 이름, D91, 온보딩 구현 상태와 작업 레인
- 수정: `CONTEXT.md`의 이름과 온보딩 용어
- 신규: `docs/adr/0050-relayer-assisted-onboarding.md`
- 신규: `docs/superpowers/specs/2026-09-13-relayer-onboarding-design.md`
- 신규: `docs/superpowers/plans/2026-09-13-relayer-onboarding-implementation.md`
- 신규: 이 핸드오프
- 신규: `scripts/onboarding/flow.mjs`
- 신규: `scripts/onboarding/cli.mjs`
- 신규: `scripts/onboarding/flow.test.mjs`

N01 검증 뒤에는 이 범위만 해당 티켓 ID로 커밋한다. 완료 코멘트에 검증 결과와 커밋 SHA를 남긴 뒤 Done으로 바꾸고 세션을 종료한다. 실패나 차단이 남으면 커밋하지 않으며, 다음 티켓으로 넘어가기 위해 수용 기준을 줄이지 않는다. 이 문서에 커밋별 상태 이력을 누적하지 않는다.

## 기준 문서 충돌을 피한다

**베타 오케스트레이터의 문서를 이 워크트리에 통째로 복사하거나 그 브랜치를 병합하지 않는다.** 확인한 두 브랜치의 D89/D90이 서로 다른 결정을 가리킨다.

| 기준 | 실제 의미 | 이번 작업의 처리 |
|---|---|---|
| main D89 | Cloud MFA는 선택, `aal1`과 `aal2`를 실제 값대로 기록 | 유지한다. 첫 로그인을 TOTP 등록으로 강제하지 않는다 |
| main D90 | 일회용 직원 초대 수락과 검증된 Auth `sub`로 계정 결속, `POST /identity/link` 제거. 2026-09-14 Q 부분 개정은 Community Cloud의 `disable_signup=true`를 유지하고 신규 직원 계정을 권한 있는 Auth 초대와 `/auth/invite`로만 만든다 | `subject`가 없거나 Auth email claim이 초대 이메일과 다르면 사용자 생성, 역할 부여와 초대 소비를 모두 거부한다. 당사자 `public_signup` 정책은 바꾸지 않는다 |
| main S11 후속 개정 | `api_credential`, StorageSigner의 온라인 권한 확인, 현행 scheduler 자격과 route, 최초 관리자 연결의 현재 동작 | 현재 구현과 함께 읽는다. 오래된 S11 전체로 덮어쓰지 않는다 |
| 오케스트레이터 ADR-0048 | 독립 Cloud 실행과 최초 관리자 초대. 그 브랜치에서는 D89라고 부른다 | 필요한 온보딩 요구는 ADR-0050에 반영했다. 구 D번호나 MFA 강제 문장을 복사하지 않는다 |
| 오케스트레이터 ADR-0049 | 카드 계약과 AI 모듈 기준. 그 브랜치에서는 D90이라고 부른다 | 다른 베타 작업이다. 온보딩에서 적용하거나 번호를 고치지 않는다 |

2026-09-14 부분 개정은 정책과 구현 계약만 승인했다. 실제 Auth 설정 변경, 시크릿 저장이나 주입, 초대 발송과 배포는 승인하지 않았다. `/auth/invite`는 installed `@supabase/auth-js@2.116.0`의 implicit session 입력을 좁혀 success key `access_token`, `refresh_token`, `expires_in`, 선택적인 `expires_at`, `token_type`, `type`과 error key `error`, `error_code`, `error_description`만 받는다. `token_type=bearer`, `type=invite`를 요구하며 두 집합의 혼합, unknown key, provider token, PKCE와 OTP 전용 key를 거부한다. N03은 In Review이고 N04 구현과 WORKER `/new`는 보류한다.

조사 시점 오케스트레이터의 정확한 commit은 `01e68d70fa7f6e6afe6984edab1bb4f9d3aeda7c`다. 필요하면 작업 폴더를 바꾸지 않고 Git object로 근거만 읽는다.

```bash
git show 01e68d70fa7f6e6afe6984edab1bb4f9d3aeda7c:docs/adr/0048-independent-cloud-api-runtime.md
```

현재 main의 S2에도 과거 MFA 강제 표와 최신 선택 개정이 함께 있다. 더 나중의 명시적 개정과 D89를 따른다. 관련 의미만 정합화하고 인증 동작을 새로 바꾸지 않는다. 병합 전 ADR/D 번호 가드를 다시 실행하며, 다른 브랜치가 0050/D91을 먼저 사용했다면 뒤에 통합하는 쪽이 파일명과 참조를 함께 재배정한다.

## 파일 소유권

- 이 레인은 신규 `scripts/onboarding/**`와 온보딩 문서에서 독립 구현을 시작한다.
- 기존 `scripts/supabase/**`, core/HTTP/contracts, root package/lockfile과 release 조립은 기존 작성자와 슬롯을 정한 뒤 변경한다. 기능 이름이 달라도 같은 파일을 동시에 수정하지 않는다.
- `apps/client`는 `.worktrees/frontend` 소유다. 현재 관찰한 브랜치는 `client/relayer-domain-beta`이며 같은 `institution`/`settings` 파일을 쓰는 베타 작업이 있다. 스냅샷일 뿐 현재 활동을 추정하지 말고 인계 시 소유자와 확인한다.
- 공유 UI, CSS, 디자인 토큰과 시안은 `.worktrees/DESIGN` 소유다. 온보딩 워크트리 생성은 디자인 잠금의 예외가 아니다. 화면은 frontend가 API를 확인한 뒤 DESIGN에 필요한 변경을 인계한다.
- 기존 `.worktrees/beta-0.9-orchestrator`의 브랜치와 `artifacts/relayer-landing/`, 다른 워크트리와 실행 세션을 건드리지 않는다.
- 안내 CLI가 있다는 이유로 기존 화면과 통합 소스를 임의로 삭제하거나 정리하지 않는다.

## 실행 준비와 첫 작업

현재 작업 위치와 기존 문서 및 코드 변경부터 확인한다. 예상하지 못한 변경이 추가로 있으면 소유를 확인하고 보존한다.

```bash
git branch --show-current
git status --short
```

브랜치는 `feat/relayer-onboarding`이어야 한다. 기존 변경을 보존한 채 이 기준에서 이어가며, 더 최신 main이 생겨도 자동 reset/rebase하지 않는다.

repo는 `pnpm@11.5.3`, Node `>=22`를 명시한다. 의존성이 없을 때만 `pnpm install --frozen-lockfile`을 실행한다. N01의 커밋 직전 최소 검증은 다음 네 명령이다. 다른 티켓의 검사나 프로젝트 전체 검사를 대신 실행하지 않는다.

```bash
pnpm --filter @ccc/community-cloud run build
node --test scripts/onboarding/flow.test.mjs
printf '1\nplan\ncancel\nexit\n' | node scripts/onboarding/cli.mjs
node scripts/guard-doc-numbers.mjs
```

설치 스크립트 일부는 위 build가 만드는 `apps/community-cloud/dist/install-manifest-verifier.js`를 import한다. `apps/client/build`에는 추적되는 빌드 소스가 있으므로 폴더 이름만 보고 지우지 않는다.

N01의 단계 안내와 승인 결합은 이미 구현돼 있다. 검증은 이 실제 CLI와 회귀 검사로 수행한다. 자격 없는 안내는 `needs_input`이며, `plan`은 아직 만들지 않은 실행 계획과 필요한 입력을 설명할 뿐이다. 처음부터 운영 키, 새 유료 계정이나 배포 권한을 요청하지 않는다.

## 아직 없는 것을 있다고 보고하지 않는다

- `relayer`라는 공개 실행 파일은 아직 없다. 개발 진입점 `node scripts/onboarding/cli.mjs`는 사용 방식 선택, 계획 안내, 고정 도움, 취소와 종료를 제공한다.
- N02의 신규 Cloud 생성과 설치, N03의 최초 관리자 초대 상태 기계와 결속 도구는 구현됐다. N03은 signed client의 `/auth/invite` 실화면, 직원 초대 전용 정책 구현과 실제 비민감 초대 검증이 남아 In Review다. 이 상태를 전체 온보딩 완료나 실제 초대 발송으로 보고하지 않는다.
- 현재 연결 상태 화면은 조회 중심이고 AI/STT 설치 정책 writer가 필요하다. 키 입력만으로 활성화되지 않는다.
- 현재 클라이언트는 Local Single과 Office를 명시적으로 거부한다. local-service와 서명 설치물은 E7/E8 선행 작업을 받아야 한다. 거부만 지우거나 로컬 Supabase를 대신 설치하지 않는다.
- 현재 rollback은 전제가 없으면 거부한다. 실증되지 않은 자동 복원이나 외부 자원 정리 성공을 약속하지 않는다.
- free-form 질문을 raw로 OpenAI에 보내는 구현은 승인되지 않았다. 허용 필드와 전송 전 안전 처리 경로부터 연결한다.

## 자원과 세션 인계

읽기 전용 선행 점검에서 생성 전 추가 워크트리가 전체 21개였고 권고 상한 4개를 넘었다. Q가 `폴더만 하나 추가`를 명시적으로 선택했다. 당시 여유 메모리는 44%였다. 점검 스크립트는 Claude만 세므로 출력된 세션 0개는 실제 전체 세션 수가 아니다. 별도 executable 관찰에서는 OMP 7개와 Codex 6개가 보였으며 앱 내부 세션까지 센 숫자는 아니다.

이 문서의 `WORKER`는 티켓 하나를 구현하는 pane 역할이고 `ORCHESTRATOR`는 다음 입력, 승인 경계와 세션 전환을 관리하는 pane 역할이다. 두 이름은 경로와 pane 번호가 아니라 화면에 표시하는 역할 이름이다.

이 레인은 기존 두 Herdr pane을 사용한다. 하나는 티켓별 구현을 맡고, 다른 하나는 다음 입력을 보관하는 오케스트레이터다. 같은 작업 폴더의 작성자는 한 명만 둔다. 다른 워크트리와 세션을 정리하거나 새 프로세스를 계속 늘리지 않는다.

## 세션 인계 순서

1. 구현자는 해당 티켓의 검증, 커밋과 Linear 완료 처리를 마친다. 다음 티켓 ID와 제목, 현재 커밋 SHA, 읽을 파일, 정확한 시작 코드 위치, 선행 조건과 파일 소유자, 검증 명령과 제외 범위를 자족하는 다음 프롬프트로 만든다. 상태 파일은 만들지 않는다.
2. 그 프롬프트를 오케스트레이터 pane에 먼저 전달하고 수신 응답을 확인한다. 다음 입력을 상대가 보관하기 전에는 현재 세션을 `/new`로 비우지 않는다.
3. 구현자가 최종 응답을 마쳐 실제 `idle` 또는 `done`이 되고 입력칸이 비었는지 확인한다. 오케스트레이터가 그 구현 pane에 `/new`를 보낸 뒤 새 세션 식별자와 시작 화면을 확인한다. `/new` 자체에는 모델 응답을 기다리는 `agent prompt --wait`를 사용하지 않는다.
4. 초기화 완료 뒤 보관한 다음 프롬프트를 별도로 전달한다. 전송 성공뿐 아니라 새 구현자의 수신 응답과 `working` 상태를 확인한다. 다음 티켓은 이 새 세션만 구현하고 오케스트레이터는 제품 파일을 수정하지 않는다.
5. 티켓이 막히면 미커밋 변경을 보존하고 정확한 차단 사유와 필요한 결정을 보고한다. 완료 처리나 다음 티켓 자동 실행으로 우회하지 않는다. 별도로 준비된 독립 티켓은 선행 관계를 확인하고 새 세션에 배정하며, 미준비 Local 경로를 Cloud 완료에 섞지 않는다.
