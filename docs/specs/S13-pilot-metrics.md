# S13: 파일럿 측정

- 상태: **확정** (2026-09-02)
- 근거: `ADR-0035` D63~D68, `CCC_OPEN_PILOT_PLAN.md` §4·§5, GitHub Issue [#230](https://github.com/SocialSolidarityBank/CCC/issues/230). `ADR-0041` 발행 뒤 파일럿 모드 정책의 상위 정본으로 연결하되, 이 스펙의 확정과 구현 증거는 그 발행이나 런타임 결과를 기다리지 않는다.
- 입력: `CCC_OPEN_PILOT_PLAN.md`, `docs/adr/0035-contest-scope-and-deployment-doors.md`, `apps/pipeline/README.md`, `apps/pipeline/ccc_pipeline/repetition.py`, `apps/pipeline/tests/test_repetition.py`, GitHub Issue #230
- 산출: tracked fixture metadata `scripts/stt/fixtures/manifest.json`, `scripts/stt/fixtures/reference/{sessionId}.json`, `scripts/stt/fixtures/licenses.json`, fetched audio와 검증 증거 `artifacts/pilot/fixtures/s13-v1-verification.json`, `artifacts/pilot/answer-key/s13/detection-answer-key.json`, 티켓별 측정 결과와 `artifacts/pilot/reports/E11-5-pilot-impact-report.md`
- 관련 티켓: E5-8a, E5-8, E11-2a, E11-2, E11-3, E11-5

## 1. 목적

합성 대화만으로 세 배포 모드의 STT와 감지 품질, 실무자 시간, AI 수정량을 같은 기준으로 비교한다. 음성 fixture와 감지 정답표를 먼저 고정하고, 결과를 본 뒤 기준이나 정답을 바꾸지 못하게 한다. 이 문서는 측정 단위, 계산식, 담당 티켓, 증거 위치, 미측정 처리를 닫는다.

## 2. 인터페이스와 규칙

### Fixture와 정답표 계약

E5-8a 티켓 owner인 Processing Agent benchmark maintainer가 합성 대화 fixture를 만들고 검증한다. fixture는 `case-001`~`case-030`, 각 case의 `session-01`~`session-05`로 총 30 cases × 5 sessions = 150 sessions이며 모두 **test-only**다(`trainCaseIds: []`). 모든 session은 60~180초이고 두 명의 화자가 있으며, 선언된 silence range와 overlap range를 가진다. 단일 화자나 speaker truth 없는 clean shortcut은 허용하지 않는다. 모델 학습, fine-tuning, prompt fitting과 test case 재사용을 하지 않는다. E11-2a 티켓 owner가 fixture 스크립트에서 감지 라벨을 정답표로 만들고, answer-key author와 reviewer는 E2-4c 및 E11-2 implementer와 겸임하지 않는다.

fixture의 정본 경로는 `scripts/stt/fixtures/manifest.json`, `scripts/stt/fixtures/reference/{sessionId}.json`(전사와 두 화자 truth), `scripts/stt/fixtures/licenses.json`이다. manifest의 `audioReleaseTag`은 hash-addressed GitHub Release asset tag `s13-fixture-v1`를 가리키며, `python3 scripts/stt/fetch_fixture.py`가 음성을 gitignored `artifacts/pilot/fixtures/s13-v1/audio/`에 내려받고 hash를 검증한다. manifest는 `fixtureId: "s13-v1"`, `sourceType: "synthetic"`, `audioReleaseTag: "s13-fixture-v1"`, 각 `caseId`, `sessionId`, `speakerCount: 2`, `audioSha256`, `transcriptSha256`, 필수 `speakerTruthSha256`, `durationSeconds`, `silenceRanges`, `overlapRanges`, `licenseManifestSha256`를 가진다. SHA-256은 해당 파일의 바이트에 대해 계산하고, manifest 자체도 해시한다. license manifest에는 모든 음성 자산의 `assetId`, 제작 도구 또는 출처, SPDX license, license URL, 재배포 허용 여부, attribution을 기록한다. 저장소에는 manifest, reference JSON, licenses만 커밋하고 WAV를 커밋하지 않는다. ID, 파일, 해시, 라이선스 manifest가 하나라도 바뀌면 새 fixture 버전이며 기존 결과를 덮어쓰지 않는다.

`detection-answer-key.json`의 정본 경로는 `artifacts/pilot/answer-key/s13/detection-answer-key.json`이다. 키는 `answerKeyId: "s13-detection-v1"`, fixture ID와 fixture manifest hash, 그리고 `{caseId, sessionId, criterionId, expected}` 행이다. `criterionId`는 scripted case의 검출 조건을 가리키며, 한 행은 하나의 case-session-criterion 이벤트다. 중복 행은 금지하고, gold는 `expected=true`인 행으로만 고정한다. 예측 key가 answer key에 없으면 무결성 FAIL이고, 정답은 E11-2a가 생성하고 별도 reviewer가 스크립트와 대조한다. 예측에서 정답을 역산하거나 모델 결과로 정답을 수정하지 않는다.

감지 예측 artifact `artifacts/pilot/results/{runId}/detection-predictions.json`은 `fixtureId`, `fixtureManifestSha256`, `mode`, `model`, `gitCommit`을 함께 고정한다. E11-2는 중복 prediction을 기록하고 FAIL로 표시하며, 중복을 TP로 두 번 세지 않는다. E11-3 practitioner ID는 stable pseudonymous 값으로 기록하고 실제 신원과의 mapping은 artifact 밖의 접근 제한된 운영 기록에만 둔다.

### 지표 계산과 고정 기준

| 지표 | 계산식과 고정 전처리 | 담당 티켓 / 증거 |
|---|---|---|
| CER | `CER=(S+D+I)/Nref`, Unicode NFC, 줄바꿈 LF, 연속 whitespace를 ASCII space 하나로 정규화하고 양끝 공백 제거 후 code point 단위 Levenshtein. `Nref=0`이면 미측정 | E5-8 / `artifacts/pilot/results/{runId}/stt-metrics.json` |
| 반복률 | hypothesis를 Unicode NFC와 whitespace만 정규화해 이어 붙인 뒤, detection 전에 `.`, `?`, `!`, `。`, `？`, `！`, `…`, CR, LF를 제거한다. punctuation은 reporting에만 보존한다. `Nhyp` code point에 대해 p=1~80의 maximal consecutive substring이 4회 이상 반복되는 후보를 찾고, `excess=(repeats-1)*p`로 계산한다. 겹치지 않는 후보를 excess 내림차순, p 오름차순, 시작 offset 오름차순으로 선택하고 `repeatRate=Σ(excess)/Nhyp`를 산출한다. session별 `Nhyp`, 선택한 run의 p, repeats, start/end numeric offset을 기록하며 `Nhyp=0`이면 미측정 | E5-8 / `artifacts/pilot/results/{runId}/stt-metrics.json` |
| RTF | `engineWallSeconds/audioDurationSeconds`; 모델 다운로드, 대기열, 설치와 1회 warm-up은 제외하고 동일 장비·동일 입력에서 엔진 호출부터 결과 반환까지 잰다. RTF threshold는 Windows CPU target에 적용한다 | E5-8 / `artifacts/pilot/results/{runId}/stt-metrics.json` |
| DER | 두 화자 RTTM truth가 항상 있는 경우 `DER=(FA+MISS+CONFUSION)/referenceSpeechSeconds`, collar 0초로 계산한다. silence는 FA로, overlap은 두 reference speaker와의 오류로 점수화하며 제외 구간은 없다 | E5-8 / `artifacts/pilot/results/{runId}/stt-metrics.json` |
| Safety | reference와 hypothesis character alignment에서 maximal insertion run이 20 code point 이상이면 event다. 또는 모든 normalized code point가 deletion으로 align된 연속 reference turn들의 duration 합이 10초 이상이면 event다. `safetyEventCount=0`만 PASS하며 이벤트는 ID와 numeric offset만 기록 | E5-8 / `artifacts/pilot/results/{runId}/stt-metrics.json` |
| 정밀도·재현율 | `TP=pred∩gold`, `FP=pred-gold`, `FN=gold-pred`; `P=TP/(TP+FP)`, `R=TP/(TP+FN)`. sorted case ID 30개에서 Python `random.Random(51313).choices(caseIds, k=30)`로 10,000회 재표집하고, 각 표본은 5 sessions와 모든 criterion을 함께 포함한다. nearest-rank 2.5~97.5% 구간 | E11-2 / `artifacts/pilot/results/{runId}/detection-metrics.json` |
| 작성 시간 | `writingSeconds=t_savedManual-t_firstInput`, practitioner별 case-session 측정. 첫 입력부터 공식 저장까지의 monotonic elapsed seconds만 사용 | E11-3 / `artifacts/pilot/results/{runId}/practitioner-metrics.json` |
| 준비 시간 | `preparationSeconds=t_startButton-t_contextOpened`, context를 연 시각부터 실제 `상담 시작` 버튼 click까지 측정 | E11-3 / `artifacts/pilot/results/{runId}/practitioner-metrics.json` |
| AI 수정량 | AI 초안과 최종 수기본의 동일 정규화 Levenshtein `editOps=S+D+I`, `editRate=editOps/max(1,len(initialDraft))`. 메타데이터·승인 클릭은 제외. AI Off로 초안이 없으면 미측정 | E11-3 / `artifacts/pilot/results/{runId}/practitioner-metrics.json` |

E5-8은 per-session 값을 보존하면서 run aggregate도 낸다. aggregate CER은 `Σ(S+D+I)/ΣNref`, 반복률은 `Σ(excess)/ΣNhyp`, DER은 `Σ(FA+MISS+CONFUSION)/ΣreferenceSpeechSeconds`, RTF는 `ΣengineWallSeconds/ΣaudioDurationSeconds`인 pooled ratio이며 session 산술평균을 쓰지 않는다. 결과에는 CPU, RAM, GPU, compute backend와 thread 수를 기록하고, RTF는 Windows CPU target에서 판정한다.

사전 등록 threshold는 fixture와 answer key를 실행하기 전에 이 문서의 값으로 고정한다: CER `≤0.15`, 반복률 `≤0.01`, RTF `≤1.00`, DER `≤0.20`, safety event count `=0`, 정밀도와 재현율 각각 point `≥0.80` 및 95% interval 하한 `≥0.70`. 결과를 본 뒤 threshold, 정규화, periodic-run period 상한, bootstrap seed, answer key를 조정하지 않는다. 변경은 새 `v2` 스펙과 새 fixture/run으로만 가능하다.

상태 규칙은 다음과 같다. 유효한 입력과 분모가 있고 기준을 만족하면 PASS, 유효한 입력과 분모가 있으나 기준을 못 맞추면 FAIL, 입력 또는 예측이 없어 계산할 수 없으면 미측정이다. 선언된 fixture 파일의 hash/license 불일치, `s13-v1-verification.json` 누락 또는 불일치, answer key hash 불일치, unknown prediction key, duplicate prediction, 필수 150 session 누락, 두 화자 truth·duration·range 조건 위반은 실행 무결성 FAIL이다. 이번 fixture는 두 화자 truth가 필수이므로 DER 미측정은 허용하지 않는다. E11-3의 writing/preparation/edit 값은 threshold 없는 기술통계이므로 상태를 `측정|미측정`으로만 기록하고 PASS/FAIL을 부여하지 않는다. 미측정은 PASS로 집계하지 않으며, E11-5 보고서에는 원인과 owner를 남긴다.


## 3. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 실행 경계 | Supabase/Postgres와 private Storage, 네트워크 경유, 다중 사용자 | 암호화 SQLite와 같은 PC의 로컬 Agent, 단일 사용자·오프라인 가능 | 로컬 서버의 암호화 SQLite, LAN의 client 2개와 공유 Agent |
| 측정 | 같은 150 session을 Cloud 합성 기관에서 실행하고 API/Storage 경로를 기록 | 같은 fixture를 로컬 파일에서 실행하고 네트워크 없이 재실행 | 같은 fixture를 서버에서 실행하고 client 요청·서버 Agent 경로를 기록 |
| 비교 규칙 | 지표 계산식, threshold, answer key는 세 모드에서 동일 | 동일 | 동일 |
| 개인정보 경계 | 법무 게이트 전에는 합성 음성·텍스트만 private Storage와 승인된 synthetic 환경에 둔다 | 실데이터·시크릿·원음 외부 전송 없음 | 실데이터·시크릿·원음 외부 전송 없음 |

AI가 켜진 경우에도 입력은 처리 장비가 만든 마스킹 snapshot만 사용한다. 법무 게이트 `E9-3`과 `E11-1b` 및 Q 승인 전에는 실제 당사자 데이터, 실제 상담 음성, 운영 자격 증명을 어떤 mode의 fixture나 측정에도 넣지 않는다.

## 4. 완료 조건

- [ ] E5-8a가 150개 session fixture, 60~180초 duration, 두 화자 truth, silence/overlap range, manifest hash와 license manifest를 고정하고 `scripts/stt/verify_fixture.py`로 `artifacts/pilot/fixtures/s13-v1-verification.json`을 만든다.
- [ ] E11-2a가 verification artifact와 manifest hash를 확인한 뒤 30개 case × 5 sessions의 answer key hash를 고정하고 예측과 독립적으로 검토한다.
- [ ] E5-8이 CER, 반복률, RTF, DER, safety를 위 계산식과 threshold로 산출하고 per-session 값과 pooled aggregate를 원문 대신 ID·hash·수치로 남긴다.
- [ ] E11-2가 TP/FP/FN, precision, recall, 95% bootstrap interval, 모든 오답 example ID를 산출한다.
- [ ] E11-3이 세 mode에서 practitioner 3명의 `writingSeconds`, `preparationSeconds`, `editOps`/`editRate`를 `측정|미측정`으로 산출한다.
- [ ] E11-5가 E5-8a, E5-8, E11-2a, E11-2, E11-3과 함께 E5-5 privacy/masking, E6-7·E7-3·E8-5 backup, E10-2 security/supply-chain의 별도 증거를 owner별로 연결한 보고서를 만든다.
- [ ] 필수 artifact 누락이나 hash 불일치는 미측정으로 숨기지 않고 무결성 FAIL로 남긴다.

## 5. 검증 방법

후속 티켓은 아래 명령과 경로를 고정해 사용한다. 이 SG13 문서를 확정하는 데에는 구현, 배포, 복원 결과가 필요하지 않다.

```bash
python3 scripts/stt/fetch_fixture.py --manifest scripts/stt/fixtures/manifest.json --release-tag s13-fixture-v1
python3 scripts/stt/verify_fixture.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/fixtures/s13-v1-verification.json
python3 scripts/stt/benchmark.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/results/{runId} --engines faster-whisper,qwen3-asr
python3 scripts/pilot/build_detection_key.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/answer-key/s13/detection-answer-key.json
python3 scripts/pilot/detection_metrics.py --predictions artifacts/pilot/results/{runId}/detection-predictions.json --answer-key artifacts/pilot/answer-key/s13/detection-answer-key.json --out artifacts/pilot/results/{runId}/detection-metrics.json
pnpm pilot:usability --manifest scripts/stt/fixtures/manifest.json --modes community-cloud,local-single,local-office --out artifacts/pilot/results/{runId}/practitioner-metrics.json
python3 scripts/stt/report.py --inputs artifacts/pilot/results/{runId} --out artifacts/pilot/reports/E11-5-pilot-impact-report.md
```

E5-8a는 `artifacts/pilot/fixtures/s13-v1-verification.json`이 manifest hash, 150 session count, duration, two-speaker truth, silence/overlap range, license 검사를 모두 담고 PASS한 뒤에만 E5-8과 E11-2a가 시작되도록 한다. E11-5도 이 verification artifact를 필수 입력으로 받고, E5-8a, E5-8, E11-2a, E11-2, E11-3 owner와 E5-5 privacy/masking, E6-7·E7-3·E8-5 backup, E10-2 security/supply-chain owner를 보고서에 명시하고 각 증거를 별도로 consume한다. 각 run의 `fixtureId`, manifest hash, answerKeyId/hash, mode, engine/model, commit을 연결한다. raw transcript, raw audio, PII, secret은 보고서와 metric JSON에 복사하지 않는다.

## 6. 이번에 안 하는 것

실제 참가자 또는 상담 데이터, 법무 게이트 전의 원음, 운영 계정·시크릿, fixture 생성 구현, benchmark/report 스크립트 구현, 배포·복원 결과, 감정 분석, 실사용자 표본의 통계적 일반화는 범위 밖이다. 실데이터 측정은 `E12-5`가 소유하며 이 스펙의 synthetic 결과와 별도 보고한다. threshold를 결과에 맞춰 재조정하거나 answer key를 사후 수정하는 일은 하지 않는다.
