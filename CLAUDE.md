# 비영리 사례관리 프로그램: 개발 작업 문서

> 이 문서는 프로젝트 루트의 `CLAUDE.md`(= `AGENTS.md` 링크)다. Claude Code·Codex 가 세션 시작 시 읽으므로 여기 적힌 규칙은 모든 작업에 자동 적용된다.
> PRD 원본: 노션 "비영리 조직 사례 관리툴" 페이지 (문서 제목은 고유명사라 구 용어 유지)
> 확정된 결정 D1~D90 의 정본은 `docs/decisions.md` 다. 본문과 충돌하면 그쪽이 우선한다.
> 2026-09-26 분리(200줄 권고·Codex 32KB 한도): §5 → `docs/specs/ai-pipeline.md`, §6 → `docs/specs/briefing-15s.md`, §8 → `docs/open-items.md`, §9 → `docs/decisions.md`.

---

## 1. 프로젝트 한 줄 정의

금전 지원 사업 당사자 상담을 인테이크부터 종결까지 기록하고, AI가 정리한 누적 맥락을 **상담 5분 전에 한 화면으로** 보여주는 웹앱.
핵심 가치는 기록이 아니라 브리핑이다. 모든 설계는 "나중에 5분 안에 훑기 좋은 형태"에서 역산한다.

**사용 범위**: 여러 기관이 각자 쓰는 서비스로 방향 확정(D27, 구 D1 "내부 전용" 대체). 현 단계는 사회연대은행 단일 기관 위에 구현하며, 외부 기관 온보딩·자체 인증은 다음 단계다.

## 2. 확정된 기술 스택

| 구성 | 도구 | 메모 |
| --- | --- | --- |
| 배포 모드 | Community Cloud · Local Single · Local Office | 세 모드 모두 정식 구현(D76). 같은 화면·API·규칙을 쓰고, 저장소와 접속 경계만 다르다 |
| 인증 | Community Cloud는 Supabase Auth·MFA, Local Office는 Argon2id 로컬 계정·관리자 MFA, Local Single은 OS 사용자·앱 잠금 | 역할과 담당·감독 관계는 ADR-0038, Cloud RLS는 2차 방어(D82) |
| Community Cloud 저장 | 기관 소유 Supabase 서울 프로젝트 | PostgreSQL·Auth·Edge Function·private Storage, 인터넷 HTTPS(D76·D81) |
| Local 저장 | 암호화 SQLite + 암호화 파일 | Single은 `127.0.0.1` 전용, Office는 내부망 HTTPS(D76·D79) |
| 업무 클라이언트 | Vite + React PWA (`apps/client`) | 정적 클라이언트 + Bearer 토큰 API. Cloudflare는 정적 파일과 공개 페이지만 제공(D80) |
| AI 처리 | **처리 Agent**(기관 PC) | 2차 마스킹과 STT를 담당한다. AI를 켜면 모드와 무관하게 기관 PC 1대가 필요하다(D77·D81) |
| AI 사업자 | **OpenAI API** (`packages/ai-runtime/src/ai-provider.ts`) | AI Packet만 전송하고 `store:false`를 사용한다. BYOK는 호출 위치에만 둔다(D77·D81·D82) |
| STT | `off` · `local` · `azure` | 설치 직후 세 모드 모두 `off`. 구현 단계의 합성·운영자 본인 비민감 시험은 허용하지만 제품 활성화가 아니다. Local은 격리된 Qwen 원본 checkpoint, Azure는 원본 파일의 client send를 attempt당 최대 1회만 시작하는 경로다. [S13 STT qualification v2](docs/specs/S13-stt-qualification-v2.md)의 후속 품질·채택 관문과 Q 승인 전에는 `sttEngine`이 `null`이다(D77) |
| 원음 저장 | `AudioStore` | Cloud는 기관 소유 Supabase private Storage, Local은 암호화 파일. 다음 영업일 첫 Agent 처리 기회까지 보관하고 처리 뒤 즉시 삭제(D81) |
| 공통 포트 | `Database`, `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `STTProvider`, `AIProvider` | 일곱 포트. 백업·복원·가져오기·내보내기·업데이트·진단은 Application Service(D78) |
| 설치·릴리스 | Electron + NSIS, Office 서버·클라이언트 설치기, `install`·`doctor`·`update`·`rollback`·`report` | `.cccx`, 서명 manifest, 백업 후 rollback(D83) |
| 금지 기본값 | faster-whisper 자동 선택, Managed AI, CLOVA, RTZR, 로컬 LLM | 후보와 포트만 유지하고 Q 승인 전에는 운영 선택지로 열지 않는다(D77) |
| 사업 도입 확인 | 사업 등록 시 관리자가 고르는 저장 위치(기본형 Supabase 서울 · 네이버 클라우드 공공형 · 나중에 정하기)와 처리 경로(외부 허용 · 기관 안 · 나중에 정하기) | 판단은 사용기관, CCC는 고지와 확인 기록만(D87). 실효 AI 능력은 사업 선택과 설치 `sttMode`·`llmMode` 중 더 좁은 쪽. 잠금은 아직 미구현(§8) |

## 3. 데이터 설계 원칙

### 테이블 구조

```
participant_pii_vault     실명, 연락처, 계좌. 앱 레벨 AES-GCM 암호화(키는 `SecretStore`의 `PII_ENC_KEY`; Community Cloud는 Edge secret, Local은 DPAPI, D3·D82). 관리자 권한만 조회
support_cases             가명 ID(동물 슬러그, 예: swallow-003 — D20·ADR-0004), 기관 ID, 담당 실무자 ID, GAS 기준, closed_at, purge_due (D10)
support_case_assignees    케이스별 담당 실무자 매핑. 공동 담당·이관 지원 (D7)
goals            세부 목표(D62 위계 전체 > 세부 > 세션의 2층. 전체 목표는 support_cases.overall_goal, 세션 목표는 schedule_session_goals). 문구·연결·상태만 운영(GAS 채점은 D43 보류), 수정 허용+이전 문구 이력 보존(D62 가 D12 수정 금지 대체). status(active/closed) + closed_reason(달성/중단/재설정 = achieved/stopped/reset)
goal_revisions   전체·세부 목표 문구 이력(D62, 마이그레이션 0031). 덧붙이기 전용, 한 행 = 한 번의 확정(최초 작성 포함), goal_id NULL 이면 전체 목표. 감사 조회(admin 전용)와 열람 범위가 달라 audit_log detail 이 아닌 전용 표다(CCC-71 결정)
sessions         세션 기록. 분류 스키마 필드 + 승인 플래그(approved_at)
action_items     액션 아이템. 담당, 기한, 해결 여부
flags            리스크 플래그. 고정 유형 + 전사 발언 인용 + 실무자 확인(맞음/틀림) (D9)
audit_log        열람·변경·PII 복호화·내보내기 전부 기록. append-only (D14)
```

`yellow` 구 이름 `pii_vault`·`cases`·`case_assignees` 는 **컷오버 전 표**이고 `packages/core/src/gateway.ts` 에 아직 일부 남아 있다(각 6·21·14회 vs 현행 29·183·71회). **새 코드는 위 이름을 쓴다.** 컷오버 흔적: `migrations/sqlite/` 의 `participant_support_case_cutover_*`.

### 스키마 3층 구조

- 코어(전 케이스 고정): 목표별 GAS 점수와 근거, 액션 아이템, 리스크 플래그, 감정 추이. 브리핑과 통계는 코어만 사용
- 템플릿(사업 유형별): 금전지원형 v1부터 시작
- 확장 슬롯(케이스별): 실무자 자유 추가. JSON 컬럼 하나로 격리, 통계와 브리핑에서 제외

GAS(목표달성척도): **세부 목표마다** -2(악화)부터 +2(기대 초과)까지 5단계 점수(D33 — 전체 목표·세션 목표에는 점수를 매기지 않는다). 세부 목표는 측정 가능한 문장으로 쓴다. **점수는 실무자가 직접 매긴다. AI는 전사에서 근거 발언 발췌만 제안한다 (D6).**

## 4. 개발 규칙 (위반 시 커밋 차단 대상)

**R1. DB 접근 단일 관문**
모든 업무 DB 조회와 쓰기는 `packages/core`의 gateway facade만 거친다. 이 관문은 기관 ID와 접근 권한(담당 실무자, 지정 팀의 실무 책임자, 허용된 관리자 기능, D7·D74)을 검사하고 audit_log 기록을 내장한다(D14). `apps/*`와 `packages/http-api`의 SQL·driver 호출은 금지한다. raw driver 호출은 `adapters/db-*`, migration runner, 계약 테스트 harness에만 허용한다. `scripts/guard-db-gateway.mjs`가 SQL·driver 경계를 검사한다. `packages/core`의 platform import 경계는 E1-6이 소유한 `guard-core-imports`가 검사한다(D78·D79).

`Database` 포트는 `prepare`, `bind`, `first`, `all`, `run`, 원자적 `batch`만 제공한다. SQL 자동 번역기는 만들지 않고, 어댑터가 `?` 자리표시자를 순서대로 `$n`으로 바꾸는 것만 허용한다. 평문 SQLite는 최종 제품에서 금지한다(D79).

**R2. 승인 전 초안은 공식 기록이 아니다 — 승인 = 정합성 검증**
AI가 생성한 세션 요약은 `approved_at`이 채워지기 전까지 브리핑, 통계, 보고서 어디에도 나가지 않는다. 이 검사를 gateway 함수 안에 내장한다.
승인 화면의 핵심은 **수기 기록 ↔ 녹취 기반 AI 정리의 대조**다. 대조 출력 3종(메모에 없는 내용, 음성에 없는 내용, 미논의 목표)을 실무자가 처리하는 것이 곧 정합성 검증 프로세스다.
실무자가 직접 쓴 수기 메모는 작성 즉시 공식 기록이며 승인 대상이 아니다 (D5).

**R3. PII는 파이프라인에 들어오지 않는다 — 2단 방어**
AI 사업자 호출부, 로그, 에러 메시지에 실명, 연락처, 계좌가 섞이면 안 된다.
1차: pii_vault 등록값(당사자 실명·연락처·계좌)을 가명 ID로 결정론적 치환.
2차: **처리 장비**에서 개체명 인식(NER)으로 대화 속 제3자 인명·전화번호 패턴을 추가 마스킹한 뒤에만 사업자로 전송.
**사업자로 나가는 텍스트는 장비가 만든 마스킹 스냅샷(`ai_masked_source_snapshots`)뿐이다** — 수기 메모만 있는 회차도 예외가 아니라 텍스트 일감 큐를 거쳐 장비가 먼저 마스킹한다(D57, ADR-0027 — 구 "호출도 처리 장비에서만"을 대체). 스냅샷이 없으면 그 회차는 재료에서 빠진다.
완벽하지 않은 잔여 리스크는 동의서 문안에 반영한다 (D2).

**R4. 감정 지표는 숫자만**
"불안하다" 같은 단정 문장을 생성하거나 저장하지 않는다. 점수와 추이만 저장하고, 화면에는 "지난 세션 대비 저조" 수준으로만 표시한다. 감정 점수는 당사자 발화만 집계한다 (D11).

**R5. AI 금지 영역**
지원 지속이나 중단 판단, 심리 진단, 승인 없는 기록 확정 기능은 어떤 형태로도 구현하지 않는다. GAS 점수 산정과 리스크 플래그 확정도 실무자 몫이다 — AI는 근거 발췌와 고정 유형 제안까지만 (D6, D9).

## 5. AI 파이프라인 스펙 — `docs/specs/ai-pipeline.md`

두 갈래(녹음 회차 / 수기 메모 회차, D57), `AudioStore`, 처리 기한·삭제 규칙(D76·D81·D85)은 그 파일이 정본이다. 파이프라인·큐·마스킹을 건드리기 전에 읽는다.

## 6. 15초 페이지(브리핑) 요구사항 — `docs/specs/briefing-15s.md`

화면 용어 개편(2026-08-08, 2026-09-04)과 브리핑 요구사항은 그 파일이 정본이다. 브리핑·일정·상담 기록 화면을 건드리기 전에 읽는다.

## 7. 작업 순서

**진행 상황 파일을 두지 않는다** (2026-07-31 Q 지시로 `STATUS.md` 폐지). 한 일은 **커밋 메시지**, 다음 할 일은 **티켓**이다 — 실행 티켓은 Linear(워크스페이스 CCC), 스펙은 GitHub 이슈다(아래 'Issue tracker').

`yellow` **없앤 이유**: `STATUS.md` 가 4일 만에 132,000자(est 33,000토큰)로 불어 이 파일의 4배가 됐는데, 매 세션이 같은 두 줄(Last updated 도장 · History 최신 행)을 고쳐 동시 세션이 계속 충돌했다. 커밋과 티켓은 이미 있는 기록이고 자동 병합된다. **옛 내용은 지워지지 않았다** — `git show <폐지-직전-커밋>:STATUS.md` 로 언제든 꺼낸다.

## 8. 미결 사항 — `docs/open-items.md`

STT 게이트, 사업 도입 확인 잠금, 동의서·보존 기간 등 열린 항목과 해소 기록은 그 파일에 있다. 작업 전 해당 항목을 확인한다.

## 9. 확정된 설계 결정 (D1~D90) — `docs/decisions.md`

**판정 우선순위는 불변** — 본문과 충돌하면 §9(`docs/decisions.md`)가 우선한다. 결정을 적용·인용하기 전에 해당 D행을 그 파일에서 읽는다. 찾기: `grep -n '^| D<번호> |' docs/decisions.md`. 대체 관계(D1→D27 등)·ADR 번호·구 용어 주석도 그 파일에 있고, ADR 이 있는 결정의 원문은 `docs/decisions-detail.md`.

## 10. 조직 시크릿 접근 (bss-infra)

조직(SSB) 시크릿이 필요하면 이 경로만 쓴다 (Cloudflare 시크릿·AES 키 등 2단계부터 해당):

- 값의 원본은 **Infisical**이며 회사 프로젝트는 **Doppler로 이전 중**이다(2026-09-24 현황). 사람용 금고(Bitwarden)와 그 마스터 비밀번호는 절대 조회하거나 요청하지 않는다.
- 에이전트 인증 (2026-09-24 변경):
  - Infisical **ggbss.or.kr** 프로젝트(`/CCC` 포함): 안전 래퍼 `~/.dotfiles/scripts/isec`(`ls|has|set|del|run`)를 쓴다. isec가 1Password `BSS` 금고의 Machine Identity `ggbss-agent` 자격을 `opsvc`로 읽어 스스로 로그인한다.
  - Infisical **RELAYER** 프로젝트(`78d6f149-…`, `/CURRENT`·`/INSTALL` 등): 지금은 **상시 에이전트 자격이 없다**(`ggbss-agent`는 403). 사본이 Doppler `relayer_runtime/prd`(운영)와 `relayer` dev·stg(개발)에 있다. 다만 `/UNUSED`, `/PREVIEW`, 64KB를 넘는 baseline 3개는 사본에서 뺐다. 필요하면 config별 읽기 전용 Service Token을 Q에게 요청하고, `doppler run --no-fallback`에 child env로만 넘긴다.
  - 예전 `~/.config/infisical-agent/credentials`는 삭제된 identity의 자격증명이라 파일을 지웠다. `scripts/install/stage-env.sh`는 이 파일을 source하던 경로라서, 지금은 자격을 직접 넘기지 않으면 동작하지 않는다.
  - 값은 주입만 한다. `secrets get` 등으로 stdout, 채팅, 로그에 출력하지 않는다.
- **값이 stdout에 닿는 명령은 실행 자체 금지**: `infisical secrets`/`export`/`get`, `--plain`, 자격증명 파일 열람. 이름 확인이 필요해도 값 섞인 출력을 만들지 않는다. (과거 실제 노출로 전 키 로테이션을 치른 규칙 — `~/.claude/hooks/secret-dump-guard.sh` 훅이 결정론 차단)
- .env는 이름만 커밋(`.env.example`), 값 커밋 금지. 절차 SSOT: `~/DEVELOPER/PROJECTS/BSS/bss-infra/docs/machine-access.md` (레포 `SocialSolidarityBank/bss-infra`).
- 시크릿 값이 채팅·커밋에 노출되면 즉시 보고하고 해당 키 로테이션을 안내한다.

## 11. 한국어 산문 부호 (2026-08-06 Q)

화면 문안뿐 아니라 이 레포의 한국어 산출물 전반(문서, 커밋 메시지, PR, 티켓, 코드 주석)에서 **긴 대시(`—`)는 쓰지 않고, 가운데 점(`·`)은 자제한다.** 한 호흡으로 읽는 병렬(`이름·연락처·계좌` 류)만 예외. 이유: 둘 다 AI 문체 신호다. 상세와 UI 문자열 규칙은 DESIGN.md §10 (기존 문서 소급 수정은 하지 않는다).

## Agent skills

### Issue tracker

GitHub Issues(`SocialSolidarityBank/CCC`)를 `gh` CLI로 사용한다. 상세: `docs/agents/issue-tracker.md`.
**구현 실행 티켓은 Linear**(2026-07-25~): 워크스페이스 **CCC**(bss-ccc), Composio 백엔드로 접근(절차·함정: `~/developer/tools/portwright/services/linear.md`). 스펙은 GitHub 이슈, 실행·선행 관계는 Linear의 blocks. **티켓 완료 규약**: Linear 티켓에 쉬운 한글 완료 보고 코멘트 + Done 처리 → Linear Slack 연동이 팀 채널로 전달한다.

### 티켓 스레드 규칙 (#ccc-tickets, 2026-07-26 Q 확정 — 위반 시 게시 금지)

에이전트가 `#ccc-tickets`에 올리는 티켓 소식은 **반드시 스레드**로 올린다. 채널 본문에는 부모 글 1개만 두고 상세는 전부 댓글로 밀어 넣는다(티켓 1건 = 스레드 1개, 묶음 금지).

1. **부모 글** = `티켓 번호 · 개발 용어 없는 쉬운 한 줄`. Linear 제목을 그대로 복사하지 않는다
2. **첫 댓글** = 비개발자가 30초에 읽는 분량으로 ① 무엇이 달라지나 ② 왜 하나 ③ 나에게 무슨 영향인가. 파일 경로·함수·마이그레이션 번호·ADR/D번호·완료 기준은 **두 번째 댓글부터**
3. **강조는 이모지 또는 인라인 코드**로, 한 글에 최대 2개(🚨 확인 필요 / ⚠️ 방식 변경 / ✅ 완료 / 🔵 착수 / 🧭 방향 결정)
4. 부모 글과 첫 댓글은 **`humanize-korean` 스킬로 윤문 필수** — 짧고 쉽게 만드는 것이 목적
5. 올리기 전 점검 5개(본문 1개 / 쉬운 한 줄 / 첫 댓글 자족 / 강조 2개 이하 / 윤문) 전부 통과해야 게시한다

전문·예시·나쁨↔좋음 대조: `docs/agents/ticket-thread-protocol.md`.
**채널 분리**: `#ccc-tickets`는 **이 규칙대로 만든 스레드만**, `#ccc-linear`(공개)는 Linear 자동 알림 전문. 채널을 다시 만들 일이 있으면 **공개**로 만든다(Slack에 비공개→공개 전환 API가 없다). 경위·API 확인 결과·운영 ID·검증 함정: `~/developer/tools/portwright/services/linear.md`(레포 밖 — 공개 레포에 운영 ID를 두지 않는다).

### 미리보기 환경 (CCC-6, 2026-07-25~)

팀원 피드백용: https://ccc-preview.account-855.workers.dev — 링크+지정 코드(Infisical 보관)만으로 열람, **가상 시드 전용**(운영 PII·운영 키 미연결), main 머지마다 자동 재배포. 상세·프로비저닝: `docs/ops.md` "미리보기 환경 (CCC-6)".

### Triage labels

기본 5개 역할(needs-triage/needs-info/ready-for-agent/ready-for-human/wontfix) 그대로 사용. 상세: `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트: 루트 `CONTEXT.md` + `docs/adr/`. 상세: `docs/agents/domain.md`.

### Design docs

**화면(페이지·컴포넌트·CSS) 작업 전에 루트 `DESIGN-RULES.md` 를 읽는다** (2026-08-10, ADR-0033). 지금 지켜야 하는 규칙만 추린 요약본이고, 근거와 이력은 `DESIGN.md` 에 그대로 있다(색값 SSOT 는 여전히 pen). 규칙을 바꾸는 커밋은 요약본도 같은 커밋에서 고친다.

**작업 순서는 `design-lane` 스킬이 갖는다** (2026-08-11, ADR-0034). 계획, 구현, 검수 요청, 최종 수정 4단계와 단계별 체크리스트가 `.claude/skills/design-lane/SKILL.md` 에 있고, 검수는 읽기 전용 에이전트 `design-reviewer`(`.claude/agents/`)가 격리해서 맡는다. 이 레포의 화면 작업에서는 전역 `web-edit` 스킬보다 이 스킬이 우선한다. 규칙 사본은 두 파일 어디에도 두지 않는다. 규칙은 위 `DESIGN-RULES.md` 하나다.

#### STT 클라이언트 독립 레인 예외 (2026-09-08 Q 승인)

공유 워크트리의 브랜치 전환과 미커밋 파일 정리가 충돌한 뒤, Q가 `.worktrees/stt-client`를 별도 작업 공간으로 승인했다. 기존 STT pane을 옮기며 새 OMP 세션 수를 늘리지 않는다. 이 예외는 STT 내부 시험 화면의 복구·구현·검수·출고 연결에만 적용한다.

- STT 레인은 `apps/client/src/stt-trial/**`, 브라우저 중립 공개 진입점 `apps/web/app/components/wire/client-surface.ts`, `apps/web/package.json`의 해당 공개 exports를 소유한다. `apps/client`의 나머지 셸 파일은 아래 프런트엔드 레인이 소유하고, 시험 화면 마운트 지점처럼 두 레인이 맞닿는 줄은 인계로 합의한다.
- `package.json`의 client 검사·빌드 연결, `pnpm-lock.yaml`의 client 의존성, `scripts/design/`의 STT 클라이언트 검사 연결과 전용 fixture, `artifacts/design/stt-client/**`도 필요한 범위에서 수정할 수 있다. 기존 검사 알고리즘·기준·baseline·assertion을 완화하거나 unrelated 변경을 섞지 않는다.
- 기존 웹 화면·공유 CSS·디자인 토큰·`DESIGN.md`·`DESIGN-RULES.md`·기존 웹 하니스의 소유권은 `design-adjustments`에 남는다. STT 레인은 이 파일들을 읽고 재사용할 수 있지만 임의로 바꾸지 않는다. 추가 공유 변경은 별도 인계를 먼저 받는다.
- 각 레인은 자기 워크트리에서만 파일·Git 작업을 한다. 상대 레인의 checkout·reset·clean·stash·미커밋 파일 정리는 금지한다. 보관할 소스는 파일명이나 폴더 이름으로 생성물로 추정하지 않고, 실제 파일 목록과 hash로 복사 후 원본 보존을 확인한다.
- 이 예외는 새 디자인 체계나 product 동의·NER·signed registry 우회를 허용하지 않는다. 동일 디자인 규칙과 기능별 실화면 검수·게이트를 적용하며, `ccc-preview` 수동 배포의 기존 소유권도 바꾸지 않는다.

#### 업무 클라이언트 프런트엔드 레인 예외 (2026-09-09 Q 승인)

Q가 `.worktrees/frontend`를 업무 클라이언트(D80 `apps/client`) 프런트엔드 작업 공간으로 승인했다. 2026-09-09 후속으로 STT 설정 상태 화면도 이 레인이 맡는다. `design-adjustments`가 자기 화면 작업으로 점유 중이어서 같은 워크트리에서 두 브랜치를 동시에 쓸 수 없기 때문이고, 대상 파일은 그 레인의 미커밋 변경과 겹치지 않는다.

- 프런트엔드 레인은 `apps/client/**` 에서 `apps/client/src/stt-trial/**` 을 뺀 범위를 소유한다. `index.html`, `src/main.tsx`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `public/**`, `apps/client/package.json` 이 여기 든다.
- 루트 `package.json` 의 client 검사·빌드 연결, `pnpm-lock.yaml` 의 client 의존성, `scripts/design/` 의 client 검사 연결과 전용 fixture, `artifacts/design/client/**` 도 필요한 범위에서 수정할 수 있다. 기존 검사 알고리즘·기준·baseline·assertion을 완화하거나 unrelated 변경을 섞지 않는다.
- 기존 웹 화면·공유 CSS·디자인 토큰·`DESIGN.md`·`DESIGN-RULES.md`·기존 웹 하니스의 소유권은 `design-adjustments`에 남는다. 이 레인은 읽고 재사용하되 바꾸지 않으며, 추가 공유 변경은 별도 인계를 먼저 받는다. `ccc-preview` 수동 배포 소유권도 그대로다.
- STT 설정 상태 화면으로 `apps/web/app/admin/ai-provider/**` 와 `apps/web/app/lib/api.ts` 의 `GET /capabilities` 읽기 함수를 소유한다. 화면은 `GET /capabilities` 의 `sttMode`·`sttEngine`·`sttOptions`·`agentStatus` 를 보여주기만 하며, STT 모드를 쓰는 엔드포인트는 없다. `apps/web/app/components/wire/**` 와 `globals.css` 는 그대로 `design-adjustments` 소유이므로 기존 컴포넌트·클래스만 재사용하고, 새 컴포넌트나 새 CSS가 필요해지면 그 시점에 인계한다.
- STT 시험 화면 파일은 `stt-client` 레인 소유다. 상대 레인의 파일을 직접 고치지 않고, 각 레인은 자기 워크트리에서만 파일·Git 작업을 한다. 상대 레인의 checkout, reset, clean, stash, 미커밋 파일 정리는 금지한다.
- 이 예외는 새 디자인 체계나 product 동의·NER·signed registry 우회를 허용하지 않는다. 같은 디자인 규칙과 기능별 실화면 검수·게이트를 적용한다.
- **레인 순서는 프런트엔드 먼저, 디자인 다음이다**(2026-09-09 Q). 프런트엔드 레인이 API 계약과 거부 코드, 자기 소유 화면, 잠금 사실을 먼저 확정하고, 화면 규칙이 걸린 자리는 `docs/superpowers/plans/<날짜>-<주제>-design-handoff.md` 인계 패킷으로 넘긴다. 패킷의 필수 8항목과 되돌려 보내는 기준은 `.claude/skills/frontend-lane/SKILL.md` 가 갖고, 화면 작업 자체의 순서는 계속 `design-lane` 스킬이 갖는다. 규칙 사본은 어느 쪽에도 두지 않는다.

### 문서 배치 규칙 (2026-07-25 Q 확정)

- HTML 시안·용어집 등 **아티팩트는 루트 `artifacts/`** (구 docs/artifacts 폐지)
- **PRD·제품 정의 문서는 루트 `PRD/`**
- 폐기 문서는 `docs/archive/` (폐기 헤더 필수)
