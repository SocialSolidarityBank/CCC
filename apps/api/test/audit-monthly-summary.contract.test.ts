import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import type { Actor } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const { admin, counselor, service, otherOrgAdmin } = testActors;

beforeEach(async () => { await t.reset(); });

function http(actor: Actor, query = 'month=2024-02') {
  return handleRequest(new Request(`http://localhost/audit-log/monthly-summary?${query}`), t.env, async () => actor);
}

async function event(action: string, createdAt: string, actor: Actor = admin, targetTable = 'sessions') {
  await t.db.prepare(`INSERT INTO audit_log
    (org_id, actor_id, actor_role, action, target_table, target_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, 'AUDIT_TARGET_CANARY', ?, ?)`)
    .bind(actor.orgId, actor.userId, actor.role, action, targetTable,
      JSON.stringify({ content: 'AUDIT_DETAIL_CANARY' }), createdAt).run();
}

async function summary(actor: Actor = admin) {
  const response = await http(actor);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return response.json();
}

describe('monthly audit summary', () => {
  it('counts stored events within the actor institution without guessing historical assignments', async () => {
    await event('read', '2024-02-01T00:00:00.000Z');
    await event('read_participant_pii', '2024-02-02T00:00:00.000Z', admin, 'participant_pii_vault');
    await event('decrypt_pii', '2024-02-03T00:00:00.000Z', admin, 'pii_vault');
    await event('export', '2024-02-04T00:00:00.000Z');
    await event('create', '2024-02-05T00:00:00.000Z');
    await event('read', '2024-02-06T00:00:00.000Z', service);
    await event('export', '2024-02-07T00:00:00.000Z', otherOrgAdmin);
    const body = await summary();
    expect(body).toEqual({
      month: '2024-02', timeZone: 'Asia/Seoul',
      startUtc: '2024-01-31T15:00:00.000Z', endUtc: '2024-02-29T15:00:00.000Z',
      nonAssignedReadEvents: null, unclassifiedReadEvents: 3, piiDecryptEvents: 2, exportEvents: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/AUDIT_|example\.invalid/);
    expect(await summary(otherOrgAdmin)).toMatchObject({
      timeZone: 'UTC', unclassifiedReadEvents: 0, piiDecryptEvents: 0, exportEvents: 1,
    });
  });

  it('does not create audit events or increase counts on repeated reads', async () => {
    // Use the current month so an accidental self-audit would fall in the queried interval.
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format();
    const before = await t.db.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>();
    const first = await http(admin, `month=${month}`);
    expect(first.status).toBe(200);
    const second = await http(admin, `month=${month}`);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).toEqual(before);
  });

  it('requires a live institution-admin grant, not a technical role or stale actor claim', async () => {
    for (const actor of [counselor, service, { ...admin, orgId: otherOrgAdmin.orgId }]) {
      expect((await http(actor)).status).toBe(403);
    }
    await t.db.prepare(`UPDATE user_role_assignments SET revoked_at = '2024-01-01T00:00:00.000Z'
      WHERE user_id = ? AND org_id = ? AND role = 'institution_admin'`)
      .bind(admin.userId, admin.orgId).run();
    expect((await http(admin)).status).toBe(403);
  });

  it.each([
    ['2024-02', 'Asia/Seoul', '2024-01-31T15:00:00.000Z', '2024-02-29T15:00:00.000Z'],
    ['2025-02', 'Asia/Seoul', '2025-01-31T15:00:00.000Z', '2025-02-28T15:00:00.000Z'],
    ['2024-12', 'UTC', '2024-12-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
    ['2024-03', 'America/New_York', '2024-03-01T05:00:00.000Z', '2024-04-01T04:00:00.000Z'],
  ])('uses institution month boundaries for %s in %s, regardless of the user timezone', async (month, timeZone, startUtc, endUtc) => {
    await t.db.prepare('UPDATE organization_settings SET time_zone = ? WHERE org_id = ?').bind(timeZone, admin.orgId).run();
    await t.db.prepare("UPDATE users SET time_zone = 'Pacific/Honolulu' WHERE id = ?").bind(admin.userId).run();
    for (const at of [new Date(Date.parse(startUtc) - 1).toISOString(), startUtc,
      new Date(Date.parse(endUtc) - 1).toISOString(), endUtc]) {
      await event('export', at);
    }
    const response = await http(admin, `month=${month}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ month, timeZone, startUtc, endUtc, exportEvents: 2 });
  });

  it('rejects invalid months and query-based institution overrides', async () => {
    for (const query of ['', 'month=2024-2', 'month=2024-13', 'month=2024-02-01',
      'month=2024-02&month=2024-03', 'month=2024-02&orgId=org_other']) {
      expect((await http(admin, query)).status).toBe(400);
    }
  });
});
