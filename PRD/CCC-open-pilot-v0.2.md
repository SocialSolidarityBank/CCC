# PRD: CCC Open Pilot v0.2

- 작성: 2026-09-03
- 정본: `docs/adr/0041-one-core-three-deployment-modes.md` (D76~D83)
- 보조 근거: `docs/adr/0042-supabase-read-only-preflight.md` (D84 사전 점검)
- 대체: 2026-09-01 PRD v0.1의 Community Cloud 단일 제품 전제
- 문서 역할: ADR-0041의 결정을 제품 언어로 설명하는 제품 요구사항 문서다. 구현 세부가 이 문서와 충돌하면 ADR-0041이 우선한다.

## 1. 제품 한 문단

CCC는 사회복지 실무자가 상담을 기록하고 다음 상담을 준비하도록 돕는 오픈소스 사례관리 프로그램이다. 실무자는 녹음 또는 수기 메모로 상담을 남기고, 선택한 처리 경로가 있으면 AI가 요약 초안과 확인이 필요한 대조 항목을 제안한다. 실무자는 15초 페이지에서 당사자의 누적 맥락을 빠르게 훑고, AI 초안은 검토와 승인 뒤에만 공식 기록으로 사용한다. 수기 기록은 작성 즉시 공식 기록이다. 기관은 같은 코어와 같은 규칙을 쓰면서 데이터를 둘 장소와 AI 사용 방식을 세 가지 정식 배포 모드와 독립적인 STT·LLM 선택지로 결정한다.

## 2. 사용자와 제품 결과

| 사용자 | 주요 일 | 제품이 보장할 결과 |
|---|---|---|
| 실무자 | 당사자 등록, 상담, 기록, 검토, 승인, 15초 페이지 열람 | AI가 꺼져도 상담 기록과 공식화가 이어진다. AI 제안에는 검토 가능한 근거가 붙는다. |
| 기관 관리자 | 모드 설치, 계정·권한, 동의 문안, 키, 백업·복원, 장애 확인 | 개발자에게 데이터를 보내지 않고 설치·복구·삭제 상태를 확인한다. |
| 실무 책임자·감사 담당자 | 감독 범위 기록 열람과 감사 로그 확인 | 역할과 담당 관계에 맞는 읽기 권한, 승인·열람·변경 이력이 남는다. |
| 다른 기관 | 자기 기관에 CCC를 설치하고 운영 | 사회연대은행의 계정이나 저장소에 종속되지 않고 자기 배포 경계를 선택한다. |

AI는 결론, 심리 진단, 지원 지속·중단 판단, GAS 점수 또는 리스크 플래그를 확정하지 않는다. 이러한 판단과 공식 승인 권한은 실무자에게 있다.

## 3. 세 가지 정식 배포 모드

세 모드는 모두 정식 구현 대상이다. 화면, API, 권한, 감사 규칙, 개인정보 게이트, AI 재료 계약은 공통이며 저장소와 접속·인증 경계만 다르다. 일정 때문에 모드를 제외하거나 기능 수준을 낮추지 않는다.

| 항목 | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 대상 | 여러 장소에서 사용하는 기관 | 실무자 PC 한 대 | 사무실 서버와 여러 클라이언트 |
| 데이터 위치 | 기관 소유 Supabase 서울 프로젝트의 PostgreSQL, Auth, 기관 소유 private Storage | 해당 PC의 암호화 SQLite와 암호화 파일 | 서버 PC의 암호화 SQLite와 서비스 전용 파일 |
| 접속 | 인터넷 HTTPS | `127.0.0.1` 전용 | 내부망 HTTPS. 브라우저 녹음 때문에 TLS 필수 |
| 인증 | Supabase Auth와 MFA | OS 사용자와 앱 잠금 | Argon2id 로컬 계정과 관리자 MFA |
| 다중 사용자 | 지원. 기관 경계와 충돌 처리를 적용한다 | 단일 사용자 | 지원. 동시 쓰기 충돌을 처리한다 |
| 처리 Agent | 기관 PC 한 대가 필요하다 | 같은 PC 또는 기관이 지정한 PC | 서버 PC 또는 기관이 지정한 처리 PC |
| 오프라인 | 지원하지 않는다 | 지원한다. AI는 연결이 없으면 쉬고 수기 기록은 계속한다 | 내부망만으로 업무를 계속한다 |

Community Cloud의 첫 설치 동작은 `plan`을 통한 read-only 사전 점검이다. 리전, 권한, 기존 데이터, 설치 버전, RLS, Auth, Storage를 확인하기 전에는 자원을 바꾸지 않는다. 이 사전 점검의 상세 규칙은 ADR-0042와 D84를 따른다.

## 4. 공통 제품 경험

### 4.1 기록에서 15초 페이지까지

1. 관리자가 기관과 모드를 준비하고 역할·동의 영역을 설정한다.
2. 실무자가 당사자와 케이스를 등록하고 상담 일정을 만든다.
3. 실무자는 상담을 녹음하거나 수기 메모를 작성한다. 녹음하지 않아도 전체 기록 흐름을 사용할 수 있다.
4. 녹음이 있고 STT가 선택·허용된 경우 Agent가 전사와 화자 분리를 수행한다. 감정 분석은 녹음 여부와 관계없이 보류한다. 수기 메모만 있는 회차는 전사 없이 텍스트 처리 경로로 간다.
5. Agent와 코어가 개인정보 마스킹, 준식별자 일반화, 근거 hash와 동의를 검증한다.
6. 검증을 통과한 AI Packet만 OpenAI로 보내고, 생성된 초안은 이용 가능한 수기 메모와 전사를 실무자가 대조한다.
7. 실무자가 AI 초안을 승인하면 그 초안이 공식 기록과 15초 페이지의 재료가 된다. 승인 전 초안은 브리핑·통계·보고서에 쓰지 않는다.
8. 수기 메모는 저장하는 즉시 공식 기록이며 별도의 승인 대기 상태가 없다.

15초 페이지는 당사자의 현재 상태와 전체·세부 목표, 확인할 내용, 회차별 정리, 불일치, 미해결 액션을 한 화면에서 보여준다. AI가 제안하는 문장에는 근거 회차와 원문 구간이 있어야 하며, AI가 판단을 확정하는 표현은 사용하지 않는다.

### 4.2 저장 모드와 AI 모드는 독립이다

기관은 저장 위치와 AI 사용을 별도로 선택한다.

- LLM 선택지는 `off` 또는 `openai`다.
- STT 선택지는 `off`, `local`, `azure`다.
- 설치 직후 세 모드의 STT 기본값은 모두 `off`다.
- `local`과 `azure`는 모두 기관 관리자가 provider를 명시적으로 선택하고 health check를 통과해야 한다. `local` STT는 STT-G1~STT-G3 실측과 Q 승인이 끝나기 전까지 운영 선택지로 열지 않는다. `faster-whisper`는 측정 후보일 뿐 자동 선택하지 않으며, 승인 전 `sttEngine`은 `null`이다.
- 실패한 사업자에서 다른 사업자로 자동 전환하지 않는다. 실패하면 수기 기록 경로를 제공한다.
- LLM 또는 STT를 포함해 AI 처리를 켜면 모드와 관계없이 기관 PC에서 동작하는 처리 Agent 한 대가 필수다. Agent는 2차 마스킹과 필요한 STT 처리를 담당한다.

### 4.3 AI와 외부 서비스의 데이터 경계

OpenAI에는 처리 Agent와 코어가 만든 **AI Packet만** 보낸다. AI Packet은 2단 마스킹을 거친 `MaskedSourceSnapshot`, 준식별자 일반화 결과, 근거 hash와 필요한 버전 정보로 구성한다. 실명, 연락처, 계좌, 등록되지 않은 식별 정보가 남아 있거나 마스킹·근거·동의 검증이 실패하면 OpenAI 호출은 0건이어야 한다. OpenAI 호출은 `store:false`를 사용한다.

Azure Speech는 OpenAI와 다른 경로다. 기관 관리자가 Azure STT를 **명시적으로 선택하고 provider health check를 통과시킨 뒤, 해당 외부 음성 처리에 대한 유효한 동의가 있을 때만** 처리 Agent가 원음 오디오를 Azure Speech의 서울 endpoint로 보낸다. 이 선택이 없거나 동의가 유효하지 않으면 원음은 Azure로 이전하지 않는다. Azure가 선택된 경우에는 원음이 Azure endpoint로 이전될 수 있으므로, “원문은 어떤 경우에도 기관 밖으로 나가지 않는다”라고 표현하지 않는다. OpenAI에는 Azure로 보낸 원음이나 마스킹 전 원문을 보내지 않고 AI Packet만 보낸다.

Azure 키는 Agent의 `SecretStore`에만 둔다. Community Cloud의 OpenAI 키는 Edge Function secret에 두고, Local의 호출 자격증명은 해당 Local `SecretStore` 경계에 둔다. 키를 브라우저, 데이터베이스, 로그, 화면 또는 다른 서비스에 복제하지 않는다.

### 4.4 원음 오디오 생명주기

- Community Cloud 원음은 기관 소유 Supabase **private Storage**에만 임시 보관한다.
- 원음은 업로드 후 기계적으로 24시간 뒤 삭제하지 않는다. 다음 영업일의 첫 Agent 처리 기회까지 보관하여 처리 기회를 보장한다.
- 첫 Agent 처리 기회에 Agent가 claim하고 처리를 마치면 원음을 즉시 삭제한다.
- 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 원음을 삭제하고 관리자에게 장애 상태를 남긴다. 수기 기록 경로는 계속 제공하며 상담을 다시 녹음하라고 안내하지 않는다.
- Local 모드도 같은 처리 시계와 즉시 삭제 의미론을 따르며 원음은 각 모드의 암호화 파일 경계에 둔다.
- 삭제 후에는 삭제 성공, 목록·메타데이터 부재, 전파 대기 뒤 인증 GET 404, 삭제 시각과 객체 hash를 확인할 수 있는 증거를 남긴다. 장기 signed URL은 발급하지 않는다.
- 이번 기본형에는 7일 또는 30일 원음 보관이 없다.

### 4.5 동의·개인정보·공식 기록

동의는 ADR-0040 9장의 여섯 영역을 사용하고, 기존 동의를 새 영역으로 자동 승격하지 않는다. 외부 STT와 외부 LLM 처리는 각각 해당 동의와 현재 시점의 유효성을 확인한다. 동의가 유효하지 않으면 `consent_not_effective`로 멈추고 외부 AI 호출을 하지 않는다.

Agent와 코어는 AI Packet을 이중 검증한다. 다음 일곱 상태에서는 외부 AI 호출을 하지 않는다.

- `masking_snapshot_missing`
- `local_ner_unavailable`
- `registered_pii_detected`
- `unmasked_identifier_detected`
- `evidence_hash_mismatch`
- `masking_pipeline_version_mismatch`
- `consent_not_effective`

실패 로그에는 code, session ID hash, timestamp만 남기고 감지된 원문이나 개인정보를 남기지 않는다. AI 초안은 `approved_at`이 채워지기 전까지 공식 기록이 아니며, 수기 메모는 작성 즉시 공식 기록이다.

## 5. 기능 능력표

표의 `○`는 공통 기능을 같은 규칙으로 제공한다. 모드별 저장·접속 경계는 각 행의 설명으로 표시한다.

| 기능 | Community Cloud | Local Single | Local Office |
|---|---:|---:|---:|
| 당사자·케이스·일정·워크인 등록 | ○ | ○ | ○ |
| 동의 여섯 영역 기록과 철회 | ○ | ○ | ○ |
| 브라우저 녹음 | HTTPS | Electron | 내부망 HTTPS 필수 |
| STT `off`·`local`·`azure` | Agent PC 필요 | 같은 PC 또는 지정 PC | 서버 PC 또는 지정 PC |
| STT 설치 기본값 | `off` | `off` | `off` |
| Azure 원음 전송 | 명시적 선택·유효 동의 때만 서울 endpoint | 명시적 선택·유효 동의 때만 서울 endpoint | 명시적 선택·유효 동의 때만 서울 endpoint |
| 2단 마스킹·준식별자 일반화 | Agent | Agent | Agent |
| AI 초안 OpenAI BYOK / AI `off` | Edge Function이 호출 | Local 서비스 경계가 호출 | Local 서비스 경계가 호출 |
| AI 사용 시 처리 Agent PC | 필수 | 필수 | 필수 |
| AI Packet 재검증과 fail-closed | ○ | ○ | ○ |
| 장문 AI Packet 분할 규칙 | ○ | ○ | ○ |
| 15초 페이지와 누락·불일치 감지 | ○ | ○ | ○ |
| 승인·검토·감사 로그 | ○ | ○ | ○ |
| 다중 사용자·409 충돌 | ○ | × | ○ |
| 인증 | Supabase Auth + MFA | OS 사용자 + 앱 잠금 | Argon2id 로컬 계정 + 관리자 MFA |
| 저장 데이터 암호화 | PostgreSQL 저장 암호화 + PII 칼럼 암호화 | 암호화 SQLite + AES-GCM 파일 + DPAPI | 암호화 SQLite + 서비스 전용 파일 |
| 원음 임시 보관·삭제 증거 | 기관 소유 private Storage | 암호화 파일 | 서버 암호화 파일 |
| 백업·복원·Recovery Kit | ○ | ○ | 중앙 백업 |
| `.cccx` 내보내기·가져오기 | ○ | ○ | ○ |
| 서명 검증·업데이트·rollback | `install`·`doctor`·`update`·`rollback`·`report` | 설치기와 서명 업데이트 | 서버·클라이언트 설치기와 서명 업데이트 |
| 오프라인 업무 | × | ○, AI는 연결 시 처리 | ○, 내부망만으로 업무 |
| 공개 사이트·가상데이터 데모 | Cloudflare 정적 파일 | 공통 공개 영역 | 공통 공개 영역 |

## 6. AI 선택표

| 축 | 선택지 | 설치 직후 | 실행·데이터 경계 | 선택 조건 |
|---|---|---|---|---|
| STT | `off` | 기본값 | STT와 원음 외부 전송 없음. 수기 기록 경로 제공 | 항상 선택 가능 |
| STT | `local` | 비활성 | 기관 관리자가 선택하고 health check를 통과한 뒤 Agent가 처리 | STT-G1~G3과 Q 승인, 기관 관리자 선택, provider health check |
| STT | `azure` | 비활성 | Agent가 기관 관리자의 명시적 선택과 provider health check, 유효 동의 뒤 원음을 Azure Speech 서울 endpoint로 전송 | 기관 키, 외부 음성 처리 동의 |
| LLM | `off` | 기관이 선택 | 수기 기록과 승인만 사용 | 항상 선택 가능 |
| LLM | `openai` | 기관이 선택 | 검증된 AI Packet만 전송, `store:false` | 기관 키, 마스킹·hash·버전·동의 검증, 처리 Agent PC |

Managed AI, CLOVA, RTZR, 로컬 LLM, Tauri, 기관 자체 클라우드는 이번 제품 범위의 선택지가 아니다. 해당 포트나 경계가 남아 있어도 운영 선택지로 열지 않는다.

## 7. 13종 제품 산출물

아래 산출물은 특정 모드 하나만의 부속물이 아니라 세 모드 정식 구현을 구성하는 제품 묶음이다. 각 산출물은 가상 데이터로 먼저 기능 게이트를 통과하고, 해당 모드의 법무 게이트와 명시적인 Q 승인을 모두 받은 뒤에만 실데이터를 사용한다.

1. `apps/client` 정적 클라이언트
2. `packages/core`, `packages/http-api`, `packages/ai-runtime`, `packages/contracts` 공통 코어
3. Community Cloud 템플릿과 Edge Function
4. `apps/local-service`
5. Local Single 설치기
6. Processing Agent 설치기
7. Local Office 서버 설치기
8. Local Office 클라이언트 설치기
9. 백업·복원과 Recovery Kit
10. `.cccx` 모드 이전 도구
11. `INSTALL_AGENT.md`, 사용자 매뉴얼 5종, Policy Kit
12. 마스킹·STT·백업·보안 시험 보고서와 임팩트 보고서
13. 서명된 릴리스와 SBOM

공통 코어에는 `Database`, `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `STTProvider`, `AIProvider` 일곱 포트를 둔다. 백업·복원·가져오기·내보내기·업데이트·진단은 공통 Application Service로 제공한다.

## 8. 모드별 완료 기준

### 8.1 Community Cloud

Community Cloud는 기관 소유 Supabase 서울 프로젝트에서 다음 전체 흐름을 수행할 수 있어야 한다.

- read-only `plan`으로 리전, 읽기 권한, 기존 데이터, 설치 버전, PostgreSQL, RLS, Auth, private Storage의 상태를 확인한다.
- 설치, 기관 관리자 MFA, 실무자 초대, 당사자 등록, 여섯 영역 동의와 철회, 일정, 상담 기록을 수행한다.
- STT 설치 기본값이 `off`이고, Azure를 고른 경우에만 유효한 동의 뒤 원음이 Azure Speech 서울 endpoint로 전송된다.
- AI를 켠 경우 기관 PC의 Agent가 동작하고, OpenAI에는 마스킹·근거 검증을 통과한 AI Packet만 `store:false`로 보낸다.
- 원음이 기관 소유 private Storage의 임시 객체로만 존재하고, 다음 영업일 첫 Agent 처리 기회 뒤 즉시 삭제되거나 첫 처리 가능 시점 24시간 뒤 장애 상태와 함께 삭제된다. 삭제 증거가 남는다.
- AI 승인 후 15초 페이지, 백업·복원, `.cccx` 내보내기·가져오기를 수행한다.
- 기관 간 접근, 마스킹 전 OpenAI 전송, Edge 로그의 PII·원문, Cloudflare를 통과하는 상담 payload가 0건이어야 한다.

### 8.2 Local Single

새 Windows PC 한 대에서 다음 전체 흐름을 수행할 수 있어야 한다.

- 서명된 Electron + NSIS 설치, `doctor`, OS 사용자·앱 잠금, 당사자·상담 기록을 수행한다.
- AI `off` 상태에서도 수기 메모가 즉시 공식 기록으로 남고, STT 기본값은 `off`다.
- Agent PC가 동작하는 AI 흐름, 기관 관리자의 명시적 provider 선택과 health check, Local STT 후보의 STT-G1~G3·Q 승인 경계, Azure 선택 시 동의·서울 endpoint 경계를 확인한다.
- 암호화 SQLite, 암호화 파일, DPAPI 경계에서 백업·삭제·복원을 수행하고 다른 SID의 새 PC에서 복원한다.
- `.cccx` 이전, 서명된 업데이트, 업데이트 전 백업과 rollback을 수행한다.
- 외부 NIC listen, 브라우저 저장소의 PII, DB·로그·화면에 노출되는 키가 0건이어야 하며, 마스킹 전 원문이 OpenAI AI Packet이나 외부 호출·로그·화면에 포함되지 않아야 한다. 암호화 구현이 준비되지 않으면 평문 SQLite로 폴백하지 않고 해당 릴리스를 `미통과`로 표시한다.

### 8.3 Local Office

새 서버 PC와 두 클라이언트에서 다음 전체 흐름을 수행할 수 있어야 한다.

- 서명된 서버·클라이언트 설치, 내부망 TLS, Argon2id 계정, 관리자 MFA와 역할별 접근을 수행한다.
- 두 클라이언트가 동시에 상담을 기록하고 409 충돌을 재현·처리한다.
- STT 기본값 `off`, 기관 관리자의 provider 명시적 선택과 health check, Agent PC 필수 AI 흐름, Azure 선택 시 유효 동의와 서울 endpoint 전송 경계를 확인한다.
- 서버의 암호화 SQLite·파일, 중앙 백업, `.cccx` 이전과 서버 교체 후 복원을 수행한다.
- 평문 HTTP와 공개 포트가 0건이어야 하며, 서버 교체 뒤 기존 클라이언트가 CA를 다시 설치하지 않고 로그인·금고 열람·기록 저장을 복구해야 한다.

### 8.4 세 모드 공통 완료

- 세 모드 모두 같은 화면·API·권한·감사·fail-closed·AI 재료 규칙을 사용한다.
- 설치 직후 `sttMode=off`이며, STT-G1~G3과 Q 승인 전 `sttEngine=null`이다.
- AI를 켜면 기관 PC의 Agent가 없을 때 진행하지 않고 수기 기록 경로를 제공한다.
- 일곱 fail-closed code 각각에서 외부 AI 호출이 0건이다.
- 승인 전 AI 초안은 공식 기록으로 노출되지 않고, 수기 메모는 즉시 공식 기록이다.
- 삭제·skip·완화한 assertion 없이 기존 테스트, 포트 계약, 세 모드 골든 플로우를 유지한다.
- 미통과 항목은 조용히 제외하지 않고 화면과 릴리스 노트에 `미통과`로 표시한다. 2026-09-18은 제출일이며, 미완 항목은 원래 티켓 ID와 완료 기준을 유지한 채 열린 상태로 계속한다. E12는 미완 항목을 이름만 바꾸어 넘기는 곳이 아니라 새로운 후속 범위가 생길 때만 사용한다.

## 9. 비기능 요구사항

- **프라이버시:** OpenAI에는 AI Packet만 보낸다. Azure는 명시적 선택과 유효한 외부 음성 처리 동의가 있을 때만 원음을 서울 endpoint로 받는다. 모든 외부 AI 전송은 호출 위치의 키·동의·마스킹 경계를 따른다.
- **보안:** 키는 호출하는 곳에만 두며 코드, 문서, 로그, 브라우저 저장소와 테스트 fixture에 두지 않는다. 릴리스마다 시크릿 스캔 결과를 남긴다.
- **복구:** 세 모드에서 새 장비 또는 서버 교체 복원을 완료하고 Recovery Kit와 `.cccx`를 확인한다.
- **투명성:** AI 제안의 근거 회차와 원문 구간을 제공하고 승인·열람·변경을 감사 로그에 기록한다.
- **설치성:** 비개발자가 `INSTALL_AGENT.md`를 따라 설치, health check, 복구, 삭제 상태 확인을 수행한다.
- **측정:** 누락 액션·불일치 감지의 정밀도와 재현율, 기록 작성 시간, 상담 준비 시간, AI 초안 수정량을 모드와 AI 설정별로 기록한다.

## 10. 범위 밖과 후속 게이트

이번 범위에는 Managed AI, CLOVA, RTZR, 로컬 LLM, Tauri, 기관 자체 클라우드, 감정 분석 계산이 없다. 감정 분석과 GAS 스키마·데이터는 계약상 보류 상태로 남기되 이번 제품에서 계산하거나 확정하지 않는다.

실데이터는 해당 모드의 기능 게이트와 법무 게이트를 모두 통과하고 Q가 명시적으로 승인한 뒤에만 사용한다. 게이트가 닫히지 않은 기능이나 모드는 `미통과`로 표시하며, 2026-09-18 이후에도 미완 항목의 원래 티켓과 완료 기준을 유지한다. E12는 새 후속 범위에만 발행한다.

STT 후보의 실제 품질과 운영 선택은 STT-G1~STT-G3 뒤 Q가 승인한다. 목표 모델 검수 4건은 E2-8이 소유한다. 코드서명, Azure 자격, pyannote와 모델 라이선스, OpenAI DPA, 개인정보·동의 법무 게이트가 닫히지 않은 기능이나 모드는 `미통과`로 표시하고 실데이터를 넣지 않는다.
