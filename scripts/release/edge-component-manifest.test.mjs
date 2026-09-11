import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import {
  buildEdgeComponentManifest,
  verifyEdgeComponentManifest,
} from './edge-component-manifest.mjs';
import { loadReleaseTrustStore } from './release-trust.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const runFile = promisify(execFile);
const NOW = new Date('2026-09-11T12:00:00.000Z');

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'release-key-test';
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    privateKeyObject: privateKey,
    publicKey: publicKey.export({ format: 'jwk' }).x,
    trustJson: JSON.stringify({ keys: [{
      keyId,
      publicKey: publicKey.export({ format: 'jwk' }).x,
      status: 'active',
      notBefore: '2020-01-01T00:00:00.000Z',
      notAfter: '2099-01-01T00:00:00.000Z',
    }] }),
  };
}

function resignEdge(value, privateKey) {
  const { ed25519Signature: _signature, ...unsigned } = value;
  return {
    ...unsigned,
    ed25519Signature: sign(null, Buffer.concat([
      Buffer.from('CCC-EDGE-COMPONENT-MANIFEST-V1\0', 'ascii'),
      Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
    ]), privateKey).toString('base64url'),
  };
}

async function settleFifo(verification, path) {
  const settled = verification.then(() => 'accepted', error => error?.code);
  const initial = await Promise.race([
    settled,
    new Promise(resolve => setTimeout(() => resolve('blocked'), 100)),
  ]);
  if (initial === 'blocked') {
    try {
      const writer = await open(path, constants.O_WRONLY | constants.O_NONBLOCK);
      await writer.close();
    } catch (error) {
      if (error?.code !== 'ENXIO') throw error;
    }
    await settled;
  }
  return initial;
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-edge-manifest-'));
  const previous = {
    key: process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY,
    trust: process.env.CCC_RELEASE_TRUST_STORE,
  };
  const signing = signingFixture();
  process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY = signing.privateKey;
  process.env.CCC_RELEASE_TRUST_STORE = signing.trustJson;
  try {
    for (const directory of ['functions', 'templates', 'migrations']) {
      await mkdir(join(root, directory));
    }
    await writeFile(join(root, 'functions', 'z.ts'), 'z');
    await writeFile(join(root, 'functions', '😀.ts'), 'emoji');
    await writeFile(join(root, 'functions', '\ue000.ts'), 'private');
    await writeFile(join(root, 'templates', 'mail.json'), '{}');
    await writeFile(join(root, 'migrations', '0001.sql'), 'select 1;');
    await run({ root, signing });
  } finally {
    if (previous.key === undefined) delete process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY;
    else process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY = previous.key;
    if (previous.trust === undefined) delete process.env.CCC_RELEASE_TRUST_STORE;
    else process.env.CCC_RELEASE_TRUST_STORE = previous.trust;
    await rm(root, { recursive: true, force: true });
  }
}

test('builds the closed signed EdgeComponentManifestV1 in UTF-8 path order', async () => fixture(async ({ root, signing }) => {
  const manifest = await buildEdgeComponentManifest(root);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'components', 'edgeArtifactSha256', 'ed25519Signature', 'protocolVersion',
    'schemaVersion', 'signingKeyId',
  ].sort());
  assert.deepEqual(manifest.components.map(component => component.path), [
    'functions/z.ts',
    'functions/\ue000.ts',
    'functions/😀.ts',
    'migrations/0001.sql',
    'templates/mail.json',
  ]);
  assert.deepEqual(manifest.components.map(component => component.kind), [
    'function', 'function', 'function', 'migration', 'template',
  ]);
  assert.equal(manifest.edgeArtifactSha256, sha256(canonicalizeJcs(manifest.components)));
  assert.match(manifest.ed25519Signature, /^[A-Za-z0-9_-]{86}$/u);

  const document = canonicalizeJcs(manifest);
  await writeFile(join(root, 'edge-component-manifest.json'), document);
  const verified = await verifyEdgeComponentManifest({
    document,
    stagedRoot: root,
    bundleRow: { edgeComponentManifestSha256: sha256(document) },
    trustStore: await loadReleaseTrustStore(signing.trustJson),
    now: NOW,
  });
  assert.deepEqual(verified, manifest);
}));

test('rejects filesystem links without producing a manifest', async t => fixture(async ({ root }) => {
  await t.test('symbolic link', async () => {
    await symlink(join(root, 'templates', 'mail.json'), join(root, 'functions', 'linked.ts'));
    await assert.rejects(buildEdgeComponentManifest(root), error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH');
    await rm(join(root, 'functions', 'linked.ts'));
  });
  await t.test('hard link', async () => {
    await link(join(root, 'templates', 'mail.json'), join(root, 'functions', 'linked.ts'));
    await assert.rejects(buildEdgeComponentManifest(root), error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH');
  });
}));

test('verification rejects altered, missing, extra, duplicated and unsafe component paths', async t => fixture(async ({ root, signing }) => {
  const manifest = await buildEdgeComponentManifest(root);
  const trustStore = await loadReleaseTrustStore(signing.trustJson);
  const document = canonicalizeJcs(manifest);
  const bundleRow = { edgeComponentManifestSha256: sha256(document) };
  await writeFile(join(root, 'edge-component-manifest.json'), document);

  await t.test('altered bytes', async () => {
    await writeFile(join(root, 'templates', 'mail.json'), '{"changed":true}');
    await assert.rejects(
      verifyEdgeComponentManifest({ document, stagedRoot: root, bundleRow, trustStore, now: NOW }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    await writeFile(join(root, 'templates', 'mail.json'), '{}');
  });
  await t.test('missing component', async () => {
    const path = join(root, 'templates', 'mail.json');
    const bytes = await readFile(path);
    await rm(path);
    await assert.rejects(
      verifyEdgeComponentManifest({ document, stagedRoot: root, bundleRow, trustStore, now: NOW }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    await writeFile(path, bytes);
  });
  await t.test('extra component', async () => {
    const path = join(root, 'functions', 'extra.ts');
    await writeFile(path, 'extra');
    await assert.rejects(
      verifyEdgeComponentManifest({ document, stagedRoot: root, bundleRow, trustStore, now: NOW }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    await rm(path);
  });
  await t.test('document digest mismatch', async () => {
    await assert.rejects(
      verifyEdgeComponentManifest({
        document, stagedRoot: root,
        bundleRow: { edgeComponentManifestSha256: '00'.repeat(32) }, trustStore, now: NOW,
      }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
  });
  await t.test('linked embedded manifest', async () => {
    const embeddedPath = join(root, 'edge-component-manifest.json');
    const outsidePath = `${root}.manifest.json`;
    await rm(embeddedPath);
    await writeFile(outsidePath, document);
    await symlink(outsidePath, embeddedPath);
    try {
      await assert.rejects(
        verifyEdgeComponentManifest({ document, stagedRoot: root, bundleRow, trustStore, now: NOW }),
        error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
      );
    } finally {
      await rm(embeddedPath, { force: true });
      await rm(outsidePath, { force: true });
      await writeFile(embeddedPath, document);
    }
  });
  await t.test('non-regular embedded manifest', async () => {
    const embeddedPath = join(root, 'edge-component-manifest.json');
    await rm(embeddedPath);
    await runFile('/usr/bin/mkfifo', [embeddedPath]);
    const result = await settleFifo(
      verifyEdgeComponentManifest({ document, stagedRoot: root, bundleRow, trustStore, now: NOW }),
      embeddedPath,
    );
    await rm(embeddedPath, { force: true });
    await writeFile(embeddedPath, document);
    assert.equal(result, 'EDGE_COMPONENT_SET_MISMATCH');
  });
  await t.test('non-regular document filename', async () => {
    const documentPath = `${root}.document.json`;
    await runFile('/usr/bin/mkfifo', [documentPath]);
    try {
      const result = await settleFifo(
        verifyEdgeComponentManifest({
          document: documentPath, stagedRoot: root, bundleRow, trustStore, now: NOW,
        }),
        documentPath,
      );
      assert.equal(result, 'SIGNATURE_INVALID');
    } finally {
      await rm(documentPath, { force: true });
    }
  });
  await t.test('document bytes cannot redirect the strict parser to another file', async () => {
    const targetPath = `${root}.target.json`;
    const redirectPath = `${root}.redirect.txt`;
    const embeddedPath = join(root, 'edge-component-manifest.json');
    const redirectDocument = targetPath;
    await writeFile(targetPath, document);
    await writeFile(redirectPath, redirectDocument);
    await writeFile(embeddedPath, redirectDocument);
    try {
      await assert.rejects(
        verifyEdgeComponentManifest({
          document: redirectPath,
          stagedRoot: root,
          bundleRow: { edgeComponentManifestSha256: sha256(redirectDocument) },
          trustStore,
          now: NOW,
        }),
        error => error?.code === 'SIGNATURE_INVALID',
      );
    } finally {
      await rm(targetPath, { force: true });
      await rm(redirectPath, { force: true });
      await writeFile(embeddedPath, document);
    }
  });
  await t.test('oversized document filename', async () => {
    const documentPath = `${root}.oversized.json`;
    await writeFile(documentPath, Buffer.alloc(1_048_577, 0x20));
    try {
      await assert.rejects(
        verifyEdgeComponentManifest({
          document: documentPath, stagedRoot: root, bundleRow, trustStore, now: NOW,
        }),
        error => error?.code === 'SIGNATURE_INVALID',
      );
    } finally {
      await rm(documentPath, { force: true });
    }
  });
  await t.test('unsupported protocol version', async () => {
    const changed = resignEdge({ ...manifest, protocolVersion: '2.0.0' }, signing.privateKeyObject);
    const changedDocument = canonicalizeJcs(changed);
    await writeFile(join(root, 'edge-component-manifest.json'), changedDocument);
    await assert.rejects(
      verifyEdgeComponentManifest({
        document: changedDocument, stagedRoot: root,
        bundleRow: { edgeComponentManifestSha256: sha256(changedDocument) }, trustStore, now: NOW,
      }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    await writeFile(join(root, 'edge-component-manifest.json'), document);
  });
  await t.test('duplicate and unsafe paths', async () => {
    for (const path of [manifest.components[0].path, '../escape.sql', '/absolute.sql', 'functions\\bad.ts']) {
      const changed = structuredClone(manifest);
      changed.components[1].path = path;
      await assert.rejects(
        verifyEdgeComponentManifest({
          document: canonicalizeJcs(changed), stagedRoot: root,
          bundleRow: { edgeComponentManifestSha256: sha256(canonicalizeJcs(changed)) },
          trustStore,
          now: NOW,
        }),
        error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
      );
    }
  });
  await t.test('uses caller trusted time for release-key validity', async () => {
    const trustedNow = new Date('2035-06-01T00:00:00.000Z');
    const futureTrustStore = await loadReleaseTrustStore(JSON.stringify({ keys: [{
      keyId: 'release-key-test',
      publicKey: signing.publicKey,
      status: 'active',
      notBefore: '2035-01-01T00:00:00.000Z',
      notAfter: '2036-01-01T00:00:00.000Z',
    }] }));
    assert.deepEqual(await verifyEdgeComponentManifest({
      document,
      stagedRoot: root,
      bundleRow,
      trustStore: futureTrustStore,
      now: trustedNow,
    }), manifest);
    await assert.rejects(
      verifyEdgeComponentManifest({
        document, stagedRoot: root, bundleRow, trustStore: futureTrustStore,
      }),
      error => error?.code === 'SIGNATURE_INVALID',
    );
  });
}));
