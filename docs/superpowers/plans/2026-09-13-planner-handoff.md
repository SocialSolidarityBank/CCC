# PLANNER 작업 인계

**Goal:** 현재 오케스트레이터의 배치를 따라가며 실행 계획을 최신화하고, 배치가 끝나면 승인된 다음 작업을 바로 구현할 수 있도록 준비한다.

**Architecture:** PLANNER는 계획 준비를 맡는 상설 워크트리다. 총괄을 대체하거나 진행 중인 구현을 중복 배치하지 않는다. 기존 티켓과 커밋은 근거로 보존하고 요구와 의존관계는 기존 실행 계획을 정본으로 유지한다. 현재 전달은 아래 로컬 체크포인트 규율을 따른다. 실제 구현에 들어갈 때 [executing-plans](skill://executing-plans)와 [branch-worktree-gate](skill://branch-worktree-gate)를 읽고 적용하되 현재 인계 금지사항을 우선한다.

**Tech Stack:** Git worktree, 기존 CCC 실행 계획과 티켓. 구현 환경은 Node.js >=22, pnpm 11.5.3이다.

**Spec:** 아래 ‘정본 읽기’의 릴레이어 적용 계획과 카드 계약 ADR을 따른다. 이 문서는 새 제품 스펙이나 별도 진행 현황표가 아니다.

**해석한 요청:** `inbox/2026-09-13`의 S-P/S-H/S-N과 Q의 후속 그릴링 답변을 계획 입력으로 삼는다. 기존 W01~W13을 새 목록으로 대체하지 않고 정본 수정안을 준비한다. 개별 확정 결정을 명시한 곳 외의 수정안은 작성권 인계 전 제안이며 제품 활성화 기록이 아니다.

## 작업 범위와 보존

- 경로는 `<repo>/.worktrees/PLANNER`, 현재 문서 브랜치는 `docs/privacy-stt-prerequisites`다. 시작 브랜치 `plan/batch-followup`에서 기존 인계 파일을 보존한 채 옮겼다. `<repo>`는 Git 공통 디렉터리 `.git`이 있는 CCC-new 루트다.
- 초기 대조 기준은 `ad218e8eafa646a524674fe4ef8cf9c20c0b68bb`이며, 당시 HEAD와 `origin/main`의 차이는 `0 0`이었다. Q가 승인한 A3/A4와 그릴링 결정은 `CONTEXT.md`, ADR-0010, 법률 검토 목록, S10/S13 및 이 인계 파일의 6개 경로에 작성해 전달했다. 조율 마감 뒤 이번 쓰기 범위는 이 인계 파일 하나이며 다른 5개 승인 문서는 읽기 전용이다.
- 로컬 체크포인트 검증 과정에서 pnpm 11.5.3이 이 워크트리의 의존성을 설치했다. 로그상 잠금 파일은 최신이었고 새 다운로드는 0건이었다. 다른 레인의 `node_modules`를 연결하지 않았다. 이 설치와 정적 커밋 가드 통과는 제품 코드의 실제 동작이나 Windows 실행 검증이 아니다.
- 새 OMP 세션, 자동 감시, 예약 작업과 외부 AI 호출은 시작하지 않는다. 이전 티켓 코멘트는 전달 이력으로 보존하며 현재 인계는 다음 규율을 따른다.

### 현재 총괄 인계 규율

- 총괄 `beta-0.9 orchestrator w1N:p1`이 직접 조정 메시지로 `docs/superpowers/plans/2026-09-12-relayer-domain-ai-replan.md`와 D90/ADR0049의 소유를 확인했다. Core mini는 versioned intake, frontend는 `apps/client`를 소유한다. PLANNER는 pipeline/Windows 실행 레인을 소유하지 않으며 이 세션에서 검증한 Windows SSH 계정/명령도 없다.
- 총괄의 **G1/G3/G5/G6과 G7 기술 대응 정책 승인**은 로컬 체크포인트 `b43f7d138b4dea55e47a08474b47787e681489f4`의 계획 §6 및 카드/AI 소비 계약에서 읽었다. G7은 기존 금고와 같은 암호화·키 보호 아래 사례별 표를 보관하고 일반 열람 UI를 만들지 않는다. 신규 이름/기관은 별도의 기관 내부 보호 경로로 등록하며 일반 ResultRequest나 provider에 원문/대응표를 싣지 않는다. 같은 이름만으로 합치지 않고 모호하면 일반 가림을 유지한다. 생년월일은 상대 날짜로 바꾸지 않고 명확한 사건일·기한만 변환한다. 실제 자료 사용, 법적 적합성, 의미 품질 통과나 provider 활성화 승인은 아니다.
- **로컬 체크포인트와 Tailscale SSH Git 인계만 사용한다. `origin` 작업, PR, main 통합과 배포는 하지 않는다.** 이 규율 전에 조회한 원격 SHA/PR/티켓 상태는 당시 근거이며 추가 원격 작업의 지시가 아니다. 총괄의 2026-09-13 회신에서 현 배치 미완료와 PLANNER 문서 전용 유지를 확인했다. 신규 구현과 W 정본의 작성권, 제품 검증 슬롯은 인계되지 않았다.
- 총괄의 `CONTEXT.md` 변경은 카드/의미/승인/브리핑/기억 그림자/목표 용어 영역을 소유한다. PLANNER는 동석자, 파기, 파기 내역과 업무 반출/복구·이전의 국소 변경만 체크포인트로 전달하고 총괄의 용어 영역을 덮어쓰지 않는다. 현재 기준에서 두 레인의 기존 줄 변경 구간은 겹치지 않았다.
- 2026-09-13 Q가 승인한 총괄 조율은 위 마감 회신까지 진행했다. 이후 Q는 작업 중인 오케스트레이터에 메시지나 지시를 보내지 말고 PLANNER가 독립적으로 파악하도록 지시했다. 새 명시적 허용 전에는 수신 확인이나 상태 문의도 보내지 않는다. 기존 소유권과 `origin` 작업·PR·main 통합·배포 금지는 유지한다.
- **이번 단일 파일 인계:** 단일 작성자는 PLANNER(`w1W:p1`)이고 대상은 자기 워크트리의 `docs/superpowers/plans/2026-09-13-planner-handoff.md`다. 인계 편집 기준은 `b71524e`의 같은 본문이며, 그 위에 이미 기록한 `c3073c5`와 현재 문서 브랜치를 보존한다. 전체 브랜치 병합, reset과 다른 워크트리 복사는 하지 않는다.
- **검증 슬롯:** 이 파일의 문서 검수와 정상 pre-commit 가드만 허용한다. 같은 문서 검사를 미리 반복하지 않으며 제품 build/typecheck/tests/browser/Windows 슬롯은 Main 소유다. 확인 뒤 로컬 체크포인트 SHA와 이 경로만 회신하고 문서 전용으로 대기한다. 수신 확인 메시지마다 새 체크포인트를 만들지 않는다. 신규 구현 작성권은 0이다.
- 같은 날 Q는 AI/STT/DB의 기존 계획과 구현을 대조하고, 누락된 연결·검증·복구 계약만 기존 W/E 항목에 연결하는 설계 제안을 Ouroboros로 구체화하도록 승인했다. 아래 후속 구체화는 이 파일만 갱신하며 계획용 Seed와 QA 기록은 세션 로컬 아티팩트로 둔다. 코드 구현, 미승인 정책의 확정과 다른 레인 개입은 허용하지 않는다.

## 정본 읽기

총괄의 작업 공간은 `<repo>/.worktrees/beta-0.9-orchestrator`, 브랜치는 `orchestrate/beta-0.9`다. 조율 마감의 최종 문서 통합 및 정책 읽기 기준은 `3dff4d0ceb7cf2458a23f349afe31230400aefe0`이다. `081d3d0c`는 W 참조와 현재 구현 경고 보완 전의 문서 통합 이력이며, 아래 정본 수정안의 원래 대조 기준 `b43f7d13`과 초기 결함 근거 `01e68d70`도 역사로 보존한다. 문서 기준과 아래 표의 검증된 코드 통합 SHA를 구별한다.

새 기준도 총괄이 로컬 체크포인트와 허가된 Tailscale SSH Git 경로로 인계한 SHA를 사용한다. 상대 워크트리를 직접 수정하거나 미커밋 파일을 복사하지 않는다. 아래 명령은 공유 Git 저장소의 로컬 객체를 읽으며 origin 통신이나 전체 브랜치 병합을 하지 않는다.

```sh
git show 3dff4d0ceb7cf2458a23f349afe31230400aefe0:docs/superpowers/plans/2026-09-12-relayer-domain-ai-replan.md
git show 3dff4d0ceb7cf2458a23f349afe31230400aefe0:docs/superpowers/specs/2026-09-12-relayer-card-ai-contract-design.md
git show 01e68d70fa7f6e6afe6984edab1bb4f9d3aeda7c:docs/superpowers/plans/2026-09-12-beta-0.9-mini-handoff.md
```

- **현재 실행 순서:** `2026-09-12-relayer-domain-ai-replan.md`의 W01~W13, 관문과 수용 기준이다. 같은 문서 10장이 이전 인계의 전체 작업 순서를 대체한다. 8월 31일 총괄 계획으로 돌아가지 않는다.
- **첫 구현 묶음의 승인 범위:** 카드 계약 ADR의 ‘결과’와 ‘구현 소유’를 읽는다. 클라이언트 표시명과 첫 상담 기록 진입, 명확한 상충 기준과 기억 입력 격리가 첫 묶음으로 적혀 있다. 이 기록만으로 실제 배치가 어디까지 끝났는지는 판정하지 않는다.
- **기존 결함 증거:** mini 인계 10장과 12장을 재사용한다. 사용자가 이미 보고한 결함이나 확인된 설정을 다시 증명하느라 계획 작업을 멈추지 않는다.
- **원본 요구:** 적용 계획 1장의 원본 경로와 SHA-256 표를 따른다. `<repo>/inbox/2026-09-12/` 자료는 덮어쓰거나 Git에 추가하지 않는다.
- `w1N:p1`은 총괄이 알려 준 pane 식별자이며 임의의 `hub` peer ID로 사용하지 않는다. 배치 종료와 파일 동결/작성권 인계는 총괄의 직접 통지 또는 지정한 체크포인트 근거로 확인한다. 다른 세션의 내부 파일은 뒤지지 않는다.
- 인계할 Git 객체나 허가된 SSH 경로를 확보하지 못하면 총괄에게 그 경로를 받는다. `origin`이나 PR로 우회하거나 과거 SHA를 최신으로 간주하지 않는다.

## 이번 수정안의 근거

### 갱신된 입력

`I13`은 `<repo>/inbox/2026-09-13/`이다. Q의 갱신 통지 뒤 S-P/S-H를, 후속 그릴링 요청에서 S-N을 각각 끝까지 읽었다. 원본은 수정하거나 Git에 추가하지 않는다.

| ID | I13 아래 파일 | 읽은 범위 | SHA-256 |
|---|---|---|---|
| S-P | `handoff-sensitive-data-scope-2026-09-13.md` | 203줄 전체 | `a72c1a4b9f64eb7d5b29d0ee22cdfa5af238d40551352300a812fe124f010982` |
| S-H | `handoff-sensitive-data-architecture-2026-09-13.md` | 243줄 전체 | `b29e9e62287cd4bff1ca03a0fff13812e09e3e5f6ca601d2910962d6c20616c9` |
| S-N | `handoff-sensitive-data-rules-2026-09-13.md` | 153줄 전체 | `487902e812f737a03dd1ce8b6e8094389efae231fdf73341c3d958a5e23d08d2` |

이 SHA와 다른 판은 해당 변경을 읽은 뒤 수정안의 입력으로 교체한다. S-P 초판의 깨진 UTF-8 바이트는 갱신판에서 해소됐으며, PLANNER가 원본을 고친 것은 아니다.

### 배치에서 확인한 것과 확인하지 못한 것

**2026-09-13 총괄 조율 마감 회신 기준.** 아래 검증 결과는 총괄이 인계한 근거이며 PLANNER가 제품 검사를 다시 실행한 결과가 아니다. G1/G3/G5/G6/G7 정책과 G4 기억 입력 차단은 기존 승인 계약을 유지한다. 문서 가드 통과는 제품 구현·품질·Windows·복원 완료의 증거가 아니다.

| 구분 | 확인된 상태와 인계 경계 |
|---|---|
| 총괄 | 승인 문서를 국소 통합하고 W01 G8/W11/W12/W13의 참조와 미구현 경계를 연결했다. 별도 보완은 `CONTEXT.md`의 파기 뒤 가명기록 보존 오해 제거와 `docs/ops.md`의 기존 금고 중심 구현 경고다. 현 배치는 미완료다 |
| 검증된 코드 | `integrate/relayer-domain-beta@6896872203c0b69c9a9e2b06431911b22ffac36b`. core `a1afc7a7`와 client `9b5b5c6e`를 포함하며 client 139검사, 타입, 빌드, 가드와 PostgreSQL parity 근거를 총괄이 확인했다 |
| core mini | W04의 manual-record 계약, gateway/HTTP와 관련 migration/tests를 소유한다. 현재 작성 중단 및 검증 대기이며 이 소스는 위 검증에 포함되지 않았다 |
| frontend | `apps/client`의 `intake.tsx`와 `participants.test.ts` 영역 접기 복구를 소유한다. 현재 작성 중단 및 검증 대기이며 이 변경도 위 검증에 포함되지 않았다 |
| DESIGN | `apps/web` intake와 공유 Wire 부품을 소유한다. 보고는 P9/부품 수준이므로 W03 legacy intake 완료로 인정하지 않았다. 회신 시점에 core/frontend/DESIGN Herdr 상태는 모두 idle이다 |
| 문서 수신과 통합 | 필요한 6개 경로만 로컬 cherry-pick했다. `665e3985` → `da76e0a4`, `926bb861` → `d5090be2`, `b71524e` → `081d3d0c`이며 후속 정리를 마친 최종 문서 기준은 `3dff4d0ceb7cf2458a23f349afe31230400aefe0`다. 정상 pre-commit의 문서 번호, DB/core 경계, 시크릿과 디자인 가드가 통과했다. 다운로드 감사만 남기고 발송 기록·수령 기관·목적 수집과 별도 발송 기록 의무를 두지 않는 범위는 S10 §1.1 정본을 따른다 |
| PLANNER | 위 단일 파일 인계와 문서 검증 슬롯만 받았다. W 정본/D90/ADR0049는 계속 Main 소유이며 다른 정본과 코드는 수정하지 않는다. 다음 범위는 관련 생산자 계약의 커밋·검증과 Main의 소유 구간 동결 뒤 명시적 인계로 정한다. Q에게 같은 자료를 다시 요청하지 않는다 |
| CCC-237 보존 인계 | Q가 기존 작업 보존 후 이식을 승인했다. Main은 원본 196개 해시와 HEAD/status 불변을 확인하고 재사용 소스/문서/검사 정의 18개만 `archive/ccc237-input-a98b9f23642f@38254876e1d2083ccae3db085245d088411cc50b`에 보관했다. 실험 로그/결과/압축파일 178개는 원위치에 보존했다. 보관 커밋은 채택이나 품질 PASS가 아니며 오래된 `99d7b41` 전체 트리를 현재 코드에 병합하지 않는다. S5/S6 재전송, 결과 멱등성, Azure 1회 전송과 qualification 경계는 다시 열지 않는다 |

다음 PR과 티켓 상태는 이전 조회 시점의 근거로 보존한다. 위 직접 회신을 대신하는 현재 배치 상태표가 아니다.
- [PR #335](https://github.com/SocialSolidarityBank/CCC/pull/335)는 OPEN이다. [#334](https://github.com/SocialSolidarityBank/CCC/pull/334)와 [#333](https://github.com/SocialSolidarityBank/CCC/pull/333)은 MERGED이며 이미 위 main 기준에 포함돼 있다. 역할 PR의 열림이나 이전 PR의 머지는 카드 배치 종료 증거가 아니다. 총괄 브랜치를 head로 하는 PR은 조회 결과 없었다.
- Linear의 최근 변경 조회와 `릴레이어`, `민감정보`, 기존 E/SG 식별자 검색으로 이번 배치의 W별 작성권 인계는 찾지 못했다. 아래 E 티켓은 관련 실행 항목이지 이번 배치의 담당자 확정표가 아니다. 기존 티켓에 남은 `CCC_OPEN_PILOT_PLAN.md`와 과거 모델명은 현행 W 실행 순서를 대체하지 않는다.
- [CCC-237](https://linear.app/bss-ccc/issue/CCC-237)은 In Progress다. 공개 코멘트의 NER 품질 실패와 긴 입력 누락, v2/v3 미커밋 작업, 통과 증명 미발행을 그대로 선행 근거로 쓴다. 다른 레인의 파일을 읽거나 복사해 반영 완료로 처리하지 않는다.
- **CCC-237 이전 문의 답변(2026-09-13):** 당시 PLANNER는 담당자와 승인된 채택 체크포인트를 알지 못했다. 근거는 Linear 공개 코멘트(최신 2026-09-06: 전체 가림 FAIL, 긴 입력 단일 창 누락, v2/v3 미커밋, 통과 증명 없음)와 로컬 브랜치 목록뿐이었으며 `.worktrees/e5-4-privacy-generalization`, `apps/pipeline`, 코어 가림 코드는 읽거나 고치지 않았다. 이후 보존 인계는 위 표로 구별한다. 다시 열지 않을 S5/S6 규칙: mask dictionary 응답 유실 뒤 같은 service·job·claim·attempt의 만료 전 재전송은 같은 dictionary ID와 동일 응답을 돌려주고, 그 밖은 `stale_claim`·`lease_expired`·`dictionary_already_consumed`로 거부한다(S5 §2.1). 결과 멱등성은 JCS payload hash로 판정한다(같은 hash `204`, 다른 hash `409 result_conflict`). Azure는 attempt당 원본 전송 최대 1회이고 자동 재시도가 없다. release는 immutable `NerReleaseQualificationReceipt`(`status='passed'`, 만료 전)를 전제하며 S6 N2 설치 health와 E5-4 통과 증명은 별개다. dictionary는 메모리에서만 쓰고 처리 뒤 zeroize한다(S6 §2.4·§2.6). 당시 PLANNER 소비용 체크포인트는 `665e3985`였다.
- [CCC-250](https://linear.app/bss-ccc/issue/CCC-250)은 In Progress다. 옛 합성 150건/CPU 비교 본문과 후속 S13 v2 사람 품질 계약은 시점이 다르다. 최신 S13을 기준으로 담당 레인에 본문 정합 수정을 전달하되 역사 측정과 댓글은 보존한다.
- [CCC-157](https://linear.app/bss-ccc/issue/CCC-157), [CCC-189](https://linear.app/bss-ccc/issue/CCC-189), [CCC-234](https://linear.app/bss-ccc/issue/CCC-234), [CCC-192](https://linear.app/bss-ccc/issue/CCC-192)는 Backlog다. CCC-192에는 CCC-194가 열린 `blocks`로 남아 있다. [법무 스펙 이슈 #227](https://github.com/SocialSolidarityBank/CCC/issues/227)은 OPEN이며, 명시된 `docs/specs/S14-legal-gates.md`는 현재 PLANNER 기준에 없다. 기존 의뢰 목록 작성과 법무 관문 통과를 구별한다.

## 정본 반영 수정안

**수신자와 적용 조건:** 총괄은 승인된 파기/복원/반출 정책과 A3/A4의 참조를 W01 G8/W11/W12/W13에 연결했다. A1/A2/A6 및 R1~R10의 제안 구현 전체를 승인하거나 코드로 옮긴 것은 아니다. 아래 나머지 수정안은 해당 작성권과 기준 SHA를 새로 인계받기 전까지 제안으로 유지한다. 새 W 항목이나 병렬 상태 파일을 만들지 않는다.

추가 정본 작성권을 인계받으면 인계 SHA의 대상 파일을 PLANNER의 같은 경로에 가져온다. 현재 정책 읽기 기준은 `3dff4d0c`이며 아래 표의 원래 제안 기준 `b43f7d13`과 구별한다. 전체 브랜치를 병합하거나 총괄의 미커밋 파일을 복사하지 않는다. 이미 연결된 문서 참조를 반복 적용하거나 그 연결을 제품 구현 완료로 취급하지 않는다.

**원래 제안 대상:** `docs/superpowers/plans/2026-09-12-relayer-domain-ai-replan.md`의 `b43f7d13` 기준 변경표다. 카드 필드/전환 설계도 당시 같은 체크포인트의 `docs/superpowers/specs/2026-09-12-relayer-card-ai-contract-design.md`를 참조했다. 현행 정책 판정에는 위 최종 문서 기준을 사용한다.

| 변경 구간 | 넣을 내용 | 기존 계획과의 관계 |
|---|---|---|
| §1 원본/지문 표 | S-P/S-H/S-N의 경로, 전체 읽기 범위, 지문과 후속 Q 결정의 연결 | 9월 12일 원본 8개는 보존한다 |
| §6 G7/G8 | `b43f7d13`의 G7을 유지하고, 이 세션에서 추가 확정한 최종 파기·복구 개방·업무 반출과 G8의 남은 정책을 통합 | 승인된 기술 선택을 다시 묻거나 일반 ResultRequest에 원문 등록을 추가하지 않는다 |
| §7 W01 | 고지 버전과 재확인, 데이터 암호화 범위, 감사 집계 계약을 기존 생산자/소비자에 명시 | 아래 A1/A5/A6과 R1~R10의 계약 준비를 연결한다 |
| §7 W06 | 번호/기관/날짜 및 구조화 재료의 가림 요구, 기존 CCC-237 작업과 CCC-238 소비 경계 | 가림 v2를 새로 중복 구현하지 않는다 |
| §7 W11 | 문안 A1/A2, 월간 감사 A6, 연결 상태/공개 안내/보유기간 소비, Q가 확정한 HWPX·DOCX·CSV 업무 반출 구현 | frontend와 DESIGN 소유는 유지하며 파일 생성은 코어/HTTP 계약 뒤에 연결한다 |
| §7 W12/W13 | S13 기관 확인 A4/실측 B1, 독립 평가, 법무 A3, 버전 전환/복구/제출 | 공개 자료 조사와 제품 통과를 구별한다 |
| §9 대응표 | 아래 S-H A1~A6/B1~B5와 S-P의 추가 요구를 연결 | 기존 54결정, 71질문, 21화면 대응을 지우지 않는다 |

### Q 확정: 페이지와 메뉴 표시명 변경

**범위:** 2026-09-13 Q가 아래 명칭을 확정했다. W02의 화면명 대응과 W11의 표시 적용에 연결하는 별도 후속 요청이며, AI/STT/DB 계획용 Seed를 다시 생성하는 일이 아니다. 여기서는 변경 계획만 기록한다. 화면 코드, Main 소유의 W 정본/Glossary, DESIGN 문서와 시안 원본은 수정하지 않았다.

**읽은 기준:** 업무 클라이언트는 커밋 `7c7b632dc5b0a1cd6d7ff2ade4a15eaa3e6ecd07`의 소스를 대조했다. 아래 `<case>`는 기존 `/participants/:beneficiaryId/programs/:supportCaseId` 경로를 줄여 쓴 것이다. 새 이름 때문에 URL, destination ID, `module` 값, API, 저장 식별자, 권한, 기능이나 메뉴 순서를 바꾸지 않는다.

| 현재 표시명 | 확정 표시명 | 적용 대상과 불변 경계 |
|---|---|---|
| 상담 전 톺아보기 | **15초 다시보기** | `<case>/briefing`의 페이지명과 같은 목적지를 여는 링크/버튼 |
| 오늘 상담 기록 | **상담 기록하기** | `<case>/records/new`의 페이지명과 작성 진입 행동. 기록 목록과 구별한다 |
| 첫 상담 기록 | **인테이크 작성하기** | `<case>/records/intake`의 페이지명과 진입 행동. 같은 화면을 여는 `첫 상담 기록 시작하기`도 이 이름을 사용한다 |
| 사례 종결 | **상담 종결** | 현재 client의 종결 패널과 대응하는 종결 화면 제목. 사례를 닫는 기존 단위와 보존 시계는 유지하며 상담 한 회차 종료로 바꾸지 않는다 |
| AI 정리 검토 | **AI가 정리한 내용 검토하기** | `<case>/records/:sessionId/review`의 페이지명과 검토 진입 행동. 승인·반려·대조 기능은 유지한다 |
| 내 정보/기관 모듈 | **내 정보, 환경설정** | 개인 화면 `내 정보`는 유지하고 기관 설정 영역의 표시 호칭을 `환경설정`으로 쓴다. 아래 묶음명 해석을 따른다 |
| 감사 기록 | **열람 기록** | `/settings?module=audit`의 페이지·메뉴·해당 패널 제목. 조회되는 감사 사건과 권한을 축소하지 않는다 |
| 기관 상담 기억 | **상담 기록 처리 현황** | `/settings?module=memory`의 페이지·메뉴·해당 패널 제목. 처리 대상과 설정 동작은 유지한다 |
| 연결 상태 | **AI 연결 설정** | `/settings?module=system`의 페이지·메뉴명. 현재 연결 확인 기능만 유지하며 새 설정 쓰기 기능을 추가하지 않는다 |

**묶음명 해석:** 원본 시안 `inbox/2026-09-13/relayer-wireframes-changes-only-2026-09-12.html:153-166`의 `내 정보 · 기관 모듈`은 여러 설정 화면을 설명하는 묶음명이다. 실제 client는 `/settings`의 `account`와 각 `?module=`을 구별한다. 따라서 개인 페이지 제목을 `내 정보, 환경설정`으로 합치거나 새 환경설정 페이지/모듈을 만들지 않는다. 기존 `기관 모듈`을 가리키는 묶음·설명 호칭만 `환경설정`으로 바꾼다. 현재 없는 메뉴 묶음의 신설, 합치기와 재배열은 이번 페이지명 변경에 포함하지 않는다.

**설정 하위 세 화면:** Q가 함께 열거한 연결 상태, 기관 상담 기억, 감사 기록은 각각 `system`, `memory`, `audit` 목적지를 유지한다. 새 명칭은 AI 연결 설정, 상담 기록 처리 현황, 열람 기록이며 세 화면을 하나로 합치거나 입력 순서대로 메뉴를 재배열하지 않는다.

**재사용할 표시 경로와 후속 수정 대상**

- `apps/client/src/business/navigation.ts:14-31,76-87`의 기존 destination 제목을 먼저 맞춘다. `apps/client/src/app.tsx:52-56,183-203`은 그 제목을 브라우저 탭, 단일 `PageTitle`, 메뉴에 소비하므로 별도 제목 사전이나 새 라우트를 만들지 않는다.
- 같은 목적지를 직접 적은 곳은 `screens/records.tsx`의 작성/검토/종결 제목과 이동 버튼, `screens/schedules.tsx`의 브리핑·작성·검토 진입과 로딩 안내, `screens/report.tsx:172`, `screens/participants.tsx:161,421`, `screens/intake.tsx:176,185`다. 실제 반영 시 최신 인계 SHA에서 다시 위치를 확인한다.
- 설정은 `screens/settings.tsx`의 `AuditModule` 및 `system` 분기, `business/settings-modules.tsx`의 `MemoryModule` 제목을 기존 navigation 표시와 맞춘다. 개인 `AccountModule`의 `내 정보`는 그대로다. `기관 상담 기억 사용`처럼 기능을 설명하는 설정 이름을 `상담 기록 처리 현황 사용`으로 기계 치환하지 않는다.
- `첫 상담 기록이 있는 사업`, `저장된 첫 상담 기록`, 기록 데이터의 날짜 라벨처럼 자료 자체를 가리키는 문장은 페이지명이 아니다. 일반 명사·상담 유형·기록 형식과 과거 결정 문서를 일괄 치환하지 않는다. 제목을 참조하는 안내와 접근성 이름만 같은 목적지 이름에 맞게 자연스럽게 고친다.
- 기존 웹의 동일 기능 화면이 노출되는 경우 DESIGN 레인이 실제 `PageTitle`과 이동 라벨을 대조한다. 예를 들어 legacy 종결 화면의 `케이스 종결`은 같은 목적지의 옛 표시이며, 이를 이유로 `closeSupportCaseAction`이나 `/close`를 바꾸지 않는다. 원본 시안은 보존하고 새 승인 명칭만 후속 작업에 전달한다.

**기능 불변 확인:** 열람 기록으로 이름을 바꿔도 `/audit-log`의 변경·복호화·반출 사건, append-only와 다운로드 감사 범위는 그대로다. 상담 기록 처리 현황이라는 제목이 전체 STT/AI 일감 대시보드 구현을 뜻하지 않으며 기존 기억 입력 차단과 설정 범위를 유지한다. AI 연결 설정이라는 제목만으로 provider/STT 모드 쓰기나 활성화 권한을 추가하지 않는다.

**후속 수용 기준:** 같은 URL과 query로 들어갔을 때 해당 목적지의 페이지 제목·브라우저 탭·메뉴·진입 버튼이 위 표와 일치한다. 직접 진입, 새로고침, 뒤로가기와 역할별 허용/거부는 기존과 같아야 한다. `AI가 정리한 내용 검토하기`와 `상담 기록 처리 현황`처럼 긴 이름은 실제 1280/767/390 화면에서 잘림·겹침 없이 읽혀야 하며 CSS 기준이나 글자 크기를 임의로 낮추지 않는다. 현재 client 종결은 `records.tsx:218`의 패널이므로 제목 변경을 핑계로 별도 client `/close` 라우트를 만들지 않는다.

**소유와 검증:** 앱 화면 적용은 frontend, 공유 UI와 기존 웹 적용은 DESIGN의 명시적 인계 범위에서 수행한다. 실제 반영 전에는 `navigation.test.ts` 등 현행 검사의 목적지·권한 계약을 확인하고 단순 문구 고정을 새 단어에 기계적으로 재고정하지 않는다. PLANNER는 이 인계 파일의 문서 검수와 정상 pre-commit만 수행하며 제품 build/typecheck/tests/browser/배포와 오케스트레이터 메시지는 실행하지 않는다. 이번 문서 저장은 화면 반영 완료가 아니다.

### 해석 경계

1. **설치 기본값과 권고 조합은 다르다.** `sttMode=off`, `sttEngine=null`, `llmMode=off`를 유지한다. S-N §6은 품질 확인 뒤 Azure 서울을 기본 권고하고 Q 승인 뒤 파일럿에 사용하며 기관 관리자가 명시적으로 켜는 방향을 확정했다. 자동 전환 금지, 별도 원음 전송 동의, S13과 기관 선택 관문은 유지한다. 후속 그릴링 B안에 따른 파일럿 자동 전사 범위는 [S13 §1](../../specs/S13-stt-qualification-v2.md#1-범위와-세-단계)의 2인 상담이다.
2. **저장 위치와 AI 반출은 다른 축이다.** Community Cloud는 STT와 LLM을 꺼도 기록을 기관 밖의 Supabase에 저장한다. `internal_only` 설명은 외부 STT/LLM 처리 제한을 말해야 한다. “상담 자료가 기관 밖으로 나가지 않는다”는 문장은 저장 모드까지 확인하지 않고 쓰지 않는다.
3. **가린 글은 익명 자료라는 보장이 아니다.** S-P의 “이름과 주소만”은 NER 범위와 전체 파이프라인을 구별해 설명한다. 현재 코드에는 등록값 치환, 전화/계좌/이메일 등 규칙과 질환 사전도 있지만 모든 건강/피해 서술을 제거한다는 품질 보장은 없다. 구조화 선택값이나 수기 기록도 민감정보/재식별 가능성에서 자동 면제하지 않는다.
4. **국내 리전은 법적 면제 판정이 아니다.** Azure 고지는 “외부 사업자의 서울 리전 처리”로 쓴다. 계약 상대 법인, 해외 지원 접근과 화자 분리의 법적 분류는 확인 대상으로 남긴다. “국외 이전 아님”, “법적 검토는 이것만 남음”을 확정 문장으로 옮기지 않는다.
5. **9월 18일은 선행조건을 없애는 근거가 아니다.** S-P §8은 문서/운영 정정 범위이고 S-H A6은 기존 W11의 기능 작업이다. 월간 집계, 암호화, LLM 교정이나 새 provider를 문안 변경으로 가장하지 않는다. 후속 B2~B5와 로컬 LLM, 관계 가명, LLM 교정은 각각 해당 미결 결정 뒤에만 구현한다.

### 원본 작업별 연결

이 표의 완료는 **계획 준비의 완료 조건**이다. 구현 완료나 승인 기록이 아니다.

| 원본 ID | 기존 W/실행 티켓 | 수정 범위와 필요한 관문 |
|---|---|---|
| S-H A1 | W01→W11→W13, CCC-234/CCC-209 | `packages/contracts/src/consent.ts`의 6영역 고지와 `program-admission.ts`의 D87 설명을 각각 정본으로 쓴다. 문안/버전/hash/재동의 영향을 확정한 뒤 화면과 발급 스냅샷을 함께 전환한다 |
| S-H A2 | W11/W13, CCC-192/CCC-272 | `docs/consent/consent-draft-v0.md`, 법률 패킷, 공개 `/welcome`, system/보유기간 안내에 서로 다른 저장/처리/삭제 기간을 구분한다. 구 2종 동의와 현행 6영역을 합치지 않는다 |
| S-H A3 | W01 G8/W13, CCC-157/CCC-189 | `docs/consent/legal-review-open-items-v1.md`의 기존 4/5/7/8/11번에 S-P §10의 4건과 S-H Q1~Q3을 연결한다. S-H A3의 “세 항목”을 §8 전체 6건으로 오인하지 않는다. Q4~Q6은 아래 후속 provider 조사로 남긴다 |
| S-H A4 | W12/W13, CCC-250 | `docs/specs/S13-stt-qualification-v2.md` §7.2에 실제 구독 계약 형태, 적용 DPA/Product Terms 판본과 학습 미사용 조항 위치, 확인자와 증빙을 요구한다. 공개 Learn 설명만으로 기관 계약 확인을 대체하지 않는다 |
| S-H A5 | W01, 총괄 작성권 | 승인 후 결정 기록을 연결한다. 현재 main의 D90은 초대 신원 결속, 총괄 ADR-0049의 D90은 카드 계약이다. S-H의 가칭 D91과 새 공공형 ADR-0049를 예약하지 않는다. 총괄이 반영 순서와 새 번호를 정하고 참조를 함께 옮긴다 |
| S-H A6 | W01 G8→W11, CCC-209 | 기존 `GET /audit-log`, `listAuditLog`, `SettingsScreen`의 `AuditModule`을 확장한다. 월간 범위/사건 단위/당시 담당 여부/권한/다운로드 계약은 아래와 같다. 서버 생산자를 먼저 확정한다 |
| S-H B1 | W12/W13, CCC-250/CCC-236 | S13의 사람 모의상담 6파일, 독립 정답, 파일별 외부 전송 허락과 비용, CER/반복률/DER/총 응답시간/단가를 그대로 쓴다. 연결 성공이나 CPU 합성 결과로 품질을 대신하지 않는다. signed registry 변경은 별도 Q 승인 뒤다 |
| S-H B2 | W01 G8, 신규 티켓 미발행 | `ProgramProcessingMode`의 `external_allowed/internal_only/undecided`를 지금 늘리지 않는다. “국내 외부 허용”은 저장과 처리 위치/계약을 분리한 ADR 및 어댑터 계약 뒤에 결정한다. 예약 컬럼/enum만 먼저 만들지 않는다 |
| S-H B3 | W01/W13, 신규 티켓 미발행 | 공공형은 PostgreSQL/Identity/AudioStore/Scheduler/배포 프로필의 결정안으로 준비한다. 기존 7포트를 재사용하고 Supabase 자체 호스팅이나 새 범용 프레임워크를 이번에 만들지 않는다. Q4 동의 사례와 Q6 실제 요금은 조사 근거이며 승인 증거가 아니다 |
| S-H B4 | W01→W12/W13, 신규 티켓 미발행 | B3와 Q5의 장문 인식 공공 존 제공/보관/학습 약관 확인, 동의/provider/registry 계약 뒤에 CLOVA Speech 어댑터를 검토한다. `sttMode=clova`를 먼저 추가하지 않는다 |
| S-H B5 | W01→W12/W13, 신규 티켓 미발행 | B3와 구조화 JSON/근거 검증/수령자/보관 조건의 계약 뒤에 CLOVA Studio를 검토한다. `llmMode`나 활성 provider를 지금 바꾸지 않는다 |

S-P의 나머지 요청도 다음 위치에 보존한다.

| 원본 구간 | 연결과 판정 |
|---|---|
| §8 제출 전 1/4행 | W13/CCC-192에 구현된 코드, 레인 WIP, 계획을 구별한 암호화 범위 표를 넣는다. “구현 중”은 실제 담당 레인의 인계가 있을 때만 쓴다 |
| §8 제출 전 2/3/5/6행 | A1/A2/A3에 Azure의 외부/국내 표현, OpenAI 보유 예외, 민감 서술 잔류, 실제 파기 대상과 고지의 일치를 포함한다 |
| §8 제출 전 7/8행 | S-N §6은 동석자 녹음을 허용하고 동의는 실무자가 받도록 확정했다. 후속 그릴링 B안은 파일럿 자동 전사를 2인 상담으로 제한한다. 녹음 허용을 외부 전송 동의로 재사용하지 않으며, 설치 off와 기관별 AI 활성화 관문은 유지한다 |
| §8 제출 후 암호화 | 아래 R1~R10의 범위와 W01/W13 데이터 전환 계약으로 연결한다 |
| §8 제출 후 가림 v2 | W06/G7/CCC-237/CCC-238에 번호, 기관 종류, 나이/지역, 상대 날짜, 전송 전 검사를 연결한다. 관계 가명은 현행 G8에서 제외돼 있으므로 별도 결정을 요구한다 |
| §8 제출 후 LLM 교정 | S-N §6에 따라 “기관 PC 음성 인식 뒤 AI로 글 다듬기”를 설명서의 계획 칸에 넣는다. 구현은 제출 후이며, W01/G7에서 원전사 불변, 교정본의 별도 계보/검토/출력검사/비용/egress 계약을 정한 뒤 W12로 독립 평가한다. 계획 표기를 구현·설계 상세 확정으로 승격하지 않는다 |
| §8 제출 후 리전 검사 | B1의 기존 `test_azure_stt.py` 요청 검사와 `test_trial_server.py`의 리전 literal 검사를 재사용한다. 새 한 줄 검사를 무조건 추가하지 않고 실제 전송 경계의 누락만 보강한다 |
| §8 제출 후 고령/사투리 품질 | B1/W12의 미측정 하위집단으로 명시한다. S13 6파일을 해당 집단 검증이라고 주장하지 않으며 별도 자료/허락/정답과 표본 구성을 먼저 정한다 |
| §9 Q1 | S-N §6에서 “고유명사는 일반명사로 적기”를 승인했다. W11의 운영 지침과 첫 사용 안내에 넣는다. 자동 변환 전까지 화면 안내를 둘지는 frontend/DESIGN 인계에서 검토한다 |
| §9 Q2/Q3 | LLM 교정의 계획 표기와 Azure 품질 확인 뒤 파일럿 사용은 S-N §6으로 확정됐다. 구현 상세, 계약 확인과 제품 활성화의 별도 관문은 유지한다 |
| §10 1~4 | A3에서 신용정보 법 적용, Azure 계약/지원, 잔류 민감정보 전송 동의, 제3자 정보 근거를 각각 보존한다 |

### Q 추가 요구: HWPX·DOCX·CSV 업무 반출 구현

2026-09-13 그릴링에서 Q는 문서 내보내기를 기능 구현 요구로 추가하고, 대상은 **경과 리포트 + 선택한 회차의 상담 기록 + 첫 상담 기록(B안)**으로 확정했다. 파일 형식도 후속 B안으로 **HWPX(.hwpx), DOCX(.docx), CSV(.csv)**를 선택했다. 문서형 출력은 대상 기관의 한글·Word에서 열고 편집돼야 하며, 해당 문서에서 표로 정리할 수 있는 항목은 CSV로 제공한다. 구형 `.hwp`와 `.doc` 동시 지원은 이번 필수 범위가 아니다. 기존 W11의 인쇄/JSON 내보내기에 이 요구를 추가하고 W13에서 실제 파일을 검증한다. 세부 서식은 기존 문서·디자인 규칙에 따라 DESIGN 레인에서 마련하고 출고 배치는 총괄이 정한다.

사업 단위 표의 일반 CSV 내보내기는 이번 문서 반출 묶음에서 제외한다. 이는 별도로 계획한 A6 월간 감사 집계·보고서 요구를 취소하는 결정이 아니다. 선택하지 않은 회차를 함께 반출하거나 첫 상담 기록을 경과 리포트의 일부 요약으로 대신하지 않는다.

| 확정 형식 | 구현 요구와 수용 기준 |
|---|---|
| HWPX (.hwpx) | 대상 기관의 한글에서 실제 열고 편집할 수 있는 HWPX 파일을 생성한다. 문단, 표, 줄바꿈과 페이지 구성을 검증하며 HTML/텍스트의 확장자만 바꿔 납품하지 않는다 |
| DOCX (.docx) | 대상 기관의 Word에서 실제 열고 편집할 수 있는 DOCX 파일을 생성하고 같은 공식 자료와 서식을 유지한다. 확장자만 바꾼 HTML/RTF로 대체하지 않는다 |
| CSV (.csv) | 확정한 표의 머리글과 행을 내보낸다. Excel에서 한글, 쉼표·따옴표·줄바꿈, 날짜·번호가 의도대로 읽히는 경로와 수식으로 오인될 수 있는 셀의 안전 처리를 검증한다. 여러 시트나 문서 페이지 서식을 가진 XLSX와 같은 파일이라고 설명하지 않는다 |

- 생산자는 기존 gateway의 권한·공식 기록 조회를 재사용한다. 경과 리포트는 `packages/core/src/gateway.ts`의 `getSupportCaseReport`와 `packages/contracts/src/report.ts`의 `SupportCaseReport`를 출발점으로 삼고, 기존 `exportCase`/HTTP JSON 반출과 중복 정본을 만들지 않는다. 파일 생성 때문에 새 AI 호출이나 DB 직접 접근을 추가하지 않는다.
- 소비자는 `apps/client/src/business/report.ts`의 `ReportApi`와 `apps/client/src/screens/report.tsx`의 `ReportScreen` 등 확정된 대상 화면이다. 코어/HTTP 레인이 데이터·형식·거부 계약을, frontend가 다운로드 동작을, DESIGN이 공유 UI와 문서 서식을 소유한다. 실제 담당자와 겹치는 파일의 단일 작성자는 총괄이 배치 전에 지정한다.
- 첫 상담 기록은 core mini가 소유한 versioned intake 계약을 소비한다. 저장된 기록의 버전, 항목, 무응답 의미를 유지하며 옛 기록을 새 양식으로 조용히 재해석하지 않는다. 이 반출 요구를 이유로 PLANNER가 입력 계약이나 `apps/client`를 직접 수정하지 않는다.
- [S10 §1.1](../../specs/S10-cccx-format.md#11-업무-반출물과의-경계)의 Q 결정대로 복구·이전 파일은 암호화하고 업무 반출물은 기존 권한, 최소 정보와 다운로드 감사를 전제로 일반 파일을 허용한다. 발송 기록 보류와 별도 작성 의무를 두지 않는 범위도 같은 절을 따른다. 원음·키·미승인 AI 결과에 새 반출 권한을 주지 않는다. 변환을 위해 상담 원문을 임의의 외부 문서 변환 서비스에 보내지 않는다.
- 같은 대상과 revision을 내보낼 때 형식별 내용, 누락 사유와 공식화 상태가 일치해야 한다. 다운로드의 권한과 파기 상태, 아카이브 제한을 확인하고 임시 생성물이 원문·파생자료 파기 범위에서 빠지지 않도록 한다.
- 실제 한글/Word/Excel에서 열기, 표와 한글의 보존, 빈 자료·긴 자료·잘못된 권한·파기된 대상·생성 실패를 검증한다. 확장자/MIME 검사나 synthetic fixture만으로 파일 호환성을 통과 처리하지 않는다.

업무 반출 허용은 내려받는 시점의 권한에 관한 결정이다. 최종 파기된 대상에서 새 업무 반출물을 만들거나 과거 생성물을 다시 제공하지 않는다. 백업 재등장 방지는 Q가 후속 A안으로 정한 [S10 §6.1](../../specs/S10-cccx-format.md#61-최신-파기-내역을-반영하는-복원)의 최신 파기 내역 반영·검증 후 업무 개방을 따른다. 이미 내려받은 사본의 처리 절차와 공급자 백업의 물리적 삭제는 이 결정과 별개이며, 정책 기록을 실제 구현 완료로 보고하지 않는다.

### Q 확정: 최종 파기는 원문과 연결 가능한 파생자료까지

그릴링 A안으로 금고에 한정하지 않고 해당 대상의 원문과 연결 가능한 파생자료까지 파기하며, 재식별 위험을 점검한 집계 통계와 내용 없는 감사 기록만 남기기로 했다. 정본은 [ADR-0010 후속 결정](../../adr/0010-archive-before-purge.md#2026-09-13-후속-결정-원문과-연결-가능한-파생자료까지-파기한다)이다. W01 G8은 이 범위를 다시 선택하는 질문이 아니라 파기 대상/공유 자료/집계의 계약으로 구체화하고, W13은 실제 삭제와 복구 후 재등장 방지 증거를 요구한다. 현재 코드가 원문까지 파기한다고 보고하지 않는다.

복구는 오래된 백업 사용을 허용하되 별도 보호된 최신 파기 내역을 먼저 적용·검증하는 A안으로 확정됐다. 최신 내역이 없거나 확인할 수 없으면 업무를 열거나 복구 완료로 보고하지 않는다. 원본 백업의 hash 검증과 파기 반영 뒤의 정합성 검증을 분리하며, 이 정책은 총괄 G7의 파기한 대응표 재생 방지와 함께 소비한다. 상세 구현은 해당 복구 레인 소유이며 PLANNER가 pipeline/Windows를 실행하지 않는다.

### A1/A2: 고지 생산자와 버전 전환

**수정 파일과 단일 작성자 제안**

- 코어/계약 레인: `packages/contracts/src/consent.ts`의 `CONSENT_COPY`, `CONSENT_COPY_VERSION`, `consentCopyPreimage`; `program-admission.ts`의 `PROGRAM_ADMISSION_COPY`와 버전. `gateway.ts`의 발급/검증/사업 확인 경계를 같은 작성자가 맡는다.
- frontend 레인: `apps/client/src/business/consent.ts`의 `ConsentApi`/`consentEventFrom`, `consent-panel.tsx`, `consent-decisions.tsx`, `screens/settings.tsx`의 `system`, 사업 등록 소비. 화면은 서버의 `fullKoreanCopy/copyVersion/copyHash/snapshotId`를 표시하고 되돌려 보낼 뿐 별도 고지 원문을 만들지 않는다.
- DESIGN 레인: 구 web 동의 화면, 공용 UI, 공개 안내와 디자인 산출물. 구 문안 정본 `packages/contracts/src/consent-notice.ts`와 연결된 `docs/consent/consent-draft-v0.md`는 현행 6영역과 다른 계약이므로 코어와 DESIGN이 한 출고 묶음으로 정합을 맞춘다.
- 문서 레인: 위 두 정본을 반영한 설명서/의뢰 목록을 작성한다. S-H의 “동의 문안 3종”만 고치고 실제 6영역 발급 고지를 놓치지 않는다.

**현재 계약에서 확인한 영향**

- `gateway.ts:7664-7691`은 현재 버전/hash가 아닌 grant를 유효 동의에서 제외한다. `CONSENT_COPY_VERSION`은 6영역 공통이므로 버전 하나를 올리면 개인 수집 동의까지 재확인 대상이 될 수 있다. “설명만 바뀌며 수기 업무에는 영향 없음”이라고 약속하지 않는다.
- `gateway.ts:7998-8001`은 구 고지 제출을 `consent_disclosure_mismatch`로 거부한다. `gateway.ts:13935-13946`은 D87 설명 버전/hash가 다르면 `notice_changed`이며 차단 응답은 `program_admission_required`다. 현재 거부 코드와 fail-closed 7코드를 유지한다.
- `ConsentDisclosureSnapshot`과 `AppendConsentEventInput`의 scope, 수령자, 국가, 목적, 기간, revision을 그대로 보존한다. 기관 계약의 국가 필드를 물리 리전만 보고 `KR`로 덮어쓰지 않는다.

**반영 순서**

1. Legal/총괄이 확정 문안, 수령자 근거, 재동의 대상과 업무 중단 영향을 닫는다. 공통 버전의 전체 재확인과 영역별 버전 분리는 다른 계약이다. 영역별 변경으로 조용히 우회하지 않는다.
2. 확정 원문에서 기존 `consentCopyPreimage`/hash 계산 경로로 새 발급본을 만든다. 구 event/snapshot을 UPDATE하거나 hash를 수기로 쓰지 않는다.
3. core/HTTP와 frontend가 같은 고지/거부 계약으로 전환된 후 기관 관리자의 사업 재확인, 당사자의 필요한 재동의를 받는다. 과거 grant를 자동 승격하지 않는다.
4. 재확인 전의 기존 자료 열람/수기 쓰기/신규 등록/원음/AI 각각에 실제 차단 범위를 검증한다. 실패하면 외부 처리는 off로 두고 버전/자료가 맞는 복구 경로를 사용한다. 이전 프로그램으로 되돌리는 것만으로 새 동의 이력을 지우거나 옛 grant를 복원하지 않는다.

**문구 제안, 아직 발급하지 않음**

- OpenAI: “AI 정리에는 가림 처리한 글을 보냅니다. 이름 등을 가려도 건강이나 피해 경험 같은 내용이 남을 수 있습니다. 응답을 저장하지 않도록 요청하지만, 오남용 감시 로그는 기본적으로 최대 30일 보관될 수 있고 법적 의무나 위해 방지를 위해 더 오래 보관될 수 있습니다.”
- Azure: “음성 인식을 켜면 가리기 전 녹음 파일을 외부 사업자 Microsoft의 서울 리전으로 보냅니다. 현재 사용하는 Fast Transcription에 대해 사업자는 입력 자료를 보관하지 않는다고 안내합니다. 외부 음성 처리 동의와 기관 확인, 제품 승인 조건을 충족해야 켤 수 있습니다.”
- Supabase: “Community Cloud의 상담 기록은 기관 소유 Supabase 서울 프로젝트에 저장합니다. 저장소의 기본 암호화와 앱이 적용하는 항목별 암호화는 범위가 다릅니다. 자료 열람은 기관의 권한과 키 관리 규칙을 따릅니다.” 배포기관의 접근 불가를 주장하려면 기관별 실제 키/접근 보유 근거가 따로 필요하다.
- 원음: provider의 처리 후 비보관과 우리 `AudioStore`의 삭제를 분리해 쓴다. D85의 업로드 후 7일 절대 상한, 첫 실제 처리 기회 뒤 `min(기회+24시간, 절대 상한)`, 처리 뒤 삭제와 실패/무기회 경로를 숨기지 않는다. OpenAI의 로그 보유기간과 원음 기간을 합치지 않는다.

### A6: 월간 감사 집계의 제안 계약

현재 `AuditModule`은 `getAuditLog({limit:20})`의 첫 페이지를 표시한다(`screens/settings.tsx:30-67`). 서버 `listAuditLog`는 기관 관리자 전용의 메타데이터 페이지이며 `detail`을 내보내지 않는다(`gateway.ts:11891-12067`). 이 20건을 월간 전체나 고유 당사자 수로 부르지 않는다.

- W01에서 확정할 **제안 경로**는 `GET /audit-log/summary?month=YYYY-MM`다. 기존 gateway 안에 집계 조회를 두고 `packages/http-api/src/request-handler.ts`가 호출한다. 브라우저에서 모든 감사 행을 다운로드해 세지 않는다. 이는 아직 존재하는 API가 아니다.
- 제안 응답은 `{month, timeZone, from, toExclusive, generatedAt, counts:{unassignedReadEvents, decryptEvents, exportEvents}, unclassifiedReadEvents}`다. 월은 기관 시간대의 월초부터 다음 월초 직전이며 건수는 사건 수다. 복호화한 칸 수, 고유 당사자 수, 실무자 성과 점수로 해석하지 않는다.
- 성공한 비담당 열람과 `deny_access`를 구별한다. 당시의 담당/감독/관리자 접근 근거가 있는 사건만 분류하고, 없는 과거 행은 `unclassifiedReadEvents`로 센다. 현재 담당 표를 JOIN해 과거 담당 여부를 소급 추정하지 않는다. 필요한 당시 근거는 기존 감사 메타데이터에 개인정보 없이 남기는 방안을 코어 소유자가 확정한다.
- 응답/다운로드에는 상담 본문, 개인정보, 원문 인용과 상세 감사 `detail`을 싣지 않는다. 기존 기관 관리자 전용 범위를 유지하고 기술 관리자에게 새 열람 권한을 주지 않는다. 다운로드 형식과 받는 사람은 G8에서 확정한다.
- frontend의 월 선택/다운로드와 DESIGN 검수는 서버 계약 뒤에 이어진다. 월말/윤년/시간대 경계, 같은 사건 중복 계수 방지, 재조회로 집계 자체가 늘지 않는지, 비담당 열람과 거부 구별, 과거 불명확 건수, 기관 격리를 검증한다.

### S-P R1~R10: 저장 암호화 확장 준비

현재 코드의 존재와 실제 배포/복구 검증은 다르다. 아래는 `ad218e8e`의 코드 경계이며 다른 레인의 완료 판정이 아니다.

| 원본 규칙 | 재사용할 구현과 필요한 결정 |
|---|---|
| R1 두 겹 | Supabase at-rest와 앱 암호화를 구별한다. `gateway.ts:1436-1493`의 금고 AES-GCM을 재사용하되 저장소 관리 권한/복구 경로까지 막는다고 설명하지 않는다 |
| R2 범위 | 금고 8컬럼과 `sessions` 메모/전사/요약, intake/record JSON, 목표/약속/인용, AI snapshot/기억 파생물, 원음을 각각 분류한다. 자유 글 컬럼 암호화는 새 저장 계약이다. Local의 암호화 DB/원음 어댑터까지 “평문”이라고 쓰지 않는다 |
| R3 키 위치 | `SecretStore`와 S9의 런타임별 키 소유를 재사용한다. `b43f7d13`의 G7대로 Agent에 금고 키를 복제하지 않고 기존 금고/키 보호 아래 대응표를 둔다. Cloud 업무 API의 env 주입을 Agent-only 복호화라고 설명하지 않는다. 기존 키 경계를 바꾸는 다른 설계는 이번 확정에 포함하지 않는다 |
| R4 키 버전 | 금고 `key_version`과 원음 header의 `keyVersion`은 이미 있다. 그러나 `decryptPii`는 행별 구 버전 키를 선택하지 않고 활성 키를 쓴다. 다세대 읽기/회전/폐기/유실 처리 계약을 정한 뒤 기존 자료를 보존하며 전환한다 |
| R5 AAD | 금고 암호화에는 AAD가 없다. `adapters/audio-file/src/format.ts`의 header/record AAD와 Recovery Kit의 AAD를 재사용 근거로 삼는다. 새 컬럼 봉투의 기관/대상/행/필드/버전 결속과 교체 거부를 확정한다 |
| R6 검색 | 필요한 검색 필드와 허용 유출을 먼저 결정한다. HMAC 블라인드 인덱스를 예방적으로 추가하지 않는다. 필요하면 별도 키와 회전/삭제 전파를 같은 계약에 포함한다 |
| R7 파일 | Local `createFileAudioStore`는 암호화된 파일 계약을 갖는다. Cloud의 `adapters/audio-signer`와 `apps/community-cloud/src/storage-signer.ts`는 본문을 받지 않는 서명 업로드 경계다. Cloud 앱 암호화는 한 env 추가가 아니라 클라이언트 업로드, Agent 다운로드, 원음 hash/receipt 경계 변경이다 |
| R8 사본 | Q가 업무 반출물과 복구·이전 파일의 구별 및 최신 파기 내역을 반영하는 복원을 각각 A안으로 확정했다. [S10 §1.1](../../specs/S10-cccx-format.md#11-업무-반출물과의-경계)과 [§6.1](../../specs/S10-cccx-format.md#61-최신-파기-내역을-반영하는-복원)을 따른다. `.cccx`, Recovery Kit, DB/원음 백업과 복원은 CCC-249 및 S9/S10의 해당 소유 레인에서 구현·검증한다 |
| R9 로그 | 기존 메타데이터 감사와 고정 오류를 유지한다. 암호/키/원문을 검사 출력에 내보내지 않는다. CLI, 오류, 브라우저 저장, 다운로드와 백업 증거에 같은 경계를 적용한다 |
| R10 세 모드 | `adapters/db-sqlite`, `adapters/audio-file`, `adapters/secrets-dpapi`의 존재를 Local Single/Office 완주로 승격하지 않는다. 실런타임 구성, 실제 Windows 키/재시작/복구와 DB parity를 각 레인이 증명한다 |

생산자/소비자는 `packages/contracts/src/runtime.ts`의 `Database`, `AudioStore`, `SecretStore`, `RecoverySecretStore`, `VersionedSecretBytes`를 재사용한다. 저장 변경은 core/DB/설치 레인이 한 봉투/키 버전 계약으로 작성하고, Cloud 업로드 변경은 frontend 및 Agent와 명시 인계한다. 새 포트, 이름만 있는 컬럼, 적용된 migration 수정은 하지 않는다.

전환은 W01의 승인된 포맷/키 보유자 확정 → 기존 자료와 키의 복구 가능한 백업 → SQLite/PostgreSQL forward migration → 생산자/소비자 동시 배치 → 새 자료 읽기/변조 거부/기존 자료 복구 스모크 순서다. rollback은 새 암호문을 구 코드가 평문으로 읽지 않도록 읽기 전용 또는 명시 거부 경계를 포함한다. 실제 복구 경로가 준비되지 않으면 자료가 있는 설치를 변경하지 않는다.

### W06: 가림과 AI 재료의 변경 경계

- Agent의 `masking.py`/`worker.py`/`results.py`와 core의 `commitMaskedResult`, `loadAiCallMaterialsForService`, 기억 proof 검증을 하나의 계약으로 대조한다. 현재 server 치환과 Agent 출력 hash의 결합을 고려하며 core가 본문을 재작성해 offset/hash를 “수리”하지 않는다.
- 번호 대응표와 날짜 처리는 `b43f7d13`의 G7을 따른다. 사례별 금고 수준 보호, 일반 화면 비노출, 기존 개인정보 보존·파기 연동, 신규 이름/기관의 별도 기관 내부 등록, 모호한 동일인의 일반 가림 유지와 생년월일 상대 변환 금지를 그대로 유지한다. Agent에 금고 키를 복제하거나 일반 결과 객체에 원문/대응표를 싣지 않는다. W06이 S5/S6 버전·manifest·재마스킹과 검증을 소유하며, 새 복구 정책은 이미 파기한 대응표를 되살리지 않는 조건을 구체화한다.
- 구조화 입력을 “안전하므로 바로 전송”하지 않는다. 허용 material 범위, 가림 snapshot, revision/hash/근거 offset, 동의/보존 전파를 먼저 확정한다. LLM 교정은 현재 `generate/regenerate/detect_discrepancies`와 별도 재료/동작 계약이며 원전사와 근거를 덮어쓰지 않는다.
- `S6-privacy-packet.md`의 요구 필드/허용 version-hash 쌍/egress 계약과 실제 구현을 구별한다. `test/privacy-packet.test.ts`와 `test/agent-privacy-linearization.test.ts`는 현재 기준에 없으므로 명령 이름만으로 검증됐다고 쓰지 않는다. CCC-238의 실제 소비 구현과 필요한 새 회귀는 그 소유자가 맡는다.
- CCC-237의 기존 미통과 NER/긴 입력 증거를 선행으로 유지한다. 사전 치환/정규식 검사 통과, 자기 fixture, 소스 코드의 함수 존재로 이를 대신하지 않는다.

### 실행 시 수용 기준과 표적 명령

아래 명령은 **후속 구현 레인의 실행 지시**이며 이번 PLANNER가 실행한 제품 검사가 아니다. 코드 작성이 끝난 레인만 독립 스모크를 하고, 공유 통합 검사는 총괄의 단일 슬롯에서 실행한다.

```sh
# 동의 발급/구 버전 거부, 사업 재확인과 감사 권한
pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/participant-consent.test.ts apps/api/test/preregistration-consent.contract.test.ts apps/api/test/consent-privacy-gate.test.ts apps/api/test/program-admission.routes.test.ts apps/api/test/audit-log.routes.test.ts

# 가림 조립/근거와 Agent의 표적 회귀 (apps/pipeline에서)
python3 -m unittest tests.test_masking tests.test_api_client_worker tests.test_results

# Azure 요청 경계와 공개 상태의 기존 검사 (apps/pipeline에서)
python3 -m unittest tests.test_azure_stt tests.test_trial_server

# 기존 암호화 어댑터 계약. 통과해도 기관 복구/키 회전 완주의 증거가 아님
pnpm test:contracts --audio-store
pnpm test:contracts --db=sqlite
pnpm test:contracts --secrets-env
```

실화면/API 스모크는 다음을 고정한다.

1. 합성 기관에서 새 고지 발급 → 실무자/당사자 동의 → 수기 저장/조회, 외부 축 거부 → 원음/AI 차단, 구 스냅샷 제출 거부, 관리자 사업 재확인 전후의 실제 상태를 확인한다. 외부 AI를 실제 호출하지 않는 구조 검사와 실데이터 허가는 별개다.
2. 기관 관리자에게만 월간 감사/다운로드가 열리고, 비담당 성공 열람과 접근 거부/복호화/내보내기 사건을 미리 정한 수대로 만든다. 20건을 넘는 달, 월 경계와 당시 담당 정보 없는 옛 행을 포함한다. UI와 내려받은 결과가 같은 서버 범위를 표시해야 한다.
3. 암호화 변경은 실제 저장물에 평문이 없는지, 다른 기관/행/필드로 교체한 암호문이 거부되는지, 옛 키 자료와 새 키 자료가 함께 읽히는지, 중단 뒤 복구로 자료가 보존되는지 확인한다. 복구 시험에 운영 URL이나 실제 당사자 자료를 쓰지 않는다.
4. STT/가림의 의미 품질은 모델 출력을 보지 않은 정답 작성자와 별도 검토자의 원음/텍스트 정답을 사용한다. 길이/구간/hash 검사는 구조 증거이고 사람 품질/고령·사투리 성능은 별도 측정이다. 결과를 본 뒤 threshold나 정답을 바꾸지 않는다.

새 테스트는 누락된 관찰 계약을 방어할 때만 남긴다. 문구/전달/기본값을 고정하는 기존 검사를 새 문구에 재고정하거나, 어댑터 검사로 전체 제품 PASS를 주장하지 않는다.

### 공개 근거와 남은 확인

다음은 공개 문서 조사이며 실제 계정/계약/서비스 동작 검증이 아니다.

| 근거 | 이번 문안에 적용할 범위 |
|---|---|
| [OpenAI 데이터 정책](https://developers.openai.com/api/docs/guides/your-data) | `store:false`와 오남용 로그는 다르다. 기본 최대 30일에는 법적 의무/위해 방지 예외가 있다. 한국 data residency는 저장과 처리가 다르고 별도 승인 조건이 있다. 현재 global Responses endpoint를 한국 추론으로 설명하지 않는다 |
| [Azure Speech 리전](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions) | resource 리전 밖에서 자료를 저장/처리하지 않는다는 서비스 설명이다. 계약 법인/해외 지원의 법적 판정을 대신하지 않는다 |
| [Speech 데이터/개인정보](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security) | Fast Transcription의 입력 비보관과 화자 분리 신호 폐기를 설명한다. 실시간 STT의 메모리 처리 문장을 Fast Transcription의 “즉시” 보장으로 확대하지 않는다 |
| [Speech 학습/저장 설명](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-encryption-of-data-at-rest) | 고객 자료의 Speech 모델 개선 미사용 설명과 logging/customization 조건을 확인한다. 기관에 적용되는 DPA 조항은 A4/Q2의 별도 증빙이다 |
| [Supabase pgsodium](https://supabase.com/docs/guides/database/extensions/pgsodium), [책임 분담](https://supabase.com/docs/guides/deployment/shared-responsibility-model), [리전](https://supabase.com/docs/guides/platform/regions) | 기본 at-rest 암호화, pgsodium 신규 사용 비권고/폐지 예정, 자료 위치와 규제 준수의 차이를 확인한다. 폐지 날짜, 법적 적합성, 배포기관 접근 불가를 추정하지 않는다 |

S-H의 CSAP 개편 시점, 선례의 숫자, 서비스별 가격, CLOVA 보관/학습/공공 존 조건은 이 수정안의 확정 근거로 쓰지 않는다. 원본에서 삭제하지 않고 B3~B5의 조사 대상으로 보존한다. Supabase 지원 접근의 DPA 원문은 확보하지 못했으므로 별도 계약 확인이 남는다.

### 이번 계획 준비의 검증

- 갱신 원본에서 뽑은 A1~A6/B1~B5 11개와 R1~R10 10개가 수정안에 모두 연결됐고, 원본 두 파일의 hash는 조사 후에도 같았다. S-P의 제출 전/후, Q 질문과 법률 검토 요구는 별도 대응표로 확인했다.
- 후속 명령이 참조하는 API 검사 파일 5개와 Python 모듈 5개가 실제 경로에 있음을 확인했다. 제품 테스트를 실행한 결과는 아니다.
- `node scripts/guard-doc-numbers.mjs`가 통과했다. 이 검사는 현재 PLANNER 트리의 번호 검사이며 총괄 브랜치와의 D90 충돌 해소를 증명하지 않는다.
- 맥락 없는 독립 읽기에서 지적한 단계별 수정 권한, 새 인계 SHA에서 정본을 가져오는 순서, 필수 스킬의 읽기 경로를 보완했다. 공개 사실은 위 1차 출처와 대조했고, 의미 품질/실런타임/법무 승인은 미검증으로 구별했다.

### Ouroboros 후속: AI/STT/DB 미연결 계약 구체화

**Q가 확인한 목표:** 기존 AI·STT·DB 계획과 코드를 재사용하고, 빠진 연결·검증·복구 계약만 기존 W/E 항목에 연결한 설계 제안으로 구체화한다. 아래 묶음은 새 W나 실행 티켓이 아니라 기존 항목의 계약 준비 범위다. 본문의 파일·심볼은 고정 코드에서 확인했으며 이후 구현 담당자나 최신 미커밋 작업을 뜻하지 않는다.

**근거와 도구:** 정책은 `3dff4d0c`, 코드 조사는 `68968722`다. 독립적인 로컬 Git 조회에서 통합 tip `bb5b47e7`을 확인했고 추가 커밋은 client 영역 접기와 Wire 변경이었다. 두 코드 기준 사이 `packages/ai-runtime/src`, `packages/contracts/src`, `apps/pipeline/ccc_pipeline`, `adapters`, `packages/core/src`, `packages/http-api/src`, `scripts/stt`의 차이는 0건이었다. 제품 검사는 실행하지 않았다. Ouroboros 0.51.15는 설치돼 있으나 MCP SDK v2 부재로 서버가 시작되지 않아 공식 직접 인터뷰 경로를 사용했다. 세 독립 관점의 계획 범위 검토와 Q의 목표 확인을 마쳤으며 자동 모호성 점수와 제품 품질 점수는 측정하지 않았다.

**계획 산출물 검수:** 계획용 Seed `seed_ccc_ai_stt_storage_plan_20260913`은 설치된 `ouroboros.core.seed.Seed` 스키마를 통과했다. 독립 Seed QA는 1회차 `pass`/0.98이고 본문 계약 검수도 PASS다. 이는 문서의 품질 검토이며 자동 모호성 점수나 제품 구현·품질 검증이 아니다. Seed에는 자동 점수 미측정과 제품 실행 불허를 기록했다.

| 영역 | 기존 계획과 재사용 코드 | 확인된 미연결 범위 |
|---|---|---|
| AI | W05~W10/W12, E5-4/CCC-237, E5-5/CCC-238, E5-9/CCC-239. `CodexProviderAdapter`, `AiProviderRequest`, `AiProviderOutput`, `reviewGeneratedAiDraft`, `getSupportCaseReport`가 있다. 기억 입력 차단과 G2 대조 문구 변경도 코드에 있다 | 일반 AI snapshot의 S6 근거 보존·재검증, 새 번호 가림·카드·주제·연결, 장문/부분 결과와 나머지 M7~M11 계약은 완료로 확인되지 않았다 |
| STT | E5-2/CCC-231, E5-3/CCC-236, E5-6/CCC-261, E5-7/CCC-245, E5-8/CCC-250. `build_engine`, Qwen 격리 runtime, `preflight_azure`/`transcribe_azure`, claim-bound worker와 내부 시험 경로가 있다 | 기관별 모드/접속 결속, Windows 설치·임시 파일 복구, S13 v2 평가 실행 경로와 사람·장비·기관 적합성 근거는 별개로 남는다 |
| DB/저장소 | E3, E4-4a/b/E4-5, E6-7/E7-3/E8-5, W01 G8/W13 및 R1~R10. Database, PostgreSQL·암호화 SQLite, 암호화 원음, SecretStore·DPAPI와 Recovery Kit 부품이 있다 | 자유 글 암호화 확장, 행의 키 버전에 맞는 읽기, 금고 AAD 결속, 원문·파생자료 전체 파기와 파기 내역을 반영하는 복원 Application Service는 완료로 확인되지 않았다 |

#### AI: W06/E5-4/E5-5의 근거 연결과 W05/W07~W10/E5-9 소비

- **수정 경계 제안:** Agent의 `apps/pipeline/ccc_pipeline/masking.py`, `worker.py`, `results.py`; `packages/contracts/src/agent-jobs.ts`; 코어의 `acceptAgentJobResult`, `recordMaskedSourceSnapshot`, `commitMaskedResult`, `loadAiCallMaterialsForService`, `authorizeSessionTextAiEgress`; HTTP의 `generateAiDraft`, `runDiscrepancyDetection`과 기존 provider/보고서 타입이다. 광범위한 gateway 분해나 두 번째 AI 호출 경로를 만들지 않는다.
- **입력과 확인된 틈:** `ResultRequest`에는 `maskingPipelineHash`, `nerAttestationId`, `nerAttestationResultHash`, `releaseQualificationReceiptId`, `sha256`, `evidenceHash` 등이 있지만 `gateway.ts:10482-10501`의 일반 snapshot 전달은 기존 일부 필드만 보존한다. 요청된 재료뿐 아니라 반대 축과 과거 대조 재료도 같은 근거 계약으로 다뤄야 한다. 별도 기억 경로의 `verifyMemoryProof`를 재사용 근거로 삼되 기억을 제품 AI 입력에 다시 넣지 않는다.
- **출력 계약 제안:** snapshot과 재료 revision에 S6가 요구하는 근거 전체를 연결하고, 보존된 허용 version/hash·receipt·동의와 현재 원문 상태를 외부 호출 직전에 대조한다. `OpenAiEgressAuthorization` 타입의 존재를 실제 전송 권한 소비로 간주하지 않는다. 기존 일곱 fail-closed code와 S5 결과 멱등성을 유지하고 본문을 재작성해 hash/offset을 맞추지 않는다.
- **후속 소비:** W07의 카드·주제·동일 내용·결과/업데이트 연결 필드 책임은 기존 카드 설계 정본을 따른다. 수기 기록은 정본으로 남고 AI 카드만 회차 승인을 받는다. 이 생산자 계약 뒤에 W08/M5, W09/M6와 W10 소비를 연결한다. 등록된 액션 목록을 미등록 약속 추적의 완료로 바꾸지 않는다.
- **장문과 상태:** W05/E5-9에는 재료 revision, 검사한 구간, 부분 결과, 제외 구간과 실패를 소비자가 구별하는 계약이 필요하다. 성공한 0건과 미실행·대기·차단·일부 실패·오래된 결과를 구분한다. 기존 `AiContrastAxisStates`, `recordAiCallOutcome`, `AiProviderOutput`과 보고서 응답을 확장 대상으로 삼고 원전사와 근거를 덮어쓰지 않는다.
- **수용 기준:** 하나의 근거 hash 변조, receipt 만료, 동의 철회 또는 이미 파기한 재료가 있으면 해당 외부 호출은 0회다. 늦은 결과는 파기한 snapshot/대응표를 되살리지 못한다. 수기 기록을 중복 저장하거나 재승인하지 않고, 미승인 카드·연결은 공식 조회에 없다. 긴 입력의 누락 구간과 재시도 결과가 표시되며 실제 0건을 실패로 바꾸지 않는다.
- **미래 검증:** 기존 pipeline 결과/worker 검사와 API 가림·승인·대조 경로에서 위 실패와 성공을 합성 자료로 확인한다. W12는 새 카드/짝/주제/상대 날짜/요약의 독립 정답 작성자와 검토자, 측정 단위·표본·threshold를 출력 전에 고정한다. 평가기 자기검사와 의미 품질, 실제 egress 증거는 구별한다.

#### STT: E5-1b/E5-6/E5-7의 Agent 결속과 E5-8의 독립 판정

- **수정 경계 제안:** `apps/pipeline/ccc_pipeline/config.py`, `api_client.py`, `worker.py`, `trial_server.py`, 기존 Qwen runtime/의존성 정의와 S12 설치 계약이다. Local/Azure 엔진을 다시 고르거나 어댑터를 새로 만들지 않는다.
- **접속 입력과 출력:** 기존 설치 manifest·Identity·페어링 계약에서 승인된 모드, 기관, API origin과 service 자격의 결속을 소비한다. 현재 `config.py:16-17,202-237`의 고정 Workers 주소만으로 세 모드 연결을 완료 처리하지 않는다. 허가되지 않은 모드/origin에는 요청이나 자격을 보내지 않으며 키 유무만으로 STT를 활성화하지 않는다.
- **임시 원음:** 코어 AudioStore의 원본 삭제 증거와 Agent의 다운로드/청크/임시 파일 정리는 별개다. `worker.py:667-675`와 `trial_server.py`의 기존 정리를 출발점으로 Windows 파일 잠금·중단 뒤 복구를 구체화한다. 삭제 실패를 성공으로 표시하지 않고 복구 시 전사나 업로드를 다시 시작하지 않는다. Azure의 durable attempt marker는 임시 원음과 함께 지우지 않는다.
- **평가 입력과 출력:** `scripts/stt/benchmark.py`, `benchmark_engines.py`, `metrics.py`, `benchmark-models.json`의 재사용 범위를 정한다. 현재 v1의 두 엔진·합성 150건·Windows CPU 판정을 수정해 v2로 가장하지 않는다. v2는 S13의 여섯 허락된 파일, 독립 전사·화자/핵심 사실 정답, 후보와 run identity를 고정하고 누락/실패/미측정을 결과에 남긴다. 기존 threshold와 역사 FAIL은 보존한다.
- **수용 기준:** 승인된 기관/모드에서만 health와 허용된 합성 처리가 이어지고 다른 origin의 요청은 차단된다. Windows 중단·잠금 뒤 원음/청크의 실제 부재를 확인하며 재전송은 없다. v1 결과와 v2 결과가 섞이지 않고 평가 제외 파일·후보도 숨기지 않는다. off/null과 명시적 관리자 선택, Q 채택은 평가 코드 작성과 별개다.
- **미래 검증과 담당 구분:** 기존 `test_azure_stt.py`, `test_api_client_worker.py`, `test_trial_server.py`의 계약을 재사용하고 S12의 새 Windows 설치→health→허용된 Local 처리→제거로 장비 증거를 닫는다. Azure의 계약 확인자·증빙 위치·구독/운영/동의 검토는 S13 §7.2와 법률 검토 목록의 기존 담당 인계로 남긴다. 인증 성공을 기관 적합성으로 대체하지 않는다.

#### 저장소: W01/R1~R10의 설계 선택과 기존 E3/E4/E6~E8 복원

- **수정 경계 제안:** `packages/contracts/src/runtime.ts`, `packages/core/src/gateway.ts`의 금고/원문/아카이브 경로, 기존 SecretStore·DPAPI·원음 어댑터와 `migrations/parity.yaml`이다. 실제 paired migration 번호는 실행 시점에 정하며 적용된 이력은 수정하지 않는다. S9/S10 Application Service를 기존 포트 위에 구현하며 새 런타임 포트를 만들지 않는다.
- **저장 봉투와 키의 설계 제안:** R2의 본문·JSON·인용·파생자료별 저장/조회/복사/검색 목록을 먼저 갖춘다. 후보 봉투에는 암호화 형식 버전, 키 버전, nonce와 ciphertext를 두고 기관/대상/행/필드/두 버전을 인증 데이터에 결속한다. 정확한 인코딩·검색 유출 범위와 Cloud 확장 적용 범위는 미승인 제안으로 표시한다. 현재 `gateway.ts:1437-1493`의 활성 키 한 개 선택과 AAD 없는 금고 형식을 새 계약의 완료로 보지 않는다.
- **전환과 복구:** 키 보유자는 바꾸지 않는다. S9의 권한·감사→write fence/drain→고정된 이전 세대→새 shadow 전체 검증→단일 pointer 활성화를 그대로 소비한다. 이전 행은 그 세대/키 버전에 맞게 읽고 새 ciphertext를 옛 코드가 평문으로 해석하지 못하게 한다. 이미 확인된 쓰기는 중단이나 rollback으로 유실되지 않아야 한다. 무중단 전환을 새 전제로 추가하지 않는다.
- **파기 범위와 늦은 쓰기:** 기존 금고/아카이브 파기와 기억 파생자료 삭제도 재사용한다. 원문·revision·목표·인용·AI 결과·생성된 반출 임시물의 연결 목록과, 보존 중인 다른 사례가 공유하는 자료를 구별한다. 파기 대상과 범위를 코어가 확정한 뒤 늦은 Agent/AI/재시도/반출이 자료를 재생성하지 못하게 한다. 정당하게 보존 중인 다른 기관/활성 사례를 함께 지우지 않는다.
- **파기 내역과 복원 출력:** 기관·파기 대상 참조·범위/정책 버전·파기 revision·시각을 원문 없이 대조하고 진위와 최신성을 입증하는 내역이 필요하다. 내역 포맷·보호 위치·증명 키는 S9/S10 소유자가 정할 설계 선택이며 승인된 새 표나 API로 쓰지 않는다. 원본 backup hash를 먼저 검증하고 비공개 shadow에 허가된 파기 차이만 적용한다. S9 `RestoreChecks`/성공 상태와 S10 `RECOVERY_BLOCKED`의 판정은 업무 노출 시점의 최신성까지 포함한다.
- **조건부 Cloud 원음 암호화:** R7을 진행할 경우에만 기존 `AudioStore`/StorageSigner의 plaintext/ciphertext 크기·hash·generation, 복호화 권한과 키 부재 거부를 하나의 계약으로 정한다. frontend 업로드와 Agent 다운로드가 같은 바이트를 검증해야 하고 업무 API는 원음을 프록시하지 않는다. 로컬 암호화 파일 코드로 Cloud 암호화를 완료 처리하지 않는다.
- **수용 기준:** 이전/새 세대의 허가된 읽기는 값을 보존하고, 기관/행/필드 교체와 잘못된 키는 거부한다. 파기 뒤 대상 원문·연결 파생자료와 임시 사본은 없고 늦은 결과도 이를 되살리지 못한다. 정상 옛 백업과 최신 파기 내역으로 나머지 자료는 보존되며 내역 누락·변조·다른 기관·대상 모호성·오래된 revision은 업무 개방을 막는다. 손상된 원본 hash는 파기 내역으로 면제하지 않는다.
- **미래 검증:** 기존 DB/원음/SecretStore 계약 검사, E3-7/E4-5/E6-7/E7-3/E8-5의 권한·세대 전환·중단 복구·깨끗한 대상 복원을 재사용한다. SQLite/PG parity와 실제 Windows/Cloud 복원 증거는 그 레인의 별도 슬롯에서 얻는다. 새 문서나 암호화 부품만으로 전체 복원 PASS를 주장하지 않는다.

#### 실제 의존과 다음 인계

- 먼저 고정할 것은 AI proof/material 버전과 저장 봉투/파기 내역의 생산자·소비자 계약이다. 같은 snapshot 컬럼과 gateway 구간, paired migration을 함께 바꾸는 부분만 한 작성자가 직렬로 통합한다. `worker.py`의 S5/Azure/정리 변경도 한 작성 경계를 따른다.
- W07 카드 생산자 뒤에 W08~W10 소비를, 파기 내역 생산자 뒤에 복원 소비와 활성화 판정을 연결한다. Agent 모드 결속은 페어링/Identity와, Cloud ciphertext 전송은 frontend/Agent와 인계한다. 독립 정답과 S13 v2 입력 준비는 코드 작성과 분리할 수 있지만 미승인 모델·provider 활성화를 포함하지 않는다.
- 코드 작성권과 검증 슬롯은 여전히 0이다. 위 파일은 배정 대상 제안이지 현재 작성자 지정이 아니다. 실제 구현은 생산자 커밋·검증, 겹치는 구간 동결과 파일/단일 작성자/기준 SHA/수용 기준/검증 슬롯의 명시적 인계를 받아야 한다. 이 문서 작업 때문에 오케스트레이터 세션에 요청을 보내지 않는다.

**독립 착수 충돌 검증(2026-09-13, 읽기 전용):** 22개 워크트리의 metadata와 후보 경로 상태를 대조했다. PLANNER와 총괄은 별도 디렉터리·브랜치·index를 쓰지만 같은 Git 공통 저장소를 공유하며, `w1W:p1`과 `w1Z:p1`이 같은 PLANNER 디렉터리에서 실행 중이라 파일 단위 단독 작성이 확인되지 않았다. CCC-238 후보 파일 가운데 `packages/core/src/gateway.ts`, `apps/pipeline/ccc_pipeline/worker.py`, `masking.py`, `apps/api/test/agent-job-contract.test.ts`는 보존된 `.worktrees/e5-4-privacy-generalization`(`99d7b41`)의 미커밋 변경과 겹치고, 그 기준은 현재 통합 `bb5b47e7`과 5개 파일 16,071/9,456줄 차이가 있다. PLANNER `8c3789d6`도 현재 통합과 gateway/HTTP/AI runtime/parity/계약 검사에서 다르다. 확인된 소비자는 `packages/http-api/src/request-handler.ts:160,3870`과 위 계약 검사이며 언어 서버의 정의 프로젝트 조회만으로 호출자 목록을 닫지 않는다. 검증 자원은 PostgreSQL 임시 컨테이너와 파일별 임시 DB라 기술적 충돌은 낮지만 PLANNER에 부여된 슬롯은 없다. 판정: 문서 작업은 독립 진행 가능하고, CCC-238 코드 착수는 `bb5b47e7` 이후 기준 SHA, 위 4개 파일의 단일 작성자, 보존 작업 재사용 범위와 검증 슬롯이 명시되기 전까지 충돌 없음이 아니다.


### 다음 인계 요청

수정안과 작성권/배치 인계 요청은 기존 티켓의 코멘트로 게시하고 재조회했다: [계획과 제출 CCC-192](https://linear.app/bss-ccc/issue/CCC-192/e10-6-제출-패키지와-시연#comment-120e89e5), [법무 CCC-157](https://linear.app/bss-ccc/issue/CCC-157/sg14-법무와-실데이터-게이트-확정-게이트#comment-3a3f4bcf), [STT CCC-250](https://linear.app/bss-ccc/issue/CCC-250/e5-8-stt-g1stt-g3-엔진-판정#comment-71ecd30b). 상태는 각각 Backlog, Backlog, In Progress 그대로다. 게시 성공은 총괄의 수신 확인이나 작성권 인계가 아니다.

총괄의 문서 수신, 정본 참조 반영과 마감 기준을 위 표에 기록했다. 다음 구현이나 정본 갱신은 관련 core/frontend/DESIGN 생산자 계약이 커밋·검증되고 Main이 겹치는 소유 구간을 동결한 뒤, 정확한 파일, 단일 작성자, 기준 SHA, 수용 기준과 검증 슬롯을 명시적으로 전달해야 시작한다. 이번 조율 승인만으로 그 조건이 충족되지 않는다. A1/A2 문안/버전은 코어→frontend→DESIGN 순서를 유지하고, A6과 R1~R10의 코드는 PLANNER에 새 소유권을 주지 않은 상태에서 시작하지 않는다. D90 번호 충돌은 경로와 출처 SHA로 구별하며 Main의 향후 통합 관문에 남긴다.

## 배치 진행 중 할 일

1. 새로 명시적으로 받은 배치/소유권 인계와 허용된 로컬 커밋으로 다음 범위를 확인한다. 현재 Q 지시 아래에서는 오케스트레이터 세션에 상태 문의나 작업 지시를 보내지 않는다. 미커밋 작업이나 실제 실행 여부를 커밋의 존재만으로 추정하지 않는다.
2. PLANNER의 쓰기 범위는 위 ‘작업 범위와 보존’에 명시한 승인 문서이며 기존 계획 정본의 작성자는 총괄이다. 정본 작성권 인계 전에는 기준 SHA와 변경 구간을 명시한 수정안만 전달한다. 총괄이 대상 경로와 인계 시점을 명시하고 그 파일의 작성을 멈춘 뒤에만 PLANNER 안에서 같은 정본 경로를 갱신한다. 다른 워크트리의 파일은 직접 고치지 않는다.
3. 새 승인 결정, API/스키마 계약 변경, 로컬 체크포인트 반영, 검증 실패나 작업 취소가 들어오면 기존 W 항목에 대한 수정안을 갱신한다. 새 상태 파일이나 두 번째 W01~W13 목록을 만들지 않는다. 현재 변경의 전달에는 위 로컬 인계 규율을 적용한다.
4. 다음 미착수 묶음에 아래 준비 항목을 모두 갖춘다. 기존 배치와 같은 파일을 건드리는 부분만 의존관계로 남기고 독립적인 조사와 계획 준비는 계속한다. 현재 진행 중인 일의 재구현은 시작하지 않는다.
5. 결정 번호만으로 요구를 연결하지 않는다. 생성 기준 main의 D90은 초대 수락 신원 결속이고, 총괄의 위 카드 ADR도 D90으로 적혀 있었다. 번호 충돌은 총괄의 문서 통합 대상이며, 그전에는 문서 경로와 출처 SHA로 구별한다. PLANNER가 임의로 재번호를 매기지 않는다.

### 다음 구현 묶음의 준비 항목

해당 **기존 실행 계획의 W 항목**에 적고 실행 티켓과 연결한다. 이미 준비된 정보는 링크로 재사용한다.

- 요구 ID, 포함 범위와 제외 범위, 확정 결정의 근거.
- 실제 담당 레인, 정확한 수정 파일/심볼, 겹치는 파일의 단일 작성자.
- 생산자와 소비자의 API/타입/거부 코드, DB와 Agent 버전 전환 경계.
- 선행 로컬 체크포인트의 반영 SHA, 필요한 관문 결정, 미충족 조건과 해소 담당자.
- 바뀌는 사용자 동작의 수용 기준, 표적 검사 명령, 실제 화면/API/장비 스모크 시나리오.
- 통합 순서와 데이터 보존/되돌림 조건. 새 추상화나 별도 상태표 대신 기존 계약을 재사용한다.

## 배치 완료 후 구현 착수 조건

다음 조건을 모두 확인한 작업은 기존 승인 범위 안에서 바로 착수한다. 구현을 다시 승인받기 위한 형식적 질문은 하지 않는다.

- [ ] 총괄이 현재 배치의 검증 결과와 통합 기준을 인계했고, 다음 작업의 담당자와 파일 범위가 명시됐다. 에이전트의 `completed`, 열린 PR, 일부 테스트 통과만으로 배치 완료를 판정하지 않는다.
- [ ] 필요한 선행 변경이 총괄이 지정한 로컬 통합 기준에 반영됐고 그 SHA를 명시적으로 인계받았다. `origin/main` 반영을 요구하거나 다른 레인의 미커밋 파일을 복사해 선행조건을 대신하지 않는다.
- [ ] 해당 W 항목의 데이터/권한/개인정보 관문이 닫혔다. 날짜가 다가왔다는 이유로 미결 정책을 승인된 것으로 바꾸거나 구현 범위를 축소하지 않는다.
- [ ] `branch-worktree-gate`로 PLANNER의 문서 변경을 보존하고 최신 기준의 작업용 브랜치를 마련했다. 계획 브랜치를 계속 구현 브랜치로 쓰거나 다른 레인의 checkout/reset/stash/clean을 실행하지 않는다.
- [ ] 인계받은 코드가 PLANNER의 허용 범위다. `apps/client`는 frontend, STT 시험 화면은 해당 전용 레인, 공유 UI/CSS/토큰과 디자인 산출물은 DESIGN에 인계한다. 이 워크트리 생성은 소유권 예외를 추가하지 않는다.
- [ ] 의존성 설치를 마쳤고 해당 작업의 실제 동작을 검증할 실행 환경이 준비됐다. 작성 중인 다른 레인과 통합 검사 슬롯을 겹치지 않는다.

실데이터 사용, 외부 AI 활성화, 개인정보 정책 변경, 보호 브랜치 머지와 운영 배포에는 기존의 별도 승인이 필요하다. `ccc-preview` 수동 배포 권한도 이 워크트리에 생기지 않는다.

## 새 세션 시작 지시

이 워크트리에서 세션을 열고 다음 지시로 시작한다.

> `docs/superpowers/plans/2026-09-13-planner-handoff.md`를 읽고 PLANNER 역할을 시작해 줘. 현재 총괄의 배치와 계획 정본을 확인해서 다음 작업을 구현 가능한 수준으로 준비하고, 배치 종료와 소유권 인계가 확인된 승인 범위는 바로 이어서 구현해 줘. 기존 레인의 파일과 실행 중인 작업은 건드리지 마.
