# CCC-243 STT Benchmark Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the deterministic `s13-v1` synthetic two-speaker Korean audio fixture required by S13, with reference transcripts, speaker truth, hashes, license evidence, fetch, and integrity verification.

**Architecture:** A standard-library Python generator renders project-owned synthetic scripts through pinned eSpeak NG Korean voice variants, composes deterministic mono PCM WAV files with declared silence and overlap, and emits canonical reference and manifest JSON. WAV files stay out of git and ship as one hash-verified GitHub Release archive. Separate fetch and verify CLIs treat the release as untrusted input and fail closed before downstream benchmarks run.

**Tech Stack:** Python 3.12 standard library, eSpeak NG, GitHub Releases, Node package scripts.

**Spec:** `docs/specs/S13-pilot-metrics.md`

## Global Constraints

- Generate exactly 30 cases × 5 sessions = 150 sessions; every session is 60–180 seconds with two speakers, at least one silence range, and at least one overlap range.
- Use only project-authored synthetic Korean scripts. Never use real counseling audio, participant data, PII, operational credentials, voice cloning, proprietary voices, or MBROLA voices.
- Use pinned eSpeak NG `ko` voice variants. Record eSpeak NG version, executable SHA-256, GPL-3.0-or-later source URL, output license, and attribution in `licenses.json`.
- Treat the generated WAV bundle as test data only. Synthetic results do not establish real conversational STT accuracy.
- Commit manifests, references, tests, scripts, and verification JSON only. Keep `artifacts/pilot/fixtures/s13-v1/audio/` ignored.
- The release tag is `s13-fixture-v1`; changing scripts, references, audio, licenses, or hashes requires a new fixture version instead of overwriting established results.
- Do not touch pages, components, CSS, design tokens, design documents, or design artifacts.

---

### Task 1: Fixture validation contract

**Files:**
- Create: `scripts/stt/tests/test_fixture_tools.py`
- Create: `scripts/stt/fixture_tools.py`
- Create: `scripts/stt/verify_fixture.py`

**Interfaces:**
- Produces: `verify_fixture(manifest_path: Path, audio_dir: Path) -> dict` and CLI `--manifest`, `--audio-dir`, `--out`.
- Consumes: canonical manifest, references, licenses, and fetched PCM WAV files.

- [x] **Step 1: Write failing validation tests**

Use temporary literal fixtures to prove the verifier rejects a missing session, wrong SHA-256, duration outside 60–180 seconds, speaker count other than two, absent silence/overlap, invalid or overlapping declared ranges, missing license entries, and a WAV whose actual duration differs from the manifest. Add one valid two-session miniature fixture that must produce a PASS receipt without transcript or audio content.

- [x] **Step 2: Run the tests and confirm RED**

Run:

```bash
python3 -m unittest discover -s scripts/stt/tests -p "test_*.py" -v
```

Expected: import failure because `scripts/stt/fixture_tools.py` does not exist.

- [x] **Step 3: Implement the minimum validator**

Use only `hashlib`, `json`, `pathlib`, and `wave`. Canonical JSON uses UTF-8, sorted keys, compact separators, and one trailing LF. Hash the transcript UTF-8 bytes, the canonical `speakerTurns` array, each WAV file, `licenses.json`, and the raw manifest bytes. Validate exact session IDs, unique case/session pairs, reference structure, sorted nonnegative ranges within duration, and two distinct speaker labels.

- [x] **Step 4: Emit privacy-safe verification evidence**

The receipt contains fixture ID, manifest SHA-256, session count, min/max duration, total duration, count of two-speaker sessions, count with silence, count with overlap, license manifest SHA-256, checked file count, and `status: "PASS"`. It never copies transcript text, speaker turns, or audio bytes.

- [x] **Step 5: Run tests and confirm GREEN**

Run the same unittest command. Expected: all tests pass.

### Task 2: Safe release fetcher

**Files:**
- Modify: `scripts/stt/tests/test_fixture_tools.py`
- Create: `scripts/stt/fetch_fixture.py`

**Interfaces:**
- Produces: CLI `--manifest`, `--release-tag`, optional `--archive` for an already-downloaded test/archive, and `--audio-dir`.
- Consumes: manifest archive name/SHA-256 plus GitHub release metadata for `SocialSolidarityBank/CCC`.

- [x] **Step 1: Write failing fetch tests**

Create deterministic tiny tar archives in temporary directories. Prove the fetcher rejects archive hash mismatch, absolute paths, `..` traversal, symlinks, missing WAV members, unexpected members, and a release-tag mismatch. Prove a valid archive extracts atomically and leaves no partial destination on failure.

- [x] **Step 2: Run tests and confirm RED**

Expected: import failure because `fetch_fixture.py` does not exist.

- [x] **Step 3: Implement the minimum fetcher**

Use `urllib.request`, `tarfile`, `tempfile`, and atomic directory rename. Resolve the GitHub Release by the exact tag, download the exact archive filename, verify archive SHA-256 before extraction, allow only manifest-declared regular WAV paths, verify every extracted WAV hash, and replace the destination only after all checks pass.

- [x] **Step 4: Run tests and confirm GREEN**

Run the focused unittest suite. Expected: all tests pass.

### Task 3: Deterministic synthetic generator

**Files:**
- Modify: `scripts/stt/tests/test_fixture_tools.py`
- Create: `scripts/stt/generate_fixture.py`
- Create: `scripts/stt/fixtures/licenses.json`
- Create: `scripts/stt/fixtures/manifest.json`
- Create: `scripts/stt/fixtures/reference/case-001-session-01.json` through `case-030-session-05.json`

**Interfaces:**
- Produces: `generate(output_root: Path, espeak_path: Path) -> GenerationReceipt`, 150 WAV files, reference JSON, manifests, and deterministic `s13-fixture-v1.tar.gz`.
- Consumes: checked-in synthetic script templates and pinned eSpeak NG executable.

- [x] **Step 1: Write failing generation-plan tests**

Assert literal case/session IDs, 150 unique sessions, two speaker labels, Korean nonempty turns, one deliberate overlap, one deliberate silence, no phone/email/account patterns, and stable output from two calls to the pure timeline planner.

- [x] **Step 2: Run tests and confirm RED**

Expected: import failure because `generate_fixture.py` does not exist.

- [x] **Step 3: Implement pure script and timeline planning**

Define 30 synthetic support-case themes and five session-stage templates in code. Use fixed speaker labels `SPEAKER_00` and `SPEAKER_01`, fixed voice variants, fixed rate/pitch, and deterministic start-time rules. Keep content non-identifying and test-only. No random module or clock data enters reference content.

- [x] **Step 4: Implement audio rendering and mixing**

Call eSpeak NG once per turn with explicit Korean voice, speed, pitch, amplitude, and WAV output. Read signed 16-bit mono PCM with `wave`, mix turns by integer sample index with clamping, insert planned silence, include at least one overlap, and pad to 60 seconds when needed. Reject sessions over 180 seconds instead of truncating speech.

- [x] **Step 5: Implement canonical outputs**

Write reference JSON and licenses first, derive their hashes, write manifest entries, then build a sorted tar.gz with fixed member mode, uid/gid, owner names, and timestamp so the archive hash is stable across runs. Record generator versions and licenses without embedding local paths.

- [x] **Step 6: Run tests and confirm GREEN**

Run the focused unittest suite. Expected: all tests pass without invoking eSpeak NG except the explicit integration smoke.

### Task 4: Generate, publish, fetch, and verify `s13-v1`

**Files:**
- Create: `artifacts/pilot/fixtures/s13-v1-verification.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: GitHub Release tag `s13-fixture-v1` with one immutable tar.gz asset and a tracked PASS receipt.
- Consumes: Task 1–3 scripts and exact eSpeak NG version.

- [x] **Step 1: Install and record eSpeak NG**

Use the verified local package manager, record `espeak-ng --version` and executable SHA-256 in `licenses.json`, and run a two-voice Korean integration smoke. Do not add eSpeak NG to the product runtime or production dependencies.

- [x] **Step 2: Generate the full fixture twice**

Generate into two clean temporary roots and compare every reference, manifest, license, WAV, and archive hash. Any mismatch is a failure; do not normalize it away.

- [x] **Step 3: Publish the release asset**

Create the `s13-fixture-v1` GitHub Release from the verified archive. Do not overwrite an existing asset with different bytes. Record the final archive name and SHA-256 in manifest.

- [x] **Step 4: Fetch into a clean directory**

Run:

```bash
python3 scripts/stt/fetch_fixture.py --manifest scripts/stt/fixtures/manifest.json --release-tag s13-fixture-v1
```

Expected: 150 WAV files downloaded and hash-verified under the ignored audio directory.

- [x] **Step 5: Verify the full fixture**

Run:

```bash
python3 scripts/stt/verify_fixture.py --manifest scripts/stt/fixtures/manifest.json --audio-dir artifacts/pilot/fixtures/s13-v1/audio --out artifacts/pilot/fixtures/s13-v1-verification.json
```

Expected: PASS with 150 sessions, every duration in 60–180 seconds, 150 two-speaker truths, 150 silence declarations, 150 overlap declarations, and zero hash/license errors.

- [x] **Step 6: Wire the focused CI check**

Add `test:stt-fixtures` to `package.json` using standard-library unittest and run the same command in the existing Python `pipeline-test` job. CI validates scripts and tracked metadata without downloading the large release asset; the tracked verification receipt proves the full release fetch.

- [x] **Step 7: Run repository verification**

Run:

```bash
pnpm test:stt-fixtures
pnpm guard:doc-numbers
pnpm guard:secrets
```

Expected: all commands pass.

- [ ] **Step 8: Commit and publish**

Commit only the scripts, tests, tracked manifests/references, verification receipt, and CI wiring. Open a PR for CCC-243, obtain independent review, merge after CI passes, then add a plain-language Linear completion comment and set CCC-243 to Done.
