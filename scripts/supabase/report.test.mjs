import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildRedactedReport,
  writeRedactedReport,
} from './report.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SECRET = 'sbp_provider-secret-value';

function doctor(overrides = {}) {
  return {
    operation: 'doctor',
    readOnly: true,
    ready: false,
    productionReady: false,
    installed: {
      state: 'installed',
      migrationHead: '0037_program_data_policy_confirmation.sql',
      runtimeManifestSha256: HASH_A,
      approvalSha256: HASH_B,
    },
    stateFingerprint: HASH_A,
    completedSteps: [{ step: 'receipt', idempotencyKey: HASH_B }],
    blockers: [{
      code: 'RELEASE_PREREQUISITES_MISSING',
      message: `provider returned ${SECRET} at https://private.example.test`,
      recovery: `Bearer ${SECRET}`,
    }],
    providerBaseline: { raw: { nested: [SECRET, 'https://private.example.test'] } },
    ...overrides,
  };
}

function ledger(overrides = {}) {
  const receipt = {
    contract: 'S11',
    contractVersion: '0.3',
    installationId: `installation-${SECRET}`,
    institutionIdHash: HASH_A,
    rollbackTarget: null,
    expectedOwnerOrgIdHash: HASH_A,
    observedOwnerOrgIdHash: HASH_A,
    releaseVersion: '0.9.0-dev.1',
    releaseSequence: 7,
    manifestDigest: HASH_A,
    artifactSetDigest: HASH_B,
    migrationHead: '0037_program_data_policy_confirmation.sql',
    schemaFingerprint: HASH_A,
    edgeRegionEvidence: {
      requestedRegion: 'ap-northeast-2',
      responseRegion: 'ap-northeast-2',
      functionRegion: 'ap-northeast-2',
      mismatch: false,
      raw: SECRET,
    },
    providerResourceDigests: { [HASH_A]: HASH_B },
    backupId: null,
    backupDigest: null,
    priorReceiptDigest: null,
    recordedAt: '2026-09-11T00:00:00.000Z',
    status: 'installed',
  };
  return {
    journal: {
      installationId: receipt.installationId,
      institutionIdHash: HASH_A,
      projectRefHash: HASH_A,
      expectedOwnerOrgIdHash: HASH_A,
      runtimeManifestSha256: HASH_A,
      approvalSha256: HASH_B,
      runtimeConfigurationSha256: HASH_A,
      contractVersion: 'S11-install-approval-v1',
      runtimeSequence: 1,
      expiresAt: '2026-09-20T00:00:00.000Z',
      resourcesSha256: HASH_A,
      migrationsSha256: HASH_B,
      phase: 'installed',
      currentStep: 'receipt',
      planFingerprint: HASH_A,
      databaseFingerprint: HASH_A,
      stateFingerprint: HASH_B,
      lastErrorCode: null,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      providerPayload: { token: SECRET, url: 'https://private.example.test' },
    },
    authorizationHistory: [{
      runtimeSequence: 1,
      runtimeManifestSha256: HASH_A,
      approvalSha256: HASH_B,
      runtimeConfigurationSha256: HASH_A,
      contractVersion: 'S11-install-approval-v1',
      expiresAt: '2026-09-20T00:00:00.000Z',
      recordedAt: '2026-09-11T00:00:00.000Z',
      raw: SECRET,
    }],
    migrations: [{
      id: receipt.migrationHead,
      checksum: HASH_A,
      appliedAt: '2026-09-11T00:00:00.000Z',
      raw: SECRET,
    }],
    completedSteps: [{
      step: 'receipt',
      idempotencyKey: HASH_A,
      ownershipTags: [SECRET],
      providerResourceIdHashes: [HASH_A],
      providerResourceDigests: [HASH_B],
      stateFingerprint: HASH_A,
      completedAt: '2026-09-11T00:00:00.000Z',
    }],
    resources: [{
      resourceType: 'storage_bucket',
      resourceIdHash: HASH_A,
      resourceDigest: HASH_B,
      ownershipTag: SECRET,
      recordedAt: '2026-09-11T00:00:00.000Z',
    }],
    currentReceipt: receipt,
    releaseHistory: [structuredClone(receipt)],
    ...overrides,
  };
}

function installedReport() {
  return buildRedactedReport({ doctor: doctor(), ledger: ledger(), nonce: Buffer.alloc(32, 7) });
}

async function fixture(callback) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ccc-redacted-report-')));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('builds only RedactedReportV1 fields from current doctor and install-state structures', () => {
  const report = installedReport();

  assert.deepEqual(Object.keys(report).sort(), [
    'artifacts', 'channel', 'checks', 'family', 'generatedAt', 'installedSequence',
    'installedVersion', 'mode', 'redaction', 'schemaVersion',
  ]);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.equal(report.mode, 'community-cloud');
  assert.equal(report.family, 'community-cloud-cli');
  assert.equal(report.installedVersion, '0.9.0-dev.1');
  assert.equal(report.installedSequence, '7');
  assert.equal(report.channel, 'dev');
  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'PASS', code: null },
    {
      name: 'RELEASE_PREREQUISITES_MISSING',
      status: 'FAIL',
      code: 'RELEASE_PREREQUISITES_MISSING',
    },
  ]);
  assert.deepEqual(report.artifacts, []);
  assert.deepEqual(report.redaction, {
    algorithm: 'hmac-sha256',
    scope: 'report-local',
    secrets: 'omitted',
    urls: 'omitted',
  });

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /provider-secret|private\.example|installation-|Bearer|https?:/u);
  assert.doesNotMatch(serialized, /signature|providerPayload|authorizationHistory|ownershipTag/u);
});

test('reports an absent installation without invented release metadata', () => {
  const report = buildRedactedReport({
    doctor: doctor({
      installed: { state: 'not-installed', migrationHead: null },
      blockers: [{ code: 'INSTALL_NOT_FOUND', message: SECRET }],
    }),
    ledger: null,
    nonce: Buffer.alloc(32, 8),
  });

  assert.equal(report.installedVersion, '');
  assert.equal(report.installedSequence, '');
  assert.equal(report.channel, 'dev');
  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'NOT_RUN', code: 'INSTALL_NOT_FOUND' },
  ]);
  assert.deepEqual(report.artifacts, []);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, 'u'));
});

test('unknown doctor or ledger data never makes the affected check pass', () => {
  for (const [currentDoctor, currentLedger] of [
    [{ ...doctor(), ready: true, blockers: [] }, { ...ledger(), currentReceipt: { status: 'installed' } }],
    [{ ...doctor(), ready: 'yes', blockers: [] }, ledger()],
    [{ ...doctor(), ready: true, blockers: [{ code: 'PROVIDER_PRIVATE_FAILURE', raw: SECRET }] }, ledger()],
  ]) {
    const report = buildRedactedReport({ doctor: currentDoctor, ledger: currentLedger, nonce: SECRET });
    assert.ok(report.checks.some(check => check.status === 'FAIL' && check.code === 'HEALTH_FAILED'));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET, 'u'));
  }
});

test('keeps only fixed S12 and current plan diagnostic codes with exact statuses', () => {
  const report = buildRedactedReport({
    doctor: doctor({
      blockers: [
        { code: 'SIGNATURE_INVALID', message: SECRET },
        { code: 'CREDENTIAL_INVALID', raw: { token: SECRET } },
      ],
    }),
    ledger: ledger(),
    nonce: Buffer.alloc(32, 9),
  });

  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'PASS', code: null },
    { name: 'CREDENTIAL_INVALID', status: 'FAIL', code: 'CREDENTIAL_INVALID' },
    { name: 'SIGNATURE_INVALID', status: 'FAIL', code: 'SIGNATURE_INVALID' },
  ]);
});

test('preserves current incomplete and drift blockers instead of collapsing them', () => {
  const incompleteLedger = ledger();
  incompleteLedger.journal.phase = 'installing';
  incompleteLedger.currentReceipt = null;
  incompleteLedger.releaseHistory = [];
  const report = buildRedactedReport({
    doctor: doctor({
      installed: {
        state: 'installing',
        migrationHead: '0001_baseline.sql',
        runtimeManifestSha256: HASH_A,
        approvalSha256: HASH_B,
      },
      blockers: [
        { code: 'INSTALL_INCOMPLETE', message: SECRET },
        { code: 'DRIFT_DETECTED', recovery: `https://private.example.test/${SECRET}` },
      ],
    }),
    ledger: incompleteLedger,
    nonce: Buffer.alloc(32, 12),
  });

  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'FAIL', code: 'INSTALL_INCOMPLETE' },
    { name: 'DRIFT_DETECTED', status: 'FAIL', code: 'DRIFT_DETECTED' },
  ]);
  assert.equal(report.installedVersion, '');
  assert.doesNotMatch(JSON.stringify(report), /provider-secret|private\.example|https?:/u);
});

// D80: 이메일 확인 미요구는 고정 코드로 보고해야 운영자가 무엇을 켜야 하는지 알 수 있다.
test('reports the email confirmation blocker as a fixed code, never as a generic health failure', () => {
  const report = buildRedactedReport({
    doctor: doctor({
      blockers: [{ code: 'AUTH_CONFIRMATION_REQUIRED', message: SECRET, recovery: 'https://private.example.test' }],
    }),
    ledger: ledger(),
    nonce: Buffer.alloc(32, 14),
  });
  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'PASS', code: null },
    { name: 'AUTH_CONFIRMATION_REQUIRED', status: 'FAIL', code: 'AUTH_CONFIRMATION_REQUIRED' },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /provider-secret|private\.example|https?:/u);
});

test('suppresses installed metadata when doctor rejects receipt consistency', () => {
  const inconsistent = ledger();
  inconsistent.releaseHistory[0].migrationHead = 'different-migration.sql';
  const report = buildRedactedReport({
    doctor: doctor({
      blockers: [{ code: 'INSTALL_INCOMPLETE', message: SECRET }],
    }),
    ledger: inconsistent,
    nonce: Buffer.alloc(32, 13),
  });

  assert.equal(report.installedVersion, '');
  assert.equal(report.installedSequence, '');
  assert.deepEqual(report.checks, [
    { name: 'installation', status: 'FAIL', code: 'INSTALL_INCOMPLETE' },
  ]);
});

test('marks doctor PASS only for ready output with no blockers and a matching installed receipt', () => {
  const ready = buildRedactedReport({
    doctor: doctor({ ready: true, blockers: [] }),
    ledger: ledger(),
    nonce: Buffer.alloc(32, 10),
  });
  assert.deepEqual(ready.checks, [
    { name: 'installation', status: 'PASS', code: null },
    { name: 'doctor', status: 'PASS', code: null },
  ]);

  const notReady = buildRedactedReport({
    doctor: doctor({ ready: false, blockers: [], generatedAt: '2099-01-01T00:00:00.000Z' }),
    ledger: ledger(),
    nonce: Buffer.alloc(32, 11),
  });
  assert.deepEqual(notReady.checks, [
    { name: 'installation', status: 'PASS', code: null },
    { name: 'doctor', status: 'FAIL', code: 'HEALTH_FAILED' },
  ]);
});

test('publishes one owner-only report without overwriting an existing destination', async () => fixture(async root => {
  const outputPath = join(root, 'report.json');
  const report = installedReport();
  await writeRedactedReport({ report, outputPath, operatorDirectory: root });

  const info = await stat(outputPath);
  assert.equal(info.isFile(), true);
  assert.equal(info.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), report);
  assert.equal((await lstat(root)).isDirectory(), true);

  const original = await readFile(outputPath, 'utf8');
  await assert.rejects(
    writeRedactedReport({ report: installedReport(), outputPath, operatorDirectory: root }),
    error => error?.code === 'OUTPUT_REDACTION_FAILED',
  );
  assert.equal(await readFile(outputPath, 'utf8'), original);
}));

test('rejects a secret-like value in legal SemVer before publishing a file', async () => fixture(async root => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
  const report = installedReport();
  const unsafeLedger = ledger();
  unsafeLedger.currentReceipt.releaseVersion = `1.0.0+${jwt}`;
  unsafeLedger.releaseHistory[0].releaseVersion = `1.0.0+${jwt}`;
  assert.throws(
    () => buildRedactedReport({
      doctor: doctor(),
      ledger: unsafeLedger,
      nonce: Buffer.alloc(32, 14),
    }),
    error => error?.code === 'OUTPUT_REDACTION_FAILED',
  );
  report.installedVersion = `1.0.0+${jwt}`;
  report.channel = 'stable';
  const outputPath = join(root, 'unsafe.json');

  await assert.rejects(
    writeRedactedReport({ report, outputPath, operatorDirectory: root }),
    error => error?.code === 'OUTPUT_REDACTION_FAILED',
  );
  await assert.rejects(lstat(outputPath), error => error?.code === 'ENOENT');
  assert.deepEqual(await readdir(root), []);
}));

test('rejects symlink, nonregular and out-of-bound destinations without partial files', async () => fixture(async root => {
  const outside = await mkdtemp(join(tmpdir(), 'ccc-redacted-report-outside-'));
  try {
    const report = installedReport();
    const target = join(root, 'target.json');
    await writeFile(target, 'operator-data');
    const linked = join(root, 'linked.json');
    await symlink(target, linked);
    await mkdir(join(root, 'directory.json'));

    for (const outputPath of [linked, join(root, 'directory.json'), join(outside, 'outside.json')]) {
      await assert.rejects(
        writeRedactedReport({ report, outputPath, operatorDirectory: root }),
        error => error?.code === 'OUTPUT_REDACTION_FAILED',
      );
    }
    assert.equal(await readFile(target, 'utf8'), 'operator-data');
    await assert.rejects(lstat(join(outside, 'outside.json')), error => error?.code === 'ENOENT');
    const partialPath = join(root, 'partial.json');
    await assert.rejects(
      writeRedactedReport({
        report: { ...report, unexpected: SECRET },
        outputPath: partialPath,
        operatorDirectory: root,
      }),
      error => error?.code === 'OUTPUT_REDACTION_FAILED',
    );
    await assert.rejects(lstat(partialPath), error => error?.code === 'ENOENT');
    assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.tmp')), []);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));
