-- Logical pair: SQLite 0066_case_entity_mapping.sql. Existing support_cases RLS still applies.
ALTER TABLE support_cases ADD COLUMN enc_entity_map text;
ALTER TABLE support_cases ADD COLUMN entity_map_revision bigint NOT NULL DEFAULT 0
  CHECK (entity_map_revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE support_cases ADD COLUMN entity_map_key_version bigint CHECK (
  (enc_entity_map IS NULL AND entity_map_revision = 0 AND entity_map_key_version IS NULL)
  OR (enc_entity_map IS NOT NULL AND length(enc_entity_map) > 0 AND entity_map_revision > 0
    AND entity_map_key_version IS NOT NULL AND entity_map_key_version BETWEEN 1 AND 9007199254740991)
);

CREATE FUNCTION support_case_entity_map_revision_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.enc_entity_map IS DISTINCT FROM OLD.enc_entity_map OR NEW.entity_map_revision <> OLD.entity_map_revision
      OR NEW.entity_map_key_version IS DISTINCT FROM OLD.entity_map_key_version)
    AND (NEW.entity_map_revision <> OLD.entity_map_revision + 1
      OR NEW.enc_entity_map IS NULL OR NEW.enc_entity_map IS NOT DISTINCT FROM OLD.enc_entity_map) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='case_entity_mapping_revision_changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_case_entity_map_revision_guard
BEFORE UPDATE OF enc_entity_map, entity_map_revision, entity_map_key_version ON support_cases
FOR EACH ROW EXECUTE FUNCTION support_case_entity_map_revision_guard_fn();
