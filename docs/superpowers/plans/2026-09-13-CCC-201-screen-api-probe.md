# CCC-201 화면과 API 대응 검증 계획

## 요청과 경계

CCC-201은 화면, 서버 액션, 실제 API/DTO/Actor 대응의 누락을 찾고 실행 근거를 남기는 문서 티켓이다. 제품 구현이나 W02/CCC-300 완료를 대신하지 않는다. 고정 B의 독립 신원과 양쪽 reset 근거를 대조해 정본 접수를 완료했다. 접수 뒤 Linear 재조회 `log_CbFeiz9Cv7uR`에서 In Progress, 열린 blocker 0건, 유일한 선행 CCC-164 Done을 확인했다.

쓰기 범위는 S3, 이 계획, `artifacts/ccc201-screen-api/`의 최소 probe/근거, 단일 교대 상태 JSON과 CCC-201 코멘트뿐이다. 제품 소스, 테스트, fixture, DESIGN, frontend, mini와 N02의 소유 파일은 변경하지 않는다. CCC-299/292의 제안은 미발행 상태이며 이번 대응표의 public 계약으로 쓰지 않는다.

## 기준

- 제품: `../beta-core-parity`의 `7c7b632dc5b0a1cd6d7ff2ade4a15eaa3e6ecd07`. 실제 HEAD와 clean 상태를 확인했다.
- S3 시작 SHA-256: `d95da47a879aea1d79a3e9bf43e4b90835408402866b55804e9375353116afbe`.
- SG3: `docs/superpowers/plans/2026-09-02-SG3-screen-api.md` 전문.
- Master: `CCC_OPEN_PILOT_PLAN.md` SG3/E2-1 및 E2 소유권.
- 승인 계획 SHA-256: `1877015ecb999e7257ba55f33445db614f9bc79d9817c9dfc4cd8f3eb77f7879`.
- 카드 계약 SHA-256: `446e1f0e1bc205a440fbe27d703a2a4616c1591d07245fbe6a96e6a2a65e156f`.
- SCR CSV SHA-256: `87b71fdf2fe80193193ff77ae02fe9b37b75cf3bf95d8e0834e75a032ef64d76`. CSV 21행은 Next page 개수와 별도다.

## 조사와 실행 순서

1. 실제 page/route handler와 inventory를 독립 대조한다. page별 모든 조상 layout, 렌더 import, server action과 API helper의 전이 경로를 추적한다. 공개 셸의 조건부 제외와 redirect 시도/실제 응답을 구별한다.
2. 실제 HTTP dispatch, request/response envelope, nullable/optional 필드, Actor 및 자격 경계를 조사한다. 제거된 S3 행, 현재 page가 없는 경로와 계약 결함은 지우지 않고 명시적 분류와 기존 소유자를 기록한다.
3. 승인 SCR 21행을 client route/module/decoder와 대조한다. 코드 식별자와 새 표시명, 현재 기능과 후속 요구를 구분한다.
4. 소스 고정 임시 snapshot에만 runtime 산출물과 캐시를 둔다. git archive의 원본 bytes/hash와 설치된 의존성의 실제 해석 경로를 검증한다. workspace 패키지는 snapshot으로 연결하고 외부 패키지만 기존 설치를 재사용한다. 설치나 새 worktree는 만들지 않는다.
5. S3와 probe를 동결하고 독립 coverage/contract 검토를 받는다. 작성자와 검토자는 중간 build/test/lint/formatter를 실행하지 않는다.
6. 총괄이 실제 probe를 실행한다. 기존 `createD1TestContext`, `apps/api/src/index.ts`와 `handleRequest`를 통해 합성 DB를 사용하는 실제 Request/Response 및 loopback HTTP 경로를 확인한다. Next dev는 임시 snapshot에서만 실행해 공개 셸, 업무 셸 상속, redirect와 web adapter를 확인한다. 실제 테스트 Actor 주입은 자격 검증 자체의 성공 근거가 아니며 preview 경계는 실제 preview resolver로 따로 확인한다.
7. `node scripts/guard-doc-numbers.mjs`를 실행하고 명령, 버전, 동결 파일/hash, exit code, 출력과 미실행 범위를 기록한다. 검토 지적은 소유 문서/probe에서만 반영한다.
8. 수용 기준이 모두 충족된 경우에만 CCC-201을 완료한다. 실제 runtime을 안전하게 확보하지 못한 부분은 구체적으로 차단 기록을 남기며 다른 티켓의 결함을 문서 기대값 변경으로 고치지 않는다.

## 증거의 독립성

정적 대응 검사는 누락/중복 근거일 뿐 동작 검증이 아니다. `apps/client/tools/synthetic-api.mjs`의 자체 응답은 backend DTO/권한 증거로 쓰지 않는다. 실행기의 실제 응답과 승인된 계약을 비교하고, 독립 검토자는 probe가 자기 표만 재확인하는지 확인한다. 예상된 계약과 관측된 실패를 별도 필드로 남긴다. API가 닫아야 하는 기능을 켜거나 외부 AI/STT를 호출해 행을 채우지 않는다.

## 보호와 종료

외부 통신, 실데이터, 시크릿, live DB, 설치/배포/비용/권한 변경은 없다. 설치 off와 `sttEngine=null`을 유지한다. 모든 소유 job/result를 회수한 뒤 단일 정본의 successor/safe-stop 절차를 따른다. 이 계획은 진행 장부나 두 번째 제어 상태가 아니다.
