-- Generic text jobs reuse the counseling-memory context generation fence.
-- Store only lineage and checked code-point bounds, never unmasked source text.
ALTER TABLE agent_jobs ADD COLUMN source_generation INTEGER CHECK (source_generation IS NULL OR source_generation >= 1);
ALTER TABLE agent_jobs ADD COLUMN source_sha256 TEXT CHECK (source_sha256 IS NULL OR length(source_sha256) = 64);
ALTER TABLE agent_jobs ADD COLUMN source_length INTEGER CHECK (source_length IS NULL OR source_length > 0);
ALTER TABLE agent_jobs ADD COLUMN checked_start INTEGER CHECK (checked_start IS NULL OR checked_start >= 0);
ALTER TABLE agent_jobs ADD COLUMN checked_end INTEGER CHECK (checked_end IS NULL OR (checked_start IS NOT NULL AND source_length IS NOT NULL AND checked_end > checked_start AND checked_end <= source_length));

CREATE TRIGGER agent_text_source_superseded AFTER UPDATE OF generation ON counseling_memory_cases
WHEN NEW.generation <> OLD.generation BEGIN
  UPDATE agent_jobs SET state='failed', terminal_failure_code='stale_claim',
    lease_owner=NULL, claim_token_hash=NULL, claimed_at=NULL, lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='text'
    AND state IN ('pending','leased','blocked') AND source_generation IS NOT NULL
    AND source_generation <> NEW.generation;
  UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND status='processing'
    AND id IN (SELECT source_text_work_item_id FROM agent_jobs WHERE org_id=NEW.org_id
      AND support_case_id=NEW.support_case_id AND terminal_failure_code='stale_claim');
END;

CREATE TRIGGER agent_a_text_result_source_guard BEFORE INSERT ON agent_job_result_acceptances BEGIN
  SELECT RAISE(ABORT, 'stale_claim') WHERE EXISTS (
    SELECT 1 FROM agent_jobs j WHERE j.id=NEW.job_id AND j.kind='text' AND NOT EXISTS (
      SELECT 1 FROM counseling_memory_cases c WHERE c.org_id=j.org_id AND c.support_case_id=j.support_case_id
        AND c.generation=j.source_generation AND j.source_sha256 IS NOT NULL AND j.source_length IS NOT NULL
    )
  );
END;

CREATE TRIGGER agent_text_review_source_guard BEFORE INSERT ON ai_review_events
WHEN NEW.decision='approved' BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version') WHERE EXISTS (
    SELECT 1 FROM ai_draft_versions d
    JOIN ai_text_work_queue q ON q.completed_snapshot_id=d.source_snapshot_id OR EXISTS (
      SELECT 1 FROM ai_draft_source_materials m WHERE m.draft_version_id=d.id AND m.snapshot_id=q.completed_snapshot_id
    )
    JOIN agent_jobs j ON j.source_text_work_item_id=q.id AND j.state='succeeded'
    WHERE d.id=NEW.draft_version_id AND NOT EXISTS (
      SELECT 1 FROM counseling_memory_cases c WHERE c.org_id=j.org_id AND c.support_case_id=j.support_case_id
        AND c.generation=j.source_generation AND j.checked_end IS NOT NULL
    )
  );
END;
