# 실사용 테스트 프로토타입 설계 (2026-09-14)

목표: 최종 완성본의 핵심 흐름(기록 → 처리 → 브리핑)을 실제로 돌려보는 내부 테스트용 프로토타입. 실DB 없이 Google Sheets에 저장하고, 외부 연결은 전부 테스트 계정만 쓴다.

## 범위

### 하는 것

- 로그인 2역할: 관리자(전체+기술 관리자 합침) 1개, 실무자 1개. env에 하드코드한 계정 + 서명 쿠키 세션.
- 당사자 목록·등록(이름·연락처·이메일·생년월일만).
- 상담 기록: 녹음 파일 업로드 또는 수기 메모 입력.
- 처리 파이프라인: Azure STT → 2단 마스킹 → OpenAI 요약 초안.
- 검토·승인 화면: 초안을 보고 승인하면 Sheets에 저장.
- 15초 페이지 축소판: 당사자별 회차 목록 + 승인된 핵심 한 줄 + 미해결 안내.

### 안 하는 것

- 일정, 액션 아이템 관리, 플래그 확정 워크플로, 동의 관리, 사업 전환, 실제 SQLite/Supabase, 배포.
- 화면은 기능 검증용 최소 구성. 디자인 규칙은 wire 컴포넌트를 재사용해 자연스럽게 따른다.

## 아키텍처

```
prototype/
  server/          FastAPI (Python 3)
    main.py        라우트: /api/login /api/participants /api/sessions /api/process /api/approve
    sheets.py      Google Sheets 읽기·쓰기 (탭 3개)
    pipeline.py    STT → 마스킹 → AI 호출 조립
  web/             Vite + React
    src/           화면 5개: 로그인, 당사자 목록, 당사자 허브(15초), 기록 작성, 검토 승인
```

- 백엔드는 `apps/pipeline/ccc_pipeline`을 `sys.path`로 직접 import해 `azure_stt.transcribe_azure`와 `masking` 모듈을 재사용한다. 복사하지 않는다.
- 프런트는 `apps/web/app/components/wire/*`와 `globals.css`를 Vite alias로 import해 디자인 토큰·컴포넌트를 그대로 쓴다.
- 원음과 원문 메모는 디스크·Sheets 어디에도 남기지 않는다. 업로드 즉시 임시 파일로만 쓰고 처리 뒤 삭제한다. Sheets에는 마스킹된 텍스트와 AI 결과만 간다.

## 저장: Google Sheets

시트 1개, 탭 3개.

| 탭 | 열 |
|---|---|
| participants | participant_id, name, phone, email, birth_date, created_at |
| sessions | session_id, participant_id, occurred_at, kind(intake/basic), masked_text, approved_at, author |
| drafts | session_id, one_liner, claims_json, questions_json, flag_suggestions_json, created_at |

- 서비스 계정: `~/developer/projects/bss/bss-google-console/secrets/oauth2service.json` (기존 DWD SA, 파일 경로로만 주입). `with_subject`로 ggbss.or.kr mailbox 대리.
- Sheets API 사용 실적 있음(2026-09-03 서식 배치 작업). `spreadsheets` 스코프 등록 여부는 첫 호출로 확인하고, 막히면 `drive` 스코프로 시트 생성 후 SA에 편집 권한을 주는 경로로 우회한다.
- 대량 쓰기 없음. 행 append 위주라 broken-pipe 함정과 무관하다.

## 처리 파이프라인

1. 업로드된 오디오를 임시 파일로 저장 → `transcribe_azure(audio_path, api_key, before_send)` 호출. ffmpeg는 설치돼 있다.
2. 전사문(또는 수기 메모) 마스킹:
   - 1차: participants 탭의 등록값(이름·연락처·이메일)을 가명 토큰으로 결정론 치환.
   - 2차: `masking.mask_patterns` 정규식(전화·주민번호·이메일·계좌) + `mask_conditions` 질병명 사전.
   - 3차(선택): `build_person_and_address_ner` NER. HF 캐시에 `FrameByFrame/korean-pii-e5-base`가 이미 있으나 `transformers`+`torch` 설치가 필요하다(약 2GB). 1차 구현은 끄고 켤 수 있는 플래그로 둔다.
3. 마스킹된 텍스트만 OpenAI로 전송(`store:false`). 프롬프트는 `packages/ai-runtime/src/ai-provider.ts`의 v4 계약을 참조해 축소판으로 재작성: 핵심 한 줄 + claims + 다음 회차 확인 질문 + 플래그 제안(인용 필수).
4. 결과를 drafts 탭에 쓰고 검토 화면에 표시. 실무자가 승인하면 sessions 탭에 `approved_at`과 함께 저장.

## 자격증명 (전부 테스트용)

| 용도 | 출처 | 상태 |
|---|---|---|
| `AZURE_SPEECH_KEY` | Infisical ggbss `prod` `/CCC` | 존재 확인됨(2026-09-06 저장 증거). `infisical run` 주입 |
| `OPENAI_API_KEY` | 1Password | `op run --env-file` 주입. 항목명 확인 필요 |
| Google SA JSON | 로컬 파일 경로 | 존재. 값 출력 금지 |
| `PROTOTYPE_SHEET_ID` | 시트 생성 후 env | 신규 |
| `PROTOTYPE_ADMIN_PW` / `PROTOTYPE_STAFF_PW` | env 직접 설정 | 신규 |

시크릿 값은 stdout·로그·커밋에 남기지 않는다(AGENTS.md §10).

## 실행

- 이 Mac에서 `127.0.0.1` 바인드로만 띄운다. 외부 노출 없음.
- `prototype/server/.venv`에 fastapi·uvicorn·google-api-python-client·google-auth·openai 설치. NER을 켤 때만 transformers·torch 추가.

## 리스크와 미결

- Sheets `spreadsheets` 스코프가 DWD에 등록돼 있는지 첫 호출로 확인 필요. 미등록이면 Admin 승인(사람 작업) 또는 drive 스코프 우회.
- OpenAI 키의 1Password 항목명·금고 위치 확인 필요.
- NER 모델 로딩은 메모리 확인 후 진행(기존 규칙). 설치가 무거우면 regex+등록값 마스킹만으로 1차 테스트를 연다.
- Azure STT는 원음이 외부로 나간다. 실제 당사자 녹음이 아니라 테스트 녹음만 쓴다는 전제가 필요하다.

## 예상 공수

1~1.5일. 자격증명이 준비돼 있으면 당일 시연 가능.
