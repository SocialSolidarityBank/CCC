-- ============================================================================
-- Migration 0006 — participant / SupportCase FK-on cutover
--
-- The private `_next` graph is built and reconciled before publication. FK
-- enforcement stays on for the entire DAG; the migration runner executes this
-- file as one atomic D1 batch, so assertion failure leaves the legacy graph intact.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE participant_support_case_cutover_assertions (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- Every 0005 backfill is reconciled bidirectionally against its legacy source
-- before the legacy graph is dropped. This detects post-expand divergence as
-- well as partial or stale copies.
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'support_case_program_type', 0
WHERE EXISTS (
  SELECT 1 FROM support_cases
  WHERE program_type <> 'financial_support_v1'
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_beneficiary_copy_forward', 0
WHERE EXISTS (
  SELECT legacy_case.id, legacy_case.org_id, 'complete',
         legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
  EXCEPT
  SELECT beneficiary.id, beneficiary.org_id, beneficiary.initialization_state,
         beneficiary.created_at, beneficiary.updated_at
  FROM beneficiaries AS beneficiary
  JOIN support_cases AS support_case
    ON support_case.beneficiary_id = beneficiary.id
   AND support_case.org_id = beneficiary.org_id
  WHERE support_case.creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_beneficiary_copy_reverse', 0
WHERE EXISTS (
  SELECT beneficiary.id, beneficiary.org_id, beneficiary.initialization_state,
         beneficiary.created_at, beneficiary.updated_at
  FROM beneficiaries AS beneficiary
  JOIN support_cases AS support_case
    ON support_case.beneficiary_id = beneficiary.id
   AND support_case.org_id = beneficiary.org_id
  WHERE support_case.creation_kind = 'legacy_import'
  EXCEPT
  SELECT legacy_case.id, legacy_case.org_id, 'complete',
         legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_support_case_copy_forward', 0
WHERE EXISTS (
  SELECT
    'legacy-support-case:' || legacy_case.id, legacy_case.org_id, legacy_case.id,
    legacy_case.id, legacy_case.program_type, legacy_case.status, legacy_case.intake_at,
    legacy_case.consent_recording_at, legacy_case.consent_text_ai_at, legacy_case.closed_at,
    legacy_case.closed_reason, NULL, legacy_case.extra, 'legacy_import', NULL, NULL,
    NULL, NULL, NULL, legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
  EXCEPT
  SELECT
    id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
    consent_recording_at, consent_text_ai_at, closed_at, closed_reason, closed_by_actor_id,
    extra, creation_kind, creation_submission_id, creation_payload_hash,
    created_by_actor_id, source_support_case_id, initial_assignee_user_id, created_at, updated_at
  FROM support_cases
  WHERE creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_support_case_copy_reverse', 0
WHERE EXISTS (
  SELECT
    id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
    consent_recording_at, consent_text_ai_at, closed_at, closed_reason, closed_by_actor_id,
    extra, creation_kind, creation_submission_id, creation_payload_hash,
    created_by_actor_id, source_support_case_id, initial_assignee_user_id, created_at, updated_at
  FROM support_cases
  WHERE creation_kind = 'legacy_import'
  EXCEPT
  SELECT
    'legacy-support-case:' || legacy_case.id, legacy_case.org_id, legacy_case.id,
    legacy_case.id, legacy_case.program_type, legacy_case.status, legacy_case.intake_at,
    legacy_case.consent_recording_at, legacy_case.consent_text_ai_at, legacy_case.closed_at,
    legacy_case.closed_reason, NULL, legacy_case.extra, 'legacy_import', NULL, NULL,
    NULL, NULL, NULL, legacy_case.created_at, legacy_case.updated_at
  FROM cases AS legacy_case
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_pii_vault_copy_forward', 0
WHERE EXISTS (
  SELECT
    legacy_vault.case_id, legacy_vault.org_id, legacy_vault.enc_name, legacy_vault.enc_phone,
    legacy_vault.enc_account, legacy_vault.key_version, 1, legacy_case.purge_due,
    legacy_vault.purged_at, NULL, NULL, NULL, NULL, 'legacy_import',
    legacy_vault.updated_at, legacy_vault.created_at, legacy_vault.updated_at
  FROM pii_vault AS legacy_vault
  JOIN cases AS legacy_case ON legacy_case.id = legacy_vault.case_id
  EXCEPT
  SELECT
    beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
    purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
    retention_context_support_case_id, retention_change_kind, retention_changed_at,
    created_at, updated_at
  FROM participant_pii_vault
  WHERE retention_change_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_pii_vault_copy_reverse', 0
WHERE EXISTS (
  SELECT
    beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
    purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
    retention_context_support_case_id, retention_change_kind, retention_changed_at,
    created_at, updated_at
  FROM participant_pii_vault
  WHERE retention_change_kind = 'legacy_import'
  EXCEPT
  SELECT
    legacy_vault.case_id, legacy_vault.org_id, legacy_vault.enc_name, legacy_vault.enc_phone,
    legacy_vault.enc_account, legacy_vault.key_version, 1, legacy_case.purge_due,
    legacy_vault.purged_at, NULL, NULL, NULL, NULL, 'legacy_import',
    legacy_vault.updated_at, legacy_vault.created_at, legacy_vault.updated_at
  FROM pii_vault AS legacy_vault
  JOIN cases AS legacy_case ON legacy_case.id = legacy_vault.case_id
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_assignment_copy_forward', 0
WHERE EXISTS (
  SELECT
    legacy_assignment.id, legacy_assignment.org_id,
    'legacy-support-case:' || legacy_assignment.case_id,
    legacy_assignment.user_id, legacy_assignment.role, legacy_assignment.assigned_at,
    legacy_assignment.unassigned_at
  FROM case_assignees AS legacy_assignment
  EXCEPT
  SELECT
    assignment.id, assignment.org_id, assignment.support_case_id, assignment.user_id,
    assignment.role, assignment.assigned_at, assignment.unassigned_at
  FROM support_case_assignees AS assignment
  JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
  WHERE support_case.creation_kind = 'legacy_import'
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'legacy_assignment_copy_reverse', 0
WHERE EXISTS (
  SELECT
    assignment.id, assignment.org_id, assignment.support_case_id, assignment.user_id,
    assignment.role, assignment.assigned_at, assignment.unassigned_at
  FROM support_case_assignees AS assignment
  JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
  WHERE support_case.creation_kind = 'legacy_import'
  EXCEPT
  SELECT
    legacy_assignment.id, legacy_assignment.org_id,
    'legacy-support-case:' || legacy_assignment.case_id,
    legacy_assignment.user_id, legacy_assignment.role, legacy_assignment.assigned_at,
    legacy_assignment.unassigned_at
  FROM case_assignees AS legacy_assignment
);

-- Parent first: every private edge below targets the `_next` parent graph.
CREATE TABLE support_cases_next (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  beneficiary_id           TEXT NOT NULL REFERENCES beneficiaries (id),
  legacy_case_id           TEXT UNIQUE,
  program_type             TEXT NOT NULL DEFAULT 'financial_support_v1'
                           CHECK (program_type IN ('financial_support_v1')),
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'closed')),
  intake_at                TEXT,
  consent_recording_at     TEXT,
  consent_text_ai_at       TEXT,
  closed_at                TEXT,
  closed_reason            TEXT,
  closed_by_actor_id       TEXT,
  extra                    TEXT,
  creation_kind            TEXT NOT NULL
                           CHECK (creation_kind IN ('legacy_import', 'initial', 'subsequent')),
  creation_submission_id   TEXT,
  creation_payload_hash    TEXT
                           CHECK (
                             creation_payload_hash IS NULL OR
                             (length(creation_payload_hash) = 64
                              AND creation_payload_hash NOT GLOB '*[^0-9a-f]*')
                           ),
  created_by_actor_id      TEXT,
  source_support_case_id   TEXT REFERENCES support_cases_next (id),
  initial_assignee_user_id TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (
    (creation_kind IN ('legacy_import', 'initial')
      AND creation_submission_id IS NULL
      AND creation_payload_hash IS NULL
      AND created_by_actor_id IS NULL
      AND source_support_case_id IS NULL
      AND initial_assignee_user_id IS NULL)
    OR
    (creation_kind = 'subsequent'
      AND length(trim(creation_submission_id)) > 0
      AND creation_payload_hash IS NOT NULL
      AND length(trim(created_by_actor_id)) > 0
      AND length(trim(initial_assignee_user_id)) > 0)
  ),
  CHECK (
    (creation_kind = 'legacy_import' AND legacy_case_id IS NOT NULL)
    OR (creation_kind = 'initial'
        AND (legacy_case_id IS NULL OR legacy_case_id = beneficiary_id))
    OR (creation_kind = 'subsequent' AND legacy_case_id IS NULL)
  ),
  CHECK (
    creation_kind = 'legacy_import'
    OR (status = 'active' AND closed_at IS NULL AND closed_reason IS NULL AND closed_by_actor_id IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL
     AND closed_by_actor_id IS NOT NULL)
  )
);

WITH RECURSIVE support_case_order(id, depth) AS (
  SELECT id, 0 FROM support_cases WHERE source_support_case_id IS NULL
  UNION ALL
  SELECT child.id, parent.depth + 1
  FROM support_cases AS child
  JOIN support_case_order AS parent ON parent.id = child.source_support_case_id
)
INSERT INTO support_cases_next
SELECT support_case.*
FROM support_cases AS support_case
JOIN support_case_order AS ordered ON ordered.id = support_case.id
ORDER BY ordered.depth;

CREATE TABLE participant_pii_vault_next (
  beneficiary_id                    TEXT PRIMARY KEY REFERENCES beneficiaries (id),
  org_id                            TEXT NOT NULL,
  enc_name                          TEXT,
  enc_phone                         TEXT,
  enc_account                       TEXT,
  key_version                       INTEGER NOT NULL CHECK (key_version > 0),
  version                           INTEGER NOT NULL CHECK (version > 0),
  purge_due                         TEXT,
  purged_at                         TEXT,
  purged_by                         TEXT,
  purged_by_role                    TEXT CHECK (purged_by_role IN ('admin', 'service')),
  retention_changed_by              TEXT,
  retention_context_support_case_id TEXT REFERENCES support_cases_next (id),
  retention_change_kind             TEXT NOT NULL
                                    CHECK (retention_change_kind IN (
                                      'legacy_import', 'create',
                                      'schedule_pii_purge_due',
                                      'cancel_pii_purge_due', 'purge_pii',
                                      're_register_pii'
                                    )),
  retention_changed_at              TEXT NOT NULL,
  created_at                        TEXT NOT NULL,
  updated_at                        TEXT NOT NULL,
  CHECK (
    (purged_at IS NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (retention_change_kind = 'legacy_import' AND purged_at IS NOT NULL
      AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (purged_at IS NOT NULL AND purged_by IS NOT NULL AND purged_by_role IN ('admin', 'service'))
  ),
  CHECK (
    retention_change_kind = 'legacy_import'
    OR purged_at IS NULL
    OR (enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL)
  )
);
INSERT INTO participant_pii_vault_next SELECT * FROM participant_pii_vault;

CREATE TABLE support_case_assignees_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
  assigned_at     TEXT NOT NULL,
  unassigned_at   TEXT
);
INSERT INTO support_case_assignees_next SELECT * FROM support_case_assignees;

CREATE TABLE goals_next (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  support_case_id     TEXT NOT NULL REFERENCES support_cases_next (id),
  title               TEXT NOT NULL,
  scale_criteria      TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  closed_reason       TEXT,
  closed_at           TEXT,
  replaced_by_goal_id TEXT REFERENCES goals_next (id),
  created_at          TEXT NOT NULL
);
WITH RECURSIVE goal_order(id, depth) AS (
  SELECT id, 0 FROM goals WHERE replaced_by_goal_id IS NULL
  UNION ALL
  SELECT goal.id, replacement.depth + 1
  FROM goals AS goal
  JOIN goal_order AS replacement ON replacement.id = goal.replaced_by_goal_id
)
INSERT INTO goals_next (
  id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
  closed_at, replaced_by_goal_id, created_at
)
SELECT
  goal.id, goal.org_id, support_case.id, goal.title, goal.scale_criteria,
  goal.status, goal.closed_reason, goal.closed_at, goal.replaced_by_goal_id,
  goal.created_at
FROM goals AS goal
JOIN goal_order AS ordered ON ordered.id = goal.id
JOIN support_cases AS support_case ON support_case.legacy_case_id = goal.case_id
ORDER BY ordered.depth;

CREATE TABLE sessions_next (
  id                           TEXT PRIMARY KEY,
  org_id                       TEXT NOT NULL,
  support_case_id              TEXT NOT NULL REFERENCES support_cases_next (id),
  counselor_id                 TEXT NOT NULL,
  held_at                      TEXT NOT NULL,
  channel                      TEXT NOT NULL CHECK (channel IN ('in_person', 'phone', 'video')),
  memo                         TEXT,
  submission_id                TEXT,
  submission_hash              TEXT CHECK (
                                 submission_hash IS NULL OR
                                 (length(submission_hash) = 64
                                  AND submission_hash NOT GLOB '*[^0-9a-f]*')
                               ),
  submitted_by                 TEXT,
  ai_status                    TEXT NOT NULL
                               CHECK (ai_status IN ('none', 'uploaded', 'processing', 'review_ready', 'approved')),
  transcript                   TEXT,
  audio_r2_key                 TEXT,
  ai_summary                   TEXT,
  ai_schema                    TEXT,
  ai_contrast                  TEXT,
  emotion_scores               TEXT,
  speaker_mapping_confirmed_at TEXT,
  approved_at                  TEXT,
  approved_by                  TEXT,
  extra                        TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  CHECK (
    (submission_id IS NULL AND submission_hash IS NULL AND submitted_by IS NULL)
    OR
    (length(trim(submission_id)) > 0 AND submission_hash IS NOT NULL
     AND length(trim(submitted_by)) > 0)
  )
);
INSERT INTO sessions_next (
  id, org_id, support_case_id, counselor_id, held_at, channel, memo,
  submission_id, submission_hash, submitted_by, ai_status, transcript,
  audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
  speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
)
SELECT
  session.id, session.org_id, support_case.id, session.counselor_id,
  session.held_at, session.channel, session.memo, NULL, NULL, NULL,
  session.ai_status, session.transcript, session.audio_r2_key, session.ai_summary,
  session.ai_schema, session.ai_contrast, session.emotion_scores,
  session.speaker_mapping_confirmed_at, session.approved_at, session.approved_by,
  session.extra, session.created_at, session.updated_at
FROM sessions AS session
JOIN support_cases AS support_case ON support_case.legacy_case_id = session.case_id;

CREATE TABLE counseling_schedules_next (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases_next (id),
  scheduled_at          TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  version               INTEGER NOT NULL CHECK (version > 0),
  completed_session_id  TEXT REFERENCES sessions_next (id),
  created_by_actor_id   TEXT NOT NULL,
  updated_by_actor_id   TEXT,
  completed_by_actor_id TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK (
    (status IN ('scheduled', 'cancelled', 'no_show') AND completed_session_id IS NULL
      AND completed_by_actor_id IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND completed_session_id IS NOT NULL
      AND completed_by_actor_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
INSERT INTO counseling_schedules_next SELECT * FROM counseling_schedules;

CREATE TABLE session_goal_scores_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  session_id      TEXT NOT NULL REFERENCES sessions_next (id),
  goal_id         TEXT NOT NULL REFERENCES goals_next (id),
  score           INTEGER NOT NULL CHECK (score BETWEEN -2 AND 2),
  evidence_quote  TEXT,
  scored_by       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (session_id, goal_id)
);
INSERT INTO session_goal_scores_next SELECT * FROM session_goal_scores;

CREATE TABLE ai_gas_evidence_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions_next (id),
  goal_id    TEXT NOT NULL REFERENCES goals_next (id),
  quote      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO ai_gas_evidence_next SELECT * FROM ai_gas_evidence;

CREATE TABLE action_items_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT REFERENCES sessions_next (id),
  description     TEXT NOT NULL,
  owner           TEXT NOT NULL CHECK (owner IN ('counselor', 'beneficiary', 'org')),
  due_date        TEXT,
  resolved_at     TEXT,
  resolved_by     TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO action_items_next (
  id, org_id, support_case_id, session_id, description, owner, due_date,
  resolved_at, resolved_by, created_at
)
SELECT
  item.id, item.org_id, support_case.id, item.session_id, item.description,
  item.owner, item.due_date, item.resolved_at, item.resolved_by, item.created_at
FROM action_items AS item
JOIN support_cases AS support_case ON support_case.legacy_case_id = item.case_id;

CREATE TABLE flags_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT REFERENCES sessions_next (id),
  flag_type       TEXT NOT NULL CHECK (flag_type IN (
                    'crisis_utterance', 'contact_loss_risk',
                    'housing_livelihood_shock', 'debt_deterioration',
                    'repeated_noncompliance')),
  quote           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('ai', 'counselor')),
  review_status   TEXT NOT NULL CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  CHECK (source = 'counselor' OR quote IS NOT NULL)
);
INSERT INTO flags_next (
  id, org_id, support_case_id, session_id, flag_type, quote, source,
  review_status, reviewed_by, reviewed_at, created_at
)
SELECT
  flag.id, flag.org_id, support_case.id, flag.session_id, flag.flag_type,
  flag.quote, flag.source, flag.review_status, flag.reviewed_by, flag.reviewed_at,
  flag.created_at
FROM flags AS flag
JOIN support_cases AS support_case ON support_case.legacy_case_id = flag.case_id;

CREATE TABLE pilot_text_ai_consent_evidence_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  notice_version  TEXT NOT NULL CHECK (length(trim(notice_version)) > 0),
  notice_sha256   TEXT NOT NULL CHECK (length(trim(notice_sha256)) > 0),
  evidence_ref    TEXT NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  evidence_sha256 TEXT NOT NULL CHECK (length(trim(evidence_sha256)) > 0),
  captured_by     TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
INSERT INTO pilot_text_ai_consent_evidence_next (
  id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
  evidence_sha256, captured_by, effective_at, created_at
)
SELECT
  evidence.id, evidence.org_id, support_case.id, evidence.notice_version,
  evidence.notice_sha256, evidence.evidence_ref, evidence.evidence_sha256,
  evidence.captured_by, evidence.effective_at, evidence.created_at
FROM pilot_text_ai_consent_evidence AS evidence
JOIN support_cases AS support_case ON support_case.legacy_case_id = evidence.case_id;

CREATE TABLE ai_masked_source_snapshots_next (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  support_case_id          TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id               TEXT NOT NULL REFERENCES sessions_next (id),
  masked_text              TEXT NOT NULL CHECK (length(masked_text) > 0),
  sha256                   TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  masking_pipeline_version TEXT NOT NULL CHECK (length(trim(masking_pipeline_version)) > 0),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
INSERT INTO ai_masked_source_snapshots_next (
  id, org_id, support_case_id, session_id, masked_text, sha256,
  masking_pipeline_version, created_by, created_at
)
SELECT
  snapshot.id, snapshot.org_id, support_case.id, snapshot.session_id,
  snapshot.masked_text, snapshot.sha256, snapshot.masking_pipeline_version,
  snapshot.created_by, snapshot.created_at
FROM ai_masked_source_snapshots AS snapshot
JOIN support_cases AS support_case ON support_case.legacy_case_id = snapshot.case_id;

CREATE TABLE ai_masked_source_evidence_items_next (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES ai_masked_source_snapshots_next (id),
  org_id         TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id     TEXT NOT NULL REFERENCES sessions_next (id),
  source_ref     TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_sha256  TEXT NOT NULL CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_quote TEXT NOT NULL CHECK (length(evidence_quote) > 0),
  source_start   INTEGER NOT NULL CHECK (source_start >= 0),
  source_end     INTEGER NOT NULL CHECK (source_end > source_start),
  created_at     TEXT NOT NULL,
  UNIQUE (snapshot_id, source_ref, source_start, source_end)
);
INSERT INTO ai_masked_source_evidence_items_next (
  id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
  evidence_quote, source_start, source_end, created_at
)
SELECT
  item.id, item.snapshot_id, item.org_id, support_case.id, item.session_id,
  item.source_ref, item.source_sha256, item.evidence_quote, item.source_start,
  item.source_end, item.created_at
FROM ai_masked_source_evidence_items AS item
JOIN support_cases AS support_case ON support_case.legacy_case_id = item.case_id;

CREATE TABLE ai_work_items_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases_next (id),
  session_id      TEXT NOT NULL REFERENCES sessions_next (id),
  kind            TEXT NOT NULL CHECK (kind = 'text_ai_briefing'),
  created_at      TEXT NOT NULL,
  UNIQUE (session_id, kind)
);
INSERT INTO ai_work_items_next (
  id, org_id, support_case_id, session_id, kind, created_at
)
SELECT
  work.id, work.org_id, support_case.id, work.session_id, work.kind, work.created_at
FROM ai_work_items AS work
JOIN support_cases AS support_case ON support_case.legacy_case_id = work.case_id;

CREATE TABLE ai_draft_versions_next (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items_next (id),
  version              INTEGER NOT NULL CHECK (version > 0),
  parent_version_id    TEXT REFERENCES ai_draft_versions_next (id),
  summary_text         TEXT NOT NULL,
  questions_json       TEXT NOT NULL CHECK (json_valid(questions_json) AND json_type(questions_json) = 'array'),
  source_snapshot_id   TEXT REFERENCES ai_masked_source_snapshots_next (id),
  source_snapshot_hash TEXT,
  consent_evidence_id  TEXT REFERENCES pilot_text_ai_consent_evidence_next (id),
  provider_config_id   TEXT REFERENCES ai_provider_configs (id),
  model_id             TEXT,
  prompt_version       TEXT,
  schema_version       TEXT,
  origin               TEXT NOT NULL CHECK (origin IN ('generated', 'legacy_import')),
  creation_mode        TEXT NOT NULL CHECK (creation_mode IN ('provider_generated', 'human_edited', 'legacy_import')),
  grounding_status     TEXT NOT NULL CHECK (grounding_status IN ('grounded', 'legacy_unverified')),
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (work_item_id, version),
  CHECK (
    (origin = 'generated' AND creation_mode IN ('provider_generated', 'human_edited')
      AND grounding_status = 'grounded' AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL AND model_id IS NOT NULL
      AND prompt_version IS NOT NULL AND schema_version IS NOT NULL
      AND created_by IS NOT NULL AND json_array_length(questions_json) BETWEEN 2 AND 3)
    OR
    (origin = 'legacy_import' AND creation_mode = 'legacy_import'
      AND grounding_status = 'legacy_unverified' AND source_snapshot_id IS NULL
      AND source_snapshot_hash IS NULL AND consent_evidence_id IS NULL
      AND provider_config_id IS NULL AND model_id IS NULL AND prompt_version IS NULL
      AND schema_version IS NULL AND created_by IS NULL
      AND json_array_length(questions_json) = 0)
  )
);
WITH RECURSIVE draft_order(id, depth) AS (
  SELECT id, 0 FROM ai_draft_versions WHERE parent_version_id IS NULL
  UNION ALL
  SELECT child.id, parent.depth + 1
  FROM ai_draft_versions AS child
  JOIN draft_order AS parent ON parent.id = child.parent_version_id
)
INSERT INTO ai_draft_versions_next
SELECT draft.*
FROM ai_draft_versions AS draft
JOIN draft_order AS ordered ON ordered.id = draft.id
ORDER BY ordered.depth;

CREATE TABLE ai_evidence_links_next (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES ai_draft_versions_next (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items_next (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL,
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);
INSERT INTO ai_evidence_links_next SELECT * FROM ai_evidence_links;

CREATE TABLE ai_review_events_next (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items_next (id),
  draft_version_id     TEXT NOT NULL REFERENCES ai_draft_versions_next (id),
  decision             TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES ai_draft_versions_next (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL,
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);
INSERT INTO ai_review_events_next SELECT * FROM ai_review_events;

CREATE TABLE audit_log_next (
  id                INTEGER PRIMARY KEY,
  org_id            TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  actor_role        TEXT NOT NULL CHECK (actor_role IN ('admin', 'counselor', 'service')),
  action            TEXT NOT NULL,
  target_table      TEXT NOT NULL,
  target_id         TEXT,
  beneficiary_id    TEXT REFERENCES beneficiaries (id),
  support_case_id   TEXT REFERENCES support_cases_next (id),
  case_id           TEXT,
  detail            TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO audit_log_next (
  id, org_id, actor_id, actor_role, action, target_table, target_id,
  beneficiary_id, support_case_id, case_id, detail, created_at
)
SELECT
  audit.id, audit.org_id, audit.actor_id, audit.actor_role, audit.action,
  audit.target_table, audit.target_id,
  COALESCE(audit.beneficiary_id, support_case.beneficiary_id),
  COALESCE(audit.support_case_id, support_case.id), audit.case_id,
  audit.detail, audit.created_at
FROM audit_log AS audit
LEFT JOIN support_cases AS support_case
  ON support_case.legacy_case_id = audit.case_id;

-- Every rebuilt table is reconciled bidirectionally before the legacy graph is
-- dropped. Mapped legacy owners use scalar lookups so an orphan source row
-- remains in the expected set instead of disappearing through an inner join.
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'participant_graph_rows_and_keys', 0
WHERE EXISTS (
  SELECT * FROM support_cases
  EXCEPT
  SELECT * FROM support_cases_next
)
OR EXISTS (
  SELECT * FROM support_cases_next
  EXCEPT
  SELECT * FROM support_cases
)
OR EXISTS (
  SELECT * FROM participant_pii_vault
  EXCEPT
  SELECT * FROM participant_pii_vault_next
)
OR EXISTS (
  SELECT * FROM participant_pii_vault_next
  EXCEPT
  SELECT * FROM participant_pii_vault
)
OR EXISTS (
  SELECT * FROM support_case_assignees
  EXCEPT
  SELECT * FROM support_case_assignees_next
)
OR EXISTS (
  SELECT * FROM support_case_assignees_next
  EXCEPT
  SELECT * FROM support_case_assignees
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.title, source.scale_criteria, source.status, source.closed_reason,
         source.closed_at, source.replaced_by_goal_id, source.created_at
  FROM goals AS source
  EXCEPT
  SELECT id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
         closed_at, replaced_by_goal_id, created_at
  FROM goals_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, title, scale_criteria, status, closed_reason,
         closed_at, replaced_by_goal_id, created_at
  FROM goals_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.title, source.scale_criteria, source.status, source.closed_reason,
         source.closed_at, source.replaced_by_goal_id, source.created_at
  FROM goals AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.counselor_id, source.held_at, source.channel, source.memo,
         NULL, NULL, NULL, source.ai_status, source.transcript, source.audio_r2_key,
         source.ai_summary, source.ai_schema, source.ai_contrast, source.emotion_scores,
         source.speaker_mapping_confirmed_at, source.approved_at, source.approved_by,
         source.extra, source.created_at, source.updated_at
  FROM sessions AS source
  EXCEPT
  SELECT id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, transcript,
         audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
         speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
  FROM sessions_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, transcript,
         audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
         speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
  FROM sessions_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.counselor_id, source.held_at, source.channel, source.memo,
         NULL, NULL, NULL, source.ai_status, source.transcript, source.audio_r2_key,
         source.ai_summary, source.ai_schema, source.ai_contrast, source.emotion_scores,
         source.speaker_mapping_confirmed_at, source.approved_at, source.approved_by,
         source.extra, source.created_at, source.updated_at
  FROM sessions AS source
)
OR EXISTS (
  SELECT * FROM counseling_schedules
  EXCEPT
  SELECT * FROM counseling_schedules_next
)
OR EXISTS (
  SELECT * FROM counseling_schedules_next
  EXCEPT
  SELECT * FROM counseling_schedules
)
OR EXISTS (
  SELECT * FROM session_goal_scores
  EXCEPT
  SELECT * FROM session_goal_scores_next
)
OR EXISTS (
  SELECT * FROM session_goal_scores_next
  EXCEPT
  SELECT * FROM session_goal_scores
)
OR EXISTS (
  SELECT * FROM ai_gas_evidence
  EXCEPT
  SELECT * FROM ai_gas_evidence_next
)
OR EXISTS (
  SELECT * FROM ai_gas_evidence_next
  EXCEPT
  SELECT * FROM ai_gas_evidence
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.description, source.owner, source.due_date,
         source.resolved_at, source.resolved_by, source.created_at
  FROM action_items AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, description, owner, due_date,
         resolved_at, resolved_by, created_at
  FROM action_items_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, description, owner, due_date,
         resolved_at, resolved_by, created_at
  FROM action_items_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.description, source.owner, source.due_date,
         source.resolved_at, source.resolved_by, source.created_at
  FROM action_items AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.flag_type, source.quote, source.source,
         source.review_status, source.reviewed_by, source.reviewed_at, source.created_at
  FROM flags AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, flag_type, quote, source,
         review_status, reviewed_by, reviewed_at, created_at
  FROM flags_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, flag_type, quote, source,
         review_status, reviewed_by, reviewed_at, created_at
  FROM flags_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.flag_type, source.quote, source.source,
         source.review_status, source.reviewed_by, source.reviewed_at, source.created_at
  FROM flags AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.notice_version, source.notice_sha256, source.evidence_ref,
         source.evidence_sha256, source.captured_by, source.effective_at, source.created_at
  FROM pilot_text_ai_consent_evidence AS source
  EXCEPT
  SELECT id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
         evidence_sha256, captured_by, effective_at, created_at
  FROM pilot_text_ai_consent_evidence_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
         evidence_sha256, captured_by, effective_at, created_at
  FROM pilot_text_ai_consent_evidence_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.notice_version, source.notice_sha256, source.evidence_ref,
         source.evidence_sha256, source.captured_by, source.effective_at, source.created_at
  FROM pilot_text_ai_consent_evidence AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.masked_text, source.sha256,
         source.masking_pipeline_version, source.created_by, source.created_at
  FROM ai_masked_source_snapshots AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, masked_text, sha256,
         masking_pipeline_version, created_by, created_at
  FROM ai_masked_source_snapshots_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, masked_text, sha256,
         masking_pipeline_version, created_by, created_at
  FROM ai_masked_source_snapshots_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.masked_text, source.sha256,
         source.masking_pipeline_version, source.created_by, source.created_at
  FROM ai_masked_source_snapshots AS source
)
OR EXISTS (
  SELECT source.id, source.snapshot_id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.source_ref, source.source_sha256, source.evidence_quote,
         source.source_start, source.source_end, source.created_at
  FROM ai_masked_source_evidence_items AS source
  EXCEPT
  SELECT id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
         evidence_quote, source_start, source_end, created_at
  FROM ai_masked_source_evidence_items_next
)
OR EXISTS (
  SELECT id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256,
         evidence_quote, source_start, source_end, created_at
  FROM ai_masked_source_evidence_items_next
  EXCEPT
  SELECT source.id, source.snapshot_id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.source_ref, source.source_sha256, source.evidence_quote,
         source.source_start, source.source_end, source.created_at
  FROM ai_masked_source_evidence_items AS source
)
OR EXISTS (
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.kind, source.created_at
  FROM ai_work_items AS source
  EXCEPT
  SELECT id, org_id, support_case_id, session_id, kind, created_at
  FROM ai_work_items_next
)
OR EXISTS (
  SELECT id, org_id, support_case_id, session_id, kind, created_at
  FROM ai_work_items_next
  EXCEPT
  SELECT source.id, source.org_id,
         (SELECT support_case.id FROM support_cases_next AS support_case
          WHERE support_case.legacy_case_id = source.case_id),
         source.session_id, source.kind, source.created_at
  FROM ai_work_items AS source
)
OR EXISTS (
  SELECT * FROM ai_draft_versions
  EXCEPT
  SELECT * FROM ai_draft_versions_next
)
OR EXISTS (
  SELECT * FROM ai_draft_versions_next
  EXCEPT
  SELECT * FROM ai_draft_versions
)
OR EXISTS (
  SELECT * FROM ai_evidence_links
  EXCEPT
  SELECT * FROM ai_evidence_links_next
)
OR EXISTS (
  SELECT * FROM ai_evidence_links_next
  EXCEPT
  SELECT * FROM ai_evidence_links
)
OR EXISTS (
  SELECT * FROM ai_review_events
  EXCEPT
  SELECT * FROM ai_review_events_next
)
OR EXISTS (
  SELECT * FROM ai_review_events_next
  EXCEPT
  SELECT * FROM ai_review_events
)
OR EXISTS (
  SELECT source.id, source.org_id, source.actor_id, source.actor_role, source.action,
         source.target_table, source.target_id,
         COALESCE(source.beneficiary_id, (
           SELECT support_case.beneficiary_id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         COALESCE(source.support_case_id, (
           SELECT support_case.id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         source.case_id, source.detail, source.created_at
  FROM audit_log AS source
  EXCEPT
  SELECT id, org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
  FROM audit_log_next
)
OR EXISTS (
  SELECT id, org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
  FROM audit_log_next
  EXCEPT
  SELECT source.id, source.org_id, source.actor_id, source.actor_role, source.action,
         source.target_table, source.target_id,
         COALESCE(source.beneficiary_id, (
           SELECT support_case.beneficiary_id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         COALESCE(source.support_case_id, (
           SELECT support_case.id FROM support_cases_next AS support_case
           WHERE support_case.legacy_case_id = source.case_id
         )),
         source.case_id, source.detail, source.created_at
  FROM audit_log AS source
)
OR EXISTS (
  SELECT 1
  FROM audit_log AS source
  WHERE source.case_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM support_cases_next AS support_case
      WHERE support_case.legacy_case_id = source.case_id
    )
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'goals_scope', 0
WHERE EXISTS (
  SELECT 1 FROM goals_next AS goal
  JOIN support_cases_next AS support_case ON support_case.id = goal.support_case_id
  WHERE goal.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'sessions_scope', 0
WHERE EXISTS (
  SELECT 1 FROM sessions_next AS session
  JOIN support_cases_next AS support_case ON support_case.id = session.support_case_id
  WHERE session.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'session_goal_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM session_goal_scores_next AS score
  JOIN sessions_next AS session ON session.id = score.session_id
  JOIN goals_next AS goal ON goal.id = score.goal_id
  WHERE score.org_id <> session.org_id
     OR score.org_id <> goal.org_id
     OR session.support_case_id <> goal.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_snapshot_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_masked_source_snapshots_next AS snapshot
  JOIN sessions_next AS session ON session.id = snapshot.session_id
  WHERE snapshot.org_id <> session.org_id
     OR snapshot.support_case_id <> session.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_work_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_work_items_next AS work
  JOIN sessions_next AS session ON session.id = work.session_id
  WHERE work.org_id <> session.org_id
     OR work.support_case_id <> session.support_case_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'audit_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM audit_log_next AS audit
  JOIN support_cases_next AS support_case ON support_case.id = audit.support_case_id
  WHERE audit.org_id <> support_case.org_id
     OR audit.beneficiary_id IS NOT support_case.beneficiary_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'assignment_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM support_case_assignees_next AS assignment
  JOIN support_cases_next AS support_case ON support_case.id = assignment.support_case_id
  WHERE assignment.org_id <> support_case.org_id
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'one_active_primary_assignment', 0
WHERE EXISTS (
  SELECT 1
  FROM support_cases_next AS support_case
  LEFT JOIN support_case_assignees_next AS assignment
    ON assignment.support_case_id = support_case.id
   AND assignment.role = 'primary'
   AND assignment.unassigned_at IS NULL
  GROUP BY support_case.id
  HAVING COUNT(assignment.id) <> 1
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'schedule_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM counseling_schedules_next AS schedule
  JOIN support_cases_next AS support_case ON support_case.id = schedule.support_case_id
  LEFT JOIN sessions_next AS session ON session.id = schedule.completed_session_id
  WHERE schedule.org_id <> support_case.org_id
     OR schedule.beneficiary_id <> support_case.beneficiary_id
     OR (schedule.completed_session_id IS NOT NULL
         AND (session.org_id <> schedule.org_id
              OR session.support_case_id <> schedule.support_case_id))
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'record_child_scope', 0
WHERE EXISTS (
  SELECT 1
  FROM action_items_next AS item
  JOIN sessions_next AS session ON session.id = item.session_id
  WHERE item.session_id IS NOT NULL
    AND (item.org_id <> session.org_id
         OR item.support_case_id <> session.support_case_id)
)
OR EXISTS (
  SELECT 1
  FROM flags_next AS flag
  JOIN sessions_next AS session ON session.id = flag.session_id
  WHERE flag.session_id IS NOT NULL
    AND (flag.org_id <> session.org_id
         OR flag.support_case_id <> session.support_case_id)
)
OR EXISTS (
  SELECT 1
  FROM ai_masked_source_evidence_items_next AS item
  JOIN ai_masked_source_snapshots_next AS snapshot ON snapshot.id = item.snapshot_id
  WHERE item.org_id <> snapshot.org_id
     OR item.support_case_id <> snapshot.support_case_id
     OR item.session_id <> snapshot.session_id
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'support_case_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM support_cases AS source
  JOIN support_cases_next AS target ON target.id = source.id
  WHERE target.creation_payload_hash IS NOT source.creation_payload_hash
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_snapshot_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_masked_source_snapshots AS source
  JOIN ai_masked_source_snapshots_next AS target ON target.id = source.id
  WHERE target.sha256 IS NOT source.sha256
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'ai_draft_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM ai_draft_versions AS source
  JOIN ai_draft_versions_next AS target ON target.id = source.id
  WHERE target.source_snapshot_hash IS NOT source.source_snapshot_hash
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'manual_submission_hash_copy', 0
WHERE EXISTS (
  SELECT 1
  FROM sessions_next
  WHERE submission_id IS NOT NULL OR submission_hash IS NOT NULL OR submitted_by IS NOT NULL
);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_support_cases_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('support_cases_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_participant_pii_vault_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('participant_pii_vault_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_sessions_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('sessions_next'));
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'fk_ai_review_events_next', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check('ai_review_events_next'));

-- Views and triggers referencing the legacy graph must be removed before the
-- old DAG is dismantled. Provider registry objects remain untouched.
DROP VIEW approved_ai_briefing_v1;
DROP VIEW grounded_ai_quality_v1;
DROP TRIGGER beneficiaries_complete_guard;
DROP TRIGGER beneficiaries_insert_pending_guard;
DROP TRIGGER sessions_approved_ai_compatibility_immutable;
DROP TRIGGER ai_draft_versions_legacy_import_cutover_guard;
DROP TRIGGER sessions_direct_ai_approval_update_guard;
DROP TRIGGER sessions_direct_ai_approval_insert_guard;
DROP TRIGGER audit_log_participant_provenance_guard;
DROP TRIGGER participant_pii_vault_purge_audit;
DROP TRIGGER participant_pii_vault_cancel_audit;
DROP TRIGGER participant_pii_vault_schedule_audit;
DROP TRIGGER support_cases_cancel_pii_purge_due;
DROP TRIGGER support_cases_schedule_pii_purge_due;
DROP TRIGGER participant_pii_vault_no_revive_guard;
DROP TRIGGER participant_pii_vault_retention_guard;
DROP TRIGGER participant_pii_vault_insert_guard;
DROP TRIGGER counseling_schedules_update_guard;
DROP TRIGGER counseling_schedules_insert_guard;
DROP TRIGGER support_case_assignees_unassign_guard;
DROP TRIGGER support_case_assignees_insert_guard;
DROP TRIGGER support_cases_close_guard;
DROP TRIGGER support_cases_immutable_identity_guard;
DROP TRIGGER support_cases_insert_guard;
DROP TRIGGER goals_title_immutable;
DROP TRIGGER pilot_text_ai_consent_evidence_no_update;
DROP TRIGGER pilot_text_ai_consent_evidence_no_delete;
DROP TRIGGER ai_masked_source_snapshots_scope_guard;
DROP TRIGGER ai_masked_source_snapshots_no_update;
DROP TRIGGER ai_masked_source_snapshots_no_delete;
DROP TRIGGER ai_masked_source_evidence_items_insert_guard;
DROP TRIGGER ai_masked_source_evidence_items_no_update;
DROP TRIGGER ai_masked_source_evidence_items_no_delete;
DROP TRIGGER ai_work_items_scope_guard;
DROP TRIGGER ai_work_items_no_update;
DROP TRIGGER ai_work_items_no_delete;
DROP TRIGGER ai_draft_versions_insert_guard;
DROP TRIGGER ai_draft_versions_no_update;
DROP TRIGGER ai_draft_versions_no_delete;
DROP TRIGGER ai_evidence_links_insert_guard;
DROP TRIGGER ai_evidence_links_no_update;
DROP TRIGGER ai_evidence_links_no_delete;
DROP TRIGGER ai_review_events_insert_guard;
DROP TRIGGER ai_review_events_no_update;
DROP TRIGGER ai_review_events_no_delete;
DROP TRIGGER audit_log_no_update;
DROP TRIGGER audit_log_no_delete;

-- Drop the legacy DAG child-first, then publish the private graph parent-first.
DROP TABLE ai_review_events;
DROP TABLE ai_evidence_links;
DROP TABLE ai_draft_versions;
DROP TABLE ai_work_items;
DROP TABLE ai_masked_source_evidence_items;
DROP TABLE ai_masked_source_snapshots;
DROP TABLE pilot_text_ai_consent_evidence;
DROP TABLE session_goal_scores;
DROP TABLE ai_gas_evidence;
DROP TABLE action_items;
DROP TABLE flags;
DROP TABLE sessions;
DROP TABLE goals;
DROP TABLE counseling_schedules;
DROP TABLE support_case_assignees;
DROP TABLE participant_pii_vault;
DROP TABLE audit_log;
DROP TABLE case_assignees;
DROP TABLE pii_vault;
DROP TABLE cases;
DROP TABLE support_cases;

ALTER TABLE support_cases_next RENAME TO support_cases;
ALTER TABLE participant_pii_vault_next RENAME TO participant_pii_vault;
ALTER TABLE support_case_assignees_next RENAME TO support_case_assignees;
ALTER TABLE goals_next RENAME TO goals;
ALTER TABLE sessions_next RENAME TO sessions;
ALTER TABLE counseling_schedules_next RENAME TO counseling_schedules;
ALTER TABLE session_goal_scores_next RENAME TO session_goal_scores;
ALTER TABLE ai_gas_evidence_next RENAME TO ai_gas_evidence;
ALTER TABLE action_items_next RENAME TO action_items;
ALTER TABLE flags_next RENAME TO flags;
ALTER TABLE pilot_text_ai_consent_evidence_next RENAME TO pilot_text_ai_consent_evidence;
ALTER TABLE ai_masked_source_snapshots_next RENAME TO ai_masked_source_snapshots;
ALTER TABLE ai_masked_source_evidence_items_next RENAME TO ai_masked_source_evidence_items;
ALTER TABLE ai_work_items_next RENAME TO ai_work_items;
ALTER TABLE ai_draft_versions_next RENAME TO ai_draft_versions;
ALTER TABLE ai_evidence_links_next RENAME TO ai_evidence_links;
ALTER TABLE ai_review_events_next RENAME TO ai_review_events;
ALTER TABLE audit_log_next RENAME TO audit_log;
-- Legacy case IDs remain read-compatible for Phase-1 exports. New writes must
-- use the canonical participant/SupportCase gateway and fail closed here.
CREATE VIEW cases AS
SELECT
  support_case.legacy_case_id AS id,
  support_case.org_id,
  support_case.program_type,
  support_case.status,
  support_case.intake_at,
  support_case.consent_recording_at,
  support_case.consent_text_ai_at,
  support_case.closed_at,
  support_case.closed_reason,
  vault.purge_due,
  support_case.extra,
  support_case.created_at,
  support_case.updated_at
FROM support_cases AS support_case
LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id = support_case.beneficiary_id
 AND vault.org_id = support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL;

CREATE TRIGGER cases_legacy_insert_unsupported
INSTEAD OF INSERT ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_update_unsupported
INSTEAD OF UPDATE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_delete_unsupported
INSTEAD OF DELETE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE VIEW case_assignees AS
SELECT
  assignment.id,
  assignment.org_id,
  support_case.legacy_case_id AS case_id,
  assignment.user_id,
  assignment.role,
  assignment.assigned_at,
  assignment.unassigned_at
FROM support_case_assignees AS assignment
JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
WHERE support_case.legacy_case_id IS NOT NULL;

CREATE TRIGGER case_assignees_legacy_insert_unsupported
INSTEAD OF INSERT ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_update_unsupported
INSTEAD OF UPDATE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_delete_unsupported
INSTEAD OF DELETE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;


-- Canonical indexes and ownership-scope guards.
CREATE UNIQUE INDEX uq_support_cases_one_initial_per_beneficiary
  ON support_cases (beneficiary_id) WHERE creation_kind = 'initial';
CREATE UNIQUE INDEX uq_support_cases_actor_submission
  ON support_cases (org_id, created_by_actor_id, creation_submission_id)
  WHERE creation_submission_id IS NOT NULL;
CREATE INDEX idx_support_cases_beneficiary_status
  ON support_cases (beneficiary_id, status, created_at DESC);
CREATE INDEX idx_participant_pii_vault_due
  ON participant_pii_vault (purge_due) WHERE purged_at IS NULL AND purge_due IS NOT NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_active
  ON support_case_assignees (support_case_id, user_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_primary
  ON support_case_assignees (support_case_id) WHERE role = 'primary' AND unassigned_at IS NULL;
CREATE INDEX idx_support_case_assignees_user
  ON support_case_assignees (user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_counseling_schedules_support_case
  ON counseling_schedules (support_case_id, status, scheduled_at);
CREATE INDEX idx_goals_support_case ON goals (support_case_id, status);
CREATE INDEX idx_sessions_support_case ON sessions (support_case_id, held_at DESC);
CREATE INDEX idx_sessions_pending ON sessions (support_case_id) WHERE ai_status = 'review_ready';
CREATE UNIQUE INDEX uq_sessions_manual_submission
  ON sessions (org_id, support_case_id, submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX idx_scores_goal ON session_goal_scores (goal_id);
CREATE INDEX idx_gas_evidence_session ON ai_gas_evidence (session_id);
CREATE INDEX idx_actions_open ON action_items (support_case_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_flags_support_case ON flags (support_case_id, review_status);
CREATE INDEX idx_pilot_text_ai_consent_support_case
  ON pilot_text_ai_consent_evidence (org_id, support_case_id, effective_at DESC);
CREATE INDEX idx_ai_masked_source_snapshots_scope
  ON ai_masked_source_snapshots (org_id, support_case_id, session_id, created_at DESC);
CREATE INDEX idx_ai_masked_source_evidence_items_scope
  ON ai_masked_source_evidence_items (org_id, support_case_id, session_id, snapshot_id, source_start);
CREATE INDEX idx_ai_work_items_org_support_case
  ON ai_work_items (org_id, support_case_id, created_at DESC);
CREATE INDEX idx_ai_work_items_session ON ai_work_items (session_id, kind);
CREATE INDEX idx_ai_draft_versions_work ON ai_draft_versions (work_item_id, version DESC);
CREATE INDEX idx_ai_draft_versions_source_snapshot
  ON ai_draft_versions (source_snapshot_id) WHERE source_snapshot_id IS NOT NULL;
CREATE INDEX idx_ai_draft_versions_provider_config
  ON ai_draft_versions (provider_config_id) WHERE provider_config_id IS NOT NULL;
CREATE INDEX idx_ai_evidence_links_draft ON ai_evidence_links (draft_version_id, claim_key);
CREATE INDEX idx_ai_review_events_work ON ai_review_events (work_item_id, created_at DESC);
CREATE UNIQUE INDEX uq_ai_review_events_terminal_draft ON ai_review_events (draft_version_id);
CREATE UNIQUE INDEX uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id) WHERE decision = 'approved';
CREATE INDEX idx_audit_beneficiary ON audit_log (beneficiary_id, created_at);
CREATE INDEX idx_audit_support_case ON audit_log (support_case_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);

CREATE TRIGGER goals_title_immutable
BEFORE UPDATE OF title ON goals
BEGIN
  SELECT RAISE(ABORT, 'D12: goal title is immutable — close and create a new goal');
END;

CREATE TRIGGER session_goal_scores_scope_guard
BEFORE INSERT ON session_goal_scores
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions AS session
    JOIN goals AS goal ON goal.id = NEW.goal_id
    WHERE session.id = NEW.session_id
      AND session.org_id = NEW.org_id
      AND goal.org_id = NEW.org_id
      AND session.support_case_id = goal.support_case_id
  );
END;

CREATE TRIGGER ai_gas_evidence_scope_guard
BEFORE INSERT ON ai_gas_evidence
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions AS session
    JOIN goals AS goal ON goal.id = NEW.goal_id
    WHERE session.id = NEW.session_id
      AND session.org_id = NEW.org_id
      AND goal.org_id = NEW.org_id
      AND session.support_case_id = goal.support_case_id
  );
END;

CREATE TRIGGER action_items_session_scope_guard
BEFORE INSERT ON action_items
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;

CREATE TRIGGER flags_session_scope_guard
BEFORE INSERT ON flags
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;

CREATE TRIGGER sessions_manual_submission_guard
BEFORE INSERT ON sessions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.submission_id IS NULL OR NEW.submission_hash IS NULL OR NEW.submitted_by IS NULL
     OR NEW.counselor_id <> NEW.submitted_by;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases AS support_case
    JOIN beneficiaries AS beneficiary ON beneficiary.id = support_case.beneficiary_id
    WHERE support_case.id = NEW.support_case_id
      AND support_case.org_id = NEW.org_id
      AND support_case.status = 'active'
      AND beneficiary.initialization_state = 'complete'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.submitted_by
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.submitted_by AND role = 'admin'
  )
    AND NOT EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id
        AND user_id = NEW.submitted_by
        AND unassigned_at IS NULL
    );
END;

CREATE TRIGGER sessions_manual_submission_audit
AFTER INSERT ON sessions
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT session.org_id, session.submitted_by, users.role,
         'submit_manual_record', 'sessions', session.id,
         support_case.beneficiary_id, session.support_case_id, NULL, datetime('now')
  FROM sessions AS session
  JOIN support_cases AS support_case ON support_case.id = session.support_case_id
  JOIN users ON users.id = session.submitted_by
  WHERE session.id = NEW.id;
END;

CREATE TRIGGER beneficiaries_insert_pending_guard
BEFORE INSERT ON beneficiaries
WHEN NEW.initialization_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;
CREATE TRIGGER support_cases_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'legacy_import';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM beneficiaries
                    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'initial' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'pending'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'complete'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.initial_assignee_user_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND (NEW.source_support_case_id IS NULL OR NEW.initial_assignee_user_id <> NEW.created_by_actor_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'admin'
    AND NEW.source_support_case_id IS NOT NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases AS source_case
    WHERE source_case.id = NEW.source_support_case_id AND source_case.org_id = NEW.org_id
      AND source_case.beneficiary_id = NEW.beneficiary_id
      AND source_case.status = 'active'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND NOT EXISTS (
      SELECT 1
      FROM support_cases AS source_case
      JOIN support_case_assignees AS assignment
        ON assignment.support_case_id = source_case.id
       AND assignment.org_id = source_case.org_id
      WHERE source_case.id = NEW.source_support_case_id
        AND source_case.org_id = NEW.org_id
        AND source_case.beneficiary_id = NEW.beneficiary_id
        AND source_case.status = 'active'
        AND assignment.user_id = NEW.created_by_actor_id
        AND assignment.unassigned_at IS NULL
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NEW.status <> 'active';
END;

CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id, org_id, beneficiary_id, legacy_case_id, creation_kind,
                 creation_submission_id, creation_payload_hash, created_by_actor_id,
                 source_support_case_id, initial_assignee_user_id ON support_cases
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed' OR NEW.closed_at IS NULL
     OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.closed_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER support_case_assignees_insert_guard
BEFORE INSERT ON support_case_assignees
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.support_case_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM users
                    WHERE id = NEW.user_id AND org_id = NEW.org_id
                      AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (SELECT 1 FROM support_cases
                WHERE id = NEW.support_case_id AND creation_kind = 'subsequent')
    AND NOT EXISTS (SELECT 1 FROM support_case_assignees
                    WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL)
    AND (NEW.role <> 'primary' OR NEW.user_id <> (
      SELECT initial_assignee_user_id FROM support_cases WHERE id = NEW.support_case_id
    ));
END;

CREATE TRIGGER support_case_assignees_unassign_guard
BEFORE UPDATE OF id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
ON support_case_assignees
WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.role IS NOT OLD.role OR NEW.assigned_at IS NOT OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL OR NEW.unassigned_at IS NULL
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER counseling_schedules_insert_guard
BEFORE INSERT ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM users
                    WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
                      AND active = 1 AND role IN ('admin', 'counselor'));
END;

CREATE TRIGGER counseling_schedules_update_guard
BEFORE UPDATE ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
     OR NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.support_case_id IS NOT OLD.support_case_id
     OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
     OR NEW.version <> OLD.version + 1;
END;

CREATE TRIGGER participant_pii_vault_insert_guard
BEFORE INSERT ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM beneficiaries
                    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind <> 'create';
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL AND NEW.purge_due IS NOT NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NULL AND OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL
    AND NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
    AND NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii' AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL AND NEW.enc_phone IS NOT NULL AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role = 'admin');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id AND status = 'active');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT datetime(
      (SELECT closed_at FROM support_cases
       WHERE id = NEW.retention_context_support_case_id),
      '+' || (SELECT pii_purge_grace_days
              FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    (NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1 FROM users WHERE id = NEW.purged_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    ))
    OR
    (NEW.purged_by_role = 'service' AND NEW.purged_by = 'system:purge')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND EXISTS (
    SELECT 1 FROM support_cases WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND OLD.purge_due > datetime('now');
END;

CREATE TRIGGER participant_pii_vault_no_revive_guard
BEFORE UPDATE ON participant_pii_vault
WHEN OLD.purged_at IS NOT NULL AND NEW.retention_change_kind <> 're_register_pii'
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (SELECT 1 FROM participant_pii_vault
                WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id);
  UPDATE participant_pii_vault
     SET purge_due = datetime(NEW.closed_at, '+' || (
           SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = NEW.org_id
         ) || ' days'),
         version = version + 1, retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL AND purge_due IS NULL
     AND NOT EXISTS (SELECT 1 FROM support_cases
                     WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active');
END;

CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = NULL, version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL AND purge_due IS NOT NULL;
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  VALUES (NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
          NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL, datetime('now'));
END;

CREATE TRIGGER audit_log_participant_provenance_guard
BEFORE INSERT ON audit_log
WHEN NEW.beneficiary_id IS NOT NULL OR NEW.support_case_id IS NOT NULL
  OR NEW.action IN ('purge_pii_noop', 'reveal_participant_pii')
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'purge_pii_noop' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.support_case_id IS NULL
    AND NEW.detail = '{"reason":"not_eligible_or_already_purged"}'
    AND EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND org_id = NEW.org_id
                AND active = 1 AND role = 'admin')
    AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id = NEW.beneficiary_id
                AND (
                  purged_at IS NOT NULL
                  OR purge_due IS NULL
                  OR purge_due > datetime('now')
                  OR EXISTS (
                    SELECT 1 FROM support_cases
                    WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
                  )
                ))
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'reveal_participant_pii' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.detail = '{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id
        AND active = 1 AND role = NEW.actor_role
        AND role IN ('admin', 'counselor')
    )
    AND (
      NEW.actor_role = 'admin'
      OR EXISTS (
        SELECT 1 FROM support_case_assignees
        WHERE support_case_id = NEW.support_case_id AND org_id = NEW.org_id
          AND user_id = NEW.actor_id AND unassigned_at IS NULL
      )
    )
    AND EXISTS (SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
                AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
                AND status = 'active')
  );
END;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;

-- Phase-1 provenance is retained verbatim; only the owner edge is renamed to
-- support_case_id. These triggers continue to prohibit direct or ungrounded AI.
CREATE TRIGGER pilot_text_ai_consent_evidence_no_update
BEFORE UPDATE ON pilot_text_ai_consent_evidence
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;
CREATE TRIGGER pilot_text_ai_consent_evidence_no_delete
BEFORE DELETE ON pilot_text_ai_consent_evidence
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;

CREATE TRIGGER ai_masked_source_snapshots_scope_guard
BEFORE INSERT ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;
CREATE TRIGGER ai_masked_source_snapshots_no_update
BEFORE UPDATE ON ai_masked_source_snapshots
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;
CREATE TRIGGER ai_masked_source_snapshots_no_delete
BEFORE DELETE ON ai_masked_source_snapshots
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;

CREATE TRIGGER ai_masked_source_evidence_items_insert_guard
BEFORE INSERT ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    JOIN sessions ON sessions.id = snapshot.session_id
                 AND sessions.org_id = snapshot.org_id
                 AND sessions.support_case_id = snapshot.support_case_id
    WHERE snapshot.id = NEW.snapshot_id AND snapshot.org_id = NEW.org_id
      AND snapshot.support_case_id = NEW.support_case_id AND snapshot.session_id = NEW.session_id
  );
  SELECT RAISE(ABORT, 'phase1: masked source evidence hash mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM ai_masked_source_snapshots AS snapshot
                    WHERE snapshot.id = NEW.snapshot_id AND snapshot.sha256 = NEW.source_sha256);
  SELECT RAISE(ABORT, 'phase1: masked source evidence span mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id AND NEW.source_end <= length(snapshot.masked_text)
      AND substr(snapshot.masked_text, NEW.source_start + 1,
                 NEW.source_end - NEW.source_start) = NEW.evidence_quote
  );
END;
CREATE TRIGGER ai_masked_source_evidence_items_no_update
BEFORE UPDATE ON ai_masked_source_evidence_items
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;
CREATE TRIGGER ai_masked_source_evidence_items_no_delete
BEFORE DELETE ON ai_masked_source_evidence_items
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;

CREATE TRIGGER ai_work_items_scope_guard
BEFORE INSERT ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work item case or session scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;
CREATE TRIGGER ai_work_items_no_update
BEFORE UPDATE ON ai_work_items
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;
CREATE TRIGGER ai_work_items_no_delete
BEFORE DELETE ON ai_work_items
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;

CREATE TRIGGER ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((SELECT MAX(version) + 1 FROM ai_draft_versions
                                 WHERE work_item_id = NEW.work_item_id), 1);
  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
     OR (NEW.version > 1 AND NOT EXISTS (
       SELECT 1 FROM ai_draft_versions AS parent
       WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
         AND parent.version = NEW.version - 1
     ));
  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (SELECT 1 FROM json_each(NEW.questions_json)
                WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0)
     OR EXISTS (SELECT 1 FROM json_each(NEW.questions_json)
                GROUP BY json_each.value HAVING COUNT(*) > 1);
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM ai_review_events
                WHERE draft_version_id = NEW.parent_version_id);
  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = NEW.source_snapshot_hash
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id = NEW.consent_evidence_id AND evidence.org_id = work.org_id
     AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin = 'generated' AND NEW.consent_evidence_id IS NOT (
    SELECT evidence.id
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.org_id = work.org_id AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
      AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'human_edited' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
      AND parent.origin = 'generated' AND parent.provider_config_id IS NEW.provider_config_id
      AND parent.source_snapshot_id IS NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
      AND parent.questions_json IS NEW.questions_json AND parent.model_id IS NEW.model_id
      AND parent.prompt_version IS NEW.prompt_version AND parent.schema_version IS NEW.schema_version
  );
  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'provider_generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id = config.id
                                                AND activation.org_id = work.org_id
    WHERE work.id = NEW.work_item_id AND activation.deactivated_at IS NULL
  );
END;
CREATE TRIGGER ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only'); END;
CREATE TRIGGER ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
BEGIN SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only'); END;

CREATE TRIGGER ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft
                    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
                      AND draft.grounding_status = 'grounded');
  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = draft.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = draft.source_snapshot_hash
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256 AND item.org_id = work.org_id
     AND item.support_case_id = work.support_case_id AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.draft_version_id)
     OR EXISTS (
       SELECT 1 FROM ai_draft_versions AS newer
       JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
       WHERE newer.work_item_id = draft.work_item_id AND newer.version > draft.version
     );
END;
CREATE TRIGGER ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;
CREATE TRIGGER ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft
                    WHERE draft.id = NEW.draft_version_id AND draft.work_item_id = NEW.work_item_id);
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected') AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS newer
    JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
    WHERE newer.work_item_id = NEW.work_item_id AND newer.version > draft.version
  );
  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS draft
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE draft.id = NEW.draft_version_id AND replacement.work_item_id = draft.work_item_id
      AND replacement.version = draft.version + 1
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS later
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE later.work_item_id = NEW.work_item_id AND later.version > replacement.version
  );
  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.replacement_draft_id);
  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);
  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (SELECT 1 FROM ai_evidence_links WHERE draft_version_id = NEW.draft_version_id);
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (SELECT 1 FROM ai_evidence_links
                    WHERE draft_version_id = NEW.draft_version_id
                      AND claim_key NOT GLOB 'question_[0-9]*');
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1 FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
      AND EXISTS (
        SELECT 1 FROM json_each(draft.questions_json) AS question
        WHERE NOT EXISTS (SELECT 1 FROM ai_evidence_links AS evidence
                          WHERE evidence.draft_version_id = draft.id
                            AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1))
      )
  );
END;
CREATE TRIGGER ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;
CREATE TRIGGER ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.origin = 'legacy_import'
BEGIN SELECT RAISE(ABORT, 'phase1: runtime legacy AI import is prohibited'); END;

CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.support_case_id AS support_case_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  support_case.beneficiary_id AS beneficiary_id,
  support_case.program_type AS support_case_program_type,
  support_case.status AS support_case_status,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.questions_json AS questions_json,
  draft.summary_text AS ai_summary,
  draft.source_snapshot_id AS source_snapshot_id,
  draft.source_snapshot_hash AS source_snapshot_hash,
  draft.consent_evidence_id AS consent_evidence_id,
  draft.provider_config_id AS provider_config_id,
  draft.model_id AS model_id,
  draft.prompt_version AS prompt_version,
  draft.schema_version AS schema_version,
  draft.origin AS origin,
  draft.creation_mode AS creation_mode,
  draft.grounding_status AS grounding_status,
  draft.created_by AS draft_created_by,
  draft.created_at AS draft_created_at,
  review.id AS review_event_id,
  review.actor_id AS approved_by,
  review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work ON work.id = review.work_item_id
JOIN support_cases AS support_case ON support_case.id = work.support_case_id
JOIN ai_draft_versions AS draft ON draft.id = review.draft_version_id
                             AND draft.work_item_id = work.id
WHERE review.decision = 'approved';

CREATE VIEW grounded_ai_quality_v1 AS
SELECT * FROM approved_ai_briefing_v1
WHERE origin = 'generated' AND grounding_status = 'grounded';

CREATE TRIGGER sessions_direct_ai_approval_insert_guard
BEFORE INSERT ON sessions
WHEN NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT NULL
  OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'phase1: direct session AI approval is prohibited'); END;

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
 AND NOT (
   NEW.ai_status = 'approved' AND NEW.approved_at IS NOT NULL AND EXISTS (
     SELECT 1 FROM approved_ai_briefing_v1 AS briefing
     WHERE briefing.session_id = NEW.id AND briefing.summary_text IS NEW.ai_summary
       AND briefing.approved_by IS NEW.approved_by AND briefing.approved_at IS NEW.approved_at
   )
 )
BEGIN SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review'); END;

CREATE TRIGGER sessions_approved_ai_compatibility_immutable
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN OLD.approved_at IS NOT NULL
 AND (NEW.ai_status IS NOT OLD.ai_status OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
BEGIN SELECT RAISE(ABORT, 'phase1: approved session AI compatibility fields are immutable'); END;

-- Durable cutover manifest, followed by final no-suffix/FK/hash/manifest probes.
CREATE TABLE participant_support_case_cutover_manifest (
  migration_id             TEXT PRIMARY KEY CHECK (migration_id = '0006_participant_support_case_cutover'),
  beneficiary_count        INTEGER NOT NULL,
  support_case_count       INTEGER NOT NULL,
  session_count            INTEGER NOT NULL,
  approved_ai_count        INTEGER NOT NULL,
  pii_vault_count          INTEGER NOT NULL,
  legacy_case_map_count    INTEGER NOT NULL,
  completed_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO participant_support_case_cutover_manifest (
  migration_id, beneficiary_count, support_case_count, session_count,
  approved_ai_count, pii_vault_count, legacy_case_map_count
)
SELECT
  '0006_participant_support_case_cutover',
  (SELECT COUNT(*) FROM beneficiaries),
  (SELECT COUNT(*) FROM support_cases),
  (SELECT COUNT(*) FROM sessions),
  (SELECT COUNT(*) FROM approved_ai_briefing_v1),
  (SELECT COUNT(*) FROM participant_pii_vault),
  (SELECT COUNT(*) FROM support_cases WHERE legacy_case_id IS NOT NULL);

INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'final_manifest', 0
WHERE NOT EXISTS (
  SELECT 1 FROM participant_support_case_cutover_manifest
  WHERE migration_id = '0006_participant_support_case_cutover'
    AND beneficiary_count = (SELECT COUNT(*) FROM beneficiaries)
    AND support_case_count = (SELECT COUNT(*) FROM support_cases)
    AND session_count = (SELECT COUNT(*) FROM sessions)
    AND approved_ai_count = (SELECT COUNT(*) FROM approved_ai_briefing_v1)
    AND pii_vault_count = (SELECT COUNT(*) FROM participant_pii_vault)
    AND legacy_case_map_count = (SELECT COUNT(*) FROM support_cases WHERE legacy_case_id IS NOT NULL)
);
INSERT INTO participant_support_case_cutover_assertions (id, ok)
SELECT 'final_fk', 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

DROP TABLE participant_support_case_cutover_assertions;

CREATE TABLE participant_support_case_cutover_probe (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO participant_support_case_cutover_probe (id, ok)
SELECT 'no_private_suffixes', 0
WHERE EXISTS (
  SELECT 1 FROM sqlite_master
  WHERE type IN ('table', 'index', 'trigger', 'view')
    AND (name GLOB '*_next' OR name GLOB '*_legacy')
);
INSERT INTO participant_support_case_cutover_probe (id, ok)
SELECT 'final_fk_after_publication', 0
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);
DROP TABLE participant_support_case_cutover_probe;

