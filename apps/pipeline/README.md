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
- **전사는 통짜로 넣지 않는다** — 무음 경계에서 조각으로 나누고 반복 붕괴를 검사한다 (D53·ADR-0024).
  실측에서 whisper large-v3가 34분 대화의 48%를 같은 문장 254번 반복으로 잃고 없던 문장을 지어냈다
- **반복 구간은 지우지 않고 접어서 경고를 남긴다** — 그 시간대에 엔진이 무너졌다는 사실 자체가
  실무자에게 필요한 정보다. 경고 줄은 `Segment.warning=True`라 감정 집계·역할 추정에서 빠진다 (R4·D11)
- **엔진은 아직 확정되지 않았다.** STT는 기본 `off`이고 faster-whisper int8 CPU는 명시적으로 선택하는 후보다. STT-G1~STT-G3과 Q 승인 전에는 제품의 `sttEngine=null`과 비활성 선택지를 유지한다(D77).
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
  masking.py         2차 PII 마스킹과 S6 날짜/나이/지역 일반화, 주소/우편번호 토큰화
  condition_terms.py 질병명·진단명 사전 — 무엇을 일부러 뺐는지도 여기 적혀 있다 (G3)
  results.py         v2 결과 payload 조립 — canonical JSON 과 hash 3종 (S5 §2.1)
  worker.py          claim 루프 (claim→처리→result 또는 release, 작업 디렉터리는 무조건 삭제)
tests/               표준 라이브러리 unittest — ML 설치 없이 실행 가능
systemd/             WSL2 자동 시작 유닛
```

## 기존 Whisper GPU 장비 세팅

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

## 환경 변수

| 이름 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `CCC_PIPELINE_CLIENT_ID` | 운영 필수 | — | 운영 Access 서비스 토큰 Client ID (Preview 모드에는 넣지 않는다) |
| `CCC_PIPELINE_CLIENT_SECRET` | 운영 필수 | — | 운영 Access 서비스 토큰 Client Secret (Preview 모드에는 넣지 않는다) |
| `CCC_PREVIEW_E2E_ACCESS_CODE` | Preview 필수 | — | Preview 처리 장비 전용 코드 (운영 모드에는 넣지 않는다) |
| `CCC_API_BASE_URL` | | 모드별 고정값 | `preview`면 `https://ccc-api-preview.account-855.workers.dev`, `production`이면 `https://ccc-api.account-855.workers.dev`. 반대 환경 URL은 시작 실패 |
| `CCC_POLL_INTERVAL_SECONDS` | | `600` | 폴링 주기(초). D8 SLA(다음 영업일) 안이면 조정 자유 |
| `CCC_WORK_DIR` | | `~/.cache/ccc-pipeline` | 임시 작업 디렉터리(작업마다 하위 생성 후 삭제) |
| `CCC_WHISPER_MODEL` | | `medium` | manifest에 고정된 모델 선택값. 기존 Whisper와 faster-whisper 후보 모두 `medium`만 허용한다 |
| `CCC_STT_ENGINE` | | `off` | `off`, `whisper`, `faster-whisper-int8-cpu`. 후보는 Preview에서만 명시적으로 선택한다. 모르는 이름은 기동 실패이며, off 상태의 오디오 작업은 원음 다운로드와 ML 초기화 전에 차단한다. 텍스트 작업은 계속 처리한다 |
| `CCC_STT_MAX_CHUNK_SECONDS` | | `180` | 조각 최대 길이. 실측에서 3분 조각이 반복 붕괴를 없앴다 |
| `CCC_STT_MIN_CHUNK_SECONDS` | | `30` | 조각 최소 길이. 너무 잘게 나누면 조각마다 문맥이 사라져 정확도가 떨어진다 |
| `CCC_STT_REPEAT_THRESHOLD` | | `4` | 같은 문장이 몇 번 연속되면 붕괴로 볼지. 상담에서 두세 번 반복은 흔하므로 그 위 |
| `CCC_NER_MODEL_ID` | **예** | 없음 | S6가 고정한 `FrameByFrame/korean-pii-e5-base`. 다른 모델로 자동 전환하지 않는다 |
| `CCC_NER_LABELS` | | `PRIVATE_PERSON` | 정식 S6의 정확한 인명 라벨. 다른 라벨 구성은 같은 manifest로 처리하지 않는다 |
| `CCC_NER_ADDRESS_LABELS` | | `PRIVATE_ADDRESS` | 정식 S6의 정확한 주소 라벨. `none`/`off`는 정식 처리에서 허용하지 않는다 |
| `CCC_CONDITION_NER_MODEL_ID` | | 없음 | 정식 S6에서는 설정하지 않는다. 질환 사전 계층만 사용하며 별도 NER 모델을 같은 manifest에 추가하지 않는다 |
| `CCC_CONDITION_NER_LABELS` | | `DS,DISEASE,SYMPTOM,CV_DISEASE,TRM` | 기존 비활성 후보 설정. 정식 S6는 별도 질환 NER을 사용하지 않는다 |
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

### Local STT 후보 실행

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

### 선택형 원본 백업 정책

원본 백업은 기본 OFF다. OFF이면 외부 저장소를 찾거나 호출하지 않는다. ON으로 바꾸려면
목적, 승인 목적지 참조, 보관 기간, 동의 문안 버전, 실행 환경이 모두 있어야 하며 하나라도
빠지면 처리 장비가 기동하지 않는다. 현재는 NAS와 Google Shared Drive adapter를 구현하지
않았으므로 완전한 ON 설정도 승인 목적지 미등록 오류로 막힌다.

향후 adapter를 붙여도 백업은 전사와 마스킹의 필수 경로가 아니다. 복사 실패는 내용 없는
상태만 남기고 녹음 결과 처리는 계속된다. OFF 전환은 새 복사만 멈추며 이미 만들어진 사본의
만료일을 바꾸거나 지우지 않는다. 기존 사본 즉시 삭제는 복사 경로와 분리된 별도 감사 작업이다.

### NER 검증과 가림 규칙

모델과 revision, labels, 설치 N2 및 출시 기준은 [S6 §2.2](../../docs/specs/S6-privacy-packet.md#22-ner-health-attestation)가 정본이다. 인명과 주소는 같은 모델을 한 번 로드하되 `[인명]`, `[주소]`로 구분한다. 등록값 직접 치환과 일반화의 순서 및 주소/지역 분류도 S6 §2.4~2.5를 따른다.

입력 처리는 `ner-mask-v5`이며 BIOES 디코더와 v4의 창 규칙은 그대로다. 최대 24,000 code-point를 특수 토큰 포함 512토큰 창으로 나누고, 내용 토큰 128개를 겹쳐 최대 64개 창을 하나씩 추론한다. 같은 토큰의 예측은 창 경계에서 더 먼 쪽을 고르고 동률이면 앞 창을 쓴다. 원문 좌표와 전체 입력의 처리를 확인하지 못하거나 한도를 넘으면 부분 결과를 반환하지 않고 `local_ner_unavailable`로 닫는다.

창 규칙, batch 크기 1, 디코더 버전과 허용 런타임(torch 2.8.0, transformers 4.53.3)은 새 manifest hash에 들어간다. 런타임은 CPU wheel의 `+cpu` 같은 빌드 접미사만 허용하고 다른 기본 버전은 거부한다. 서버의 기존 S6 승인 계약은 바꾸지 않았으며, 새 처리를 이전 영수증으로 활성화하지 않는다. 아래의 과거 실패 보고서를 새 버전의 결과로 다시 표시하지 않는다.

등록된 값의 정확한 치환이 날짜/나이/지역 일반화보다 먼저다. 겹치는 원문은 긴 매칭의 대체값으로 한 번만 덮고, 상충하거나 대체값에 등록값이 남는 dictionary는 거부한다. 날짜는 연월, 명시 나이는 5년 구간, 명시된 지역은 광역까지만 남긴다. 상대 날짜와 이미 광역인 일반 서술은 유지한다.

`regex-v3`는 우편번호, 주민번호, 전화번호, 계좌와 이메일을 원문에서 검출하고 주소 및 NER 구간과 합쳐 한 번에 가린다. 모델이 앞부분을 가려 뒤의 정형 규칙이 나머지를 놓치던 문제를 막는다. 온전한 ISO 날짜는 계좌로 가리지 않고 기존대로 일반화하며, 주소나 NER가 날짜 일부를 덮는 경우에는 날짜 조각이 남지 않도록 합친다. 겹친 구간은 기존 인명/주소/질환 우선순위 다음 주민번호, 전화번호, 계좌, 이메일, 우편번호 순으로 한 토큰을 고른다. 후단의 정형 식별자 재탐색은 제거했고 질병명 사전 처리는 유지한다.

**v5 순서 충돌 검증:** 같은 모델 예측으로 v4와 v5의 실제 가림을 1,819개 자료에서 대조했다. 원문 정형 식별자 매칭 61개에서 남던 글자는 83개에서 0개가 됐고, 이전에 가려지던 비공백 글자가 새로 노출된 경우는 없었다. Mac 회귀 202개, Windows 회귀 70개 및 실제 함수 smoke를 통과했다. 날짜 경계는 한 자리와 두 자리 월·일을 별도 회귀로 확인했다. 모델 정확도와 승인 기준은 바꾸지 않았고 N2 주소 미통과도 유지한다. [최종 증거](../../artifacts/ccc237-privacy/masking-order/verification.json)와 [같은 예측으로 비교하는 실행기](../../artifacts/ccc237-privacy/masking-order/measure.py)에 범위와 source hash를 보존한다. 과거 진단 스크립트의 source hash 불일치는 의도된 차단이며, 새 코드를 과거 결과로 표시하지 않는다.

`scripts/privacy/qualify_ner.py`는 `--kind health|release`, `--corpus`, `--expected-corpus-hash`, 새 `--output`을 받는다. `--validate-only`는 ML을 로드하지 않는다. 실제 검사는 Mac 메모리를 먼저 확인하고 캐시된 고정 모델을 offline CPU 2 threads로 실행한다. 기존 결과는 덮어쓰지 않는다. 보고서 숫자는 기존 canonical JSON의 상호운용 범위를 쓰며, 지원하지 않는 숫자 표기는 hash를 꾸미지 않고 실패로 닫는다.

창 분할 진단은 `scripts/privacy/run_windowing_probe.py --root . --output <새-보고서-경로>`로 실행한다. 고정 자료 1,819개, 짧은 입력의 기존 예측 대조, 긴 입력의 전체 처리 여부, 24,000자 부하와 한도 초과 거부를 측정한다. Mac RSS와 Windows peak working set은 측정 방식이 다른 값이며, 모델 정확도 승인이나 프로세스 전체 메모리 폐기 증거를 대신하지 않는다.

Windows 재측정은 고정 자료와 소스를 tar처럼 바이트를 보존하는 방식으로 별도 폴더에 옮긴 뒤 같은 명령을 사용한다. CRLF 변환으로 파일 바이트가 달라지면 고정 자료 검사에서 의도적으로 거부한다. `--long-only`는 긴 입력 11개와 부하만 다시 확인하는 옵션이며 보고서에 측정 범위가 표시된다. 전체 자료의 대조 결과로 확대하지 않는다.

**2026-09-08 긴 입력 수정(v4 당시 측정):** Mac과 Windows의 1차 전체 측정에서 각 장비의 짧은 입력 1,808개는 기존 처리와 같았다. v4 최종 코드는 Mac에서 전체 1,819개, Windows에서 긴 입력 11개와 최대 길이 부하를 다시 측정했다. 24,000자는 두 장비 모두 29번 실제 추론됐고 미처리 글자는 0개였다. 최종 제품 가림 대조에서도 긴 입력의 이름과 주소에 남은 원문 글자가 0개였다. 이는 고정 위치 진단의 결과이며 일반 정확도 승인이 아니다. 당시 최종 N2는 두 장비 모두 주소 미통과다. 수치, 자료 hash와 검수 판정은 [v4 검증 증거](../../artifacts/ccc237-privacy/windowing-v4/verification.json)와 [실행 기록](../../docs/superpowers/plans/2026-09-06-CCC-237-privacy-generalization.md#긴-입력-누락-수정과-windows-실측)에 있다.

**2026-09-06 BIOES 교정 후 상태:** [N2 7항목](../../artifacts/ccc237-privacy/install-health-v2-bioes-v1.json)은 인명 4개를 정확히 잡았지만 주소가 미통과다. [출시 601항목](../../artifacts/ccc237-privacy/release-qualification-v1-bioes-v1.json)도 FAIL이다. passing attestation/receipt를 발행하거나 등록하지 않았으며 실제 AI/STT를 활성화하지 않았다. 재현 명령과 남은 관문은 [CCC-237 실행 기록](../../docs/superpowers/plans/2026-09-06-CCC-237-privacy-generalization.md#bioes-교정과-동일-자료-재측정)에 있다.

### 마스킹 원칙 — 과마스킹을 감수한다 (2026-08-01 Q 결정)

기계는 두 방향으로 틀린다. 둘 다 줄일 수는 없어 **어느 쪽을 감수할지**를 정했다.

| 실수 | 결과 | 되돌릴 수 있나 |
| --- | --- | --- |
| **미탐**(이름인데 못 알아봄) | 실명이 사업자로 나간다 | `red` 없다 |
| **과탐**(이름 아닌데 가림) | 글이 읽기 나빠진다 | `yellow` 있다 |

**미탐보다 과탐을 택한다.** 구현에 두 군데 반영돼 있다:

- **정식 라벨은 고정**한다. 모델의 BIOES label 검증과 실제 exact-span health를 구분하며, label 이름이 맞는다는 이유만으로 모델 통과를 주장하지 않는다.
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
