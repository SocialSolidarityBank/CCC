import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from ccc_pipeline.backup import (
    BackupPolicy,
    BackupPolicyError,
    backup_original_if_enabled,
    delete_existing_backup,
)
from ccc_pipeline.config import ConfigError, load_config


class FakeBackupAdapter:
    def __init__(self, environment: str = "preview", destination_ref: str = "approved:archive"):
        self.environment = environment
        self.destination_ref = destination_ref
        self.calls = 0
        self.failure: Exception | None = None

    def copy_original(self, source: Path, *, job_id: str, retention_days: int) -> None:
        self.calls += 1
        if self.failure is not None:
            raise self.failure


class FakeDeletionAdapter:
    def __init__(self):
        self.deleted: list[str] = []

    def delete_existing(self, backup_ref: str) -> None:
        self.deleted.append(backup_ref)


def enabled_policy(environment: str = "preview") -> BackupPolicy:
    return BackupPolicy(
        enabled=True,
        environment=environment,
        purpose="approved internal archive",
        destination_ref="approved:archive",
        retention_days=30,
        consent_notice_version="recording-ai-v1",
    )


class BackupPolicyTest(unittest.TestCase):
    def test_default_off_does_not_lookup_or_call_an_adapter(self):
        adapters = mock.MagicMock()
        with TemporaryDirectory() as tmp:
            status = backup_original_if_enabled(BackupPolicy(), "preview", Path(tmp) / "audio", "job-1", adapters)
        self.assertEqual(status, "disabled")
        adapters.get.assert_not_called()

    def test_incomplete_on_policy_fails_without_exposing_values(self):
        with TemporaryDirectory() as tmp:
            with self.assertRaises(BackupPolicyError) as caught:
                backup_original_if_enabled(
                    BackupPolicy(enabled=True, purpose="sensitive purpose value"),
                    "preview",
                    Path(tmp) / "audio",
                    "job-1",
                    {},
                )
        self.assertNotIn("sensitive purpose value", str(caught.exception))

    def test_backup_failure_is_reported_without_raising(self):
        adapter = FakeBackupAdapter()
        adapter.failure = RuntimeError("destination unavailable")
        with TemporaryDirectory() as tmp:
            status = backup_original_if_enabled(
                enabled_policy(),
                "preview",
                Path(tmp) / "audio",
                "job-1",
                {adapter.destination_ref: adapter},
            )
        self.assertEqual(status, "failed")
        self.assertEqual(adapter.calls, 1)

    def test_environment_mismatch_cannot_cross_preview_and_production(self):
        adapter = FakeBackupAdapter(environment="production")
        with TemporaryDirectory() as tmp:
            with self.assertRaises(BackupPolicyError):
                backup_original_if_enabled(
                    enabled_policy("preview"),
                    "production",
                    Path(tmp) / "audio",
                    "job-1",
                    {adapter.destination_ref: adapter},
                )
        self.assertEqual(adapter.calls, 0)

    def test_switching_off_stops_new_copies_without_deleting_existing_copies(self):
        adapter = FakeBackupAdapter()
        with TemporaryDirectory() as tmp:
            source = Path(tmp) / "audio"
            self.assertEqual(
                backup_original_if_enabled(enabled_policy(), "preview", source, "job-1", {adapter.destination_ref: adapter}),
                "copied",
            )
            self.assertEqual(backup_original_if_enabled(BackupPolicy(), "preview", source, "job-2", {}), "disabled")
        self.assertEqual(adapter.calls, 1)
        self.assertFalse(hasattr(adapter, "delete_original"))

    def test_existing_copy_deletion_is_a_separate_audited_action(self):
        adapter = FakeDeletionAdapter()
        audits: list[tuple[str, dict[str, str]]] = []
        delete_existing_backup("opaque-backup-ref", adapter, lambda action, detail: audits.append((action, detail)))
        self.assertEqual(adapter.deleted, ["opaque-backup-ref"])
        self.assertEqual([action for action, _ in audits], ["backup_delete_requested", "backup_delete_completed"])

    def test_incomplete_on_environment_is_rejected_at_startup(self):
        env = {
            "CCC_RUNTIME_ENVIRONMENT": "preview",
            "CCC_PREVIEW_E2E_ACCESS_CODE": "fixture-preview-code",
            "CCC_ORIGINAL_BACKUP_ENABLED": "on",
            "CCC_ORIGINAL_BACKUP_PURPOSE": "approved purpose",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ConfigError) as caught:
                load_config()
        self.assertEqual(str(caught.exception), "original recording backup policy is invalid")


if __name__ == "__main__":
    unittest.main()
