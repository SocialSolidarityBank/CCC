# ccc-pipeline — 처리 장비(회사 노트북) 파이프라인 클라이언트

상담 녹음을 Workers API에서 받아 전사·화자 분리·감정 분석·2차 PII 마스킹을 수행하고
결과를 다시 API로 보내는 폴링 클라이언트다. CLAUDE.md §5 파이프라인 스펙과
`docs/api-contract-pipeline.md` 계약을 그대로 따른다.

- 처리 장비는 R2·D1에 직접 접근하지 않는다 — Workers API만 호출한다 (D13)
- 전송 인증은 Cloudflare Access 서비스 토큰 헤더(`CF-Access-Client-Id/Secret`)다
- 전사·중간 파일은 작업 디렉터리에 만들고 **작업 종료 시 무조건 삭제**한다 (D13)
- 로그에는 세션 ID·건수·소요 시간만 남긴다. 전사 내용·PII는 로그 금지 (R3)
- 감정은 숫자 점수만 산출한다. 문장형 감정 서술은 만들지 않는다 (R4)
- AI 대조·요약은 사업자(OpenAI) 호출로 Workers 에서 한다(D55·ADR-0025) — 장비는 마스킹까지만 하고,
  지금은 `aiSummary`에 자리표시 문구를 보낸다
- **전사는 통짜로 넣지 않는다** — 무음 경계에서 조각으로 나누고 반복 붕괴를 검사한다 (D53·ADR-0024).
  실측에서 whisper large-v3가 34분 대화의 48%를 같은 문장 254번 반복으로 잃고 없던 문장을 지어냈다
- **반복 구간은 지우지 않고 접어서 경고를 남긴다** — 그 시간대에 엔진이 무너졌다는 사실 자체가
  실무자에게 필요한 정보다. 경고 줄은 `Segment.warning=True`라 감정 집계·역할 추정에서 빠진다 (R4·D11)
- **엔진은 아직 확정이 아니다** — 후보 1순위는 Qwen3-ASR-1.7B이고, 확정은 실측 게이트 G1~G3 통과 후다
- **ffmpeg 이 없으면 아예 뜨지 않는다**(2026-07-31) — 구 동작은 통짜 폴백이었으나, 그건 ADR-0024 가
  금지한 방식이라 매 회차 조용히 품질을 깎았다. 설치 오류는 기동 때 잡는다(아래 '기동 전 설치 점검')

## 구조

```
ccc_pipeline/
  config.py          환경 변수 → 설정 (시크릿은 Infisical 주입, 코드에 없음)
  api_client.py      Workers API 클라이언트 (표준 라이브러리 urllib, UA 명시)
  transcribe.py      전사 오케스트레이션 — 조각 순회·시각 되돌리기·반복 재시도 + 엔진 등록소 (D53)
  chunking.py        무음 경계 조각 분할 (ffmpeg silencedetect, 경계 계산은 순수 로직)
  repetition.py      반복 붕괴 검사 — 접어서 경고, 지우지 않는다 (순수 로직, R5)
  diarize.py         pyannote 화자 분리 (지연 임포트)
  speaker_mapping.py 전사 구간↔화자 정렬 + 수혜자/상담사 자동 추정 (D11, 순수 로직)
  emotion.py         감정 점수 집계 (음성 0.3 + 텍스트 0.7 가중, R4, 순수 로직)
  masking.py         2차 PII 마스킹 — 정규식(전화·주민번호·이메일·계좌) + 질병명 사전(G3) + 선택적 NER (D2)
  condition_terms.py 질병명·진단명 사전 — 무엇을 일부러 뺐는지도 여기 적혀 있다 (G3)
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
| `CCC_STT_ENGINE` | | `whisper` | STT 엔진(D53). 모르는 이름은 **폴백하지 않고 즉시 실패**한다 — 오타로 다른 엔진이 조용히 돌면 어떤 엔진으로 전사했는지 알 수 없다 |
| `CCC_STT_MAX_CHUNK_SECONDS` | | `180` | 조각 최대 길이. 실측에서 3분 조각이 반복 붕괴를 없앴다 |
| `CCC_STT_MIN_CHUNK_SECONDS` | | `30` | 조각 최소 길이. 너무 잘게 나누면 조각마다 문맥이 사라져 정확도가 떨어진다 |
| `CCC_STT_REPEAT_THRESHOLD` | | `4` | 같은 문장이 몇 번 연속되면 붕괴로 볼지. 상담에서 두세 번 반복은 흔하므로 그 위 |
| `CCC_NER_MODEL_ID` | **예** | (없음) | 2차 마스킹용 한국어 인명 NER 모델. `red` **미설정이면 회차를 처리하지 않는다**(2026-07-31 Q 결정) — 인명 계층이 빈 채로 돌면 금고에 없는 제3자가 그대로 사업자로 나간다(R3). **라이선스 표기 확인 후 지정**(§5 규칙) |
| `CCC_NER_LABELS` | | `PS,PER,NAME` | 위 모델이 **인명에 붙이는 라벨 접두**. 모델과 한 쌍이다 — KLUE 계열은 `PS`/`PER`, PII 전용 모델은 `NAME` 계열로 다르다. 모델을 불러올 때 그 모델이 선언한 라벨과 대조하고, **안 맞으면 뜨지 않는다**(조용한 0건 마스킹 방지) |
| `CCC_CONDITION_NER_MODEL_ID` | | (없음) | 질병명 NER(G3). 미설정이면 사전 계층만 동작하고 **진행한다** — 인명과 달리 사전이 주 계층이다 |
| `CCC_CONDITION_NER_LABELS` | | `DS,DISEASE,SYMPTOM,CV_DISEASE,TRM` | 위 모델의 질병 라벨 접두. 대조 규칙은 인명과 같다 |
| `HF_TOKEN` | pyannote 사용 시 | — | Hugging Face 토큰(게이트 모델) |

### 기동 전 설치 점검 (2026-07-31)

`python3 -m ccc_pipeline` 은 폴링을 시작하기 전에 두 가지를 확인하고, 안 맞으면 **뜨지 않는다**(종료 코드 2).

| 확인 | 왜 |
| --- | --- |
| `ffmpeg` 설치 | 없으면 무음 경계 분할이 통짜 전사로 폴백한다 — ADR-0024 가 금지한 방식이고, 실측에서 반복 붕괴(254회 반복·48% 손실)를 일으켰다 |
| `CCC_NER_MODEL_ID` 설정 | 없으면 2차 방어의 인명 계층이 빈 채로 돈다(R3) |

`yellow` 기동 후에 생긴 정체(모델 로드 실패·라벨 불일치 등)는 이 점검이 못 잡는다 — 감시 쪽 몫이고 별도 티켓이다.

주의: 운영 API 앞의 Cloudflare가 기본 python-urllib User-Agent를 차단(1010)하므로
클라이언트는 `ccc-pipeline/<버전>` UA를 명시한다 — 새 HTTP 코드를 추가할 때도 유지할 것.

## 테스트 (ML 설치 불필요)

```bash
cd apps/pipeline/tests && PYTHONPATH=.. python3 -m unittest discover -s . -p "test_*.py" -v
```

`tests/` 안에서 돌리는 이유: `unittest discover` 가 시작 디렉터리를 임포트 가능한 곳으로
요구하는데 `tests/` 에는 `__init__.py` 가 없다. 레포 루트에서 `-s apps/pipeline/tests` 로
부르면 `Start directory is not importable` 로 죽는다(파이썬 3.14에서 확인 — 옛 버전에서
동작했다면 그쪽이 예외다). CI 의 `pipeline-test` 잡도 같은 방식이며, 그 잡은 **발견된
테스트 개수까지 확인**한다 — 발견 실패는 `Ran 0 tests ... OK` 로 초록이 되기 때문이다.
