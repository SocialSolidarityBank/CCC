-- F3: one deterministic invalidation boundary for source, date, and map changes.
-- The trigger closes stale generic work before reopening its queue and inserting one successor.
DROP TRIGGER IF EXISTS agent_text_source_superseded;
DROP TRIGGER IF EXISTS agent_text_source_successor;
DROP TRIGGER IF EXISTS agent_entity_map_source_superseded;

CREATE TRIGGER agent_text_source_invalidation AFTER UPDATE OF generation ON counseling_memory_cases
WHEN NEW.generation <> OLD.generation BEGIN
  UPDATE agent_jobs SET state='failed', terminal_failure_code='stale_claim',
    lease_owner=NULL, claim_token_hash=NULL, claimed_at=NULL, lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='text'
    AND state IN ('pending','leased','blocked') AND source_generation IS NOT NULL
    AND source_generation <> NEW.generation;

  UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND status='processing'
    AND id IN (SELECT source_text_work_item_id FROM agent_jobs
      WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id
        AND kind='text' AND state='failed' AND terminal_failure_code='stale_claim')
    AND NOT EXISTS (SELECT 1 FROM agent_jobs live_job
      WHERE live_job.org_id=NEW.org_id AND live_job.source_text_work_item_id=ai_text_work_queue.id
        AND live_job.state IN ('pending','leased','blocked'));

  -- A memory claim from an obsolete generation is reopened, never made permanently failed.
  UPDATE counseling_memory_materials SET status='pending',valid=1,attempt=0,
    lease_token=NULL,lease_until=NULL,actor_id=NULL,attestation_json=NULL,
    attestation_expires_at=NULL,receipt_id=NULL,entity_source_binding=NULL,
    snapshot_id=NULL,masked_text=NULL,sha256=NULL,proof_json=NULL,payload_hash=NULL,processed=0
  WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id
    AND valid=1 AND status IN ('pending','leased')
    AND (entity_source_binding IS NULL OR COALESCE(json_extract(entity_source_binding,'$.generation'),-1) <> NEW.generation)
    AND EXISTS (SELECT 1 FROM counseling_memory_sources s
      WHERE s.org_id=counseling_memory_materials.org_id
        AND s.support_case_id=counseling_memory_materials.support_case_id
        AND s.kind=counseling_memory_materials.kind
        AND s.source_id=counseling_memory_materials.source_id
        AND s.revision=counseling_memory_materials.source_revision);

  UPDATE support_cases SET entity_map_lease_family=NULL,entity_map_lease_job_id=NULL,
    entity_map_lease_attempt=NULL,entity_map_lease_expires_at=NULL
  WHERE org_id=NEW.org_id AND id=NEW.support_case_id;

  -- Pick one historical stale row. A set-based INSERT over all failed rows would
  -- create one successor per failure when retries have accumulated.
  INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,
    enqueued_at,required_consent,consent_revision,consent_receipt_json,attempt,source_generation,updated_at)
   SELECT lower(hex(randomblob(16))),j.org_id,j.support_case_id,j.session_id,j.source_text_work_item_id,
     'text','pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),j.required_consent,j.consent_revision,
     j.consent_receipt_json,0,NEW.generation,strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM agent_jobs j
   JOIN ai_text_work_queue q ON q.id=j.source_text_work_item_id AND q.org_id=j.org_id
   JOIN sessions s ON s.id=q.session_id AND s.org_id=q.org_id
   WHERE j.id=(SELECT candidate.id FROM agent_jobs candidate
     JOIN ai_text_work_queue candidate_queue ON candidate_queue.id=candidate.source_text_work_item_id
       AND candidate_queue.org_id=candidate.org_id AND candidate_queue.status='pending'
     WHERE candidate.org_id=NEW.org_id AND candidate.support_case_id=NEW.support_case_id
       AND candidate.session_id=j.session_id
       AND candidate.kind='text' AND candidate.state='failed'
       AND candidate.terminal_failure_code='stale_claim'
     ORDER BY candidate.enqueued_at DESC,candidate.id DESC LIMIT 1)
     AND q.status='pending'
     AND (TRIM(COALESCE(s.memo,''))<>'' OR EXISTS(
       SELECT 1 FROM approved_ai_briefing_v1 a WHERE a.org_id=q.org_id AND a.session_id=q.session_id
         AND TRIM(COALESCE(a.summary_text,''))<>''))
     AND NOT EXISTS (SELECT 1 FROM agent_jobs current_job
       WHERE current_job.org_id=j.org_id AND current_job.session_id=j.session_id AND current_job.kind='text'
         AND current_job.state IN ('pending','leased','blocked'));
END;

CREATE TRIGGER organization_settings_time_zone_invalidation AFTER UPDATE OF time_zone ON organization_settings
WHEN NEW.time_zone IS NOT OLD.time_zone BEGIN
  UPDATE counseling_memory_sources SET dirty=1,chunk_cursor=0
  WHERE org_id=NEW.org_id AND kind='session';
  UPDATE counseling_memory_materials SET status='pending',valid=1,attempt=0,
    lease_token=NULL,lease_until=NULL,actor_id=NULL,attestation_json=NULL,
    attestation_expires_at=NULL,receipt_id=NULL,entity_source_binding=NULL,
    snapshot_id=NULL,masked_text=NULL,sha256=NULL,proof_json=NULL,payload_hash=NULL,processed=0
  WHERE org_id=NEW.org_id AND kind='session' AND valid=1 AND status IN ('pending','leased')
    AND EXISTS (SELECT 1 FROM counseling_memory_sources s
      WHERE s.org_id=counseling_memory_materials.org_id
        AND s.support_case_id=counseling_memory_materials.support_case_id
        AND s.kind=counseling_memory_materials.kind AND s.source_id=counseling_memory_materials.source_id
        AND s.revision=counseling_memory_materials.source_revision);
  UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,
    egress=NULL,lease_token=NULL,lease_until=NULL,not_before=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds')
  WHERE org_id=NEW.org_id;
END;

CREATE TRIGGER agent_entity_map_invalidation AFTER UPDATE OF entity_map_revision ON support_cases
WHEN NEW.entity_map_revision <> OLD.entity_map_revision BEGIN
  UPDATE agent_jobs SET state='failed',terminal_failure_code='stale_claim',lease_owner=NULL,
    claim_token_hash=NULL,claimed_at=NULL,lease_expires_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND kind='text'
    AND state IN ('pending','leased','blocked')
    AND (entity_source_binding IS NULL OR COALESCE(json_extract(entity_source_binding,'$.mapRevision'),-1) <> NEW.entity_map_revision);

  UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL
  WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND status='processing'
    AND id IN (SELECT source_text_work_item_id FROM agent_jobs
      WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND kind='text'
        AND state='failed' AND terminal_failure_code='stale_claim')
    AND NOT EXISTS (SELECT 1 FROM agent_jobs live_job
      WHERE live_job.org_id=NEW.org_id AND live_job.source_text_work_item_id=ai_text_work_queue.id
        AND live_job.state IN ('pending','leased','blocked'));

  -- Only uncompleted claims are reopened; completed v2 text, offsets, and hashes stay immutable.
  UPDATE counseling_memory_materials SET status='pending',valid=1,attempt=0,
    lease_token=NULL,lease_until=NULL,actor_id=NULL,attestation_json=NULL,
    attestation_expires_at=NULL,receipt_id=NULL,entity_source_binding=NULL,
    snapshot_id=NULL,masked_text=NULL,sha256=NULL,proof_json=NULL,payload_hash=NULL,processed=0
  WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND valid=1 AND status IN ('pending','leased')
    AND (entity_source_binding IS NULL OR COALESCE(json_extract(entity_source_binding,'$.mapRevision'),-1) <> NEW.entity_map_revision)
    AND EXISTS (SELECT 1 FROM counseling_memory_sources s
      WHERE s.org_id=counseling_memory_materials.org_id
        AND s.support_case_id=counseling_memory_materials.support_case_id
        AND s.kind=counseling_memory_materials.kind AND s.source_id=counseling_memory_materials.source_id
        AND s.revision=counseling_memory_materials.source_revision);
  UPDATE counseling_memory_sources SET dirty=1,chunk_cursor=0
  WHERE org_id=NEW.org_id AND support_case_id=NEW.id;

  UPDATE support_cases SET entity_map_lease_family=NULL,entity_map_lease_job_id=NULL,
    entity_map_lease_attempt=NULL,entity_map_lease_expires_at=NULL
  WHERE org_id=NEW.org_id AND id=NEW.id AND NOT (
    (entity_map_lease_family='generic' AND entity_map_lease_job_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM agent_jobs j WHERE j.id=entity_map_lease_job_id AND j.org_id=NEW.org_id
        AND j.state='leased' AND j.entity_source_binding IS NOT NULL
        AND COALESCE(json_extract(j.entity_source_binding,'$.mapRevision'),-1)=NEW.entity_map_revision))
    OR (entity_map_lease_family='memory' AND entity_map_lease_job_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM counseling_memory_materials m WHERE m.id=entity_map_lease_job_id AND m.org_id=NEW.org_id
        AND m.status='leased' AND m.entity_source_binding IS NOT NULL
        AND COALESCE(json_extract(m.entity_source_binding,'$.mapRevision'),-1)=NEW.entity_map_revision))
  );

  INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,
    enqueued_at,required_consent,consent_revision,consent_receipt_json,attempt,source_generation,updated_at)
   SELECT lower(hex(randomblob(16))),j.org_id,j.support_case_id,j.session_id,j.source_text_work_item_id,
     'text','pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),j.required_consent,j.consent_revision,
     j.consent_receipt_json,0,c.generation,strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM agent_jobs j
   JOIN ai_text_work_queue q ON q.id=j.source_text_work_item_id AND q.org_id=j.org_id
   JOIN counseling_memory_cases c ON c.org_id=q.org_id AND c.support_case_id=q.support_case_id
   JOIN sessions s ON s.id=q.session_id AND s.org_id=q.org_id
   WHERE j.id=(SELECT candidate.id FROM agent_jobs candidate
     JOIN ai_text_work_queue candidate_queue ON candidate_queue.id=candidate.source_text_work_item_id
       AND candidate_queue.org_id=candidate.org_id AND candidate_queue.status='pending'
     WHERE candidate.org_id=NEW.org_id AND candidate.support_case_id=NEW.id
       AND candidate.session_id=j.session_id
       AND candidate.kind='text' AND candidate.state='failed'
       AND candidate.terminal_failure_code='stale_claim'
     ORDER BY candidate.enqueued_at DESC,candidate.id DESC LIMIT 1)
     AND q.status='pending'
     AND (TRIM(COALESCE(s.memo,''))<>'' OR EXISTS(
       SELECT 1 FROM approved_ai_briefing_v1 a WHERE a.org_id=q.org_id AND a.session_id=q.session_id
         AND TRIM(COALESCE(a.summary_text,''))<>''))
     AND NOT EXISTS (SELECT 1 FROM agent_jobs current_job
       WHERE current_job.org_id=j.org_id AND current_job.session_id=j.session_id AND current_job.kind='text'
         AND current_job.state IN ('pending','leased','blocked'));
END;
