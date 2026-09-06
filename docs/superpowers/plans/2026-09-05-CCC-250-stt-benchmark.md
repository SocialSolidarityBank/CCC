# E5-8 STT Benchmark Implementation Plan

**Goal:** Execute faster-whisper and benchmark-only Qwen3-ASR against the immutable S13 fixture and report per-session and pooled CER, repetition, RTF, DER and safety without transcripts.

**Architecture:** Reuse the fixture verifier and pipeline audio orchestration. Keep metrics pure and independent of model inference. Benchmark-only model runners receive audio paths, never reference text; the parent reads reference data only for scoring. Separate Python environments avoid changing product dependencies for Qwen.

**Tech Stack:** Python 3.12, stdlib metrics, existing faster-whisper and pyannote adapters, official qwen-asr Transformers backend.

**Spec:** `docs/specs/S13-pilot-metrics.md`, `CCC_OPEN_PILOT_PLAN.md` E5-8, CCC-250.

## Constraints

- Starting base: `origin/main` at `089682a`; clean reused `work-a`, new branch `e5-8-stt-benchmark`.
- CCC-231 and CCC-243 are Done. No open blocking relation remains; related canceled CCC-134 is not a blocker.
- Fixture: all 150 sessions, 30 cases, 5 sessions each; no reference edits, test fitting, cherry-picking or threshold changes.
- Thresholds: CER <= 0.15, repetition <= 0.01, Windows CPU RTF <= 1.00, DER <= 0.20, safety event count = 0.
- The implementation freezes minimum-edit alignment ties as equal/diagonal, substitution, deletion, insertion. Safety is conditional on that deterministic alignment, not alignment-invariant detection of factual hallucination.
- Result artifacts allow fixture IDs, numeric outcomes, hashes, fixed status/error codes and validated model/runtime metadata. No raw transcript/audio, credentials or upstream error bodies.
- No product engine registration, configuration activation, UI, deployment or merge.
- Qwen candidate: `Qwen/Qwen3-ASR-1.7B`, matching the existing candidate research. No automatic model substitution.
- Runtime assessment: Q selected Windows for the full run and skipping the Mac full run. Native Windows 11 Pro build 26200 and AMD Ryzen 7 3700X (8 cores, 16 logical processors, approximately 24 GiB RAM) are now verified through authenticated SSH over Tailscale. Python 3.10, uv and Git are present; Python 3.12, FFmpeg and model caches still require isolated setup.
- Q approved a checkpoint commit and push to the public task branch for Windows execution. The MacBook remains the source-code owner; Windows receives an immutable Git checkpoint for measurement only. No merge, deployment or product activation is authorized.

## Ownership and interfaces

1. Metrics slice owns `scripts/stt/metrics.py` and `scripts/stt/tests/test_metrics.py`.
   - `score_session(reference: dict, hypothesis: str, predicted_turns: list[dict], engine_wall_seconds: float, duration_seconds: float, windows_cpu: bool) -> dict`.
   - Reference shape: `transcript`, ordered `speakerTurns` containing `start`, `end`, `speaker`, `text`.
   - Predicted turns contain `start`, `end`, `speaker`; no truth-derived labels are supplied to inference.
   - Return keys: `cer`, `repetition`, `rtf`, `der`, `safety`; each includes `status` (`PASS`, `FAIL`, `UNMEASURED`) and numeric components. `pool_sessions(rows: list[dict], windows_cpu: bool) -> dict` consumes the same keys and sums numerators/denominators, never session means.
2. Engine slice owns `scripts/stt/benchmark_engines.py`, `scripts/stt/benchmark-models.json`, `scripts/stt/requirements-qwen.txt`, and `scripts/stt/tests/test_benchmark_engines.py`.
   - CLI worker receives `--engine faster-whisper|qwen3-asr|diarization`, `--audio-dir`, `--device cpu|mps|cuda`, `--threads`, and a JSON-lines stdin stream of `{sessionId, audioPath}`. No reference path or transcript input.
   - One loaded model, warm-up on a separate synthetic silence WAV before requests, then one output JSON line per input. ASR response: `{sessionId, text, engineWallSeconds, metadata}`. Diarization response: `{sessionId, turns, engineWallSeconds, metadata}`. Failures: `{sessionId, errorCode}` without raw exception text. Model downloads and initialization are outside measured time.
   - Resolve relative audio paths inside `--audio-dir`; reject resolved path escapes. Warm-up uses separate 1-second, 16 kHz mono PCM16 silence. Measured wall time includes shared chunking, ASR retries and the candidate's forced alignment; shared diarization is measured separately.
   - Score the selected post-retry hypothesis before repetition collapse via `transcribe_audio(on_chunk=...)`. A completed process must also reach clean EOF without extra predictions. One shared diarization failure invalidates both candidate runs.
   - Metadata binds exact model revision/hash, versions, backend, device and threads. Models are pinned and validated before inference. Worker stdout is an internal pipe; raw hypotheses are never persisted by the parent.
3. Main owns `scripts/stt/benchmark.py`, its focused orchestration tests, execution plan, documentation and runtime evidence. Main validates receipt and every audio hash, runs model workers without ground truth, scores results, and writes immutable per-session and pooled reports under a fresh `artifacts/pilot/results/{runId}/`.

## Execution

- [x] Verify fetched audio against existing fixture receipt and establish usable execution environments.
- [x] Implement pure metrics, including Unicode alignment, exact S13 repetition selection, speaker-label permutation and overlap accounting, safety boundaries and pooled ratios.
- [x] Implement real pinned candidate workers and shared diarization inference without product registration or automatic fallback.
- [x] Implement the CLI with strict fixture integrity, complete session accounting, runtime-derived RTF eligibility, redacted failures and immutable output.
- [x] Run focused boundary/regression checks and existing fixture/pipeline checks: 78 STT tests, 137 pipeline tests, and all 150 fixture sessions passed verification.
- [x] Execute exploratory inference for both ASR candidates and shared diarization. [Sanitized observations](../../../artifacts/pilot/e5-8-macos-probes.json) are not gate evidence or a controlled speed comparison.
- [ ] Run all 150 sessions on Windows CPU after isolated dependency/model setup and a native smoke check. No full gate has been measured.
- [x] Review independent scoring and runtime evidence, record unmeasured Windows and mode-specific requirements, and keep CCC-250 open until required runtime evidence exists.

## Verification evidence

- `python -m unittest discover -s scripts/stt/tests -p 'test_*.py'`: 78 passed under Python 3.12.13.
- From `apps/pipeline`, `python -m unittest discover -s tests -p 'test_*.py'`: 137 passed.
- `python scripts/stt/verify_fixture.py --manifest scripts/stt/fixtures/manifest.json --out <temporary-receipt>`: 150 sessions passed.
- Actual subprocess smoke preserved Korean JSON through CP1252 and CP949 worker output into the UTF-8 parent. It verifies encoding interoperability, not Windows runtime performance.
- Independent review found nested deleted-turn event ranges and Windows pipe encoding defects. Both failed targeted regression checks before the fixes and passed afterward.
- Cold-read fixes clarify prerequisites, status propagation, timer boundaries and shared DER. Metric definitions and model pins remain references to their canonical files, not copies. The full Windows comparison remains unmeasured, and exploratory Mac observations are not reproducible gate evidence.
