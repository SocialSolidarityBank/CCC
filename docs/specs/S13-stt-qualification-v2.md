# S13: STT 자격 검증 v2

- 상태: **구현 계약 확정, 품질·장비 측정은 후속** (2026-09-08)
- 상위 정책: [ADR-0041 D77](../adr/0041-one-core-three-deployment-modes.md#d77-저장-모드와-ai-모드는-독립이고-stt-설치-기본값은-off다)
- 재사용 지표: [S13 v1 §2](./S13-pilot-metrics.md#2-인터페이스와-규칙)
- 관련 티켓: E5-2/CCC-231, E5-3/CCC-236, E5-8a/CCC-243, E5-8/CCC-250

## 1. 범위와 세 단계

이 문서는 음성 전사 STT를 세 단계로 나눈다. 첫째, Local Qwen과 Azure Speech의 실제 어댑터, 기능, 오류, 개인정보 계약을 구현한다. 둘째, 사람 모의상담 품질과 실제 장비 성능을 측정한다. 셋째, 증거와 Q 승인으로 제품의 signed registry와 기관 선택지를 활성화한다. 요약 LLM, OpenAI `store:false`, 저장 모드, E11 감지 정확도·사용성·임팩트 규칙은 바꾸지 않는다.

구현 단계에서는 합성 입력이나 운영자가 직접 소유한 비민감 자기 목소리 녹음을 사용할 수 있다. 자기 목소리 선언은 제3자 음성이나 실제 당사자 자료의 이용 권한을 만들지 않으며, 제품 동의, NER, S5 attempt·receipt, signed registry 또는 실데이터 게이트를 면제하지 않는다. 실제 참가자와 제3자 오디오는 각각 필요한 이용·외부 전송 허락 없이는 사용하지 않는다.

사람 녹음, 독립 정답표, 참가자 허락, v2 품질 executor, 실제 장비 측정, Azure 기관 자격 검토는 후속 단계로 남는다. 문서 승인이나 어댑터 구현만으로 Local 또는 Azure가 품질 통과·지원·채택·활성화된 것으로 보지 않는다. 기본 `sttMode=off`, 승인 전 `sttEngine=null`, signed registry의 exact `{id, mode}`, health check, 경로별 동의, Q 승인과 provider 간 무자동전환을 유지한다. 조건을 충족하지 못하거나 관리자가 명시적으로 선택하지 않은 기관에는 STT off와 수기 기록을 제공한다. 수기 기록은 즉시 공식 기록이며, 별도 허가를 받은 텍스트 AI까지 자동으로 끄지는 않는다.

[S13 v1](./S13-pilot-metrics.md)의 합성 150-session fixture, 계산식, threshold, Windows CPU 실행 기록과 과거 PASS/FAIL/미측정 상태는 그대로 보존한다. 이 v2를 과거 결과에 소급 적용하거나 과거 FAIL을 PASS로 바꾸지 않는다. 기존 eSpeak 합성 fixture와 합성 5건 감사 자료는 역사·개발 회귀 증거로만 쓰고 새 사람 녹음 결과와 합산하지 않는다.

## 2. 기존 역사·회귀 증거 보존

### 2.1 보존할 기존 증거

| 증거 | 보존 상태와 해석 |
|---|---|
| Windows 작업 루트 | `C:\ProgramData\CCC\benchmarks\e5-8` |
| 고정 소스 커밋 | `3eb64d8d86e255163c9dd794d218661af2149d95` |
| 공식 실행 | `C:\ProgramData\CCC\benchmarks\e5-8\repo\artifacts\pilot\results\e5-8-windows-cpu-001`. 화자 분리 150건, faster-whisper 150건, Qwen 5건 처리 뒤 중지한 미완료 실행이다. 중간 `stt-metrics.json`에 Qwen aggregate가 없다는 사실을 Qwen 처리 0건으로 해석하지 않는다. |
| 진단 A/B/C | `C:\ProgramData\CCC\benchmarks\e5-8\diagnostics\chunk-ceiling-001\arm-A.json`: Whisper 30초·4스레드·5건, `arm-B.json`: Whisper 180초·8스레드·5건, `arm-C.json`: Qwen 30초·4스레드·2건. 짧은 Qwen 진단의 반복률·RTF 개선 관측을 2건보다 넓은 채택 근거로 확장하지 않는다. |
| 실패한 추가 진단 | `C:\ProgramData\CCC\benchmarks\e5-8\diagnostics\minimum-pc-001`. 실패 기록으로 보존하며, 적재 포함 경과시간이나 자원 제한 실험으로 CPU 최소사양 또는 엔진 RTF 하한을 확정하지 않는다. |
| 기존 청취 자료 | `/Users/seongqkim/Downloads/CCC-STT-fixture-audit-001.zip`과 `/Users/seongqkim/.local/state/ccc-e5-8-watch/fixture-audit-001`. 원본 WAV/TXT/대본/정답과 ZIP은 수정하지 않는다. |
| 기존 검수 상태 | `audit.json`은 `humanReview=PENDING`, `independentSTT=BLOCKED_ACCESS`다. `청취검수.csv` 5행은 모두 `미완료`, `UNSURE`다. eSpeak NG `1.52.0`, `ko+m3`/`ko+f3`, 22,050Hz mono 16-bit와 hash 일치는 기계적 일치만 증명하며, 사람 청취 품질이나 실제 상담 대표성을 증명하지 않는다. |
| 감시용 브랜치 ref | 사용자 인계상 `e5-8-benchmark-watch`는 ref만 있고 전용 worktree와 commit은 없다. branch ref를 작업 폴더나 코드 보존 증거로 취급하지 않는다. |

메모리 병목, temperature fallback, 어텐션 비용은 원인 가설로만 남긴다. 원인을 분리해 확인하지 않은 상태에서 입증된 사실로 보고하지 않는다. `chunk-probe-001.cmd`는 각 arm의 실패와 무관하게 마지막 `exit.json`에 0을 쓸 수 있으므로 `NORMAL_EXIT`와 종료 코드 0은 완료 또는 품질 PASS가 아니다. 각 arm의 `rows`, `errorType`, 실제 측정 수와 지표를 직접 판정하며 과거 종료 파일은 고치지 않는다.

### 2.2 합성 픽스처 5건의 역사·회귀 해석

기존 `fixture-audit-001`의 WAV 5건과 사람 청취 양식, 독립 STT 상태는 원본 그대로 보존한다. 사람 검수자가 나중에 감사를 이어가면 WAV 청취, TXT·기존 정답 대조, 허가된 파일당 1회 독립 전사와 차이 해석을 별도 run으로 기록한다. 원음과 전사 전문은 제한된 검수 공간 밖으로 내보내지 않는다.

`청취검수.csv` 5행의 `청취 완료=미완료`, 판정 `UNSURE`, `independentSTT=BLOCKED_ACCESS`는 그대로 미완료 증거다. 이를 PASS로 바꾸거나 합성 품질을 실제 상담 대표성으로 확대하지 않는다. 이 미완료 청취와 막힌 독립 STT 상태는 현재 어댑터 구현, 기능·오류·개인정보 계약 시험 또는 운영자 본인의 비민감 Local 시험의 선행조건이 아니다. 품질 단계도 §4의 새 사람 모의상담과 독립 정답을 기준으로 하며, 과거 5건은 회귀 비교에만 쓴다.

### 2.3 observer와 원격 작업 경계

2026-09-07T09:06:58Z 읽기 전용 관측에서 Windows 예약 작업 `CCC-E5-8-Benchmark`, `CCC-E5-8-ChunkProbe`는 `Ready`였고 `python`/`pythonw` 프로세스는 0개였다. Mac `ccc-e5-8-hourly-observer`는 `ready`, `persist=true`, `restart=no`, `pty=false`, `detached=false`였다. 이는 해당 시각의 관측일 뿐이며 새 실행 직전에 다시 확인한다. 예약 작업의 `Ready`는 품질 PASS가 아니다.

기존 observer의 코드는 `~/.local/state/ccc-e5-8-watch/hourly_observer.py`, 공용 조회는 같은 폴더의 `watch.py`, 로그는 `hourly.log`다. `watch.py --probe-once`는 로컬 로그를 쓰므로 읽기 전용 인수 명령으로 실행하지 않는다. `INTERVAL=3600`이며 기존 공식 실행과 `CCC-E5-8-ChunkProbe`만 감시한다. 새 run을 자동 발견하거나 실행하지 않고, 한 회차 뒤 3,600초 쉬므로 정확한 벽시계 정각 감시를 약속하지 않는다. 실행 중이면 재사용하고 중복 watcher를 만들지 않는다. 종료 상태라면 실행 권한을 복구한 뒤 원래 이름과 실행 spec, `persist=true`, `restart=no`로 재시작하고 첫 실제 조회 성공을 확인한다. 별도 감시 대화 종료와 observer 프로세스 종료를 구분한다. observer가 동작하지 않은 시간을 소급해 감시됐다고 보고하지 않으며 Mac 절전·종료 중 관찰을 보장하지 않는다.

새 실험 직전에는 `CCC-E5-8-*` 예약 작업과 관련 추론 프로세스를 좁게 조회한다. 다른 고부하 작업이 있으면 새 실행을 미루고 기존 작업을 임의 종료하지 않는다. 고부하 작업과 watcher가 서로 다른 프로세스임을 확인한다. 새 run은 정확한 작업 이름·진행·종료·결과 경로를 observer의 기존 target에 명시적으로 연결한 뒤에만 감시된다고 말할 수 있다. watcher 변경은 실험 시작이나 재시작을 유발해서는 안 되며 기존 두 target과 로그를 보존한다.

## 3. 구현 우선 계약

### 3.1 Local

현재 Local 경로는 격리된 Python 환경에서 `Qwen/Qwen3-ASR-1.7B`와 `Qwen/Qwen3-ForcedAligner-0.6B`의 원본 checkpoint를 로컬 공개 가중치로 실행한다. 제품 NER 환경의 패키지를 바꾸지 않고, 고정 revision과 hash를 확인한 로컬 snapshot만 연다. 이는 취소된 Alibaba Cloud Token Plan을 호출하는 경로가 아니며, 세계 최고나 모든 환경에서 가장 최신인 모델이라는 주장이 아니다.

D53의 무음 경계 청크 분할, 원본 기준 시각 보정, 반복 검사와 제한된 조각 재시도는 Local에 적용한다. 한 파일의 모든 조각 동안 같은 Qwen child를 재사용하고 명시적으로 닫는다. transcript나 원문 오류를 stdout에 쓰지 않으며 오류는 제한된 code와 안전한 메타데이터로만 남긴다.

### 3.2 Azure

Azure는 `https://koreacentral.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`와 `ko-KR`을 고정한다. multipart definition에 `diarization.enabled=true`, `maxSpeakers=2`를 넣고 익명의 파일별 `speaker` ID를 보존하며 pyannote 라벨로 덮어쓰지 않는다. 어댑터는 허가된 attempt마다 원본 파일의 HTTP send를 최대 한 번 시작하고 자동 client 재시도를 하지 않는다. 요청이 provider에 도달한 뒤의 내부 처리를 exactly-once라고 보장하지 않는다. 청크별 업로드, `audioUrl`, redirect와 다른 provider·region 전환은 없다. D53의 무음 청크 분할은 Azure 전송에 적용하지 않고, 반복·출력 검사는 응답 뒤 Local과 동일하게 적용한다.

외부 요청 직전 S5의 `before_send` 경계에서 현재 org, job, claim token hash, attempt, 원음 SHA-256, 동의 revision과 provider가 일치하는지 확인하고 durable marker와 `authorized → in_flight` 전이를 마친다. 한 attempt의 요청·receipt·release/result와 외부 처리 동의 경계는 기존 S5 계약을 유지한다. 내부 독립 실행도 운영자 본인의 명시적 외부 업로드 허락이 필요하며 business job의 동의나 egress gate를 우회하는 경로로 쓰지 않는다.

### 3.3 단계별 증거

구현 단계는 실제 어댑터, 결정론적 transport/parser double, Local chunk·timestamp·repetition, Azure 원본 파일 최대 1회 client send·자동 재시도 없음·provider 내부 exactly-once 미보장, 오류 비공개와 출력 권한 계약으로 닫는다. 실제 모델 적재, 실제 Azure 호출, 사람 품질, 하드웨어 처리량과 제품 활성화는 이 증거로 대체하지 않는다.

후속 품질 단계는 §4~§7의 새 사람 모의상담, 독립 정답과 고정 threshold를 사용한다. 기존 합성 5건의 미완료 청취와 `independentSTT=BLOCKED_ACCESS` 상태는 이 단계의 선행조건이 아니라 역사·회귀 자료다. 마지막 운영 활성화 단계에서만 실제 품질·장비·기관 적합성 증거와 Q 승인으로 signed registry를 변경한다.

## 4. 후속 품질 단계: 사람 모의상담 입력, 허락과 독립 정답

### 4.1 녹음 구성

실제 당사자 자료를 쓰지 않는다. 후속 품질 실험에 자발적으로 참여하는 성인 2명이 실무자와 당사자 역할로 가상 상담을 녹음하며 본인의 실명, 연락처, 건강, 부채 등 실제 정보를 말하지 않는다. 이 참여 허락은 구현 단계에서 운영자가 자기 목소리만 쓰는 비민감 기능 시험과 구분한다.

- 개발 점검용 1개는 약 5분으로 만든다.
- 평가용 6개는 약 5분 4개와 약 20분 2개로 구성해 총 약 60분을 확보한다.
- 파일별 실제 길이는 초 단위로 기록한다. 분량을 맞추려고 반복 재생하거나 무음을 덧붙이지 않는다.
- 평가 내용에는 인테이크, 주거·생계 변화, 금액·날짜·상환 약속, 부정·정정 발언, 장시간 상담과 화자 교대, 주저함·침묵·말 겹침을 각각 포함한다.
- 녹음 환경과 마이크 배치를 고정하고 실제 들리는 조건을 기록한다.

### 4.2 허락과 보관

로컬 처리 허락, Azure 외부 전송 허락, 보관·삭제 기한을 각각 확인한다. 가상 상담이어도 실제 목소리 이용 허락이 필요하다. 사람 녹음의 외부 전송 허락이 없으면 로컬 품질 평가만 진행하고 Azure는 `미측정`으로 남긴다. 운영자 본인의 내부 시험 선언은 다른 참여자나 제3자 오디오의 허락을 대신하지 않는다.

오디오, 정답, 참가자 허락 자료는 접근 제한된 측정 작업공간에만 둔다. repo 산출물에는 ID, SHA-256, 실제 길이, 동의 검토 상태와 수치만 기록한다. 권리 검토가 공개를 허용하더라도 이번 실행은 공개 업로드 권한을 부여하지 않는다.

### 4.3 독립 정답과 핵심 사실

정답 작성자와 검수자는 모두 모델 결과를 보지 않는다. 정답 작성자는 실제 음성을 듣고 전사하고, 다른 사람이 전사, 두 화자의 시작·종료 구간, 무음·겹침 구간과 핵심 사실을 검수한다. 대본을 정답으로 쓰지 않고 실제 발화를 기준으로 삼는다. 모델 출력에서 정답을 역산하거나 결과를 본 뒤 정답을 고치지 않는다.

모델 실행 전에 금액, 날짜, 부정 여부, 지원 약속, 위기 발언의 핵심 사실을 검토할 기준 구간으로 지정한다. 입력 허락, 정답·화자 truth 검수, audio·reference hash, 핵심 사실 구간이 모두 동결되지 않으면 품질 평가를 시작하지 않는다.

## 5. 후속 품질 단계: 로컬 후보 품질과 안전성 비교

### 5.1 유한한 후보와 동결 tuple

이 후속 비교 후보는 다음 3개로 제한한다. 조사 시점의 공개 후보 묶음이며 절대 세계 1위나 보편적인 최신 모델이라는 뜻이 아니다.

1. `Qwen/Qwen3-ASR-1.7B`
2. `CohereLabs/cohere-transcribe-03-2026`
3. Whisper `large-v3`

현재 기능 구현은 첫 후보와 `Qwen/Qwen3-ForcedAligner-0.6B`의 원본 checkpoint를 사용한다. 이것은 품질 우승이나 제품 활성화를 선결한 것이 아니다. Cohere는 로컬 공개 가중치 후보이며 외부 Cohere API provider를 추가하지 않는다. `medium`, 작은 모델, 양자화별 조합이나 새 모델을 결과에 따라 추가하지 않는다.

평가 전에 각 후보의 공식 모델·라이선스·한국어 지원·로컬 실행 경로를 확인하고 다음 tuple을 동결한다: 모델 revision, 파일 hash, 실제 패키지 버전, OS, GPU/CPU SKU, VRAM/RAM, driver, dtype, chunk 상한, batch, 동시 작업 수, 타임스탬프·화자 분리 보조 단계. 접근 승인이나 Windows 호환성이 없는 후보는 `실행 불가/미측정`으로 남기고 우회 설치나 다른 모델로 대체하지 않는다. Windows native 결과가 필요할 때 Linux/WSL 결과로 대신하지 않으며 라이선스 승인 화면을 자동 수락하지 않는다.

설정은 개발 점검용 녹음 1개에서만 확정한다. 평가용 6개 결과를 보고 설정을 선택하거나 재시도해 점수를 개선하지 않는다. 판정 오류를 고쳐야 하면 영향받은 전체 실행을 새 run ID로 다시 수행하고 이전 결과를 보존한다.

### 5.2 실행 제한과 timeout

한 번에 로컬 모델 1개, 동시 녹음 1개, `batch=1`만 사용한다. 여러 ASR 후보를 GPU에 동시에 상주시켜 자원을 다투게 하지 않는다. 타임스탬프나 화자 분리가 없는 모델은 필요한 보조 단계까지 포함해 품질, 시간, 메모리를 기록한다. 보조 단계가 준비되지 않으면 해당 모델의 전체 경로는 미완료다.

평가 6개를 후보당 1회 실행한다. 다음 제한을 평가 전에 고정한다.

- 모델 적재: 10분
- warm-up: 2분
- 파일별 처리: `max(5분, 음성 길이×2)`

적재 실패와 추론 timeout을 구분한다. 추론 시작이 관측되지 않았다면 경과시간을 엔진 RTF 하한으로 쓰지 않는다. timeout은 시험 운영 상한이며 특정 CPU나 GPU의 일반적 불가능을 뜻하지 않는다.

### 5.3 지표와 판정

후속 통합 시 [v1 지표 계산 규칙](./S13-pilot-metrics.md#지표-계산과-고정-기준)과 owner lane의 `score_session`/`pool_sessions` 계약을 그대로 재사용한다. session 산술평균이 아니라 아래 pooled ratio를 사용한다.

| 지표 | 계산과 기준 |
|---|---|
| CER | `CER=(S+D+I)/Nref`, pooled `Σ(S+D+I)/ΣNref`, `≤0.15` |
| 반복률 | v1 정규화와 maximal periodic run 규칙의 `Σexcess/ΣNhyp`, `≤0.01` |
| RTF | `ΣengineWallSeconds/ΣaudioDurationSeconds`, `≤1.00`. 품질 비교에서 기록하되 §6의 Windows 단일 GPU 성능 판정에 적용한다. |
| DER | `Σ(FA+MISS+CONFUSION)/ΣreferenceSpeechSeconds`, collar 0초, `≤0.20` |
| v1 safety | 정규화 문자 alignment에서 연속 insertion run 20 code point 이상 또는 모든 문자가 deletion인 연속 reference turn의 duration 합 10초 이상을 event로 기록하고 `safetyEventCount=0`을 요구한다. |

전처리와 분모도 v1을 유지한다. CER는 Unicode NFC, LF 줄바꿈, 연속 whitespace를 ASCII space 하나로 정규화하고 양끝 공백을 제거한 code point 단위 Levenshtein이다. 반복률은 정규화한 hypothesis에서 `.`, `?`, `!`, `。`, `？`, `！`, `…`, CR, LF를 제거한 뒤 period 1~80의 maximal consecutive substring이 4회 이상 반복된 후보를 찾고, 겹치지 않는 후보의 `excess=(repeats-1)×period`를 합산한다. DER는 collar 0초이며 silence를 false alarm으로, overlap을 두 reference speaker와의 오류로 계산한다. 분모가 0이면 `미측정`이다. metric 산출물에는 원문 대신 수치, 상태, 사건 ID와 numeric offset만 둔다.

품질 통과에는 CER, 반복률, DER, v1 safety 기준과 평가 6개 누락 0, 화자 truth 완비, 오류 숨김 0이 필요하다. RTF는 이 단계의 품질 탈락 조건이 아니며 §6에서 별도로 성능을 판정한다. 사람이 사전에 지정한 핵심 사실 구간에서 금액·날짜·부정·약속·위기 발언의 의미를 뒤집는 오류나 존재하지 않는 중대한 사실 삽입이 한 건이라도 있으면 안전성 탈락이다. CER가 낮아도 통과시키지 않는다. repo 보고에는 사건 ID만 기록한다.

모든 품질·안전성 관문을 통과한 후보 중 pooled CER가 가장 낮은 모델 하나를 선택한다. 동률이면 낮은 반복률, 낮은 전체 처리시간, 낮은 peak VRAM 순으로 비교한다. 그래도 같으면 Qwen, Whisper, Cohere 순서로 선택한다. 마지막 순서는 동률 처리 규칙일 뿐 선험적 모델 순위가 아니다. 통과 후보가 없으면 로컬 선정은 미결이며 하위 사양 측정과 설정 변경 재경쟁을 시작하지 않는다. Azure 검토는 별도 조건으로 계속할 수 있으나 로컬 실패가 Azure 채택을 뜻하지 않는다.

## 6. 후속 품질 단계: 통과 모델의 실제 장비와 처리량

### 6.1 측정 구성

검증 상한 후보는 단일 NVIDIA GPU VRAM 24GB급, 시스템 RAM 64GB급 PC다. 필수 구매 사양이나 확정 최소·권장 사양이 아니다. 서버급, 다중 GPU, 기관 소유 클라우드 GPU는 이번 비교에서 제외한다.

성능 단계는 선정 모델, revision, 정밀도, 보조 모델, 입력, 설정을 고정하고 실제 장비만 바꾼다. 상한 후보와 하위 후보 최대 2개로 제한한다. 하위 비교 목표는 단일 GPU VRAM 16GB급/RAM 32GB급, 단일 GPU VRAM 12GB급/RAM 16GB급이다. 이 역시 구매 요구가 아니라 측정 대상 범위다. 실제 장비가 없으면 해당 행은 `미측정`이며 자원 제한 시뮬레이션으로 통과를 대신하지 않는다. 서로 다른 GPU SKU를 VRAM 숫자만으로 성능순 정렬하지 않는다.

각 구성에서 실제 GPU/CPU 모델, 물리·논리 코어, RAM, VRAM, OS, driver, 라이브러리, 전원 설정, 저장장치, 측정 중 다른 부하를 기록한다. 기관 일상 사용을 대표하지 못하면 전용 처리 조건이라고 명시한다.

모델 적재와 warm-up을 별도 측정한 뒤 평가 6개 전체를 순차로 3회 처리한다. 반복이나 사양 사이에 설정을 바꾸지 않는다. OOM 또는 오류가 생긴 구성은 실패를 보존하고 남은 반복을 중지한다. 낮은 장비에 맞추기 위한 모델 크기·정밀도 변경은 이 비교에 포함하지 않는다.

### 6.2 시간과 자원 계측

순수 엔진 RTF는 v1 정의를 유지한다. v2에서만 Windows 단일 GPU를 성능 판정 대상으로 포함하고 `RTF≤1.00`을 유지한다. GPU 결과를 판정하려고 구현의 `windows_cpu=True`를 거짓으로 전달하거나 v1 보고서를 재판정하지 않는다. executor는 Windows 단일 GPU라는 별도 실행 문맥을 명시해 같은 수식과 기준을 적용해야 한다.

전체 처리시간에는 디코딩, 청크, 전사, 정렬, 화자 분리, 마스킹, 로컬 결과 준비를 포함한다. 원음 네트워크 업로드·대기열과 요약 LLM은 별도로 계측한다. NER/마스킹이 미구현이거나 통과하지 않았으면 STT 부분 처리량만 보고하고 Agent 전체 처리량을 확정하지 않는다.

peak VRAM은 device 전체 사용량과 모델 runtime 사용량을 구분한다. peak RAM은 worker와 보조 프로세스를 모두 포함해 계측하며 단일 순간 working set을 peak RAM이라고 부르지 않는다. 장비와 계측 정보가 없으면 자원 결과는 `미측정`이다.

### 6.3 최소·권장 구성과 일일 용량

`검증된 최소 구성`은 실제 시험한 구성 중 품질을 유지하고 3회 모두 오류, OOM, 누락 없이 성능 관문을 통과한 가장 작은 구성이다. GPU와 CPU 차이 때문에 우열을 정할 수 없으면 통과 구성을 병렬로 표기한다. 미측정 저사양을 지원 또는 불지원으로 단정하지 않는다.

`권장 구성`은 통과 구성 중 peak RAM과 peak VRAM이 각각 실제 가용 총량의 80% 이하인 가장 작은 구성이다. 80%는 이 계획의 여유 기준이며 vendor 요구사항이 아니다. 해당 구성이 없으면 권장 사양은 `미확정`이다.

하루 처리 가능한 녹음량은 8시간, 12시간, 24시간 처리창별로 보고한다. 3회 중 가장 큰 전체 처리 RTF를 `r`, 1일 최초 준비시간을 `c`초, 처리창을 `W`시간이라 하면 녹음시간은 다음과 같다.

```text
0.8 × max(0, W×3600-c) / (r×3600)
```

`0.8`은 계획 여유 계수이며 측정치가 아니다. 결과는 야간 전원 유지, 실제 처리창, 대기열, 실패 재처리, 텍스트 일감 부하가 충족된다는 조건부 추정치이며 SLA가 아니다. NER 또는 필수 보조 단계가 빠졌으면 Agent 전체 용량은 `null`로 둔다.

실제 결과가 나온 뒤에만 안정 사양 수치를 [`docs/ops.md`](../ops.md) 한 곳에 모델 revision, 실행 tuple, 실제 장비, 녹음 처리창, 증거 경로와 함께 기록한다. 측정 전에는 확정 숫자를 넣지 않는다.

## 7. Azure 구현과 후속 기관 적합성

Azure 어댑터 구현은 사람 품질·하드웨어 실험을 기다리지 않는다. 기능 단계에서는 승인된 외부 호출 없이 transport와 parser를 결정론적으로 검증할 수 있고, 운영자가 소유한 비민감 자기 목소리 파일의 실제 업로드는 운영자가 그 외부 전송을 명시적으로 허락하고 승인된 자격·비용 경로가 있을 때만 별도로 수행한다. 이 내부 허락은 실제 참가자, 제3자 오디오 또는 production job의 동의·egress 경계를 대신하지 않는다.

### 7.1 API와 후속 동일 입력 비교

경로는 Azure Speech `koreacentral`, `ko-KR`, `api-version=2025-10-15` 하나로 제한한다. multipart definition에서 `diarization.enabled=true`, `maxSpeakers=2`를 지정하고 익명의 파일별 `speaker` ID를 읽는다. 원본 파일의 client HTTP send는 attempt당 최대 1회이며 자동 재시도하지 않는다. 이는 Azure 내부 처리의 exactly-once 보장이 아니다. 청크별 업로드, `audioUrl`, redirect와 다른 리전·provider 전환은 없다.

후속 품질 단계에서는 외부 처리 허락을 받은 평가 6개 파일을 각각 1회만 호출한다. 로컬과 동일한 입력 bytes와 정답 hash를 연결하고 업로드 시작부터 응답 완료까지 총 시간을 측정한다. 승인받은 고정 비용 범위에서만 호출하며 비용 한도가 확인되지 않으면 호출하지 않는다. §5.3의 CER, 반복률, DER, v1 safety 기준, 누락·화자 truth·오류 숨김 관문과 사전 지정 핵심 사실 안전성 판정을 Azure에도 동일하게 적용한다. Windows 로컬 엔진의 RTF 성능 기준을 Azure 응답시간 판정에 가져오지 않는다. Azure의 총 응답시간은 별도 증거로 보고해 기관 운영 적합성과 Q의 채택 판단에 사용한다. 기본 비교 결과를 숨기거나 보정하지 않는다. lexical/display 전사 차이, 구두점·숫자 표현, 가려진 욕설 설정을 기록한다. 서비스 모델 버전을 알 수 없으면 API 버전, 리전, 관측일을 기록하고 model revision은 `공급자 미공개`로 둔다.

### 7.2 기관 운영과 동의

호출 전에 다음 항목을 모두 확인한다.

- 사용자별 Azure 계정과 기관 소유 구독
- 유료 사용 승인과 한도, Speech resource, 실제 청구 단가
- 키 관리·교체와 퇴사자 접근 회수 담당자
- 장애 대응 담당자
- 녹음 동의와 구분된 외부 STT 동의
- 처리 목적, Microsoft, 리전, 보관·삭제, 철회, 민감정보와 공공사업 처리 허가

일반 녹음 동의는 외부 처리 동의를 대신하지 않는다. 기존 기관 인증을 먼저 쓰되 이전 접근 실패를 계정 부재로 단정하지 않는다. 새 계정, 구독, resource, key, 과금, 권한은 별도 사람 승인 없이 만들거나 바꾸지 않는다. 기관이 운영 책임을 감당할 수 없으면 부적합이다. Azure production 경로도 기관 Agent, NER/마스킹, S5 attempt·receipt·동의 관문을 면제받지 않는다.

품질, 시간, 운영 부담, 키, 동의 조건의 증거가 모두 있고 Q의 채택 판단과 기관 관리자의 명시 선택이 있을 때만 Azure를 제품 선택지로 제공한다. 하나라도 실패하거나 미확인이면 해당 기관에는 STT off와 수기 기록을 제공한다. 로컬 사양 미달만으로 Azure를 권장·선택·호출하지 않는다.

## 8. 판정표

아래 표는 문서 규칙의 결정성을 확인한다. 실제 STT PASS를 주장하는 실행 결과가 아니다.

| 입력 상황 | 기대 결과 |
|---|---|
| 24GB GPU/64GB RAM이 있지만 품질 결과가 없음 | 상한 후보일 뿐이다. 최소·권장 사양과 Local 승인 여부는 미확정이다. |
| 상한 후보에서 로컬 세 모델 모두 정확도 또는 안전성 실패 | 로컬 미선정, 하위 장비 측정 0회, 설정 변경 재경쟁 0회다. Azure는 별도 조건으로만 검토한다. |
| 로컬 품질 승자가 있고 16GB 장비만 실제 통과, 12GB 장비는 없음 | 검증된 최소는 시험한 16GB 구성이다. 12GB는 미측정이며 지원 불가로 단정하지 않는다. |
| 사양 미달, Azure 키만 존재, 운영/동의 검토 미완 | Azure 권장·선택·호출 0회, STT off와 수기 기록이다. |
| 운영자 본인의 비민감 자기 목소리와 Local 기능 시험 선언이 있음 | Local 기능 시험은 가능하다. 제3자 음성 이용, production 동의·NER·signed registry 활성화 권한은 생기지 않는다. |
| 모의상담 정답은 대본이고 실제 발화 검수가 없음 | 품질 평가 시작 불가, 자료 검수 대기다. |
| `r=0.5`, `c=600초`, `W=8시간` | 계획 여유를 적용한 녹음량은 약 12.533시간이다. 약 16시간이나 하루 24시간 보장으로 보고하지 않는다. |
| 추론 시작 전 적재가 10분 timeout | 적재 실패다. CER/엔진 RTF는 미측정이며 CPU 성능 하한을 만들지 않는다. |
| NER 단계가 미구현/미통과 | STT 부분 수치는 분리 보고하되 Agent 전체 일일 처리량은 `null`이다. |
| 진단 `exit.json`은 0이지만 arm `errorType`이 있거나 `rows`가 부족함 | 해당 arm 실패/미완료다. observer의 `NORMAL_EXIT`를 전체 PASS로 해석하지 않는다. |
| 검수 ZIP과 hash 대조가 있지만 `청취검수.csv`가 `청취 완료=미완료`, 판정 `UNSURE`임 | 역사 감사 상태는 미완료로 보존한다. 현재 구현이나 새 사람 모의상담 품질 단계의 선행조건으로 쓰지 않는다. |
| 기존 기관 Azure 인증을 찾지 못함 | 접근 점검 결과와 막힌 단계를 기록한다. 새 구독·키 발급·대체 공급자 전송은 하지 않는다. |
| 별도 감시 대화는 종료했지만 기존 observer가 `ready`임 | 중복 watcher를 만들지 않고 기존 observer를 유지한다. 대화 종료와 프로세스 종료를 구분한다. |
| 새 run을 만들었지만 `hourly_observer.py`의 `TARGETS`는 기존 두 개뿐임 | 새 run은 감시되지 않는 상태다. 명시적으로 연결하기 전에는 자동 감시를 약속하지 않는다. |

## 9. 실행 산출물과 완료 경계

구현 증거에는 Local 고정 checkpoint와 격리 runtime, 청크·시각·반복 검사, Azure 원본 파일 최대 1회 client send·익명의 파일별 provider 화자 ID·자동 재시도 없음, S5 authorization·attempt·receipt 순서, 안전한 오류와 비공개 출력 계약을 연결한다. 실제 원음, 전사 전문, 신원, 동의 원문과 secret은 repo 산출물에 넣지 않는다.

후속 품질 run은 입력 ID/hash, 정답·화자 truth hash, 참가자 허락 검토 상태, 후보와 동결 tuple, run ID, 소스 commit, 실제 장비·계측 조건, timeout 단계, per-file 수치, pooled 수치, 누락·오류·OOM, 핵심 사실 사건 ID를 연결한다. 상태는 `PASS`, `FAIL`, `미측정`, `실행 불가`, `미완료`, `BLOCKED_ACCESS`를 근거에 맞게 구분하며 미측정을 PASS로 세지 않는다.

어댑터 구현 완료와 후속 품질·운영 활성화 완료를 분리한다. 품질 단계에는 다음 증거가 필요하다.

- 사람 개발 점검용 1개, 평가용 6개의 허락·독립 정답·화자 truth·핵심 사실 구간·hash
- 세 로컬 후보의 동결 tuple과 상한 후보 품질 실행, 또는 후보별 실행 불가/미측정 근거
- 로컬 승자가 있을 때만 실제 상한·하위 장비 성능 결과, 최소·권장·8/12/24시간 처리량
- Azure 동일 평가 6건 결과, 기관 비용·키·운영·동의 검토, Q 판단 또는 미측정·부적합 근거

기존 합성 5건의 사람 청취와 독립 STT는 역사·회귀 자료로 보존하되 위 완료 조건이나 기능 구현 입장 조건에 넣지 않는다. 이 문서 변경은 실제 모델을 적재하거나 Azure를 호출하지 않았고, 품질·사양·provider 채택을 검증하지 않았다.

## 10. 외부 근거 확인 관문

아래 공개 자료는 실행 전 확인해야 할 공식 근거다. 링크를 적은 것만으로 한국어 지원, 로컬 실행, Windows 호환성, 리전 기능, 기관 자격 또는 이번 장비 성능을 관측했다고 주장하지 않는다. 실행 시 관측일과 실제 확인 결과를 별도 증거로 남긴다.

- Qwen 기술 보고서: <https://arxiv.org/html/2601.21337v2>. 한국어 CER 행을 다른 회사의 다른 평가 수치와 직접 순위 비교하지 않는다.
- Qwen 공식 사용법: <https://github.com/QwenLM/Qwen3-ASR>. CUDA/BF16 예제를 특정 PC의 최소·권장 사양으로 해석하지 않는다.
- Cohere Transcribe 문서: <https://docs.cohere.com/v2/docs/transcribe>
- Cohere 로컬 후보 모델 카드: <https://huggingface.co/CohereLabs/cohere-transcribe-03-2026>. gated 접근, 라이선스, 한국어, 타임스탬프·화자 분리 보조 경로를 실행 전에 확인한다.
- Whisper `large-v3` 모델 카드: <https://huggingface.co/openai/whisper-large-v3>. `medium` 결과를 `large-v3` 결과로 바꾸어 읽지 않는다.
- Azure Speech 지역 표: <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions>
- Azure fast transcription: <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create>
- Azure Speech 데이터 처리·보관: <https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security>. real-time/fast와 batch 보관 조건을 혼동하지 않는다.
