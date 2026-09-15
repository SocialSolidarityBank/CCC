-- F5B: extend the F5 purge writer to the bounded, proven-owned case graph.
-- Immutable history remains protected unless its support case has an open purge intent.

CREATE VIEW privacy_purge_open_support_cases AS
SELECT intent.org_id, CAST(scope.value AS TEXT) AS support_case_id
FROM privacy_purge_events AS intent, json_each(intent.support_case_ids_json) AS scope
WHERE intent.phase = 'intent'
  AND NOT EXISTS (
    SELECT 1 FROM privacy_purge_events AS complete
    WHERE complete.org_id = intent.org_id
      AND complete.approval_id = intent.approval_id
      AND complete.phase = 'complete'
  );

DROP TRIGGER goal_revisions_no_delete;
CREATE TRIGGER goal_revisions_no_delete
BEFORE DELETE ON goal_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'D62: goal_revisions is append-only'); END;

DROP TRIGGER ai_masked_source_snapshots_no_delete;
CREATE TRIGGER ai_masked_source_snapshots_no_delete
BEFORE DELETE ON ai_masked_source_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;

DROP TRIGGER ai_masked_source_evidence_items_no_delete;
CREATE TRIGGER ai_masked_source_evidence_items_no_delete
BEFORE DELETE ON ai_masked_source_evidence_items
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;

DROP TRIGGER ai_work_items_no_delete;
CREATE TRIGGER ai_work_items_no_delete
BEFORE DELETE ON ai_work_items
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;

DROP TRIGGER ai_draft_versions_no_delete;
CREATE TRIGGER ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM ai_work_items AS work
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = work.org_id AND purge.support_case_id = work.support_case_id
  WHERE work.id = OLD.work_item_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only'); END;

DROP TRIGGER ai_evidence_links_no_delete;
CREATE TRIGGER ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
WHEN NOT EXISTS (
  SELECT 1
  FROM ai_draft_versions AS draft
  JOIN ai_work_items AS work ON work.id = draft.work_item_id
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = work.org_id AND purge.support_case_id = work.support_case_id
  WHERE draft.id = OLD.draft_version_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

DROP TRIGGER ai_review_events_no_delete;
CREATE TRIGGER ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
WHEN NOT EXISTS (
  SELECT 1
  FROM ai_work_items AS work
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = work.org_id AND purge.support_case_id = work.support_case_id
  WHERE work.id = OLD.work_item_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

DROP TRIGGER ai_draft_source_materials_no_delete;
CREATE TRIGGER ai_draft_source_materials_no_delete
BEFORE DELETE ON ai_draft_source_materials
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'ccc102: draft source materials are append-only'); END;

DROP TRIGGER ai_draft_contrast_axes_no_delete;
CREATE TRIGGER ai_draft_contrast_axes_no_delete
BEFORE DELETE ON ai_draft_contrast_axes
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'ccc102: contrast axes are append-only'); END;

DROP TRIGGER recording_result_commits_no_delete;
CREATE TRIGGER recording_result_commits_no_delete
BEFORE DELETE ON recording_result_commits
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'recording result commits are append-only'); END;

DROP TRIGGER agent_job_result_acceptances_no_delete;
CREATE TRIGGER agent_job_result_acceptances_no_delete
BEFORE DELETE ON agent_job_result_acceptances
WHEN NOT EXISTS (
  SELECT 1
  FROM agent_jobs AS job
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = job.org_id AND purge.support_case_id = job.support_case_id
  WHERE job.id = OLD.job_id
)
BEGIN SELECT RAISE(ABORT, 'agent job result acceptances are append-only'); END;

DROP TRIGGER audio_deletion_attempts_no_delete;
CREATE TRIGGER audio_deletion_attempts_no_delete
BEFORE DELETE ON audio_deletion_attempts
WHEN NOT EXISTS (
  SELECT 1
  FROM audio_objects AS audio
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = audio.org_id AND purge.support_case_id = audio.support_case_id
  WHERE audio.id = OLD.audio_object_id AND audio.org_id = OLD.org_id
)
BEGIN SELECT RAISE(ABORT, 'audio_deletion_attempts_append_only'); END;

DROP TRIGGER pilot_text_ai_consent_evidence_no_delete;
CREATE TRIGGER pilot_text_ai_consent_evidence_no_delete
BEFORE DELETE ON pilot_text_ai_consent_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;

DROP TRIGGER session_discrepancies_resolved_no_delete;
CREATE TRIGGER session_discrepancies_resolved_no_delete
BEFORE DELETE ON session_discrepancies
WHEN OLD.resolution_status IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM privacy_purge_open_support_cases AS purge
   WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
 )
BEGIN SELECT RAISE(ABORT, 'session_discrepancies: resolved rows are retained history'); END;

DROP TRIGGER action_item_revisions_no_delete;
CREATE TRIGGER action_item_revisions_no_delete
BEFORE DELETE ON action_item_revisions
WHEN NOT EXISTS (
  SELECT 1
  FROM action_items AS item
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = item.org_id AND purge.support_case_id = item.support_case_id
  WHERE item.id = OLD.action_item_id AND item.org_id = OLD.org_id
)
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;

DROP TRIGGER schedule_question_revisions_no_delete;
CREATE TRIGGER schedule_question_revisions_no_delete
BEFORE DELETE ON schedule_question_revisions
WHEN NOT EXISTS (
  SELECT 1
  FROM schedule_custom_questions AS question
  JOIN privacy_purge_open_support_cases AS purge
    ON purge.org_id = question.org_id AND purge.support_case_id = question.support_case_id
  WHERE question.id = OLD.question_id AND question.org_id = OLD.org_id
)
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;

DROP TRIGGER manual_action_outcomes_no_delete;
CREATE TRIGGER manual_action_outcomes_no_delete
BEFORE DELETE ON manual_action_outcomes
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;

DROP TRIGGER manual_question_outcomes_no_delete;
CREATE TRIGGER manual_question_outcomes_no_delete
BEFORE DELETE ON manual_question_outcomes
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_open_support_cases AS purge
  WHERE purge.org_id = OLD.org_id AND purge.support_case_id = OLD.support_case_id
)
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;

CREATE TRIGGER privacy_purge_owned_graph_complete_guard
BEFORE INSERT ON privacy_purge_events
WHEN NEW.phase = 'complete'
BEGIN
  SELECT RAISE(ABORT, 'privacy_purge_scope_not_erased')
  WHERE EXISTS (
    SELECT 1 FROM audio_objects AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM goals AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM action_items AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM flags AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM counseling_schedules AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM schedule_session_goals AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM schedule_custom_questions AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM ai_masked_source_snapshots AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM ai_masked_source_evidence_items AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM ai_work_items AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM ai_draft_source_materials AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM ai_draft_contrast_axes AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM recording_result_commits AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM pilot_text_ai_consent_evidence AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM manual_action_outcomes AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM manual_question_outcomes AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM goal_revisions AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  ) OR EXISTS (
    SELECT 1 FROM session_discrepancies AS row, json_each(NEW.support_case_ids_json) AS scope
    WHERE row.org_id = NEW.org_id AND row.support_case_id = CAST(scope.value AS TEXT)
  );
END;
