-- Migration 0040 - D74 independent institution roles and team supervision scope.
--
-- users.role remains the deployed identity compatibility field for this first
-- authorization slice. Independent human roles live in user_role_assignments.
-- Legacy admin rows receive institution_admin + institution_technical_admin;
-- legacy counselor rows receive practitioner. Service identities receive no
-- human role assignment.

PRAGMA foreign_keys = ON;

CREATE TABLE user_role_assignments (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id),
  role       TEXT NOT NULL CHECK (role IN (
               'institution_admin',
               'institution_technical_admin',
               'practitioner'
             )),
  source     TEXT NOT NULL CHECK (source IN ('legacy', 'manual')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  CHECK (
    (source = 'legacy' AND granted_by IS NULL)
    OR
    (source = 'manual' AND granted_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_user_role_assignments_active
  ON user_role_assignments (org_id, user_id, role)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_user_role_assignments_role
  ON user_role_assignments (org_id, role, user_id)
  WHERE revoked_at IS NULL;

INSERT INTO user_role_assignments (
  id, org_id, user_id, role, source, granted_by, granted_at
)
SELECT
  'legacy:' || id || ':institution_admin',
  org_id,
  id,
  'institution_admin',
  'legacy',
  NULL,
  created_at
FROM users
WHERE role = 'admin';

INSERT INTO user_role_assignments (
  id, org_id, user_id, role, source, granted_by, granted_at
)
SELECT
  'legacy:' || id || ':institution_technical_admin',
  org_id,
  id,
  'institution_technical_admin',
  'legacy',
  NULL,
  created_at
FROM users
WHERE role = 'admin';

INSERT INTO user_role_assignments (
  id, org_id, user_id, role, source, granted_by, granted_at
)
SELECT
  'legacy:' || id || ':practitioner',
  org_id,
  id,
  'practitioner',
  'legacy',
  NULL,
  created_at
FROM users
WHERE role = 'counselor';

CREATE TRIGGER user_role_assignments_insert_guard
BEFORE INSERT ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id
      AND org_id = NEW.org_id
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NEW.source = 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.user_id
        AND org_id = NEW.org_id
        AND active = 1
        AND role IN ('admin', 'counselor')
    );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NEW.source = 'manual'
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS grantor_role
      JOIN users AS grantor ON grantor.id = grantor_role.user_id
      WHERE grantor_role.org_id = NEW.org_id
        AND grantor_role.user_id = NEW.granted_by
        AND grantor_role.role = 'institution_admin'
        AND grantor_role.revoked_at IS NULL
        AND grantor.org_id = NEW.org_id
        AND grantor.active = 1
    );
END;

CREATE TRIGGER user_role_assignments_immutable_guard
BEFORE UPDATE OF id, org_id, user_id, role, source, granted_by, granted_at
ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignment_immutable');
END;

CREATE TRIGGER user_role_assignments_revoke_guard
BEFORE UPDATE OF revoked_at ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignment_immutable')
  WHERE OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL;

  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE OLD.role IN ('institution_admin', 'institution_technical_admin')
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = OLD.role
        AND replacement.id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );
END;

CREATE TRIGGER user_role_assignments_no_delete
BEFORE DELETE ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignments_are_append_only');
END;

CREATE TRIGGER users_seed_independent_roles_after_insert
AFTER INSERT ON users
WHEN NEW.role IN ('admin', 'counselor')
BEGIN
  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_admin',
    'legacy',
    NULL,
    NEW.created_at
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_technical_admin',
    'legacy',
    NULL,
    NEW.created_at
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'practitioner',
    'legacy',
    NULL,
    NEW.created_at
  WHERE NEW.role = 'counselor';
END;

CREATE TRIGGER users_sync_independent_roles_after_role_update
AFTER UPDATE OF role ON users
WHEN NEW.role IS NOT OLD.role
BEGIN
  UPDATE user_role_assignments
  SET revoked_at = datetime('now')
  WHERE org_id = NEW.org_id
    AND user_id = NEW.id
    AND source = 'legacy'
    AND revoked_at IS NULL;

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_admin',
    'legacy',
    NULL,
    datetime('now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_technical_admin',
    'legacy',
    NULL,
    datetime('now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'practitioner',
    'legacy',
    NULL,
    datetime('now')
  WHERE NEW.role = 'counselor';
END;

CREATE TRIGGER users_last_required_roles_guard
BEFORE UPDATE OF active ON users
WHEN OLD.active = 1 AND NEW.active = 0
BEGIN
  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );

  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_technical_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_technical_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );
END;

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by  TEXT NOT NULL REFERENCES users (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_teams_org
  ON teams (org_id, archived_at, name);

CREATE TRIGGER teams_insert_guard
BEFORE INSERT ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS creator_role
    JOIN users AS creator ON creator.id = creator_role.user_id
    WHERE creator_role.org_id = NEW.org_id
      AND creator_role.user_id = NEW.created_by
      AND creator_role.role = 'institution_admin'
      AND creator_role.revoked_at IS NULL
      AND creator.org_id = NEW.org_id
      AND creator.active = 1
  );
END;

CREATE TRIGGER teams_immutable_guard
BEFORE UPDATE OF id, org_id, name, created_by, created_at ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_immutable');
END;

CREATE TRIGGER teams_archive_guard
BEFORE UPDATE OF archived_at ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_immutable')
  WHERE OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL;
END;

CREATE TRIGGER teams_no_delete
BEFORE DELETE ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_teams_are_append_only');
END;

CREATE TABLE team_memberships (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  team_id    TEXT NOT NULL REFERENCES teams (id),
  user_id    TEXT NOT NULL REFERENCES users (id),
  added_by   TEXT NOT NULL REFERENCES users (id),
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

CREATE UNIQUE INDEX uq_team_memberships_active
  ON team_memberships (org_id, team_id, user_id)
  WHERE ended_at IS NULL;
CREATE INDEX idx_team_memberships_user
  ON team_memberships (org_id, user_id, team_id)
  WHERE ended_at IS NULL;

CREATE TRIGGER team_memberships_insert_guard
BEFORE INSERT ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = NEW.team_id
      AND org_id = NEW.org_id
      AND archived_at IS NULL
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS member_role
    JOIN users AS member ON member.id = member_role.user_id
    WHERE member_role.org_id = NEW.org_id
      AND member_role.user_id = NEW.user_id
      AND member_role.role = 'practitioner'
      AND member_role.revoked_at IS NULL
      AND member.org_id = NEW.org_id
      AND member.active = 1
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS grantor_role
    JOIN users AS grantor ON grantor.id = grantor_role.user_id
    WHERE grantor_role.org_id = NEW.org_id
      AND grantor_role.user_id = NEW.added_by
      AND grantor_role.role = 'institution_admin'
      AND grantor_role.revoked_at IS NULL
      AND grantor.org_id = NEW.org_id
      AND grantor.active = 1
  );
END;

CREATE TRIGGER team_memberships_immutable_guard
BEFORE UPDATE OF id, org_id, team_id, user_id, added_by, joined_at
ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_membership_immutable');
END;

CREATE TRIGGER team_memberships_end_guard
BEFORE UPDATE OF ended_at ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_membership_immutable')
  WHERE OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL;
END;

CREATE TRIGGER team_memberships_no_delete
BEFORE DELETE ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_memberships_are_append_only');
END;

CREATE TABLE team_supervisor_grants (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  team_id            TEXT NOT NULL REFERENCES teams (id),
  supervisor_user_id TEXT NOT NULL REFERENCES users (id),
  granted_by         TEXT NOT NULL REFERENCES users (id),
  granted_at         TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at         TEXT
);

CREATE UNIQUE INDEX uq_team_supervisor_grants_active
  ON team_supervisor_grants (org_id, team_id, supervisor_user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_team_supervisor_grants_supervisor
  ON team_supervisor_grants (org_id, supervisor_user_id, team_id)
  WHERE revoked_at IS NULL;

CREATE TRIGGER team_supervisor_grants_insert_guard
BEFORE INSERT ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = NEW.team_id
      AND org_id = NEW.org_id
      AND archived_at IS NULL
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.supervisor_user_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS grantor_role
    JOIN users AS grantor ON grantor.id = grantor_role.user_id
    WHERE grantor_role.org_id = NEW.org_id
      AND grantor_role.user_id = NEW.granted_by
      AND grantor_role.role = 'institution_admin'
      AND grantor_role.revoked_at IS NULL
      AND grantor.org_id = NEW.org_id
      AND grantor.active = 1
  );
END;

CREATE TRIGGER team_supervisor_grants_immutable_guard
BEFORE UPDATE OF id, org_id, team_id, supervisor_user_id, granted_by, granted_at
ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grant_immutable');
END;

CREATE TRIGGER team_supervisor_grants_revoke_guard
BEFORE UPDATE OF revoked_at ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grant_immutable')
  WHERE OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL;
END;

CREATE TRIGGER team_supervisor_grants_no_delete
BEFORE DELETE ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grants_are_append_only');
END;
