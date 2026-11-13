# ADR-0041: 코어 하나, 배포 모드 셋 (CCC Open Pilot v0.2)

- 상태: 제안 (2026-09-02 작성, Q 승인 대기)
- 결정자: Q (제안: 공쥬, 검토: Claude Fable 5.1, ChatGPT 최종 검수)
- 관련: ADR-0035(D63 배포 문 넷), ADR-0040(Community Cloud 정책), ADR-0036(AI 재료 계약), ADR-0038(역할), D8(폴백 없음), D13(처리 장비는 API만), D57(마스킹)
- 대체: D65(로컬 우선, PostgreSQL 연기), D67(CLOVA/RTZR 결승), D68 일부(시연 전부 가상), ADR-0040 14장의 "완전한 로컬 서버 배포판 제외", 9/01 통합본의 Azure Functions/Key Vault/Managed AI/동의 4영역, 8/31 계획 3종의 Hyperdrive와 Workers 중계 전제
- 후속: CLAUDE.md 9장에 D76~D83 등재, PRD v0.2, 스펙 S1~S15, 티켓 E0~E12
- 정본 규칙: 이 문서와 충돌하는 모든 노션 문서와 레포 문서는 이 문서가 이긴다. 충돌을 발견하면 이 문서를 고치지 말고 상대 문서에 "Superseded by ADR-0041"을 붙인다.

## 배경

2026-08-16 D63은 "코어 하나에 배포 문 넷"을 승인했다. 9/01 ADR-0040은 Community Cloud의 정책을 정했고, 9/02 배포 방식 검토는 문 넷을 세 모드로 정리했다. 9/02 구현계획 핸드오프를 Claude Fable 5.1이 저장소와 대조해 검토했고, ChatGPT가 그 검토를 다시 검수했다. 두 검토가 합의한 것과 저장소에서 실측한 것을 이 문서 하나로 모은다.

저장소 실측(2026-09-02, `main` `ba271e4`):

- `db/gateway.ts` 17,357줄, 내보낸 함수 약 380개, D1 호출 751곳, 트랜잭션은 `env.DB.batch()` 44곳.
- `migrations/` 0001~0044 순수 SQLite. `db/schema.sql` 6,364줄이 현재 최종 상태.
- `apps/api/src/request-handler.ts` 2,925줄, 표준 Request/Response 기반 `handleRequest(request, env)`.
- `apps/api/src/ai-provider.ts` 30행 `MAX_MASKED_TEXT_LENGTH = 24_000`, 1,343행 근처 `/v1/responses` 호출에 `store:false` 없음.
- `apps/web` 30화면 중 29개 서버 컴포넌트, 서버 액션 34개, `app/lib/api.ts` 1,270줄 `server-only`.
- `apps/pipeline` Python 폴링 클라이언트, WSL2+CUDA 전제, whisper medium, pyannote(HF 승인), NER 미설정 시 처리 중단.
- gateway의 SQLite 전용 표현 22곳: `datetime('now')` 8, `strftime(` 7, `INSERT OR IGNORE` 4, `ON CONFLICT` 1, `RETURNING` 2.
- 테스트 `apps/api/test` 52파일 599케이스.

## 결정

### D76. 배포 모드는 셋이고 셋 다 정식 구현이다

| 모드 | 대상 | 데이터 위치 | 접속 |
|---|---|---|---|
| Community Cloud | 여러 장소에서 접속하는 기관 | 기관별 Supabase 서울 프로젝트(PostgreSQL, Auth, private Storage, Edge Function) | 인터넷 HTTPS |
| Local Single | 실무자 PC 1대 | 그 PC의 암호화 SQLite + 암호화 파일 | 127.0.0.1 전용 |
| Local Office | 사무실 서버 PC 1대 | 서버 PC의 암호화 SQLite | 내부망 HTTPS |

D63의 문 넷과 대응: 관리형 웹 → Community Cloud, CCC 박스와 개인 노트북 모드 → Local Office와 Local Single, 기관 자체 클라우드 → 후속. 세 모드는 같은 화면, 같은 API, 같은 규칙을 쓴다. 9/18은 제출일이지 종료일이 아니다. 어떤 모드도 일정을 이유로 빼거나 낮추지 않는다.

### D77. 저장 모드와 AI 모드는 독립이다

- STT 축: Local(faster-whisper int8 CPU, 기본), Azure Speech(기관 키, 서울), Off.
- LLM 축: OpenAI BYOK(기관 키, `store:false`), Off.
- Managed AI, CLOVA, RTZR, 로컬 LLM은 이번 범위 밖이다. 포트만 남긴다.
- 실패하면 다른 사업자로 자동 전환하지 않는다(D8).
- AI를 켜면 모드와 무관하게 처리 Agent가 도는 기관 PC 1대가 필요하다. 마스킹 NER이 그 PC에서만 돌기 때문이다. Edge Function(CPU 2초, 메모리 256MB, 번들 20MB)에는 NER을 올리지 않는다.

### D78. 공통 코어와 런타임 포트 7개

코어 = 현행 `db/gateway.ts` + `request-handler.ts` + `ai-provider.ts`를 `packages/core`, `packages/http-api`, `packages/ai-runtime`, `packages/contracts`로 옮긴 것. 행동 변경 없이 옮긴다.

런타임 포트는 일곱 개다: `Database`, `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `STTProvider`, `AIProvider`. STT와 LLM은 실행 위치(Agent와 코어)와 데이터 형태(음성과 글)가 달라 합치지 않는다. 백업과 복원, 가져오기와 내보내기, 업데이트와 진단은 포트가 아니라 공통 Application Service다.

Hono를 새로 도입하지 않는다. `handleRequest`는 이미 표준 fetch 핸들러이므로 실행 환경별 껍데기(Edge Deno serve, Node http 다리, Workers 현행)만 씌운다. cron은 `Scheduler` 포트.

불변조건: `packages/core`가 `@cloudflare`, `@supabase`, `electron`, `node:` 를 import하면 CI 실패. core는 Web Crypto와 fetch만 쓴다. core 테스트는 Node와 Deno 둘 다에서 돈다.

### D79. Database 포트는 좁게, SQL 번역기는 없다, PostgreSQL은 baseline부터

- 1단계: 8/31 계획 62~80행의 좁은 `Database` 포트(prepare, bind, first, all, run + 원자적 batch). `batch()`가 트랜잭션이다. 대화형 UnitOfWork는 만들지 않는다.
- SQL 자동 번역기는 만들지 않는다. 어댑터는 `?` 자리표시자를 번호 형식으로 바꾸는 것만 한다. 현재 시각은 앱이 ISO 문자열로 바인딩한다. 충돌 처리는 이름 붙은 이식용 도우미를 쓴다. gateway의 SQLite 전용 표현 22곳을 손으로 고친다. 방언 전용 SQL은 CI 린트가 막는다.
- PostgreSQL 마이그레이션은 `db/schema.sql` 기준 `0001_baseline` 하나로 시작한다. 과거 44개 SQLite 마이그레이션은 번역하지 않는다. 그 뒤부터 논리 ID 하나에 SQLite와 PostgreSQL 두 벌을 함께 쓰고 `migrations/parity.yaml`에 대응을 적는다. 기존 D1 데이터는 8/31 계획 Task 7의 ETL로 옮긴다.
- 2단계(9/19부터): 동의 → 감사 → AI 초안 → 케이스 순으로 typed repository로 승격한다. 승격할 때마다 기존 테스트 전부를 유지한다.
- 계약 테스트: 같은 fixture를 D1, SQLite, PostgreSQL에 넣고 결과가 같아야 한다.
- 평문 SQLite는 최종 제품에서 금지한다. 암호화 SQLite(`better-sqlite3-multiple-ciphers` 1순위)가 안 되면 다른 암호화 구현으로 바꾼다. 평문 DB는 합성 데이터 개발용에만 쓴다.

### D80. 업무 클라이언트는 정적, Cloudflare는 정적 파일과 공개 페이지만

- 불변조건은 "정적 클라이언트 + Bearer 토큰 API"다. 구현은 Vite + React PWA(`apps/client`)로 한다.
- 현행 `app/lib/api.ts`의 타입과 오류코드 21종을 브라우저용 클라이언트로 옮긴다. 서버 컴포넌트 29개와 서버 액션 34개는 API 호출로 바꾼다.
- 공개 사이트(`apps/site`, Next)는 랜딩, 가상데이터 데모, 문서만 담는다. 상담 데이터는 Cloudflare를 지나지 않는다. E2E가 이를 검사한다.
- 9/3부터 Next 업무 화면의 기능 추가는 동결한다.

### D81. 프라이버시 게이트웨이와 원음 생명주기

- 1단계(Agent): 현행 `masking.py`(정규식 + 질병명 사전 + NER)에 준식별자 일반화 층을 더한다(생년월일 → 연령대, 직장 → 업종 등, 규칙표는 S6).
- 2단계(코어): 정규식, 금고 값 대조, 근거 해시로 재검증한다. Edge CPU 2초 안에 끝나는 것만 한다. 걸리면 보내지 않고 멈춘다(fail-closed). 상태 코드 5종과 화면 문구는 S6.
- AI Packet = 현행 `MaskedSourceSnapshot`(ADR-0036) + 일반화 층 + 근거 해시. ADR-0036 재료 계약은 바꾸지 않는다.
- 장문: 재료별 24,000자 상한을 넘는 전사문은 S15 규칙대로 시간 구간별로 나눠 보내고 합친다. 조용히 뒤를 자르지 않는다. 빠진 구간은 실무자에게 표시한다.
- 원음: 처리 뒤 즉시, 늦어도 24시간 안에 삭제가 기본. 7일/30일 보관은 기관 선택이며 기관 소유 저장소에만. Cloud의 임시 원음은 Supabase private 버킷을 24시간에 한해 허용한다(ADR-0040 8.2 개정). 삭제 증거 5단계: 원본 삭제 성공, 목록과 메타데이터 부재 확인, 전파 대기(약 60초) 뒤 인증 GET 404, 삭제 시각과 객체 해시 기록, 음성에는 장기 signed URL 발급 금지.
- OpenAI 호출은 `store:false`를 붙인다(P0, E1-1).

### D82. 동의, 키, 신원

- 동의는 ADR-0040 9장의 6영역 그대로. 기존 동의를 새 영역으로 자동 승격하지 않는다.
- 키는 호출하는 곳에만 둔다. Community Cloud: OpenAI 키는 Edge Function 시크릿, Azure 키는 Agent SecretStore. Local 두 모드: 그 PC의 DPAPI. 한 키를 두 곳에 두지 않는다.
- 신원: Cloud는 Supabase Auth(JWT → Actor, 실무자와 관리자 MFA), Office는 로컬 계정(Argon2id, 잠금, 관리자 MFA), Single은 OS 사용자 + 앱 잠금. 역할 체계는 ADR-0038 그대로.
- Cloud RLS는 브라우저의 anon 키 직접 접근을 막는 2차 방어다. 기본 정책은 전부 거부. gateway 권한 검사의 대체가 아니다.
- Local Office는 브라우저 녹음(getUserMedia)에 보안 컨텍스트가 필요하므로 내부망에서도 TLS 필수. 로컬 CA(name constraints, CA 키는 서버 DPAPI + Recovery Kit)를 기본으로, 기관 인증서가 있으면 우선.

### D83. 이전, 설치, 릴리스

- `.cccx` 포맷 하나가 모드 이전, 종료 시 전체 내보내기, 백업 복구 검증을 맡는다. manifest + schema version + JSONL + 첨부 + 파일별 SHA-256, 전체 암호화(Argon2id → AES-GCM). 지원 방향은 전 방향이며 순서는 Single→Office, Single→Cloud 가져오기 먼저.
- 설치: Local Single은 Electron + NSIS(모델 제외, 설치 후 내려받기), Local Office는 서버 설치기 + 클라이언트 설치기, Community Cloud는 install/doctor/update/rollback/report 명령. Agent는 별도 설치기(embedded Python, ffmpeg).
- 자동 업데이트(매니페스트, 서명 검증, 업데이트 전 백업, rollback)는 9/18 범위다.
- 코드서명: 1순위는 한국 법인이 받을 수 있는 OV/EV 인증서. Azure Artifact Signing은 공식 quickstart가 South Korea를 포함하므로 포털에서 확인 후 병행. 체크섬은 내부 개발판 검증용이지 정식 서명의 대체가 아니다.
- 테스트 완료 기준은 숫자로 고정하지 않는다. "기존 테스트 전부 + 새 포트 계약 테스트 + 3모드 골든 플로우 통과, 삭제와 skip과 완화한 assertion 0건".

## 완료 기준 (모드별, 계획 원문 그대로)

- Community Cloud: 깨끗한 기관 계정에서 합성 종단 설치 뒤 사회연대은행 실상담 흐름 작동. 마스킹 전 OpenAI 전송 0건, 기관 간 접근 0건, 백업/복원 성공, Edge 로그에 PII와 원문 0건.
- Local Single: 새 Windows PC에서 설치 → 상담 → AI 또는 AI Off → 백업 → 삭제 → 복원 → export 성공. 외부 NIC listen 0건. 키가 DB와 로그와 화면에 0건.
- Local Office: 서버 설치기와 클라이언트 설치기 생성, 서버 1대 + 클라이언트 2대 동시 사용, 평문 HTTP 0건, 공개 포트 0건, 409 충돌 재현, 서버 교체 복원 성공.

게이트를 못 넘은 항목은 릴리스에서 빼지 않고 "미통과" 상태를 화면과 릴리스 노트에 명시한 채 담고 다음 릴리스에서 통과시킨다. 실데이터만은 예외다. 실데이터는 법무 게이트(G1~G3)와 기능 게이트를 넘은 곳에만 넣는다.

## 실데이터 게이트 (우회 불가)

개인정보 처리방침 게시, 동의 6영역 문안, Supabase 위탁 문서, 국외이전 고지(OpenAI), OpenAI DPA 민감정보 서면 확인 또는 비식별 수준 법률 검토(ADR-0040 7.2), 기관별 보존 근거표, 권리요청 10일 절차, 침해사고 72시간 절차, 9/11 시행 법 개정 대조. 항목마다 담당자와 마감을 9/5까지 정한다. 닫히는 즉시 실데이터 파일럿을 시작하고 9/18 뒤에도 계속한다.

## 결과와 위험

- 일정 밀도: PostgreSQL 트랙을 별도로 돌리고 9/4, 9/7, 9/10에 진행을 점검한다. 점검은 범위를 자르는 자리가 아니라 사람과 순서를 다시 배치하는 자리다.
- 외부 리드타임(코드서명, Azure grant, pyannote 승인, OpenAI DPA, 법무)은 9/2에 신청한다.
- 숫자 충돌: 8/31 계획이 예약한 D76~D79는 이 문서의 D76~D83으로 대체한다. `guard:doc-numbers` 통과 뒤 CLAUDE.md 9장에 등재한다.

## 열린 항목 (Q 확인)

1. Local STT 기본 엔진을 faster-whisper int8로 확정하는가. Qwen3-ASR은 정확도 게이트 뒤 후보(E5-8).
2. Cloud 임시 원음의 Supabase private 버킷 24시간 허용(ADR-0040 8.2 개정)에 동의하는가.
3. 8/9 목표 모델 검수의 Q 확인 4건은 E12-6으로 9/19 이후 처리하는 데 동의하는가.
