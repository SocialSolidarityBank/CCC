import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import type { EntityRegistrationRequest } from '@ccc/contracts/entity-registration';
import type { Actor } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

function request(body: unknown, path = '/pipeline/entity-registrations', actor: Actor = testActors.service) {
  return handleRequest(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), t.env, async () => actor);
}

function validRequest(): EntityRegistrationRequest {
  return {
    family: 'generic',
    jobId: 'job-registration-1',
    claimToken: 'claim-token-1',
    attempt: 1,
    sourceBundleRevision: 'bundle-revision-1',
    expectedMapRevision: 0,
    entries: [{
      kind: 'person',
      sourceValue: '가상인물',
      occurrences: [{ sourceId: 'source-1', sourceRevision: 'source-revision-1', start: 0, end: 4 }],
      entityReference: null,
    }],
  };
}

describe('entity registration HTTP boundary', () => {
  it('rejects unknown nested fields before gateway dispatch', async () => {
    const valid = validRequest();
    const body = {
      ...valid,
      entries: [{
        ...valid.entries[0]!,
        occurrences: [{ ...valid.entries[0]!.occurrences[0]!, unexpected: 'nope' }],
      }],
    };
    const response = await request(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
  });

  it('rejects query parameters and non-service actors without dispatch', async () => {
    const query = await request(validRequest(), '/pipeline/entity-registrations?unexpected=1');
    expect(query.status).toBe(400);

    const human = await request(validRequest(), '/pipeline/entity-registrations', testActors.counselor);
    expect(human.status).toBe(403);
  });

  it('does not accept caller-supplied organization or case scope', async () => {
    const response = await request({ ...validRequest(), orgId: 'attacker-org', supportCaseId: 'attacker-case' });
    expect(response.status).toBe(400);
  });
});
