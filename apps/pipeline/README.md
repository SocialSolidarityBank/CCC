# ccc-pipeline — 처리 장비(회사 노트북) 파이프라인 클라이언트

상담 녹음과 수기 텍스트를 공통 API 에서 claim 해 전사·화자 분리·감정 분석(D64 보류)·2차 PII
마스킹을 수행하고 결과를 다시 API로 보내는 클라이언트다. 계약 정본은
`docs/specs/S5-agent-job-contract-v2.md`(운영 요약은 `docs/api-contract-pipeline.md`)이고
CLAUDE.md §5 파이프라인 스펙을 따른다.

- **작업은 claim 으로만 받는다(S5)** — `POST /pipeline/jobs/claim` 한 번이 오디오·텍스트를 섞어
  임대하고, 이후 모든 호출은 그 `claimToken`·`attempt` 를 함께 보낸다. 한 claim 은 성공 `result`
  또는 실패 `release` 를 정확히 한 번만 수행한다. `400` 을 payload 변환 신호로 읽지 않는다

- 처리 장비는 R2·D1에 직접 접근하지 않는다 — Workers API만 호출한다 (D13)
- 인증은 실행 모드별로 분리한다: Preview는 `CCC_PREVIEW_E2E_ACCESS_CODE`, 운영은
  Cloudflare Access 서비스 토큰 헤더(`CF-Access-Client-Id/Secret`)만 쓴다. 두 자격은 한 실행에 섞지 않는다
- 전사·중간 파일은 작업 디렉터리에 만들고 **작업 종료 시 무조건 삭제**한다 (D13)
- 로그에는 세션 ID·건수·소요 시간만 남긴다. 전사 내용·PII는 로그 금지 (R3)
- 감정은 숫자 점수만 산출한다. 문장형 감정 서술은 만들지 않는다 (R4)
- AI 대조·요약은 사업자(OpenAI) 호출로 Workers 에서 한다(D57·ADR-0027). 장비는 마스킹된
  원천과 숫자형 감정값만 보내며 요약이나 보류된 `aiSchema`를 만들지 않는다
- **Local은 무음 경계 청크를 쓴다. Azure client는 원본 파일 send를 authorized attempt당 최대 한 번 시작한다.** Azure 청크 업로드와 자동 client 재시도는 없다. 이는 provider 내부 처리의 exactly-once 보장이 아니다(D53·D77).
- **반복·출력 검사는 두 경로에 모두 적용한다.** 반복 구간은 지우지 않고 접어서 경고를 남긴다. 경고 줄은 `Segment.warning=True`라 감정 집계·역할 추정에서 빠진다(R4·D11).
- 현재 Local 구현은 격리된 Python runtime의 `Qwen/Qwen3-ASR-1.7B`와 `Qwen/Qwen3-ForcedAligner-0.6B` 원본 checkpoint를 쓴다. 로컬 공개 가중치 경로이며 취소된 Alibaba Cloud Token Plan을 호출하지 않는다. 최고·보편적 최신 모델이라는 뜻은 아니다.
- Azure는 `koreacentral`·`ko-KR`·`api-version=2025-10-15` endpoint를 쓴다. `diarization.enabled=true`, `maxSpeakers=2`로 받은 익명의 파일별 provider 화자 ID를 보존한다. Local과 Azure는 자동 전환하지 않는다.
- 제품 기본값은 `off`다. 어댑터 구현과 운영자 본인의 비민감 시험은 제품의 `sttEngine`, signed registry, 동의나 NER를 활성화하지 않는다. 품질·장비·기관 적합성과 Q 승인은 후속 단계다.

## 구조

```
ccc_pipeline/
  config.py          환경 변수 → 설정 (시크릿은 Infisical 주입, 코드에 없음)
  api_client.py      Workers API 클라이언트 (표준 라이브러리 urllib, UA 명시)
  transcribe.py      Local 전사 오케스트레이션: 조각 순회·시각 보정·제한된 조각 재시도 + 엔진 등록소 (D53)
  azure_stt.py       Azure 원본 파일 provider: 최대 1회 client send·익명의 파일별 화자 ID·반복 검사
  stt_trial.py       운영자 소유 비민감 입력용 STT 전용 CLI
  trial_server.py    위 CLI 를 브라우저에서 부르는 로컬 전용 HTTP 서버 (127.0.0.1, 제품 API 아님)
  chunking.py        Local 무음 경계 조각 분할 (ffmpeg silencedetect, 경계 계산은 순수 로직)
  repetition.py      Local·Azure 반복 붕괴 검사: 접어서 경고, 지우지 않는다 (순수 로직, R5)
  diarize.py         Local pyannote 화자 분리. Azure provider 화자 ID는 덮어쓰지 않는다
  speaker_mapping.py 전사 구간↔화자 정렬 + 수혜자/상담사 자동 추정 (D11, 순수 로직)
  emotion.py         감정 점수 집계 (음성 0.3 + 텍스트 0.7 가중, R4, 순수 로직)
  masking.py         2차 PII 마스킹 — 정규식(전화·주민번호·이메일·계좌) + 질병명 사전(G3) + 선택적 NER (D2)
  condition_terms.py 질병명·진단명 사전 — 무엇을 일부러 뺐는지도 여기 적혀 있다 (G3)
  results.py         v2 결과 payload 조립 — canonical JSON 과 hash 3종 (S5 §2.1)
  worker.py          claim 루프 (claim→처리→result 또는 release, 작업 디렉터리는 무조건 삭제)
tests/               표준 라이브러리 unittest — ML 설치 없이 실행 가능
systemd/             WSL2 자동 시작 유닛
```

## 기존 Whisper GPU 장비 세팅: v1 역사 재현 전용

1. WSL2 Ubuntu + CUDA 확인: `nvidia-smi`, PyTorch CUDA 빌드 설치 후
   `python3 -c "import torch; print(torch.cuda.is_available())"` → `True`
2. ML 의존성: `pip install -r requirements-ml.txt`
   (torch는 CUDA 빌드를 먼저 설치할 것 — requirements에는 고정하지 않는다)
3. pyannote 게이트 모델은 Hugging Face 승인 + `HF_TOKEN` 필요
4. 환경 변수(아래) 하이드레이션: Infisical에서 주입하거나 `/etc/ccc-pipeline.env`(600 권한)로.
   값을 레포·로그에 쓰지 않는다 (CLAUDE.md §10)
5. Preview 스모크는 `CCC_RUNTIME_ENVIRONMENT=preview`를 명시하고 Preview 자격만 주입해
   `python3 -m ccc_pipeline --once`로 실행한다. 대기 작업이 없으면 "no jobs"로 끝난다
6. 자동 시작: `systemd/ccc-pipeline.service` 설치 (파일 안 주석 참조)

인증 요청은 리다이렉트를 따라가지 않는다. 주소가 바뀌면 자격증명을 다른 곳으로 전달하는 대신 실패하므로 배포 주소를 직접 설정해야 한다. 서버의 오류 본문은 정해진 작업 오류 코드만 받아들이고 나머지는 `unknown`으로 처리한다. `--once`의 폴링 실패는 원본 예외 대신 `pipeline poll failed`를 출력하고 종료 코드 1을 반환한다.

설정의 일반 문자열 출력에는 Access 자격증명, Preview 코드, Hugging Face 토큰을 넣지 않는다. `vars(config)`나 `dataclasses.asdict(config)`에는 여전히 원래 값이 있으므로 로그, 진단 보고서, 파일로 내보내지 않는다.

## 환경 변수

| 이름 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `CCC_PIPELINE_CLIENT_ID` | 운영 필수 | — | 운영 Access 서비스 토큰 Client ID (Preview 모드에는 넣지 않는다) |
| `CCC_PIPELINE_CLIENT_SECRET` | 운영 필수 | — | 운영 Access 서비스 토큰 Client Secret (Preview 모드에는 넣지 않는다) |
| `CCC_PREVIEW_E2E_ACCESS_CODE` | Preview 필수 | — | Preview 처리 장비 전용 코드 (운영 모드에는 넣지 않는다) |
| `CCC_API_BASE_URL` | | 모드별 고정값 | `preview`면 `https://ccc-api-preview.account-855.workers.dev`, `production`이면 `https://ccc-api.account-855.workers.dev`. 반대 환경 URL은 시작 실패 |
| `CCC_POLL_INTERVAL_SECONDS` | | `600` | 폴링 주기(초). D8 SLA(다음 영업일) 안이면 조정 자유 |
| `CCC_WORK_DIR` | | `~/.cache/ccc-pipeline` | 임시 작업 디렉터리(작업마다 하위 생성 후 삭제) |
| `CCC_STT_MODEL` | | 엔진별 기본값 | Qwen은 `Qwen/Qwen3-ASR-1.7B`, 기존 Whisper 계열은 `medium`이다. `qwen-aligner` 역할은 `Qwen/Qwen3-ForcedAligner-0.6B`로 registry에 고정하며 Azure에는 로컬 모델 선택을 적용하지 않는다 |
| `CCC_STT_PYTHON` | Qwen worker | 없음 | `apps/pipeline/requirements-qwen.txt`로 준비한 격리 Python 실행 파일의 절대 경로 |
| `CCC_STT_DEVICE` | | `cpu` | Qwen 장치. `cpu`, `cuda`, `mps` 중 하나를 명시하며 다른 장치로 자동 전환하지 않는다 |
| `AZURE_SPEECH_KEY` | Azure worker | 없음 | Azure Speech 키. 승인된 환경 주입으로만 제공하고 CLI 인자·로그·산출물에 넣지 않는다 |
| `CCC_STT_ENGINE` | | `off` | `off`, `whisper`, `faster-whisper-int8-cpu`, `qwen3-asr`, `azure`. Azure는 Local `build_engine`이 아닌 별도 원본 파일 provider 경로다. 모르는 이름은 기동 실패이며, off 상태의 오디오 작업은 원음 다운로드와 ML 초기화 전에 차단한다 |
| `CCC_STT_MAX_CHUNK_SECONDS` | | `180` | 조각 최대 길이. 실측에서 3분 조각이 반복 붕괴를 없앴다 |
| `CCC_STT_MIN_CHUNK_SECONDS` | | `30` | 조각 최소 길이. 너무 잘게 나누면 조각마다 문맥이 사라져 정확도가 떨어진다 |
| `CCC_STT_REPEAT_THRESHOLD` | | `4` | 같은 문장이 몇 번 연속되면 붕괴로 볼지. 상담에서 두세 번 반복은 흔하므로 그 위 |
| `CCC_NER_MODEL_ID` | **예** | (없음) | 2차 마스킹용 한국어 인명 NER 모델. `red` **미설정이면 회차를 처리하지 않는다**(2026-07-31 Q 결정) — 인명 계층이 빈 채로 돌면 금고에 없는 제3자가 그대로 사업자로 나간다(R3). **라이선스 표기 확인 후 지정**(§5 규칙) |
| `CCC_NER_LABELS` | | `PS,PER,NAME,PRIVATE_PERSON` | 위 모델이 **인명에 붙이는 라벨 접두**. 모델과 한 쌍이다 — KLUE 계열은 `PS`/`PER`, PII 전용 모델은 `NAME` 계열로 다르다. 모델을 불러올 때 그 모델이 선언한 라벨과 대조하고, **안 맞으면 뜨지 않는다**(조용한 0건 마스킹 방지) |
| `CCC_NER_ADDRESS_LABELS` | | `LC,ADDRESS,PRIVATE_ADDRESS` | 주소 라벨 접두. `none`·`off` 로 두면 **주소 계층을 끈다**(주소를 안 잡는 모델로 갈아탈 때). 비어 있지 않은데 모델이 그 라벨을 선언하지 않으면 뜨지 않는다 |
| `CCC_CONDITION_NER_MODEL_ID` | | (없음) | 질병명 NER(G3). 미설정이면 사전 계층만 동작하고 **진행한다** — 인명과 달리 사전이 주 계층이다 |
| `CCC_CONDITION_NER_LABELS` | | `DS,DISEASE,SYMPTOM,CV_DISEASE,TRM` | 위 모델의 질병 라벨 접두. 대조 규칙은 인명과 같다 |
| `HF_TOKEN` | pyannote 사용 시 | — | Hugging Face 토큰(게이트 모델) |
| `CCC_NER_ATTESTATION` | **필수** | 없음 | S5 claim 이 요구하는 S6 NER attestation JSON(`id`·`modelId`·`modelRevision`·`labelSetHash`·`corpusHash`·`resultHash`·`validatedAt`·`expiresAt`·`status:"passed"`). 모양이 어긋나면 기동하지 않는다 |
| `CCC_NER_RELEASE_RECEIPT_ID` | **필수** | 없음 | E5-4 가 발급한 release qualification 영수증 ID. 서버가 만료·해시 일치를 확인하고, 어긋나면 claim 이 `local_ner_unavailable` 로 닫힌다 |
| `CCC_RUNTIME_ENVIRONMENT` | **필수** | 없음 | 실행 환경. `preview` 또는 `production`을 반드시 명시하며, 인증·API URL·백업 목적지가 모두 같은 환경이어야 한다 |
| `CCC_ORIGINAL_BACKUP_ENABLED` | | `off` | 원본 녹음 선택형 백업. 승인된 정책과 adapter가 생기기 전에는 켜지 않는다 |
| `CCC_ORIGINAL_BACKUP_ENVIRONMENT` | 백업 ON | 없음 | 백업 정책 환경. 실행 환경과 정확히 같아야 한다 |
| `CCC_ORIGINAL_BACKUP_PURPOSE` | 백업 ON | 없음 | 승인된 원본 보관 목적 |
| `CCC_ORIGINAL_BACKUP_DESTINATION_REF` | 백업 ON | 없음 | 코드에 등록된 승인 목적지의 불투명 참조. 자격증명이나 실제 경로를 넣지 않는다 |
| `CCC_ORIGINAL_BACKUP_RETENTION_DAYS` | 백업 ON | 없음 | 해당 사본의 승인된 보관 일수 |
| `CCC_ORIGINAL_BACKUP_CONSENT_NOTICE_VERSION` | 백업 ON | 없음 | 장기 원본 보관과 호환되는 동의 문안 버전 |

### 내부 STT 기능 시험

`ccc_pipeline.stt_trial`은 사업 DB, API, NER 우회, LLM 또는 공식 기록을 건드리지 않는 STT 전용 명령이다. 입력은 운영자가 직접 소유한 비민감 자기 목소리 녹음 또는 합성 기능 자료만 허용한다. `--owned-test-recording`은 이 사실을 확인할 뿐, 실제 당사자나 제3자 음성의 이용 권한, production 동의·NER·signed registry를 면제하지 않는다.

Qwen은 별도 환경의 Python을 명시한다. `--model`을 생략하면 역할에 고정된 `Qwen/Qwen3-ASR-1.7B`를 사용하며, 지정하더라도 manifest에 선언된 선택값만 허용한다.

Python 3.12가 설치된 macOS/Linux에서 격리 환경과 모델 캐시를 준비하는 예는 아래와 같다. 다운로드는 이 명령을 명시적으로 실행할 때만 일어나며, 이후 내부 시험 프로세스는 로컬 캐시만 읽는다. revision과 가중치 검사는 manifest 정본을 그대로 사용한다.

```bash
python3.12 -m venv "$HOME/.local/share/ccc-stt/qwen-venv"
"$HOME/.local/share/ccc-stt/qwen-venv/bin/python" -m pip install -r apps/pipeline/requirements-qwen.txt
PYTHONPATH=apps/pipeline "$HOME/.local/share/ccc-stt/qwen-venv/bin/python" -c \
  "from ccc_pipeline.qwen_runtime import prepare_qwen_models, qwen_manifest_models; prepare_qwen_models(qwen_manifest_models(), local_files_only=False)"
```

Windows는 가상환경의 `Scripts/python.exe`를 `--stt-python`에 지정한다. 아래 실행 예의 Python 경로는 실제 준비한 가상환경으로 바꾼다.

```bash
PYTHONPATH=apps/pipeline python3 -m ccc_pipeline.stt_trial \
  --audio /absolute/input.wav \
  --engine qwen3-asr \
  --stt-python /path/to/qwen-venv/bin/python \
  --device cpu \
  --owned-test-recording
```

새 출력 위치를 직접 정할 때만 마지막에 `--output-dir /outside/repo/new-run-dir`를 붙인다. 기본값은 `~/.local/state/ccc-stt-trials/e5-8-internal-<UTC>`다. Git 저장소 안이나 이미 존재하는 디렉터리는 거부한다.

Azure는 `AZURE_SPEECH_KEY`를 승인된 환경 주입으로만 받고, 외부 업로드를 별도로 확인한다.

```bash
PYTHONPATH=apps/pipeline python3 -m ccc_pipeline.stt_trial \
  --audio /absolute/input.wav \
  --engine azure \
  --owned-test-recording \
  --allow-azure-upload
```

출력 디렉터리와 `transcript.json`, `trial.json`은 POSIX에서 각각 0700, 0600으로 생성한다. Windows에서는 사용자 전용 폴더의 접근 제어를 별도로 확인해야 하며 POSIX mode 값만으로 NTFS 권한 검증을 대신하지 않는다. 기존 파일을 덮어쓰지 않으며 stdout에는 안전한 run 메타데이터만 쓰고 전사문·원문 오류·키를 쓰지 않는다. Azure client는 원본 파일 send를 최대 한 번 시작하고 자동 재시도하지 않으며, 익명의 파일별 provider 화자 ID를 보존한다.

이 2026-09-08 구현 작업에서는 실제 Qwen 모델 적재, 실제 Azure 호출, 사람 품질, 장비 처리량 또는 제품 활성화를 검증하지 않았다.

### 내부 STT 시험 로컬 서버

`ccc_pipeline.trial_server` 는 위 CLI 와 같은 처리를 브라우저가 부를 수 있게 감싼 로컬 전용 HTTP 서버다. 사업 DB, 세션, 동의, NER 영수증, 승인 registry 를 건드리지 않고 제품 STT 를 활성화하지 않는다. 입력은 CLI 와 같이 운영자 본인이 소유한 비민감 시험녹음만 허용한다. 엔진은 `qwen3-asr` 과 `azure` 두 가지다.

```bash
CCC_STT_PYTHON=/path/to/qwen-venv/bin/python \
CCC_STT_TRIAL_CLIENT_DIR=/path/to/apps/client/dist \
PYTHONPATH=apps/pipeline python3 -m ccc_pipeline.trial_server
```

`127.0.0.1` 에만 바인딩한다. 명령 인자는 받지 않고 설정은 환경 변수로만 준다.

| 이름 | 기본값 | 용도 |
| --- | --- | --- |
| `CCC_STT_TRIAL_PORT` | `8790` | 서버 포트 |
| `CCC_STT_TRIAL_DIR` | `~/.local/state/ccc-stt-trials` | 결과와 실행 잠금 위치. Git 워크트리 안이면 뜨지 않는다 |
| `CCC_STT_TRIAL_CLIENT_DIR` | 없음 | 빌드된 `apps/client` 정적 파일 루트. 없으면 API 만 제공한다 |
| `CCC_WORK_DIR` | `~/.cache/ccc-pipeline` | 업로드 임시 사본 위치 |
| `CCC_STT_PYTHON`·`CCC_STT_DEVICE`·`AZURE_SPEECH_KEY` | 위 표와 같다 | 엔진 설정. 브라우저가 아니라 서버 환경이 정한다 |

| 요청 | 내용 |
| --- | --- |
| `GET /internal/stt/status` | 설정 존재 여부, 정확한 모델 ID 와 revision, Qwen aligner, Azure region 과 api-version, 업로드 한도와 허용 형식, 진행 중 시험 |
| `POST /internal/stt/trials` | 오디오 bytes 제출. 헤더는 `X-CCC-Trial-Engine`, `X-CCC-Owned-Test-Recording: 1`, Azure 만 `X-CCC-Allow-External-Upload: 1`. 202 와 `trialId` 를 준다 |
| `GET /internal/stt/trials/{32자리}` | `queued`, `running`, `completed`, `failed` 와 종결 정보. 모든 상태에 `externalUploadAttempted` 를 포함한다 |
| `GET /internal/stt/trials/{32자리}/transcript` | 완료 결과만. `segments`(화자는 있을 때만), `repetitionWarnings`, `forcedCuts`, `qualityEvaluation: deferred` |
| `DELETE /internal/stt/trials/{32자리}` | 종결 결과 삭제. 실행 중이면 409 |

`configured` 는 설정이 있다는 뜻이며 준비 완료, 품질 통과, 제품 승인이 아니다.

`externalUploadAttempted` 는 `true`·`false`·`null` 세 값이다. Local 은 외부로 나가지 않으므로 `false`, Azure 는 그 회차의 기록(`trial.json`)에 남은 boolean 만 쓴다. 아직 기록이 없거나 읽을 수 없으면(진행 중, 전송 시도 전 실패, 결과 저장 실패) `null` 이며 이것은 "모른다"는 뜻이다. **모르는 상태를 `false` 로 표시하면 안 된다.** 실제로 원음이 나갔는지 모르는 상황을 나가지 않았다고 알리는 셈이다. 화면도 `null` 을 "확인 불가"로 보여야 한다.

경계:

- `Host` 는 `127.0.0.1:<port>` 또는 `localhost:<port>` 만 받고, `Origin` 이 있으면 **그 요청이 통과한 `Host` 와 같아야** 한다. `127.0.0.1` 과 `localhost` 는 서로 다른 origin 이라 짝을 섞으면 `origin_not_allowed` 다. CORS 헤더를 내보내지 않으므로 교차 출처 호출은 브라우저가 막는다.
- 모든 응답에 `Cache-Control: no-store, private`, `nosniff`, CSP 를 붙인다. CSP 는 `script-src 'self'` 를 유지하되 `style-src` 에 `'unsafe-inline'` 을 허용한다. 빌드된 클라이언트가 공유 Wire CSS 를 인라인 `<style>` 로 싣기 때문이며(`apps/web` RootLayout 과 같은 방식) 이걸 막으면 화면 여백과 배경이 실제로 사라진다. `frame-ancestors` 와 `object-src` 는 `'none'` 이다.
- 정적 파일은 지정한 디렉터리 안의 파일만 목록 없이 제공한다. 상위 경로와 밖으로 나가는 심볼릭 링크는 404 다.
- 브라우저는 파일 경로, 모델 선택, python 실행 파일, provider URL, 키, 실행 명령을 지정할 수 없다. 본문은 오디오 bytes 뿐이고 나머지는 서버 환경이 정한다.
- 인증 토큰은 없다. 같은 계정의 다른 로컬 프로세스는 이 API 를 부를 수 있다는 천장을 전제로 쓴다.

업로드 프레이밍은 선언 길이만 읽는다. `Content-Length` 는 필수이고 1 이상 209,715,200(200MB) 이하의 정수여야 하며, `Transfer-Encoding` 이 있으면 `chunked_body_not_supported` 로 거부한다. 선언보다 본문이 짧으면 `audio_body_incomplete`, 읽기가 timeout 이면 `upload_timeout`, 선언이 한도를 넘으면 본문을 읽지 않고 413 `audio_too_large` 로 연결을 끊는다. keep-alive 연결에서 선언 길이를 넘겨 읽으면 응답을 기다리는 브라우저와 교착되므로 이 규칙을 바꾸지 않는다.

생명주기와 단일 실행 경계:

- 고부하 작업은 한 번에 하나다. 실행 중 제출은 409 `trial_already_running` 이다.
- 서버는 시작할 때 결과 디렉터리에 `.server.lock` 을 만든다. 이미 있으면 뜨지 않고 종료 코드 3 이다. 강제 종료 뒤에는 남은 STT 자식 프로세스가 없음을 확인하고 그 파일을 지운다. 재기동이 겹쳐 고부하 작업 둘이 도는 것을 막는 경계가 이것이다.
- SIGINT 과 SIGTERM 은 새 요청을 받지 않고 진행 중 작업을 최대 30초 기다린 뒤 잠금을 지운다. 그 시간을 넘겨 작업이 남아 있으면 **잠금을 지우지 않고 종료 코드 4** 를 낸다. 데몬 스레드는 인터프리터와 함께 죽지만 격리된 STT 자식 프로세스는 살아남을 수 있어서, 이때 잠금을 풀면 새 서버가 그 옆에서 두 번째 고부하 작업을 시작한다. 남은 자식이 없음을 확인한 뒤 잠금 파일을 지운다.
- 시작할 때 `api-*` 디렉터리 중 서버 결과 파일(`server-trial.json`)이 없는 것은 `failed` 와 `interrupted` 로 표시하고 남은 조각 디렉터리를 지운다. 자동 재실행은 하지 않는다.
- 시작할 때 업로드 임시 디렉터리의 `upload-*` 사본도 지운다. 강제 종료로 남은 원음 사본이 디스크에 계속 있는 것을 막는다. 이 디렉터리는 `CCC_WORK_DIR/stt-trial-uploads/<결과 루트 지문>` 이라 결과 루트가 다른 서버는 서로의 업로드를 건드리지 않는다. 잠금은 결과 루트 단위이므로 두 이름 공간을 맞춰 둔다.
- 종료를 시작하면 먼저 새 예약을 막는다(`503 server_shutting_down`). listener 를 닫아도 이미 열린 연결의 처리 스레드는 살아 있어서, 예약을 먼저 막지 않으면 유휴 판정 뒤에 새 고부하 작업이 시작될 수 있다.
- 종결 결과를 디스크에 쓸 수 없으면(공간 부족, 권한 등) 그 시험은 `failed` + `result_storage_failed` 로 관측된다. 예외를 스레드 밖으로 흘려 traceback 과 경로를 찍지 않고, 상태를 메모리에 들고 조회에 답하며 슬롯과 임시 원음 정리는 그대로 수행한다. 저장이 안 된 판정이라 재시작하면 sidecar 가 없어 `interrupted` 로 정리된다.
- POSIX 에서는 `SO_REUSEADDR` 을 켜서 정상 종료 직후 같은 포트로 바로 다시 뜬다. 이 옵션은 TIME_WAIT 만 건너뛰며 살아 있는 listener 가 있으면 여전히 bind 가 실패한다. Windows 에서는 같은 옵션이 이미 묶인 포트를 가로챌 수 있어 끄고, 대신 위 잠금 파일이 단일 실행을 보장한다.

CLI 와 다른 점:

| 축 | CLI | 서버 |
| --- | --- | --- |
| 실행 식별 | 시각으로 만든 디렉터리 이름 | `api-` + 32자리 난수 |
| 상태 | 상태 개념이 없다 | `queued`·`running` 은 메모리, 종결은 `server-trial.json` |
| 업로드 원음 | 사용자 원본을 읽기만 한다 | 업로드 사본을 성공·실패·초과·종료 어느 경로에서나 지운다 |
| 결과 삭제 | 사람이 지운다 | 자동 기한 삭제 없음. 종결 결과만 `DELETE` 로 지운다 |

제출 거부 코드는 `engine_invalid`, `content_type_not_allowed`, `content_length_required`, `audio_body_empty`, `audio_too_large`, `audio_body_incomplete`, `upload_timeout`, `chunked_body_not_supported`, `owned_test_recording_declaration_required`, `external_upload_not_authorized`, `external_upload_flag_requires_azure`, `qwen_python_required`, `qwen_python_invalid`, `azure_speech_key_missing`, `invalid_device`, `trial_already_running`, `trial_not_completed`, `trial_running`, `server_shutting_down`, `host_not_allowed`, `origin_not_allowed`, `not_found`, `method_not_allowed`, `bad_request`, `trial_result_invalid`, `internal_error` 다. 표준 라이브러리가 만드는 오류(모르는 메서드, 깨진 요청 줄)도 HTML 대신 같은 형태의 `method_not_allowed`·`bad_request` 로 답한다. 종결 실패의 `errorCode` 는 `engine_not_ready`, `engine_timeout`, `engine_result_invalid`, `provider_rejected`, `provider_unavailable`, `audio_rejected`, `engine_execution_failed`, `result_storage_failed`, `interrupted`, `stt_execution_failed` 와 CLI 의 고정 코드다. Azure 어댑터는 timeout 과 소켓 오류를 한 코드로 묶으므로 그 경우를 timeout 이라고 적지 않는다.

이 서버의 계약은 처리기를 mock 한 네트워크 테스트로 확인했다. 실제 모델 적재, 실제 Azure 호출, 브라우저 녹음 왕복은 확인하지 않았다.

### S13 후보 비교: v1 CPU 경로 재현

아래 faster-whisper `medium`·int8 CPU 설정과 실행 명령은 기존 합성 S13 v1과 과거 FAIL을 재현하는 역사·회귀 경로다. 현재 어댑터 구현이나 운영자 본인의 비민감 시험의 선행조건이 아니다. 사람 모의상담 품질·사양 판정은 구현 뒤 [S13 STT qualification v2](../../docs/specs/S13-stt-qualification-v2.md)의 후속 단계에서 수행한다.

`faster-whisper-int8-cpu`는 `device="cpu"`, `compute_type="int8"`로 고정한다. CUDA 자동 선택이나 다른 엔진으로의 전환은 없다. `transcribe_audio`의 무음 분할, 반복 구간 재시도와 경고, 원본 기준 시각 보정을 그대로 거친다. 모델은 엔진 인스턴스당 한 번만 올리고 각 청크에서 재사용한다.

후보 모델의 이름, revision과 가중치 SHA-256은 [`model-license-manifest.json`](../../supply-chain/model-license-manifest.json)이 정본이다. 고정 revision의 snapshot을 받고 `model.bin`의 SHA-256을 확인한 뒤 로컬 파일만으로 모델을 연다. 설치된 SDK만으로 STT가 활성화되지는 않는다.

```bash
# 격리된 Python 환경에서 설치한다. ffmpeg도 필요하다.
python -m pip install -r apps/pipeline/requirements-ml.txt
# 기존 Preview 자격과 유효한 NER attestation/release 영수증을 주입한 경우에만 실행한다.
CCC_RUNTIME_ENVIRONMENT=preview CCC_STT_ENGINE=faster-whisper-int8-cpu \
  PYTHONPATH=apps/pipeline python -m ccc_pipeline --once
```

NER 검증 영수증 없이 워커를 실행하려고 가짜 attestation을 만들지 않는다. 후보 어댑터만 검증할 때는 `build_engine("faster-whisper-int8-cpu", "medium")`를 기존 `transcribe_audio`에 전달하고 합성 음성을 사용한다. 제품 승인 registry나 기관 설정은 변경하지 않는다.

실행 증거: [`e5-2-local-stt-candidate-smoke.json`](../../artifacts/pilot/e5-2-local-stt-candidate-smoke.json). macOS CPU에서 합성 한국어 음성의 청크 처리와 시각 보정을 확인한 자료다. Windows CPU 성능, 실제 상담 정확도, STT-G1~STT-G3과 Q 승인을 대신하지 않는다.

E0-4에서 넘긴 모델 5종의 인증 다운로드와 파일 무결성 검증은 [`e5-2-model-downloads.json`](../../artifacts/pilot/e5-2-model-downloads.json)에 기록했다. 이는 다운로드와 checksum 증거이며 NER 정확도나 화자 분리 추론의 통과 판정은 아니다.

### S13 v1 역사·회귀 비교

비교 도구는 [`scripts/stt/benchmark.py`](../../scripts/stt/benchmark.py)다. [S13 v1 측정 규칙](../../docs/specs/S13-pilot-metrics.md)의 150건과 과거 검증 영수증을 재현할 때만 사용한다. 정답은 채점 과정에서만 읽고 모델 워커에는 전달하지 않는다. 반복률은 재시도 선택 후, 반복 축약 전 결과로 계산한다.

본 측정 전에는 Windows에서 `ffmpeg`와 `ffprobe`가 실행되어야 한다. [S13 v1 준비 절차](../../docs/specs/S13-pilot-metrics.md)에 따라 오디오를 `artifacts/pilot/fixtures/s13-v1/audio/`에 받고, 기존 `artifacts/pilot/fixtures/s13-v1-verification.json`과 일치하는지 확인한다. 이 절차와 기존 합성 5건 청취·독립 STT는 현재 구현 입장 조건이 아니다.

파이프라인 환경과 Qwen 환경을 분리한다. Qwen은 [`requirements-qwen.txt`](requirements-qwen.txt)를 쓰고 모델 revision, 가중치 hash와 라이선스는 [`model-license-manifest.json`](../../supply-chain/model-license-manifest.json)에 고정한다. 준비된 local snapshot만 열며 제품 NER 환경의 패키지를 바꾸지 않는다.

다음은 Python 3.12가 준비된 Windows CPU의 실행 예다. 저장소, 가상환경, 모델 캐시와 임시 파일은 한글이 없는 작업 경로에 둔다. Windows 실측에서 Qwen의 Nagisa/DyNet이 한글 경로의 모델을 열지 못했고 영문 경로에서는 성공했으므로 사용자 홈이나 기본 TEMP 경로를 그대로 쓰지 않는다. 작업 루트는 현재 Windows 계정, SYSTEM과 관리자만 접근하도록 준비하고, 그 아래 `repo`에 받은 저장소 루트에서 실행한다. 아래 파이프라인 버전은 Mac 탐색 실행에서 확인한 조합이며 Windows 설치와 추론 검증은 별도로 필요하다.

```powershell
$benchmarkRoot = 'C:\ProgramData\CCC\benchmarks\e5-8'
$env:HF_HUB_CACHE = "$benchmarkRoot/hf-hub"
$env:TEMP = "$benchmarkRoot/tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
python -m venv "$benchmarkRoot/pipeline"
& "$benchmarkRoot/pipeline/Scripts/python.exe" -m pip install faster-whisper==1.2.1 pyannote.audio==3.4.0 torch==2.8.0 torchaudio==2.8.0 huggingface-hub==0.36.2
python -m venv "$benchmarkRoot/qwen"
& "$benchmarkRoot/qwen/Scripts/python.exe" -m pip install -r apps/pipeline/requirements-qwen.txt

& "$benchmarkRoot/pipeline/Scripts/python.exe" scripts/stt/benchmark.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/results/e5-8-windows-cpu-001 --pipeline-python "$benchmarkRoot/pipeline/Scripts/python.exe" --qwen-python "$benchmarkRoot/qwen/Scripts/python.exe" --qwen-device cpu --diarization-device cpu --threads 4
```

새 결과 디렉터리만 허용한다. 결과는 회차별 숫자와 합산 지표, hash, 모델과 장비 정보이며 전사문은 저장하지 않는다. `recordedSessionCount`는 실패를 포함해 기록된 회차 수이고 `measuredSessionCount`는 채점된 회차 수다. 합산 사건의 `sessionIndex`는 `measuredSessionIds`의 위치를 가리킨다.

누락, 잘못된 회차, 추가 응답이나 비정상 종료는 전체 `FAIL`이다. 완전한 150건에서 지표 하나라도 기준을 넘으면 `FAIL`, 실패가 없고 미측정 지표가 남으면 `UNMEASURED`, 전부 통과하면 `PASS`다. 종료 코드 0은 전체 `PASS`에만 사용한다.

RTF 자격은 실행 프로세스가 읽은 OS와 워커의 CPU device로 정한다. macOS의 숫자는 보존하되 Windows CPU 판정은 `UNMEASURED`다. 타이머는 `LoadedWorker.infer` 호출 직전부터 반환 직후까지이며 청크 처리, 재시도와 강제 정렬을 포함하고 초기화, 임시 폴더 생성·삭제와 프로세스 간 전송은 제외한다. 화자 분리는 한 번 실행해 두 후보가 공유하므로 DER로 후보 간 우열을 매기지 않는다.

탐색용 단건 실행과 오프라인 엔진 비교는 Community Cloud, Local Single, Local Office의 종단 검증이나 Q의 STT 승인으로 간주하지 않는다. 안전 지표도 고정된 문자 정렬에서 계산한 사건 수이며 사실 오류나 임상적 위험의 판정이 아니다.

### 선택형 원본 백업 정책

원본 백업은 기본 OFF다. OFF이면 외부 저장소를 찾거나 호출하지 않는다. ON으로 바꾸려면
목적, 승인 목적지 참조, 보관 기간, 동의 문안 버전, 실행 환경이 모두 있어야 하며 하나라도
빠지면 처리 장비가 기동하지 않는다. 현재는 NAS와 Google Shared Drive adapter를 구현하지
않았으므로 완전한 ON 설정도 승인 목적지 미등록 오류로 막힌다.

향후 adapter를 붙여도 백업은 전사와 마스킹의 필수 경로가 아니다. 복사 실패는 내용 없는
상태만 남기고 녹음 결과 처리는 계속된다. OFF 전환은 새 복사만 멈추며 이미 만들어진 사본의
만료일을 바꾸거나 지우지 않는다. 기존 사본 즉시 삭제는 복사 경로와 분리된 별도 감사 작업이다.

### 인명 NER 모델 (2026-08-01 Q 승인)

**`FrameByFrame/korean-pii-e5-base`** — 라이선스 **MIT**(§5 규칙 충족, 모델 카드 확인).
베이스는 `intfloat/multilingual-e5-base`. 대화체 KDPII F1 0.943 / KLUE 인명 0.866.

```bash
CCC_NER_MODEL_ID=FrameByFrame/korean-pii-e5-base
CCC_NER_LABELS=PRIVATE_PERSON
CCC_NER_ADDRESS_LABELS=PRIVATE_ADDRESS   # 주소도 가린다(2026-08-01 Q 결정). 끄려면 none
```

인명과 주소는 **같은 모델**이 잡으므로 가중치는 한 번만 올린다. 다만 치환 토큰은 갈라서
`[인명]`·`[주소]` 로 따로 남긴다 — 주소를 `[인명]` 으로 치환하면 검토 화면과 마스킹 집계가
둘 다 거짓이 된다.

`yellow` **생년월일(`private_date`)은 일부러 넣지 않았다.** 상담에서 날짜는 "지난달 퇴사",
"3월 계약 만료" 처럼 맥락 자체인 경우가 많아, 가리면 AI 가 시간 흐름을 읽지 못한다.

`yellow` **이 모델의 라벨은 `PS`/`PER` 가 아니다.** 실제 라벨은 `private_person`·`private_address`·
`private_phone` … 9종이고 태깅은 **BIOES**(B-/I-/E-/S-)다. 기본값에 `PRIVATE_PERSON` 을 넣어 뒀지만,
세팅 때 `CCC_NER_LABELS` 로 **의도한 라벨만 명시**하는 쪽을 권한다 — 무엇을 가리기로 했는지가
설정에 남는다.

이 모델은 전화·이메일·계좌·주소·URL·IP·생년월일도 함께 잡는다. 정규식 계층과 **겹치지만 겹쳐 둔다** —
한쪽이 놓쳐도 다른 쪽이 잡는 게 목적이고, 같은 자리를 두 번 치환해도 결과는 같다.

`red` 질병명은 이 모델에 **없다**. 질병명은 사전 계층(`condition_terms.py`)이 주 계층이고, 그건
이 모델 채택과 무관하게 그대로다(G3).

### 마스킹 원칙 — 과마스킹을 감수한다 (2026-08-01 Q 결정)

기계는 두 방향으로 틀린다. 둘 다 줄일 수는 없어 **어느 쪽을 감수할지**를 정했다.

| 실수 | 결과 | 되돌릴 수 있나 |
| --- | --- | --- |
| **미탐**(이름인데 못 알아봄) | 실명이 사업자로 나간다 | `red` 없다 |
| **과탐**(이름 아닌데 가림) | 글이 읽기 나빠진다 | `yellow` 있다 |

**미탐보다 과탐을 택한다.** 구현에 두 군데 반영돼 있다:

- **라벨 접두는 넓게** 잡는다(여러 계열을 함께). 좁혀서 놓치는 것보다 낫고, 아예 안 맞으면 뜨지 않으므로 조용한 실패는 없다.
- **겹치는 스팬은 합집합을 한 토큰으로 덮는다**(`_merge_spans`). 한쪽을 버리면 겹치지 않는 부분이 원문 그대로 남고, 잘라서 치환하면 `[인명][주소]수` 같은 조각이 남는다 — 둘 다 유출이다.

`yellow` **민감도 손잡이는 이 모델에 없다.** 실제로 조정하려면 실측에서 두 실수의 비율을 보고 후처리 규칙을 얹어야 한다 — 실측 게이트의 몫이고, 지금은 원칙만 못 박아 둔 상태다.

**실측 게이트 검사 유형에 '짧은 목표 문장'이 있다**(D62 §7 검수 반영, ADR-0032 · CCC-73). "아들 학원비 마련"처럼 짧은 글은 앞뒤 맥락이 없어 NER 이 인명·지명을 놓치기 쉬운데, D62 이후 전체 목표가, D69 이후로는 세부 목표·회기 목표까지 각각 `[전체 목표]`·`[세부 목표]`·`[회기 목표]` 라벨과 함께 텍스트 일감 원문에 실려(ADR-0036 · CCC-103) 이 마스킹을 그대로 거친다. 말뭉치와 결정론 계층 검사는 `tests/test_masking.py` 의 `GOAL_SENTENCE_CORPUS` 에 있고, 실측은 같은 말뭉치를 실모델로 돌려 치환율을 잰다.

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
