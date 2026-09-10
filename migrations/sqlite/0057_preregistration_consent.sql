-- Preregistration consent (beta 0.9). A disclosure snapshot is issued for a
-- program before the participant exists, so consent_disclosure_snapshots
-- .support_case_id becomes nullable: NULL means "program-scoped, not yet bound
-- to a case". Registration receipts make participant creation idempotent while
-- storing only a request hash — never raw participant data.
PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- SQLite cannot drop a column NOT NULL in place, and this table is an FK parent
-- (consent_events.disclosure_snapshot_id). The 0007 sequence is the only correct
-- one here: copy rows into an unconstrained table, DROP the parent (deferred FK
-- violations), CREATE the same name so child FKs rebind by name, restore rows.
-- A RENAME swap is wrong: ALTER TABLE ... RENAME rewrites child FK targets.
-- DROP TABLE does not fire the row DELETE trigger, so the immutable guard below
-- does not block the rebuild; it is recreated with the identical definition.
CREATE TABLE consent_disclosure_snapshots_rebuild_copy AS
SELECT * FROM consent_disclosure_snapshots;

DROP TABLE consent_disclosure_snapshots;

CREATE TABLE consent_disclosure_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  support_case_id TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('personal_data_collection_use','sensitive_information_processing','counseling_recording','external_stt_processing','external_llm_cross_border_processing','voice_original_retention_period')),
  full_korean_copy TEXT NOT NULL,
  provider TEXT,
  provider_registry_snapshot_id TEXT REFERENCES consent_provider_registry_snapshots(id),
  provider_legal_recipient TEXT,
  provider_country TEXT,
  purpose TEXT,
  retention_profile TEXT NOT NULL CHECK (retention_profile='default_temporary_d85'),
  retention_duration TEXT NOT NULL CHECK (retention_duration='default_temporary_d85'),
  copy_version TEXT NOT NULL,
  copy_hash TEXT NOT NULL CHECK (length(copy_hash)=64 AND copy_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((provider IS NULL)=(provider_registry_snapshot_id IS NULL) AND (provider IS NULL)=(provider_legal_recipient IS NULL) AND (provider IS NULL)=(provider_country IS NULL) AND (provider IS NULL)=(purpose IS NULL))
);

INSERT INTO consent_disclosure_snapshots (
  id, org_id, program_id, issuer_id, support_case_id, domain, full_korean_copy,
  provider, provider_registry_snapshot_id, provider_legal_recipient, provider_country, purpose,
  retention_profile, retention_duration, copy_version, copy_hash, issued_at, expires_at
)
SELECT
  id, org_id, program_id, issuer_id, support_case_id, domain, full_korean_copy,
  provider, provider_registry_snapshot_id, provider_legal_recipient, provider_country, purpose,
  retention_profile, retention_duration, copy_version, copy_hash, issued_at, expires_at
FROM consent_disclosure_snapshots_rebuild_copy;

-- Row preservation is proven inside the migration: a lost or altered row makes
-- the guard insert ok=0 and the CHECK aborts before the copy is dropped.
CREATE TABLE preregistration_consent_assertions (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO preregistration_consent_assertions (id, ok)
SELECT 'consent_disclosure_snapshots_roundtrip', 0
WHERE EXISTS (
  SELECT * FROM consent_disclosure_snapshots_rebuild_copy
  EXCEPT
  SELECT * FROM consent_disclosure_snapshots
)
OR EXISTS (
  SELECT * FROM consent_disclosure_snapshots
  EXCEPT
  SELECT * FROM consent_disclosure_snapshots_rebuild_copy
);

DROP TABLE consent_disclosure_snapshots_rebuild_copy;

-- Identical to 0051. The index and both immutable guards died with the table.
CREATE INDEX consent_disclosures_scope ON consent_disclosure_snapshots(org_id,support_case_id,issuer_id,expires_at);
CREATE TRIGGER consent_disclosures_no_update BEFORE UPDATE ON consent_disclosure_snapshots BEGIN SELECT RAISE(ABORT,'consent_disclosures_immutable'); END;
CREATE TRIGGER consent_disclosures_no_delete BEFORE DELETE ON consent_disclosure_snapshots BEGIN SELECT RAISE(ABORT,'consent_disclosures_immutable'); END;

-- Rebuilt parents can leave the deferred violation counter stale; prove the graph explicitly.
INSERT INTO preregistration_consent_assertions (id, ok)
SELECT 'final_fk', 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);
DROP TABLE preregistration_consent_assertions;

-- One receipt per (organization, staff actor, idempotency key). request_hash is
-- the canonical hash of the registration request: replay compares hashes, so no
-- name, phone, email, birth date, region or gender is ever stored here. The
-- created identities are referenced by id only, mirroring consent_events.
CREATE TABLE participant_registration_receipts (
  org_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  beneficiary_id TEXT NOT NULL,
  support_case_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, actor_id, idempotency_key)
);
CREATE TRIGGER participant_registration_receipts_no_update BEFORE UPDATE ON participant_registration_receipts BEGIN SELECT RAISE(ABORT,'participant_registration_receipts_immutable'); END;
CREATE TRIGGER participant_registration_receipts_no_delete BEFORE DELETE ON participant_registration_receipts BEGIN SELECT RAISE(ABORT,'participant_registration_receipts_immutable'); END;
