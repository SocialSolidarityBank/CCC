import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { AudioObjectMetadata, AudioStoreBinding } from '@ccc/contracts/runtime';
import { createSignerAudioStore } from '../src/index';

const SIGNER_URL = 'https://signer.example.invalid/functions/v1/ccc-storage-signer';
const INSTALLATION_ID = 'install-fixture-1';
const KEY = 'audio/session_01/550e8400-e29b-41d4-a716-446655440000';
const UPLOAD: AudioStoreBinding = { kind: 'upload', audioObjectId: 'audio-1' };
const CLAIM: AudioStoreBinding = { kind: 'claim', jobId: 'job-1', claimToken: 't'.repeat(64), attempt: 1 };
const DELETION: AudioStoreBinding = {
  kind: 'deletion', audioObjectId: 'audio-1', generationId: 'generation-1', deletionAttemptId: 'attempt-1',
};
/** An upload intent the client never completed: the row holds no provider generation yet. */
const PENDING_DELETION: AudioStoreBinding = {
  kind: 'deletion', audioObjectId: 'audio-1', generationId: 'pending:audio-1', deletionAttemptId: 'attempt-1',
};
const METADATA: AudioObjectMetadata = {
  contentLength: 128, contentType: 'audio/wav', expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
type Reply = (action: string) => Response;

function ok(body: Record<string, unknown>, installationId = INSTALLATION_ID): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-ccc-installation-id': installationId },
  });
}

/** Answers each action with the exact contract body, with per-action overrides for the refusals. */
function contractReply(overrides: Record<string, Record<string, unknown>> = {}): Reply {
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const bodies: Record<string, Record<string, unknown>> = {
    upload: {
      action: 'upload', generationId: 'generation-1', expiresAt,
      url: 'https://provider.example.invalid/storage/v1/object/upload/sign/ccc-audio/x?token=t',
    },
    agent_read: {
      action: 'agent_read', generationId: 'generation-1', expiresAt,
      url: 'https://provider.example.invalid/storage/v1/object/sign/ccc-audio/x?token=t',
    },
    head: {
      action: 'head', exists: true, generationId: 'generation-1', contentLength: 128,
      contentType: 'audio/wav', etag: null, lastModified: null,
    },
    delete: { action: 'delete', accepted: true, generationId: 'generation-1' },
    absence: {
      action: 'absence', generationId: 'generation-1', absentFromList: true, absentFromMetadata: true,
      directReadAbsent: true, verifiedAt: new Date().toISOString(),
    },
  };
  return (action) => ok({ ...bodies[action], ...overrides[action] });
}

function store(reply: Reply | (() => Response), authorization: string | null = 'Bearer caller-token') {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), init: init ?? {}, body });
    return reply(String(body.action));
  }) as typeof fetch;
  return {
    calls,
    audio: createSignerAudioStore({
      signerUrl: SIGNER_URL, authorization, installationId: INSTALLATION_ID, fetch: fetchImpl,
    }),
  };
}

/** The adapter's only channel is the failure code, so the assertions read it off the message. */
async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return 'no failure';
}

export function signerAudioStoreContract(): void {
  describe('Signer AudioStore requests', () => {
    it('sends the exact contract body and server-to-server headers for every action', async () => {
      const { audio, calls } = store(contractReply());
      await audio.createUploadTarget(KEY, METADATA, UPLOAD);
      await audio.get(KEY, UPLOAD);
      await audio.createDownloadTarget(KEY, 600, CLAIM);
      await audio.delete(KEY, DELETION);

      expect(calls.map((call) => call.body.action)).toEqual(['upload', 'head', 'agent_read', 'delete', 'absence']);
      // Principal follows the binding alone: upload -> client, claim -> agent, deletion -> scheduler.
      expect(calls.map((call) => call.body.principal)).toEqual(['client', 'client', 'agent', 'scheduler', 'scheduler']);
      expect(calls[0]?.body).toEqual({
        bucket: 'ccc-audio', objectKey: KEY, action: 'upload', principal: 'client',
        objectSha256: null, context: UPLOAD,
      });
      expect(calls[2]?.body.context).toEqual(CLAIM);
      expect(calls[3]?.body.context).toEqual(DELETION);
      for (const call of calls) {
        expect(call.url).toBe(SIGNER_URL);
        expect(call.init.method).toBe('POST');
        expect(call.init.redirect).toBe('error');
        const headers = call.init.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer caller-token');
        expect(headers['content-type']).toBe('application/json');
        expect(headers.accept).toBe('application/json');
        // A browser-shaped request is refused by the Signer, so no Origin is ever sent.
        expect(Object.keys(headers).some((name) => name.toLowerCase() === 'origin')).toBe(false);
      }
    });

    it('never sends the read window and refuses a read target that outlives the ask', async () => {
      const { audio, calls } = store(contractReply({
        agent_read: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      }));
      expect(await failureCode(() => audio.createDownloadTarget(KEY, 600, CLAIM))).toBe('SIGNER_INVALID');
      expect(calls).toHaveLength(1);
      expect(Object.keys(calls[0]!.body).sort())
        .toEqual(['action', 'bucket', 'context', 'objectKey', 'objectSha256', 'principal']);
    });

    it('returns metadata only, with a body that fails on first read', async () => {
      const { audio } = store(contractReply());
      const object = await audio.get(KEY, UPLOAD);
      expect(object).not.toBeNull();
      expect(object!.contentLength).toBe(128);
      expect(object!.contentType).toBe('audio/wav');
      expect(object!.expiresAt).toBeNull();
      expect(object!.sha256).toBeNull();
      expect(object!.generationId).toBe('generation-1');
      await expect(object!.body.getReader().read()).rejects.toThrow('audio body is not proxied');
    });

    it('builds deletion evidence from a fresh absence pass and the shared key hash', async () => {
      const verifiedAt = new Date(Date.now() + 1_000).toISOString();
      const { audio } = store(contractReply({ absence: { verifiedAt, absentFromList: false } }));
      const evidence = await audio.delete(KEY, DELETION);
      expect(evidence.keyHash).toBe(createHash('sha256').update(KEY).digest('hex'));
      expect(evidence).toMatchObject({
        generationId: 'generation-1',
        objectSha256: null,
        deletionAttemptId: 'attempt-1',
        deleteSucceeded: true,
        absentFromList: false,
        absentFromMetadata: true,
        directReadAbsent: true,
        verificationMethod: 'authenticated-get-404',
        verifiedAt,
      });
      expect(evidence.deletedAt).toBe(evidence.providerDeleteAcceptedAt);
      expect(Date.parse(evidence.deletionRequestedAt)).toBeLessThanOrEqual(Date.parse(evidence.deletedAt!));
    });

    it('accepts a null generation only for an unbound pending deletion', async () => {
      const unbound = contractReply({ delete: { generationId: null }, absence: { generationId: null } });
      const pending = store(unbound);
      const evidence = await pending.audio.delete(KEY, PENDING_DELETION);
      expect(evidence.generationId).toBeNull();
      expect(evidence.deleteSucceeded).toBe(true);
      expect(evidence.absentFromList).toBe(true);

      const bound = store(unbound);
      expect(await failureCode(() => bound.audio.delete(KEY, DELETION))).toBe('SIGNER_INVALID');
    });

    it('adopts a refused delete that names another live version instead of throwing', async () => {
      const { audio, calls } = store(contractReply({ delete: { accepted: false, generationId: 'generation-2' } }));
      const evidence = await audio.delete(KEY, DELETION);
      expect(evidence).toMatchObject({
        generationId: 'generation-2',
        deleteSucceeded: false,
        deletedAt: null,
        absentFromList: false,
        absentFromMetadata: false,
        directReadAbsent: false,
        deletionAttemptId: 'attempt-1',
      });
      // The generation the caller asked about is gone, so there is no absence pass to run for it.
      expect(calls.map((call) => call.body.action)).toEqual(['delete']);
    });

    it('answers a missing object with null', async () => {
      const { audio } = store(() => ok({ action: 'head', exists: false, generationId: 'generation-1' }));
      expect(await audio.get(KEY, UPLOAD)).toBeNull();
    });
  });

  describe('Signer AudioStore refusals', () => {
    it('refuses missing and mismatched bindings, and never accepts bytes', async () => {
      const { audio, calls } = store(contractReply());
      await expect(audio.put(KEY, new ReadableStream<Uint8Array>(), METADATA)).rejects
        .toThrow('audio_body_forbidden');
      expect(await failureCode(() => audio.get(KEY))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.get(KEY, CLAIM))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.delete(KEY))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.delete(KEY, UPLOAD))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.createUploadTarget(KEY, METADATA))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.createUploadTarget(KEY, METADATA, DELETION))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.createDownloadTarget(KEY, 600))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.createDownloadTarget(KEY, 600, UPLOAD))).toBe('SIGNER_INVALID');
      // A refused binding never reaches the Signer.
      expect(calls).toHaveLength(0);
    });

    it('refuses an answer that carries another installation id', async () => {
      const reply = contractReply();
      const { audio } = store((action) => new Response(reply(action).body, {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-ccc-installation-id': 'install-other' },
      }));
      expect(await failureCode(() => audio.get(KEY, UPLOAD))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.createUploadTarget(KEY, METADATA, UPLOAD))).toBe('SIGNER_INVALID');
      expect(await failureCode(() => audio.delete(KEY, DELETION))).toBe('SIGNER_INVALID');
    });

    it('propagates failure codes instead of fabricating a result', async () => {
      const denied = store(() => new Response(JSON.stringify({ code: 'AUTHORIZATION_DENIED' }), {
        status: 403, headers: { 'content-type': 'application/json', 'x-ccc-installation-id': INSTALLATION_ID },
      }));
      expect(await failureCode(() => denied.audio.createUploadTarget(KEY, METADATA, UPLOAD))).toBe('SIGNER_DENIED');

      const unavailable = store(() => new Response(JSON.stringify({ code: 'STORAGE_UNAVAILABLE' }), {
        status: 502, headers: { 'content-type': 'application/json', 'x-ccc-installation-id': INSTALLATION_ID },
      }));
      expect(await failureCode(() => unavailable.audio.delete(KEY, DELETION))).toBe('SIGNER_UNAVAILABLE');

      const offline = store(() => { throw new Error('network down'); });
      expect(await failureCode(() => offline.audio.get(KEY, UPLOAD))).toBe('SIGNER_UNAVAILABLE');

      // Without an Authorization there is no caller authority to forward.
      const anonymous = store(contractReply(), null);
      expect(await failureCode(() => anonymous.audio.get(KEY, UPLOAD))).toBe('SIGNER_DENIED');
      expect(anonymous.calls).toHaveLength(0);
    });

    it('refuses answers whose shape is not the contract', async () => {
      const wrongAction = store(() => ok({ action: 'head', exists: false, generationId: 'g' }));
      expect(await failureCode(() => wrongAction.audio.createUploadTarget(KEY, METADATA, UPLOAD)))
        .toBe('SIGNER_INVALID');

      const extraKey = store(() => ok({
        action: 'head', exists: true, generationId: 'generation-1', contentLength: 128,
        contentType: 'audio/wav', etag: null, lastModified: null, storageKey: KEY,
      }));
      expect(await failureCode(() => extraKey.audio.get(KEY, UPLOAD))).toBe('SIGNER_INVALID');

      const badType = store(contractReply({ head: { contentType: 'application/octet-stream' } }));
      expect(await failureCode(() => badType.audio.get(KEY, UPLOAD))).toBe('SIGNER_INVALID');

      const badUrl = store(contractReply({ upload: { url: 'http://provider.example.invalid/x?token=t' } }));
      expect(await failureCode(() => badUrl.audio.createUploadTarget(KEY, METADATA, UPLOAD)))
        .toBe('SIGNER_INVALID');

      const stale = store(contractReply({ upload: { expiresAt: new Date(Date.now() - 1_000).toISOString() } }));
      expect(await failureCode(() => stale.audio.createUploadTarget(KEY, METADATA, UPLOAD))).toBe('SIGNER_INVALID');

      const otherGeneration = store(contractReply({ absence: { generationId: 'generation-2' } }));
      expect(await failureCode(() => otherGeneration.audio.delete(KEY, DELETION))).toBe('SIGNER_INVALID');
    });
  });
}
