import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { assertAuthorizationCurrent, assertAuthorizationMatches, hashCanonical } from './manifest-preflight.mjs';
import { compareProviderInventory } from './provider-baseline.mjs';
import { installedDatabaseFingerprint } from './install-journal.mjs';

export const expectedSupabaseResources = Object.freeze([
  { kind: 'installation-journal', name: 'private.ccc_install_journal' },
  { kind: 'resource-ownership', name: 'private.ccc_install_resources' },
  { kind: 'migration-ledger', name: 'private.ccc_schema_migrations' },
  { kind: 'database-baseline', name: 'migrations/postgres/0001_baseline.sql and checksum-pinned forward migrations' },
  { kind: 'database-role', name: 'ccc_api (restricted LOGIN, no owner or BYPASSRLS privileges)' },
  { kind: 'database-owner', name: 'ccc_schema_owner (NOLOGIN)' },
  { kind: 'rls-policy-set', name: 'tenant RLS, protected parents and security-invoker views' },
  { kind: 'auth-policy', name: 'CCC invitation and all-human MFA' },
  { kind: 'business-runtime', name: 'independent Community Cloud runtime (D89)' },
  { kind: 'storage-bucket', name: 'ccc-audio (private)' },
  { kind: 'scheduler', name: 'ccc_scheduler_tick' },
  { kind: 'retention-contract', name: 'D85: delete after processing; deadline min(first opportunity + 24 hours, upload + 7 days)' },
]);

/** Local source inventory only. This is not an installed ledger or permission to apply SQL. */
export function postgresMigrationPlan() {
  try {
    const directory = new URL('../../migrations/postgres/', import.meta.url);
    const parity = JSON.parse(readFileSync(new URL('../../migrations/parity.yaml', import.meta.url), 'utf8'));
    const sources = parity.checkpoints.flatMap(checkpoint => checkpoint.postgres.sources);
    const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
    if (sources.length !== names.length || sources.some((source, index) => source.name !== names[index])) {
      throw new PlanFailure('MIGRATION_CHECKSUM_MISMATCH');
    }
    return sources.map(source => {
      if (!/^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(source.name) || !/^[a-f0-9]{64}$/.test(source.sha256)) {
        throw new PlanFailure('MIGRATION_CHECKSUM_MISMATCH');
      }
      const checksum = createHash('sha256').update(readFileSync(new URL(source.name, directory))).digest('hex');
      if (checksum !== source.sha256) throw new PlanFailure('MIGRATION_CHECKSUM_MISMATCH');
      return { id: source.name, checksum };
    });
  } catch {
    throw new PlanFailure('MIGRATION_CHECKSUM_MISMATCH');
  }
}

const safeFailures = Object.freeze({
  CREDENTIAL_MISSING: 'Supabase 접근 자격증명이 없습니다.',
  CREDENTIAL_INVALID: 'Supabase 접근 자격증명이 유효하지 않습니다.',
  CREDENTIAL_INSUFFICIENT: 'Supabase 읽기 권한이 부족합니다.',
  PROJECT_REF_MISSING: 'Supabase 프로젝트 식별자가 없습니다.',
  PROVIDER_UNREADABLE: 'Supabase의 현재 상태를 읽지 못했습니다.',
  LOCAL_SUPABASE_UNAVAILABLE: '로컬 Supabase 상태를 읽지 못했습니다.',
  OUTPUT_REDACTION_FAILED: '안전한 출력 형식을 만들지 못했습니다.',
  OPERATION_UNSUPPORTED: '지원하지 않는 설치 동작 또는 인자입니다.',
  TARGET_UNSUPPORTED: 'target은 local 또는 hosted여야 합니다.',
  OWNER_EVIDENCE_MISSING: '서명된 기관 소유 승인과 프로젝트 연결 증거가 없습니다.',
  AUTH_CONFIRMATION_REQUIRED: 'Auth 가 가입 확인 메일을 요구합니다. 초대 수락이 계정을 바로 결속하려면 확인을 꺼야 합니다.',
  MANIFEST_VERIFIER_UNAVAILABLE: 'Community Cloud manifest 검증 모듈을 먼저 빌드해야 합니다.',
  MIGRATION_CHECKSUM_MISMATCH: '마이그레이션 파일과 정본의 파일별 체크섬이 일치하지 않습니다.',
  CA_TRUST_UNAVAILABLE: '애플리케이션 전용 CA 파일과 프로세스 신뢰 설정을 확인하지 못했습니다.',
  BETA_TRUST_INVALID: '개발판 신뢰 문서가 유효하지 않습니다. 외부 root 설정, 서명, 폐기 상태와 만료를 확인합니다.',
  PROVIDER_BASELINE_INVALID: '공급자 기준선이 유효하지 않습니다. 서명, 범위와 만료를 확인합니다.',
  PROVIDER_BASELINE_MISMATCH: '공급자 기준선과 현재 프로젝트 구성이 다릅니다.',
  OWNER_MISMATCH: '관찰한 프로젝트 소유자가 서명된 설치 승인과 다릅니다.',
  INSTALL_AUTHORIZATION_MISMATCH: '재개 또는 재승인 문서가 기존 설치의 서명 결합과 다릅니다.',
  INSTALL_LOCK_BUSY: '같은 프로젝트의 다른 설치 작업이 진행 중입니다.',
  RESOURCE_OWNERSHIP_MISMATCH: '설치 journal과 자원 소유권이 일치하지 않습니다.',
  PLAN_STATE_CHANGED: '읽기 전용 계획 이후 프로젝트 상태가 달라졌습니다.',
  DRIFT_DETECTED: '설치 영수증과 현재 자원 상태가 다릅니다.',
  DRIFT_BLOCKED: '현재 설치 상태가 journal과 달라 변경을 멈췄습니다.',
  INSTALL_NOT_FOUND: '이 설치의 journal 또는 영수증이 없습니다.',
  INSTALL_INCOMPLETE: '설치 단계가 완료되지 않았습니다.',
  RELEASE_PREREQUISITES_MISSING: '승인된 S12 릴리스 원본, 고정 trust/floor와 서명된 플랫폼 artifact가 필요합니다.',
  RELEASE_SUPERSEDED: '설치된 릴리스보다 새로운 묶음이 고정 원본에 있습니다(차단 사유가 아닙니다).',
  ROLLBACK_PREREQUISITES_MISSING: 'S12 rollback 승인과 E6-7의 검증된 백업 및 복원 실행기가 필요합니다.',
  INSTALL_JOURNAL_INVALID: '설치 journal의 구조나 현재 상태가 유효하지 않습니다.',
  INSTALL_JOURNAL_MISSING: '검증된 설치 journal이 없습니다.',
  INSTALL_STEP_MISMATCH: '설치 단계의 idempotency key 또는 상태가 다릅니다.',
  MIGRATION_APPLY_FAILED: '마이그레이션 transaction이 실패했으며 해당 변경은 반영되지 않았습니다.',
  HEALTH_FAILED: '승격한 설치 상태의 읽기 전용 확인을 통과하지 못했습니다.',
  RUNTIME_NOT_READY: '설치는 끝났고 업무 runtime이 아직 기동하지 않았습니다(차단 사유가 아닙니다).',
  EDGE_COMPONENT_DEPLOYER_UNAVAILABLE: '이 설치기가 적용할 수 없는 Edge component가 포함되어 있습니다.',
  EDGE_BUNDLE_LIMIT: 'Edge 함수 묶음이 배포 한도를 넘었습니다.',
});

export class PlanFailure extends Error {
  constructor(code) {
    super(safeFailures[code] ?? 'Supabase 사전 점검을 완료하지 못했습니다.');
    this.name = 'PlanFailure';
    this.code = safeFailures[code] === undefined ? 'PROVIDER_UNREADABLE' : code;
  }
}

const blockerDetails = Object.freeze({
  REGION_UNVERIFIED: {
    message: '운영 프로젝트의 서울 리전 증거를 확인하지 못했습니다.',
    recovery: 'Supabase 프로젝트 설정에서 서울 리전을 확인할 수 있는 권한으로 다시 실행합니다.',
  },
  REGION_MISMATCH: {
    message: '운영 프로젝트가 서울 리전이 아닙니다.',
    recovery: '변경하지 말고 승인된 기존 프로젝트와 리전 증거를 Main에서 다시 확인합니다.',
  },
  EXISTING_PROJECT_NOT_CLEAN: {
    message: '검증된 S11 설치 소유권 없이 기존 표나 기관 데이터가 있습니다.',
    recovery: '새 프로젝트를 만들거나 기존 자료를 지우지 말고 Main에서 소유 승인과 기존 설치 이력을 검토합니다.',
  },
  RESOURCE_OWNERSHIP_MISMATCH: {
    message: '기존 ledger만으로는 S11 journal과 자원 소유권을 증명할 수 없습니다.',
    recovery: '기존 프로젝트를 변경하지 말고 승인 manifest, journal과 자원별 소유 tag를 먼저 대조합니다.',
  },
  OWNER_EVIDENCE_MISSING: {
    message: '현재 기관에 대해 유효한 설치 승인과 서명 결합을 확인하지 못했습니다.',
    recovery: '외부에서 구성한 기관별 trust와 두 서명 문서의 만료 및 폐기 상태를 확인합니다.',
  },
  AUTH_CONFIRMATION_REQUIRED: {
    message: 'Auth 가 가입 확인 메일을 요구해 초대 수락이 계정을 결속하지 못합니다.',
    recovery: 'Supabase Auth 에서 가입 확인(mailer autoconfirm)을 켜 확인 메일 없이 세션이 서게 한 뒤 다시 실행합니다. 초대 토큰과 검증된 subject 가 연결 근거입니다(D90).',
  },
  PROVIDER_BASELINE_MISMATCH: {
    message: '공급자 기준선과 현재 프로젝트 구성이 다릅니다.',
    recovery: '프로젝트를 변경하지 말고 공급자 구성과 서명된 기준선 버전을 다시 대조합니다.',
  },
  CONNECTION_NOT_READ_ONLY: {
    message: '읽기 전용 연결을 확인하지 못했습니다.',
    recovery: 'database_read 권한과 읽기 전용 점검 경로를 확인한 뒤 다시 실행합니다.',
  },
  STATE_CHANGED_DURING_PLAN: {
    message: '계획을 읽는 동안 프로젝트 상태가 달라졌습니다.',
    recovery: '다른 변경 작업이 끝난 뒤 plan을 다시 실행합니다.',
  },
});

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const LEGACY_CLEANLINESS_GRANT_KINDS = new Set(['schema', 'relation', 'column', 'default', 'role']);
// 승인된 마이그레이션이 만드는 설치 소유 역할. 이 역할의 멤버십은 공급자 기준선이 아니라
// 설치 증거로 확인한다.
const INSTALLATION_ROLES = new Set(['ccc_api', 'ccc_schema_owner']);
// apply의 provider 단계가 소유를 기록하는 자원 종류. 이 목록에 없는 종류는 설치가 만든
// 자원이 아니므로 소유권을 인정하지 않는다.
const INSTALLATION_RESOURCE_TYPES = new Set([
  'storage_bucket', 'cron_job', 'edge_secret_binding', 'edge_function',
]);
const INSTALL_PHASES = new Set(['planned', 'installing', 'installed', 'rollback_failed']);
const INSTALL_STEPS = new Set([
  'baseline', 'platform_migration', 'auth_config', 'storage_bucket', 'cron_job',
  'edge_secret_binding', 'api_credential', 'receipt', 'prepare_backup', 'verify_manifest',
  'restore_data', 'restore_provider_metadata', 'switch_release', 'verify_receipt',
]);

const VERIFIED_PROVIDER_BASELINE_KEYS = [
  'baselineVersion', 'projectRefSha256', 'ownerOrgIdSha256', 'region',
  'databaseVersion', 'objects', 'grants', 'objectInventorySha256',
  'grantInventorySha256', 'baselineSha256', 'releaseTrustSha256', 'expiresAt',
].sort();

function isVerifiedProviderBaseline(value, authorization) {
  return isRecord(value)
    && Object.keys(value).sort().join('\0') === VERIFIED_PROVIDER_BASELINE_KEYS.join('\0')
    && typeof value.baselineVersion === 'string' && value.baselineVersion.length > 0
    && value.projectRefSha256 === authorization?.projectRefHash
    && value.ownerOrgIdSha256 === authorization?.expectedOwnerOrgIdHash
    && value.region === 'ap-northeast-2'
    && typeof value.databaseVersion === 'string' && value.databaseVersion.length > 0
    && Array.isArray(value.objects) && Array.isArray(value.grants)
    && SHA256_HEX.test(value.objectInventorySha256)
    && SHA256_HEX.test(value.grantInventorySha256)
    && SHA256_HEX.test(value.baselineSha256)
    && SHA256_HEX.test(value.releaseTrustSha256)
    && typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt));
}

export function assertProviderBaselineCurrent(value, authorization, now = Date.now()) {
  const currentTime = now instanceof Date ? now.getTime() : now;
  if (!isVerifiedProviderBaseline(value, authorization)
    || !Number.isFinite(currentTime)
    || currentTime >= Date.parse(value.expiresAt)) {
    throw new PlanFailure('PROVIDER_BASELINE_INVALID');
  }
}

function inventoryKey(record, grant = false) {
  return JSON.stringify(grant
    ? [
        record.kind, record.schema, record.objectIdentity, record.grantor,
        record.grantee, record.privilege, record.grantable,
        record.inheritOption, record.setOption,
      ]
    : [record.kind, record.schema, record.identity]);
}

function withoutProvedRecords(observed, proved, grant = false) {
  const indexed = new Map(proved.map(record => [inventoryKey(record, grant), record]));
  return observed.filter(record => {
    const candidate = indexed.get(inventoryKey(record, grant));
    return candidate === undefined || !isDeepStrictEqual(candidate, record);
  });
}

async function reconciledProviderInventory(snapshot) {
  const raw = snapshot.providerInventory;
  const completeObjectCount = snapshot.state?.providerObjectCount;
  const completeGrantCount = snapshot.state?.providerGrantCount;
  if (!Array.isArray(raw?.objects) || !Array.isArray(raw?.grants)
    || !Number.isSafeInteger(completeObjectCount) || completeObjectCount < 0
    || !Number.isSafeInteger(completeGrantCount) || completeGrantCount < 0
    || raw.objects.length !== completeObjectCount || raw.grants.length !== completeGrantCount) {
    return { inventory: raw, objectCount: null, grantCount: null };
  }
  const installationObjects = raw.installationObjects ?? [];
  const installationGrants = raw.installationGrants ?? [];
  if (!Array.isArray(installationObjects) || !Array.isArray(installationGrants)
    || installationObjects.length > completeObjectCount
    || installationGrants.length > completeGrantCount) {
    return { inventory: raw, objectCount: null, grantCount: null };
  }
  if (installationObjects.length === 0 && installationGrants.length === 0) {
    return { inventory: raw, objectCount: completeObjectCount, grantCount: completeGrantCount };
  }
  if (!SHA256_HEX.test(snapshot.databaseFingerprint)
    || installedDatabaseFingerprint(snapshot.installState) !== snapshot.databaseFingerprint) {
    return { inventory: raw, objectCount: completeObjectCount, grantCount: completeGrantCount };
  }
  const objects = withoutProvedRecords(raw.objects, installationObjects);
  const grants = withoutProvedRecords(raw.grants, installationGrants, true);
  if (objects.length !== completeObjectCount - installationObjects.length
    || grants.length !== completeGrantCount - installationGrants.length) {
    return { inventory: raw, objectCount: null, grantCount: null };
  }
  const comparableGrants = grants.filter(grant => !withinInstallationAuthority(grant));
  return {
    inventory: {
      objects,
      grants: comparableGrants,
      objectInventorySha256: await hashCanonical(objects),
      grantInventorySha256: await hashCanonical(comparableGrants),
    },
    // 청결도 대조는 설치가 만든 기록만 뺀 집합으로 센다. 권한 공간 제외는 기준선
    // 대조에만 쓴다.
    cleanlinessInventory: { objects, grants },
    objectCount: objects.length,
    grantCount: comparableGrants.length,
    authorityScoped: true,
  };
}

function providerObjectCleanlinessMatches(state, inventory) {
  if (!Array.isArray(inventory?.objects)) return false;
  const unownedObjects = inventory.objects.filter(record => (
    record.provenance === 'supabase_managed'
      && !(record.kind === 'schema' && record.schema === 'public')
  ));
  const customSchemas = unownedObjects.filter(record => record.kind === 'schema');
  return state?.unownedObjectCount === unownedObjects.length
    && state.unknownObjectCount === unownedObjects.length
    && state.customSchemaCount === customSchemas.length;
}

/**
 * 권한 수 대조는 설치 전 빈 프로젝트에서만 성립한다. 설치 뒤에는 SQL 집계와 목록
 * 분류가 설치 소유 권한을 서로 다른 규칙으로 나누므로 두 수가 같아질 수 없다. 설치 뒤
 * 권한면은 기준선 목록 대조와 영수증 카탈로그 지문이 레코드 단위로 고정한다.
 */
function providerGrantCleanlinessMatches(state, inventory) {
  if (!Array.isArray(inventory?.grants)) return false;
  const unexpectedGrants = inventory.grants.filter(record => (
    LEGACY_CLEANLINESS_GRANT_KINDS.has(record.kind)
      && record.provenance === 'supabase_managed'
      && record.grantee !== `ROLE:${record.grantor}`
  ));
  return state?.unexpectedGrantCount === unexpectedGrants.length;
}

/**
 * 승인된 마이그레이션(0006)이 다시 쓰는 ACL 공간이다. 설치는 public 스키마의 브라우저
 * 역할 권한과 기본권한을 회수하고 자기 역할을 만든다. 회수는 관찰만으로 복원할 수 없어
 * 서명된 공급자 기준선으로는 증명하지 못한다. 이 공간은 설치 영수증의 카탈로그 지문이
 * 그대로 고정하므로, 기준선 대조에서는 관찰과 기준선 양쪽에서 똑같이 뺀다.
 */
function withinInstallationAuthority(grant) {
  return grant.schema === 'public'
    || (grant.kind === 'default' && grant.grantee === `ROLE:${grant.grantor}`)
    || (grant.kind === 'role' && INSTALLATION_ROLES.has(grant.objectIdentity));
}

async function installationAuthorityScopedBaseline(providerBaseline) {
  const grants = providerBaseline.grants.filter(grant => !withinInstallationAuthority(grant));
  return {
    ...providerBaseline,
    grants,
    grantInventorySha256: await hashCanonical(grants),
  };
}

async function providerBaselineComparison(snapshot, providerBaseline) {
  const reconciled = await reconciledProviderInventory(snapshot);
  const baseline = reconciled.authorityScoped
    ? await installationAuthorityScopedBaseline(providerBaseline)
    : providerBaseline;
  const comparison = compareProviderInventory(baseline, reconciled.inventory);
  return {
    ...comparison,
    inventory: reconciled.inventory,
    objectCleanlinessMatched: providerObjectCleanlinessMatches(
      snapshot.state,
      reconciled.cleanlinessInventory ?? reconciled.inventory,
    ),
    cleanlinessMatched: providerObjectCleanlinessMatches(snapshot.state, reconciled.inventory)
      && providerGrantCleanlinessMatches(snapshot.state, reconciled.inventory),
    matched: comparison.matched
      && snapshot.project.databaseVersion === providerBaseline.databaseVersion
      && reconciled.objectCount === comparison.expectedObjectCount
      && reconciled.grantCount === comparison.expectedGrantCount,
  };
}

function safeProviderBaseline(providerBaseline, comparison) {
  return {
    matched: comparison.matched,
    baselineVersion: providerBaseline.baselineVersion,
    expectedObjectCount: comparison.expectedObjectCount,
    observedObjectCount: comparison.observedObjectCount,
    expectedGrantCount: comparison.expectedGrantCount,
    observedGrantCount: comparison.observedGrantCount,
    objectInventorySha256: comparison.objectInventorySha256,
    grantInventorySha256: comparison.grantInventorySha256,
  };
}

function hasProvedProviderInventory(state, matched) {
  return Number.isSafeInteger(state?.unownedObjectCount)
    && Number.isSafeInteger(state?.unexpectedGrantCount)
    && (matched === undefined
      ? state.unownedObjectCount === 0 && state.unexpectedGrantCount === 0
      : matched);
}

function hasUnownedProjectState(snapshot, providerMatched) {
  const state = snapshot.state;
  return !hasProvedProviderInventory(state, providerMatched)
    || state.userTableCount > 0 || state.userRowEstimate > 0
    || state.rlsEnabledTableCount > 0 || state.policyCount > 0
    || state.authUserCount > 0 || state.bucketCount > 0 || state.storageObjectCount > 0
    || state.userRoutineCount > 0 || state.userTypeCount > 0
    || state.auxiliaryRelationCount > 0 || state.privateSchemaExists
    || (state.privateTableNames?.length ?? 0) > 0 || (snapshot.cronJobCount ?? 0) > 0;
}

/**
 * 설치가 소유를 기록한 자원과 관찰을 대조한다. 설치가 끝난 프로젝트에는 자기 cron job과
 * bucket이 있으므로, 개수를 0으로 요구하지 않고 기록한 소유 자원과 같은지를 본다.
 * edge_function·edge_secret_binding처럼 데이터베이스 관찰에 나타나지 않는 자원은 영수증의
 * providerResourceDigests가 고정한다.
 */
function resourcesMatchObservation(snapshot, state, installationId, providerMatched) {
  const ownershipTag = `ccc.installation_id=${installationId}`;
  if (!hasProvedProviderInventory(snapshot.state, providerMatched)
    || snapshot.state.userTypeCount > 0
    || !Array.isArray(snapshot.state.buckets) || !Array.isArray(state.resources)
    || snapshot.state.bucketCount !== snapshot.state.buckets.length) return false;
  const recorded = new Map();
  for (const resource of state.resources) {
    const key = `${resource?.resourceType}\u0000${resource?.resourceIdHash}`;
    if (!INSTALLATION_RESOURCE_TYPES.has(resource?.resourceType)
      || typeof resource.resourceIdHash !== 'string'
      || recorded.has(key)
      || resource.ownershipTag !== ownershipTag) return false;
    recorded.set(key, resource);
  }
  const ownedOfType = type => [...recorded.values()]
    .filter(resource => resource.resourceType === type).length;
  if (snapshot.state.buckets.length !== ownedOfType('storage_bucket')
    || (snapshot.cronJobCount ?? 0) !== ownedOfType('cron_job')) return false;
  return snapshot.state.buckets.every(bucket => {
    const resource = recorded.get(`storage_bucket\u0000${bucket.resourceIdHash}`);
    return bucket.resourceType === 'storage_bucket'
      && resource?.resourceDigest === bucket.resourceDigest;
  });
}

function safeInstalledSummary(state, migrations) {
  const approvedIds = new Set(migrations.map(migration => migration.id));
  const applied = Array.isArray(state?.migrations)
    ? state.migrations.filter(migration => approvedIds.has(migration?.id))
      .sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const journal = state?.journal;
  return {
    state: INSTALL_PHASES.has(journal?.phase) ? journal.phase : 'unverified',
    migrationHead: applied.at(-1)?.id ?? null,
    runtimeManifestSha256: SHA256_HEX.test(journal?.runtimeManifestSha256)
      ? journal.runtimeManifestSha256
      : null,
    approvalSha256: SHA256_HEX.test(journal?.approvalSha256) ? journal.approvalSha256 : null,
  };
}

function safeCompletedSteps(state) {
  if (!Array.isArray(state?.completedSteps)) return [];
  return state.completedSteps.flatMap(step =>
    INSTALL_STEPS.has(step?.step) && SHA256_HEX.test(step?.idempotencyKey)
      ? [{ step: step.step, idempotencyKey: step.idempotencyKey }]
      : []);
}


function isSeoulRegion(region) {
  return region === 'ap-northeast-2';
}

/**
 * durable 상태 지문은 완전한 공급자 목록을 그대로 덮는다. 설치가 만든 객체와 권한까지
 * 포함해야 설치 뒤의 변경도 지문에 남는다. 기준선 대조용 재조정 집합은 여기에 쓰지 않는다.
 */
export async function installationStateFingerprint(snapshot, providerBaseline) {
  const state = {
    region: snapshot.project.region,
    ownerOrgIdHash: snapshot.project.ownerOrgIdHash ?? null,
    database: snapshot.databaseFingerprint ?? snapshot.state.schemaFingerprint,
    policies: snapshot.state.policyFingerprint,
    buckets: snapshot.state.bucketFingerprint,
    auth: snapshot.state.authFingerprint,
    cron: snapshot.cronJobCount ?? 0,
  };
  if (providerBaseline === undefined) return hashCanonical(state);
  return hashCanonical({
    ...state,
    providerBaselineVersion: providerBaseline.baselineVersion,
    providerBaselineSha256: providerBaseline.baselineSha256,
    providerObjectsSha256: snapshot.providerInventory?.objectInventorySha256,
    providerGrantsSha256: snapshot.providerInventory?.grantInventorySha256,
  });
}

// Counts protect the read-only observation window, not the durable installation
// fingerprint: normal business activity must not become configuration drift.
function observationSafety(snapshot) {
  return {
    connection: snapshot.connection,
    userTableCount: snapshot.state.userTableCount ?? 0,
    userRowEstimate: snapshot.state.userRowEstimate ?? 0,
    rlsEnabledTableCount: snapshot.state.rlsEnabledTableCount ?? 0,
    policyCount: snapshot.state.policyCount ?? 0,
    authUserCount: snapshot.state.authUserCount ?? 0,
    bucketCount: snapshot.state.bucketCount ?? 0,
    storageObjectCount: snapshot.state.storageObjectCount ?? 0,
    userRoutineCount: snapshot.state.userRoutineCount ?? 0,
    userTypeCount: snapshot.state.userTypeCount ?? 0,
    unknownObjectCount: snapshot.state.unknownObjectCount ?? 0,
    customSchemaCount: snapshot.state.customSchemaCount ?? 0,
    auxiliaryRelationCount: snapshot.state.auxiliaryRelationCount ?? 0,
    unownedObjectCount: snapshot.state.unownedObjectCount ?? null,
    unexpectedGrantCount: snapshot.state.unexpectedGrantCount ?? null,
    privateSchemaExists: Boolean(snapshot.state.privateSchemaExists),
    privateTableNames: [...(snapshot.state.privateTableNames ?? [])].sort(),
    legacyLedgerPresent: Boolean(snapshot.state.legacyLedgerPresent),
    audioBucket: snapshot.state.bucket,
    observedBuckets: snapshot.state.buckets ?? [],
    cronJobCount: snapshot.cronJobCount ?? 0,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validRollbackTarget(value) {
  return value === null || (isRecord(value)
    && typeof value.releaseVersion === 'string' && value.releaseVersion.length > 0
    && Number.isSafeInteger(value.releaseSequence) && value.releaseSequence > 0
    && SHA256_HEX.test(value.manifestDigest));
}

function validReceipt(receipt) {
  const evidence = receipt?.edgeRegionEvidence;
  const digests = receipt?.providerResourceDigests;
  const backupValid = (receipt?.backupId === null && receipt?.backupDigest === null)
    || (typeof receipt?.backupId === 'string' && receipt.backupId.length > 0
      && SHA256_HEX.test(receipt.backupDigest));
  return isRecord(receipt)
    && receipt.contract === 'S11' && receipt.contractVersion === '0.3'
    && typeof receipt.installationId === 'string' && receipt.installationId.length > 0
    && SHA256_HEX.test(receipt.institutionIdHash)
    && validRollbackTarget(receipt.rollbackTarget)
    && SHA256_HEX.test(receipt.expectedOwnerOrgIdHash)
    && SHA256_HEX.test(receipt.observedOwnerOrgIdHash)
    && typeof receipt.releaseVersion === 'string' && receipt.releaseVersion.length > 0
    && Number.isSafeInteger(receipt.releaseSequence) && receipt.releaseSequence > 0
    && SHA256_HEX.test(receipt.manifestDigest) && SHA256_HEX.test(receipt.artifactSetDigest)
    && typeof receipt.migrationHead === 'string' && receipt.migrationHead.length > 0
    && SHA256_HEX.test(receipt.schemaFingerprint)
    && isRecord(evidence) && evidence.requestedRegion === 'ap-northeast-2'
    && typeof evidence.responseRegion === 'string' && evidence.responseRegion.length > 0
    && typeof evidence.functionRegion === 'string' && evidence.functionRegion.length > 0
    && typeof evidence.mismatch === 'boolean'
    && isRecord(digests) && Object.entries(digests).every(([key, digest]) =>
      key.length > 0 && SHA256_HEX.test(digest))
    && backupValid
    && (receipt.priorReceiptDigest === null || SHA256_HEX.test(receipt.priorReceiptDigest))
    && typeof receipt.recordedAt === 'string' && !Number.isNaN(Date.parse(receipt.recordedAt))
    && (receipt.status === 'installed' || receipt.status === 'rollback_failed');
}

function receiptBindingsMatch(receipt, state, snapshot, authorization) {
  const journal = state.journal;
  return receipt.installationId === journal?.installationId
    && receipt.installationId === authorization?.installationId
    && receipt.institutionIdHash === journal?.institutionIdHash
    && receipt.institutionIdHash === authorization?.institutionIdHash
    && receipt.expectedOwnerOrgIdHash === journal?.expectedOwnerOrgIdHash
    && receipt.expectedOwnerOrgIdHash === authorization?.expectedOwnerOrgIdHash
    && receipt.observedOwnerOrgIdHash === snapshot.project.ownerOrgIdHash
    && receipt.observedOwnerOrgIdHash === receipt.expectedOwnerOrgIdHash;
}

function appliedMigrationsComplete(state, migrations) {
  if (!Array.isArray(state.migrations) || state.migrations.length !== migrations.length) return false;
  const applied = [...state.migrations].sort((left, right) => String(left?.id).localeCompare(String(right?.id)));
  return applied.every((entry, index) =>
    entry?.id === migrations[index].id && entry?.checksum === migrations[index].checksum);
}

function providerDigestsMatch(receipt, state) {
  if (!Array.isArray(state.resources)) return false;
  const recorded = state.resources.map(resource =>
    [resource?.resourceIdHash, resource?.resourceDigest])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  return recorded.every(([id, digest], index) =>
    SHA256_HEX.test(id) && SHA256_HEX.test(digest)
      && (index === 0 || id !== recorded[index - 1][0]))
    && JSON.stringify(recorded)
      === JSON.stringify(Object.entries(receipt.providerResourceDigests)
        .sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * The receipt records only the bundle-level version/sequence and the manifest
 * digest, so the proof doctor can rebuild is exactly that: the installed
 * manifest digest is indexed for this family in the currently signed, pinned
 * and trust-verified bundle, at the version and sequence the receipt claims.
 * The artifact-set digest lives inside the archived Edge component manifest,
 * which doctor never downloads; the signed bundle row carries the document
 * digest instead, so it is checked for presence, not equality.
 */
function releaseReceiptVerdict(receipt, release) {
  const bundle = release?.bundle;
  if (!isRecord(bundle) || !Array.isArray(release?.rows)) return 'RELEASE_PREREQUISITES_MISSING';
  const row = release.rows.find(candidate => candidate?.family === 'community-cloud-cli'
    && candidate?.manifestSha256 === receipt.manifestDigest);
  if (row === undefined || !SHA256_HEX.test(row.edgeComponentManifestSha256 ?? '')) {
    return 'RELEASE_PREREQUISITES_MISSING';
  }
  if (!/^[1-9][0-9]*$/u.test(String(bundle.sequence ?? ''))) return 'RELEASE_PREREQUISITES_MISSING';
  const sequence = BigInt(bundle.sequence);
  if (bundle.version === receipt.releaseVersion
    && sequence === BigInt(receipt.releaseSequence)) return null;
  // 고정 원본이 더 나아갔을 때만 안내다. 같은 순번의 다른 판이나 과거로의 이동은 차단한다.
  return sequence > BigInt(receipt.releaseSequence) ? 'RELEASE_SUPERSEDED' : 'RELEASE_PREREQUISITES_MISSING';
}

async function doctorReceiptIssues(snapshot, state, authorization, migrations, release) {
  let incomplete = state.journal?.phase !== 'installed';
  let drift = false;
  const receipt = state.currentReceipt;
  if (!validReceipt(receipt) || receipt.status !== 'installed') {
    incomplete = true;
  } else {
    if (!receiptBindingsMatch(receipt, state, snapshot, authorization)) incomplete = true;
    if (!appliedMigrationsComplete(state, migrations)
      || receipt.migrationHead !== migrations.at(-1)?.id) incomplete = true;
    // 설치 완료 뒤의 durable 카탈로그는 영수증의 schemaFingerprint다. journal의
    // database_fingerprint는 마지막 마이그레이션 시점 값이므로 현재 관찰과 같을 수 없다.
    if (!SHA256_HEX.test(snapshot.databaseFingerprint)
      || !SHA256_HEX.test(state.journal?.databaseFingerprint)) {
      incomplete = true;
    } else if (receipt.schemaFingerprint !== snapshot.databaseFingerprint
      || installedDatabaseFingerprint(state) !== snapshot.databaseFingerprint) {
      drift = true;
    }
    if (!providerDigestsMatch(receipt, state)) drift = true;
    if (receipt.edgeRegionEvidence.mismatch
      || receipt.edgeRegionEvidence.responseRegion !== receipt.edgeRegionEvidence.requestedRegion
      || receipt.edgeRegionEvidence.functionRegion !== receipt.edgeRegionEvidence.requestedRegion) drift = true;

    const history = state.releaseHistory;
    if (!Array.isArray(history) || history.length === 0
      || history.some(item => !validReceipt(item) || !receiptBindingsMatch(item, state, snapshot, authorization))) {
      incomplete = true;
    } else {
      const ordered = [...history].sort((left, right) => left.releaseSequence - right.releaseSequence);
      const unique = new Set(ordered.map(item => item.releaseSequence));
      const matching = ordered.filter(item => item.releaseSequence === receipt.releaseSequence);
      if (unique.size !== ordered.length || ordered.at(-1)?.releaseSequence !== receipt.releaseSequence
        || matching.length !== 1
        || await hashCanonical(matching[0]) !== await hashCanonical(receipt)) incomplete = true;
    }
  }

  // 검증된 릴리스 index가 없으면 durable 메타데이터가 아무리 일관되어도 릴리스 승인이 아니다.
  const verdict = incomplete ? null : releaseReceiptVerdict(receipt, release);
  return {
    issues: [
      ...(incomplete ? ['INSTALL_INCOMPLETE'] : []),
      ...(verdict === 'RELEASE_PREREQUISITES_MISSING' ? ['RELEASE_PREREQUISITES_MISSING'] : []),
      ...(drift ? ['DRIFT_DETECTED'] : []),
    ],
    notices: verdict === 'RELEASE_SUPERSEDED'
      ? [{ code: 'RELEASE_SUPERSEDED', detail: release.bundle.bundleId }]
      : [],
  };
}

/** Observations contain no credentials or source documents; authority is verified separately. */
export async function buildSupabasePlan({
  target,
  inspector,
  authorization,
  providerBaseline,
  renewAuthorization = false,
  now = Date.now,
}) {
  if (target !== 'hosted' && target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (target === 'hosted') {
    assertAuthorizationCurrent(authorization);
    assertProviderBaselineCurrent(providerBaseline, authorization, now());
  }
  const migrations = postgresMigrationPlan();
  const migrationsSha256 = await hashCanonical(migrations);
  let before;
  let after;
  try {
    before = await inspector.inspect();
    if (target === 'hosted') {
      assertAuthorizationCurrent(authorization);
      assertProviderBaselineCurrent(providerBaseline, authorization, now());
    }
    after = await inspector.inspect();
    if (target === 'hosted') {
      assertAuthorizationCurrent(authorization);
      assertProviderBaselineCurrent(providerBaseline, authorization, now());
    }
  } catch (error) {
    throw new PlanFailure(error?.code ?? (target === 'local' ? 'LOCAL_SUPABASE_UNAVAILABLE' : 'PROVIDER_UNREADABLE'));
  }
  const beforeProvider = target === 'hosted'
    ? await providerBaselineComparison(before, providerBaseline)
    : undefined;
  const afterProvider = target === 'hosted'
    ? await providerBaselineComparison(after, providerBaseline)
    : undefined;
  const providerMatched = target === 'hosted'
    ? beforeProvider.matched && afterProvider.matched
    : undefined;
  const providerCleanlinessMatched = target === 'hosted'
    ? providerMatched && beforeProvider.cleanlinessMatched && afterProvider.cleanlinessMatched
    : undefined;
  // 설치가 기록한 자원 소유권은 객체 청결도까지 증명된 목록에서만 인정한다.
  const providerOwnershipMatched = target === 'hosted'
    ? providerMatched && beforeProvider.objectCleanlinessMatched
      && afterProvider.objectCleanlinessMatched
    : undefined;
  // 서명된 기준선의 목록 해시를 결합한다. 관찰이 기준선과 같아야 계획이 통과하므로 값은
  // 첫 설치 때와 같고, 설치가 끝난 뒤 재검증에서도 journal에 적힌 값과 계속 맞는다.
  const resourcesSha256 = target === 'local'
    ? await hashCanonical(expectedSupabaseResources)
    : await hashCanonical({
        resources: expectedSupabaseResources,
        providerBaselineVersion: providerBaseline.baselineVersion,
        providerBaselineSha256: providerBaseline.baselineSha256,
        providerObjectsSha256: providerBaseline.objectInventorySha256,
        providerGrantsSha256: providerBaseline.grantInventorySha256,
      });
  const blockers = [];
  const deny = code => blockers.push({ code, ...(blockerDetails[code] ?? { message: new PlanFailure(code).message, recovery: '변경하지 말고 승인된 설치 입력과 journal을 확인합니다.' }) });
  if (![before, after].every(value => value.connection.readOnly && value.connection.databaseReadable
    && value.connection.authReadable && value.connection.storageReadable)) deny('CONNECTION_NOT_READ_ONLY');
  if (target === 'hosted') {
    if (![before, after].every(value => isSeoulRegion(value.project.region))) deny('REGION_MISMATCH');
    if (![before, after].every(value => value.project.ownerOrgIdHash === authorization.expectedOwnerOrgIdHash)) deny('OWNER_MISMATCH');
    // D90 초대 결속은 수락자가 방금 만든 세션으로 자기 subject 를 증명한다. 확인 메일을
    // 요구하는 설치는 세션이 서지 않아 결속이 불가능하므로 설치 자체를 막는다(S2 §2.2).
    if (![before, after].every(value => value.auth?.emailConfirmationRequired === false)) {
      deny('AUTH_CONFIRMATION_REQUIRED');
    }
  }
  if (providerMatched === false) deny('PROVIDER_BASELINE_MISMATCH');
  const stateFingerprint = await installationStateFingerprint(before, providerBaseline);
  const afterStateFingerprint = await installationStateFingerprint(after, providerBaseline);
  const state = before.installState;
  if (!state) {
    if ([before, after].some(snapshot => snapshot.state.legacyLedgerPresent
      || snapshot.installed.ledger === 'present')) deny('RESOURCE_OWNERSHIP_MISMATCH');
    else if ([before, after].some(snapshot => hasUnownedProjectState(snapshot, providerCleanlinessMatched))) deny('EXISTING_PROJECT_NOT_CLEAN');
  } else {
    try {
      const changedPair = state.journal.runtimeManifestSha256 !== authorization.runtimeManifestSha256
        || state.journal.approvalSha256 !== authorization.approvalSha256;
      assertAuthorizationMatches(state.journal, authorization, {
        renewAuthorization: renewAuthorization && changedPair, resourcesSha256, migrationsSha256,
      });
      if (!INSTALL_PHASES.has(state.journal.phase)
        || !SHA256_HEX.test(state.journal.stateFingerprint)) deny('INSTALL_JOURNAL_INVALID');
      else if (state.journal.stateFingerprint !== stateFingerprint
        || state.journal.stateFingerprint !== afterStateFingerprint) deny('DRIFT_BLOCKED');
      const durableFingerprint = installedDatabaseFingerprint(state);
      if (durableFingerprint
        && ![before, after].every(snapshot =>
          durableFingerprint === snapshot.databaseFingerprint)) deny('DRIFT_BLOCKED');
      if (!Array.isArray(state.migrations)
        || state.migrations.some(entry => typeof entry?.id !== 'string' || typeof entry?.checksum !== 'string')) {
        deny('MIGRATION_CHECKSUM_MISMATCH');
      } else {
        const applied = [...state.migrations].sort((left, right) => left.id.localeCompare(right.id));
        if (applied.length > migrations.length || applied.some((entry, index) =>
          entry.id !== migrations[index]?.id || entry.checksum !== migrations[index]?.checksum)) deny('MIGRATION_CHECKSUM_MISMATCH');
      }
      if (![before, after].every(snapshot =>
        resourcesMatchObservation(
          snapshot,
          state,
          authorization.installationId,
          providerOwnershipMatched,
        ))) {
        deny('RESOURCE_OWNERSHIP_MISMATCH');
      }
    } catch (error) { deny(error?.code ?? 'INSTALL_AUTHORIZATION_MISMATCH'); }
  }
  let installStateUnchanged = false;
  try {
    installStateUnchanged = await hashCanonical(before.installState ?? null)
      === await hashCanonical(after.installState ?? null);
  } catch {
    deny('INSTALL_JOURNAL_INVALID');
  }
  const unchanged = stateFingerprint === afterStateFingerprint
    && await hashCanonical(observationSafety(before)) === await hashCanonical(observationSafety(after))
    && await hashCanonical(before.installed) === await hashCanonical(after.installed)
    && installStateUnchanged;
  if (!unchanged) deny('PLAN_STATE_CHANGED');
  const planFingerprintInput = {
    stateFingerprint, resourcesSha256, migrationsSha256,
    runtimeManifestSha256: authorization?.runtimeManifestSha256 ?? null,
    approvalSha256: authorization?.approvalSha256 ?? null,
  };
  if (target === 'hosted') Object.assign(planFingerprintInput, {
    providerBaselineVersion: providerBaseline.baselineVersion,
    providerBaselineSha256: providerBaseline.baselineSha256,
    providerObjectsSha256: providerBaseline.objectInventorySha256,
    providerGrantsSha256: providerBaseline.grantInventorySha256,
  });
  const planFingerprint = await hashCanonical(planFingerprintInput);
  if (target === 'hosted') {
    assertAuthorizationCurrent(authorization);
    assertProviderBaselineCurrent(providerBaseline, authorization, now());
  }
  return {
    operation: 'plan', target, readOnly: true, ready: blockers.length === 0, productionReady: false, unchanged,
    planFingerprint, stateFingerprint, resourcesSha256, migrationsSha256,
    project: {
      regionEvidence: target === 'local' ? 'local-development' : (isSeoulRegion(before.project.region) ? 'seoul-verified' : 'blocked'),
      ownerVerified: target === 'hosted' && before.project.ownerOrgIdHash === authorization.expectedOwnerOrgIdHash,
      observedOwnerOrgIdHash: before.project.ownerOrgIdHash ?? null,
      databaseVersion: before.project.databaseVersion ?? null, status: before.project.status ?? null,
    },
    connection: {
      databaseReadable: Boolean(before.connection.databaseReadable), authReadable: Boolean(before.connection.authReadable),
      storageReadable: Boolean(before.connection.storageReadable),
    },
    installed: state
      ? safeInstalledSummary(state, migrations)
      : { state: before.installed.ledger === 'present' ? 'unverified' : 'not-installed', migrationHead: null },
    observed: {
      userTableCount: before.state.userTableCount, userRowEstimate: before.state.userRowEstimate,
      userTypeCount: before.state.userTypeCount,
      rlsEnabledTableCount: before.state.rlsEnabledTableCount, policyCount: before.state.policyCount,
      audioBucket: before.state.bucket, auth: before.auth,
    },
    ...(target === 'hosted' ? {
      providerBaseline: safeProviderBaseline(providerBaseline, {
        ...beforeProvider,
        matched: providerMatched,
        objectInventorySha256: beforeProvider.inventory.objectInventorySha256,
        grantInventorySha256: beforeProvider.inventory.grantInventorySha256,
      }),
    } : {}),
    plannedResources: expectedSupabaseResources, migrations, blockers,
    notes: target === 'local' ? ['로컬 개발 관찰이며 설치 승인이나 운영 준비 증거가 아닙니다.'] : ['서명과 소유권을 확인한 읽기 전용 계획이며 DB 변경 승인이 아닙니다.'],
  };
}

export async function buildSupabaseDoctor(options) {
  const now = options.now ?? Date.now;
  const plan = await buildSupabasePlan({ ...options, now });
  let snapshot;
  try {
    snapshot = await options.inspector.inspect();
    if (options.target === 'hosted') {
      assertAuthorizationCurrent(options.authorization);
      assertProviderBaselineCurrent(options.providerBaseline, options.authorization, now());
    }
  } catch (error) {
    throw new PlanFailure(error?.code ?? (options.target === 'local'
      ? 'LOCAL_SUPABASE_UNAVAILABLE' : 'PROVIDER_UNREADABLE'));
  }
  const state = snapshot.installState;
  const issues = [...plan.blockers];
  const notices = [];
  const addIssue = code => {
    if (!issues.some(issue => issue.code === code)) {
      issues.push({ code, message: new PlanFailure(code).message });
    }
  };
  // A notice is evidence the operator still owes, not a reason to refuse: the
  // business runtime is deployed after the installation exists (S12 §6 2026-09-12).
  // 서명된 묶음 식별자만 덧붙인다. URL이나 서명 값이 섞일 수 있는 문자열은 버린다.
  const addNotice = (code, detail) => {
    const safeDetail = typeof detail === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(detail)
      ? detail : null;
    if (!notices.some(notice => notice.code === code)) {
      notices.push({
        code,
        message: `${new PlanFailure(code).message}${safeDetail === null ? '' : ` (현재 묶음: ${safeDetail})`}`,
      });
    }
  };
  if (!(snapshot.connection.readOnly && snapshot.connection.databaseReadable
    && snapshot.connection.authReadable && snapshot.connection.storageReadable)) {
    addIssue('CONNECTION_NOT_READ_ONLY');
  }
  // plan 이후 Auth 설정이 되돌아갔을 수 있으므로 새 관찰에서 다시 본다.
  if (options.target === 'hosted' && snapshot.auth?.emailConfirmationRequired !== false) {
    addIssue('AUTH_CONFIRMATION_REQUIRED');
  }
  const providerComparison = options.target === 'hosted'
    ? await providerBaselineComparison(snapshot, options.providerBaseline)
    : undefined;
  if (providerComparison && !providerComparison.matched) addIssue('PROVIDER_BASELINE_MISMATCH');
  const stateFingerprint = await installationStateFingerprint(snapshot, options.providerBaseline);
  if (stateFingerprint !== plan.stateFingerprint) addIssue('PLAN_STATE_CHANGED');
  if (!state) {
    addIssue('INSTALL_NOT_FOUND');
  } else {
    if (!resourcesMatchObservation(
      snapshot,
      state,
      options.authorization?.installationId,
      providerComparison?.matched && providerComparison.objectCleanlinessMatched,
    )) {
      addIssue('RESOURCE_OWNERSHIP_MISMATCH');
    }
    if (!SHA256_HEX.test(state.journal?.stateFingerprint)
      || state.journal.stateFingerprint !== stateFingerprint) addIssue('DRIFT_DETECTED');
    const receiptVerdict = await doctorReceiptIssues(
      snapshot, state, options.authorization, plan.migrations, options.release,
    );
    for (const code of receiptVerdict.issues) addIssue(code);
    for (const notice of receiptVerdict.notices) addNotice(notice.code, notice.detail);
  }
  // The same post-promotion evidence apply requires, read only and redacted:
  // booleans and the region names, never an address, token or provider body.
  let health = null;
  if (typeof options.health === 'function') {
    const observed = await options.health({
      observation: snapshot,
      providerBaseline: options.providerBaseline,
    });
    health = {
      installedHealthy: observed.installedHealthy === true,
      runtimeReady: observed.runtimeReady === true,
      storageSignerHealthy: observed.storageSignerHealthy === true,
      edgeRegionEvidence: observed.edgeRegionEvidence,
      restrictedDatabase: observed.restrictedDatabase,
    };
    if (!health.installedHealthy) addIssue('HEALTH_FAILED');
    if (!health.runtimeReady) addNotice('RUNTIME_NOT_READY');
  }
  if (options.target === 'hosted') {
    assertAuthorizationCurrent(options.authorization);
    assertProviderBaselineCurrent(options.providerBaseline, options.authorization, now());
  }
  return {
    operation: 'doctor', readOnly: true, ready: issues.length === 0,
    productionReady: health !== null && health.installedHealthy && health.runtimeReady
      && issues.length === 0,
    installed: state ? safeInstalledSummary(state, plan.migrations) : plan.installed,
    stateFingerprint,
    completedSteps: safeCompletedSteps(state),
    blockers: issues,
    notices,
    ...(health === null ? {} : { health }),
    ...(options.target === 'hosted' ? {
      providerBaseline: safeProviderBaseline(options.providerBaseline, {
        ...providerComparison,
        matched: plan.providerBaseline.matched && providerComparison.matched,
        objectInventorySha256: providerComparison.inventory.objectInventorySha256,
        grantInventorySha256: providerComparison.inventory.grantInventorySha256,
      }),
    } : {}),
  };
}
