# STT 엔진 확정과 어댑터 준비 스펙

- 상태: 준비 스펙 (2026-08-29 작성, 구현 착수 전. 결정 포인트는 Q 확인 후 확정)
- 관계: D53(ADR-0024), D64, D67(ADR-0035), D2·R3, D13

## 배경

현재 파이프라인은 안전장치와 엔진 선택 지점까지 구현되어 있으나, CLOVA Speech와 RTZR 어댑터는 아직 없다.

- `apps/pipeline/ccc_pipeline/transcribe.py:32-36`에는 `KNOWN_ENGINES = ("whisper",)`와 `Engine = Callable[[str], list[Segment]]` 별칭만 있다. `Engine`은 오디오 파일 경로를 받아 해당 파일 기준 상대 시각의 `Segment` 목록을 돌려주는 계약이다.
- `apps/pipeline/ccc_pipeline/transcribe.py:52-70`의 `build_engine`은 `whisper`만 등록하고, 다른 이름에는 `ValueError`를 낸다. `_build_whisper`는 `whisper`를 지연 import하고 `load_model(model_name)`을 호출한 뒤 `transcribe(language="ko")` 결과의 `start`, `end`, `text`를 `Segment`로 바꾼다.
- `apps/pipeline/ccc_pipeline/transcribe.py:73-115`는 모든 엔진에 무음 탐지와 청크 계획, 조각별 전사, 반복 검사, 결과 접기와 구조화 경고를 적용한다. `:118-151`의 `_transcribe_chunk`는 반복이 있으면 최소 길이를 확인해 반으로 한 번만 재시도하고, 더 나빠지면 원래 결과를 유지한다.
- `apps/pipeline/ccc_pipeline/config.py:168-172`는 `CCC_WHISPER_MODEL` 기본값 `medium`, `CCC_STT_ENGINE` 기본값 `whisper`, `CCC_STT_MAX_CHUNK_SECONDS`, `CCC_STT_MIN_CHUNK_SECONDS`, `CCC_STT_REPEAT_THRESHOLD`를 읽는다. `config.py:173-179`에서 `CCC_NER_MODEL_ID`가 없으면 `None`이 되며, `worker.py:37-40`의 기동 경로가 이를 거부한다.
- `apps/pipeline/ccc_pipeline/worker.py:27`은 `EMOTION_DEFERRED = True`로 감정 분석을 보류한다. `worker.py:52-161` 처리 순서는 오디오 다운로드 → 전사 → 화자 분리·역할 추정 → 보류된 감정 처리 → 2차 PII 마스킹 → 결과 전송이며, 마지막에 D13에 따라 작업 디렉터리를 삭제한다.
- `apps/pipeline/README.md:15-21`은 전사를 통짜로 처리하지 않고 무음 경계 청크와 반복 검사를 적용하며, 엔진 확정은 G1부터 G3까지 실측 후로 미룬다고 명시한다. `README.md:43-55`는 `requirements-ml.txt`, 시스템 ffmpeg, `HF_TOKEN`, `/etc/ccc-pipeline.env`, systemd 설정 절차를 설명한다.
- `docs/adr/0024-stt-guards-before-engine.md:9-19`는 엔진과 무관하게 무음 경계 분할, 반복 검사, 반쪽 1회 재시도와 경고를 유지하고, 엔진 확정은 처리 장비 앞 세션으로 남기도록 결정했다.
- `docs/adr/0035-contest-scope-and-deployment-doors.md:107-120`의 D67은 CLOVA와 RTZR을 같은 한국어 상담 녹음으로 비교하며, D53의 안전장치와 G1부터 G3 게이트를 유지한다고 정한다. Qwen3-ASR-1.7B는 파일럿 밖 후보로 남는다.
- `docs/api-contract-pipeline.md:70-107`은 처리 장비가 전사와 2차 마스킹을 끝낸 뒤 `POST /pipeline/jobs/:id/result`로 구조화된 결과를 보내도록 한다. `transcriptWarnings`에는 시간 구간과 짧은 사유 코드만 넣고 전사 내용은 넣지 않는다. 오디오 원본은 처리 장비에 내려받은 뒤 외부 저장소에 직접 쓰지 않는다.
- `apps/pipeline/systemd/ccc-pipeline.service:20-32`는 전용 계정 `ccc-pipeline`, `/etc/ccc-pipeline.env`, `/opt/ccc/apps/pipeline`, `/usr/bin/python3 -m ccc_pipeline`, journald 출력을 사용한다. `:22`의 계정명은 Part B에서 확정할 TODO다.
- `apps/pipeline/requirements-ml.txt:1-15`에는 `openai-whisper`, `pyannote.audio`, `transformers`, `librosa`가 있고 torch는 CUDA 환경에 맞춰 별도 설치하도록 고정하지 않았다.
- `CLAUDE.md:65-70`의 R3는 처리 장비의 2차 NER 마스킹 뒤에만 사업자로 텍스트를 보내도록 한다. D2의 2단 방어와 D13의 처리 장비 경계를 따른다. 클라우드 STT를 선택하면 마스킹 전 원본 음성이 외부 사업자에 전달되는 별도 위험이 생긴다.

## 어댑터 계약과 공통 동작

### 계약 경계

`Engine = Callable[[str], list[Segment]]`를 유지한다. `Protocol` 확장은 하지 않는다. 현재 `transcribe_audio`가 엔진을 호출하기 전후의 청크 분할, 시각 보정, 반복 검사, 경고 생성을 이미 담당하므로 새 엔진에는 파일 경로를 받고 세그먼트만 변환하는 좁은 경계가 필요하다. 계약을 넓히면 청크 오케스트레이션이 엔진마다 복제되고 D53의 공통 안전장치가 빠질 수 있다.

새 엔진은 다음 두 곳에 등록한다.

1. `KNOWN_ENGINES`에 안정적인 이름을 추가한다.
2. `build_engine(name, model_name)`에 이름별 생성 분기를 추가한다. 알 수 없는 이름은 현재처럼 즉시 `ValueError`를 내며 Whisper로 조용히 폴백하지 않는다.

외부 어댑터 내부에서 비동기 API의 제출과 상태 조회를 동기 callable 안에서 완료한다. 상태 조회가 설정된 제한 시간을 넘기면 실패로 반환하고, 작업 ID와 원문은 로그에 쓰지 않는다. 파이프라인 작업의 비동기 큐로 구조를 바꾸는 일은 이 준비 스펙의 범위가 아니다.

### 엔진별 설정 변수 계약

아래는 구현에서 사용할 환경 변수 이름이다. 값은 `/etc/ccc-pipeline.env` 또는 Infisical 주입으로만 제공하며 문서, 코드, 로그에 시크릿 값을 쓰지 않는다.

| 엔진 | 변수 이름 | 용도 |
| --- | --- | --- |
| CLOVA | `CCC_CLOVA_ENDPOINT` | CLOVA Speech 도메인의 API Gateway InvokeURL |
| CLOVA | `CCC_CLOVA_API_KEY` | CLOVA Speech 애플리케이션 인증 자격 증명 이름 |
| CLOVA | `CCC_CLOVA_TIMEOUT_SECONDS` | 한 청크의 동기 응답 또는 비동기 완료를 기다리는 상한 |
| CLOVA | `CCC_CLOVA_COMPLETION` | `sync` 또는 `async` 선택. 운영 기본값은 Q 확인 대상 |
| RTZR | `CCC_RTZR_ENDPOINT` | RTZR API 기본 endpoint |
| RTZR | `CCC_RTZR_CLIENT_ID` | RTZR 인증용 client ID |
| RTZR | `CCC_RTZR_CLIENT_SECRET` | RTZR 인증용 client secret |
| RTZR | `CCC_RTZR_TIMEOUT_SECONDS` | 제출부터 결과 수신까지의 상한 |
| RTZR | `CCC_RTZR_POLL_INTERVAL_SECONDS` | 비동기 결과 조회 간격 |
| RTZR | `CCC_RTZR_POLL_TIMEOUT_SECONDS` | 결과 조회를 계속할 별도 상한 |
| RTZR | `CCC_RTZR_MODEL` | RTZR Batch 인식 모델 이름 |

운영 환경은 필수 자격 증명이 빠지면 엔진을 만들지 않는다. 자격 증명 누락, endpoint 누락, 잘못된 시간 제한은 `config` 실패로 분류하며 시크릿 값은 오류 메시지에 포함하지 않는다.

### Segment 정규화

어댑터는 응답을 받은 즉시 다음 규칙으로 정규화한다.

- 공통: `start`와 `end`는 초 단위 실수, `0 <= start < end`, `text`는 문자열이어야 한다. 필수 필드가 없거나 시간 범위가 깨진 세그먼트는 임의 보정하지 않고 `malformed_response`로 실패시킨다. 빈 텍스트는 결과에서 제외하되, 모든 세그먼트가 비면 성공한 빈 전사인지 응답 오류인지 provider 응답 상태와 함께 판정한다.
- CLOVA: 응답 `segments[].start`, `segments[].end`의 밀리초를 1,000으로 나눈다. `segments[].text`를 `text`로 사용하고 `diarization.label` 또는 `speaker.label`이 있으면 문자열 `speaker`로 보존한다. 세그먼트가 이미 청크 파일 기준이므로 전체 파일 offset은 `transcribe.py`가 한 번만 더한다.
- RTZR: `results.utterances[].start_at`과 `duration`의 밀리초를 각각 1,000으로 나누며 `end = start_at / 1000 + duration / 1000`으로 계산한다. `msg`를 `text`로 사용하고 `spk`가 있으면 문자열 `speaker`로 보존한다.
- 두 어댑터 모두 시작 시각 오름차순으로 정렬하고 원문 텍스트를 임의 요약·마스킹·재작성하지 않는다. 중복, 겹침과 반복은 상위 `transcribe_audio`의 반복 검사와 `speaker_mapping`이 처리한다.

### 실패 분류와 재시도 초안

실패 코드는 로그와 테스트에서 내용 없이 분류값으로만 다룬다.

| 분류 | 예시 | 초안 동작 |
| --- | --- | --- |
| `config` | 필수 환경 변수 누락, 잘못된 timeout | 즉시 실패, 재시도하지 않음 |
| `auth` | 인증 실패, 권한 없음 | 즉시 실패, 관리자 설정과 자격 증명 상태 확인 |
| `request` | 파일 형식·길이·파라미터 오류 | 즉시 실패, 입력과 provider 제한 확인 |
| `rate_limited` | 429 또는 동시성 초과 | Q 승인 전에는 즉시 실패. 승인 시 제한된 지수 백오프 1회만 추가 |
| `provider_unavailable` | 네트워크, timeout, 5xx | Q 승인 전에는 즉시 실패. 승인 시 제한된 지수 백오프 1회만 추가 |
| `malformed_response` | 필수 필드 누락, 잘못된 시간 단위 | 즉시 실패, 응답 본문을 로그에 남기지 않음 |

D53의 반복 검출 뒤 반쪽 1회 재시도는 이 표와 별개의 상위 오케스트레이션 계약이다. 외부 provider의 429·5xx 자동 재시도와 비용 상한은 결정 포인트에서 확정한다. 어떤 분류에서도 다른 엔진으로 자동 전환하지 않는다.

## CLOVA Speech와 RTZR API 사실 조사

아래는 2026-08-29에 확인한 공식 문서 기준이다. 문서에 없는 보관 기간이나 삭제 기능은 미확정으로 표시하며, 계약서나 공식 지원 답변을 받기 전 사실로 확정하지 않는다.

| 항목 | CLOVA Speech | RTZR Batch STT |
| --- | --- | --- |
| endpoint와 방식 | 로컬 파일은 `POST /recognizer/upload`, Object Storage 파일은 `POST /recognizer/object-storage`이며 도메인 생성 시 발급되는 API Gateway InvokeURL을 사용한다. `completion`은 `sync` 또는 `async`이며 async는 callback 또는 Object Storage 결과 저장을 요구한다. [공식 개요](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech), [로컬 파일 API](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-longsentence-local), [Object Storage 파일 API](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-longsentence) | 기본 endpoint는 `https://openapi.vito.ai`이며 파일 전사는 `POST /v1/transcribe` 제출 후 `GET /v1/transcribe/{TRANSCRIBE_ID}`로 상태와 결과를 조회하는 비동기 방식이다. 스트리밍은 별도 gRPC 또는 WebSocket 방식이다. [Batch STT 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/), [FAQ](https://developers.rtzr.ai/docs/en/faq/), [Streaming 공식 문서](https://developers.rtzr.ai/docs/en/stt-streaming/) |
| 인증 | CLOVA Speech 애플리케이션의 인증 자격 증명을 요청 헤더로 보낸다. 실제 자격 증명 값은 `CCC_CLOVA_API_KEY`가 가리키는 시크릿으로만 주입한다. | `client_id`와 `client_secret`로 `/v1/authenticate`에서 JWT를 발급하고, 후속 요청에 인증 토큰을 사용한다. 토큰 만료는 6시간이며 주기적으로 갱신해야 한다. 자격 증명 값은 `CCC_RTZR_CLIENT_ID`, `CCC_RTZR_CLIENT_SECRET` 이름으로만 관리한다. [인증 공식 문서](https://developers.rtzr.ai/docs/en/authentications/) |
| 장시간 오디오 한도 | 장문 인식은 최대 2시간(sync), 최대 6시간(async)이며 파일 크기는 최대 2GB다. 단문 인식은 최대 60초, 최대 10MB다. [사양·요금 공식 문서](https://guide.ncloud-docs.com/docs/clovaspeech-spec) | 파일 크기 최대 2GB, 길이 최대 4시간이다. 긴 파일이나 혼잡한 시간에는 시작 지연이 30분 이상일 수 있다. [Batch STT 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/) |
| 화자 분리 | 장문 인식 요청의 `diarization.enable`을 켜며 결과 세그먼트에 화자 label을 받을 수 있다. [로컬 파일 API](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-longsentence-local) | Batch 요청의 `use_diarization`과 `diarization.spk_count`를 지원하며 결과 utterance의 `spk`를 받는다. 다채널 입력에서는 채널 ID가 사용되고 화자 분리는 비활성화된다. [화자 분리 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/diarization/), [Batch STT 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/), [다채널 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/multi-channel/) |
| 음성·결과 보관과 삭제 요청 | 공식 API 문서는 입력 파일과 async 결과를 고객 Object Storage 경로와 연결한다고 설명하지만 provider 내부의 보관 기간, 처리 후 삭제 시점, 서비스 API를 통한 즉시 삭제 요청은 명시하지 않는다. **미확인, 계약과 공식 지원 답변 출처 필요.** 구현 전 원본과 결과의 Object Storage 삭제 절차, provider 측 잔여 사본 삭제 요청 경로와 처리 증적을 확인한다. [Object Storage 파일 API](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-longsentence), [CLOVA Speech 사용 준비](https://guide.ncloud-docs.com/docs/clovaspeech-spec) | 공식 Batch API는 만료 결과에 `410 H0007 Result expired`를 정의하지만 정확한 보관 기간, 원본 음성의 provider 저장 기간, 사용자 즉시 삭제 endpoint는 Batch 문서에 없다. **미확인, 계약과 공식 지원 답변 출처 필요.** 구현 전 만료 시점, 삭제 요청 가능 여부, 삭제 완료 증적을 확인한다. [Batch STT 공식 문서](https://developers.rtzr.ai/docs/en/stt-file/), [FAQ](https://developers.rtzr.ai/docs/en/faq/) |
| 요금 | 공식 사양 문서는 음성 인식 사용 시간에 따른 과금과 포털 요금 안내를 연결하지만 현재 문서에 고정 단가 표가 없다. **정확한 단가와 무료 등급 여부는 미확인, 최신 포털·계약 출처 필요.** [CLOVA Speech 사양·요금](https://guide.ncloud-docs.com/docs/clovaspeech-spec), [공식 상품 페이지](https://www.ncloud.com/product/aiService/clovaSpeech) | VAT 별도, 월 사용 시간에 따른 누진 단가: 0부터 1,000시간까지 시간당 1,000원, 1,000 초과부터 10,000시간까지 500원, 10,000 초과부터 25,000시간까지 400원, 그 초과 300원이다. 파일·스트리밍의 최소 과금 단위는 10초이며 가입 시 600분 무료 쿼터가 한 번 제공된다. [요금 공식 문서](https://developers.rtzr.ai/docs/en/pricing/) |

이 조사 결과만으로 provider의 법적 수탁자 지위, 국외 이전, 학습 사용 여부와 보관 SLA를 판단하지 않는다. D67 비교표에는 문서 확인 여부와 계약 증적 링크를 함께 기록한다.

## 청크 경계와 처리 순서

외부 엔진도 반드시 `transcribe_audio`를 경유한다. CLOVA가 최대 2시간, RTZR이 최대 4시간을 받더라도 provider의 장시간 한도는 D53의 품질 안전장치를 대체하지 않는다.

1. `detect_silences`와 `plan_chunks`가 기본 최대 180초, 최소 30초 경계를 만든다.
2. 각 청크 파일만 엔진에 넘긴다. `_run_engine`이 청크 결과의 상대 시각을 전체 파일 기준으로 보정한다.
3. 청크별 반복 검사를 하고, 반복이면 반으로 나누어 한 번만 재시도한다.
4. 반복이 남으면 내용을 지우지 않고 시간 구간과 `repetition` 사유를 구조화 경고로 남긴다.
5. 이후 화자 분리, 역할 추정, 감정 보류, 2차 NER 마스킹, Workers API 전송 순서를 유지한다.

이 순서는 `docs/adr/0024-stt-guards-before-engine.md:9-19`의 엔진 독립 필수 규칙과 `apps/pipeline/ccc_pipeline/transcribe.py:73-115`의 현재 구현에 근거한다. provider가 반환하는 원문을 로그나 API 결과에 그대로 싣지 않으며, R3에 따라 텍스트 사업자에게는 마스킹 스냅샷만 보낸다.

## 개인정보 긴장과 법률 경계

CLOVA와 RTZR 어댑터는 2차 NER 마스킹 전의 원본 음성 청크를 외부 사업자에 전송한다. 이는 D2·R3의 현재 전제인 처리 장비 내 전사와 마스킹, 마스킹 후 외부 텍스트 전송과 다르다. D67은 보관 조건 비교를 요구하지만 이 스펙은 그 긴장을 해소하지 않는다.

다음 항목은 Q 확인과 법률 검토가 끝나기 전까지 결정하지 않는다.

- 외부 STT 처리를 녹음 동의 문안에 어떤 범위와 provider 이름으로 반영할지
- 외부 처리 위탁, 재위탁, 국외 이전, 학습 사용 여부와 기관별 고지 책임
- provider별 보관 기간, 삭제 요청 및 삭제 완료 증적을 계약에 넣을지
- 원본 음성 외부 전송을 금지하고 Whisper만 운영할지, 또는 CLOVA·RTZR 중 하나를 예외 경로로 승인할지
- 외부 provider 오류와 처리 중단 시 수기 메모 폴백을 어떻게 안내할지

## G1부터 G3까지 비교 실험 설계

### 입력셋과 세션 조건

- 입력은 가상 대화 샘플 또는 별도 서면 동의를 받은 샘플만 사용한다. 실제 당사자 자료와 운영 녹음은 사용하지 않는다.
- 동일한 WAV 원본과 동일한 청크 계획을 Whisper 현행 대조군, CLOVA, RTZR에 차례로 넣는다. 각 실행에는 입력셋 버전, 엔진 버전, 설정 해시, 장비 식별자와 실행 시각만 기록한다.
- 입력셋은 10개 이상 대화로 구성하고, 조용한 2인 대화, 겹침 발화, 숫자·날짜·고유명사, 짧은 응답, 3분보다 긴 무음 구간을 포함한다. 예시 값은 합성값으로 만들고 실명·연락처·계좌는 넣지 않는다.
- G1부터 G3까지 동일한 처리 장비 앞 세션에서 실행한다. 장비 설치 상태, ffmpeg, CUDA 사용 여부, 외부 API 자격 증명 주입 상태를 세션 시작 전에 기록하되 시크릿 값은 기록하지 않는다.

### 측정 항목과 계산

| 항목 | 계산·기록 방법 |
| --- | --- |
| CER | 사람이 만든 합성 정답과 정규화한 예측 텍스트의 문자 편집 거리 ÷ 정답 문자 수. 입력셋별·엔진별 평균, 중앙값, p95를 기록한다. |
| 반복률 | 반복 검사로 표시된 경고 시간의 합 ÷ 전체 오디오 시간. 반복 횟수와 경고 청크 수도 함께 기록한다. |
| 화자 구분 | 정답 화자 구간과 provider `speaker` 또는 `spk`를 시간 정렬해 diarization error rate와 화자 ID 일치율을 기록한다. 화자 정보가 없는 응답은 미지원으로 기록하고 0점으로 임의 환산하지 않는다. |
| 속도 | 실제 처리 경과 시간 ÷ 오디오 길이인 RTF를 엔진·청크별로 기록한다. 외부 async 대기 시간과 로컬 추출 시간을 분리한다. |
| 비용 | provider는 실제 청구 단위와 가격표 버전으로 오디오 시간당 비용을 계산한다. Whisper는 처리 장비의 실행 시간과 승인된 장비 비용 산정식을 별도 표기한다. 무료 쿼터를 일반 운영 단가로 간주하지 않는다. |
| 안전성 | 원문이 로그·오류·결과 메타데이터에 남지 않았는지, 청크·중간 파일이 작업 종료 후 삭제됐는지, 인증 오류에서 fail-closed 했는지를 확인한다. |

### 평가표 양식과 합격선 제안

| 게이트 | 대상 | 합격선 제안 | 증적 |
| --- | --- | --- | --- |
| G1 | Whisper, CLOVA, RTZR | 같은 처리 장비에서 각 엔진 3회 연속 실행, 설치·인증·정리 실패 0건, 실패 시 fail-closed | 세션 기록, 설정 변수 이름, 종료 로그의 건수·시간만 포함한 요약 |
| G2 | 각 엔진과 동일 입력셋 | CER 중앙값 15% 이하, 반복률 1% 이하, RTF 1.0 이하를 제안값으로 둔다. 화자 구분은 정답 화자 자료가 있는 경우 DER 20% 이하를 별도 제안한다. | 입력셋 버전, 정답·예측의 접근 통제된 비교 산출물, 측정표 |
| G3 | Whisper 대 CLOVA 대 RTZR | CER·반복률·화자 구분·속도·비용의 다섯 항목을 모두 기록하고, 기준선 대비 개선 또는 승인된 비용 상한을 만족하는 엔진만 후보로 남긴다. 최종 선택은 Q가 한다. | 엔진별 비교표, 보관·삭제 계약 확인, Q 결정 기록 |

합격선은 제안일 뿐이며 공개 수치나 이 문서만으로 확정하지 않는다. 상담체 입력셋의 결과와 비용, 보관 조건을 함께 본 뒤 Q가 엔진과 운영 모드를 확정한다.

## 장비 설치 스펙

1. `apps/pipeline/requirements-ml.txt`를 처리 장비 전용 가상환경에 설치한다. `openai-whisper`, `pyannote.audio`, `transformers`, `librosa` 버전을 설치 기록에 남긴다.
2. 시스템에 ffmpeg를 설치하고 `ffmpeg` 실행 파일이 서비스 계정의 PATH에서 확인되게 한다. 무음 경계 분할을 통짜 전사로 폴백하지 않도록 기동 전 점검에서 누락을 거부한다.
3. 장비 CUDA와 호환되는 torch 빌드를 PyTorch 공식 설치 지침에 따라 별도로 설치한다. requirements 파일에 임의의 CUDA 버전을 고정하지 않는다. [PyTorch 설치 지침](https://pytorch.org/get-started/locally/)
4. pyannote 게이트 모델 사용 승인을 Hugging Face 계정에서 확인하고 `HF_TOKEN`을 시크릿 주입한다. 토큰 값과 모델 접근 URL의 인증 정보는 로그에 남기지 않는다.
5. `/etc/ccc-pipeline.env`를 root 소유, 권한 600으로 만들고 Infisical에서 필요한 환경 변수를 주입한다. 운영에는 `CCC_PIPELINE_CLIENT_ID`, `CCC_PIPELINE_CLIENT_SECRET`을 사용하고, preview에는 `CCC_PREVIEW_E2E_ACCESS_CODE`를 사용한다. `CCC_RUNTIME_ENVIRONMENT`에 맞지 않는 인증 변수를 함께 넣지 않는다.
6. `apps/pipeline/systemd/ccc-pipeline.service:20-32`를 설치하고 `User=ccc-pipeline`, `EnvironmentFile=/etc/ccc-pipeline.env`, `WorkingDirectory=/opt/ccc/apps/pipeline`, `ExecStart=/usr/bin/python3 -m ccc_pipeline`을 확인한다. 전용 계정 이름은 기존 설정을 기준으로 하되, Part B에서 기관 운영 계정으로 최종 확정한다.
7. 첫 실행 전 `CCC_NER_MODEL_ID`가 설정되어 있고, `CCC_STT_ENGINE`이 `whisper`, `clova` 또는 `rtzr` 중 등록된 값인지 확인한다. 인명 NER가 없으면 처리하지 않는 R3 기동 게이트를 유지한다.

## 결정 포인트 (Q 확인 대상)

1. `CCC_CLOVA_COMPLETION`을 `sync`로 고정할지, callback 또는 Object Storage를 사용하는 `async`로 고정할지 결정한다.
2. CLOVA와 RTZR의 429·5xx에 제한된 백오프 1회를 허용할지, 현재처럼 외부 호출 자동 재시도 없이 fail-closed 할지 결정한다. 허용할 경우 월별 비용·동시성 상한과 함께 승인한다.
3. CLOVA와 RTZR의 provider 보관 기간, 원본 삭제 시점, 사용자 삭제 요청 방법과 완료 증적을 계약 또는 공식 답변으로 확인한다. 확인 전에는 외부 provider를 운영 엔진으로 확정하지 않는다.
4. 원본 음성의 외부 처리에 맞춰 녹음 동의 문안을 갱신할지, 외부 처리 위탁과 재위탁·국외 이전 검토를 어떤 기관 책임자가 승인할지 결정한다. 이 항목은 D2·R3의 개인정보 전제를 바꾸므로 이 스펙에서 해소하지 않는다.
5. CLOVA와 RTZR의 최신 요금·무료 등급·기업 계약 조건을 확인하고, D66의 공식 기업용 API와 무료 등급 금지 규칙에 맞는 비용 상한을 결정한다.
6. G1부터 G3의 합격선 제안값인 CER 15%, 반복률 1%, RTF 1.0, diarization error rate 20%를 채택할지, 상담체 입력셋의 사전 결과를 보고 조정할지 결정한다.
7. 화자 분리 결과를 provider의 label 그대로 사용할지, 현재 pyannote와 동일한 역할 추정·수동 확인 절차를 거칠지 결정한다.
8. 운영 systemd 전용 계정 이름과 장비의 CUDA·GPU 조합을 확정한다.
9. 최종 엔진을 CLOVA, RTZR, Whisper 중 무엇으로 할지 G3 결과와 보관·법률 확인 뒤 결정한다. Qwen3-ASR-1.7B는 D67에 따라 비교 밖 후보로 유지한다.

## 구현 단계 분할

### (a) 어댑터 2종 구현과 계약 테스트

- `clova`와 `rtzr`을 등록소에 추가하고, 엔진 callable 시그니처를 유지한다.
- CLOVA와 RTZR 응답의 밀리초 시각, 텍스트, 화자 label을 `Segment`로 정규화한다.
- config·인증·요청·rate limit·provider 오류·malformed response를 분류하고 시크릿 비노출을 확인한다.
- 계약 테스트는 가상 provider 응답으로 정상 정규화, 잘못된 필드 fail-closed, 청크 offset 1회 적용, 미등록 엔진 거부를 검증한다. 실데이터와 실제 자격 증명은 테스트에 사용하지 않는다.

완료 기준: Whisper를 포함한 등록 엔진 이름이 명시되고, 두 어댑터의 가상 응답 계약 테스트가 통과하며, `transcribe_audio`의 반복 검사·반쪽 1회 재시도·경고 필드가 엔진 교체 전후에 동일하게 관찰된다.

### (b) 장비 셋업

- requirements ML 의존성, 시스템 ffmpeg, CUDA 대응 torch, pyannote 게이트 승인과 HF 토큰 주입을 처리 장비에 적용한다.
- `/etc/ccc-pipeline.env`의 권한, Infisical 주입, preview·운영 인증 변수 분리를 확인한다.
- systemd 전용 계정과 working directory로 한 번 기동해 환경 점검과 작업 디렉터리 삭제를 확인한다.

완료 기준: 처리 장비 앞에서 가상 오디오 작업 1건이 시작되고, 오디오 다운로드·청크 처리·결과 전송 뒤 작업 디렉터리가 삭제된다. 로그에는 전사·PII·시크릿 값이 없고 건수·시간·상태만 남는다.

### (c) 비교 세션과 엔진 확정(Q 결정)

- 같은 입력셋과 같은 청크 설정으로 Whisper 대조군, CLOVA, RTZR을 G1부터 G3 순서로 실행한다.
- CER, 반복률, 화자 구분, RTF, 비용, 보관·삭제 조건과 오류 동작을 평가표에 채운다.
- Q가 결정 포인트를 확인하고 최종 엔진과 completion·polling·재시도 정책을 확정한다.

완료 기준: 처리 장비 앞 세션 증적과 엔진별 비교표가 있고, 합격선·비용 상한·보관·삭제 확인 결과가 Q 결정 기록으로 남는다. 결정 전에는 운영 기본 엔진을 바꾸지 않는다.

### (d) 확정 엔진 운영 설정

- Q가 확정한 엔진의 변수만 운영 secret 주입 목록과 배포 문서에 넣고, 미선택 provider 자격 증명은 주입하지 않는다.
- 확정 엔진의 endpoint, 모델, timeout, completion·polling, 비용 상한과 장애 시 수기 메모 폴백을 설정한다.
- 동의 문안과 외부 처리 위탁 검토가 완료되지 않았다면 운영 전환을 차단하고 preview·가상 데이터에서만 유지한다.

완료 기준: 운영 환경에서 선택된 엔진 설정이 누락·오타에 fail-closed하고, 승인된 가상 smoke 세션이 전사부터 마스킹·결과 전송·중간 파일 삭제까지 완료된다. 운영 전환 여부와 미해결 법률 항목이 배포 기록에 명시된다.
