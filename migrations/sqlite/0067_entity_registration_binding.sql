-- F3: bind every live source claim to the case map lease and immutable source lineage.
ALTER TABLE support_cases ADD COLUMN entity_map_lease_family TEXT CHECK (entity_map_lease_family IS NULL OR entity_map_lease_family IN ('generic','memory'));
ALTER TABLE support_cases ADD COLUMN entity_map_lease_job_id TEXT;
ALTER TABLE support_cases ADD COLUMN entity_map_lease_attempt INTEGER CHECK (entity_map_lease_attempt IS NULL OR entity_map_lease_attempt >= 0);
ALTER TABLE support_cases ADD COLUMN entity_map_lease_expires_at TEXT;
ALTER TABLE agent_jobs ADD COLUMN entity_source_binding TEXT;
ALTER TABLE counseling_memory_materials ADD COLUMN entity_source_binding TEXT;

CREATE TRIGGER entity_map_lease_tuple_guard
BEFORE UPDATE OF entity_map_lease_family,entity_map_lease_job_id,entity_map_lease_attempt,entity_map_lease_expires_at ON support_cases
WHEN ((NEW.entity_map_lease_family IS NULL OR NEW.entity_map_lease_job_id IS NULL OR NEW.entity_map_lease_attempt IS NULL OR NEW.entity_map_lease_expires_at IS NULL)
   AND NOT (NEW.entity_map_lease_family IS NULL AND NEW.entity_map_lease_job_id IS NULL AND NEW.entity_map_lease_attempt IS NULL AND NEW.entity_map_lease_expires_at IS NULL))
BEGIN SELECT RAISE(ABORT,'entity_map_lease_tuple_invalid'); END;

-- A source-generation change is the durable invalidation boundary. Existing
-- failed stale jobs provide the consent receipt for exactly one successor.
CREATE TRIGGER agent_text_source_successor AFTER UPDATE OF generation ON counseling_memory_cases
WHEN NEW.generation <> OLD.generation BEGIN
  UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL
   WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND status='processing';
  UPDATE support_cases SET entity_map_lease_family=NULL,entity_map_lease_job_id=NULL,entity_map_lease_attempt=NULL,entity_map_lease_expires_at=NULL
   WHERE org_id=NEW.org_id AND id=NEW.support_case_id;
  INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,enqueued_at,required_consent,consent_revision,consent_receipt_json,attempt,source_generation,updated_at)
   SELECT lower(hex(randomblob(16))),j.org_id,j.support_case_id,j.session_id,j.source_text_work_item_id,'text','pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
     j.required_consent,j.consent_revision,j.consent_receipt_json,0,NEW.generation,strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM agent_jobs j JOIN ai_text_work_queue q ON q.id=j.source_text_work_item_id AND q.org_id=j.org_id
    JOIN sessions s ON s.id=q.session_id AND s.org_id=q.org_id
   WHERE j.org_id=NEW.org_id AND j.support_case_id=NEW.support_case_id AND j.kind='text' AND j.state='failed' AND j.terminal_failure_code='stale_claim'
     AND q.status='pending'
     AND (TRIM(COALESCE(s.memo,''))<>'' OR EXISTS(SELECT 1 FROM approved_ai_briefing_v1 a WHERE a.org_id=q.org_id AND a.session_id=q.session_id AND TRIM(COALESCE(a.summary_text,''))<>''))
     AND NOT EXISTS(SELECT 1 FROM agent_jobs current WHERE current.org_id=j.org_id AND current.session_id=j.session_id AND current.kind='text' AND current.state IN ('pending','leased','blocked'))
     AND NOT EXISTS(SELECT 1 FROM agent_jobs current WHERE current.org_id=j.org_id AND current.session_id=j.session_id AND current.kind='text' AND current.source_generation=NEW.generation AND current.state IN ('pending','leased','blocked'));
END;

-- A map revision is an invalidation boundary except for a registration job
-- which advanced its own binding in the same transaction before the map CAS.
CREATE TRIGGER agent_entity_map_source_superseded AFTER UPDATE OF entity_map_revision ON support_cases
WHEN NEW.entity_map_revision <> OLD.entity_map_revision BEGIN
  UPDATE agent_jobs SET state='failed',terminal_failure_code='stale_claim',lease_owner=NULL,claim_token_hash=NULL,claimed_at=NULL,lease_expires_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND kind='text' AND state IN ('pending','leased','blocked')
     AND (entity_source_binding IS NULL OR COALESCE(json_extract(entity_source_binding,'$.mapRevision'),-1) <> NEW.entity_map_revision);
  UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL
   WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND status='processing';
  UPDATE counseling_memory_materials SET status='failed',valid=0,lease_token=NULL,lease_until=NULL,actor_id=NULL,entity_source_binding=NULL
   WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND valid=1
     AND (entity_source_binding IS NULL OR COALESCE(json_extract(entity_source_binding,'$.mapRevision'),-1) <> NEW.entity_map_revision);
  UPDATE counseling_memory_sources SET dirty=1 WHERE org_id=NEW.org_id AND support_case_id=NEW.id;
  UPDATE support_cases SET entity_map_lease_family=NULL,entity_map_lease_job_id=NULL,entity_map_lease_attempt=NULL,entity_map_lease_expires_at=NULL
   WHERE org_id=NEW.org_id AND id=NEW.id AND NOT (
     entity_map_lease_family='generic' AND entity_map_lease_job_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM agent_jobs j WHERE j.id=entity_map_lease_job_id AND j.org_id=NEW.org_id
       AND j.entity_source_binding IS NOT NULL AND COALESCE(json_extract(j.entity_source_binding,'$.mapRevision'),-1)=NEW.entity_map_revision));
  INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,enqueued_at,required_consent,consent_revision,consent_receipt_json,attempt,source_generation,updated_at)
   SELECT lower(hex(randomblob(16))),j.org_id,j.support_case_id,j.session_id,j.source_text_work_item_id,'text','pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
     j.required_consent,j.consent_revision,j.consent_receipt_json,0,c.generation,strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM agent_jobs j JOIN ai_text_work_queue q ON q.id=j.source_text_work_item_id AND q.org_id=j.org_id
    JOIN counseling_memory_cases c ON c.org_id=q.org_id AND c.support_case_id=q.support_case_id
    JOIN sessions s ON s.id=q.session_id AND s.org_id=q.org_id
   WHERE j.org_id=NEW.org_id AND j.support_case_id=NEW.id AND j.kind='text' AND j.state='failed' AND j.terminal_failure_code='stale_claim'
     AND q.status='pending'
     AND (TRIM(COALESCE(s.memo,''))<>'' OR EXISTS(SELECT 1 FROM approved_ai_briefing_v1 a WHERE a.org_id=q.org_id AND a.session_id=q.session_id AND TRIM(COALESCE(a.summary_text,''))<>''))
     AND NOT EXISTS(SELECT 1 FROM agent_jobs current WHERE current.org_id=j.org_id AND current.session_id=j.session_id AND current.kind='text' AND current.state IN ('pending','leased','blocked'))
     AND NOT EXISTS(SELECT 1 FROM agent_jobs current WHERE current.org_id=j.org_id AND current.session_id=j.session_id AND current.kind='text' AND current.source_generation=c.generation AND current.state IN ('pending','leased','blocked'));
END;
