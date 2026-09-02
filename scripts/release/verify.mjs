#!/usr/bin/env node
/**
 * Release supply-chain gate.
 *
 * This command deliberately fails closed: CycloneDX, gitleaks, the license
 * manifest, and the approved fixture scan are all required. A missing tool is
 * an actionable failure, never a skipped check.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
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

function expressionAllowed(expression, allowedSpdx) {
  if (typeof expression !== 'string' || expression.length === 0 || /unknown|see license in/i.test(expression)) return false;
  const tokenPattern = /\s*(\(|\)|AND\b|OR\b|WITH\b|[A-Za-z0-9][A-Za-z0-9.+-]*)/gy;
  const tokens = [];
  let offset = 0;
  while (offset < expression.length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(expression);
    if (match === null) return false;
    tokens.push(match[1]);
    offset = tokenPattern.lastIndex;
  }
  let cursor = 0;
  const parsePrimary = () => {
    if (tokens[cursor] === '(') {
      cursor += 1;
      const node = parseOr();
      if (tokens[cursor] !== ')') throw new Error('unbalanced SPDX expression');
      cursor += 1;
      return node;
    }
    const id = tokens[cursor];
    if (id === undefined || ['AND', 'OR', 'WITH', ')'].includes(id)) throw new Error('invalid SPDX expression');
    cursor += 1;
    return { kind: 'license', id };
  };
  const parseWith = () => {
    const base = parsePrimary();
    if (tokens[cursor] === 'WITH') {
      cursor += 1;
      const exception = tokens[cursor];
      if (exception === undefined || ['AND', 'OR', 'WITH', '(', ')'].includes(exception)) throw new Error('invalid SPDX exception');
      cursor += 1;
      return { kind: 'with', base, exception };
    }
    return base;
  };
  const parseAnd = () => {
    let node = parseWith();
    while (tokens[cursor] === 'AND') {
      cursor += 1;
      node = { kind: 'and', left: node, right: parseWith() };
    }
    return node;
  };
  const parseOr = () => {
    let node = parseAnd();
    while (tokens[cursor] === 'OR') {
      cursor += 1;
      node = { kind: 'or', left: node, right: parseAnd() };
    }
    return node;
  };
  try {
    const ast = parseOr();
    if (cursor !== tokens.length) return false;
    const evaluate = (node) => {
      if (node.kind === 'license') return allowedSpdx.has(node.id);
      if (node.kind === 'with') return evaluate(node.base);
      if (node.kind === 'and') return evaluate(node.left) && evaluate(node.right);
      return evaluate(node.left) || evaluate(node.right);
    };
    return evaluate(ast);
  } catch {
    return false;
  }
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
  for (const [license, entries] of Object.entries(data ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const version of entry.versions ?? []) {
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

  const entry = [...metadataByKey.entries()]
    .filter(([key]) => key.includes(`${name}@${version}`))
    .map(([, value]) => value)
    .join('\n');
  if (!/^\s+optional:\s*true\s*$/m.test(entry)) return false;
  const values = (field) => {
    const match = entry.match(new RegExp(`^    ${field}: \\[([^\\]]*)\\]$`, 'm'));
    return match ? match[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')) : [];
  };
  const os = values('os');
  const cpu = values('cpu');
  const libc = values('libc');
  const hostCpu = process.arch === 'x64' ? ['x64', 'amd64'] : [process.arch];
  const hostLibc = process.platform !== 'linux'
    ? []
    : (process.report?.getReport?.().header?.glibcVersionRuntime ? ['glibc'] : ['musl']);
  return (os.length > 0 && !os.includes(process.platform))
    || (cpu.length > 0 && !cpu.some((value) => hostCpu.includes(value)))
    || (libc.length > 0 && !libc.some((value) => hostLibc.includes(value)));
}

function conditionalObligationFor(name, version, obligations) {
  return obligations.find((entry) => name.startsWith(entry.packageNamePrefix) && entry.versions.includes(version)) ?? null;
}

function validateConditionalManifest(path, artifactDir) {
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
    const pathValue = artifactEvidencePath(artifactDir, { artifactEvidencePattern: pythonSbom.artifactPath }, '');
    const pythonContent = pathValue !== null && existsSync(pathValue) && lstatSync(pathValue).isFile()
      ? readFileSync(pathValue, 'utf8') : '';
    if (pythonContent.trim().length === 0) {
      violations.push(`Python dependency SBOM artifact evidence가 없다 (owner: ${pythonSbom.owners.join(', ')})`);
    } else {
      try {
        const pythonBom = JSON.parse(pythonContent);
        if (pythonBom.bomFormat !== 'CycloneDX' || typeof pythonBom.specVersion !== 'string'
          || !Array.isArray(pythonBom.components) || pythonBom.components.length === 0) {
          violations.push(`Python dependency SBOM이 유효한 CycloneDX 문서가 아니다 (owner: ${pythonSbom.owners.join(', ')})`);
        }
      } catch {
        violations.push(`Python dependency SBOM JSON을 읽을 수 없다 (owner: ${pythonSbom.owners.join(', ')})`);
      }
    }
  }
  for (const obligation of manifest.obligations) {
    const requiredStrings = ['packageNamePrefix', 'license', 'licenseText', 'noticeText', 'sourceUrl', 'artifactEvidencePattern'];
    for (const field of requiredStrings) {
      if (typeof obligation[field] !== 'string' || obligation[field].length === 0) {
        violations.push(`${obligation.packageNamePrefix ?? '<package>'}: ${field}가 없다`);
      }
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
function validateSbom(sbomPath, allowedSpdx, conditionalPath, crossEvidencePath, artifactDir) {
  const obligations = validateConditionalManifest(conditionalPath, artifactDir);
  const crossEvidence = crossPlatformInventory(crossEvidencePath);
  const bom = readJson(sbomPath, 'CycloneDX SBOM');
  if (bom.bomFormat !== 'CycloneDX' || typeof bom.specVersion !== 'string') {
    throw new Error('CycloneDX SBOM이 아니거나 specVersion이 없다.');
  }
  if (!Array.isArray(bom.components) || bom.components.length === 0) {
    throw new Error('CycloneDX SBOM에 dependency component가 없다.');
  }

  const inventory = bom.components.some((component) => licenseExpressions(component).length === 0)
    ? licenseInventory()
    : new Map();
  const violations = [];
  const skippedOptional = [];
  const usedCrossEvidence = new Set();
  for (const component of bom.components) {
    const name = npmComponentName(component) || '<이름 없음>';
    const version = String(component?.version ?? '<버전 없음>');
    const key = `${name}@${version}`;
    const expressions = licenseExpressions(component);
    const inventoryLicense = inventory.get(key);
    const crossLicense = crossEvidence.get(key);
    if (expressions.length === 0 && inventoryLicense === undefined && crossLicense !== undefined) {
      usedCrossEvidence.add(key);
    }
    const resolved = expressions.length > 0 ? expressions : [inventoryLicense ?? crossLicense];
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
        if (evidencePath === null || evidenceContent.trim().length === 0
          || !evidenceContent.includes(conditional.license)) {
          violations.push(`${name}@${version}: final artifact license evidence가 없거나 license text가 없다`);
        }
      }
      continue;
    }
    if (resolved.some((expression) => !expressionAllowed(expression, allowedSpdx))) {
      if (lockfilePlatformExcludes(name, version)) {
        skippedOptional.push(`${name}@${version}`);
      } else {
        violations.push(`${name}@${version}: SPDX license가 표기되지 않거나 허용되지 않음`);
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

function validateModels(manifestPath, allowedSpdx) {
  ensureFile(manifestPath, 'model license manifest');
  const manifest = readJson(manifestPath, 'model license manifest');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models)) {
    throw new Error('model license manifest schemaVersion 1/models 배열이 필요하다.');
  }
  if (manifest.models.length === 0) {
    throw new Error('model license manifest가 비어 있다. 현재 runtime 모델을 모두 기록하라.');
  }
  const violations = [];
  for (const model of manifest.models) {
    const name = String(model?.name ?? '<이름 없음>');
    const version = String(model?.version ?? '<버전 없음>');
    const license = model?.license;
    if (typeof license !== 'string' || license.length === 0) {
      violations.push(`${name}@${version}: license가 표기되지 않음`);
      continue;
    }
    if (!expressionAllowed(license, allowedSpdx)) {
      violations.push(`${name}@${version}: 허용되지 않은 license ${license}`);
    }
    if (typeof model.source !== 'string' || model.source.length === 0) {
      violations.push(`${name}@${version}: license 출처(source)가 없다`);
    }
    if (typeof model.revision !== 'string' || model.revision.length === 0) {
      violations.push(`${name}@${version}: revision이 고정되지 않음`);
    }
    if (name === 'openai/whisper'
      && (typeof model.checkpointUrl !== 'string'
        || !/^https?:\/\//.test(model.checkpointUrl)
        || typeof model.checkpointSha256 !== 'string'
        || !/^[a-f0-9]{64}$/i.test(model.checkpointSha256))) {
      violations.push(`${name}@${version}: checkpoint URL/SHA-256가 고정되지 않음`);
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
  return `${npmComponentName(component)}@${String(component?.version ?? '')}`;
}

function compareSuppliedSbom(suppliedPath, currentPath) {
  const supplied = readJson(suppliedPath, 'supplied CycloneDX SBOM');
  const current = readJson(currentPath, 'current CycloneDX SBOM');
  const suppliedComponents = new Map((supplied.components ?? []).map((component) => [componentIdentity(component), component]));
  const currentComponents = new Map((current.components ?? []).map((component) => [componentIdentity(component), component]));
  const suppliedKeys = [...suppliedComponents.keys()].sort();
  const currentKeys = [...currentComponents.keys()].sort();
  if (JSON.stringify(suppliedKeys) !== JSON.stringify(currentKeys)) {
    throw new Error('supplied SBOM dependency component 집합이 현재 pnpm lockfile SBOM과 다르다.');
  }
  for (const key of currentKeys) {
    const expected = currentComponents.get(key);
    const actual = suppliedComponents.get(key);
    if (expected.purl !== undefined && actual.purl !== expected.purl) {
      throw new Error(`supplied SBOM purl이 현재 lockfile과 다르다: ${key}`);
    }
    if (Array.isArray(expected.hashes)
      && JSON.stringify(actual.hashes ?? []) !== JSON.stringify(expected.hashes)) {
      throw new Error(`supplied SBOM integrity가 현재 lockfile과 다르다: ${key}`);
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

    const suppliedSbom = argumentValue('--sbom') ?? process.env.CCC_SBOM_FILE;
    let sbomPath = suppliedSbom ? configuredPath('--sbom', 'CCC_SBOM_FILE', suppliedSbom) : null;
    let tempOutput = null;
    if (sbomPath === null) {
      tempOutput = mkdtempSync(join(tmpdir(), 'ccc-release-sbom-'));
      sbomPath = join(tempOutput, 'bom.json');
      generateSbom(sbomPath);
    } else {
      ensureFile(sbomPath, 'CycloneDX SBOM');
      tempOutput = mkdtempSync(join(tmpdir(), 'ccc-release-current-sbom-'));
      const currentSbomPath = join(tempOutput, 'bom.json');
      generateSbom(currentSbomPath);
      compareSuppliedSbom(sbomPath, currentSbomPath);
    }

    try {
      const dependencyResult = validateSbom(sbomPath, allowedSpdx, conditionalPath, crossEvidencePath, artifactDir);
      const modelCount = validateModels(modelManifestPath, allowedSpdx);
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
