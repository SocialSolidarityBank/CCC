"""원본 녹음의 선택형 백업 정책 경계 (CCC-98).

기본값은 OFF다. adapter는 승인된 목적지가 정해진 뒤 별도 모듈이 등록한다. 이 파일은
정책 검증과 비차단 실행만 맡고, NAS나 Google Shared Drive에 직접 연결하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


class BackupPolicyError(Exception):
    """내용이나 자격증명을 담지 않는 백업 설정 오류."""


@dataclass(frozen=True)
class BackupPolicy:
    enabled: bool = False
    environment: str | None = None
    purpose: str | None = None
    destination_ref: str | None = None
    retention_days: int | None = None
    consent_notice_version: str | None = None


class OriginalRecordingBackupAdapter(Protocol):
    """기관이 목적지를 승인한 뒤 구현할 저장소 adapter 자리."""

    environment: str
    destination_ref: str

    def copy_original(self, source: Path, *, job_id: str, retention_days: int) -> None: ...


# 이번 티켓에는 NAS와 Google Shared Drive 구현이 없다. 승인된 adapter가 생기면
# 목적지 참조를 키로 여기에 등록한다. 환경별 adapter는 같은 키를 공유하지 않는다.
BACKUP_ADAPTERS: dict[str, OriginalRecordingBackupAdapter] = {}


class OriginalRecordingDeletionAdapter(Protocol):
    """기존 사본 삭제는 복사 경로와 분리된 명시적 작업이다."""

    def delete_existing(self, backup_ref: str) -> None: ...


def delete_existing_backup(
    backup_ref: str,
    adapter: OriginalRecordingDeletionAdapter,
    audit: Callable[[str, dict[str, str]], None],
) -> None:
    """삭제는 감사 호출 없이는 실행할 수 없는 별도 경계다."""
    audit("backup_delete_requested", {"backupRef": backup_ref})
    adapter.delete_existing(backup_ref)
    audit("backup_delete_completed", {"backupRef": backup_ref})


def validate_backup_policy(policy: BackupPolicy, runtime_environment: str) -> None:
    if not policy.enabled:
        return
    if runtime_environment not in ("preview", "production") or policy.environment != runtime_environment:
        raise BackupPolicyError("backup policy environment mismatch")
    if (
        policy.purpose is None
        or policy.purpose.strip() == ""
        or policy.destination_ref is None
        or policy.destination_ref.strip() == ""
        or policy.retention_days is None
        or policy.retention_days <= 0
        or policy.consent_notice_version is None
        or policy.consent_notice_version.strip() == ""
    ):
        raise BackupPolicyError("backup policy is incomplete")


def assert_backup_destination_available(
    policy: BackupPolicy,
    adapters: dict[str, OriginalRecordingBackupAdapter],
) -> None:
    if not policy.enabled:
        return
    destination_ref = policy.destination_ref
    if destination_ref is None or destination_ref not in adapters:
        raise BackupPolicyError("backup destination is unavailable")


def backup_original_if_enabled(
    policy: BackupPolicy,
    runtime_environment: str,
    source: Path,
    job_id: str,
    adapters: dict[str, OriginalRecordingBackupAdapter],
) -> str:
    """OFF이면 아무 일도 하지 않고, ON이면 승인된 adapter 한 곳만 비차단 호출한다."""
    validate_backup_policy(policy, runtime_environment)
    if not policy.enabled:
        return "disabled"
    destination_ref = policy.destination_ref
    retention_days = policy.retention_days
    if destination_ref is None or retention_days is None:
        raise BackupPolicyError("backup policy is incomplete")
    adapter = adapters.get(destination_ref)
    if adapter is None:
        raise BackupPolicyError("backup destination is unavailable")
    if adapter.environment != runtime_environment or adapter.destination_ref != destination_ref:
        raise BackupPolicyError("backup destination environment mismatch")
    try:
        adapter.copy_original(source, job_id=job_id, retention_days=retention_days)
    except Exception:  # noqa: BLE001 - 백업 장애가 녹음 파이프라인을 막으면 안 된다
        return "failed"
    return "copied"
