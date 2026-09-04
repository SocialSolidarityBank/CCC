-- ============================================================================
-- Migration 0003 — Phase 1 additive text-AI provenance and provider registry
--
-- This migration is additive. It intentionally does not alter 0001/0002 tables
-- or authorize any text-AI work: feature flags and gateway consent checks remain
-- the activation boundary. All stored AI content is already masked/pseudonymous.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pilot_text_ai_consent_evidence — bounded Phase-1 pilot evidence only.
-- This is not the Phase-2 signed consent lifecycle or a revocation ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pilot_text_ai_consent_evidence (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  case_id         TEXT NOT NULL REFERENCES cases (id),
  notice_version  TEXT NOT NULL CHECK (length(trim(notice_version)) > 0),
  notice_sha256   TEXT NOT NULL CHECK (length(trim(notice_sha256)) > 0),
  evidence_ref    TEXT NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  evidence_sha256 TEXT NOT NULL CHECK (length(trim(evidence_sha256)) > 0),
  captured_by     TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pilot_text_ai_consent_case
  ON pilot_text_ai_consent_evidence (org_id, case_id, effective_at DESC);

CREATE TRIGGER IF NOT EXISTS pilot_text_ai_consent_evidence_no_update
BEFORE UPDATE ON pilot_text_ai_consent_evidence
BEGIN
  SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS pilot_text_ai_consent_evidence_no_delete
BEFORE DELETE ON pilot_text_ai_consent_evidence
BEGIN
  SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only');
END;

-- ----------------------------------------------------------------------------
-- Provider configuration and activation provenance. Configuration records are
-- immutable. An activation may only transition once from active to deactivated;
-- switching or rolling back inserts a new activation row and preserves history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  adapter_id          TEXT NOT NULL CHECK (length(trim(adapter_id)) > 0),
  adapter_version     TEXT NOT NULL CHECK (length(trim(adapter_version)) > 0),
  config_hash         TEXT NOT NULL CHECK (length(trim(config_hash)) > 0),
  approval_refs_json  TEXT NOT NULL CHECK (length(trim(approval_refs_json)) > 0),
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, adapter_id, adapter_version, config_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_org
  ON ai_provider_configs (org_id, adapter_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS ai_provider_configs_no_update
BEFORE UPDATE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_configs_no_delete
BEFORE DELETE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_provider_activations (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL,
  config_id              TEXT NOT NULL REFERENCES ai_provider_configs (id),
  previous_activation_id TEXT REFERENCES ai_provider_activations (id),
  activated_by           TEXT NOT NULL,
  activated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at         TEXT,
  CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_activations_org
  ON ai_provider_activations (org_id, activated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_provider_activations_one_active_org
  ON ai_provider_activations (org_id)
  WHERE deactivated_at IS NULL;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_scope_guard
BEFORE INSERT ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider configuration organization mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_provider_configs AS config
    WHERE config.id = NEW.config_id
      AND config.org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'phase1: prior provider activation must be retired in the same organization')
  WHERE NEW.previous_activation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ai_provider_activations AS prior
      WHERE prior.id = NEW.previous_activation_id
        AND prior.org_id = NEW.org_id
        AND prior.deactivated_at IS NOT NULL
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_only_deactivate
BEFORE UPDATE ON ai_provider_activations
WHEN NEW.id IS NOT OLD.id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.config_id IS NOT OLD.config_id
  OR NEW.previous_activation_id IS NOT OLD.previous_activation_id
  OR NEW.activated_by IS NOT OLD.activated_by
  OR NEW.activated_at IS NOT OLD.activated_at
  OR OLD.deactivated_at IS NOT NULL
  OR NEW.deactivated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activation is immutable except retirement');
END;

CREATE TRIGGER IF NOT EXISTS ai_provider_activations_no_delete
BEFORE DELETE ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activations are append-only');
END;
-- ----------------------------------------------------------------------------
-- Immutable masked source snapshots are recorded by the service boundary before
-- any provider outbound. They contain only locally NER-masked text after the
-- gateway's registered-PII substitution; source identifiers remain opaque.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_masked_source_snapshots (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  case_id                  TEXT NOT NULL REFERENCES cases (id),
  session_id               TEXT NOT NULL REFERENCES sessions (id),
  masked_text              TEXT NOT NULL CHECK (length(masked_text) > 0),
  sha256                   TEXT NOT NULL
                           CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  masking_pipeline_version TEXT NOT NULL CHECK (length(trim(masking_pipeline_version)) > 0),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_masked_source_snapshots_scope
  ON ai_masked_source_snapshots (org_id, case_id, session_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_scope_guard
BEFORE INSERT ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM sessions
    WHERE sessions.id = NEW.session_id
      AND sessions.org_id = NEW.org_id
      AND sessions.case_id = NEW.case_id
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_no_update
BEFORE UPDATE ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_snapshots_no_delete
BEFORE DELETE ON ai_masked_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_masked_source_evidence_items (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES ai_masked_source_snapshots (id),
  org_id         TEXT NOT NULL,
  case_id        TEXT NOT NULL REFERENCES cases (id),
  session_id     TEXT NOT NULL REFERENCES sessions (id),
  source_ref     TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_sha256  TEXT NOT NULL
                 CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  evidence_quote TEXT NOT NULL CHECK (length(evidence_quote) > 0),
  source_start   INTEGER NOT NULL CHECK (source_start >= 0),
  source_end     INTEGER NOT NULL CHECK (source_end > source_start),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (snapshot_id, source_ref, source_start, source_end)
);

CREATE INDEX IF NOT EXISTS idx_ai_masked_source_evidence_items_scope
  ON ai_masked_source_evidence_items (org_id, case_id, session_id, snapshot_id, source_start);

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_insert_guard
BEFORE INSERT ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    JOIN sessions
      ON sessions.id = snapshot.session_id
     AND sessions.org_id = snapshot.org_id
     AND sessions.case_id = snapshot.case_id
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.org_id = NEW.org_id
      AND snapshot.case_id = NEW.case_id
      AND snapshot.session_id = NEW.session_id
  );

  SELECT RAISE(ABORT, 'phase1: masked source evidence hash mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.sha256 = NEW.source_sha256
  );

  SELECT RAISE(ABORT, 'phase1: masked source evidence span mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_masked_source_snapshots AS snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND NEW.source_end <= length(snapshot.masked_text)
      AND substr(
        snapshot.masked_text,
        NEW.source_start + 1,
        NEW.source_end - NEW.source_start
      ) = NEW.evidence_quote
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_no_update
BEFORE UPDATE ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_masked_source_evidence_items_no_delete
BEFORE DELETE ON ai_masked_source_evidence_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only');
END;

-- ----------------------------------------------------------------------------
-- Immutable AI work and draft provenance. Phase 1 has only text_ai_briefing;
-- later work kinds require a forward migration rather than a silent expansion.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_work_items (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  case_id    TEXT NOT NULL REFERENCES cases (id),
  session_id TEXT NOT NULL REFERENCES sessions (id),
  kind       TEXT NOT NULL CHECK (kind = 'text_ai_briefing'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_ai_work_items_org_case
  ON ai_work_items (org_id, case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_work_items_session
  ON ai_work_items (session_id, kind);

CREATE TRIGGER IF NOT EXISTS ai_work_items_scope_guard
BEFORE INSERT ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work item case or session scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM sessions
    WHERE sessions.id = NEW.session_id
      AND sessions.org_id = NEW.org_id
      AND sessions.case_id = NEW.case_id
  );
END;

CREATE TRIGGER IF NOT EXISTS ai_work_items_no_update
BEFORE UPDATE ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work items are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_work_items_no_delete
BEFORE DELETE ON ai_work_items
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI work items are append-only');
END;

CREATE TABLE IF NOT EXISTS ai_draft_versions (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  version              INTEGER NOT NULL CHECK (version > 0),
  parent_version_id    TEXT REFERENCES ai_draft_versions (id),
  summary_text         TEXT NOT NULL,
  questions_json        TEXT NOT NULL
                        CHECK (json_valid(questions_json) AND json_type(questions_json) = 'array'),
  source_snapshot_id   TEXT REFERENCES ai_masked_source_snapshots (id),
  source_snapshot_hash TEXT,
  consent_evidence_id  TEXT REFERENCES pilot_text_ai_consent_evidence (id),
  provider_config_id   TEXT REFERENCES ai_provider_configs (id),
  model_id             TEXT,
  prompt_version       TEXT,
  schema_version       TEXT,
  origin               TEXT NOT NULL
                       CHECK (origin IN ('generated', 'legacy_import')),
  creation_mode        TEXT NOT NULL
                       CHECK (creation_mode IN ('provider_generated', 'human_edited', 'legacy_import')),
  grounding_status     TEXT NOT NULL
                       CHECK (grounding_status IN ('grounded', 'legacy_unverified')),
  created_by           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_item_id, version),
  CHECK (
    (origin = 'generated'
      AND creation_mode IN ('provider_generated', 'human_edited')
      AND grounding_status = 'grounded'
      AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL
      AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL
      AND model_id IS NOT NULL
      AND prompt_version IS NOT NULL
      AND schema_version IS NOT NULL
      AND created_by IS NOT NULL)
      AND json_array_length(questions_json) BETWEEN 2 AND 3
    OR
    (origin = 'legacy_import'
      AND creation_mode = 'legacy_import'
      AND grounding_status = 'legacy_unverified'
      AND source_snapshot_id IS NULL
      AND source_snapshot_hash IS NULL
      AND consent_evidence_id IS NULL
      AND provider_config_id IS NULL
      AND model_id IS NULL
      AND prompt_version IS NULL
      AND schema_version IS NULL
      AND created_by IS NULL)
      AND json_array_length(questions_json) = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_work
  ON ai_draft_versions (work_item_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_source_snapshot
  ON ai_draft_versions (source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_provider_config
  ON ai_draft_versions (provider_config_id)
  WHERE provider_config_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_evidence_links (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES ai_draft_versions (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_evidence_links_draft
  ON ai_evidence_links (draft_version_id, claim_key);

CREATE TABLE IF NOT EXISTS ai_review_events (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  draft_version_id     TEXT NOT NULL REFERENCES ai_draft_versions (id),
  decision             TEXT NOT NULL
                       CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES ai_draft_versions (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR
    (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_review_events_work
  ON ai_review_events (work_item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_terminal_draft
  ON ai_review_events (draft_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id)
  WHERE decision = 'approved';

-- Versions are sequential and may only descend from the current pending draft.
CREATE TRIGGER IF NOT EXISTS ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((
    SELECT MAX(version) + 1
    FROM ai_draft_versions
    WHERE work_item_id = NEW.work_item_id
  ), 1);

  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
    OR (NEW.version > 1 AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS parent
      WHERE parent.id = NEW.parent_version_id
        AND parent.work_item_id = NEW.work_item_id
        AND parent.version = NEW.version - 1
    ));

  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.questions_json)
    WHERE json_each.type <> 'text' OR length(trim(json_each.value)) = 0
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.questions_json)
    GROUP BY json_each.value
    HAVING COUNT(*) > 1
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM ai_review_events
      WHERE ai_review_events.draft_version_id = NEW.parent_version_id
    );

  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_masked_source_snapshots AS snapshot
        ON snapshot.id = NEW.source_snapshot_id
       AND snapshot.org_id = work.org_id
       AND snapshot.case_id = work.case_id
       AND snapshot.session_id = work.session_id
       AND snapshot.sha256 = NEW.source_snapshot_hash
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN pilot_text_ai_consent_evidence AS evidence
        ON evidence.id = NEW.consent_evidence_id
       AND evidence.org_id = work.org_id
       AND evidence.case_id = work.case_id
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin = 'generated'
    AND NEW.consent_evidence_id IS NOT (
      SELECT evidence.id
      FROM ai_work_items AS work
      JOIN pilot_text_ai_consent_evidence AS evidence
        ON evidence.org_id = work.org_id
       AND evidence.case_id = work.case_id
      WHERE work.id = NEW.work_item_id
        AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC
      LIMIT 1
    );

  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_provider_configs AS config
        ON config.id = NEW.provider_config_id
       AND config.org_id = work.org_id
      WHERE work.id = NEW.work_item_id
    );

  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated'
    AND NEW.creation_mode = 'human_edited'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS parent
      WHERE parent.id = NEW.parent_version_id
        AND parent.work_item_id = NEW.work_item_id
        AND parent.origin = 'generated'
        AND parent.provider_config_id IS NEW.provider_config_id
        AND parent.source_snapshot_id IS NEW.source_snapshot_id
        AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
        AND parent.questions_json IS NEW.questions_json
        AND parent.model_id IS NEW.model_id
        AND parent.prompt_version IS NEW.prompt_version
        AND parent.schema_version IS NEW.schema_version
    );

  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated'
    AND NEW.creation_mode = 'provider_generated'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_work_items AS work
      JOIN ai_provider_configs AS config
        ON config.id = NEW.provider_config_id
       AND config.org_id = work.org_id
      JOIN ai_provider_activations AS activation
        ON activation.config_id = config.id
       AND activation.org_id = work.org_id
      WHERE work.id = NEW.work_item_id
        AND activation.deactivated_at IS NULL
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

-- Evidence is masked, belongs only to an active generated draft, and cannot be
-- appended after that draft became stale or terminal.
CREATE TRIGGER IF NOT EXISTS ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.origin = 'generated'
      AND draft.grounding_status = 'grounded'
  );

  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work
      ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = draft.source_snapshot_id
     AND snapshot.org_id = work.org_id
     AND snapshot.case_id = work.case_id
     AND snapshot.session_id = work.session_id
     AND snapshot.sha256 = draft.source_snapshot_hash
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id
     AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256
     AND item.org_id = work.org_id
     AND item.case_id = work.case_id
     AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref
     AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start
     AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (
    SELECT 1
    FROM ai_review_events
    WHERE ai_review_events.draft_version_id = NEW.draft_version_id
  )
    OR EXISTS (
      SELECT 1
      FROM ai_draft_versions AS newer
      JOIN ai_draft_versions AS draft
        ON draft.id = NEW.draft_version_id
      WHERE newer.work_item_id = draft.work_item_id
        AND newer.version > draft.version
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only');
END;

-- Reviews may only close the current draft. Supersession must name exactly the
-- next version. A generated approval cannot be evidence-free; legacy imports
-- are intentionally exempt because 0004 must not fabricate grounding evidence.
CREATE TRIGGER IF NOT EXISTS ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.work_item_id = NEW.work_item_id
  );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected')
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS newer
      JOIN ai_draft_versions AS draft
        ON draft.id = NEW.draft_version_id
      WHERE newer.work_item_id = NEW.work_item_id
        AND newer.version > draft.version
    );

  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_draft_versions AS draft
      JOIN ai_draft_versions AS replacement
        ON replacement.id = NEW.replacement_draft_id
      WHERE draft.id = NEW.draft_version_id
        AND replacement.work_item_id = draft.work_item_id
        AND replacement.version = draft.version + 1
    );

  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS later
      JOIN ai_draft_versions AS replacement
        ON replacement.id = NEW.replacement_draft_id
      WHERE later.work_item_id = NEW.work_item_id
        AND later.version > replacement.version
    );

  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded'
    AND EXISTS (
      SELECT 1
      FROM ai_review_events
      WHERE ai_review_events.draft_version_id = NEW.replacement_draft_id
    );

  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);

  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ai_evidence_links
      WHERE ai_evidence_links.draft_version_id = NEW.draft_version_id
    );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions
      WHERE id = NEW.draft_version_id
        AND origin = 'generated'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ai_evidence_links
      WHERE ai_evidence_links.draft_version_id = NEW.draft_version_id
        AND ai_evidence_links.claim_key NOT GLOB 'question_[0-9]*'
    );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved'
    AND EXISTS (
      SELECT 1
      FROM ai_draft_versions AS draft
      WHERE draft.id = NEW.draft_version_id
        AND draft.origin = 'generated'
        AND EXISTS (
          SELECT 1
          FROM json_each(draft.questions_json) AS question
          WHERE NOT EXISTS (
            SELECT 1
            FROM ai_evidence_links AS evidence
            WHERE evidence.draft_version_id = draft.id
              AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1)
          )
        )
    );
END;

CREATE TRIGGER IF NOT EXISTS ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI review events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI review events are append-only');
END;
