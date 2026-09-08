-- Canonical six-domain consent event is the only authorization provenance for new AI drafts.
ALTER TABLE ai_draft_versions
  DROP CONSTRAINT IF EXISTS ai_draft_versions_consent_evidence_id_fkey;
ALTER TABLE ai_draft_versions
  ADD COLUMN IF NOT EXISTS consent_revision TEXT,
  ADD COLUMN IF NOT EXISTS consent_receipt_json TEXT;
ALTER TABLE ai_draft_versions
  DROP CONSTRAINT IF EXISTS ai_draft_versions_consent_receipt_json_check;
ALTER TABLE ai_draft_versions
  ADD CONSTRAINT ai_draft_versions_consent_receipt_json_check
  CHECK (
    consent_receipt_json IS NULL
    OR jsonb_typeof(consent_receipt_json::jsonb)='object'
  );

CREATE OR REPLACE FUNCTION ai_draft_versions_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version<>COALESCE((SELECT max(version)+1 FROM ai_draft_versions WHERE work_item_id=NEW.work_item_id),1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF (NEW.version=1 AND NEW.parent_version_id IS NOT NULL) OR (NEW.version>1 AND NOT EXISTS
    (SELECT 1 FROM ai_draft_versions WHERE id=NEW.parent_version_id AND work_item_id=NEW.work_item_id AND version=NEW.version-1)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: AI draft parent must be the prior version in the same work item';
  END IF;
  IF EXISTS (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value)
    WHERE CASE json_typeof(value)
      WHEN 'string' THEN length(trim(value#>>'{}'))=0
      WHEN 'object' THEN NOT (json_typeof(value->'title')='string' AND length(trim(value->>'title'))>0
        AND json_typeof(value->'reason')='string' AND length(trim(value->>'reason'))>0
        AND (SELECT count(*) FROM json_each(value))=2)
      ELSE true END)
    OR EXISTS (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value)
      GROUP BY CASE json_typeof(value) WHEN 'object' THEN value->>'title' ELSE value#>>'{}' END HAVING count(*)>1)
    OR (NEW.origin='fixture_generated' AND EXISTS
      (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value) WHERE json_typeof(value)<>'object')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: AI draft questions are invalid';
  END IF;
  IF NEW.parent_version_id IS NOT NULL AND EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id=NEW.parent_version_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NOT EXISTS
    (SELECT 1 FROM ai_work_items AS work JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id=NEW.source_snapshot_id AND snapshot.org_id=work.org_id AND snapshot.support_case_id=work.support_case_id
      AND snapshot.session_id=work.session_id AND snapshot.sha256=NEW.source_snapshot_hash WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft source snapshot scope or hash mismatch';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NOT EXISTS
    (SELECT 1 FROM ai_work_items AS work JOIN consent_events AS consent
      ON consent.id=NEW.consent_evidence_id AND consent.org_id=work.org_id
      AND consent.support_case_id=work.support_case_id
      AND consent.domain='external_llm_cross_border_processing' AND consent.decision='grant'
      AND consent.provider='openai' AND consent.purpose='ai_briefing'
      WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft consent evidence scope mismatch';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NEW.consent_evidence_id IS DISTINCT FROM
    (SELECT consent.id FROM ai_work_items AS work JOIN consent_events AS consent
      ON consent.org_id=work.org_id AND consent.support_case_id=work.support_case_id
      WHERE work.id=NEW.work_item_id AND consent.domain='external_llm_cross_border_processing'
        AND consent.decision<>'correct'
      ORDER BY consent.event_sequence DESC,consent.id DESC NULLS LAST LIMIT 1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND (
    NEW.consent_revision IS NULL
    OR NEW.consent_receipt_json IS NULL
    OR NEW.consent_receipt_json::jsonb->>'consentRevision' IS DISTINCT FROM NEW.consent_revision
    OR jsonb_typeof(NEW.consent_receipt_json::jsonb->'required') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.consent_receipt_json::jsonb->'required')<>3
    OR NOT EXISTS (
      SELECT 1 FROM ai_work_items AS work
      WHERE work.id=NEW.work_item_id
        AND (
          SELECT count(*) FROM jsonb_array_elements(
            NEW.consent_receipt_json::jsonb->'required'
          ) AS receipt(value)
          JOIN consent_events AS consent
            ON consent.id=receipt.value->>'eventId'
           AND consent.revision=(receipt.value->>'revision')::bigint
           AND consent.event_sequence=(receipt.value->>'eventSequence')::bigint
           AND consent.domain=receipt.value->>'domain'
           AND consent.decision='grant'
           AND consent.org_id=work.org_id
           AND consent.support_case_id=work.support_case_id
           AND consent.domain IN (
             'external_llm_cross_border_processing',
             'personal_data_collection_use',
             'sensitive_information_processing'
           )
           AND consent.event_sequence=(
             SELECT max(latest.event_sequence) FROM consent_events AS latest
             WHERE latest.org_id=consent.org_id
               AND latest.beneficiary_id=consent.beneficiary_id
               AND latest.support_case_id=consent.support_case_id
               AND latest.domain=consent.domain
               AND latest.decision<>'correct'
           )
        )=3
        AND (
          SELECT count(DISTINCT receipt.value->>'domain')
          FROM jsonb_array_elements(NEW.consent_receipt_json::jsonb->'required') AS receipt(value)
        )=3
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.origin='generated' AND NOT EXISTS (SELECT 1 FROM ai_work_items AS work JOIN ai_provider_configs AS config
    ON config.id=NEW.provider_config_id AND config.org_id=work.org_id WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft provider configuration scope mismatch';
  END IF;
  IF NEW.origin='generated' AND NEW.creation_mode='human_edited' AND NOT EXISTS (SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id=NEW.parent_version_id AND parent.work_item_id=NEW.work_item_id AND parent.origin='generated'
      AND parent.provider_config_id IS NOT DISTINCT FROM NEW.provider_config_id
      AND parent.source_snapshot_id IS NOT DISTINCT FROM NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NOT DISTINCT FROM NEW.source_snapshot_hash
      AND parent.consent_evidence_id IS NOT DISTINCT FROM NEW.consent_evidence_id
      AND parent.consent_revision IS NOT DISTINCT FROM NEW.consent_revision
      AND parent.consent_receipt_json IS NOT DISTINCT FROM NEW.consent_receipt_json
      AND parent.questions_json IS NOT DISTINCT FROM NEW.questions_json AND parent.model_id IS NOT DISTINCT FROM NEW.model_id
      AND parent.prompt_version IS NOT DISTINCT FROM NEW.prompt_version AND parent.schema_version IS NOT DISTINCT FROM NEW.schema_version) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: human-edited draft must retain parent provenance';
  END IF;
  IF NEW.origin='generated' AND NEW.creation_mode='provider_generated' AND NOT EXISTS (SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id=NEW.provider_config_id AND config.org_id=work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id=config.id AND activation.org_id=work.org_id
    WHERE work.id=NEW.work_item_id AND activation.deactivated_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: provider-generated draft requires the active provider configuration';
  END IF;
  RETURN NEW;
END;
$$;
