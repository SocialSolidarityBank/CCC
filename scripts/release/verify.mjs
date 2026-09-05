#!/usr/bin/env node
/**
 * Release supply-chain gate.
 *
 * This command deliberately fails closed: CycloneDX, gitleaks, the license
 * manifest, and the approved fixture scan are all required. A missing tool is
 * an actionable failure, never a skipped check.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const parseSpdx = require('spdx-expression-parse');
const spdxExceptions = require('spdx-exceptions');
const spdxLicenseIds = require('spdx-license-ids');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_ALLOWLIST = join(repoRoot, 'supply-chain/license-allowlist.json');
const DEFAULT_MODEL_MANIFEST = join(repoRoot, 'supply-chain/model-license-manifest.json');
const DEFAULT_NOTICE = join(repoRoot, 'NOTICE');
const DEFAULT_FIXTURE_ROOTS = ['fixtures', 'models', 'scripts/release/fixtures'];
const APPROVED_MANIFESTS = [
  'package.json',
  'pnpm-lock.yaml',
  'supply-chain/license-allowlist.json',
  'supply-chain/model-license-manifest.json',
  'supply-chain/conditional-license-obligations.json',
  'supply-chain/cross-platform-license-evidence.json',
];
const DEFAULT_CONDITIONAL_OBLIGATIONS = join(repoRoot, 'supply-chain/conditional-license-obligations.json');
const DEFAULT_CROSS_EVIDENCE = join(repoRoot, 'supply-chain/cross-platform-license-evidence.json');
const PII_MANIFESTS = [
  'supply-chain/license-allowlist.json',
  'supply-chain/model-license-manifest.json',
  'supply-chain/conditional-license-obligations.json',
  'supply-chain/cross-platform-license-evidence.json',
];
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage']);
const REDACTED_ERROR = '출력에 시크릿 값이 포함될 수 있어 원문은 표시하지 않습니다.';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function configuredPath(argumentName, envName, fallback) {
  const value = argumentValue(argumentName) ?? process.env[envName] ?? fallback;
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function fixtureRoots() {
  const configured = process.env.CCC_FIXTURE_ROOTS;
  if (configured === undefined) return DEFAULT_FIXTURE_ROOTS;
  return configured.split(',').map((path) => path.trim()).filter(Boolean);
}
function pnpmCommand() {
  return process.env.PNPM_BIN ?? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
}
function fail(message) {
  console.error(`release:verify 실패: ${message}`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) return { status: null, error: result.error, stdout: '', stderr: '' };
  return {
    status: result.status,
    error: null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label}을 읽을 수 없거나 JSON 형식이 아니다 (${error instanceof Error ? error.message : '알 수 없는 오류'}).`);
  }
}

function ensureFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`${label}이 없다: ${relative(repoRoot, path) || path}`);
  }
}
function ensureDirectory(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`${label}이 없다: ${relative(repoRoot, path) || path}`);
  }
}
function npmComponentName(component) {
  const purl = typeof component?.purl === 'string' ? component.purl : '';
  if (purl.startsWith('pkg:npm/')) {
    const encodedName = purl.slice('pkg:npm/'.length).split(/[?#]/, 1)[0];
    const versionSeparator = encodedName.lastIndexOf('@');
    if (versionSeparator > 0) {
      try {
        return decodeURIComponent(encodedName.slice(0, versionSeparator));
      } catch {
        // Fall through to group/name when a malformed purl is supplied.
      }
    }
  }
  const name = typeof component?.name === 'string' ? component.name : '';
  const group = typeof component?.group === 'string' ? component.group : '';
  return group.length > 0 && !name.startsWith('@') ? `${group}/${name}` : name;
}

function licenseExpressions(component) {
  if (!Array.isArray(component.licenses) || component.licenses.length === 0) return [];
  const expressions = [];
  for (const entry of component.licenses) {
    if (typeof entry?.expression === 'string') {
      expressions.push(entry.expression);
      continue;
    }
    if (typeof entry?.license?.id === 'string') {
      expressions.push(entry.license.id);
      continue;
    }
    return [];
  }
  return expressions;
}

function expressionAllowed(expression, allowedSpdx, allowedExceptions = new Set()) {
  if (typeof expression !== 'string' || expression.length === 0 || /unknown|see license in/i.test(expression)) return false;
  let ast;
  try {
    ast = parseSpdx(expression);
  } catch {
    return false;
  }
  const knownLicenses = new Set(spdxLicenseIds);
  const knownExceptions = new Set(Array.isArray(spdxExceptions) ? spdxExceptions : Object.values(spdxExceptions));
  const evaluate = (node) => {
    if (node.exception !== undefined) {
      return knownExceptions.has(node.exception)
        && allowedExceptions.has(node.exception)
        && knownLicenses.has(node.license)
        && allowedSpdx.has(node.license);
    }
    if (node.license !== undefined) {
      return knownLicenses.has(node.license) && allowedSpdx.has(node.license);
    }
    if (node.conjunction === 'and') return evaluate(node.left) && evaluate(node.right);
    if (node.conjunction === 'or') return evaluate(node.left) || evaluate(node.right);
    return false;
  };
  return evaluate(ast);
}

function licenseInventory() {
  const supplied = process.env.CCC_LICENSES_FILE;
  let data;
  if (supplied !== undefined) {
    const path = isAbsolute(supplied) ? supplied : resolve(repoRoot, supplied);
    ensureFile(path, 'pnpm license inventory');
    data = readJson(path, 'pnpm license inventory');
  } else {
    const result = run(pnpmCommand(), ['licenses', 'list', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error?.code === 'ENOENT') throw new Error('pnpm license inventory를 실행할 수 없다. pnpm 11 이상을 설치하라.');
    if (result.status !== 0 || result.stdout.trim().length === 0) {
      throw new Error(`pnpm licenses list 실패(exit ${result.status ?? 'unknown'}). 설치된 dependency metadata를 확인하라.`);
    }
    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw new Error('pnpm licenses list 결과가 JSON이 아니다.');
    }
  }

  const inventory = new Map();
  for (const [license, value] of Object.entries(data ?? {})) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (typeof entry?.name !== 'string' || !Array.isArray(entry.versions)) continue;
      for (const version of entry.versions) {
        inventory.set(`${entry.name}@${version}`, license);
      }
    }
  }
  return inventory;
}
function crossPlatformInventory(path) {
  ensureFile(path, 'cross-platform license evidence');
  const manifest = readJson(path, 'cross-platform license evidence');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components)) {
    throw new Error('cross-platform license evidence schemaVersion 1/components 배열이 필요하다.');
  }
  const inventory = new Map();
  for (const component of manifest.components) {
    const name = String(component?.name ?? '');
    const version = String(component?.version ?? '');
    if (name.length === 0 || version.length === 0 || typeof component.license !== 'string'
      || component.license.length === 0 || typeof component.source !== 'string'
      || !/^https?:\/\//.test(component.source)) {
      throw new Error(`cross-platform license evidence 항목이 불완전하다: ${name || '<이름 없음>'}@${version || '<버전 없음>'}`);
    }
    const key = `${name}@${version}`;
    const lockPath = process.env.CCC_LOCKFILE ? (isAbsolute(process.env.CCC_LOCKFILE) ? process.env.CCC_LOCKFILE : resolve(repoRoot, process.env.CCC_LOCKFILE)) : join(repoRoot, 'pnpm-lock.yaml');
    const lockLines = existsSync(lockPath) ? readFileSync(lockPath, 'utf8').split('\n') : [];
    const inLockfile = lockLines.some((line) => line === `  '${key}':` || line === `  ${key}:`);
    if (!inLockfile) throw new Error(`cross-platform license evidence가 lockfile에 없는 component를 참조한다: ${key}`);
    if (inventory.has(key)) throw new Error(`cross-platform license evidence 중복 항목: ${key}`);
    inventory.set(key, component.license);
  }
  return inventory;
}


function lockfilePlatformExcludes(name, version) {
  const path = process.env.CCC_LOCKFILE ? (isAbsolute(process.env.CCC_LOCKFILE) ? process.env.CCC_LOCKFILE : resolve(repoRoot, process.env.CCC_LOCKFILE)) : join(repoRoot, 'pnpm-lock.yaml');
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, 'utf8').split('\n');
  let section = null;
  let currentKey = null;
  let metadata = '';
  const metadataByKey = new Map();
  const saveCurrent = () => {
    if (currentKey !== null) {
      metadataByKey.set(currentKey, `${metadataByKey.get(currentKey) ?? ''}${metadata}`);
    }
  };
  for (const line of lines) {
    if (line === 'packages:' || line === 'snapshots:') {
      saveCurrent();
      section = line.slice(0, -1);
      currentKey = null;
      metadata = '';
      continue;
    }
    if (section === null) continue;
    const packageHeader = line.match(/^ {2}(\S.*):$/);
    if (packageHeader) {
      saveCurrent();
      currentKey = packageHeader[1].replace(/^['"]|['"]$/g, '');
      metadata = '';
      continue;
    }
    if (currentKey !== null && /^    \S/.test(line)) metadata += `${line}\n`;
  }
  saveCurrent();

  const target = `${name}@${version}`;
  const entry = [...metadataByKey.entries()]
    .filter(([key]) => key === target || key.startsWith(`${target}(`))
    .map(([, value]) => value)
    .join('\n');
  if (!/^\s+optional:\s*true\s*$/m.test(entry)) return false;
  const values = (field) => {
    const match = entry.match(new RegExp(`^    ${field}: \\[([^\\]]*)\\]$`, 'm'));
    return match ? match[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')) : [];
  };
  const constraintAllows = (constraintValues, hostValues) => {
    const negatives = constraintValues.filter((value) => value.startsWith('!')).map((value) => value.slice(1));
    const positives = constraintValues.filter((value) => !value.startsWith('!'));
    if (hostValues.some((value) => negatives.includes(value))) return false;
    return positives.length === 0 || positives.some((value) => hostValues.includes(value));
  };
  const os = values('os');
  const cpu = values('cpu');
  const libc = values('libc');
  const hostCpu = process.arch === 'x64' ? ['x64', 'amd64'] : [process.arch];
  const hostLibc = process.platform !== 'linux'
    ? []
    : (process.report?.getReport?.().header?.glibcVersionRuntime ? ['glibc'] : ['musl']);
  return !constraintAllows(os, [process.platform])
    || !constraintAllows(cpu, hostCpu)
    || !constraintAllows(libc, hostLibc);
}

function conditionalObligationFor(name, version, obligations) {
  return obligations.find((entry) => name.startsWith(entry.packageNamePrefix) && entry.versions.includes(version)) ?? null;
}

function validateConditionalManifest(path, artifactDir, allowedSpdx, allowedExceptions) {
  ensureFile(path, 'conditional license obligations');
  const manifest = readJson(path, 'conditional license obligations');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.obligations)) {
    throw new Error('conditional license obligations schemaVersion 1/obligations 배열이 필요하다.');
  }
  const violations = [];
  const pythonSbom = manifest.pythonDependencySbom;
  if (pythonSbom?.requiredForFinalArtifact !== true
    || typeof pythonSbom.artifactPath !== 'string'
    || !Array.isArray(pythonSbom.owners)
    || pythonSbom.owners.length === 0) {
    violations.push('Python dependency SBOM의 최종 artifact 요구와 owner가 닫히지 않음');
  } else if (artifactDir !== null) {
    if (typeof pythonSbom.requirementsPath !== 'string' || typeof pythonSbom.lockPath !== 'string') {
      violations.push('Python dependency requirements/lock 경로가 없다');
    }
    const pathValue = artifactEvidencePath(artifactDir, { artifactEvidencePattern: pythonSbom.artifactPath }, '');
    const pythonContent = pathValue !== null && existsSync(pathValue) && lstatSync(pathValue).isFile()
      ? readFileSync(pathValue, 'utf8') : '';
    if (pythonContent.trim().length === 0) {
      violations.push(`Python dependency SBOM artifact evidence가 없다 (owner: ${pythonSbom.owners.join(', ')})`);
    } else {
      try {
        const pythonBom = JSON.parse(pythonContent);
        if (typeof pythonSbom.requirementsPath === 'string' && typeof pythonSbom.lockPath === 'string') {
          const requirementsPath = isAbsolute(pythonSbom.requirementsPath)
            ? pythonSbom.requirementsPath : resolve(repoRoot, pythonSbom.requirementsPath);
          const lockPath = isAbsolute(pythonSbom.lockPath)
            ? pythonSbom.lockPath : resolve(repoRoot, pythonSbom.lockPath);
          validatePythonSbom(pythonBom, requirementsPath, lockPath, allowedSpdx, allowedExceptions, violations);
        }
      } catch {
        violations.push(`Python dependency SBOM JSON을 읽을 수 없다 (owner: ${pythonSbom.owners.join(', ')})`);
      }
    }
  }
  for (const obligation of manifest.obligations) {
    const requiredStrings = [
      'packageNamePrefix', 'license', 'licenseText', 'noticeText', 'sourceUrl',
      'sourceArchiveVersion', 'sourceArchiveUrl', 'sourceArchiveSha256',
      'canonicalLicenseTextPath', 'canonicalLicenseTextSha256', 'artifactEvidencePattern',
    ];
    for (const field of requiredStrings) {
      if (typeof obligation[field] !== 'string' || obligation[field].length === 0) {
        violations.push(`${obligation.packageNamePrefix ?? '<package>'}: ${field}가 없다`);
      }
    }
    if (!validSha256(obligation.sourceArchiveSha256)
      || !validSha256(obligation.canonicalLicenseTextSha256)) {
      violations.push(`${obligation.packageNamePrefix ?? '<package>'}: canonical/source SHA-256 pin이 유효하지 않음`);
    }
    if (!Array.isArray(obligation.versions) || obligation.versions.length === 0) {
      violations.push(`${obligation.packageNamePrefix ?? '<package>'}: versions가 비어 있다`);
    }
    if (obligation.dynamicSeparateFileRequired !== true
      || obligation.replaceabilityRequired !== true
      || obligation.reverseEngineeringRestrictionsProhibited !== true) {
      violations.push(`${obligation.packageNamePrefix ?? '<package>'}: LGPL 동적 분리·교체 가능·역분석 제한 금지 의무가 완결되지 않음`);
    }
    if (!Array.isArray(obligation.finalArtifactEvidenceOwners) || obligation.finalArtifactEvidenceOwners.length === 0) {
      violations.push(`${obligation.packageNamePrefix ?? '<package>'}: 최종 artifact 증거 owner가 없다`);
    }
  }
  if (violations.length > 0) throw new Error(`conditional license obligations 위반:\\n  ${violations.join('\\n  ')}`);
  if (artifactDir !== null) ensureDirectory(artifactDir, 'release artifact directory');
  return manifest.obligations;
}

function artifactEvidencePath(artifactDir, obligation, name) {
  const relativePath = obligation.artifactEvidencePattern.replaceAll('{name}', name);
  if (relativePath.includes('..') || relativePath.startsWith('/')) return null;
  return join(artifactDir, relativePath);
}
function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function artifactFile(artifactDir, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.includes('..') || relativePath.startsWith('/')) return null;
  try {
    const root = realpathSync(artifactDir);
    const rawCandidate = join(root, relativePath);
    const candidate = realpathSync(rawCandidate);
    const escaped = relative(root, candidate);
    if (isAbsolute(escaped) || escaped === '..' || escaped.startsWith(`..${sep}`) || escaped.startsWith('../')) return null;
    if (!lstatSync(rawCandidate).isFile() || !lstatSync(candidate).isFile()) return null;
    return candidate;
  } catch {
    return null;
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateConditionalEvidence(content, name, version, obligation, artifactDir, violations) {
  let evidence;
  try {
    evidence = JSON.parse(content);
  } catch {
    violations.push(`${name}@${version}: final artifact license evidence가 JSON이 아니다`);
    return;
  }
  const packageName = evidence?.package?.name;
  const packageVersion = evidence?.package?.version;
  const licenseText = evidence?.licenseText;
  const noticeText = evidence?.noticeText;
  const source = evidence?.source;
  const library = evidence?.replaceableLibrary;
  const procedure = evidence?.replacementProcedure;
  const bundledLicenseFile = artifactFile(artifactDir, licenseText?.path);
  const canonicalLicensePath = typeof obligation.canonicalLicenseTextPath === 'string'
    ? resolve(repoRoot, obligation.canonicalLicenseTextPath) : null;
  const canonicalLicenseHash = canonicalLicensePath !== null && existsSync(canonicalLicensePath)
    && lstatSync(canonicalLicensePath).isFile() ? sha256File(canonicalLicensePath) : null;
  const text = bundledLicenseFile === null ? '' : readFileSync(bundledLicenseFile, 'utf8');
  const notice = typeof noticeText?.text === 'string' ? noticeText.text : '';
  const libraryFile = artifactFile(artifactDir, library?.path);
  const sourceFile = artifactFile(artifactDir, source?.path);
  const libraryHash = libraryFile === null ? null : sha256File(libraryFile);
  const sourceHash = sourceFile === null ? null : sha256File(sourceFile);
  if (evidence?.schemaVersion !== 1 || packageName !== name || packageVersion !== version
    || evidence.licenseExpression !== obligation.license
    || canonicalLicenseHash !== obligation.canonicalLicenseTextSha256
    || bundledLicenseFile === null || sha256File(bundledLicenseFile) !== canonicalLicenseHash
    || !validSha256(licenseText?.sha256) || licenseText.sha256 !== canonicalLicenseHash
    || notice !== obligation.noticeText
    || !validSha256(noticeText?.sha256) || sha256Hex(notice) !== noticeText.sha256.toLowerCase()
    || source?.url !== obligation.sourceArchiveUrl || source?.version !== obligation.sourceArchiveVersion
    || sourceFile === null || !validSha256(source?.sha256)
    || sourceHash !== obligation.sourceArchiveSha256 || sourceHash !== source.sha256.toLowerCase()
    || libraryFile === null || library?.dynamic !== true || library?.replaceable !== true
    || !validSha256(library?.sha256) || libraryHash !== library.sha256.toLowerCase()
    || typeof procedure?.text !== 'string' || procedure.text.trim().length < 20
    || procedure.separateFile !== true
    || evidence.reverseEngineeringRestrictionsProhibited !== true) {
    violations.push(`${name}@${version}: final artifact license evidence가 LGPL 전문·고지·정확한 source·교체 가능한 별도 library를 증명하지 못함`);
  }
}
function validatePythonSbom(
  pythonBom,
  requirementsPath,
  lockPath,
  allowedSpdx,
  allowedExceptions,
  violations,
) {
  if (pythonBom?.bomFormat !== 'CycloneDX' || !['1.5', '1.6', '1.7'].includes(String(pythonBom.specVersion))
    || !Array.isArray(pythonBom.components) || pythonBom.components.length === 0) {
    violations.push('Python dependency SBOM이 유효한 CycloneDX 문서가 아니다');
    return;
  }
  ensureFile(requirementsPath, 'pinned Python requirements');
  ensureFile(lockPath, 'Python dependency lock evidence');
  const lock = readJson(lockPath, 'Python dependency lock evidence');
  if (lock.schemaVersion !== 1 || lock.complete !== true || !Array.isArray(lock.components)
    || lock.components.length === 0) {
    violations.push('Python dependency lock evidence가 없거나 E10-1 생성이 완료되지 않음');
    return;
  }
  const normalizePythonName = (value) => value.toLowerCase().replace(/[-_.]+/g, '-');
  const requirements = readFileSync(requirementsPath, 'utf8').split('\n')
    .map((line) => line.replace(/#.*/, '').trim()).filter(Boolean);
  const expectedRoots = new Set();
  for (const line of requirements) {
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)==([^;\s]+)$/);
    if (!match) {
      violations.push(`pinned Python requirements 항목이 고정되지 않음: ${line}`);
    } else {
      expectedRoots.add(`${normalizePythonName(match[1])}@${match[2]}`);
    }
  }
  const hashes = (entries) => (entries ?? [])
    .map((hash) => `${hash?.alg}:${hash?.content}`)
    .sort();
  const identity = (component) => {
    const purl = typeof component?.purl === 'string' ? component.purl : '';
    const rawName = purl.startsWith('pkg:pypi/')
      ? decodeURIComponent(purl.slice('pkg:pypi/'.length).split('@')[0])
      : String(component?.name ?? '');
    return `${normalizePythonName(rawName)}@${String(component?.version ?? '')}`;
  };
  const lockByKey = new Map(lock.components.map((component) => [
    `${normalizePythonName(component?.name ?? '')}@${String(component?.version ?? '')}`, component,
  ]));
  const actualKeys = new Set();
  for (const component of pythonBom.components) {
    const key = identity(component);
    if (actualKeys.has(key)) violations.push(`Python dependency SBOM 중복 component: ${key}`);
    actualKeys.add(key);
    const expected = lockByKey.get(key);
    const expressions = licenseExpressions(component);
    const sourceProperty = (component.properties ?? []).find((entry) => entry?.name === 'ccc:license-source');
    const distribution = (component.externalReferences ?? []).find((entry) => entry?.type === 'distribution');
    if (expected === undefined
      || component.purl !== expected.purl
      || expressions.length !== 1 || expressions[0] !== expected.license
      || !expressionAllowed(expressions[0], allowedSpdx, allowedExceptions)
      || sourceProperty?.value !== expected.licenseSource
      || JSON.stringify(hashes(component.hashes)) !== JSON.stringify(hashes(expected.hashes))
      || JSON.stringify(hashes(distribution?.hashes)) !== JSON.stringify(hashes(expected.distributionHashes))) {
      violations.push(`Python dependency ${key}: independent lock identity/license/source/hash mismatch`);
    }
  }
  for (const [key] of lockByKey) {
    if (!actualKeys.has(key)) violations.push(`Python dependency SBOM에 lock component가 없다: ${key}`);
  }
  for (const key of expectedRoots) {
    if (!actualKeys.has(key)) violations.push(`Python dependency SBOM에 pinned dependency가 없다: ${key}`);
  }
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function validateSbom(
  sbomPath,
  allowedSpdx,
  allowedExceptions,
  conditionalPath,
  crossEvidencePath,
  artifactDir,
  authoritativeSbomPath = sbomPath,
) {
  const obligations = validateConditionalManifest(conditionalPath, artifactDir, allowedSpdx, allowedExceptions);
  const crossEvidence = crossPlatformInventory(crossEvidencePath);
  const bom = readJson(sbomPath, 'CycloneDX SBOM');
  const authoritativeBom = readJson(authoritativeSbomPath, 'authoritative CycloneDX SBOM');
  if (bom.bomFormat !== 'CycloneDX' || typeof bom.specVersion !== 'string'
    || authoritativeBom.bomFormat !== 'CycloneDX' || typeof authoritativeBom.specVersion !== 'string') {
    throw new Error('CycloneDX SBOM이 아니거나 specVersion이 없다.');
  }
  if (!Array.isArray(bom.components) || bom.components.length === 0
    || !Array.isArray(authoritativeBom.components) || authoritativeBom.components.length === 0) {
    throw new Error('CycloneDX SBOM에 dependency component가 없다.');
  }

  // SBOM license fields are untrusted artifact claims. Resolve policy licenses
  // from package-manager metadata and separately reviewed platform evidence.
  const inventory = licenseInventory();
  const violations = [];
  const skippedOptional = [];
  const usedCrossEvidence = new Set();
  for (const component of bom.components) {
    const name = npmComponentName(component) || '<이름 없음>';
    const version = String(component?.version ?? '<버전 없음>');
    const key = `${name}@${version}`;
    const inventoryLicense = inventory.get(key);
    const crossLicense = crossEvidence.get(key);
    if (crossLicense !== undefined) usedCrossEvidence.add(key);
    if (inventoryLicense !== undefined && crossLicense !== undefined && inventoryLicense !== crossLicense) {
      violations.push(`${name}@${version}: 독립 license evidence가 일치하지 않음`);
      continue;
    }
    const resolved = inventoryLicense !== undefined
      ? [inventoryLicense]
      : (crossLicense !== undefined ? [crossLicense] : []);
    if (lockfilePlatformExcludes(name, version)) {
      skippedOptional.push(`${name}@${version}`);
      continue;
    }
    const conditional = conditionalObligationFor(name, version, obligations);
    const conditionalMatch = conditional !== null
      && resolved.length > 0
      && resolved.every((expression) => expression === conditional.license);
    if (conditional !== null && !conditionalMatch) {
      violations.push(`${name}@${version}: conditional license evidence가 ${conditional.license}와 일치하지 않음`);
      continue;
    }
    if (conditionalMatch) {
      if (artifactDir !== null) {
        const evidencePath = artifactEvidencePath(artifactDir, conditional, name);
        const evidenceContent = evidencePath !== null && existsSync(evidencePath)
          && lstatSync(evidencePath).isFile() ? readFileSync(evidencePath, 'utf8') : '';
        if (evidencePath === null || evidenceContent.trim().length === 0) {
          violations.push(`${name}@${version}: final artifact license evidence가 없다`);
        } else {
          validateConditionalEvidence(evidenceContent, name, version, conditional, artifactDir, violations);
        }
      }
      continue;
    }
    if (resolved.length === 0 || resolved.some((expression) => !expressionAllowed(
      expression,
      allowedSpdx,
      allowedExceptions,
    ))) {
      if (lockfilePlatformExcludes(name, version)) {
        skippedOptional.push(`${name}@${version}`);
      } else {
        violations.push(`${name}@${version}: SPDX license가 표기되지 않거나 허용되지 않음 (독립 evidence 없음)`);
      }
    }
  }
  for (const key of crossEvidence.keys()) {
    if (!usedCrossEvidence.has(key)) violations.push(`cross-platform license evidence가 현재 SBOM에 없거나 필요하지 않다: ${key}`);
  }
  if (artifactDir !== null && existsSync(join(artifactDir, 'third-party/libvips'))
    && !bom.components.some((component) => npmComponentName(component).startsWith('@img/sharp-libvips-'))) {
    violations.push('bundled libvips가 SBOM에 없고 final artifact license evidence도 없다');
  }
  if (violations.length > 0) {
    throw new Error(`dependency license allowlist 위반:\n  ${violations.join('\n  ')}`);
  }
  return { count: bom.components.length, skippedOptional };
}

function validateModels(manifestPath, allowedSpdx, allowedExceptions) {
  const manifest = readJson(manifestPath, 'model license manifest');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models)) {
    throw new Error('model license manifest schemaVersion 1/models 배열이 필요하다.');
  }
  if (manifest.models.length === 0) {
    throw new Error('model license manifest가 비어 있다. 현재 runtime 모델을 모두 기록하라.');
  }
  const violations = [];
  const requiredRuntimeModels = new Set([
    'openai/whisper@medium',
    'Systran/faster-whisper-medium@medium',
    'pyannote/speaker-diarization-3.1@3.1',
    'pyannote/segmentation-3.0@3.0',
    'jungjongho/wav2vec2-xlsr-korean-speech-emotion-recognition@latest-approved',
    'LimYeri/HowRU-KoELECTRA-Emotion-Classifier@latest-approved',
    'FrameByFrame/korean-pii-e5-base@latest-approved',
  ]);
  const manifestModels = new Set(manifest.models.map((model) => `${model?.name}@${model?.version}`));
  for (const required of requiredRuntimeModels) {
    if (!manifestModels.has(required)) violations.push(`runtime model manifest에 필수 모델이 없다: ${required}`);
  }
  for (const model of manifest.models) {
    const name = String(model?.name ?? '<이름 없음>');
    const version = String(model?.version ?? '<버전 없음>');
    const license = model?.license;
    if (typeof license !== 'string' || license.length === 0) {
      violations.push(`${name}@${version}: license가 표기되지 않음`);
      continue;
    }
    if (!expressionAllowed(license, allowedSpdx, allowedExceptions)) {
      violations.push(`${name}@${version}: 허용되지 않은 license ${license}`);
    }
    if (typeof model.source !== 'string' || model.source.length === 0) {
      violations.push(`${name}@${version}: license 출처(source)가 없다`);
    }
    if (typeof model.revision !== 'string' || !/^[a-f0-9]{40}$/i.test(model.revision)) {
      violations.push(`${name}@${version}: revision이 고정되지 않음`);
    }
    if (name === 'openai/whisper'
      && (typeof model.checkpointUrl !== 'string'
        || !/^https?:\/\//.test(model.checkpointUrl)
        || typeof model.checkpointSha256 !== 'string'
        || !/^[a-f0-9]{64}$/i.test(model.checkpointSha256))) {
      violations.push(`${name}@${version}: checkpoint URL/SHA-256가 고정되지 않음`);
    }
    if (name === 'Systran/faster-whisper-medium'
      && (typeof model.checkpointSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(model.checkpointSha256))) {
      violations.push(`${name}@${version}: candidate checkpoint SHA-256가 고정되지 않음`);
    }
  }
  if (violations.length > 0) throw new Error(`model license allowlist 위반:\n  ${violations.join('\n  ')}`);
  return manifest.models.length;
}

function trackedFiles() {
  const result = run('git', ['ls-files', '-z'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error('tracked source 목록을 얻지 못했다. git 저장소에서 실행하라.');
  return result.stdout.split('\0').filter(Boolean);
}

function isApprovedPath(path) {
  return fixtureRoots().some((root) => path === root || path.startsWith(`${root}/`))
    || APPROVED_MANIFESTS.includes(path);
}

function copyTrackedSnapshot(targetRoot) {
  const paths = trackedFiles();
  for (const path of paths) {
    const source = join(repoRoot, path);
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    const destination = join(targetRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }

  // Include newly-created approved fixture/manifest files before they are
  // tracked, while never broadening the source snapshot to arbitrary files.
  for (const root of [...fixtureRoots(), 'supply-chain']) {
    const sourceRoot = join(repoRoot, root);
    if (!existsSync(sourceRoot)) continue;
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        const source = join(directory, entry.name);
        if (entry.isDirectory()) walk(source);
        else if (entry.isFile()) {
          const path = relative(repoRoot, source).split(sep).join('/');
          if (!isApprovedPath(path)) continue;
          const destination = join(targetRoot, path);
          mkdirSync(dirname(destination), { recursive: true });
          cpSync(source, destination);
        }
      }
    };
    walk(sourceRoot);
  }
  return paths.length;
}

function fixtureFiles() {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const root of fixtureRoots()) visit(join(repoRoot, root));
  for (const path of PII_MANIFESTS) {
    const absolute = join(repoRoot, path);
    if (existsSync(absolute) && lstatSync(absolute).isFile()) files.push(absolute);
  }
  return files;
}

function validateFixtures() {
  const patterns = [
    { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu, label: 'email' },
    { pattern: /(?:\+?82[- .]?)?01[016789][- .]?\d{3,4}[- .]?\d{4}/u, label: '전화번호' },
    { pattern: /\b\d{6}[- ]?[1-4]\d{6}\b/u, label: '주민등록번호 형태' },
  ];
  const violations = [];
  for (const path of fixtureFiles()) {
    const content = readFileSync(path, 'utf8');
    for (const { pattern, label } of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = content.slice(0, match.index).split('\n').length;
        violations.push(`${relative(repoRoot, path)}:${line}: ${label} 형태`);
      }
    }
  }
  if (violations.length > 0) throw new Error(`fixture/manifest PII 검사 실패:\n  ${violations.join('\n  ')}`);
  return fixtureFiles().length;
}

function runSecretScan() {
  const snapshot = mkdtempSync(join(tmpdir(), 'ccc-release-scan-'));
  try {
    const trackedCount = copyTrackedSnapshot(snapshot);
    if (trackedCount === 0) throw new Error('tracked source가 없어 secret scan을 실행할 수 없다.');
    const scanner = process.env.GITLEAKS_BIN ?? 'gitleaks';
    const result = run(
      scanner,
      ['dir', '--config', join(repoRoot, '.gitleaks.toml'), '--no-banner', '--redact', snapshot],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error?.code === 'ENOENT') {
      throw new Error(`gitleaks가 설치돼 있지 않다. 설치: brew install gitleaks (또는 GITLEAKS_BIN 지정)`);
    }
    if (result.status !== 0) {
      if (result.status === 1) throw new Error(`gitleaks가 secret으로 보이는 값을 발견했다. ${REDACTED_ERROR}`);
      throw new Error(`gitleaks 실행 실패(exit ${result.status ?? 'unknown'}). 설치와 설정을 확인하라.`);
    }
    return trackedCount;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function generateSbom(outputPath) {
  const result = run(
    pnpmCommand(),
    ['sbom', '--sbom-format', 'cyclonedx', '--sbom-spec-version', '1.7', '--lockfile-only'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error?.code === 'ENOENT') {
    throw new Error('pnpm SBOM 생성기를 실행할 수 없다. pnpm 11 이상을 설치하라.');
  }
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error(`CycloneDX SBOM 생성 실패(exit ${result.status ?? 'unknown'}). 생성기를 건너뛰지 않았다.`);
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error('pnpm SBOM 생성 결과가 JSON이 아니다.');
  }
  writeFileSync(outputPath, result.stdout);
}

function componentIdentity(component) {
  return typeof component?.purl === 'string' && component.purl.length > 0
    ? component.purl
    : `${npmComponentName(component)}@${String(component?.version ?? '')}`;
}

function distributionReferences(component) {
  return (component.externalReferences ?? [])
    .filter((entry) => entry?.type === 'distribution')
    .map((entry) => ({
      type: entry.type,
      url: entry.url,
      hashes: (entry.hashes ?? []).map((hash) => ({ alg: hash.alg, content: hash.content }))
        .sort((left, right) => `${left.alg}:${left.content}`.localeCompare(`${right.alg}:${right.content}`)),
    }))
    .sort((left, right) => `${left.url}`.localeCompare(`${right.url}`));
}

function compareSuppliedSbom(suppliedPath, currentPath) {
  const supplied = readJson(suppliedPath, 'supplied CycloneDX SBOM');
  const current = readJson(currentPath, 'current CycloneDX SBOM');
  const index = (bom, label) => {
    if (!Array.isArray(bom.components)) throw new Error(`${label} component 배열이 없다.`);
    const map = new Map();
    for (const component of bom.components) {
      const key = componentIdentity(component);
      if (map.has(key)) throw new Error(`${label} component identity가 중복된다: ${key}`);
      map.set(key, component);
    }
    return map;
  };
  const suppliedComponents = index(supplied, 'supplied SBOM');
  const currentComponents = index(current, 'current SBOM');
  const suppliedKeys = [...suppliedComponents.keys()].sort();
  const currentKeys = [...currentComponents.keys()].sort();
  if (JSON.stringify(suppliedKeys) !== JSON.stringify(currentKeys)) {
    throw new Error('supplied SBOM dependency component 집합이 현재 pnpm lockfile SBOM과 다르다.');
  }
  for (const key of currentKeys) {
    const expected = currentComponents.get(key);
    const actual = suppliedComponents.get(key);
    if (actual.purl !== expected.purl
      || actual.name !== expected.name
      || actual.version !== expected.version
      || actual.group !== expected.group) {
      throw new Error(`supplied SBOM component identity/purl이 현재 lockfile과 다르다: ${key}`);
    }
    if (JSON.stringify(distributionReferences(actual)) !== JSON.stringify(distributionReferences(expected))) {
      throw new Error(`supplied SBOM distribution externalReference hash가 현재 lockfile과 다르다: ${key}`);
    }
  }
}

function main() {
  try {
    const allowlistPath = configuredPath('--allowlist', 'CCC_LICENSE_ALLOWLIST', DEFAULT_ALLOWLIST);
    const modelManifestPath = configuredPath('--model-manifest', 'CCC_MODEL_LICENSE_MANIFEST', DEFAULT_MODEL_MANIFEST);
    const noticePath = configuredPath('--notice', 'CCC_NOTICE', DEFAULT_NOTICE);
    const conditionalPath = configuredPath('--conditional-license-obligations', 'CCC_CONDITIONAL_LICENSE_OBLIGATIONS', DEFAULT_CONDITIONAL_OBLIGATIONS);
    const crossEvidencePath = configuredPath('--cross-evidence', 'CCC_CROSS_EVIDENCE', DEFAULT_CROSS_EVIDENCE);
    const artifactValue = argumentValue('--artifact-dir') ?? process.env.CCC_RELEASE_ARTIFACT_DIR ?? null;
    const artifactDir = artifactValue === null ? null : (isAbsolute(artifactValue) ? artifactValue : resolve(repoRoot, artifactValue));
    ensureFile(conditionalPath, 'conditional license obligations');
    ensureFile(allowlistPath, 'license allowlist');
    ensureFile(noticePath, 'NOTICE');
    if (readFileSync(noticePath, 'utf8').trim().length === 0) throw new Error('NOTICE가 비어 있다.');
    const allowlist = readJson(allowlistPath, 'license allowlist');
    if (allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.allowedSpdx)) {
      throw new Error('license allowlist schemaVersion 1/allowedSpdx 배열이 필요하다.');
    }
    const allowedSpdx = new Set(allowlist.allowedSpdx);
    if (allowedSpdx.size === 0) throw new Error('license allowlist가 비어 있다.');
    const allowedExceptions = new Set(allowlist.allowedSpdxExceptions ?? []);
    if (!Array.isArray(allowlist.allowedSpdxExceptions ?? [])
      || [...allowedExceptions].some((exception) => !Object.hasOwn(spdxExceptions, exception))) {
      throw new Error('license allowlist allowedSpdxExceptions가 유효하지 않다.');
    }

    const suppliedSbom = argumentValue('--sbom') ?? process.env.CCC_SBOM_FILE;
    let sbomPath = suppliedSbom ? configuredPath('--sbom', 'CCC_SBOM_FILE', suppliedSbom) : null;
    let authoritativeSbomPath = sbomPath;
    let tempOutput = null;
    if (sbomPath === null) {
      tempOutput = mkdtempSync(join(tmpdir(), 'ccc-release-sbom-'));
      sbomPath = join(tempOutput, 'bom.json');
      authoritativeSbomPath = sbomPath;
      generateSbom(sbomPath);
    } else {
      ensureFile(sbomPath, 'CycloneDX SBOM');
      tempOutput = mkdtempSync(join(tmpdir(), 'ccc-release-current-sbom-'));
      authoritativeSbomPath = join(tempOutput, 'bom.json');
      generateSbom(authoritativeSbomPath);
      compareSuppliedSbom(sbomPath, authoritativeSbomPath);
    }

    try {
      const dependencyResult = validateSbom(
        sbomPath,
        allowedSpdx,
        allowedExceptions,
        conditionalPath,
        crossEvidencePath,
        artifactDir,
        authoritativeSbomPath,
      );
      const modelCount = validateModels(modelManifestPath, allowedSpdx, allowedExceptions);
      const fixtureCount = validateFixtures();
      const scannedCount = runSecretScan();
      const skipped = dependencyResult.skippedOptional.length;
      console.log(`release:verify 통과 — SBOM dependency ${dependencyResult.count}개, model ${modelCount}개, fixture/manifest ${fixtureCount}개, tracked file ${scannedCount}개 검사${skipped > 0 ? ` (호스트 외 optional ${skipped}개 제외)` : ''}.`);
    } finally {
      if (tempOutput) rmSync(tempOutput, { recursive: true, force: true });
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : '알 수 없는 오류');
  }
}

main();
