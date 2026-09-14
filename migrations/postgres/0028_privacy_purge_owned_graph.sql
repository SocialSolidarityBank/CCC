-- Logical pair: SQLite 0072_privacy_purge_owned_graph.sql.
-- F5B: bounded case-graph purge exceptions exist only while an intent is open.

CREATE VIEW privacy_purge_open_support_cases
WITH (security_invoker=true) AS
SELECT intent.org_id, scope.support_case_id
FROM privacy_purge_events AS intent
CROSS JOIN LATERAL jsonb_array_elements_text(intent.support_case_ids_json::jsonb)
  AS scope(support_case_id)
WHERE intent.phase='intent'
  AND NOT EXISTS(
    SELECT 1 FROM privacy_purge_events AS complete
    WHERE complete.org_id=intent.org_id
      AND complete.approval_id=intent.approval_id
      AND complete.phase='complete'
  );
REVOKE ALL ON privacy_purge_open_support_cases FROM PUBLIC;
GRANT SELECT ON privacy_purge_open_support_cases TO ccc_api;

CREATE FUNCTION ccc_privacy_purge_direct_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM privacy_purge_open_support_cases AS purge
    WHERE purge.org_id=OLD.org_id AND purge.support_case_id=OLD.support_case_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=TG_ARGV[0];
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION ccc_privacy_purge_direct_history_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_privacy_purge_direct_history_guard() TO ccc_api;

DROP TRIGGER goal_revisions_no_delete ON goal_revisions;
CREATE TRIGGER goal_revisions_no_delete BEFORE DELETE ON goal_revisions FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('D62: goal_revisions is append-only');
DROP TRIGGER ai_masked_source_snapshots_no_delete ON ai_masked_source_snapshots;
CREATE TRIGGER ai_masked_source_snapshots_no_delete BEFORE DELETE ON ai_masked_source_snapshots FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('phase1: masked source snapshots are append-only');
DROP TRIGGER ai_masked_source_evidence_items_no_delete ON ai_masked_source_evidence_items;
CREATE TRIGGER ai_masked_source_evidence_items_no_delete BEFORE DELETE ON ai_masked_source_evidence_items FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('phase1: masked source evidence items are append-only');
DROP TRIGGER ai_work_items_no_delete ON ai_work_items;
CREATE TRIGGER ai_work_items_no_delete BEFORE DELETE ON ai_work_items FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('phase1: AI work items are append-only');
DROP TRIGGER ai_draft_source_materials_no_delete ON ai_draft_source_materials;
CREATE TRIGGER ai_draft_source_materials_no_delete BEFORE DELETE ON ai_draft_source_materials FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('ccc102: draft source materials are append-only');
DROP TRIGGER ai_draft_contrast_axes_no_delete ON ai_draft_contrast_axes;
CREATE TRIGGER ai_draft_contrast_axes_no_delete BEFORE DELETE ON ai_draft_contrast_axes FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('ccc102: contrast axes are append-only');
DROP TRIGGER recording_result_commits_no_delete ON recording_result_commits;
CREATE TRIGGER recording_result_commits_no_delete BEFORE DELETE ON recording_result_commits FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('recording result commits are append-only');
DROP TRIGGER pilot_text_ai_consent_evidence_no_delete ON pilot_text_ai_consent_evidence;
CREATE TRIGGER pilot_text_ai_consent_evidence_no_delete BEFORE DELETE ON pilot_text_ai_consent_evidence FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('phase1: pilot text-AI consent evidence is append-only');
DROP TRIGGER manual_action_outcomes_no_delete ON manual_action_outcomes;
CREATE TRIGGER manual_action_outcomes_no_delete BEFORE DELETE ON manual_action_outcomes FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('manual_history_immutable');
DROP TRIGGER manual_question_outcomes_no_delete ON manual_question_outcomes;
CREATE TRIGGER manual_question_outcomes_no_delete BEFORE DELETE ON manual_question_outcomes FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_direct_history_guard('manual_history_immutable');

CREATE FUNCTION ccc_privacy_purge_indirect_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edge_open boolean;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'ai_draft_versions' THEN
      SELECT EXISTS(
        SELECT 1 FROM ai_work_items AS work
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=work.org_id AND purge.support_case_id=work.support_case_id
        WHERE work.id=OLD.work_item_id
      ) INTO edge_open;
    WHEN 'ai_evidence_links' THEN
      SELECT EXISTS(
        SELECT 1 FROM ai_draft_versions AS draft
        JOIN ai_work_items AS work ON work.id=draft.work_item_id
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=work.org_id AND purge.support_case_id=work.support_case_id
        WHERE draft.id=OLD.draft_version_id
      ) INTO edge_open;
    WHEN 'ai_review_events' THEN
      SELECT EXISTS(
        SELECT 1 FROM ai_work_items AS work
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=work.org_id AND purge.support_case_id=work.support_case_id
        WHERE work.id=OLD.work_item_id
      ) INTO edge_open;
    WHEN 'agent_job_result_acceptances' THEN
      SELECT EXISTS(
        SELECT 1 FROM agent_jobs AS job
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=job.org_id AND purge.support_case_id=job.support_case_id
        WHERE job.id=OLD.job_id
      ) INTO edge_open;
    WHEN 'audio_deletion_attempts' THEN
      SELECT EXISTS(
        SELECT 1 FROM audio_objects AS audio
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=audio.org_id AND purge.support_case_id=audio.support_case_id
        WHERE audio.id=OLD.audio_object_id AND audio.org_id=OLD.org_id
      ) INTO edge_open;
    WHEN 'action_item_revisions' THEN
      SELECT EXISTS(
        SELECT 1 FROM action_items AS item
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=item.org_id AND purge.support_case_id=item.support_case_id
        WHERE item.id=OLD.action_item_id AND item.org_id=OLD.org_id
      ) INTO edge_open;
    WHEN 'schedule_question_revisions' THEN
      SELECT EXISTS(
        SELECT 1 FROM schedule_custom_questions AS question
        JOIN privacy_purge_open_support_cases AS purge
          ON purge.org_id=question.org_id AND purge.support_case_id=question.support_case_id
        WHERE question.id=OLD.question_id AND question.org_id=OLD.org_id
      ) INTO edge_open;
    ELSE edge_open := false;
  END CASE;
  IF NOT COALESCE(edge_open,false) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=TG_ARGV[0];
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION ccc_privacy_purge_indirect_history_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_privacy_purge_indirect_history_guard() TO ccc_api;

DROP TRIGGER ai_draft_versions_no_delete ON ai_draft_versions;
CREATE TRIGGER ai_draft_versions_no_delete BEFORE DELETE ON ai_draft_versions FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('phase1: AI draft versions are append-only');
DROP TRIGGER ai_evidence_links_no_delete ON ai_evidence_links;
CREATE TRIGGER ai_evidence_links_no_delete BEFORE DELETE ON ai_evidence_links FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('phase1: AI evidence links are append-only');
DROP TRIGGER ai_review_events_no_delete ON ai_review_events;
CREATE TRIGGER ai_review_events_no_delete BEFORE DELETE ON ai_review_events FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('phase1: AI review events are append-only');
DROP TRIGGER agent_job_result_acceptances_no_delete ON agent_job_result_acceptances;
CREATE TRIGGER agent_job_result_acceptances_no_delete BEFORE DELETE ON agent_job_result_acceptances FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('agent job result acceptances are append-only');
DROP TRIGGER audio_deletion_attempts_no_delete ON audio_deletion_attempts;
CREATE TRIGGER audio_deletion_attempts_no_delete BEFORE DELETE ON audio_deletion_attempts FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('audio_deletion_attempts_append_only');
DROP TRIGGER action_item_revisions_no_delete ON action_item_revisions;
CREATE TRIGGER action_item_revisions_no_delete BEFORE DELETE ON action_item_revisions FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('manual_history_immutable');
DROP TRIGGER schedule_question_revisions_no_delete ON schedule_question_revisions;
CREATE TRIGGER schedule_question_revisions_no_delete BEFORE DELETE ON schedule_question_revisions FOR EACH ROW
EXECUTE FUNCTION ccc_privacy_purge_indirect_history_guard('manual_history_immutable');

CREATE FUNCTION ccc_privacy_purge_discrepancy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolution_status IS NOT NULL
     AND NOT EXISTS(
       SELECT 1 FROM privacy_purge_open_support_cases AS purge
       WHERE purge.org_id=OLD.org_id AND purge.support_case_id=OLD.support_case_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='session_discrepancies: resolved rows are retained history';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION ccc_privacy_purge_discrepancy_history_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_privacy_purge_discrepancy_history_guard() TO ccc_api;
DROP TRIGGER session_discrepancies_resolved_no_delete ON session_discrepancies;
CREATE TRIGGER session_discrepancies_resolved_no_delete BEFORE DELETE ON session_discrepancies
FOR EACH ROW EXECUTE FUNCTION ccc_privacy_purge_discrepancy_history_guard();

CREATE FUNCTION ccc_privacy_purge_owned_graph_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase='complete' AND (
    EXISTS(SELECT 1 FROM audio_objects WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM goals WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM action_items WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM flags WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM counseling_schedules WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM schedule_session_goals WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM schedule_custom_questions WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM ai_masked_source_snapshots WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM ai_masked_source_evidence_items WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM ai_work_items WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM ai_draft_source_materials WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM ai_draft_contrast_axes WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM recording_result_commits WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM pilot_text_ai_consent_evidence WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM manual_action_outcomes WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM manual_question_outcomes WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM goal_revisions WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
    OR EXISTS(SELECT 1 FROM session_discrepancies WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='privacy_purge_scope_not_erased';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ccc_privacy_purge_owned_graph_complete_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_privacy_purge_owned_graph_complete_guard() TO ccc_api;
CREATE TRIGGER privacy_purge_owned_graph_complete_guard BEFORE INSERT ON privacy_purge_events
FOR EACH ROW EXECUTE FUNCTION ccc_privacy_purge_owned_graph_complete_guard();
