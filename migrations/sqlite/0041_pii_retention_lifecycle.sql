-- ============================================================================
-- 0041: 보존 만료 → 아카이브 → 검토 → 관리자 승인 → PII 파기 (CCC-121)
--
-- D32·D46의 핵심은 보존 시계가 끝났다고 자동으로 값을 지우지 않는 것이다.
-- 암호문은 별도 표로 옮겨 일반 경로에서 분리하고, cron은 아카이브와 재검토만 수행한다.
-- 비가역 파기는 기관 관리자가 검토한 한 건에만 허용한다.
-- ============================================================================

CREATE TABLE participant_pii_archives (
  id                    TEXT NOT NULL UNIQUE,
  beneficiary_id        TEXT PRIMARY KEY REFERENCES participant_pii_vault (beneficiary_id),
  org_id                TEXT NOT NULL,
  enc_name              TEXT,
  enc_phone             TEXT,
  enc_account           TEXT,
  enc_email             TEXT,
  enc_birth_date        TEXT,
  enc_region            TEXT,
  enc_emergency_contact TEXT,
  enc_gender            TEXT,
  key_version           INTEGER NOT NULL CHECK (key_version > 0),
  archived_at           TEXT NOT NULL,
  archived_by           TEXT NOT NULL,
  retention_cap_due_at  TEXT NOT NULL,
  review_status         TEXT NOT NULL
                        CHECK (review_status IN ('pending', 'retained', 'approved', 'purged')),
  review_due_at         TEXT NOT NULL,
  review_reason_kind    TEXT
                        CHECK (review_reason_kind IN (
                          'extended_consent', 'active_work', 'legal_requirement'
                        )),
  review_reason         TEXT,
  reviewed_by           TEXT,
  reviewed_at           TEXT,
  approved_by           TEXT,
  approved_at           TEXT,
  purged_at             TEXT,
  state_changed_by      TEXT NOT NULL,
  state_changed_by_role TEXT NOT NULL CHECK (state_changed_by_role IN ('admin', 'service')),
  state_changed_at      TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (org_id, beneficiary_id),
  CHECK (julianday(retention_cap_due_at) IS NOT NULL AND julianday(archived_at) IS NOT NULL),
  CHECK (
    (
      review_status = 'pending'
      AND review_reason_kind IS NULL AND review_reason IS NULL
      AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND approved_by IS NULL AND approved_at IS NULL AND purged_at IS NULL
    )
    OR
    (
      review_status = 'retained'
      AND review_reason_kind IS NOT NULL AND review_reason IS NOT NULL
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL AND purged_at IS NULL
    )
    OR
    (
      review_status = 'approved'
      AND review_reason_kind IS NULL AND review_reason IS NULL
      AND reviewed_by IS NULL AND reviewed_at IS NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND purged_at IS NULL
    )
    OR
    (
      review_status = 'purged'
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND purged_at IS NOT NULL
      AND enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL
      AND enc_email IS NULL AND enc_birth_date IS NULL AND enc_region IS NULL
      AND enc_emergency_contact IS NULL AND enc_gender IS NULL
    )
  )
);

CREATE INDEX idx_participant_pii_archives_review
  ON participant_pii_archives (org_id, review_status, review_due_at);

CREATE TABLE participant_pii_retention_decisions (
  id                 TEXT PRIMARY KEY,
  archive_id         TEXT NOT NULL,
  org_id             TEXT NOT NULL,
  beneficiary_id     TEXT NOT NULL REFERENCES beneficiaries (id),
  decision           TEXT NOT NULL CHECK (decision IN ('retain', 'purge')),
  reason_kind        TEXT CHECK (reason_kind IN (
                       'extended_consent', 'active_work', 'legal_requirement'
                     )),
  reason             TEXT,
  retain_until       TEXT,
  decided_by         TEXT NOT NULL,
  decided_at         TEXT NOT NULL,
  UNIQUE (id, org_id),
  CHECK (
    (
      decision = 'retain'
      AND reason_kind IS NOT NULL
      AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500
      AND retain_until IS NOT NULL
    )
    OR
    (
      decision = 'purge'
      AND reason_kind IS NULL AND reason IS NULL AND retain_until IS NULL
    )
  )
);

CREATE INDEX idx_participant_pii_retention_decisions_history
  ON participant_pii_retention_decisions (org_id, beneficiary_id, decided_at);
CREATE INDEX idx_participant_pii_retention_decisions_archive
  ON participant_pii_retention_decisions (archive_id, decision, decided_at);

CREATE TRIGGER participant_pii_retention_decisions_insert_guard
BEFORE INSERT ON participant_pii_retention_decisions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM participant_pii_archives AS archive
    WHERE archive.id = NEW.archive_id
      AND archive.beneficiary_id = NEW.beneficiary_id
      AND archive.org_id = NEW.org_id
      AND archive.review_status = 'pending'
  );
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS role_assignment
    JOIN users ON users.id = role_assignment.user_id
    WHERE role_assignment.user_id = NEW.decided_by
      AND role_assignment.org_id = NEW.org_id
      AND role_assignment.role = 'institution_admin'
      AND role_assignment.revoked_at IS NULL
      AND users.org_id = NEW.org_id
      AND users.active = 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.decision = 'retain' AND (
    julianday(NEW.retain_until) <= julianday(NEW.decided_at)
    OR (
      NEW.reason_kind <> 'legal_requirement'
      AND julianday(NEW.retain_until) > (
        SELECT julianday(retention_cap_due_at)
        FROM participant_pii_archives
        WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
      )
    )
  );
END;

CREATE TRIGGER participant_pii_retention_decisions_no_update
BEFORE UPDATE ON participant_pii_retention_decisions
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER participant_pii_retention_decisions_no_delete
BEFORE DELETE ON participant_pii_retention_decisions
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

DROP TRIGGER support_cases_schedule_pii_purge_due;
CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM support_cases AS active_case
    WHERE active_case.beneficiary_id = NEW.beneficiary_id
      AND active_case.org_id = NEW.org_id
      AND active_case.status = 'active'
  )
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = min(
           datetime(
             NEW.closed_at,
             '+' || COALESCE(
               (SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = NEW.org_id),
               365
             ) || ' days'
           ),
           CASE strftime('%m-%d', NEW.closed_at)
             WHEN '02-29' THEN datetime(NEW.closed_at, '+5 years', '-1 day')
             ELSE datetime(NEW.closed_at, '+5 years')
           END
         ),
         version = version + 1,
         retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at,
         updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NULL;
END;

CREATE TRIGGER participant_pii_archives_insert_guard
BEFORE INSERT ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE length(trim(NEW.id)) = 0
     OR NEW.review_status <> 'pending'
     OR NEW.archived_by <> 'system:retention'
     OR NEW.state_changed_by <> 'system:retention'
     OR NEW.state_changed_by_role <> 'service'
     OR NEW.review_due_at IS NOT NEW.archived_at
     OR julianday(NEW.archived_at) > julianday('now');

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM participant_pii_vault AS vault
    WHERE vault.beneficiary_id = NEW.beneficiary_id
      AND vault.org_id = NEW.org_id
      AND vault.purged_at IS NULL
      AND vault.purge_due IS NOT NULL
      AND min(
        julianday(vault.purge_due),
        COALESCE(
          (
            SELECT julianday(
              CASE strftime('%m-%d', context_case.closed_at)
                WHEN '02-29' THEN datetime(context_case.closed_at, '+5 years', '-1 day')
                ELSE datetime(context_case.closed_at, '+5 years')
              END
            )
            FROM support_cases AS context_case
            WHERE context_case.beneficiary_id = vault.beneficiary_id
              AND context_case.org_id = vault.org_id
              AND context_case.status = 'closed'
              AND context_case.closed_at IS NOT NULL
            ORDER BY julianday(context_case.closed_at) DESC, context_case.id DESC
            LIMIT 1
          ),
          julianday(vault.purge_due)
        )
      ) <= julianday('now')
      AND vault.key_version = NEW.key_version
      AND vault.enc_name IS NEW.enc_name
      AND vault.enc_phone IS NEW.enc_phone
      AND vault.enc_account IS NEW.enc_account
      AND vault.enc_email IS NEW.enc_email
      AND vault.enc_birth_date IS NEW.enc_birth_date
      AND vault.enc_region IS NEW.enc_region
      AND vault.enc_emergency_contact IS NEW.enc_emergency_contact
      AND vault.enc_gender IS NEW.enc_gender
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
  );
END;

CREATE TRIGGER participant_pii_archives_update_guard
BEFORE UPDATE ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.id IS NOT OLD.id
     OR NEW.org_id IS NOT OLD.org_id
     OR NEW.key_version IS NOT OLD.key_version
     OR NEW.archived_at IS NOT OLD.archived_at
     OR NEW.archived_by IS NOT OLD.archived_by
     OR NEW.retention_cap_due_at IS NOT OLD.retention_cap_due_at
     OR NEW.created_at IS NOT OLD.created_at;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'retained'
    AND NEW.review_reason_kind IS NOT NULL
    AND NEW.review_reason IS NOT NULL AND length(trim(NEW.review_reason)) BETWEEN 1 AND 500
    AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_at IS NOT NULL
    AND NEW.review_due_at > NEW.reviewed_at
    AND NEW.state_changed_by = NEW.reviewed_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.reviewed_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'retain'
        AND decision.reason_kind = NEW.review_reason_kind
        AND decision.reason = NEW.review_reason
        AND decision.retain_until = NEW.review_due_at
        AND decision.decided_by = NEW.reviewed_by
        AND decision.decided_at = NEW.reviewed_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.reviewed_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND (
      NEW.review_reason_kind = 'legal_requirement'
      OR julianday(NEW.review_due_at) <= julianday(NEW.retention_cap_due_at)
    )
  ) AND NOT (
    OLD.review_status = 'retained' AND NEW.review_status = 'pending'
    AND julianday(OLD.review_due_at) <= julianday(NEW.state_changed_at)
    AND NEW.review_due_at = NEW.state_changed_at
    AND NEW.state_changed_by = 'system:retention' AND NEW.state_changed_by_role = 'service'
    AND NEW.review_reason_kind IS NULL AND NEW.review_reason IS NULL
    AND NEW.reviewed_by IS NULL AND NEW.reviewed_at IS NULL
  ) AND NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'approved'
    AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
    AND NEW.state_changed_by = NEW.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.approved_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'purge'
        AND decision.decided_by = NEW.approved_by
        AND decision.decided_at = NEW.approved_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.approved_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
    )
  ) AND NOT (
    OLD.review_status = 'approved' AND NEW.review_status = 'purged'
    AND NEW.purged_at IS NOT NULL
    AND NEW.state_changed_by = OLD.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.purged_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
        AND purged_at IS NOT NULL
    )
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.review_status <> 'purged' AND (
    NEW.enc_name IS NOT OLD.enc_name OR NEW.enc_phone IS NOT OLD.enc_phone
    OR NEW.enc_account IS NOT OLD.enc_account OR NEW.enc_email IS NOT OLD.enc_email
    OR NEW.enc_birth_date IS NOT OLD.enc_birth_date OR NEW.enc_region IS NOT OLD.enc_region
    OR NEW.enc_emergency_contact IS NOT OLD.enc_emergency_contact
    OR NEW.enc_gender IS NOT OLD.enc_gender
  );
END;

CREATE TRIGGER participant_pii_vault_archived_write_guard
BEFORE UPDATE OF enc_name, enc_phone, enc_account, enc_email, enc_birth_date,
                 enc_region, enc_emergency_contact, enc_gender
ON participant_pii_vault
WHEN EXISTS (
  SELECT 1 FROM participant_pii_archives
  WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
    AND review_status <> 'purged'
)
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.version <> OLD.version + 1
     OR NOT (
       (
         NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
         AND NEW.enc_email IS NULL AND NEW.enc_birth_date IS NULL AND NEW.enc_region IS NULL
         AND NEW.enc_emergency_contact IS NULL AND NEW.enc_gender IS NULL
       )
       OR
       (
         NEW.retention_change_kind = 'cancel_pii_purge_due'
         AND EXISTS (
           SELECT 1 FROM participant_pii_archives AS archive
           WHERE archive.beneficiary_id = OLD.beneficiary_id AND archive.org_id = OLD.org_id
             AND archive.review_status <> 'purged'
             AND NEW.enc_name IS archive.enc_name
             AND NEW.enc_phone IS archive.enc_phone
             AND NEW.enc_account IS archive.enc_account
             AND NEW.enc_email IS archive.enc_email
             AND NEW.enc_birth_date IS archive.enc_birth_date
             AND NEW.enc_region IS archive.enc_region
             AND NEW.enc_emergency_contact IS archive.enc_emergency_contact
             AND NEW.enc_gender IS archive.enc_gender
         )
       )
     );
END;

CREATE TRIGGER participant_pii_vault_reviewed_purge_guard
BEFORE UPDATE OF purged_at ON participant_pii_vault
WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM participant_pii_archives
    WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
      AND review_status = 'approved' AND approved_by = NEW.purged_by
  );
END;

CREATE TRIGGER participant_pii_archives_approved_purge
AFTER UPDATE OF review_status ON participant_pii_archives
WHEN OLD.review_status = 'pending' AND NEW.review_status = 'approved'
BEGIN
  UPDATE participant_pii_vault
     SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
         enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL,
         purge_due = NULL, purged_at = NEW.approved_at,
         purged_by = NEW.approved_by, purged_by_role = 'admin',
         retention_changed_by = NEW.approved_by,
         retention_change_kind = 'purge_pii',
         retention_changed_at = NEW.approved_at,
         version = version + 1, updated_at = NEW.approved_at
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NOT NULL
     AND min(
       julianday(purge_due),
       COALESCE(
         (
           SELECT julianday(retention_cap_due_at)
           FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
         ),
         julianday(purge_due)
       )
     ) <= julianday('now')
     AND NOT EXISTS (
       SELECT 1 FROM support_cases
       WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
     );

  UPDATE participant_pii_archives
     SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
         enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL,
         review_status = 'purged', purged_at = NEW.approved_at,
         state_changed_by = NEW.approved_by, state_changed_by_role = 'admin',
         state_changed_at = NEW.approved_at, updated_at = NEW.approved_at
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status = 'approved'
     AND EXISTS (
       SELECT 1 FROM participant_pii_vault
       WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
         AND purged_at = NEW.approved_at
     );
END;

DROP TRIGGER support_cases_cancel_pii_purge_due;
CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET enc_name = COALESCE((
           SELECT enc_name FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_name),
         enc_phone = COALESCE((
           SELECT enc_phone FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_phone),
         enc_account = COALESCE((
           SELECT enc_account FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_account),
         enc_email = COALESCE((
           SELECT enc_email FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_email),
         enc_birth_date = COALESCE((
           SELECT enc_birth_date FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_birth_date),
         enc_region = COALESCE((
           SELECT enc_region FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_region),
         enc_emergency_contact = COALESCE((
           SELECT enc_emergency_contact FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_emergency_contact),
         enc_gender = COALESCE((
           SELECT enc_gender FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_gender),
         purge_due = NULL, version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NOT NULL;

  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT NEW.org_id, NEW.created_by_actor_id, users.role,
         'restore_archived_pii', 'participant_pii_archives', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.id, NULL, datetime('now')
  FROM users
  WHERE users.id = NEW.created_by_actor_id
    AND EXISTS (
      SELECT 1 FROM participant_pii_archives
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
        AND review_status <> 'purged'
    );

  DELETE FROM participant_pii_archives
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status <> 'purged';
END;

CREATE TRIGGER participant_pii_archives_delete_guard
BEFORE DELETE ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.review_status = 'purged'
    AND NOT EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
        AND retention_change_kind = 're_register_pii'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.review_status <> 'purged'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id AND status = 'active'
    );
END;

CREATE TRIGGER participant_pii_archive_re_register_cleanup
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 're_register_pii'
BEGIN
  DELETE FROM participant_pii_archives
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status = 'purged';
END;

CREATE TRIGGER participant_pii_archives_insert_audit
AFTER INSERT ON participant_pii_archives
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  VALUES (
    NEW.org_id, NEW.archived_by, 'service', 'archive_pii',
    'participant_pii_archives', NEW.beneficiary_id, NEW.beneficiary_id, NULL,
    '{"reviewStatus":"pending"}', datetime('now')
  );
END;

CREATE TRIGGER participant_pii_archives_review_audit
AFTER UPDATE OF review_status ON participant_pii_archives
WHEN OLD.review_status IS NOT NEW.review_status AND NEW.review_status <> 'purged'
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  VALUES (
    NEW.org_id, NEW.state_changed_by, NEW.state_changed_by_role,
    CASE NEW.review_status
      WHEN 'retained' THEN 'retain_archived_pii'
      WHEN 'pending' THEN 'requeue_pii_retention'
      WHEN 'approved' THEN 'approve_pii_purge'
    END,
    'participant_pii_archives', NEW.beneficiary_id, NEW.beneficiary_id, NULL,
    CASE NEW.review_status
      WHEN 'retained' THEN json_object('reasonKind', NEW.review_reason_kind)
      ELSE NULL
    END,
    datetime('now')
  );
END;
DROP TRIGGER participant_pii_vault_retention_guard;
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
    AND NEW.purge_due IS NOT min(
      datetime(
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id),
        '+' || (SELECT pii_purge_grace_days
                FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
      ),
      CASE strftime(
        '%m-%d',
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id)
      )
        WHEN '02-29' THEN datetime(
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years', '-1 day'
        )
        ELSE datetime(
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years'
        )
      END
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.purged_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND EXISTS (
    SELECT 1 FROM support_cases WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND min(
      julianday(OLD.purge_due),
      COALESCE(
        (
          SELECT julianday(retention_cap_due_at)
          FROM participant_pii_archives
          WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
        ),
        julianday(OLD.purge_due)
      )
    ) > julianday('now');
END;
