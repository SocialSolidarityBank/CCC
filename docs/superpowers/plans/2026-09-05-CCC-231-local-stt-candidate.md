# E5-2 Local STT Candidate Implementation Plan

**Goal:** Add an explicitly selected faster-whisper int8 CPU candidate while preserving silence chunking, repetition handling, and source-relative timestamps.

**Architecture:** Extend the existing `build_engine` factory and manifest-backed model registry. Keep `transcribe_audio` as the only orchestration path. Candidate inference uses a pinned local snapshot, loads once per engine instance, and never falls back to another engine. Agent configuration defaults to `off`; product `sttMode=off`, `sttEngine=null`, and the empty approved engine registry remain unchanged.

**Tech Stack:** Python standard library, faster-whisper, CTranslate2 CPU int8, Hugging Face Hub, existing ffmpeg chunking.

**Spec:** `CCC_OPEN_PILOT_PLAN.md` E5-2, `docs/specs/S5-agent-job-contract-v2.md`, D77, Linear CCC-231.

## Preconditions and boundaries

- Worktree: `.worktrees/work-a`; topic: `e5-2-local-stt-candidate`; fetched base: `103c7a50abbb34f83e24590129804ab01421763d`.
- Linear prerequisite CCC-228 is Done; all inverse relations were read and no open blocker remains.
- No UI, design artifacts, preview deployment, production settings, engine approval, or STT-G1~G3 decision changes.
- Existing tests retain their behavioral assertions. New checks defend disabled STT, explicit candidate selection, model integrity, lazy generator consumption, and no fallback.
- Model access verification inherited from E0-4 uses the five pinned Hugging Face models in `artifacts/external-applications/README.md`; credentials are injected only and never printed.

## Implementation

- [x] Extend `apps/pipeline/tests/test_transcribe.py` with candidate behavior and integrity checks; add disabled/configuration cases to the existing worker tests. The four new checks failed before implementation and passed afterward.
- [x] Update `apps/pipeline/ccc_pipeline/transcribe.py`, `model_registry.py`, and `supply-chain/model-license-manifest.json`: pin the candidate model and its published `model.bin` SHA-256. Reuse `Engine` and `Segment`; keep chunking/repetition implementation unchanged.
- [x] Update `config.py` and the audio entry in `worker.py`: `CCC_STT_ENGINE` defaults to `off`; accept explicit `faster-whisper-int8-cpu` only when `CCC_RUNTIME_ENVIRONMENT=preview`. Reject disabled audio before downloading or constructing ML layers. Text processing remains independent.
- [x] Pin `faster-whisper==1.2.1` in `requirements-ml.txt` and update the release fixture and required model/hash guard.

## Verification

- [x] Run pipeline unittest discovery and relevant release checks after all edits: 136 pipeline tests and 26 release tests passed. Document-number guard passed.
- [x] Exercise real synthetic Korean inference through `transcribe_audio` in an isolated Python environment. The full requirements dry-run resolved 112 packages; the final adapter smoke uses its compatible `huggingface-hub==0.36.2` and `tokenizers==0.21.4` versions. Evidence: [`e5-2-local-stt-candidate-smoke.json`](../../../artifacts/pilot/e5-2-local-stt-candidate-smoke.json). Two real chunks produced eight segments inside the audio duration plus a one-second tolerance; later-chunk timestamps were present. Exact offset arithmetic and repetition failure/retry behavior are covered by the deterministic tests, not claimed from the synthetic smoke alone. No Windows performance or product configuration measurement was performed.
- [x] Verify authenticated downloads of both gated pyannote revisions and the three inherited public models: 22 files passed pinned Git blob or Hub LFS hash comparisons. File-level SHA-256 evidence: [`e5-2-model-downloads.json`](../../../artifacts/pilot/e5-2-model-downloads.json). This is not a diarization or NER inference verdict.
- [x] Update the pipeline README, inherited model-access evidence and CCC-231 with exact results. Keep Linear `In Review` until integration is complete.

## Review outcome

Two independent read-only reviews found no blocking adapter or integrity defects. The evidence was corrected to distinguish unchanged product policy from actual configuration verification, and the adapter smoke was repeated with the Hub/tokenizer versions compatible with the full pipeline requirements. The inherited `complete:false` ML lock remains an E10-1 release concern. Approved-job routing and future off-worker claim retries remain outside this candidate-only change.

## Delivery scope

The follow-on instruction is understood as publishing the verified E5-2 changes in a pull request and checking CI, without merging. Qwen3-ASR execution preparation and the two-candidate benchmark remain separate follow-on work.
