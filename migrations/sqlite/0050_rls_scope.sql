-- RLS parity scope marker: SQLite has no row-level security, so the gateway
-- remains responsible for enforcing the actor organization on every guard use.
-- Existing rows intentionally receive the empty scope and are not usable by the
-- scoped gateway path.
ALTER TABLE counseling_memory_guards ADD COLUMN org_id TEXT NOT NULL DEFAULT '';

-- Shared allocation metadata contains animal names and numbers, never a
-- participant, organization, or actor identifier. Registration may leave gaps.
CREATE TABLE beneficiary_id_counters (
  animal TEXT NOT NULL PRIMARY KEY,
  last_value INTEGER NOT NULL CHECK (last_value BETWEEN 0 AND 9007199254740991)
);
INSERT INTO beneficiary_id_counters(animal,last_value)
SELECT substr(id,1,instr(id,'-')-1),MAX(CAST(substr(id,instr(id,'-')+1) AS INTEGER))
FROM beneficiaries WHERE instr(id,'-')>0
GROUP BY substr(id,1,instr(id,'-')-1);

-- Imports and existing fixture/bootstrap paths can supply explicit pseudonyms.
CREATE TRIGGER beneficiaries_sync_id_counter AFTER INSERT ON beneficiaries
WHEN instr(NEW.id,'-')>0
BEGIN
  INSERT INTO beneficiary_id_counters(animal,last_value)
  VALUES(substr(NEW.id,1,instr(NEW.id,'-')-1),CAST(substr(NEW.id,instr(NEW.id,'-')+1) AS INTEGER))
  ON CONFLICT(animal) DO UPDATE SET last_value=excluded.last_value
  WHERE excluded.last_value>beneficiary_id_counters.last_value;
END;
