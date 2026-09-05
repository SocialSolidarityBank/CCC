import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const pythonPins = [
  ['openai-whisper', '20250625'],
  ['faster-whisper', '1.2.1'],
  ['pyannote.audio', '3.4.0'],
  ['transformers', '4.53.3'],
  ['librosa', '0.11.0'],
];

function writeFormalArtifact(artifactDir, { tamperLibrary = false, tamperSource = false, tamperPython = false } = {}) {
  const thirdParty = join(artifactDir, 'third-party');
  const libvipsDir = join(thirdParty, 'libvips');
  mkdirSync(libvipsDir, { recursive: true });
  const licensePath = join(libvipsDir, 'LGPL-3.0-or-later.txt');
  const licenseText = readFileSync(join(repoRoot, 'supply-chain/licenses/LGPL-3.0-or-later.txt'), 'utf8');
  const noticeText = 'This distribution contains libvips under LGPL-3.0-or-later. Preserve this notice and the license text with the release artifact.';
  const libraryPath = join(libvipsDir, 'libvips.so');
  const sourceBytes = tamperSource ? 'tampered-source' : 'verified-source-archive';
  const sourcePath = join(libvipsDir, 'vips-8.17.3.tar.xz');
  writeFileSync(licensePath, licenseText);
  writeFileSync(libraryPath, tamperLibrary ? 'tampered-library' : 'replaceable-library');
  writeFileSync(sourcePath, sourceBytes);
  const evidence = {
    schemaVersion: 1,
    package: { name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4' },
    licenseExpression: 'LGPL-3.0-or-later',
    licenseText: { path: 'third-party/libvips/LGPL-3.0-or-later.txt', sha256: sha256(licenseText) },
    noticeText: { text: noticeText, sha256: sha256(noticeText) },
    source: {
      url: 'https://example.invalid/vips-8.17.3.tar.xz',
      version: '8.17.3',
      path: 'third-party/libvips/vips-8.17.3.tar.xz',
      sha256: sha256('verified-source-archive'),
    },
    replaceableLibrary: {
      path: 'third-party/libvips/libvips.so',
      sha256: sha256('replaceable-library'),
      dynamic: true,
      replaceable: true,
    },
    replacementProcedure: { text: 'Replace the separate shared library and restart the application.', separateFile: true },
    reverseEngineeringRestrictionsProhibited: true,
  };
  const evidenceDir = join(libvipsDir, '@img');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'sharp-libvips-darwin-arm64.evidence.json'), JSON.stringify(evidence));
  const components = pythonPins.map(([name, version]) => {
    const hash = sha256(`${name}@${version}`);
    return {
      type: 'library', name, version, purl: `pkg:pypi/${name}@${version}`,
      licenses: [{ license: { id: 'MIT' } }],
      hashes: [{ alg: 'SHA-256', content: hash }],
      externalReferences: [{ type: 'distribution', url: `https://pypi.org/project/${name}/${version}/`, hashes: [{ alg: 'SHA-256', content: hash }] }],
      properties: [{ name: 'ccc:license-source', value: 'https://pypi.org/' }],
    };
  });
  const lockPath = join(artifactDir, 'third-party/python-requirements-ml.lock.json');
  writeFileSync(lockPath, JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'E10-1',
    sourceRequirements: 'apps/pipeline/requirements-ml.txt',
    complete: true,
    components: components.map((component) => ({
      name: component.name, version: component.version, purl: component.purl,
      license: 'MIT', licenseSource: 'https://pypi.org/',
      hashes: component.hashes, distributionHashes: component.externalReferences[0].hashes,
    })),
  }));
  if (tamperPython) {
    components[1].properties = [{ name: 'ccc:license-source', value: 'https://evil.invalid/' }];
    components[1].hashes = [{ alg: 'SHA-256', content: '0'.repeat(64) }];
    components[1].externalReferences[0].hashes = [{ alg: 'SHA-256', content: '0'.repeat(64) }];
  }
  writeFileSync(join(thirdParty, 'python-sbom.cdx.json'), JSON.stringify({
    bomFormat: 'CycloneDX', specVersion: '1.7', components,
  }));
  return lockPath;
}

function formalConditional(lockPath) {
  const policy = JSON.parse(readFileSync(join(repoRoot, 'supply-chain/conditional-license-obligations.json'), 'utf8'));
  policy.pythonDependencySbom.lockPath = lockPath;
  policy.obligations[0].sourceArchiveVersion = '8.17.3';
  policy.obligations[0].sourceArchiveUrl = 'https://example.invalid/vips-8.17.3.tar.xz';
  policy.obligations[0].sourceArchiveSha256 = sha256('verified-source-archive');
  return policy;
}

const formalSharpSbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.7',
  components: [{
    type: 'library',
    group: '@img',
    name: 'sharp-libvips-darwin-arm64',
    version: '1.2.4',
    purl: 'pkg:npm/%40img/sharp-libvips-darwin-arm64@1.2.4',
  }],
};
const formalSharpEvidence = {
  schemaVersion: 1,
  components: [{
    name: '@img/sharp-libvips-darwin-arm64',
    version: '1.2.4',
    license: 'LGPL-3.0-or-later',
    source: 'https://sharp.pixelplumbing.com',
  }],
};
function runVerifier(directory, { sbom = safeSbom, generate = false, secretStatus = 0, modelManifest, conditionalManifest, artifactDir, lockfile, crossEvidence, licenseInventoryOverride } = {}) {
  const sbomPath = join(directory, 'bom.json');
  const scanner = join(directory, 'fake-gitleaks');
  writeFileSync(scanner, `#!/bin/sh\nexit ${secretStatus}\n`);
  chmodSync(scanner, 0o755);
  const licensesPath = join(directory, 'licenses.json');
  const licenses = {};
  for (const component of sbom.components ?? []) {
    const license = component.licenses?.[0]?.expression ?? component.licenses?.[0]?.license?.id;
    if (typeof license !== 'string') continue;
    const packageName = typeof component.purl === 'string' && component.purl.startsWith('pkg:npm/')
      ? decodeURIComponent(component.purl.slice('pkg:npm/'.length).split('@')[0])
      : component.group && !component.name.startsWith('@') ? `${component.group}/${component.name}` : component.name;
    (licenses[license] ??= []).push({
      name: packageName,
      versions: [component.version],
    });
  }
  writeFileSync(licensesPath, JSON.stringify(licenseInventoryOverride ?? licenses));
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
test('rejects an unknown SPDX exception instead of treating it as the base license', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          name: 'exception-package',
          version: '1.0.0',
          licenses: [{ expression: 'MIT WITH Proprietary-exception' }],
        }],
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SPDX license가 표기되지 않거나 허용되지 않음/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('uses independent package metadata instead of supplied SBOM license claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  try {
    const result = runVerifier(directory, {
      sbom: {
        bomFormat: 'CycloneDX',
        specVersion: '1.7',
        components: [{
          type: 'library',
          name: 'spoofed-license-package',
          version: '1.0.0',
          licenses: [{ expression: 'GPL-3.0-only' }],
        }],
      },
      licenseInventoryOverride: {
        MIT: [{ name: 'spoofed-license-package', versions: ['1.0.0'] }],
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
test('accepts complete formal LGPL artifact evidence with bound files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const artifactDir = mkdtempSync(join(tmpdir(), 'ccc-release-artifact-'));
  try {
    const lockPath = writeFormalArtifact(artifactDir);
    const result = runVerifier(directory, {
      artifactDir,
      sbom: formalSharpSbom,
      crossEvidence: formalSharpEvidence,
      conditionalManifest: formalConditional(lockPath),
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

for (const tamper of ['library', 'source', 'python']) {
  test(`rejects tampered formal evidence ${tamper}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
    const artifactDir = mkdtempSync(join(tmpdir(), 'ccc-release-artifact-'));
    try {
      const options = tamper === 'library' ? { tamperLibrary: true }
        : tamper === 'source' ? { tamperSource: true } : { tamperPython: true };
      const lockPath = writeFormalArtifact(artifactDir, options);
      const result = runVerifier(directory, {
        artifactDir,
        sbom: formalSharpSbom,
        crossEvidence: formalSharpEvidence,
        conditionalManifest: formalConditional(lockPath),
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /final artifact license evidence|independent lock/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
}

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
    assert.match(result.stderr, /Python dependency/);
    assert.match(result.stderr, /conditional license obligations/);
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
const hostCpu = process.arch;
const otherCpu = hostCpu === 'arm64' ? 'x64' : 'arm64';
const platformCases = [
  ['os negative installable and missing license fails', 'os', '!win32', false],
  ['os positive and negative contradiction excludes', 'os', 'darwin,!darwin', true],
  ['cpu negative installable and missing license fails', 'cpu', `!${otherCpu}`, false],
  ['cpu negative excludes host cpu', 'cpu', `!${hostCpu}`, true],
  ['libc negative on unknown host stays installable', 'libc', '!not-this-libc', false],
];
for (const [label, field, values, expectedPass] of platformCases) {
  test(`platform constraint: ${label}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
    const lockfile = join(directory, 'fixture-lock.yaml');
    writeFileSync(lockfile, `lockfileVersion: '9.0'

packages:
  '@fixture/native@1.0.0':
    resolution: {}
    ${field}: [${values}]

snapshots:
  '@fixture/native@1.0.0':
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
      assert.equal(result.status === 0, expectedPass, result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('platform constraints use exact package identity rather than substring collisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-release-test-'));
  const lockfile = join(directory, 'fixture-lock.yaml');
  writeFileSync(lockfile, `lockfileVersion: '9.0'

packages:
  '@scope/foo@1.0.0':
    resolution: {}
    os: [!win32]
  notfoo@1.0.0:
    resolution: {}

snapshots:
  '@scope/foo@1.0.0':
    optional: true
  notfoo@1.0.0:
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
          group: '@scope',
          name: 'foo',
          version: '1.0.0',
          licenses: [{ license: { id: 'MIT' } }],
        }],
      },
    });
    assert.equal(result.status, 0, result.stderr);
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
