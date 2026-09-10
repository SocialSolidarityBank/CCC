/**
 * E8-1 OfficeAccountStore implementation backed by encrypted SQLite.
 * Stores Argon2id password hashes and lockout state per S4 §2.2.
 */
import type { Database } from '@ccc/contracts/database';
import type { OfficeAccountStore, OfficeAccountRecord } from './office-identity.ts';
import type { ActorRole } from '@ccc/contracts/runtime';

/**
 * Create an OfficeAccountStore backed by the encrypted SQLite database.
 * The database must have the office_accounts table from migration 0057.
 */
export function createOfficeAccountStore(db: Database): OfficeAccountStore {
  return {
    async getByUsername(username: string): Promise<OfficeAccountRecord | null> {
      const stmt = db.prepare(`
        SELECT user_id, username, password_hash, salt, roles, mfa_secret,
               mfa_required, enabled, failed_attempts, locked_until, created_at
        FROM office_accounts
        WHERE username = ?
      `);
      const row = await stmt.bind(username).first<OfficeAccountRow>();
      return row ? rowToRecord(row) : null;
    },

    async getById(userId: string): Promise<OfficeAccountRecord | null> {
      const stmt = db.prepare(`
        SELECT user_id, username, password_hash, salt, roles, mfa_secret,
               mfa_required, enabled, failed_attempts, locked_until, created_at
        FROM office_accounts
        WHERE user_id = ?
      `);
      const row = await stmt.bind(userId).first<OfficeAccountRow>();
      return row ? rowToRecord(row) : null;
    },

    async updateFailedAttempts(
      userId: string,
      attempts: number,
      lockedUntil: string | null,
    ): Promise<void> {
      const stmt = db.prepare(`
        UPDATE office_accounts
        SET failed_attempts = ?, locked_until = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ?
      `);
      await stmt.bind(attempts, lockedUntil, userId).run();
    },

    async updateLastLogin(userId: string): Promise<void> {
      const stmt = db.prepare(`
        UPDATE office_accounts
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = ?
      `);
      await stmt.bind(userId).run();
    },
  };
}

interface OfficeAccountRow {
  user_id: string;
  username: string;
  password_hash: string;
  salt: string;
  roles: string;
  mfa_secret: string | null;
  mfa_required: number;
  enabled: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

function rowToRecord(row: OfficeAccountRow): OfficeAccountRecord {
  let roles: ActorRole[];
  try {
    roles = JSON.parse(row.roles) as ActorRole[];
  } catch {
    roles = [];
  }

  return {
    userId: row.user_id,
    username: row.username,
    passwordHash: row.password_hash,
    salt: row.salt,
    roles,
    mfaSecret: row.mfa_secret,
    mfaRequired: row.mfa_required !== 0,
    enabled: row.enabled !== 0,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  };
}

/**
 * Create an account in the store. For initial setup / admin provisioning.
 */
export async function createOfficeAccount(
  db: Database,
  account: Omit<OfficeAccountRecord, 'failedAttempts' | 'lockedUntil' | 'createdAt'>,
): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO office_accounts (
      user_id, username, password_hash, salt, roles,
      mfa_secret, mfa_required, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await stmt.bind(
    account.userId,
    account.username,
    account.passwordHash,
    account.salt,
    JSON.stringify(account.roles),
    account.mfaSecret,
    account.mfaRequired ? 1 : 0,
    account.enabled ? 1 : 0,
  ).run();
}
