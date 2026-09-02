# SG13 파일럿 측정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `S13-pilot-metrics.md`의 고정 계약대로 합성 30 cases × 5 sessions fixture, 감지 정답표, STT·감지·사용성 결과, 임팩트 보고서를 재현 가능하게 만든다.

**Architecture:** E5-8a가 script와 manifest로 입력을 먼저 만들고 hash와 license를 검증한다. E5-8과 E11-2a는 각각 STT 결과와 감지 정답표를 독립적으로 만들며, E11-2와 E11-3은 고정 입력을 소비해 수치 artifact를 만든다. E11-5는 원문을 복사하지 않고 각 artifact의 ID·hash·commit·mode를 연결해 제출 보고서를 조립한다.

**Tech Stack:** Python 3.12 표준 라이브러리, existing Processing Agent `Segment`/repetition contract, `ffmpeg` 또는 고정된 합성 음성 생성기, JSON, SHA-256, TypeScript/`pnpm` pilot scripts

**Spec:** `docs/specs/S13-pilot-metrics.md`

## Global Constraints

- fixture ID는 `s13-v1`이고 `case-001`~`case-030`, case당 `session-01`~`session-05`, 총 150 sessions를 고정한다. 모든 session은 60~180초이며 두 화자, silence range, overlap range가 있다.
- `trainCaseIds`는 빈 배열이며 모든 30 cases는 test-only다. model training, fine-tuning, prompt fitting과 test case 재사용을 하지 않는다.
- fixture file, manifest, answer key, license manifest가 바뀌면 새 version과 새 run을 만들고 기존 결과를 덮어쓰지 않는다.
- SHA-256은 해당 파일의 바이트에 대해 계산하고 manifest 자체도 hash한다.
- 정답표는 E11-2a가 예측 결과를 보지 않고 만들며, answer-key author/reviewer는 E2-4c 및 E11-2 implementer와 겸임하지 않는다. match key는 `{caseId, sessionId, criterionId}` 전체이며 gold는 `expected=true`다.
- CER threshold는 `≤0.15`, repetition rate는 `≤0.01`, RTF는 `≤1.00`, DER은 `≤0.20`이다.
- safety event count threshold는 `=0`: maximal insertion run `≥20` code points 또는 reference timestamp deletion span `≥10s`가 safety event다.
- precision과 recall threshold는 각각 point `≥0.80`이고 95% bootstrap interval 하한은 각각 `≥0.70`이다.
- repetition detection is deterministic periodic-run search: detection removes exactly `.`, `?`, `!`, `。`, `？`, `！`, `…`, CR and LF after normalization; punctuation is retained only for reporting. Search maximal consecutive substring period p=1~80 codepoints repeated at least 4 times, `excess=(repeats-1)*p`, select non-overlapping candidates by excess descending, p ascending, start offset ascending, and `repeatRate=Σ(excess)/Nhyp`; record p/repeats/start/end offsets.
- denominator가 없으면 `미측정`, 유효한 값이 threshold를 못 맞추면 `FAIL`, 만족하면 `PASS`다. 미측정은 PASS로 집계하지 않는다.
- 선언된 fixture hash/license 또는 answer key hash가 맞지 않거나 unknown/duplicate prediction key 또는 필수 150 session이 빠지면 실행 무결성 `FAIL`이다.
- metric JSON과 보고서에는 raw transcript, raw audio, PII, secret을 복사하지 않고 ID·hash·수치·오답 example ID만 남긴다.
- E11-3의 writing/preparation/edit 값은 threshold 없는 기술통계이므로 `측정|미측정`만 사용하고 PASS/FAIL을 부여하지 않는다.
- 법무 게이트 `E9-3`과 `E11-1b` 및 Q 승인 전에는 실제 당사자 데이터, 실제 상담 음성, 운영 자격 증명을 사용하지 않는다.

---

## File Map

### 계약 파일

- `docs/specs/S13-pilot-metrics.md`: 여섯 템플릿 섹션, fixture·answer key·metric·threshold·mode·privacy 계약.
- `docs/superpowers/plans/2026-09-02-SG13-pilot-metrics.md`: 이 실행 계획.

### E5-8a가 만드는 파일

- `scripts/stt/fixtures/manifest.json`: `s13-v1` manifest with GitHub Release asset tag `s13-fixture-v1`.
- `scripts/stt/fixtures/reference/{sessionId}.json`: 정답 전사, 두 화자 truth, silence/overlap range.
- `scripts/stt/fixtures/licenses.json`: 자산별 SPDX와 license URL.
- `artifacts/pilot/fixtures/s13-v1/audio/{sessionId}.wav`: gitignored fetched audio, never committed.
- `artifacts/pilot/fixtures/s13-v1-verification.json`: manifest hash와 모든 fixture checks.
- `scripts/stt/fetch_fixture.py`, `scripts/stt/verify_fixture.py`: release fetch와 manifest verification.

### 후속 티켓 결과 파일

- E11-2a: `scripts/pilot/build_detection_key.py`, `artifacts/pilot/answer-key/s13/detection-answer-key.json`.
- E5-8: `scripts/stt/benchmark.py`, `artifacts/pilot/results/{runId}/stt-metrics.json`.
- E11-2: `scripts/pilot/detection_metrics.py`, `artifacts/pilot/results/{runId}/detection-metrics.json`.
- E11-3: `scripts/pilot/usability.mjs`, `artifacts/pilot/results/{runId}/practitioner-metrics.json`.
- E11-5: `scripts/stt/report.py`, `artifacts/pilot/reports/E11-5-pilot-impact-report.md`.

## Interfaces

```json
{
  "fixtureId": "s13-v1",
  "sourceType": "synthetic",
  "audioReleaseTag": "s13-fixture-v1",
  "trainCaseIds": [],
  "testCaseIds": ["case-001", "case-002", "case-003", "case-004", "case-005", "case-006", "case-007", "case-008", "case-009", "case-010", "case-011", "case-012", "case-013", "case-014", "case-015", "case-016", "case-017", "case-018", "case-019", "case-020", "case-021", "case-022", "case-023", "case-024", "case-025", "case-026", "case-027", "case-028", "case-029", "case-030"],
  "sessions": [{
    "caseId": "case-001",
    "sessionId": "case-001-session-01",
    "speakerCount": 2,
    "audioSha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "transcriptSha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "speakerTruthSha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "durationSeconds": 120.0,
    "silenceRanges": [],
    "overlapRanges": [],
    "licenseManifestSha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }]
}
```

```json
{
  "answerKeyId": "s13-detection-v1",
  "fixtureId": "s13-v1",
  "fixtureManifestSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "rows": [{
    "caseId": "case-001",
    "sessionId": "case-001-session-01",
    "criterionId": "criterion-001",
    "expected": true
  }]
}
```
각 result JSON은 `schemaVersion`, `runId`, `fixtureId`, manifest hash, mode, engine/model 또는 stable pseudonymous practitioner ID, metric values, status와 reason, generatedAt, git commit을 포함한다. E5-8 결과는 CPU, RAM, GPU, compute backend와 thread 수를 기록한다. E11-2 prediction artifact는 `fixtureId`, `fixtureManifestSha256`, `mode`, `model`, `gitCommit`을 필수로 묶는다. E11-3의 실제 신원 mapping은 artifact 밖의 접근 제한된 운영 기록에만 둔다. E11-3 status는 `측정|미측정`만 사용한다. E11-5는 이 envelope와 별도로 E5-5, E6-7, E7-3, E8-5, E10-2의 evidence를 consume하고 각 owner를 명시한다.


---

### Task 1: E5-8a 합성 fixture와 무결성 manifest

**Files:**
- Modify: `.gitignore` (`artifacts/pilot/fixtures/s13-v1/audio/`)
- Create: `scripts/stt/fixtures/manifest.json`
- Create: `scripts/stt/fixtures/reference/{sessionId}.json`
- Create: `scripts/stt/fixtures/licenses.json`
- Create: `scripts/stt/fetch_fixture.py`
- Create: `scripts/stt/verify_fixture.py`
- Create: `artifacts/pilot/fixtures/s13-v1-verification.json`
- Test: E5-8a fixture manifest/hash/license test owned by the E5-8a ticket

**Interfaces:**
- Consumes: `docs/specs/S13-pilot-metrics.md` and deterministic scripted dialogue source.
- Produces: hash-addressed GitHub Release asset tag `s13-fixture-v1`, exact 150-session manifest and verification artifact; no WAV is committed.

- [ ] **Step 1: Create the fixed case/session inventory**

Generate exactly `case-001` through `case-030`, each with `session-01` through `session-05`. Emit a stable order and reject any duplicate or missing ID. Keep `trainCaseIds` empty.

- [ ] **Step 2: Write two-speaker reference data and license manifest**

Every session is 60~180 seconds, has two speakers, transcript, speaker truth, silence ranges and overlap ranges. A single-speaker or truth-free shortcut is invalid. Keep only reference JSON and licenses in the repository; the release asset contains synthetic WAV files.

- [ ] **Step 3: Fetch and verify the release asset**

`fetch_fixture.py` downloads the `s13-fixture-v1` asset to gitignored `artifacts/pilot/fixtures/s13-v1/audio/` and verifies every manifest audio hash. `verify_fixture.py` writes `artifacts/pilot/fixtures/s13-v1-verification.json` binding manifest hash, all 150-session count, 60~180 duration, two-speaker truth, silence/overlap range and license checks.

```bash
python3 scripts/stt/fetch_fixture.py --manifest scripts/stt/fixtures/manifest.json --release-tag s13-fixture-v1
python3 scripts/stt/verify_fixture.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/fixtures/s13-v1-verification.json
```

- [ ] **Step 4: Commit only tracked fixture metadata**

```bash
git add scripts/stt/fixtures scripts/stt/fetch_fixture.py scripts/stt/verify_fixture.py
git commit -m "feat(pilot): fix S13 synthetic fixture metadata"
```

---


### Task 2: E11-2a 독립 감지 answer key

**Files:**
- Create: `scripts/pilot/build_detection_key.py`
- Create: `artifacts/pilot/answer-key/s13/detection-answer-key.json`
- Test: `scripts/pilot/test_detection_key.py`

**Interfaces:**
- Consumes: `scripts/stt/fixtures/manifest.json`, `artifacts/pilot/fixtures/s13-v1-verification.json` and its reference data, never model predictions.
- Produces: `s13-detection-v1` rows keyed by case, session, criterion.

- [ ] **Step 1: Define the criterion inventory in the scripted cases**

Give every detection condition an opaque, stable `criterionId` and write one boolean truth row per case-session-criterion. Deduplicate rows by the complete three-field match key. Gold is exactly the rows with `expected=true`.

- [ ] **Step 2: Generate and hash the answer key**

Require `artifacts/pilot/fixtures/s13-v1-verification.json` to bind the current fixture manifest hash and pass all count, duration, two-speaker truth, range and license checks. Refuse to overwrite an existing answer key with different bytes; emit its SHA-256 for later reports. Keep author and reviewer independent of E2-4c and E11-2 implementers.

- [ ] **Step 3: Verify answer-key independence**

The builder accepts no predictions path or model output option. Test that all 150 sessions are represented and that changing a prediction file cannot change answer-key bytes.

- [ ] **Step 4: Run the key proof**

```bash
python3 scripts/pilot/build_detection_key.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/answer-key/s13/detection-answer-key.json
```

Expected: answer key is independently generated, hash-pinned, and complete.


---

### Task 3: E5-8 STT metric runner

**Files:**
- Create: `scripts/stt/benchmark.py`
- Create: `scripts/pilot/test_stt_benchmark.py`
- Create: `artifacts/pilot/results/{runId}/stt-metrics.json`

**Interfaces:**
- Consumes: verified `scripts/stt/fixtures/manifest.json`, selected engine, same hardware and 150 audio files.
- Produces: CER, repetition rate, RTF, DER, safety, threshold status and numeric evidence without raw text.

- [ ] **Step 1: Pin normalization and formulas**
Implement NFC, LF, whitespace collapse, trim and code-point Levenshtein for CER. For repetition, concatenate normalized hypothesis, remove exactly `.`, `?`, `!`, `。`, `？`, `！`, `…`, CR and LF before detection, retain punctuation only for reporting, search maximal consecutive substrings with period p=1~80 repeated at least 4 times, `excess=(repeats-1)*p`, select non-overlapping candidates by excess descending, p ascending, start offset ascending, and record `Nhyp`, p, repeats, start/end offsets per session. Compute safety events from character alignment with the 20-codepoint insertion and consecutive reference-turn 10-second deletion rules. Measure RTF only between engine invocation and result return, excluding setup, queue and one warm-up. Compute DER with collar 0 seconds from required two-speaker truth: silence is FA, overlap is scored against both speakers, with no excluded regions.

- [ ] **Step 2: Run each engine over the same manifest**

Reject unverified manifests or `artifacts/pilot/fixtures/s13-v1-verification.json`, missing session files, changed hashes, non-`synthetic` source metadata, missing speaker truth, duration outside 60~180 seconds, or anything other than two speakers. Record mode, engine and CPU/RAM/GPU/compute/thread metadata, preserve per-session values, and calculate pooled CER/DER/repetition ratios plus total-wall/total-audio RTF. Apply the RTF gate to the Windows CPU target.

- [ ] **Step 3: Apply pre-registered thresholds once**

Use the exact values in `S13-pilot-metrics.md`. A valid value below/above a threshold is FAIL; a safety event makes safety FAIL; missing denominator is 미측정. Do not expose transcript text in the result JSON.

- [ ] **Step 4: Run the STT proof**

```bash
python3 scripts/stt/verify_fixture.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/fixtures/s13-v1-verification.json
python3 scripts/stt/benchmark.py --manifest scripts/stt/fixtures/manifest.json --out artifacts/pilot/results/{runId} --engines faster-whisper,qwen3-asr
```

Expected: one immutable, hash-linked result per engine, with per-session and pooled CER, repetition rate, RTF, DER and safety.

---

### Task 4: E11-2 감지 precision/recall

**Files:**
- Create: `scripts/pilot/detection_metrics.py`
- Create: `scripts/pilot/test_detection_metrics.py`
- Create: `artifacts/pilot/results/{runId}/detection-metrics.json`

**Interfaces:**
- Consumes: prediction artifact bound to fixture/hash/mode/model/commit, `s13-detection-v1`, verified `scripts/stt/fixtures/manifest.json` and `artifacts/pilot/fixtures/s13-v1-verification.json`.
- Produces: TP, FP, FN, precision, recall, fixed 95% bootstrap intervals and incorrect example IDs.

- [ ] **Step 1: Match events by the complete key**

Gold is `expected=true`. Treat duplicate predictions as a recorded integrity violation and FAIL, never count them twice. Any prediction key absent from the answer key is integrity FAIL. Compute `TP=pred∩gold`, `FP=pred-gold`, `FN=gold-pred` and list every wrong key as an example ID without copying content.


- [ ] **Step 2: Bootstrap at case level**

Sort the 30 case IDs, use Python `random.Random(51313).choices(caseIds, k=30)` for exactly 10,000 replicates, and carry all five sessions and criteria for each sampled case. Use nearest-rank 2.5th and 97.5th percentiles. If a denominator is zero, that estimate or interval is 미측정, not a zero-width PASS.

- [ ] **Step 3: Apply point and lower-bound thresholds**

PASS requires point precision and recall at least 0.80 and each interval lower bound at least 0.70. Any valid miss is FAIL; missing predictions or an invalid key is recorded as the specified status and reason.

- [ ] **Step 4: Run the detection proof**

```bash
python3 scripts/pilot/detection_metrics.py --predictions artifacts/pilot/results/{runId}/detection-predictions.json --answer-key artifacts/pilot/answer-key/s13/detection-answer-key.json --out artifacts/pilot/results/{runId}/detection-metrics.json
```

Expected: deterministic counts and nearest-rank intervals for the same inputs, seed and prediction envelope.
### Task 5: E11-3 practitioner time and AI edit amount

**Files:**
- Create: `scripts/pilot/usability.mjs`
- Test: `scripts/pilot/usability.test.mjs`
- Create: `artifacts/pilot/results/{runId}/practitioner-metrics.json`

**Interfaces:**
- Consumes: the same synthetic case/session inventory in all three modes and practitioner event timestamps.
- Produces: stable pseudonymous practitioner 3명별 writingSeconds, preparationSeconds, editOps and editRate, plus mode summaries with `측정|미측정` only.

- [ ] **Step 1: Record event boundaries**

Use monotonic timestamps: `t_firstInput` to `t_savedManual` for writing, `t_contextOpened` to the actual `상담 시작` button click for preparation. Record stable pseudonymous practitioner IDs and exclude idle setup, metadata and approval clicks from AI edit amount.

- [ ] **Step 2: Calculate edit amount and missing states**

Compare initial AI draft with final saved text using the same Levenshtein normalization, with `editOps=S+D+I` and `editRate=editOps/max(1,len(initialDraft))`. AI Off or absent draft is 미측정, not zero. Malformed or reversed timestamps are invalid session measurements, not PASS or FAIL.

- [ ] **Step 3: Run the three-mode usage proof**

```bash
pnpm pilot:usability --manifest scripts/stt/fixtures/manifest.json --modes community-cloud,local-single,local-office --out artifacts/pilot/results/{runId}/practitioner-metrics.json
```

Expected: all three mode labels are present, raw notes and identities are absent, and valid elapsed times are reproducible from event logs.

---

### Task 6: E11-5 evidence-linked impact report

**Files:**
- Create: `scripts/stt/report.py`
- Create: `scripts/pilot/test_report.py`
- Create: `artifacts/pilot/reports/E11-5-pilot-impact-report.md`
**Interfaces:**
- Consumes: E5-8a verification, E5-8, E11-2a, E11-2 and E11-3 immutable artifacts, plus separate evidence from E5-5 privacy/masking, E6-7/E7-3/E8-5 backup and E10-2 security/supply-chain.
- Produces: report with mode/engine/run, artifact hashes, metric statuses, failure reasons, wrong example IDs and named evidence owners.

- [ ] **Step 1: Verify every input envelope**

Reject stale fixture or answer-key hashes, missing verification artifact, missing owner artifacts and altered bytes. Preserve owner status, do not recompute with a different threshold or silently replace 미측정 with zero. Name E5-8a as fixture owner, E5-8 as STT owner, E11-2a as answer-key owner, E11-2 as detection owner, E11-3 as practitioner owner, E5-5 as privacy/masking owner, E6-7/E7-3/E8-5 as backup owners and E10-2 as security/supply-chain owner.

- [ ] **Step 2: Render the report without source content**

Include the three-mode table, metric formulas/threshold references, PASS/FAIL/미측정 rows, owner ticket, evidence path, hash, commit and next owner for missing data. Include no transcript, audio, PII or secret.

- [ ] **Step 3: Run the report proof**

```bash
python3 scripts/stt/report.py --inputs artifacts/pilot/results/{runId} --out artifacts/pilot/reports/E11-5-pilot-impact-report.md
```

Expected: the report links every metric to its named owner artifact and preserves failure and missing-data states.

- [ ] **Step 4: Commit the report implementation**

```bash
git add scripts/stt/report.py artifacts/pilot/results artifacts/pilot/reports
git commit -m "feat(pilot): report S13 synthetic metrics"
```

---

## Handoff and review gates

- E5-8a verification must write `artifacts/pilot/fixtures/s13-v1-verification.json` and pass before E5-8 or E11-2a consumes the fixture.
- E11-2a answer-key bytes and hash must be fixed before E11-2 consumes predictions.
- E5-8 and E11-2 report failures as-is. No post-result threshold, normalizer, seed, answer-key, or fixture mutation is allowed.
- E11-3 compares Cloud, Single and Office orchestration using the same synthetic inventory; it does not introduce real participant data.
- E11-5 is the only report assembler. It names E5-5 privacy/masking, E6-7/E7-3/E8-5 backup, and E10-2 security/supply-chain as separate evidence owners and does not replace any failed owner ticket or legal gate.
- Real-data continuation belongs to E12-5 and must remain separate from this synthetic result set.
