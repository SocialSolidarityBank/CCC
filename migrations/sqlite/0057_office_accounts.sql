-- Local Office accounts table for Argon2id authentication
-- S4 §2.2: accounts stored in DPAPI-encrypted SQLite

CREATE TABLE office_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,  -- Base64url Argon2id hash
  salt TEXT NOT NULL,           -- Base64url 16-byte salt
  roles TEXT NOT NULL,          -- JSON array of ActorRole
  mfa_secret TEXT,              -- Base32 TOTP secret, NULL if not enrolled
  mfa_required INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,            -- ISO timestamp or NULL
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX office_accounts_username ON office_accounts(username);
CREATE INDEX office_accounts_locked ON office_accounts(locked_until) WHERE locked_until IS NOT NULL;
