import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { createLocalIdentityRepository } from '@ccc/secrets-dpapi';
import type { SingleEndpointRecord } from '@ccc/contracts/install-manifest';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import { resolveLocalDirectoryActor } from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { createLocalSingleIdentity, type LocalSingleIdentity } from './identity.ts';
import { authBody, closeLocalServer, localError, localRequest, sendLocalResponse, trackLocalRequests, type LocalRequestTracker } from './http-transport.ts';
import { LocalAuthError } from './office-identity.ts';
import { openLocalResources, verifyLocalInstallation, type LocalRuntimeConfig, type LocalRuntimeResources } from './runtime-resources.ts';

export interface LocalSingleRuntimeConfig extends LocalRuntimeConfig {
  generation: number;
  identityHash: string;
}
export interface LocalSingleRuntime {
  readonly port: number;
  readonly installationId: string;
  close(): Promise<void>;
}

export async function createLocalSingleRuntime(config: LocalSingleRuntimeConfig): Promise<LocalSingleRuntime> {
  if (process.platform !== 'win32') throw new Error('platform_unsupported');
  const manifest = await verifyLocalInstallation(config, 'local-single');
  const repository = await createLocalIdentityRepository(join(config.dataPath, 'identity'));
  const install = await repository.readSingle(config.generation, config.identityHash);
  let resources: LocalRuntimeResources | undefined;
  let identity: LocalSingleIdentity | undefined, server: Server | undefined;
  let requests: LocalRequestTracker | undefined;
  try {
    if (install.installationId !== manifest.installationId || install.orgId !== config.orgId || manifest.sequence < install.sequence) throw new Error('installation_invalid');
    resources = await openLocalResources(config, manifest);
    const { baseEnv } = resources;
    identity = createLocalSingleIdentity({
      install,
      resolveActor: (sessionId, issuedAt) => resolveLocalDirectoryActor(baseEnv, install.orgId, install.stableUserId, {
        source: 'single-local-bearer', assurance: 'app-lock', sessionId,
      }, issuedAt),
    });
    const localIdentity = identity;
    let port = 0;
    requests = trackLocalRequests(async (req, res) => {
      let response: Response;
      try {
        const request = localRequest(req, `http://127.0.0.1:${port}`, manifest);
        const path = new URL(request.url).pathname;
        if (path === '/auth/challenge' || path === '/auth/unlock') {
          // Electron main only: loopback transport plus DPAPI possession, never a renderer Origin.
          if (request.method !== 'POST' || req.socket.remoteAddress !== '127.0.0.1'
            || request.headers.has('origin') || request.headers.get('x-ccc-install-id') !== manifest.installationId) throw new ActorAuthenticationError();
          const body = await authBody(request);
          if (path === '/auth/challenge') {
            if (Object.keys(body).length !== 0) throw new LocalAuthError('invalid_request', 400);
            response = Response.json({ challenge: localIdentity.challenge() });
          } else {
            if (Object.keys(body).sort().join(',') !== 'challenge,password,proof'
              || typeof body.challenge !== 'string' || typeof body.proof !== 'string' || typeof body.password !== 'string') throw new LocalAuthError('invalid_request', 400);
            const password = new TextEncoder().encode(body.password);
            delete body.password;
            response = Response.json(await localIdentity.unlock(body.challenge, body.proof, password));
          }
        } else if (path === '/auth/lock' && request.method === 'POST') {
          await localIdentity.resolve(request);
          if (Object.keys(await authBody(request)).length !== 0) throw new LocalAuthError('invalid_request', 400);
          localIdentity.lock();
          response = new Response(null, { status: 204 });
        } else if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
        else response = await handleRequest(request, baseEnv, (next) => localIdentity.resolve(next));
      } catch (error) { response = localError(error); }
      try { await sendLocalResponse(req, res, response, manifest); } catch { res.destroy(); }
    });
    server = createServer(requests.handle);
    const listening = Promise.withResolvers<void>();
    server.once('error', listening.reject);
    server.listen(0, '127.0.0.1', listening.resolve);
    await listening.promise;
    const address = server.address();
    if (address === null || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('server_bind_failed');
    port = address.port;
    await repository.writeEndpoint({ installationId: manifest.installationId, port });
    const opened = resources;
    let closing: Promise<void> | undefined;
    return {
      port, installationId: manifest.installationId,
      close() {
        closing ??= (async () => {
          localIdentity.close();
          await closeLocalServer(server, requests);
          await opened.close();
        })().catch((error) => { closing = undefined; throw error; });
        return closing;
      },
    };
  } catch (error) {
    identity?.close();
    await closeLocalServer(server, requests);
    await resources?.close();
    throw error;
  } finally { install.handshakeKey.fill(0); }
}

/** Endpoint discovery remains DPAPI protected and bound to the expected installation. */
export async function readEndpointRecord(dataPath: string, installationId: string): Promise<SingleEndpointRecord> {
  const repository = await createLocalIdentityRepository(join(dataPath, 'identity'));
  return repository.readEndpoint(installationId);
}
