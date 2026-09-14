-- Logical pair: SQLite 0069_masked_source_proof.sql.
-- F4: persist the accepted result packet and the complete F3 source binding.
-- Historical snapshots stay NULL; new acceptance writes both columns together.
ALTER TABLE ai_masked_source_snapshots ADD COLUMN proof_json text;
ALTER TABLE ai_masked_source_snapshots ADD COLUMN entity_source_binding text;

CREATE FUNCTION ai_masked_source_snapshots_proof_pair_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.proof_json IS NULL) <> (NEW.entity_source_binding IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='masked_source_snapshot_proof_pair_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_masked_source_snapshots_proof_pair_guard BEFORE INSERT ON ai_masked_source_snapshots
FOR EACH ROW EXECUTE FUNCTION ai_masked_source_snapshots_proof_pair_guard_fn();
