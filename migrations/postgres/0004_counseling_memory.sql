-- Auxiliary case memory; source invalidation is atomic with source changes.
CREATE TABLE counseling_memory_settings(org_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE counseling_memory_cases(support_case_id TEXT PRIMARY KEY REFERENCES support_cases(id),org_id TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 1,applied_generation INTEGER NOT NULL DEFAULT 0,correction_revision INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'backfill',reason TEXT,updated_at TEXT,cursor TEXT NOT NULL DEFAULT '',backfill_done INTEGER NOT NULL DEFAULT 0,not_before TEXT NOT NULL DEFAULT '',lease_token TEXT,lease_until TEXT,work_id TEXT,work_generation INTEGER,work_correction INTEGER,work_settings INTEGER,consent_revision TEXT,egress TEXT,request_json TEXT,config_hash TEXT,summary_json TEXT NOT NULL DEFAULT '[]',UNIQUE(org_id,support_case_id));
CREATE TABLE counseling_memory_sources(org_id TEXT NOT NULL,support_case_id TEXT NOT NULL REFERENCES counseling_memory_cases(support_case_id),kind TEXT NOT NULL,source_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,dirty INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(org_id,support_case_id,kind,source_id));
CREATE TABLE counseling_memory_materials(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL REFERENCES counseling_memory_cases(support_case_id),kind TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,session_id TEXT,occurred_at TEXT NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempt INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,actor_id TEXT,attestation_json TEXT,receipt_id TEXT,snapshot_id TEXT,masked_text TEXT,sha256 TEXT,proof_json TEXT,payload_hash TEXT,processed INTEGER NOT NULL DEFAULT 0,valid INTEGER NOT NULL DEFAULT 1,UNIQUE(org_id,support_case_id,kind,source_id,source_revision,start_offset));
CREATE TABLE counseling_memory_items(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,revision INTEGER NOT NULL,item_json TEXT NOT NULL,valid INTEGER NOT NULL DEFAULT 1);
CREATE TABLE counseling_memory_history(id TEXT NOT NULL,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,revision INTEGER NOT NULL,item_json TEXT NOT NULL,PRIMARY KEY(id,revision));
CREATE TABLE counseling_memory_links(item_id TEXT NOT NULL,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(item_id,kind,source_id));
CREATE TABLE counseling_memory_corrections(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE counseling_memory_derived(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE counseling_memory_agents(org_id TEXT NOT NULL,actor_id TEXT NOT NULL,attestation_json TEXT NOT NULL,receipt_id TEXT NOT NULL,seen_at TEXT NOT NULL,PRIMARY KEY(org_id,actor_id));
CREATE TABLE counseling_memory_draft_context(draft_id TEXT PRIMARY KEY REFERENCES ai_draft_versions(id),org_id TEXT NOT NULL,support_case_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot_ids TEXT NOT NULL);
CREATE INDEX counseling_memory_pending ON counseling_memory_cases(status,not_before);
CREATE INDEX counseling_memory_mask_pending ON counseling_memory_materials(org_id,status,valid);
CREATE INDEX counseling_memory_source_dirty ON counseling_memory_sources(org_id,support_case_id,dirty);
INSERT INTO counseling_memory_cases(support_case_id,org_id) SELECT id,org_id FROM support_cases;
CREATE TABLE counseling_memory_guards(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CONSTRAINT counseling_memory_fence CHECK(ok=1));
ALTER TABLE counseling_memory_sources ADD COLUMN chunk_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE counseling_memory_materials ADD COLUMN attestation_expires_at TEXT;
CREATE FUNCTION cm_source_cursor_reset_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
UPDATE counseling_memory_sources SET chunk_cursor=0 WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind=NEW.kind AND source_id=NEW.source_id;

RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_source_cursor_reset AFTER UPDATE OF revision ON counseling_memory_sources FOR EACH ROW EXECUTE FUNCTION cm_source_cursor_reset_fn();
CREATE FUNCTION cm_sessions_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'session',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_sessions_insert AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION cm_sessions_insert_fn();
CREATE FUNCTION cm_sessions_update_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.memo IS DISTINCT FROM OLD.memo OR NEW.record_details IS DISTINCT FROM OLD.record_details OR NEW.intake_details IS DISTINCT FROM OLD.intake_details OR NEW.held_at IS DISTINCT FROM OLD.held_at OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'session',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_sessions_update AFTER UPDATE OF memo,record_details,intake_details,held_at,approved_at ON sessions FOR EACH ROW EXECUTE FUNCTION cm_sessions_update_fn();
CREATE FUNCTION cm_sessions_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(OLD.org_id,OLD.support_case_id,'session',OLD.id,1) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=1;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_sessions_delete AFTER DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION cm_sessions_delete_fn();
CREATE FUNCTION cm_goals_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'goal',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='goal' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='goal' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_goals_insert AFTER INSERT ON goals FOR EACH ROW EXECUTE FUNCTION cm_goals_insert_fn();
CREATE FUNCTION cm_goals_update_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.title IS DISTINCT FROM OLD.title OR NEW.status IS DISTINCT FROM OLD.status THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'goal',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='goal' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='goal' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_goals_update AFTER UPDATE OF title,status ON goals FOR EACH ROW EXECUTE FUNCTION cm_goals_update_fn();
CREATE FUNCTION cm_goals_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(OLD.org_id,OLD.support_case_id,'goal',OLD.id,1) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=1;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='goal' AND source_id=OLD.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='goal' AND source_id=OLD.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_goals_delete AFTER DELETE ON goals FOR EACH ROW EXECUTE FUNCTION cm_goals_delete_fn();
CREATE FUNCTION cm_action_items_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'action',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='action' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='action' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_action_items_insert AFTER INSERT ON action_items FOR EACH ROW EXECUTE FUNCTION cm_action_items_insert_fn();
CREATE FUNCTION cm_action_items_update_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.description IS DISTINCT FROM OLD.description OR NEW.owner IS DISTINCT FROM OLD.owner OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_status IS DISTINCT FROM OLD.resolution_status OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'action',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='action' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='action' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_action_items_update AFTER UPDATE OF description,owner,due_date,resolved_at,resolution_status,resolution_note ON action_items FOR EACH ROW EXECUTE FUNCTION cm_action_items_update_fn();
CREATE FUNCTION cm_action_items_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(OLD.org_id,OLD.support_case_id,'action',OLD.id,1) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=1;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='action' AND source_id=OLD.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='action' AND source_id=OLD.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_action_items_delete AFTER DELETE ON action_items FOR EACH ROW EXECUTE FUNCTION cm_action_items_delete_fn();
CREATE FUNCTION cm_overall_goal_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.overall_goal IS DISTINCT FROM OLD.overall_goal THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.id,'goal',NEW.id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND kind='goal' AND source_id=NEW.id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.id AND kind='goal' AND source_id=NEW.id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_overall_goal AFTER UPDATE OF overall_goal ON support_cases FOR EACH ROW EXECUTE FUNCTION cm_overall_goal_fn();
CREATE FUNCTION cm_case_created_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.id,NEW.org_id);
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_case_created AFTER INSERT ON support_cases FOR EACH ROW EXECUTE FUNCTION cm_case_created_fn();
CREATE FUNCTION cm_lifecycle_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at OR NEW.status IS DISTINCT FROM OLD.status THEN
UPDATE counseling_memory_cases SET generation=generation+1,lease_token=NULL,egress=NULL,request_json=NULL,status=CASE WHEN NEW.consent_text_ai_at IS NULL THEN 'unavailable' WHEN NEW.status<>'active' THEN 'closed' ELSE 'backfill' END,reason=CASE WHEN NEW.consent_text_ai_at IS NULL THEN 'consent_not_effective' ELSE NULL END,summary_json=CASE WHEN NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at THEN '[]' ELSE summary_json END,cursor=CASE WHEN NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at THEN '' ELSE cursor END,backfill_done=CASE WHEN NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at THEN 0 ELSE backfill_done END WHERE support_case_id=NEW.id;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE support_case_id=NEW.id AND NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at;
UPDATE counseling_memory_items SET valid=0 WHERE support_case_id=NEW.id AND NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at;
UPDATE counseling_memory_sources SET dirty=1,revision=revision+1 WHERE support_case_id=NEW.id AND NEW.consent_text_ai_at IS DISTINCT FROM OLD.consent_text_ai_at;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_lifecycle AFTER UPDATE OF consent_text_ai_at,status ON support_cases FOR EACH ROW EXECUTE FUNCTION cm_lifecycle_fn();
CREATE FUNCTION cm_archive_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
UPDATE counseling_memory_cases SET generation=generation+1,status='unavailable',reason='pii_archived',lease_token=NULL,egress=NULL,request_json=NULL WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_archive AFTER INSERT ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION cm_archive_fn();
CREATE FUNCTION cm_purge_participant_pii_vault_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.purged_at IS NOT NULL THEN
DELETE FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_history WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_items WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_materials WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_sources WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_corrections WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_derived WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_draft_context WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='unavailable',reason='pii_purged',summary_json='[]',request_json=NULL,lease_token=NULL,egress=NULL WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_purge_participant_pii_vault AFTER UPDATE OF purged_at ON participant_pii_vault FOR EACH ROW EXECUTE FUNCTION cm_purge_participant_pii_vault_fn();
CREATE FUNCTION cm_purge_participant_pii_archives_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.purged_at IS NOT NULL THEN
DELETE FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_history WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_items WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_materials WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_sources WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_corrections WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_derived WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
DELETE FROM counseling_memory_draft_context WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='unavailable',reason='pii_purged',summary_json='[]',request_json=NULL,lease_token=NULL,egress=NULL WHERE org_id=NEW.org_id AND support_case_id IN(SELECT id FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id);
END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_purge_participant_pii_archives AFTER UPDATE OF purged_at ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION cm_purge_participant_pii_archives_fn();

CREATE FUNCTION cm_invalidate_derived_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.valid=0 THEN
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind IN('correction','derived_summary') AND source_id=NEW.id;
 UPDATE counseling_memory_sources SET dirty=0,deleted=1 WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind IN('correction','derived_summary') AND source_id=NEW.id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_invalidate_derived AFTER UPDATE OF valid ON counseling_memory_items FOR EACH ROW EXECUTE FUNCTION cm_invalidate_derived_fn();
CREATE FUNCTION cm_release_superseded_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
UPDATE counseling_memory_cases SET lease_until=NULL WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id AND lease_token IS NULL;

RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_release_superseded AFTER UPDATE OF generation ON counseling_memory_cases FOR EACH ROW EXECUTE FUNCTION cm_release_superseded_fn();
CREATE FUNCTION cm_life_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES((SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id),NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id),'session',NEW.session_id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND kind='session' AND source_id=NEW.session_id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND kind='session' AND source_id=NEW.session_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_life_insert AFTER INSERT ON session_life_area_snapshots FOR EACH ROW EXECUTE FUNCTION cm_life_insert_fn();
CREATE FUNCTION cm_session_goal_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF (SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id) IS NOT NULL THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'session',(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id),0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id);
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id));
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_session_goal_insert AFTER INSERT ON schedule_session_goals FOR EACH ROW EXECUTE FUNCTION cm_session_goal_insert_fn();
CREATE FUNCTION cm_life_update_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES((SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id),NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id),'session',NEW.session_id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND kind='session' AND source_id=NEW.session_id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND kind='session' AND source_id=NEW.session_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=(SELECT support_case_id FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id) AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_life_update AFTER UPDATE ON session_life_area_snapshots FOR EACH ROW EXECUTE FUNCTION cm_life_update_fn();
CREATE FUNCTION cm_session_goal_update_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF (SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id) IS NOT NULL THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'session',(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id),0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id);
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id));
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_session_goal_update AFTER UPDATE ON schedule_session_goals FOR EACH ROW EXECUTE FUNCTION cm_session_goal_update_fn();
CREATE FUNCTION cm_life_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF TRUE THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES((SELECT support_case_id FROM sessions WHERE id=OLD.session_id AND org_id=OLD.org_id),OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(OLD.org_id,(SELECT support_case_id FROM sessions WHERE id=OLD.session_id AND org_id=OLD.org_id),'session',OLD.session_id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=OLD.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=OLD.session_id AND org_id=OLD.org_id) AND kind='session' AND source_id=OLD.session_id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=OLD.org_id AND support_case_id=(SELECT support_case_id FROM sessions WHERE id=OLD.session_id AND org_id=OLD.org_id) AND kind='session' AND source_id=OLD.session_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=(SELECT support_case_id FROM sessions WHERE id=OLD.session_id AND org_id=OLD.org_id) AND org_id=OLD.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_life_delete AFTER DELETE ON session_life_area_snapshots FOR EACH ROW EXECUTE FUNCTION cm_life_delete_fn();
CREATE FUNCTION cm_session_goal_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF (SELECT completed_session_id FROM counseling_schedules WHERE id=OLD.schedule_id AND org_id=OLD.org_id) IS NOT NULL THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(OLD.org_id,OLD.support_case_id,'session',(SELECT completed_session_id FROM counseling_schedules WHERE id=OLD.schedule_id AND org_id=OLD.org_id),0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=OLD.schedule_id AND org_id=OLD.org_id);
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=(SELECT completed_session_id FROM counseling_schedules WHERE id=OLD.schedule_id AND org_id=OLD.org_id));
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_session_goal_delete AFTER DELETE ON schedule_session_goals FOR EACH ROW EXECUTE FUNCTION cm_session_goal_delete_fn();
CREATE FUNCTION cm_schedule_complete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
IF NEW.completed_session_id IS NOT NULL AND NEW.completed_session_id IS DISTINCT FROM OLD.completed_session_id THEN
INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES(NEW.support_case_id,NEW.org_id) ON CONFLICT(support_case_id) DO NOTHING;
INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted) VALUES(NEW.org_id,NEW.support_case_id,'session',NEW.completed_session_id,0) ON CONFLICT(org_id,support_case_id,kind,source_id) DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=0;
UPDATE counseling_memory_materials SET valid=0,lease_token=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.completed_session_id;
UPDATE counseling_memory_items SET valid=0 WHERE (item_json::jsonb ->> 'correctedAt') IS NULL AND id IN(SELECT item_id FROM counseling_memory_links WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND kind='session' AND source_id=NEW.completed_session_id);
UPDATE counseling_memory_cases SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,not_before=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id;

END IF;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_schedule_complete AFTER UPDATE OF completed_session_id ON counseling_schedules FOR EACH ROW EXECUTE FUNCTION cm_schedule_complete_fn();
CREATE FUNCTION cm_consent_evidence_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
UPDATE counseling_memory_cases SET generation=generation+1,lease_token=NULL,lease_until=NULL,request_json=NULL,egress=NULL WHERE org_id=NEW.org_id AND support_case_id=NEW.support_case_id;
RETURN NULL;
END;
$memory$;
CREATE TRIGGER cm_consent_evidence AFTER INSERT ON pilot_text_ai_consent_evidence FOR EACH ROW EXECUTE FUNCTION cm_consent_evidence_fn();
