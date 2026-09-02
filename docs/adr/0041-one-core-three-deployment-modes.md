# ADR-0041: 코어 하나, 배포 모드 셋 (CCC Open Pilot v0.3)

- 상태: 승인 (2026-09-02)
- 결정자: Q
- 관련: ADR-0035(D63 배포 문 넷), ADR-0040(Community Cloud 정책), ADR-0042(D84 Supabase 사전 점검), ADR-0036(AI 재료 계약), ADR-0038(역할), D8(폴백 없음), D13(처리 장비는 API만), D57(마스킹)
- 대체: D65(로컬 우선, PostgreSQL 연기), D67(STT 결승 후보), D68 일부(시연 전부 가상), Notion ADR-0040 §8.2의 audio-retention과 §14의 local-server-exclusion, 그리고 예전 PR #210과 현재 ADR-0042의 Workers relay/30-day policy를 대체한다. 2026-09-01 통합본의 Azure Functions·Key Vault·Managed AI·동의 4영역과 2026-08-31 계획의 Hyperdrive 전제도 대체한다.
- 후속: `CLAUDE.md` 9장 D76~D83 색인, `PRD/CCC-open-pilot-v0.2.md`, `docs/specs/` S1~S15, E0~E12
- 정본 규칙: 이 문서와 충돌하는 노션 문서와 레포 문서는 이 문서가 이긴다. 충돌 문서에는 `Superseded by ADR-0041`을 표시한다. ADR-0042와 D84는 Supabase 사전 점검 범위에서 보존하며 이 ADR의 배포·원음 정책을 따른다.

## 배경

D63은 코어 하나에 네 개의 배포 문을 열었지만, 2026-09-02 검토에서 제출 범위와 운영 책임을 세 가지 정식 모드로 다시 묶었다. 모드마다 저장소와 인증 경계는 다르지만 화면, API, 권한, 감사, 개인정보 게이트와 AI 재료 계약은 하나여야 한다.

Community Cloud에서는 기관이 소유한 Supabase 프로젝트를 사용한다. 원음은 AI 처리 전까지 필요한 만큼만 기관 소유 private Storage에 임시 보관할 수 있어야 하며, 처리 기회를 보장하는 시계와 삭제 증거가 계약에 포함되어야 한다. Local 모드에서는 기관 PC가 저장과 처리를 직접 소유한다.

2026-09-02 Q는 다음 다섯 가지를 승인했다.

1. Community Cloud, Local Single, Local Office를 모두 정식 구현한다.
2. 설치 직후 STT 기본값은 세 모드 모두 `off`다.
3. Community Cloud의 원음 임시 보관은 기관 소유 Supabase private Storage에서만 허용한다.
4. 목표 모델 검수는 E2-8에서 수행한다.
5. 원음은 다음 영업일의 첫 Agent 처리 기회까지 보관하고, 처리 뒤 즉시 삭제한다. 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 원음을 삭제하고 관리자 장애 상태를 남긴다.

## 결정

### D76. 배포 모드는 셋이고 셋 다 정식 구현이다

| 모드 | 대상 | 데이터 위치 | 접속 |
|---|---|---|---|
| Community Cloud | 여러 장소에서 접속하는 기관 | 기관별 Supabase 서울 프로젝트, PostgreSQL, Auth, private Storage, Edge Function | 인터넷 HTTPS |
| Local Single | 실무자 PC 1대 | 해당 PC의 암호화 SQLite와 암호화 파일 | `127.0.0.1` 전용 |
| Local Office | 사무실 서버 PC 1대 | 서버 PC의 암호화 SQLite | 내부망 HTTPS |

D63의 배포 문 대응은 관리형 웹에서 Community Cloud, CCC 박스와 개인 노트북 모드에서 Local Office와 Local Single이다. 기관 자체 클라우드는 후속 맞춤 계약으로 남긴다. 세 모드는 같은 화면, 같은 API, 같은 규칙을 사용한다. 9월 18일은 제출일이지 종료일이 아니며 일정을 이유로 모드를 빼거나 낮추지 않는다.

### D77. 저장 모드와 AI 모드는 독립이고 STT 설치 기본값은 `off`다

- STT 축은 `off`, `local`, `azure`다. 설치 직후에는 세 모드 모두 `off`이며, 관리자가 provider를 명시적으로 고르고 health check를 통과한 뒤에만 `local` 또는 `azure`를 선택할 수 있다.
- `local` 엔진은 STT-G1~STT-G3 실측과 Q의 결과 승인이 끝나기 전까지 확정하지 않는다. `faster-whisper`는 E5-8의 측정 후보일 뿐이며 설치 시 자동 선택하거나 기본값으로 유지하지 않는다. Q 승인 전에는 `sttEngine`이 `null`이고 Local 선택지는 비활성이다.
- `azure`는 기관 키와 서울 endpoint를 사용하는 명시적 선택이다. 원음의 외부 이전 조건과 동의가 충족되지 않으면 선택할 수 없다.
- LLM 축은 `off`, `openai`다. OpenAI BYOK는 기관 키와 `store:false`를 사용한다.
- Managed AI, CLOVA, RTZR, 로컬 LLM은 이번 범위 밖이며 포트만 남긴다.
- 어떤 실패에도 다른 사업자로 자동 전환하지 않는다. 실패 시 수기 기록 경로를 제공한다(D8).
- AI를 켜면 모드와 무관하게 처리 Agent가 실행되는 기관 PC 1대가 필요하다. 2차 마스킹 NER은 그 PC에서만 실행하고 Edge Function의 CPU 2초, 메모리 256MB, 번들 20MB 제한 안에는 올리지 않는다.

### D78. 공통 코어와 런타임 포트 일곱 개

코어는 현행 `db/gateway.ts`, `request-handler.ts`, `ai-provider.ts`를 행동 변경 없이 `packages/core`, `packages/http-api`, `packages/ai-runtime`, `packages/contracts`로 옮긴 것이다.

런타임 포트는 일곱 개다.

1. `Database`
2. `AudioStore`
3. `Identity`
4. `SecretStore`
5. `Scheduler`
6. `STTProvider`
7. `AIProvider`

STT와 LLM은 실행 위치와 데이터 형태가 다르므로 합치지 않는다. 백업·복원, 가져오기·내보내기, 업데이트·진단은 포트가 아니라 공통 Application Service다. 새 Hono 도입은 없으며 기존 표준 fetch `handleRequest`에 실행 환경별 껍데기만 씌운다. cron은 `Scheduler` 포트가 담당한다.

`packages/core`가 `@cloudflare`, `@supabase`, `electron`, `node:`를 import하면 CI가 실패한다. 코어는 Web Crypto와 fetch만 사용하며 Node와 Deno에서 계약 테스트를 실행한다.

### D79. Database 포트는 좁게, SQL 번역기는 없고 PostgreSQL은 baseline부터다

- 1단계 `Database` 포트는 `prepare`, `bind`, `first`, `all`, `run`, 원자적 `batch`만 제공한다. `batch()`가 유일한 트랜잭션이며 대화형 UnitOfWork는 만들지 않는다.
- SQL 자동 번역기는 만들지 않는다. 어댑터는 `?` 자리표시자를 순서대로 `$n`으로 바꾸는 것만 허용한다. 현재 시각은 앱이 ISO 문자열로 바인딩하고, 충돌 처리는 이름 붙은 이식용 도우미를 쓴다. SQLite 전용 표현은 손으로 고친다.
- PostgreSQL은 `db/schema.sql` 기준 `migrations/postgres/0001_baseline.sql` 하나로 시작한다. 과거 SQLite 마이그레이션은 번역하지 않으며, 이후 논리 ID 하나에 SQLite와 PostgreSQL 두 벌을 함께 쓰고 `migrations/parity.yaml`에 대응을 적는다. 기존 D1 데이터는 ETL로 옮긴다.
- 2단계부터 동의, 감사, AI 초안, 케이스 순서로 typed repository를 승격한다. 승격할 때 기존 테스트를 모두 유지한다.
- 같은 fixture를 D1, 암호화 SQLite, PostgreSQL에 넣고 결과가 같아야 한다.
- 평문 SQLite는 최종 제품에서 금지한다. 암호화 구현이 준비되지 않으면 해당 Local 릴리스는 미통과이며 평문 DB로 폴백하지 않는다.

### D80. 업무 클라이언트는 정적이고 Cloudflare는 정적 파일과 공개 페이지만 제공한다

불변조건은 정적 클라이언트와 Bearer 토큰 API다. 구현은 Vite + React PWA인 `apps/client`로 한다. 현행 `app/lib/api.ts`의 타입과 오류 코드 21종을 브라우저용 클라이언트로 옮기고, 서버 컴포넌트와 서버 액션은 API 호출로 바꾼다.

공개 사이트인 `apps/site`에는 랜딩, 가상데이터 데모, 문서만 둔다. 상담 데이터는 Cloudflare를 지나지 않는다. 설치기는 서명된 bootstrap의 허용 origin과 `apiBase`를 묶고, 클라이언트는 허용 목록 밖 주소로 Bearer를 보내지 않는다. 2026-09-03부터 Next 업무 화면의 기능 추가는 동결한다.

### D81. 프라이버시 게이트웨이와 원음 생명주기

Agent가 현행 `masking.py`에 준식별자 일반화 층을 더하고, 코어가 정규식, 금고 값 대조, 근거 hash로 다시 검증한다. 검증이 걸리면 전송하지 않고 멈춘다(fail-closed). 장문은 재료별 24,000자 상한을 넘을 때 S15 규칙대로 시간 구간별로 나눠 보내며 뒤를 조용히 자르지 않는다.

SG6의 fail-closed 상태와 화면 문구는 아래 일곱 code로 고정한다. 로그에는 code, session ID hash, timestamp만 남기고 감지 문자열은 남기지 않는다.

| code | 화면 문구 |
|---|---|
| `masking_snapshot_missing` | 가림 처리 결과가 없어 AI 처리를 멈췄습니다. |
| `local_ner_unavailable` | 이름과 주소 가림 기능을 사용할 수 없어 AI 처리를 멈췄습니다. |
| `registered_pii_detected` | 등록된 개인정보가 남아 있어 AI 처리를 멈췄습니다. |
| `unmasked_identifier_detected` | 가려지지 않은 식별 정보가 감지되어 AI 처리를 멈췄습니다. |
| `evidence_hash_mismatch` | 근거 확인값이 맞지 않아 AI 처리를 멈췄습니다. |
| `masking_pipeline_version_mismatch` | 가림 처리 버전이 맞지 않아 AI 처리를 멈췄습니다. |
| `consent_not_effective` | 현재 동의 상태로는 외부 AI 처리를 진행할 수 없습니다. |

AI Packet은 현행 `MaskedSourceSnapshot`, 준식별자 일반화 층, 근거 hash로 구성한다. ADR-0036의 재료 계약은 바꾸지 않는다. OpenAI에는 AI Packet만 보내며 `store:false`를 사용한다.

원음은 세 모드의 `AudioStore`가 관리한다(SG8). Community Cloud 원음은 기관 소유 Supabase private Storage에만 임시 보관한다. 원음은 업로드 시점에 기계적으로 24시간 뒤 삭제하는 것이 아니라 다음 영업일의 첫 Agent 처리 기회까지 보관한다. 그 처리 기회에 Agent가 claim하고 처리하면 즉시 삭제한다. 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 삭제하고 관리자 장애 상태를 기록한다. 삭제 뒤에는 원본 삭제 성공, 목록과 메타데이터 부재 확인, 전파 대기 뒤 인증 GET 404, 삭제 시각과 객체 hash 기록의 증거를 남긴다. 장기 signed URL은 발급하지 않는다. 수기 기록 경로는 계속 제공하며 상담을 다시 녹음하라고 안내하지 않는다(D8).

### D82. 동의, 키, 신원

동의는 ADR-0040 9장의 여섯 영역을 그대로 사용하며 기존 동의를 새 영역으로 자동 승격하지 않는다. Supabase Auth의 JWT에서 `Actor`로 가는 규칙과 기관 관리자·실무자 MFA는 Community Cloud가 담당한다. Local Office는 Argon2id 로컬 계정과 관리자 MFA, Local Single은 OS 사용자와 앱 잠금을 사용한다. 역할 체계는 ADR-0038을 그대로 따른다.

키는 호출하는 곳에만 둔다. PII 금고의 `PII_ENC_KEY`는 SecretStore가 제공하며, Community Cloud에서는 Edge secret, Local 두 모드에서는 해당 PC의 DPAPI에 둔다. Community Cloud의 OpenAI 키는 Edge Function 시크릿, Azure 키는 Agent SecretStore에 둔다. 한 키를 두 곳에 저장하지 않는다. Cloud RLS는 브라우저 anon key의 직접 접근을 막는 2차 방어이고 gateway 권한 검사의 대체가 아니다.

Local Office는 브라우저 녹음에 보안 컨텍스트가 필요하므로 내부망에서도 TLS를 사용한다. 로컬 CA를 기본으로 하고 기관 인증서가 있으면 우선한다.

### D83. 이전, 설치, 릴리스

`.cccx` 포맷 하나가 모드 이전, 종료 시 전체 내보내기, 백업·복구 검증을 맡는다. manifest, schema version, JSONL, 첨부, 파일별 SHA-256을 포함하고 Argon2id에서 AES-GCM으로 전체를 암호화한다. 지원 방향은 전 방향이며 Single에서 Office로, Single에서 Cloud로 가져오기를 먼저 구현한다.

Local Single은 Electron + NSIS 설치기, Local Office는 서버 설치기와 클라이언트 설치기, Community Cloud는 `install`, `doctor`, `update`, `rollback`, `report` 명령을 제공한다. Agent는 embedded Python과 ffmpeg를 포함한 별도 설치기다. 자동 업데이트는 manifest, 서명 검증, 업데이트 전 백업, rollback을 포함한다.

코드서명은 한국 법인이 받을 수 있는 OV/EV 인증서를 1순위로 하고, Azure Artifact Signing은 공식 지원 범위를 확인해 병행한다. 체크섬은 내부 개발판 검증용이지 정식 서명의 대체가 아니다. 완료 기준은 숫자로 고정하지 않으며, 기존 테스트 전부, 새 포트 계약 테스트, 세 모드 골든 플로우, 삭제·skip·완화한 assertion 0건을 요구한다.

## 완료 기준

- Community Cloud의 정식 기준은 깨끗한 synthetic 기관 프로젝트에서 install, 관리자 MFA, 실무자 초대, 당사자 등록과 동의, 일정, 기록, Agent packet, AI 승인, 15초 페이지, backup/restore를 수행하는 것이다. 마스킹 전 OpenAI 전송 0건, 기관 간 접근 0건, Edge 로그에 PII와 원문 0건이어야 한다.
- Local Single의 정식 기준은 새 Windows PC에서 설치, 상담, AI 또는 AI Off, 백업, 삭제, 복원, export를 수행하는 것이다. 외부 NIC listen 0건이며 키가 DB와 로그와 화면에 0건이어야 한다.
- Local Office의 정식 기준은 서버 1대와 클라이언트 2대 동시 사용, 평문 HTTP 0건, 공개 포트 0건, 409 충돌 재현과 서버 교체 복원이다.
- 세 모드의 설치 직후 `sttMode`가 `off`이며, Q가 STT 게이트 결과를 승인하기 전에는 `sttEngine`이 `null`이다.
- Community Cloud 원음은 기관 소유 Supabase private Storage에서만 임시 보관되고, 다음 영업일 첫 Agent 처리 기회, 처리 직후 삭제, 첫 처리 가능 시점부터 24시간 상한과 관리자 장애 상태가 구현 계약에 반영된다.
- SG6 일곱 fail-closed code가 계약과 화면 문구에 그대로 존재하고, 각 상태에서 외부 AI 호출이 0건이다.
- 기존 테스트, 포트 계약 테스트, 세 모드 골든 플로우를 모두 유지하고 삭제·skip·완화한 assertion은 0건이다.

게이트를 통과하지 못한 항목도 릴리스에서 조용히 빼지 않고 화면과 릴리스 노트에 `미통과`로 명시한다. 실데이터는 법무 게이트와 기능 게이트를 모두 통과하고 Q가 승인한 모드에만 넣는다.

## 실데이터 게이트

개인정보 처리방침, 동의 여섯 영역 문안, Supabase 위탁 문서, OpenAI 국외 이전 고지, OpenAI DPA 민감정보 확인 또는 비식별 수준 법률 검토, 기관별 보존 근거표, 권리요청 10일 절차, 침해사고 72시간 절차, 2026-09-11 시행 법 개정 대조를 모두 닫는다. 항목마다 담당자와 마감을 정한다. 실데이터 파일럿은 해당 게이트가 닫힌 모드에서만 시작하며 9월 18일 뒤에도 계속한다.

## 결과와 위험

- PostgreSQL 트랙은 별도로 진행하고 9월 4일, 7일, 10일에 증거를 점검한다. 점검은 범위를 자르는 자리가 아니라 사람과 순서를 다시 배치하는 자리다.
- 코드서명, Azure 자격, pyannote 승인, OpenAI DPA와 법무의 외부 회신 지연은 해당 artifact와 기능을 `미통과`로 표시하는 사유다.
- 기존 계획이 예약한 D76~D79와 충돌하는 결정 번호는 이 문서의 D76~D83으로 대체한다.
- 목표 모델 검수는 E2-8이 소유한다. E2-8의 검수와 Q 확인이 끝나기 전에는 목표 모델을 승인된 구현 전제로 취급하지 않는다.

## 열린 항목

1. STT-G1~STT-G3에서 Local 후보와 Azure 선택 조건을 같은 대화체 실오디오로 비교하고 Q 승인을 받는다. 그 전까지 설치 기본값은 `off`다.
2. E2-8에서 목표 모델 검수 4건을 수행하고 Q 확인을 기록한다.
3. 실데이터 게이트의 담당자, 마감, 증빙 위치와 각 모드의 실제 기능·법무 증거를 닫는다. Supabase 설치 전 상태 확인은 ADR-0042의 D84 read-only `plan`이 담당한다.

## 참고

- `CCC_OPEN_PILOT_PLAN.md`의 E0-1, SG6, SG8 및 E2-8 계약
- `docs/specs/S1-database-sql-subset.md`부터 `S15-long-ai-packet.md`까지의 계약 스펙
- `docs/adr/0042-supabase-read-only-preflight.md`의 D84 사전 점검
