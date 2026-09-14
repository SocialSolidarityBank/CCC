-- F1: 사례 소유 암호문 하나. 번호와 식별 근거는 암호문 안에만 저장한다.
ALTER TABLE support_cases ADD COLUMN enc_entity_map TEXT;
ALTER TABLE support_cases ADD COLUMN entity_map_revision INTEGER NOT NULL DEFAULT 0
  CHECK (entity_map_revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE support_cases ADD COLUMN entity_map_key_version INTEGER CHECK (
  (enc_entity_map IS NULL AND entity_map_revision = 0 AND entity_map_key_version IS NULL)
  OR (enc_entity_map IS NOT NULL AND length(enc_entity_map) > 0 AND entity_map_revision > 0
    AND entity_map_key_version IS NOT NULL AND entity_map_key_version BETWEEN 1 AND 9007199254740991)
);

CREATE TRIGGER support_case_entity_map_revision_guard
BEFORE UPDATE OF enc_entity_map, entity_map_revision, entity_map_key_version ON support_cases
WHEN (NEW.enc_entity_map IS NOT OLD.enc_entity_map OR NEW.entity_map_revision <> OLD.entity_map_revision
    OR NEW.entity_map_key_version IS NOT OLD.entity_map_key_version)
  AND (NEW.entity_map_revision <> OLD.entity_map_revision + 1
    OR NEW.enc_entity_map IS NULL OR NEW.enc_entity_map IS OLD.enc_entity_map)
BEGIN
  SELECT RAISE(ABORT, 'case_entity_mapping_revision_changed');
END;
