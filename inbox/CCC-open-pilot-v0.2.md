# PRD: CCC Open Pilot v0.2 (capability matrix)

- 작성: 2026-09-02
- 정본: ADR-0041. 이 PRD는 ADR-0041을 제품 언어로 옮긴 것이다. 충돌하면 ADR-0041이 이긴다.
- 대체: 2026-09-01 PRD v0.1(Community Cloud 단일 제품 전제)

## 1. 제품 한 문단

CCC는 사회복지 실무자의 상담 기록을 돕는 오픈소스 프로그램이다. 상담을 녹음하거나 메모하면 AI가 요약 초안을 만들고, 지난 회차와 대조해 빠뜨린 약속과 앞뒤가 안 맞는 내용을 찾아 준다. 다음 상담 전에는 15초 페이지 한 장으로 상황을 떠올린다. AI는 초안만 만들고 실무자가 승인한 것만 공식 기록이 된다. 기관은 설치할 때 데이터를 어디에 둘지(세 모드)와 AI를 어떻게 쓸지(STT 축, LLM 축)를 고른다.

## 2. 사용자

| 사용자 | 하는 일 | 꼭 되어야 하는 것 |
|---|---|---|
| 실무자 | 상담, 기록, 승인, 15초 페이지 열람 | AI가 꺼져도 기록과 승인이 된다. 초안에 근거가 붙어 있다 |
| 기관 관리자 | 설치, 동의 문안 관리, 계정, 백업, 키 관리 | 개발자 없이 설치와 복구가 된다(INSTALL_AGENT.md) |
| 슈퍼비전/감사 | 기록 열람, 감사 로그 확인 | 역할 4종(ADR-0038)과 감사 기록 |
| 다른 기관(확산) | 자기 기관 이름으로 설치 | 사회연대은행 계정에 종속되지 않는다 |

## 3. 모드 × 기능 표

○ = 있어야 함, △ = 모드 특성상 다름, × = 없음

| 기능 | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 당사자 등록, 케이스, 일정, 워크인 | ○ | ○ | ○ |
| 동의 6영역 기록과 철회 | ○ | ○ | ○ |
| 녹음(브라우저) | ○ HTTPS | ○ Electron | ○ 내부망 HTTPS 필수 |
| STT Local / Azure / Off | ○ Agent PC 필요 | ○ 같은 PC | ○ 서버 PC 또는 별도 PC |
| 마스킹 + 준식별자 일반화 | ○ Agent | ○ | ○ |
| AI 초안(OpenAI BYOK) / Off | ○ Edge가 호출 | ○ local-service가 호출 | ○ local-service가 호출 |
| 서버 재검증, fail-closed | ○ | ○ | ○ |
| 장문 AI Packet(S15) | ○ | ○ | ○ |
| 15초 페이지, 누락/불일치 감지 | ○ | ○ | ○ |
| 승인, 검토, 감사 로그 | ○ | ○ | ○ |
| 다중 사용자, 409 충돌 처리 | ○ | × 단일 사용자 | ○ |
| 로그인 | Supabase Auth + MFA | OS 사용자 + 앱 잠금 | 로컬 계정 + 관리자 MFA |
| 데이터 암호화 | PostgreSQL 저장 시 + PII 칼럼 암호화 | 암호화 SQLite + 파일 AES-GCM + DPAPI | 암호화 SQLite + 서비스 전용 파일 |
| 원음 24시간 삭제와 삭제 증거 | ○ private Storage | ○ 로컬 파일 | ○ 서버 파일 |
| 백업/복원, Recovery Kit | ○ | ○ | ○ 중앙 백업 |
| `.cccx` 내보내기/가져오기 | ○ | ○ | ○ |
| 자동 업데이트(서명 검증, 롤백) | ○ update/rollback 명령 | ○ | ○ |
| 설치 산출물 | install, doctor, report 명령 + 템플릿 | NSIS 설치기 | 서버 설치기 + 클라이언트 설치기 |
| 오프라인 동작 | × | ○ AI만 쉼 | ○ 내부망만 있으면 됨 |
| 공개 사이트, 데모 | Cloudflare 정적, 공통 | | |

## 4. AI 축 표

| 축 | 선택지 | 키 위치 | 실행 위치 |
|---|---|---|---|
| STT | Local(faster-whisper int8) | 없음 | Agent PC |
| STT | Azure Speech 서울 | Agent SecretStore(Local 모드는 DPAPI) | Agent PC |
| STT | Off | 없음 | 수기 기록만 |
| LLM | OpenAI BYOK, store:false | Cloud: Edge 시크릿, Local: DPAPI | Cloud: Edge, Local: local-service |
| LLM | Off | 없음 | 수기 기록과 승인만 |

## 5. 비기능 요구

- 프라이버시: 원문(녹음, 메모, 전사문)은 기관 밖으로 나가지 않는다. 밖으로 나가는 것은 AI Packet뿐이며 코어가 재검증한다. 마스킹 부품이 없으면 AI는 꺼진다.
- 보안: 키는 호출하는 곳에만. 시크릿은 코드, 문서, 로그, 테스트 fixture에 없다. 릴리스마다 시크릿 스캔 0건.
- 복구: 새 PC 복원 성공이 모드별 완료 조건이다. 설치 시 복구 연습 1회.
- 투명성: AI 초안의 모든 문장에 원문 구간 근거. 감사 로그에 누가 언제 무엇을 승인했는지.
- 설치성: 비개발자가 INSTALL_AGENT.md만 보고 설치와 복구를 끝낸다.
- 측정: 누락 액션과 불일치 감지의 정밀도와 재현율, 기록 작성 시간, 상담 준비 시간, AI 초안 수정량 전후.

## 6. 산출물 13종 (계획 13장 그대로)

1. `apps/client` 정적 클라이언트 2. `packages/core`, `http-api`, `ai-runtime`, `contracts` 3. Community Cloud 템플릿과 Edge Function 4. `apps/local-service` 5. Local Single 설치기 6. Processing Agent 설치기 7. Local Office 서버 설치기 8. Local Office 클라이언트 설치기 9. 백업/복원과 Recovery Kit 10. `.cccx` 이전 도구 11. INSTALL_AGENT.md와 매뉴얼 5종, Policy Kit 12. 시험 보고서(마스킹, STT, 백업, 보안)와 임팩트 보고서 13. 서명된 릴리스와 SBOM

## 7. 범위 밖

Managed AI, CLOVA, RTZR, 로컬 LLM, Tauri, 기관 자체 클라우드 모드, 감정 분석(D64 보류).

## 8. 완료 기준

ADR-0041 "완료 기준" 절 그대로. 9/18은 제출일이며 못 끝낸 항목은 E12로 이어간다. 실데이터는 법무 게이트를 넘은 곳에만.
