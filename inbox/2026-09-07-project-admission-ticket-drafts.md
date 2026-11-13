# D87 사업 도입 확인, Linear 티켓 초안 3건

- 작성일: 2026-09-07
- 상태: 초안. 검수 후속 6건은 2026-09-07 Q가 확정했다(ADR-0045 "Q 확정 기록"). 게시는 Q의 게시 지시 뒤
- 워크스페이스: CCC(bss-ccc). 게시 절차와 함정은 `~/developer/tools/portwright/services/linear.md`
- 스레드 규칙(#ccc-tickets): 부모 글 한 줄 + 첫 댓글은 비개발자용. 아래 "부모 글"과 "첫 댓글"이 그 자리다. 두 번째 댓글부터 파일·컬럼·테스트를 적는다

---

## ① 사업 표 신설과 도입 확인 저장

**부모 글**: 사업마다 자료를 어디에 두고 AI를 써도 되는지 기관이 골라 기록할 수 있게 한다

**첫 댓글**
- 무엇이 달라지나: 사업을 등록할 때 "데이터 저장 위치"와 "녹음과 AI 정리" 두 가지를 고르고, 우리 기관이 계약 조건을 확인했다고 체크하는 칸이 생긴다. 지금은 기관에 사업 이름 하나만 적을 수 있고 사업을 여러 개 등록하는 화면이 없다
- 왜 하나: 공공 발주 사업은 계약서마다 자료 보관과 외부 처리 조건이 다르다. 판단은 기관이 하고 CCC는 정확히 알려 주기로 정했다(D87)
- 나에게 무슨 영향: 기관 관리자만 고른다. 실무자 화면은 바뀌지 않는다. 지금 있는 사업은 "나중에 정하기"로 시작한다

**두 번째 댓글 (구현)**
- 선행: `programs` 표 신설(Q 확정 1). 마이그레이션 0023이 "표 없음"으로 정했던 것을 ADR-0045 결정 3이 되돌린다. `organization_settings.program_display_name`은 첫 행으로 옮기고 컬럼은 읽기 폴백으로 남긴다(기존 환경 깨지지 않게)
- 컬럼: `storage_mode` (`default` / `naver_public` / `undecided`), `processing_mode` (`external_allowed` / `internal_only` / `undecided`), `admission_confirmed_at`, `admission_confirmed_by`(users FK), `admission_copy_version`, `admission_copy_sha256`, `admission_selection_snapshot`(JSON). CHECK로 값 고정. 기본값은 두 축 모두 `undecided`, 확인 컬럼은 NULL. `naver_public`은 CHECK에 있되 어댑터 ADR 전에는 API가 저장을 거부한다(라디오 비활성, Q 확정 3)
- SQLite와 PostgreSQL 두 방언 마이그레이션(D79 parity 계약 테스트에 표 추가)
- gateway: `listPrograms`, `createProgram`, `updateProgramAdmission`(관리자만, `assertAdmin`), 확인 체크는 `audit_log`에 관리자 ID·시각·선택값 스냅샷·문안 버전·sha256과 **명시 선택 여부**(무선택 저장과 구분)를 남긴다(D14)
- 다시 확인(무효화)은 셋: 선택 변경 시 `admission_confirmed_*`를 비운다. 설치 STT·LLM 설정 변경(capabilities 환경 변수 변경)과 문안 버전 변경은 저장된 `admission_copy_sha256`·설치 지문과 현재 값의 비교로 "다시 확인 필요"를 계산한다(컬럼을 지우지 않고 계산. 설치 값 변경 감지 방식은 티켓에서 정한다). 사유별로 ADR 문안 v1 "다시 확인 안내"의 문장을 API 응답 `reason`으로 돌려주고, `AI·STT·연결` 저장 전 안내용으로 "확인이 유효한 사업 수" 조회를 제공한다
- 두 축 중 하나라도 `undecided`면 확인 API는 400
- 문안 v1의 sha256을 `packages/contracts`에 상수로 두고 화면과 서버가 같은 값을 쓴다
- 화면(사업 등록 폼, 기관 초기 설정 2단계, 어드민 사업 목록)은 `design-adjustments` 워크트리 몫. 배치표 `docs/superpowers/specs/2026-09-07-project-admission-gate-design.md`
- 완료 기준: 마이그레이션 두 방언 적용, gateway 세 함수와 감사 기록, 확인 400 케이스 테스트, 기존 시드와 preview가 `undecided`로 부팅

## ② 도입 미확인 사업의 실데이터·원음·AI 거부 (E9-3 자리)

**부모 글**: 저장 위치나 AI 처리 조건을 아직 정하지 않은 사업에는 실제 당사자 자료가 들어가지 못하게 막는다

**첫 댓글**
- 무엇이 달라지나: "나중에 정하기"로 둔 사업이나 확인 체크를 아직 안 한 사업에서는 당사자 등록, 자료 가져오기, 녹음 올리기, AI 정리 켜기가 막힌다. 연습용 가상 자료는 그대로 된다
- 왜 하나: 조건을 정하기 전에 실제 자료가 들어가면 나중에 옮기거나 지워야 한다. 화면에 안내만 적는 것으로는 막히지 않아서 서버가 거부한다
- 나에게 무슨 영향: 기관 관리자가 사업 설정을 마치면 풀린다. 설정 화면에 `설정 필요` 배지가 보이는 사업이 대상이다

**두 번째 댓글 (구현)**
- 거부 지점(전부 gateway, 화면 숨김 아님): 당사자 등록과 케이스 생성, `.cccx` import와 파일 업로드, 원음 업로드 대상 발급(SG8 admission, E5-6 `audio_objects`), AI 활성화(텍스트 일감 큐 적재, Agent claim SG5). 조건은 `storage_mode`·`processing_mode`가 `undecided`이거나 `admission_confirmed_at`이 NULL이거나 무효화 상태
- 처리 경로 `internal_only`면 설치 값과 무관하게 원음 업로드와 `AIProvider` 호출 0. Agent job에 `sttEngine`을 싣지 않는다(실효 값 = 더 좁은 쪽, ADR-0045 결정 6)
- 저장 위치가 `naver_public`이면(어댑터 ADR 전에는 저장 자체가 거부되므로 도달하지 않는 경로) `undecided`와 같은 잠금
- 합성 fixture 경로(preview 시드, E11-1b)는 통과. 실데이터와 합성의 구분은 기존 E9-3 게이트를 그대로 쓴다
- 거부 테스트(검수 E2, 전부 API 거부 검사):
  - T1 `internal_only` 사업 세션에 원음 업로드 → 거부, `audio_objects` 0행
  - T2 같은 사업 AI 정리 요청 → `AIProvider` 호출 0, 수기 경로 안내
  - T3 `undecided` 사업에서 당사자 등록·케이스 생성·import → 거부, 합성 fixture만 통과
  - T4 `admission_confirmed_at` NULL 사업에서 T1~T3 → 전부 거부
  - T5 설치 STT `azure` + 사업 `internal_only`의 Agent claim → `sttEngine` 없음, 오디오 job claim 안 됨
  - T6 선택 변경 뒤 재확인 전 → T1~T4 다시 거부
  - T7 문안 sha256 변경 뒤 → 기존 확인 무효, 재확인 전 거부
  - T8 `external_allowed`여도 `external_stt_processing` 동의 없음 → Azure route provider 호출 0, 자동 전환 없음(S7 동의 6영역 표 0049 선행)
  - T9 `.cccx` import·파일 업로드에서 T3·T4 재현 → 우회 0
- 의존: ① 선행. T1·T5·T8은 SG8·SG5 fixture, T8은 0049. E5-6 `audio_objects`가 없으면 T1은 업로드 대상 발급 거부로 검사
- 완료 기준: T1~T9 통과, 거부 응답에 code와 화면 문구(fail-closed 표 형식)

## ③ 네이버 클라우드 공공형 저장 어댑터 (별도 ADR 뒤)

**부모 글**: 발주처가 국내 공공 클라우드를 요구하는 사업을 위해 네이버 클라우드에 자료를 두는 방식을 정하고 만든다

**첫 댓글**
- 무엇이 달라지나: 지금은 회색으로만 보이는 "네이버 클라우드 공공형"을 실제로 고르고 저장할 수 있게 된다
- 왜 하나: 정부, 지자체 발주 사업 중 CSAP 인증 클라우드를 요구하는 경우가 있다. 이 사업들은 그 전까지 실제 자료를 넣을 수 없다
- 나에게 무슨 영향: 해당 사업의 기관 관리자가 별도 계약과 설치를 한 뒤 쓴다

**두 번째 댓글 (구현)**
- 선행: 별도 ADR(번호 미정). 정할 것: 네이버 클라우드 어느 서비스(PostgreSQL 관리형인지, VM 위 자체 운영인지), CSAP 범위, 원음 private 저장소 대응(`AudioStore`), Auth·MFA 대응(`Identity`), 서울 리전, 설치 모드 이름(네 번째 배포 모드인지 Community Cloud의 변형인지, D76 표 개정 여부)
- 구현은 D79 Database 포트 위 어댑터 1개 + `AudioStore` 어댑터 1개 + `install` manifest 값 1개. SQL 번역기 금지, `?` → `$n` 치환만
- parity 계약 테스트에 세 번째 어댑터 추가
- 화면 변화는 라디오 활성화 하나(라디오 값은 ①에서 이미 있다). 문안 버전이 오른다(ADR 결정 5). 어댑터가 붙으면 ①의 `naver_public` 저장 거부와 ②의 잠금이 풀린다
- 완료 기준: 별도 ADR Accepted, parity 테스트 통과, `doctor`가 공공형 설치를 식별

---

## 게시 전 점검(스레드 규칙 5개)

- 본문 1개(부모 글 한 줄) / 쉬운 한 줄 / 첫 댓글 자족 / 강조 2개 이하 / `humanize-korean` 윤문: 게시 직전 부모 글과 첫 댓글만 윤문한다
- 게시 순서: ① → ② (①이 선행) → ③은 별도 ADR Accepted 뒤
