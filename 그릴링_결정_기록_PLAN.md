# 2026-08-29 그릴링 결정 기록과 파생 갱신

## Context

2026-08-29 그릴링에서 안건 4개(서울 리전 이전, 가입·초대, STT 구성, 동의 정리)에 대해 7개 결정이 확정됐다. 이 계획은 그 결정을 레포 정본(CLAUDE.md 9장 + ADR)으로 승격하고, 어제오늘 만든 준비 스펙 4개에 반영하며, Linear 티켓을 갱신·추가한다. 코드 구현은 하지 않는다(구현은 갱신된 스펙과 티켓이 정의한다).

## 결정 원문 (그릴링 확정값, 이 계획의 SSOT)

1. **서울 리전 제공자**: Supabase 서울(ap-northeast-2). PostgreSQL + Auth + Storage + RLS 한 계약. 유료 전제(Pro $25/월 + 사용량).
2. **이전 시기**: 지금 착수. 완성 목표 문서(노션)의 4주 계획 1~2주차에 DB와 인증을 새 기반으로 함께 구축.
3. **가입 방식**: Supabase Auth (이메일+비밀번호, 검증된 인증 시스템). 기존 invite_tokens 흐름 재사용.
4. **가입 범위(표준)**: 기관 관리자 초대 → 실무자 가입 → 로그인 → 관리자 MFA 필수 → 초대 만료·재발급 → 퇴사 비활성화. 초대 이메일 자동 발송 제외(링크 복사 유지).
5. **STT 구성(사용자 원문 반영)**: "CLOVA를 포함한 국내 리전 STT, QWEN, WHISPER 등 로컬 STT 모두 테스트 진행하며 언제든 갈아끼울 수 있는 상태로 만드는 걸 목표로". 즉 어댑터 4종(whisper 현행, clova, rtzr, qwen3-asr)을 등록하고 `CCC_STT_ENGINE` 하나로 전환 가능한 상태가 목표. 실행 위치는 처리 장비 유지(로컬 엔진 구동 필요). 운영 엔진 확정은 G1~G3 비교 후 Q.
6. **동의 구조**: 4영역 분리. ① 개인정보 수집·이용 ② 민감정보(건강·채무) 처리 ③ 녹음과 STT 처리위탁 ④ AI 처리(마스킹 텍스트의 국외 이전 고지 포함). D49(2종 통합) 대체.
7. **법률 검토**: 파일럿 중 착수(D46의 "MVP 범위 종료" 부분 개정). 4영역 문안 초안을 만들어 변호사 검토 의뢰. 실데이터 개시는 여전히 검토 완료 후.

## 공통 규칙

- 한국어 부호(CLAUDE.md §11): 새로 쓰는 모든 문안에서 긴 대시 금지, 가운뎃점은 한 호흡 병렬만.
- 시크릿 값 금지. pre-commit 훅이 가드를 돌린다. `--no-verify` 금지.
- 아래 "새 텍스트"는 그대로 쓴다. 편집 지점 줄 번호는 실행 시점에 재독으로 확정한다.

## 1단계: ADR-0040 작성

`docs/adr/` 최대 번호는 0039(2026-08-29 확인). 새 파일 `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md` 를 만든다. 기존 ADR 형식(예: `docs/adr/0035-contest-scope-and-deployment-doors.md`)을 따라 다음 구획으로 쓴다:

1. **배경**: 노션 "2026-08-29 완성 목표" 문서(대회 결과물 = 폐쇄형 무료 베타 + 오픈소스, 한국 리전 저장 요구)와 기존 결정의 충돌 4건: D65(D1 유지) vs 한국 리전 PostgreSQL / Cloudflare Access vs 자체 로그인 / D67(결승 2파전) vs 다중 엔진 / D49(동의 2종) vs 4영역. 2026-08-29 그릴링으로 판정.
2. **결정**: 위 "결정 원문" 7건을 D76~D79 네 묶음으로 서술(아래 2단계의 행 전문과 같은 내용, ADR에는 근거를 더 붙인다).
3. **근거**: ① Supabase 서울은 DB·인증·파일저장·RLS를 한 계약으로 묶어 가입 결정과 한 몸(Pro $25/월 + 사용량, 실운영 월 $40~100 추정. 물리 위치 AWS ap-northeast-2) ② D1 호출 160곳(prepare 125 + batch 35)과 마이그레이션 44개 방언 전환이 이전 비용이며 이행 전략은 prep/db-beta-scale 스펙 개정판이 정본 ③ CLOVA·RTZR API 사실 조사는 prep/stt-engine 스펙의 표(보관·삭제 조건 미확인, 계약 확인 필요) ④ 법률 검토 목록(docs/consent/legal-review-open-items-v1.md)의 높음 등급 항목 4(국외 이전)·7(민감정보 별도 동의)·8(신용정보법)이 4영역 분리와 파일럿 중 착수의 근거.
4. **대체 관계**: D65의 "PostgreSQL 연기·D1 유지" 부분 대체(D63 배포 문 구조와 로컬 우선 원칙 불변) / 2장 인증 행의 Cloudflare Access 대체 / D67의 결승 2파전 구도 개정(D53 안전장치 불변) / D49 대체(D15 분리 정신 부활 + 민감정보 신설) / D46의 법률 검토 종료 부분 개정.
5. **후속**: Linear 티켓(4단계), 스펙 개정(3단계).

## 2단계: CLAUDE.md 갱신

메인 워크트리(레포 루트)에서 편집한다. 2026-08-29 확인 시점에 클린·origin 동기 상태.

### 2-1. 9장 표 끝에 행 4개 추가

표의 마지막 행(CCC-133 일정 다중 뷰) 바로 아래에 추가. **행 전문(그대로 사용)**:

```
|D76|서울 리전 이전|데이터 기반을 Cloudflare D1에서 **Supabase 서울(ap-northeast-2)**로 옮긴다(2026-08-29 그릴링. D65의 "PostgreSQL 연기·D1 유지" 부분 대체, D63 배포 문 구조와 로컬 우선 원칙은 불변). 대상은 PostgreSQL(D1 대체) + Supabase Storage(R2 음성 임시 보관 대체) + RLS이며 유료 전제(Pro 월 $25 + 사용량). **지금 착수한다**: 4주 계획 1~2주차에 DB와 인증을 새 기반으로 함께 구축해 재공사를 남기지 않는다. 근거: D1·R2의 APAC 설정은 한국 저장 보장이 아니고 실데이터 베타는 한국 리전을 요구한다. D1 호출 160곳 변환과 마이그레이션 44개 방언 전환이 비용이며, 이행 전략(게이트웨이 어댑터 우선, Workers 연결 방식, 데이터 이전 리허설)은 prep/db-beta-scale 스펙 개정판이 정본. 상세 ADR-0040|
|D77|가입은 Supabase Auth|로그인·계정을 Cloudflare Access 위임에서 **Supabase Auth**(이메일+비밀번호, 기관 관리자 MFA 필수)로 바꾼다(2026-08-29 그릴링, 2장 인증 행 대체. D39 프로토타입의 초대 토큰 흐름은 재사용). 이번 범위는 표준 6종: 기관 관리자 초대 → 실무자 가입 → 로그인 → 관리자 MFA → 초대 만료·재발급 → 퇴사 시 세션 종료와 계정 비활성화. 초대 이메일 자동 발송은 제외하고 링크 복사를 유지한다. 상세 ADR-0040|
|D78|STT 다중 엔진 스왑|STT는 한 엔진을 확정하지 않고 **언제든 갈아끼울 수 있는 상태**를 목표로 한다(2026-08-29 그릴링, D67의 결승 2파전 구도 개정. D53의 무음 청크·반복 검사·엔진 추상화는 불변). 어댑터 4종을 등록한다: whisper(현행 로컬), clova(국내 클라우드), rtzr(국내 클라우드), qwen3-asr(로컬, D53 구 1순위 부활). 전환은 `CCC_STT_ENGINE` 설정 하나로 하고 G1~G3 비교는 전 엔진 대상, 운영 엔진 확정은 비교 후 Q가 한다. 실행 위치는 처리 장비 유지(로컬 엔진 구동 필요). 외부 엔진은 마스킹 전 원본 음성이 사업자에 전달되므로 D79의 녹음·STT 위탁 동의와 보관·삭제 계약 확인 전에는 운영 경로로 확정하지 않는다. 상세 ADR-0040|
|D79|동의 4영역 분리|동의를 2종 통합(D49)에서 **4영역 분리**로 재편한다(2026-08-29 그릴링, D49 대체. D15의 분리 정신 부활 + 민감정보 신설): ① 개인정보 수집·이용 ② 민감정보(건강·채무) 처리 ③ 녹음과 STT 처리위탁 ④ AI 처리(마스킹 텍스트의 국외 이전 고지 포함). 동의 증거에 적용 provider·처리 목적·철회 시각을 확장한다(스키마 확장은 문안 확정 후 구현). **법률 검토는 파일럿 중 착수한다**(D46의 "MVP 범위 종료" 부분 개정): 4영역 문안 초안을 만들어 변호사 검토를 의뢰하고 실데이터 개시는 여전히 검토 완료 후다. 검토 목록 정본은 docs/consent/legal-review-open-items-v1.md. 상세 ADR-0040|
```

### 2-2. 9장 머리말 날짜 목록

9장 제목 괄호 안 목록 끝(`… 2026-08-23 그릴링 D75)`)을 `… 2026-08-23 그릴링 D75 · 2026-08-29 그릴링 D76~D79)`로 확장.

### 2-3. 2장 기술 스택 표 3행 교체

| 행 | 새 내용(도구 칸 / 메모 칸) |
|---|---|
| 인증 | `Supabase Auth (이전 착수, 구 Cloudflare Access)` / 기존 메모의 역할 서술(기관·팀 단위 초대제, 복수 역할 겸임…)은 유지하고 맨 앞에 "이메일+비밀번호, 기관 관리자 MFA 필수(D77)." 를 추가 |
| DB | `Supabase PostgreSQL 서울 (이전 착수, 구 Cloudflare D1)` / "RLS 병용. 이전 완료 전까지 개발·프리뷰는 D1 경로가 동작(D76). R1 게이트웨이 단일 관문은 불변" |
| 파일 저장 | `Supabase Storage 서울 (이전 착수, 구 Cloudflare R2)` / "음성 임시 보관. 30일 자동 삭제 규칙은 이전 시 동등하게 재설정(D76)" |

서버 로직 행(Cloudflare Workers)은 그대로 둔다(완성 목표 문서도 Cloudflare를 입구·중계로 유지).

### 2-4. 5장 모델 정보 STT 항목 교체

현행 "- STT: **엔진 미확정(D53)** — 현행 openai/whisper 유지, 후보 1순위는 Qwen3-ASR-1.7B…" 항목 전체를 다음으로 교체:

```
- STT: **다중 엔진 스왑 상태가 목표(D78)** — 어댑터 4종(whisper 현행, clova, rtzr, qwen3-asr)을 등록하고 `CCC_STT_ENGINE` 하나로 전환한다. 운영 엔진 확정은 G1~G3 전 엔진 비교 후(그 세션은 처리 장비 앞에서). 엔진과 무관하게 **무음 경계 청크 분할 + 반복 검사**는 필수(ADR-0024). 근거: `docs/aside/` 조사 3건 + prep/stt-engine 스펙의 CLOVA·RTZR API 사실 조사
```

### 2-5. 8장 미결 갱신 3곳 + 해소 1곳

- "기관 규모: Cloudflare Access 무료 한도 50명 이내인지 확인" 항목을 `green` 해소로 교체: "~~기관 규모: Cloudflare Access 무료 한도~~ `green` **해소(2026-08-29 D77)**: Supabase Auth로 대체되어 Access 좌석 한도 무관".
- "Cloudflare 기관 계정 개설 + Access 설정" 항목의 문구를 "Cloudflare 기관 계정 개설(Workers·Pages 배포용): 현재 미개설, 병렬 액션 유지. Access 설정은 D77로 불필요해짐 (D16)"으로 교체.
- STT 게이트 항목(`STT 실측 게이트 G1~G3 미실행(D53)`) 끝에 " 비교 대상은 D78의 4엔진(whisper·clova·rtzr·qwen3-asr)"을 덧붙인다.
- 동의서 문안 항목의 "동의는 **2종**이다" 서술 앞에 "**2026-08-29 D79로 4영역 분리로 재편**(아래 2종 서술은 결정 당시 기록). 문안 초안 작성과 변호사 검토는 파일럿 중 착수. " 를 추가한다.

## 3단계: 준비 스펙 4개 개정 (각 워크트리에서, 독립·병렬 가능)

각 워크트리는 어제 만든 스펙 1개를 개정한다. 파일명 유지, 상태 줄에 "2026-08-29 그릴링 D76~D79 반영" 추가, 관계 줄에 해당 D번호 추가. 빌드·테스트 실행 금지.

### 3-1. `.worktrees/db-beta-scale/docs/superpowers/specs/2026-08-29-db-beta-scale-prep.md` (대개정)

제목을 "DB 베타 스케일과 서울 리전 이전 준비 스펙"으로 바꾸고 다음을 반영:

1. **새 구획 "서울 리전 이전 계획(D76)"** 을 배경 뒤에 신설: ① 게이트웨이 어댑터 전략 — D1Database의 `prepare`·`batch` 인터페이스를 모사하는 PG 어댑터를 만들어 호출부 160곳을 건드리지 않는 방식을 1차로 한다(전면 치환은 이전 완료 후 후속. 근거: 파일럿 기간 D1·PG 겸용 가능, 회귀 최소) ② 마이그레이션 0001~0044의 SQLite 방언 요소(트리거, PRAGMA, 타입) 목록화와 PG 변환 방침 ③ Workers에서 Supabase 접속 방식 조사(Cloudflare Hyperdrive 경유 TCP vs supabase-js HTTP)를 출처 URL과 함께 기록 ④ RLS 도입 범위: `org_id` 기준 전 업무 테이블, 게이트웨이 검사(R1)와 이중 방어 ⑤ Supabase Auth 사용자와 기존 `users` 표 매핑 방침 ⑥ 데이터 이전 리허설 절차(가상 시드로 D1 → PG 왕복 검증) ⑦ 음성을 R2에서 Supabase Storage로 옮기는 절차와 30일 수명 동등 재설정.
2. 기존 keyset 페이지네이션·인덱스 후보·측정 하네스 구획은 유지하되 "PG에서도 동일 유효" 한 줄을 달고, D1 공식 한도 구획은 "이전 완료 전 참고"로 강등.
3. 구현 단계 분할을 (a) 게이트웨이 PG 어댑터 (b) 마이그레이션 변환 (c) Auth 매핑 (d) 이전 리허설 (e) 인덱스·페이지네이션 (f) 측정 순으로 재배열.
4. 결정 포인트에서 해소된 것(제공자·시기)을 지우고, 남는 것(RLS 정책 상세, Hyperdrive 채택 여부, 음성 수명 값)만 남긴다.

### 3-2. `.worktrees/stt-engine/docs/superpowers/specs/2026-08-29-stt-engine-prep.md`

1. 어댑터 계약 구획을 4종으로 확장: `KNOWN_ENGINES = ("whisper", "clova", "rtzr", "qwen3-asr")`. qwen3-asr 로컬 어댑터의 설정 변수 이름을 명명(`CCC_QWEN_MODEL_ID`, 가중치 캐시 경로는 기존 HF 캐시 규칙 준용)하고, 로컬 엔진도 동일 `Engine` callable 계약과 `transcribe_audio` 경유를 명시.
2. "언제든 갈아끼울 수 있는 상태"가 목표임을 배경에 명시(D78 인용), 실행 위치는 처리 장비 유지와 그 근거(로컬 엔진 구동).
3. G1~G3 비교 대상을 전 4엔진으로 확장(기존 표의 대조군 서술 갱신).
4. 결정 포인트 4번("Whisper만 운영할지, CLOVA·RTZR 중 하나를 예외 경로로 승인할지")을 D78 확정 내용으로 교체: 남는 결정은 completion 방식, 백오프, 보관·삭제 계약 확인, 그리고 운영 엔진 최종 확정(비교 후).

### 3-3. `.worktrees/mobile-signup-signature/docs/superpowers/specs/2026-08-29-mobile-signup-signature-prep.md`

1. 배경의 "로그인은 Cloudflare Access 위임" 서술에 D77 확정을 반영: 가입·로그인 기반은 Supabase Auth로 바뀐다.
2. 새 구획 "가입 방식 확정(D77)": 표준 6종 범위(초대 → 가입 → 로그인 → 관리자 MFA → 초대 만료·재발급 → 퇴사 비활성화), 이메일 자동 발송 제외, invite_tokens 재사용과 `expires_at` 설계는 유지(이 스펙의 기존 토큰 수명 구획과 연결).
3. 서명·모바일 구획은 무변경.

### 3-4. `.worktrees/oss-local-package/docs/superpowers/specs/2026-08-29-oss-local-package-prep.md` (경미)

DB Provider 어댑터 축 서술에 "관리형은 Supabase PostgreSQL 서울이 기본(D76), 게이트웨이 어댑터는 D1(로컬 모드)과 PG(관리형)를 겸용" 한 줄을 반영하고 관계 줄에 D76 추가.

`prep/ai-provider-live` 스펙은 무변경(스냅샷 표 이전은 3-1의 이전 계획이 다룬다).

## 4단계: Linear 갱신

먼저 `~/developer/tools/portwright/services/linear.md` 를 읽는다(Composio 경유, 팀 CCC UUID `f60e437c-bf04-4d41-9206-a1fc09b6884b`, 코멘트는 전용 툴 `LINEAR_CREATE_LINEAR_COMMENT` 사용, `ENOTFOUND backend.composio.dev` 는 일시 장애이므로 재인증하지 말고 대기 후 재시도).

1. **코멘트 3건** (내용 골격, 긴 대시 금지, 쉬운 한글):
   - CCC-137(DB 베타 스케일): "그릴링 결정으로 방향이 바뀌었습니다. 데이터를 Supabase 서울로 옮기기로 했고(D76), 이 티켓의 스펙은 이전 계획 중심으로 개정됐습니다. 페이지네이션과 인덱스 설계는 그대로 유효합니다."
   - CCC-136(모바일 가입과 서명): "가입 방식이 Supabase Auth로 확정됐습니다(D77). 범위는 초대, 가입, 로그인, 관리자 이중 인증, 초대 만료, 퇴사 비활성화까지이고 이메일 자동 발송은 뺍니다."
   - CCC-134(STT): "엔진을 하나로 정하지 않고 4종(whisper, clova, rtzr, qwen3-asr)을 갈아끼울 수 있게 만들기로 했습니다(D78). 비교 후 최종 확정합니다."
2. **신규 티켓 2건** (`LINEAR_CREATE_LINEAR_ISSUE`, 상태 기본 Backlog):
   - 제목 `서울 리전 이전(Supabase) 구축`: 본문 ① 한 줄 목적: 상담 데이터를 한국(서울) 데이터센터의 Supabase로 옮겨 실데이터 베타의 저장 위치 요구를 충족한다 ② 스펙: `docs/superpowers/specs/2026-08-29-db-beta-scale-prep.md` 개정판(브랜치 `prep/db-beta-scale`) ③ 착수 조건: 스펙의 남은 결정 포인트(RLS 상세, 접속 방식) 확인 ④ 완료 기준: 스펙의 구현 단계 (a)~(f).
   - 제목 `동의 4영역 개편과 법률 검토 착수`: 본문 ① 한 줄 목적: 동의를 4영역(개인정보, 민감정보, 녹음·STT, AI 처리)으로 나누고 변호사 검토를 파일럿 중에 시작한다(D79) ② 산출물: 4영역 문안 초안(docs/consent/ 아래 v1 초안) + 검토 의뢰 ③ 스키마 확장(provider·목적·철회)은 문안 확정 후 별도 진행 ④ 근거 목록: `docs/consent/legal-review-open-items-v1.md` 항목 4·5·7·8.
3. Slack 스레드 게시는 하지 않는다.

## 5단계: 커밋·푸시·보고

1. 메인 워크트리: `git add CLAUDE.md docs/adr/0040-seoul-region-supabase-auth-stt-consent.md` 두 경로만 스테이징 → 커밋 `docs(decisions): 2026-08-29 그릴링 D76~D79 기록` → `git push origin main`.
2. 스펙 워크트리 4곳: 각각 커밋 `docs(prep): 그릴링 D76~D79 반영` → `git push` (추적 브랜치 설정 완료 상태).
3. 최종 보고 표: 결정 4묶음(D76~D79) | 기록 위치(ADR·9장) | 개정 스펙·커밋 | Linear 코멘트·신규 티켓 ID. 추가로 "다음 착수 순서: 1~2주차 = D76+D77(Supabase 구축과 가입), 병행 = D79 문안 초안, STT 어댑터는 CCC-134 스펙대로" 한 줄.

## Critical files & anchors

- `CLAUDE.md` : 9장 표 끝(D75·CCC-133 행), 2장 표, 5장 모델 정보, 8장 미결 — 편집 4곳 전부 실행 시 재독 후 정확한 행에 적용.
- `docs/adr/0035-contest-scope-and-deployment-doors.md` — ADR 형식·대체 관계 서술의 참고 원형.
- `.worktrees/db-beta-scale/docs/superpowers/specs/2026-08-29-db-beta-scale-prep.md` — 대개정 대상(기존 7구획 구조 위에 이전 계획 구획 신설).
- `.worktrees/stt-engine/docs/superpowers/specs/2026-08-29-stt-engine-prep.md` — 어댑터 계약·결정 포인트 구획.
- `~/developer/tools/portwright/services/linear.md` — Composio 절차·운영 ID·함정(레포 밖, 읽기만).

## Verification

1. `grep -c '^|D7[6-9]|' CLAUDE.md` 가 4를 반환한다(레포 루트).
2. `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md` 존재, 커밋이 pre-commit 가드(문서 번호·시크릿 포함)를 통과한다.
3. 새로 추가·수정된 텍스트에 긴 대시 0건: `grep '—'` 를 CLAUDE.md 신규 행(D76~D79)·ADR-0040·개정 스펙 4개에 대해 실행해 신규 추가분 0건 확인(기존 문서의 역사적 긴 대시는 소급 수정하지 않는다).
4. stt-engine 스펙에 `qwen3-asr` 와 `KNOWN_ENGINES` 4종 서술 존재(grep).
5. db-beta-scale 스펙에 "게이트웨이 어댑터"와 "Hyperdrive" 조사 절 존재(grep), 조사 출처 URL 포함.
6. `git ls-remote --heads origin` 에서 main과 prep 브랜치 4개의 새 커밋 해시 확인.
7. Linear: 코멘트 3건과 신규 티켓 2건을 조회 API로 재확인해 ID를 보고에 싣는다.

## Assumptions & contingencies

- **실행 시점 main이 origin보다 뒤지거나 dirty면**: `git pull --ff-only` 먼저 시도(2026-08-29 확인 시점은 클린·동기). 실패하거나 CLAUDE.md 자체에 미커밋 변경이 있으면 중단하고 사용자에게 상태를 보고한다(결정 기록이 사용자 변경과 섞이면 안 된다).
- **ADR 번호 충돌(실행 사이에 0040이 생김)**: 다음 빈 번호를 쓰고 이 계획의 모든 0040 인용을 그 번호로 일괄 치환한다. D76~D79 번호 충돌도 같은 방식(다음 빈 D번호로 밀고 ADR·스펙·티켓 문안 일괄 조정).
- **Composio가 `ENOTFOUND backend.composio.dev` 로 실패하면**: 재인증하지 않고 다른 단계를 먼저 수행한 뒤 재시도. 끝까지 실패하면 코멘트·티켓 본문 초안을 최종 보고에 싣고 종료.
- **Hyperdrive 조사에서 공식 문서를 못 찾는 항목**: 스펙에 "미확인, 출처 필요"로 표시하고 추정을 사실처럼 적지 않는다.
