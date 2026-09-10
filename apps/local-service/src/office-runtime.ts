import { createServer, type Server } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { createLocalIdentityRepository } from '@ccc/secrets-dpapi';
import { createLocalOfficeAccountStore } from '@ccc/core/gateway';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import { handleRequest } from '@ccc/http-api';
import { createLocalOfficeIdentity, LocalAuthError, type LocalOfficeIdentity } from './office-identity.ts';
import { verifyOfficeTlsIdentity } from './office-tls.ts';
import { validateBindAddress } from './bind-validation.ts';
import { authBody, closeLocalServer, localError, localRequest, sendLocalResponse } from './http-transport.ts';
import { openLocalResources, verifyLocalInstallation, type LocalRuntimeConfig, type LocalRuntimeResources } from './runtime-resources.ts';

export interface LocalOfficeRuntimeConfig extends LocalRuntimeConfig {
  bindHost: string;
  privateCidr: string;
  tlsCertPath: string;
  tlsCaPath: string;
}
export interface LocalOfficeRuntime {
  readonly port: number;
  readonly host: string;
  readonly installationId: string;
  close(): Promise<void>;
}

export async function createLocalOfficeRuntime(config: LocalOfficeRuntimeConfig): Promise<LocalOfficeRuntime> {
  if (process.platform !== 'win32') throw new Error('platform_unsupported');
  const manifest = await verifyLocalInstallation(config, 'local-office');
  validateBindAddress(config.bindHost, config.privateCidr);
  const repository = await createLocalIdentityRepository(join(config.dataPath, 'identity'));
  const tlsKey = await repository.readOfficeTlsKey();
  let resources: LocalRuntimeResources | undefined, identity: LocalOfficeIdentity | undefined, server: Server | undefined;
  let pemKey: Buffer | undefined;
  try {
    const [certificate, ca] = await Promise.all([readFile(config.tlsCertPath, 'utf8'), readFile(config.tlsCaPath, 'utf8')]);
    await verifyOfficeTlsIdentity({ manifest, bindHost: config.bindHost, privateCidr: config.privateCidr, certificate, ca, privateKey: tlsKey });
    resources = await openLocalResources(config, manifest);
    const { baseEnv } = resources;
    identity = createLocalOfficeIdentity({ orgId: config.orgId, accountStore: createLocalOfficeAccountStore(baseEnv, config.orgId) });
    const localIdentity = identity;
    // Server identity was verified above. Client certificates are not the human authentication mechanism.
    const privateKey = createPrivateKey({ key: Buffer.from(tlsKey.buffer, tlsKey.byteOffset, tlsKey.byteLength), format: 'der', type: 'pkcs8' });
    pemKey = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    server = createServer({ cert: certificate, key: pemKey, minVersion: 'TLSv1.2', requestCert: false }, async (req, res) => {
      let response: Response;
      try {
        const request = localRequest(req, manifest.apiBase, manifest);
        const path = new URL(request.url).pathname;
        if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
        else if (path.startsWith('/api/auth/')) {
          if (request.method !== 'POST' || new URL(request.url).search !== '') throw new LocalAuthError('invalid_request', 400);
          const body = await authBody(request);
          if (path === '/api/auth/login') {
            if (Object.keys(body).sort().join(',') !== 'password,username' || typeof body.username !== 'string' || typeof body.password !== 'string') throw new LocalAuthError('invalid_request', 400);
            const password = new TextEncoder().encode(body.password);
            delete body.password;
            const result = await localIdentity.login(body.username, password);
            response = Response.json({ bearer: result.bearer, sessionId: result.sessionId, mfaRequired: result.mfaRequired });
          } else {
            const authorization = request.headers.get('authorization');
            if (authorization === null || !/^Bearer [^\s]+$/i.test(authorization)) throw new ActorAuthenticationError();
            const bearer = authorization.slice(7);
            if (path === '/api/auth/mfa') {
              if (Object.keys(body).join(',') !== 'code' || typeof body.code !== 'string') throw new LocalAuthError('invalid_request', 400);
              await localIdentity.verifyMfa(bearer, body.code);
              response = new Response(null, { status: 204 });
            } else if (path === '/api/auth/logout') {
              if (Object.keys(body).length !== 0) throw new LocalAuthError('invalid_request', 400);
              await localIdentity.logout(bearer);
              response = new Response(null, { status: 204 });
            } else response = Response.json({ error: 'not_found' }, { status: 404 });
          }
        } else response = await handleRequest(request, baseEnv, (next) => localIdentity.resolve(next));
      } catch (error) { response = localError(error); }
      try { await sendLocalResponse(req, res, response, manifest); } catch { res.destroy(); }
    });
    const listening = Promise.withResolvers<void>();
    server.once('error', listening.reject);
    server.listen(8443, config.bindHost, listening.resolve);
    await listening.promise;
    const opened = resources;
    return {
      port: 8443, host: config.bindHost, installationId: manifest.installationId,
      async close() {
        localIdentity.close();
        try { await closeLocalServer(server); } finally { await opened.close(); }
      },
    };
  } catch (error) {
    identity?.close();
    try { await closeLocalServer(server); } finally { await resources?.close(); }
    throw error;
  } finally { tlsKey.fill(0); pemKey?.fill(0); }
}
