# ccc-pipeline — 처리 장비(회사 노트북) 파이프라인 클라이언트

상담 녹음을 Workers API에서 받아 전사·화자 분리·감정 분석·2차 PII 마스킹을 수행하고
결과를 다시 API로 보내는 폴링 클라이언트다. CLAUDE.md §5 파이프라인 스펙과
`docs/api-contract-pipeline.md` 계약을 그대로 따른다.

- 처리 장비는 R2·D1에 직접 접근하지 않는다 — Workers API만 호출한다 (D13)
- 전송 인증은 Cloudflare Access 서비스 토큰 헤더(`CF-Access-Client-Id/Secret`)다
- 전사·중간 파일은 작업 디렉터리에 만들고 **작업 종료 시 무조건 삭제**한다 (D13)
- 로그에는 세션 ID·건수·소요 시간만 남긴다. 전사 내용·PII는 로그 금지 (R3)
- 감정은 숫자 점수만 산출한다. 문장형 감정 서술은 만들지 않는다 (R4)
- Claude 대조·요약은 2단계-c 범위 — 지금은 `aiSummary`에 자리표시 문구를 보낸다

## 구조

```
ccc_pipeline/
  config.py          환경 변수 → 설정 (시크릿은 Infisical 주입, 코드에 없음)
  api_client.py      Workers API 클라이언트 (표준 라이브러리 urllib, UA 명시)
  transcribe.py      Whisper 전사 (지연 임포트 — ML 미설치 환경에서도 나머지 동작)
  diarize.py         pyannote 화자 분리 (지연 임포트)
  speaker_mapping.py 전사 구간↔화자 정렬 + 수혜자/상담사 자동 추정 (D11, 순수 로직)
  emotion.py         감정 점수 집계 (음성 0.3 + 텍스트 0.7 가중, R4, 순수 로직)
  masking.py         2차 PII 마스킹 — 정규식(전화·주민번호·이메일·계좌) + 선택적 NER (D2)
  artifacts.py       POST /pipeline/jobs/:id/artifacts 본문 조립
  worker.py          폴링 루프 (작업 디렉터리 생성→처리→무조건 삭제)
tests/               표준 라이브러리 unittest — ML 설치 없이 실행 가능
systemd/             WSL2 자동 시작 유닛
```

## 노트북 세팅 (Part B — docs/handoffs/2026-07-11-stage-2b-*.md 참조)

1. WSL2 Ubuntu + CUDA 확인: `nvidia-smi`, PyTorch CUDA 빌드 설치 후
   `python3 -c "import torch; print(torch.cuda.is_available())"` → `True`
2. ML 의존성: `pip install -r requirements-ml.txt`
   (torch는 CUDA 빌드를 먼저 설치할 것 — requirements에는 고정하지 않는다)
3. pyannote 게이트 모델은 Hugging Face 승인 + `HF_TOKEN` 필요
4. 환경 변수(아래) 하이드레이션: Infisical에서 주입하거나 `/etc/ccc-pipeline.env`(600 권한)로.
   값을 레포·로그에 쓰지 않는다 (CLAUDE.md §10)
5. 스모크: `python3 -m ccc_pipeline --once` (대기 작업이 없으면 "no jobs"로 끝난다)
6. 자동 시작: `systemd/ccc-pipeline.service` 설치 (파일 안 주석 참조)

## 환경 변수

| 이름 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `CCC_PIPELINE_CLIENT_ID` | 필수 | — | Access 서비스 토큰 Client ID (Infisical `ggbss-agent/prod`) |
| `CCC_PIPELINE_CLIENT_SECRET` | 필수 | — | Access 서비스 토큰 Client Secret (〃) |
| `CCC_API_BASE_URL` | | `https://ccc-api.account-855.workers.dev` | Workers API 주소 |
| `CCC_POLL_INTERVAL_SECONDS` | | `600` | 폴링 주기(초). D8 SLA(다음 영업일) 안이면 조정 자유 |
| `CCC_WORK_DIR` | | `~/.cache/ccc-pipeline` | 임시 작업 디렉터리(작업마다 하위 생성 후 삭제) |
| `CCC_WHISPER_MODEL` | | `medium` | Whisper 모델 크기. VRAM 12GB에서 large-v3는 여유 확인 후 |
| `CCC_NER_MODEL_ID` | | (없음) | 2차 마스킹용 한국어 NER 모델. 미설정 시 정규식만 + 경고 로그. **라이선스 표기 확인 후 지정** (§5 규칙) |
| `HF_TOKEN` | pyannote 사용 시 | — | Hugging Face 토큰(게이트 모델) |

주의: 운영 API 앞의 Cloudflare가 기본 python-urllib User-Agent를 차단(1010)하므로
클라이언트는 `ccc-pipeline/<버전>` UA를 명시한다 — 새 HTTP 코드를 추가할 때도 유지할 것.

## 테스트 (이 레포 어디서든, ML 설치 불필요)

```bash
python3 -m unittest discover -s apps/pipeline/tests -v
```
