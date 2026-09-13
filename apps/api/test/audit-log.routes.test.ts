import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';
import { createCase } from '@ccc/core/gateway';
import { registrationInput } from './support/registration';

const adminHeaders = {
  'X-CCC-User-Id': 'admin.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'admin',
};
const counselorHeaders = {
  'X-CCC-User-Id': 'counselor.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'counselor',
};
const t = setupD1();

describe('GET /audit-log', () => {
  it('returns redacted descending pages with an opaque cursor', async () => {
    await t.reset();
    await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
    await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));

    const first = await worker.fetch(new Request('http://localhost/audit-log?limit=1', { headers: adminHeaders }), t.env);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(firstBody.items[0]).not.toHaveProperty('targetId');
    expect(firstBody.items[0]).not.toHaveProperty('detail');
    expect(firstBody.items[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      actorId: expect.any(String),
      actorRole: expect.any(String),
      action: expect.any(String),
      targetTable: expect.any(String),
      createdAt: expect.any(String),
    }));

    const second = await worker.fetch(new Request(
      `http://localhost/audit-log?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
      { headers: adminHeaders },
    ), t.env);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { items: Array<{ id: number }> };
    expect(secondBody.items[0]!.id).toBeLessThan(firstBody.items[0]!.id as number);
  });

  it('rejects unsupported or repeated query keys and non-admin readers', async () => {
    await t.reset();
    const unknown = await worker.fetch(new Request('http://localhost/audit-log?unexpected=1', { headers: adminHeaders }), t.env);
    expect(unknown.status).toBe(400);
    const repeated = await worker.fetch(new Request('http://localhost/audit-log?limit=1&limit=2', { headers: adminHeaders }), t.env);
    expect(repeated.status).toBe(400);
    const counselor = await worker.fetch(new Request('http://localhost/audit-log', { headers: counselorHeaders }), t.env);
    expect(counselor.status).toBe(403);
  });
});
