-- Logical pair: SQLite 0065_agent_text_source_fence.sql.
ALTER TABLE agent_jobs ADD COLUMN source_generation bigint CHECK (source_generation IS NULL OR source_generation >= 1);
ALTER TABLE agent_jobs ADD COLUMN source_sha256 text CHECK (source_sha256 IS NULL OR length(source_sha256) = 64);
ALTER TABLE agent_jobs ADD COLUMN source_length bigint CHECK (source_length IS NULL OR source_length > 0);
ALTER TABLE agent_jobs ADD COLUMN checked_start bigint CHECK (checked_start IS NULL OR checked_start >= 0);
ALTER TABLE agent_jobs ADD COLUMN checked_end bigint CHECK (checked_end IS NULL OR (checked_start IS NOT NULL AND source_length IS NOT NULL AND checked_end > checked_start AND checked_end <= source_length));

CREATE FUNCTION agent_text_source_superseded_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_jobs SET state='failed', terminal_failure_code='stale_claim',
    lease_owner=NULL, claim_token_hash=NULL, claimed_at=NULL, lease_expires_at=NULL,
    updated_at=to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='text'
    AND state IN ('pending','leased','blocked') AND source_generation IS NOT NULL
    AND source_generation <> NEW.generation;
  UPDATE ai_text_work_queue SET status='pending'
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND status='processing'
    AND id IN (SELECT source_text_work_item_id FROM agent_jobs WHERE org_id=NEW.org_id
      AND support_case_id=NEW.support_case_id AND terminal_failure_code='stale_claim');
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_text_source_superseded AFTER UPDATE OF generation ON counseling_memory_cases
FOR EACH ROW WHEN (NEW.generation <> OLD.generation) EXECUTE FUNCTION agent_text_source_superseded_fn();

CREATE FUNCTION agent_text_result_source_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_job agent_jobs%ROWTYPE;
BEGIN
  SELECT * INTO source_job FROM agent_jobs WHERE id=NEW.job_id;
  IF source_job.kind='text' THEN
    -- Acquire the context before the existing live-claim guard locks the job.
    PERFORM 1 FROM counseling_memory_cases c WHERE c.org_id=source_job.org_id
      AND c.support_case_id=source_job.support_case_id AND c.generation=source_job.source_generation
      AND source_job.source_sha256 IS NOT NULL AND source_job.source_length IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='stale_claim'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_a_text_result_source_guard BEFORE INSERT ON agent_job_result_acceptances
FOR EACH ROW EXECUTE FUNCTION agent_text_result_source_guard_fn();

CREATE FUNCTION agent_text_review_source_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_job agent_jobs%ROWTYPE;
BEGIN
  FOR source_job IN SELECT j.* FROM ai_draft_versions d
    JOIN ai_text_work_queue q ON q.completed_snapshot_id=d.source_snapshot_id OR EXISTS (
      SELECT 1 FROM ai_draft_source_materials m WHERE m.draft_version_id=d.id AND m.snapshot_id=q.completed_snapshot_id
    )
    JOIN agent_jobs j ON j.source_text_work_item_id=q.id AND j.state='succeeded'
    WHERE d.id=NEW.draft_version_id
  LOOP
    PERFORM 1 FROM counseling_memory_cases c WHERE c.org_id=source_job.org_id
      AND c.support_case_id=source_job.support_case_id AND c.generation=source_job.source_generation
      AND source_job.checked_end IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='stale_draft_version'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_text_review_source_guard BEFORE INSERT ON ai_review_events
FOR EACH ROW WHEN (NEW.decision='approved') EXECUTE FUNCTION agent_text_review_source_guard_fn();
