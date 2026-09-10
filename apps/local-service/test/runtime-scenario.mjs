import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto';
import { networkInterfaces, tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import { createDpapiSecretStore, createLocalIdentityRepository } from '@ccc/secrets-dpapi';
import { createProtectedRecordRepository } from '@ccc/secrets-dpapi/records';
import { sealRecoveryKit, openRecoveryKit, wipeCbor } from '@ccc/secrets-dpapi/recovery-kit';
import { signInstallManifest, InstallManifestError } from '@ccc/contracts/install-manifest';
import { createOfficeAccount, decodeOfficeTotpSecret } from '@ccc/core/gateway';
import { startLocalSingle, startLocalOffice, stageNewSingleIdentity, loadLocalMigrations } from '../src/main.ts';
import { readEndpointRecord } from '../src/runtime.ts';
import { hashPassword } from '../src/office-identity.ts';
import { parseIPv4, isRfc1918 } from '../src/bind-validation.ts';
import { verifyOfficeTlsIdentity } from '../src/office-tls.ts';
import { syntheticOfficeTls } from './synthetic-tls.mjs';
import { scenarioDiagnostics } from './scenario-diagnostics.mjs';

const PASSWORD = 'Synthetic local runtime passphrase';
const MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
function totp() {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const secret = decodeOfficeTotpSecret(MFA_SECRET); assert.ok(secret);
  try {
    const digest = createHmac('sha1', secret).update(counter).digest();
    return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  } finally { secret.fill(0); }
}
function lan() {
  const hostArg = process.argv.find((argument) => argument.startsWith('--office-host='))?.slice(14);
  const cidrArg = process.argv.find((argument) => argument.startsWith('--office-cidr='))?.slice(14);
  if (hostArg && cidrArg) return { host: hostArg, cidr: cidrArg };
  for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
    if (entry.family !== 'IPv4' || entry.internal || !isRfc1918(entry.address)) continue;
    const mask = parseIPv4(entry.netmask), address = parseIPv4(entry.address);
    const network = (mask & address) >>> 0;
    const host = entry.address;
    const cidr = `${[24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.')}/${entry.cidr.split('/')[1]}`;
    return { host, cidr };
  }
  throw new Error('private_interface_required');
}
async function exchange(base, path, { method = 'GET', body, bearer, ca, headers = {} } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const result = Promise.withResolvers();
  const request = (base.startsWith('https:') ? httpsRequest : httpRequest)(new URL(path, base), {
    method, ...(ca ? { ca, rejectUnauthorized: true } : {}),
    headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
  }, async (response) => {
    try {
      const chunks = []; for await (const chunk of response) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      result.resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
    } catch { result.reject(new Error('response_invalid')); }
  });
  request.once('error', () => result.reject(new Error('transport_failed')));
  request.setTimeout(10_000, () => request.destroy(new Error('request_timeout')));
  request.end(payload);
  return result.promise;
}

export async function runRuntimeScenario(root, report) {
  const migrationsPath = join(root, 'migrations/sqlite');
  const migrations = await loadLocalMigrations(migrationsPath);
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const signingKeys = { publicKeys: { synthetic: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64') } };
  const network = lan();
  report.fixture = { kind: 'synthetic-only', officeBind: network.host, officeCidr: network.cidr, storage: 'encrypted-sqlite-and-current-user-dpapi' };
  async function stage(mode, name, operation) {
    const item = { mode, stage: name, verdict: 'RUNNING' }; report.stages.push(item);
    try { const value = await operation(); item.verdict = 'PASS'; return value; }
    catch (error) { item.verdict = 'FAIL'; item.diagnostic = scenarioDiagnostics(error); throw error; }
  }
  for (const mode of ['local-single', 'local-office']) {
    const dataPath = await mkdtemp(join(tmpdir(), 'ccc-runtime-scenario-'));
    const installationId = randomUUID(), orgId = randomUUID();
    const apiBase = mode === 'local-single' ? 'http://127.0.0.1' : `https://${network.host}:8443`;
    const unsigned = {
      schemaVersion: 1, mode, apiBase, clientOrigin: mode === 'local-single' ? 'ccc://app' : apiBase,
      allowedOrigins: [mode === 'local-single' ? 'ccc://app' : apiBase], host: mode === 'local-single' ? '127.0.0.1' : network.host,
      scheme: mode === 'local-single' ? 'ccc' : 'https', endpointDiscovery: mode === 'local-single' ? 'dpapi-record' : 'static',
      installationId, sequence: 1, publishedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      approvedSttEngineIds: [], supabaseProjectRef: null, supabaseAuthOrigin: null, supabasePublishableKey: null, signingKeyId: 'synthetic',
    };
    const manifest = await signInstallManifest(unsigned, pair.privateKey);
    const common = { dataPath, orgId, installationId, minSequence: 1, installManifest: JSON.stringify(manifest), signingKeys, generation: 1, migrationsPath };
    let userId = randomUUID(), identityHash;
    if (mode === 'local-single') {
      const installed = await stageNewSingleIdentity(common, new TextEncoder().encode(PASSWORD));
      userId = installed.stableUserId; identityHash = installed.identityHash;
      await stage(mode, 'reinitialization-rejected-and-original-identity-preserved', async () => {
        const repository = await createLocalIdentityRepository(join(dataPath, 'identity'));
        for (const generation of [1, 2]) {
          await assert.rejects(stageNewSingleIdentity({ ...common, generation }, new TextEncoder().encode(PASSWORD)),
            (error) => error.message === 'single_identity_already_exists');
        }
        await assert.rejects(stat(join(dataPath, 'identity/generation-2')), (error) => error.code === 'ENOENT');
        const original = await repository.readSingle(1, identityHash);
        try { assert.equal(original.stableUserId, userId); }
        finally { original.handshakeKey.fill(0); }
      });
    }
    const otherUser = randomUUID(), technician = randomUUID();
    const key = new Uint8Array(randomBytes(32)), fileKey = new Uint8Array(randomBytes(32)), piiKey = new Uint8Array(randomBytes(32));
    const dpapi = createDpapiSecretStore(mode, []);
    const records = [dpapi.protect('DB_MASTER_KEY', { bytes: key, version: 1 }), dpapi.protect('FILE_ENC_KEY', { bytes: fileKey, version: 1 }), dpapi.protect('PII_ENC_KEY', { bytes: piiKey, version: 1 })];
    const secrets = await createProtectedRecordRepository(join(dataPath, 'secrets'), mode);
    const recordsHash = await secrets.stage(1, records);
    records.forEach((record) => record.blob.fill(0)); dpapi.close(); fileKey.fill(0);
    const database = openEncryptedSqlite({ filename: join(dataPath, 'database.sqlite'), key });
    let runtime, tls;
    try {
      database.applyMigrations(migrations);
      // Contract harness seeds only installed directory state. All business creation below is HTTP.
      await database.prepare('INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES (?, ?, ?)').bind(orgId, 'Asia/Seoul', 365).run();
      await database.prepare("INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode) VALUES (?, 1, 'off', 'off')").bind(orgId).run();
      for (const [id, role] of [[userId, 'admin'], [otherUser, 'counselor'], [technician, 'admin']]) {
        await database.prepare('INSERT INTO users (id, org_id, email, role, active) VALUES (?, ?, NULL, ?, 1)').bind(id, orgId, role).run();
      }
      await database.prepare(`INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`)
        .bind(randomUUID(), orgId, userId, userId).run();
      await database.prepare(`UPDATE user_role_assignments SET revoked_at = ? WHERE user_id = ? AND role = 'institution_admin' AND revoked_at IS NULL`)
        .bind(new Date().toISOString(), technician).run();
      const env = { DB: database, installationMode: mode, secretStore: { async get() { return null; }, async getBytesWithVersion() { return { bytes: new Uint8Array(piiKey), version: 1 }; } } };
      if (mode === 'local-office') {
        for (const [id, username, mfa] of [[userId, 'admin', true], [otherUser, 'worker', false], [technician, 'technician', true]]) {
          const verifier = await hashPassword(new TextEncoder().encode(PASSWORD));
          await createOfficeAccount(env, { userId, orgId, role: 'admin' }, {
            userId: id, username, passwordHash: verifier.hash, salt: verifier.salt, mfaSecret: mfa ? MFA_SECRET : null, mfaRequired: mfa, enabled: true,
          });
        }
        tls = syntheticOfficeTls(network.host);
        const identityRepo = await createLocalIdentityRepository(join(dataPath, 'identity'));
        await identityRepo.stageOfficeTlsKey(tls.privateKey); tls.privateKey.fill(0);
        await writeFile(join(dataPath, 'server.crt'), tls.certificate);
        await writeFile(join(dataPath, 'ca.crt'), tls.ca);
      }
      const config = mode === 'local-single' ? { ...common, recordsHash, identityHash }
        : { ...common, recordsHash, bindHost: network.host, privateCidr: network.cidr, tlsCertPath: join(dataPath, 'server.crt'), tlsCaPath: join(dataPath, 'ca.crt') };
      const start = mode === 'local-single' ? startLocalSingle : startLocalOffice;
      await stage(mode, 'startup-rejects-unsigned-expired-and-wrong-mode-before-database', async () => {
        const forbidden = join(dataPath, 'must-not-be-created');
        for (const replacement of [
          { ...manifest, ed25519Signature: 'invalid' },
          await signInstallManifest({ ...unsigned, expiresAt: new Date(Date.now() - 1000).toISOString() }, pair.privateKey),
          await signInstallManifest({ ...unsigned, mode: mode === 'local-single' ? 'local-office' : 'local-single' }, pair.privateKey),
        ]) {
          await assert.rejects(start({ ...config, dataPath: forbidden, installManifest: JSON.stringify(replacement) }),
            (error) => error instanceof InstallManifestError);
          await assert.rejects(stat(forbidden), (error) => error.code === 'ENOENT');
        }
      });
      if (mode === 'local-office') await stage(mode, 'certificate-constraints-and-public-bind-denials', async () => {
        for (const options of [{ unconstrained: true }, { wrongLeafUsage: true }, { constraintIp: network.host === '10.254.254.254' ? '10.254.254.253' : '10.254.254.254' }]) {
          const invalid = syntheticOfficeTls(network.host, options);
          try {
            await assert.rejects(verifyOfficeTlsIdentity({ manifest, bindHost: network.host, privateCidr: network.cidr, ...invalid }),
              (error) => error.message === 'tls_identity_invalid');
          } finally { invalid.privateKey.fill(0); }
        }
        const forbidden = join(dataPath, 'public-bind-must-not-be-created');
        await assert.rejects(start({ ...config, dataPath: forbidden, bindHost: '0.0.0.0' }), (error) => error.message === 'bind_address_not_private');
        await assert.rejects(stat(forbidden), (error) => error.code === 'ENOENT');
      });
      runtime = await stage(mode, 'actual-runtime-startup', () => start(config));
      let base = mode === 'local-single' ? `http://127.0.0.1:${runtime.port}` : apiBase;
      const call = (path, options = {}) => exchange(base, path, { ...options, ...(tls ? { ca: tls.ca } : {}) });
      assert.equal((await call('/me')).status, 401);
      assert.equal((await call('/health', { headers: { origin: 'null' } })).status, 403);
      assert.equal((await call('/health', { headers: { host: 'untrusted.invalid' } })).status, 403);
      if (mode === 'local-office') await stage(mode, 'https-live-and-cleartext-rejected', async () => {
        assert.equal((await call('/health')).status, 200);
        await assert.rejects(exchange(`http://${network.host}:8443`, '/health'), (error) => error.message === 'transport_failed');
      });
      let bearer;
      async function unlockSingle() {
        const repository = await createLocalIdentityRepository(join(dataPath, 'identity'));
        const install = await repository.readSingle(config.generation, config.identityHash);
        try {
          const challengeResponse = await call('/auth/challenge', { method: 'POST', body: {}, headers: { 'x-ccc-install-id': installationId } });
          assert.equal(challengeResponse.status, 200);
          const challenge = challengeResponse.body.challenge;
          const proof = createHmac('sha256', install.handshakeKey).update(`${installationId}\0${challenge}`).digest('base64url');
          const body = { challenge, proof, password: PASSWORD };
          const result = await call('/auth/unlock', { method: 'POST', body, headers: { 'x-ccc-install-id': installationId } });
          assert.equal(result.status, 200);
          assert.equal((await call('/auth/unlock', { method: 'POST', body, headers: { 'x-ccc-install-id': installationId } })).status, 401);
          return result.body.bearer;
        } finally { install.handshakeKey.fill(0); }
      }
      async function login(username) {
        const result = await call('/api/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
        assert.equal(result.status, 200); return result.body.bearer;
      }
      await stage(mode, 'http-unlock-or-password-and-mfa', async () => {
        if (mode === 'local-single') {
          const endpoint = await readEndpointRecord(dataPath, installationId); assert.equal(endpoint.port, runtime.port);
          bearer = await unlockSingle();
        } else {
          bearer = await login('admin');
          assert.equal((await call('/me', { bearer })).status, 403);
          const code = totp();
          assert.equal((await call('/api/auth/mfa', { method: 'POST', body: { code }, bearer })).status, 204);
          assert.equal((await call('/api/auth/mfa', { method: 'POST', body: { code }, bearer })).status, 401);
          assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'x'.repeat(5000) } })).status, 413);
        }
        const me = await call('/me', { bearer }); assert.equal(me.status, 200); assert.equal(me.body.id, userId);
        assert.ok(me.body.roles.includes('worker')); assert.ok(me.body.roles.includes('technical-admin'));
      });
      let supportCaseId, recordId;
      const memo = 'Synthetic record text. '.repeat(300);
      await stage(mode, 'http-authorized-business-write-read-and-encrypted-database-reread', async () => {
        const context = await call('/programs', { bearer }); assert.equal(context.status, 200);
        const program = await call('/programs', { method: 'POST', bearer, body: {
          displayName: 'Synthetic runtime program', storageMode: 'local_encrypted', processingMode: 'internal_only',
          staff: [{ userId, isResponsible: true }, { userId: otherUser, isResponsible: false }],
          confirmation: { copyVersion: context.body.admissionCopy.version, copyHash: context.body.admissionCopy.hash,
            installationPolicyVersion: context.body.installation.policyVersion, installationConfigHash: context.body.installation.configHash },
        } }); assert.equal(program.status, 201);
        const participant = await call('/participants', { method: 'POST', bearer, body: { programId: program.body.program.id, initialAssigneeUserId: userId, consentPrivacy: true, consentRecordingAi: false } });
        assert.equal(participant.status, 201); supportCaseId = participant.body.supportCaseId;
        const saved = await call(`/support-cases/${supportCaseId}/records`, { method: 'POST', bearer, body: {
          submissionId: randomUUID(), heldAt: new Date().toISOString(), channel: 'in_person', memo, gasScores: [], actions: [], flags: [],
        } }); assert.equal(saved.status, 201); recordId = saved.body.record.id;
        const records = await call(`/support-cases/${supportCaseId}/records`, { bearer }); assert.equal(records.status, 200);
        assert.equal(records.body.records.find((record) => record.id === recordId).memo, memo);
        const row = await database.prepare('SELECT memo FROM sessions WHERE id = ?').bind(recordId).first(); assert.equal(row.memo, memo);
        const file = await readFile(join(dataPath, 'database.sqlite')); assert.notEqual(file.subarray(0, 16).toString(), 'SQLite format 3\0');
      });
      await stage(mode, 'http-lock-revocation-directory-and-expiry-denials', async () => {
        if (mode === 'local-single') {
          assert.equal((await call('/auth/lock', { method: 'POST', bearer, body: {} })).status, 204);
          assert.equal((await call('/me', { bearer })).status, 401);
          bearer = await unlockSingle();
          assert.equal((await call('/me', { bearer })).body.id, userId);
        } else {
          let worker = await login('worker');
          assert.equal((await call(`/support-cases/${supportCaseId}/records`, { bearer: worker })).status, 403);
          assert.equal((await call('/api/auth/logout', { method: 'POST', bearer: worker, body: {} })).status, 204);
          assert.equal((await call('/me', { bearer: worker })).status, 401);
          const revocations = await database.prepare("SELECT COUNT(*) AS count FROM auth_revocations WHERE kind = 'session'").first();
          assert.equal((await call('/api/auth/logout', { method: 'POST', bearer: worker, body: {} })).status, 204);
          const unknown = `CCC-LOCAL-OFFICEv1-${randomBytes(32).toString('base64url')}`;
          assert.equal((await call('/api/auth/logout', { method: 'POST', bearer: unknown, body: {} })).status, 401);
          assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM auth_revocations WHERE kind = 'session'").first()).count, revocations.count);
          assert.equal((await call('/me', { bearer })).status, 200);
          worker = await login('worker');
          assert.equal((await call('/auth/logout', { method: 'POST', bearer: worker, body: {} })).status, 204);
          assert.equal((await call('/me', { bearer: worker })).status, 401);
          assert.equal((await call('/api/auth/logout', { method: 'POST', bearer: worker, body: {} })).status, 204);
          worker = await login('worker');
          const tech = await login('technician');
          assert.equal((await call('/api/auth/mfa', { method: 'POST', bearer: tech, body: { code: totp() } })).status, 204);
          assert.equal((await call('/me', { bearer: tech })).status, 200);
          assert.equal((await call(`/support-cases/${supportCaseId}/records`, { bearer: tech })).status, 403);
          await database.prepare('UPDATE user_role_assignments SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), technician).run();
          assert.equal((await call('/me', { bearer: tech })).status, 403);
          await database.prepare('UPDATE office_accounts SET enabled = 0 WHERE user_id = ?').bind(otherUser).run();
          assert.equal((await call('/me', { bearer: worker })).status, 401);
          await database.prepare('UPDATE office_accounts SET enabled = 1 WHERE user_id = ?').bind(otherUser).run();
          assert.equal((await call('/me', { bearer: worker })).status, 401);
          worker = await login('worker');
          await database.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(otherUser).run();
          assert.equal((await call('/me', { bearer: worker })).status, 401);
          await database.prepare('UPDATE users SET active = 1 WHERE id = ?').bind(otherUser).run();
          for (let attempt = 0; attempt < 5; attempt++) assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'worker', password: 'wrong password' } })).status, 401);
          assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'worker', password: PASSWORD } })).status, 423);
          const locked = await database.prepare('SELECT failed_attempts, locked_until FROM office_accounts WHERE user_id = ?').bind(otherUser).first();
          assert.equal(locked.failed_attempts, 5); assert.ok(Date.parse(locked.locked_until) > Date.now());
          await database.prepare('UPDATE office_sessions SET expires_at = ? WHERE session_hash = ?').bind(new Date(Date.now() - 1).toISOString(), createHash('sha256').update(bearer).digest('hex')).run();
          assert.equal((await call('/me', { bearer })).status, 401);
        }
      });
      await stage(mode, 'bounded-shutdown-with-stalled-body', async () => {
        const ready = Promise.withResolvers(), closed = Promise.withResolvers();
        let responded = false;
        const stalled = (tls ? httpsRequest : httpRequest)(new URL('/api/auth/login', base), {
          method: 'POST', ...(tls ? { ca: tls.ca } : {}),
          headers: { expect: '100-continue', 'content-type': 'application/json', 'content-length': '1024' },
        });
        stalled.once('continue', ready.resolve);
        stalled.on('error', () => { ready.reject(new Error('transport_failed')); });
        stalled.once('close', closed.resolve);
        stalled.on('response', (response) => { responded = true; response.resume(); });
        stalled.setTimeout(15_000, () => { stalled.destroy(new Error('request_timeout')); });
        stalled.flushHeaders();
        try {
          await ready.promise;
          const started = performance.now();
          await runtime.close();
          runtime = undefined;
          await closed.promise;
          assert.ok(performance.now() - started < 12_000);
          assert.equal(responded, false);
        } finally { stalled.destroy(); }
      });
      await stage(mode, 'acknowledged-record-survives-database-reopen', async () => {
        const reread = openEncryptedSqlite({ filename: join(dataPath, 'database.sqlite'), key, fileMustExist: true });
        try { assert.equal((await reread.prepare('SELECT memo FROM sessions WHERE id = ?').bind(recordId).first()).memo, memo); }
        finally { reread.close(); }
      });
      if (mode === 'local-single') await stage(mode, 'same-stable-id-after-runtime-restart', async () => {
        runtime = await start(config);
        const endpoint = await readEndpointRecord(dataPath, installationId);
        assert.equal((await exchange(`http://127.0.0.1:${endpoint.port}`, '/me', { bearer })).status, 401);
        base = `http://127.0.0.1:${endpoint.port}`;
        const repository = await createLocalIdentityRepository(join(dataPath, 'identity'));
        const restored = await repository.readSingle(1, identityHash);
        assert.equal(restored.stableUserId, userId); restored.handshakeKey.fill(0);
        bearer = await unlockSingle();
        assert.equal((await call('/me', { bearer })).body.id, userId);
        assert.equal((await call(`/support-cases/${supportCaseId}/records`, { bearer })).body.records.find((record) => record.id === recordId).memo, memo);
        await runtime.close(); runtime = undefined;
      });
      if (mode === 'local-single') await stage(mode, 'kit-stable-id-rewrap-and-http-unlock', async () => {
        // Identity continuity only, on this same Windows account. This is not an SG9 full/cross-SID restore verdict.
        const sourceRecords = await secrets.read(1, recordsHash);
        const sourceStore = createDpapiSecretStore(mode, sourceRecords);
        sourceRecords.forEach((record) => record.blob.fill(0));
        const repository = await createLocalIdentityRepository(join(dataPath, 'identity'));
        let openedKit;
        const targetHandshake = new Uint8Array(randomBytes(32));
        try {
          const binding = {
            schemaVersion: 62, schemaDigest: new Uint8Array(createHash('sha256').update(JSON.stringify(migrations)).digest()),
            mode, kitId: randomUUID(),
            s10PayloadSha256: new Uint8Array(createHash('sha256').update(await readFile(join(dataPath, 'database.sqlite'))).digest()),
            sourceInstallationId: installationId, sourceOrgId: orgId, createdAt: new Date().toISOString(),
          };
          const dbMaterial = await sourceStore.getBytesWithVersion('DB_MASTER_KEY');
          const fileMaterial = await sourceStore.getBytesWithVersion('FILE_ENC_KEY');
          const piiMaterial = await sourceStore.getBytesWithVersion('PII_ENC_KEY');
          const wire = await sealRecoveryKit({
            payloadVersion: 1, ...structuredClone(binding), generation: 1, previousKitHash: null, stableUserId: userId,
            dbMasterKey: { key: dbMaterial.bytes, version: dbMaterial.version },
            fileMasterKey: { key: fileMaterial.bytes, version: fileMaterial.version },
            piiEncKey: { key: piiMaterial.bytes, version: piiMaterial.version },
            officeCaKey: null, identityContinuity: { mode, stableUserId: userId, actors: [] },
          }, new TextEncoder().encode('Synthetic recovery passphrase only'));
          try { openedKit = await openRecoveryKit(wire, new TextEncoder().encode('Synthetic recovery passphrase only'), binding); }
          finally { wire.fill(0); }
          const verifier = await hashPassword(new TextEncoder().encode(PASSWORD));
          config.identityHash = await repository.stageRecoveredSingle(2, {
            schemaVersion: 1, installationId, orgId, sequence: 1,
            passwordHash: verifier.hash, salt: verifier.salt, handshakeKey: targetHandshake,
          }, openedKit);
          const rewrapped = [
            sourceStore.protect('DB_MASTER_KEY', { bytes: openedKit.dbMasterKey.key, version: openedKit.dbMasterKey.version }),
            sourceStore.protect('FILE_ENC_KEY', { bytes: openedKit.fileMasterKey.key, version: openedKit.fileMasterKey.version }),
            sourceStore.protect('PII_ENC_KEY', { bytes: openedKit.piiEncKey.key, version: openedKit.piiEncKey.version }),
          ];
          try { config.recordsHash = await secrets.stage(2, rewrapped); }
          finally { rewrapped.forEach((record) => record.blob.fill(0)); }
          config.generation = 2;
          runtime = await start(config); base = `http://127.0.0.1:${runtime.port}`;
          bearer = await unlockSingle();
          assert.equal((await call('/me', { bearer })).body.id, userId);
          assert.equal((await call(`/support-cases/${supportCaseId}/records`, { bearer })).body.records.find((record) => record.id === recordId).memo, memo);
          await runtime.close(); runtime = undefined;
        } finally { if (openedKit) wipeCbor(openedKit); sourceStore.close(); targetHandshake.fill(0); }
      });
    } finally {
      await runtime?.close(); database.close(); key.fill(0); piiKey.fill(0);
    }
  }
}
