# ADR-0050: relayer 설치와 설정 온보딩

- 상태: Accepted. 2026-09-13 Q가 설계와 별도 워크트리 인계를 승인했다. 이 문서는 제품 구현 완료나 실제 자원 생성, 결제, 배포, AI/STT 활성화의 증거가 아니다.
- 결정일: 2026-09-13
- 결정 번호: D91
- 관련: ADR-0038, ADR-0041, ADR-0044, ADR-0045, S2, S4, S9, S11, S12
- 부분 대체: 도입 안내에서 설치 전 준비를 사용자에게 남기는 흐름과 S11의 최초 관리자 수동 준비 절차를 단계형 설치 지원과 지정 이메일 초대로 확장한다. 브라우저가 기관을 임의 생성하거나 설치 관리자 권한을 갖는 구조로 바꾸지 않는다.
- 유지: 기관 소유 저장소, 독립 업무 API와 설치 권한의 분리, gateway, 서명 설치, 데이터 이전, 동의, 사업 도입 확인과 STT 승인 관문. main의 D89(MFA 선택)와 D90(초대 수락의 신원 결속)은 유지한다.

## 배경

Q는 처음 가입하고 설치할 때와 나중에 AI, STT, DB를 설정할 때 질문, 안내, 사용자 입력, 실제 설정과 다음 질문이 이어지기를 요청했다. Cloud는 LLM 연결 후 추가 설정을 대화로 돕고, Local Single은 사용자가 자신의 코딩 에이전트에게 저장소를 주고 설치를 요청하는 입구를 갖는다.

`origin/main@ad218e8eafa646a524674fe4ef8cf9c20c0b68bb`에는 설치 plan/apply/doctor와 설치 기록, 기관 초기 설정과 사업 확인, 연결 상태 조회가 있다. 최초 자원 생성, 자동 초대와 안전한 대화 실행을 묶는 온보딩은 없고 클라이언트는 Local 두 모드를 거부한다. 기존 부품의 존재를 설치 완주의 증거로 취급하지 않는다.

## 결정

1. **현행 이름은 `relayer`다.** 프로젝트와 도구 이름에 소문자를 사용한다. 과거 문서, 운영 주소, 패키지와 DB 식별자를 이 결정만으로 일괄 개명하지 않는다.
2. **Cloud는 최초 자원 생성부터 설치까지 돕는다.** 계정 로그인, 약관과 결제 동의, 설치 대상과 변경 승인은 사용자에게 남긴다. 준비된 자원 연결만 제공하거나 배포기관의 수동 대행을 기본으로 삼지 않는다.
3. **설치 도구는 사용자 PC에서 실행한다.** Cloud 업무 API와 DB는 계속 클라우드에 둔다. 사용자는 설치기를 실행하거나 기존 코딩 에이전트에게 맡기며, 설치 후 Cloud 화면에서 설정을 이어간다.
4. **필요할 때만 연결한다.** 설치나 설치 권한이 필요한 재설정 동안 PC 도구를 열고 끝나면 종료한다. 상주 설치 관리 프로그램을 기본으로 두지 않는다. 기존 처리 Agent에 설치 관리자 권한을 추가하지 않는다.
5. **의미 있는 단계 묶음마다 승인한다.** 변경 대상, 내용, 예상 비용과 외부 전송을 보여주고 승인된 묶음을 실행한다. 개별 API 호출마다 묻거나 최초 승인 하나로 전체 설치를 진행하지 않는다. 승인 범위를 벗어난 대상, 비용, 권한이나 전송 변경은 다시 확인한다.
6. **자유 질문을 허용하되 현재 단계를 유지한다.** 답변 뒤 원래 입력과 단계로 돌아온다. 대화가 제안한 변경도 같은 승인 절차를 통과하며 LLM 문장을 실행 명령으로 삼지 않는다.
7. **AI가 없어도 안내는 작동한다.** LLM 연결 전이나 장애 때 고정 안내와 입력 경로를 제공한다. 설정 도우미와 상담 AI는 목적과 권한을 구분한다. 키 연결만으로 상담 AI, STT, 사업 확인이나 당사자 동의를 통과시키지 않는다.
8. **비밀값과 상담 원문을 대화에 넣지 않는다.** 키, 비밀번호와 연결 문자열은 승인된 보안 입력 경로로 공급한다. 자유 입력은 외부 전송 전 안전 처리를 통과해야 하며, 준비가 없거나 판정할 수 없으면 원문을 보내지 않고 구조화된 안내를 제공한다.
9. **완료는 실제 상태가 증명한다.** 설치 완료, 기관 준비, 제공자 연결과 AI/STT 사용 가능 상태를 각각 표시한다. 중단 뒤에는 상태와 설치 기록을 다시 읽고, 결과를 모르는 외부 작업을 무조건 재실행하거나 정상 자원을 삭제하지 않는다.
10. **Local Single도 같은 절차를 소비한다.** 저장소의 설치 안내와 실행 도구를 외부 코딩 에이전트가 사용한다. relayer 내부에 LLM 키가 없어도 이 입구가 작동해야 한다. 정식 Windows 11 x64, 암호화 SQLite, 앱 잠금과 loopback 계약을 유지한다. Local Office는 기존 모드별 차이를 반영하며 별도 온보딩 엔진을 만들지 않는다.
11. **DB의 저장 위치 변경은 이전 작업이다.** 현재 연결의 점검이나 복구와 배포 모드 및 저장 위치 이전을 구분한다. 설정 토글로 기존 DB를 덮어쓰지 않는다.

## 최초 관리자와 기존 인증 결정

최초 관리자 초대는 PC 설치 도구가 승인된 이메일 하나에만 수행한다. `scripts/onboarding/first-admin.mjs`가 기존 설치, 소유권, 기관 상태와 Auth 초대 정책을 확인한 뒤 초대 발송과 `linkFirstAdmin` 결속을 잇는다. 이 구현은 아래의 `/auth/invite` 실화면과 직원 가입 정책이 구현되고 별도 실행 승인을 받기 전에는 실제 초대를 보낼 수 없다. 초대 토큰과 비밀번호를 로그, LLM, 일반 업무 API의 관리자 기능에 싣지 않는다.

Cloud MFA를 필수로 되돌리지 않는다. 등록된 사용자의 추가 인증, 실제 assurance 기록, Local Office의 privileged MFA와 Local Single 앱 잠금은 S2의 최신 개정과 같다. 이후 직원의 초대 수락은 D90과 아래의 2026-09-14 부분 개정을 함께 따르며, 제거된 `POST /identity/link`를 복원하지 않는다.

### 2026-09-14 Q 부분 개정: Community Cloud 직원 Auth 초대 전용

Community Cloud의 신규 직원 Auth 계정은 권한 있는 Auth 초대와 서명된 client origin의 `/auth/invite`를 통해서만 만든다. `disable_signup=true`를 유지하며 기관의 초대 없는 `signUp`을 열지 않는다. 이 결정은 당사자 요청 링크와 `public_signup` 기능 정책을 바꾸지 않는다.

직원 초대 수락은 일회용 직원 초대 token, 서명 검증을 마친 Auth `subject`, Auth email claim과 초대 이메일의 일치를 모두 요구한다. `subject`가 없거나 이메일이 다르면 사용자 행 생성, 역할 부여와 초대 소비를 모두 하지 않는다. 일반 업무 API에 Supabase 관리자 자격을 두거나 `POST /identity/link`를 복원해 나중에 결속하지 않는다.

`/auth/invite`의 implicit success fragment는 `access_token`, `refresh_token`, `expires_in`, 선택적인 `expires_at`, `token_type`, `type`만 받는다. `token_type`은 `bearer`, `type`은 `invite`여야 한다. provider error fragment는 `error`, `error_code`, `error_description`만 받으며 success key와 섞이면 거부한다. unknown key, `provider_token`, `provider_refresh_token`, PKCE의 `code`와 `sb_flow_id`, 별도 OTP 방식의 `token_hash`는 이 route에서 받지 않는다. 이 목록은 설치된 `@supabase/auth-js@2.116.0`의 implicit session 입력과 현재 email invite 방식을 좁힌 계약이다.

클라이언트는 fragment를 화면 렌더 전에 한 번만 메모리로 옮기고 `history.replaceState`로 주소에서 지운다. 세션은 기존 `persistSession=false`, `detectSessionInUrl=false` 경계를 유지하며 token, email과 password를 URL, history, referrer, 브라우저 저장소, 로그, 분석 도구나 오류 객체에 남기지 않는다. `invite_missing`, `invite_invalid`, `invite_expired`, `invite_session_conflict`, `password_rejected`, `provider_unavailable` 상태에서는 고정 안내를 표시하고 업무 진입과 결속을 하지 않는다. 주소를 지운 뒤 reload하거나 브라우저를 닫으면 token을 복원하지 않고 원본 초대 메일을 다시 열도록 안내한다.

Auth 초대 발급은 업무 API 밖에서 관리자 자격을 이미 제한적으로 주입하는 기존 PC 설치 및 관리 프로세스를 우선 후보로 삼는다. 첫 관리자는 현행 `scripts/onboarding/first-admin.mjs` 경계를 유지한다. 이후 직원의 발급 명령, 업무 초대 token과 Auth 초대의 결합 표식, 두 TTL의 정렬, 미결속 Auth 사용자 정리는 FRONTEND, BACKEND와 설치 작성자가 단일 슬롯을 정한 뒤 확정한다. 새 서비스, 새 권한, 새 비용을 이 문서로 승인하지 않으며 N04에 의존시켜 N03과 순환시키지 않는다.

이 부분 개정은 정책과 구현 계약의 승인이다. Auth 설정 변경, 시크릿 저장이나 주입, 실제 초대 발송, 배포 승인이 아니다. N03은 실화면과 결속 검증 전까지 In Review이며 N04 구현은 보류한다.

## 독립 업무 실행 경계와 번호 충돌

현재 Cloud 구현은 Supabase DB/Auth/private Storage와 별도의 업무 API 실행 환경을 사용한다. 이 온보딩도 설치 관리자 자격과 일반 업무 실행 자격을 분리한다. hosted Edge에 키가 존재하지 않는 것처럼 포장하거나 기동 검사를 완화하지 않는다.

오케스트레이터 `01e68d70fa7f6e6afe6984edab1bb4f9d3aeda7c`의 ADR-0048과 ADR-0049는 아직 이 main 기준에 없다. 그 브랜치의 D89/D90은 각각 독립 Cloud 실행과 카드/AI 기준을 뜻하지만, main의 동명 번호는 MFA와 초대 결속이다. 이 ADR은 어느 기존 행도 덮어쓰지 않는다. 온보딩에는 ADR-0050/D91을 사용하고, 다른 결정의 번호 정리는 해당 통합 작성자가 맡는다. 병합 전 번호 검사를 다시 수행한다.

## 결과와 구현 소유

- 설계 정본: [온보딩 설계](../superpowers/specs/2026-09-13-relayer-onboarding-design.md)
- 구현 순서: [실행 계획](../superpowers/plans/2026-09-13-relayer-onboarding-implementation.md)
- 새 세션 입구: [핸드오프](../superpowers/plans/2026-09-13-relayer-onboarding-handoff.md)
- `.worktrees/onboarding`은 문서와 신규 `scripts/onboarding/**`에서 독립 작업을 시작한다. 기존 설치기, 코어, HTTP, 공용 계약과 릴리스 연결은 현재 작성자와 슬롯을 정해 반영한다.
- `apps/client`는 frontend, 공유 UI/CSS/토큰과 시안은 DESIGN이 소유한다. 워크트리 생성은 이 잠금의 예외가 아니다.
- 각 동작을 구현하기 전에 해당 생산자와 소비자의 계약을 고정한다. 단계 승인 결합은 N01, 최초 관리자 초대와 신원 연결은 N03, PC와 Cloud 인계는 N04, 자유 입력의 허용/거부는 N05의 선행 관문이다. 후속 계약이 없는 상태에서 그 동작의 권한이나 외부 전송을 먼저 열지 않는다.
