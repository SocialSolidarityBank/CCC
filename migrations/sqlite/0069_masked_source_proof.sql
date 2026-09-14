-- F4: persist the accepted result packet and the complete F3 source binding.
-- Historical snapshots stay NULL; new acceptance writes both columns together.
ALTER TABLE ai_masked_source_snapshots ADD COLUMN proof_json TEXT;
ALTER TABLE ai_masked_source_snapshots ADD COLUMN entity_source_binding TEXT;

CREATE TRIGGER ai_masked_source_snapshots_proof_pair_guard
BEFORE INSERT ON ai_masked_source_snapshots
WHEN (NEW.proof_json IS NULL) != (NEW.entity_source_binding IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'masked_source_snapshot_proof_pair_invalid');
END;
