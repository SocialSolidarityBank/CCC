import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const verifier = join(repoRoot, 'scripts/release/verify.mjs');
const fixtureRoot = join(repoRoot, 'scripts/release/fixtures');
const safeSbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [{ type: 'library', name: 'fixture-package', version: '1.0.0', purl: 'pkg:npm/fixture-package@1.0.0', hashes: [{ alg: 'SHA-256', content: 'a'.repeat(64) }], licenses: [{ license: { id: 'MIT' } }] }],
};

function runVerifier(directory, { sbom = safeSbom, generate = false, secretStatus = 0, modelManifest, conditionalManifest, artifactDir, lockfile, crossEvidence } = {}) {
  const sbomPath = join(directory, 'bom.json');
  const scanner = join(directory, 'fake-gitleaks');
  writeFileSync(scanner, `#!/bin/sh\nexit ${secretStatus}\n`);
  chmodSync(scanner, 0o755);
  const licensesPath = join(directory, 'licenses.json');
  writeFileSync(licensesPath, '{}');
  const crossPath = join(directory, 'cross.json');
  writeFileSync(crossPath, JSON.stringify({ schemaVersion: 1, components: [] }));
  const pnpm = join(directory, 'fake-pnpm');
  const generated = JSON.stringify(JSON.stringify(sbom));
  writeFileSync(
    pnpm,
    `#!/usr/bin/env node\nif (process.argv[2] !== 'sbom' || !process.argv.includes('--lockfile-only')) process.exit(2);\nprocess.stdout.write(${generated});\n`,
  );
  chmodSync(pnpm, 0o755);
  const env = { ...process.env, GITLEAKS_BIN: scanner, CCC_LICENSES_FILE: licensesPath, CCC_CROSS_EVIDENCE: crossPath, PNPM_BIN: pnpm };
  const args = [verifier];
  if (generate) {
    // The verifier invokes the same built-in pnpm command when no --sbom is supplied.
  } else {
    writeFileSync(sbomPath, JSON.stringify(sbom));
    args.push('--sbom', sbomPath);
  }
  if (modelManifest !== undefined) {
    const modelPath = join(directory, 'models.json');
    writeFileSync(modelPath, JSON.stringify(modelManifest));
    env.CCC_MODEL_LICENSE_MANIFEST = modelPath;
  }
  if (conditionalManifest !== undefined) {
    const conditionalPath = join(directory, 'conditional.json');
    writeFileSync(conditionalPath, JSON.stringify(conditionalManifest));
    args.push('--conditional-license-obligations', conditionalPath);
  }
  if (artifactDir !== undefined) env.CCC_RELEASE_ARTIFACT_DIR = artifactDir;
  if (lockfile !== undefined) env.CCC_LOCKFILE = lockfile;
  if (crossEvidence !== undefined) {
    const crossEvidencePath = join(directory, 'cross-evidence.json');
    writeFileSync(crossEvidencePath, JSON.stringify(crossEvidence));
    env.CCC_CROSS_EVIDENCE = crossEvidencePath;
  }
  return spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', env });
}

test('passes a CycloneDX SBOM, allowlisted model manifest, safe fixture, and gitleaks scan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      generate: true,
      modelManifest: { schemaVersion: 1, models: [{ name: 'fixture-model', version: '1', revision: 'fixture-revision', license: 'MIT', source: 'https://example.invalid/model' }] },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release:verify 통과/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts SPDX identifiers beginning with a digit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{ type: 'library', name: 'zero-bsd-package', version: '1.0.0', licenses: [{ license: { id: '0BSD' } }] }],
      },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('fails when conditional obligations omit the schema version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, { conditionalManifest: { obligations: [] } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conditional license obligations schemaVersion 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts scoped sharp-libvips only through conditional LGPL obligations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          group: '@img',
          name: 'sharp-libvips-darwin-arm64',
          version: '1.2.4',
          purl: 'pkg:npm/%40img/sharp-libvips-darwin-arm64@1.2.4',
        }],
      },
      crossEvidence: { schemaVersion: 1, components: [{ name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4', license: 'LGPL-3.0-or-later', source: 'https://sharp.pixelplumbing.com' }] },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('formal artifact mode rejects sharp-libvips without evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const artifactDir = mkdtempSync(join(tmpdir(), 'ccc-release-artifact-'));
  try {
    mkdirSync(join(artifactDir, 'third-party'), { recursive: true });
    writeFileSync(join(artifactDir, 'third-party/python-sbom.cdx.json'), JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      components: [{ type: 'library', name: 'fixture-python-package', version: '1.0.0' }],
    }));
    const result = runVerifier(directory, {
      artifactDir,
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          group: '@img',
          name: 'sharp-libvips-darwin-arm64',
          version: '1.2.4',
          purl: 'pkg:npm/%40img/sharp-libvips-darwin-arm64@1.2.4',
        }],
      },
      crossEvidence: { schemaVersion: 1, components: [{ name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4', license: 'LGPL-3.0-or-later', source: 'https://sharp.pixelplumbing.com' }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /final artifact license evidence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('rejects malformed Python SBOM evidence in formal artifact mode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const artifactDir = mkdtempSync(join(tmpdir(), 'ccc-release-artifact-'));
  try {
    mkdirSync(join(artifactDir, 'third-party'), { recursive: true });
    writeFileSync(join(artifactDir, 'third-party/python-sbom.cdx.json'), 'not-json');
    const result = runVerifier(directory, { artifactDir });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Python dependency SBOM JSON을 읽을 수 없다/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('rejects wrong conditional license evidence for a scoped component', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          group: '@img',
          name: 'sharp-libvips-darwin-arm64',
          version: '1.2.4',
          purl: 'pkg:npm/%40img/sharp-libvips-darwin-arm64@1.2.4',
        }],
      },
      crossEvidence: { schemaVersion: 1, components: [{ name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4', license: 'MIT', source: 'https://sharp.pixelplumbing.com' }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conditional license evidence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects stale cross-platform license evidence entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      crossEvidence: { schemaVersion: 1, components: [{ name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4', license: 'MIT', source: 'https://sharp.pixelplumbing.com' }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /현재 SBOM에 없거나 필요하지 않다/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a cross-platform license entry with the wrong version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          group: '@img',
          name: 'sharp-libvips-darwin-arm64',
          version: '1.2.4',
          purl: 'pkg:npm/%40img/sharp-libvips-darwin-arm64@1.2.4',
        }],
      },
      crossEvidence: { schemaVersion: 1, components: [{ name: '@img/sharp-libvips-darwin-arm64', version: '9.9.9', license: 'LGPL-3.0-or-later', source: 'https://sharp.pixelplumbing.com' }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lockfile에 없는 component/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('fails when a dependency has no SPDX license', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: { ...safeSbom, components: [{ type: 'library', name: 'unlicensed-package', version: '1.0.0', licenses: [] }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SPDX license가 표기되지 않거나 허용되지 않음/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('skips only optional packages excluded by lockfile platform metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const lockfile = join(directory, 'fixture-lock.yaml');
  const unsupportedCpu = process.arch === 'arm64' ? 'x64' : 'arm64';
  writeFileSync(lockfile, `lockfileVersion: '9.0'

packages:
  '@fixture/native@1.0.0':
    resolution: {}
    cpu: [${unsupportedCpu}]

snapshots:
  '@fixture/native@1.0.0':
    optionalDependencies:
      nested: 1.0.0
    optional: true
`);
  try {
    const result = runVerifier(directory, {
      lockfile,
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          group: '@fixture',
          name: 'native',
          version: '1.0.0',
        }],
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /호스트 외 optional 1개 제외/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails when a model has no declared license', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      modelManifest: { schemaVersion: 1, models: [{ name: 'unlicensed-model', version: '1', source: 'https://example.invalid/model' }] },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /model license allowlist 위반/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails on a PII-shaped value in an approved fixture path', () => {
  const fixtureDirectory = mkdtempSync(join(fixtureRoot, 'release-test-'));
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const fixture = join(fixtureDirectory, 'pii.json');
  try {
    writeFileSync(fixture, JSON.stringify({ email: 'person@example.invalid' }));
    const result = runVerifier(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fixture\/manifest PII 검사 실패/);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails when gitleaks reports a secret and does not print scanner output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, { secretStatus: 1 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /gitleaks가 secret으로 보이는 값을 발견했다/);
    assert.doesNotMatch(result.stderr, /ghp_|sk-[A-Za-z0-9]/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
