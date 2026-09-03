#!/usr/bin/env python3
from __future__ import annotations
import argparse
import gzip
import hashlib
import io
import shutil
import subprocess
import sys
import tarfile
import tempfile
import wave
from array import array
from pathlib import Path

from fixture_tools import canonical_json_bytes, sha256_bytes, sha256_file

CASE_THEMES = (
    ("주거비 부담", "안정적인 거주 계획", "월세 부담이 커짐", "지출 항목을 다시 정리"),
    ("구직 준비", "지속 가능한 일자리 탐색", "지원 과정이 복잡함", "지원 일정을 나누어 진행"),
    ("채무 조정", "상환 부담 완화", "여러 납부일이 겹침", "채무 목록을 한 장으로 정리"),
    ("생활비 관리", "필수 지출 우선순위 확립", "예상 밖 지출이 잦음", "주간 예산을 기록"),
    ("의료비 부담", "치료와 생계의 균형", "진료비가 계속 발생함", "지원 가능한 제도를 확인"),
    ("직업 훈련", "필요 기술 습득", "교육 시간 확보가 어려움", "학습 시간을 고정"),
    ("돌봄 일정", "돌봄과 근로 일정 조정", "갑작스러운 일정 변경이 많음", "대체 돌봄 경로를 확인"),
    ("임대차 갱신", "거주 계약 안정", "필요 서류가 흩어져 있음", "계약 자료를 한곳에 모음"),
    ("공과금 체납", "기본 생활 서비스 유지", "납부 우선순위가 불명확함", "기관별 분납 조건을 확인"),
    ("근로 시간 조정", "소득과 건강의 균형", "불규칙한 근무가 이어짐", "가능한 근무 조건을 정리"),
    ("취업 서류", "지원서 완성", "경력 내용을 정리하기 어려움", "경험을 항목별로 작성"),
    ("이사 준비", "안전한 이동 계획", "비용과 일정이 동시에 부담됨", "필수 작업부터 순서를 정함"),
    ("자녀 교육비", "교육비 지출 안정", "학기별 비용 변동이 큼", "고정비와 변동비를 구분"),
    ("소득 공백", "단기 생계 안정", "다음 수입 시점이 불확실함", "사용 가능한 지원을 확인"),
    ("사업 재정비", "소규모 사업 지출 통제", "매출과 비용 기록이 섞임", "사업비와 생활비를 분리"),
    ("교통비 부담", "통근 비용 절감", "이동 경로가 자주 바뀜", "대체 경로와 비용을 비교"),
    ("식비 관리", "건강한 식비 계획", "외식 지출이 늘어남", "주간 식단과 구매 목록을 작성"),
    ("보험료 점검", "보장과 지출의 균형", "계약 내용을 이해하기 어려움", "보장 항목을 표로 정리"),
    ("근로계약 확인", "근로 조건 이해", "계약 용어가 익숙하지 않음", "확인이 필요한 문장을 표시"),
    ("공공지원 신청", "신청 절차 완료", "제출 서류 종류가 많음", "서류를 단계별로 준비"),
    ("주거 환경 개선", "안전한 생활 공간 확보", "수리 요청이 늦어짐", "요청 내용과 일정을 기록"),
    ("가계 기록", "월별 흐름 파악", "현금 지출이 빠짐", "지출 직후 간단히 기록"),
    ("재취업 계획", "경력 전환 준비", "희망 직무가 넓게 퍼져 있음", "우선 직무를 두 가지로 좁힘"),
    ("건강 일정", "정기적인 건강 관리", "예약을 자주 놓침", "일정을 한 달 단위로 확인"),
    ("긴급 지출", "예비비 마련", "작은 돌발 비용이 반복됨", "필수 예비비 기준을 정함"),
    ("가족 지원", "가족 간 비용 분담 정리", "역할과 금액이 자주 바뀜", "가능한 범위를 먼저 합의"),
    ("통신비 절감", "고정비 줄이기", "사용하지 않는 서비스가 있음", "계약 항목을 하나씩 확인"),
    ("학습 계획", "자격 준비 지속", "일정이 밀리면 중단하게 됨", "짧은 학습 단위를 반복"),
    ("서류 보관", "중요 문서 관리", "필요할 때 문서를 찾기 어려움", "종류별 보관 위치를 정함"),
    ("지역 자원 연결", "가까운 지원 자원 활용", "어디에 문의할지 모름", "기관별 역할과 문의 순서를 기록"),
)

SESSION_STAGES = (
    ("상황을 처음 확인하는 회차", "현재 어려움과 원하는 변화를 함께 정리"),
    ("세부 목표를 정하는 회차", "측정할 수 있는 작은 목표를 합의"),
    ("첫 실행을 점검하는 회차", "해본 일과 막힌 지점을 구분"),
    ("계획을 조정하는 회차", "부담이 큰 단계는 줄이고 가능한 행동을 남김"),
    ("다음 단계를 정하는 회차", "유지할 방법과 다음 확인 내용을 합의"),
)


def _turns(topic: str, goal: str, obstacle: str, action: str, stage: str, focus: str) -> list[dict[str, object]]:
    lines = (
        ("SPEAKER_00", f"오늘은 {stage}입니다. 먼저 {topic}과 관련해 지금 상황을 천천히 확인하겠습니다."),
        ("SPEAKER_01", f"가장 신경 쓰이는 일은 {obstacle}이라는 점입니다. 혼자 정리하려니 순서를 잡기 어려웠습니다."),
        ("SPEAKER_00", f"말씀하신 내용을 바탕으로 이번에는 {focus}하는 데 집중해 보겠습니다."),
        ("SPEAKER_01", f"제가 원하는 방향은 {goal}입니다. 한 번에 모두 바꾸기보다 할 수 있는 것부터 하고 싶습니다."),
        ("SPEAKER_00", "최근에 조금이라도 도움이 되었던 방법이나 이미 해본 일이 있었는지 알려주세요."),
        ("SPEAKER_01", f"관련 내용을 메모해 보았고, {action}하는 방법도 생각해 보았습니다."),
        ("SPEAKER_00", "지금 말씀하신 방법에서 가장 먼저 할 수 있는 한 가지를 골라보면 무엇일까요."),
        ("SPEAKER_01", f"우선 {action}하는 일을 시작할 수 있습니다. 준비 시간을 짧게 나누면 가능할 것 같습니다."),
        ("SPEAKER_00", "네, 그 부분은 제가 확인하려던 내용과 같습니다. 진행하면서 어려움이 생기면 바로 조정하겠습니다."),
        ("SPEAKER_01", "중간에 계획이 달라져도 실패라고 생각하지 않고 다시 정리해 보겠습니다."),
        ("SPEAKER_00", "도움을 요청할 수 있는 사람이나 기관이 있는지도 함께 확인해 보겠습니다."),
        ("SPEAKER_01", "연락할 곳을 미리 적어두면 막막할 때 다시 시작하는 데 도움이 될 것 같습니다."),
        ("SPEAKER_00", f"이번 회차의 목표는 {goal}을 위한 첫 행동을 정하는 것으로 기록하겠습니다."),
        ("SPEAKER_01", "제가 이해한 내용도 같습니다. 해야 할 일이 너무 많지 않아서 부담이 덜합니다."),
        ("SPEAKER_00", "다음 회차 전까지 확인할 내용과 도움이 필요한 지점을 짧게 정리해 보겠습니다."),
        ("SPEAKER_01", f"저는 {action}한 뒤 결과를 기록하겠습니다. 어려웠던 이유도 함께 적어두겠습니다."),
        ("SPEAKER_00", "다음에는 기록한 내용을 보고 계획을 유지할지 바꿀지 함께 결정하겠습니다."),
        ("SPEAKER_01", "알겠습니다. 오늘 정한 범위부터 해보고 다음 상담에서 말씀드리겠습니다."),
    )
    return [
        {
            "speaker": speaker,
            "text": text,
            "gapAfterSeconds": 1.2 if index in {5, 12} else 0.35,
            "overlapPreviousSeconds": 0.65 if index in {8, 15} else 0.0,
        }
        for index, (speaker, text) in enumerate(lines)
    ]


def build_session_plans() -> list[dict[str, object]]:
    plans: list[dict[str, object]] = []
    for case_number, (topic, goal, obstacle, action) in enumerate(CASE_THEMES, start=1):
        case_id = f"case-{case_number:03d}"
        for session_number, (stage, focus) in enumerate(SESSION_STAGES, start=1):
            plans.append({
                "caseId": case_id,
                "sessionId": f"{case_id}-session-{session_number:02d}",
                "speakerCount": 2,
                "turns": _turns(topic, goal, obstacle, action, stage, focus),
            })
    return plans


def plan_timeline(
    turns: list[dict[str, object]],
    sample_counts: list[int],
    *,
    sample_rate: int,
    minimum_seconds: int = 60,
) -> dict[str, object]:
    if len(turns) != len(sample_counts) or sample_rate <= 0:
        raise ValueError("turns, sample counts, and sample rate must agree")
    cursor = 0
    intervals: list[tuple[int, int]] = []
    speaker_turns: list[dict[str, object]] = []
    overlaps: list[dict[str, float]] = []
    for turn, sample_count in zip(turns, sample_counts, strict=True):
        if sample_count <= 0:
            raise ValueError("rendered turns must contain audio")
        overlap_samples = round(float(turn["overlapPreviousSeconds"]) * sample_rate)
        start = max(0, cursor - overlap_samples)
        end = start + sample_count
        if overlap_samples:
            overlap_end = min(cursor, end)
            if overlap_end > start:
                overlaps.append({
                    "start": round(start / sample_rate, 6),
                    "end": round(overlap_end / sample_rate, 6),
                })
        speaker_turns.append({
            "speaker": turn["speaker"],
            "start": round(start / sample_rate, 6),
            "end": round(end / sample_rate, 6),
            "text": turn["text"],
        })
        intervals.append((start, end))
        cursor = max(cursor, end) + round(float(turn["gapAfterSeconds"]) * sample_rate)

    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    max_end = max(end for _, end in intervals)
    total_samples = max(minimum_seconds * sample_rate, max_end + 2 * sample_rate)
    silences = []
    previous_end = 0
    for start, end in merged:
        if start > previous_end:
            silences.append({
                "start": round(previous_end / sample_rate, 6),
                "end": round(start / sample_rate, 6),
            })
        previous_end = max(previous_end, end)
    if total_samples > previous_end:
        silences.append({
            "start": round(previous_end / sample_rate, 6),
            "end": round(total_samples / sample_rate, 6),
        })
    if not silences or not overlaps:
        raise ValueError("timeline must contain declared silence and overlap")
    return {
        "speakerTurns": speaker_turns,
        "silenceRanges": silences,
        "overlapRanges": overlaps,
        "startSamples": [start for start, _ in intervals],
        "totalSamples": total_samples,
        "durationSeconds": round(total_samples / sample_rate, 6),
    }


def mix_pcm(chunks: list[list[int] | array], starts: list[int], *, total_samples: int) -> array:
    if len(chunks) != len(starts) or total_samples <= 0:
        raise ValueError("chunks, starts, and total_samples must agree")
    mixed = [0] * total_samples
    for chunk, start in zip(chunks, starts, strict=True):
        if start < 0 or start + len(chunk) > total_samples:
            raise ValueError("audio chunk is outside the output timeline")
        for index, sample in enumerate(chunk, start=start):
            mixed[index] = max(-32_768, min(32_767, mixed[index] + int(sample)))
    return array("h", mixed)


def write_deterministic_archive(audio_dir: Path, archive_path: Path, names: list[str]) -> None:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with archive_path.open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for name in sorted(names):
                    source = audio_dir / name
                    data = source.read_bytes()
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o644
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))


VOICE_CONFIG = {
    "SPEAKER_00": {"voice": "ko+m3", "speed": "155", "pitch": "42"},
    "SPEAKER_01": {"voice": "ko+f3", "speed": "165", "pitch": "58"},
}


def _read_pcm_wav(path: Path) -> tuple[int, array]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError(f"eSpeak output must be mono signed 16-bit PCM: {path}")
        sample_rate = source.getframerate()
        samples = array("h")
        samples.frombytes(source.readframes(source.getnframes()))
    if sys.byteorder == "big":
        samples.byteswap()
    return sample_rate, samples


def _write_pcm_wav(path: Path, sample_rate: int, samples: array) -> None:
    output = array("h", samples)
    if sys.byteorder == "big":
        output.byteswap()
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(output.tobytes())


def _render_turn(espeak_path: Path, turn: dict[str, object], cache_dir: Path) -> tuple[int, array]:
    config = VOICE_CONFIG[str(turn["speaker"])]
    cache_key = hashlib.sha256(
        canonical_json_bytes({
            "config": config,
            "text": turn["text"],
        }),
    ).hexdigest()
    output = cache_dir / f"{cache_key}.wav"
    if not output.exists():
        subprocess.run(
            [
                str(espeak_path),
                "-D",
                "-v",
                config["voice"],
                "-s",
                config["speed"],
                "-p",
                config["pitch"],
                "-a",
                "100",
                "-w",
                str(output),
                str(turn["text"]),
            ],
            check=True,
            capture_output=True,
        )
    return _read_pcm_wav(output)


def _espeak_version(espeak_path: Path) -> str:
    result = subprocess.run(
        [str(espeak_path), "--version"],
        check=True,
        capture_output=True,
        text=True,
    )
    first_line = result.stdout.splitlines()[0].strip()
    if not first_line:
        raise ValueError("eSpeak NG version output is empty")
    return first_line


def generate(
    fixture_dir: Path,
    audio_dir: Path,
    archive_path: Path,
    espeak_path: Path,
) -> dict[str, object]:
    fixture_dir = fixture_dir.resolve()
    audio_dir = audio_dir.resolve()
    archive_path = archive_path.resolve()
    espeak_path = espeak_path.resolve()
    if not espeak_path.is_file():
        raise ValueError(f"eSpeak NG executable does not exist: {espeak_path}")
    for target in (fixture_dir, audio_dir):
        if target.exists() and any(target.iterdir()):
            raise ValueError(f"generation target must be empty: {target}")
        target.mkdir(parents=True, exist_ok=True)
    reference_dir = fixture_dir / "reference"
    reference_dir.mkdir()

    version = _espeak_version(espeak_path)
    sessions: list[dict[str, object]] = []
    licenses: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="s13-espeak-cache-") as cache_name:
        cache_dir = Path(cache_name)
        for plan in build_session_plans():
            rendered = [_render_turn(espeak_path, turn, cache_dir) for turn in plan["turns"]]
            sample_rates = {sample_rate for sample_rate, _ in rendered}
            if len(sample_rates) != 1:
                raise ValueError(f"eSpeak sample rates differ: {plan['sessionId']}")
            sample_rate = sample_rates.pop()
            chunks = [samples for _, samples in rendered]
            timeline = plan_timeline(
                plan["turns"],
                [len(samples) for samples in chunks],
                sample_rate=sample_rate,
            )
            if timeline["durationSeconds"] > 180:
                raise ValueError(f"session exceeds 180 seconds: {plan['sessionId']}")
            mixed = mix_pcm(chunks, timeline["startSamples"], total_samples=timeline["totalSamples"])
            audio_name = f"{plan['sessionId']}.wav"
            audio_path = audio_dir / audio_name
            _write_pcm_wav(audio_path, sample_rate, mixed)

            transcript = "\n".join(str(turn["text"]) for turn in plan["turns"])
            reference = {
                "schemaVersion": 1,
                "fixtureId": "s13-v1",
                "caseId": plan["caseId"],
                "sessionId": plan["sessionId"],
                "transcript": transcript,
                "speakerTurns": timeline["speakerTurns"],
                "silenceRanges": timeline["silenceRanges"],
                "overlapRanges": timeline["overlapRanges"],
            }
            reference_path = reference_dir / f"{plan['sessionId']}.json"
            reference_path.write_bytes(canonical_json_bytes(reference))
            sessions.append({
                "caseId": plan["caseId"],
                "sessionId": plan["sessionId"],
                "speakerCount": 2,
                "audioPath": audio_name,
                "referencePath": f"reference/{plan['sessionId']}.json",
                "audioSha256": sha256_file(audio_path),
                "transcriptSha256": sha256_bytes(transcript.encode("utf-8")),
                "speakerTruthSha256": sha256_bytes(canonical_json_bytes(timeline["speakerTurns"])),
                "durationSeconds": timeline["durationSeconds"],
                "silenceRanges": timeline["silenceRanges"],
                "overlapRanges": timeline["overlapRanges"],
            })
            licenses.append({
                "assetId": plan["sessionId"],
                "tool": "eSpeak NG",
                "toolVersion": version,
                "toolLicense": "GPL-3.0-or-later",
                "toolSource": "https://github.com/espeak-ng/espeak-ng",
                "spdxLicense": "CC-BY-4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                "redistributionAllowed": True,
                "attribution": "Synthetic CCC S13 fixture generated with eSpeak NG.",
            })

    license_manifest = {
        "schemaVersion": 1,
        "fixtureId": "s13-v1",
        "generator": {
            "name": "eSpeak NG",
            "version": version,
            "executableSha256": sha256_file(espeak_path),
            "source": "https://github.com/espeak-ng/espeak-ng",
            "license": "GPL-3.0-or-later",
            "voice": "ko with built-in m3/f3 variants",
            "voiceConfig": VOICE_CONFIG,
            "deterministicRandom": True,
            "voiceCloning": False,
        },
        "assets": licenses,
    }
    license_path = fixture_dir / "licenses.json"
    license_path.write_bytes(canonical_json_bytes(license_manifest))
    license_hash = sha256_file(license_path)
    for session in sessions:
        session["licenseManifestSha256"] = license_hash

    write_deterministic_archive(audio_dir, archive_path, [session["audioPath"] for session in sessions])
    manifest = {
        "schemaVersion": 1,
        "fixtureId": "s13-v1",
        "sourceType": "synthetic",
        "audioReleaseTag": "s13-fixture-v1",
        "audioArchive": {
            "name": "s13-fixture-v1.tar.gz",
            "sha256": sha256_file(archive_path),
        },
        "licenseManifestSha256": license_hash,
        "sessions": sessions,
        "trainCaseIds": [],
    }
    manifest_path = fixture_dir / "manifest.json"
    manifest_path.write_bytes(canonical_json_bytes(manifest))
    return {
        "fixtureId": "s13-v1",
        "manifestSha256": sha256_file(manifest_path),
        "archiveSha256": manifest["audioArchive"]["sha256"],
        "sessionCount": len(sessions),
        "status": "PASS",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the CCC S13 synthetic STT fixture.")
    parser.add_argument("--fixture-dir", type=Path, default=Path("scripts/stt/fixtures"))
    parser.add_argument(
        "--audio-dir",
        type=Path,
        default=Path("artifacts/pilot/fixtures/s13-v1/audio"),
    )
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path("artifacts/pilot/fixtures/s13-v1/s13-fixture-v1.tar.gz"),
    )
    parser.add_argument("--espeak", type=Path, default=Path(shutil.which("espeak-ng") or "espeak-ng"))
    args = parser.parse_args()
    receipt = generate(args.fixture_dir, args.audio_dir, args.archive, args.espeak)
    print(f"S13 fixture generation PASS: {receipt['sessionCount']} sessions")


if __name__ == "__main__":
    main()
