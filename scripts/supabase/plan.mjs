import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { assertAuthorizationCurrent, assertAuthorizationMatches, hashCanonical } from './manifest-preflight.mjs';

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
  MANIFEST_VERIFIER_UNAVAILABLE: 'Community Cloud manifest 검증 모듈을 먼저 빌드해야 합니다.',
  MIGRATION_CHECKSUM_MISMATCH: '마이그레이션 파일과 정본의 파일별 체크섬이 일치하지 않습니다.',
  CA_TRUST_UNAVAILABLE: '애플리케이션 전용 CA 파일과 프로세스 신뢰 설정을 확인하지 못했습니다.',
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
  ROLLBACK_PREREQUISITES_MISSING: 'S12 rollback 승인과 E6-7의 검증된 백업 및 복원 실행기가 필요합니다.',
  INSTALL_JOURNAL_INVALID: '설치 journal의 구조나 현재 상태가 유효하지 않습니다.',
  INSTALL_JOURNAL_MISSING: '검증된 설치 journal이 없습니다.',
  INSTALL_STEP_MISMATCH: '설치 단계의 idempotency key 또는 상태가 다릅니다.',
  MIGRATION_APPLY_FAILED: '마이그레이션 transaction이 실패했으며 해당 변경은 반영되지 않았습니다.',
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
const INSTALL_PHASES = new Set(['planned', 'installing', 'installed', 'rollback_failed']);
const INSTALL_STEPS = new Set([
  'baseline', 'platform_migration', 'auth_config', 'storage_bucket', 'cron_job',
  'edge_secret_binding', 'receipt', 'prepare_backup', 'verify_manifest', 'restore_data',
  'restore_provider_metadata', 'switch_release', 'verify_receipt',
]);

function hasUnownedProjectState(snapshot) {
  const state = snapshot.state;
  return state.userTableCount > 0 || state.userRowEstimate > 0
    || state.rlsEnabledTableCount > 0 || state.policyCount > 0
    || state.authUserCount > 0 || state.bucketCount > 0 || state.storageObjectCount > 0
    || state.userRoutineCount > 0 || state.userTypeCount > 0 || state.customSchemaCount > 0
    || state.unknownObjectCount > 0 || state.auxiliaryRelationCount > 0 || state.privateSchemaExists
    || (state.privateTableNames?.length ?? 0) > 0 || (snapshot.cronJobCount ?? 0) > 0;
}

function resourcesMatchObservation(snapshot, state, installationId) {
  const ownershipTag = `ccc.installation_id=${installationId}`;
  if (snapshot.state.customSchemaCount > 0 || snapshot.state.userTypeCount > 0 || snapshot.state.unknownObjectCount > 0
    || !Array.isArray(snapshot.state.buckets) || !Array.isArray(state.resources)
    || snapshot.state.bucketCount !== snapshot.state.buckets.length) return false;
  if (snapshot.state.buckets.length !== state.resources.length) return false;
  const recorded = new Map();
  for (const resource of state.resources) {
    if (resource?.resourceType !== 'storage_bucket'
      || typeof resource.resourceIdHash !== 'string'
      || recorded.has(resource.resourceIdHash)
      || resource.ownershipTag !== ownershipTag) return false;
    recorded.set(resource.resourceIdHash, resource);
  }
  return snapshot.state.buckets.every(bucket => {
    const resource = recorded.get(bucket.resourceIdHash);
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

export async function installationStateFingerprint(snapshot) {
  return hashCanonical({
    region: snapshot.project.region,
    ownerOrgIdHash: snapshot.project.ownerOrgIdHash ?? null,
    database: snapshot.databaseFingerprint ?? snapshot.state.schemaFingerprint,
    policies: snapshot.state.policyFingerprint,
    buckets: snapshot.state.bucketFingerprint,
    auth: snapshot.state.authFingerprint,
    cron: snapshot.cronJobCount ?? 0,
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
    privateSchemaExists: Boolean(snapshot.state.privateSchemaExists),
    privateTableNames: [...(snapshot.state.privateTableNames ?? [])].sort(),
    legacyLedgerPresent: Boolean(snapshot.state.legacyLedgerPresent),
    audioBucket: snapshot.state.bucket,
    observedBuckets: snapshot.state.buckets ?? [],
    cronJobCount: snapshot.cronJobCount ?? 0,
  };
}

/** Observations contain no credentials or source documents; authority is verified separately. */
export async function buildSupabasePlan({ target, inspector, authorization, renewAuthorization = false }) {
  if (target !== 'hosted' && target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (target === 'hosted') assertAuthorizationCurrent(authorization);
  const migrations = postgresMigrationPlan();
  const resourcesSha256 = await hashCanonical(expectedSupabaseResources);
  const migrationsSha256 = await hashCanonical(migrations);
  let before;
  let after;
  try {
    before = await inspector.inspect();
    if (target === 'hosted') assertAuthorizationCurrent(authorization);
    after = await inspector.inspect();
    if (target === 'hosted') assertAuthorizationCurrent(authorization);
  } catch (error) {
    throw new PlanFailure(error?.code ?? (target === 'local' ? 'LOCAL_SUPABASE_UNAVAILABLE' : 'PROVIDER_UNREADABLE'));
  }
  const blockers = [];
  const deny = code => blockers.push({ code, ...(blockerDetails[code] ?? { message: new PlanFailure(code).message, recovery: '변경하지 말고 승인된 설치 입력과 journal을 확인합니다.' }) });
  if (![before, after].every(value => value.connection.readOnly && value.connection.databaseReadable
    && value.connection.authReadable && value.connection.storageReadable)) deny('CONNECTION_NOT_READ_ONLY');
  if (target === 'hosted') {
    if (![before, after].every(value => isSeoulRegion(value.project.region))) deny('REGION_MISMATCH');
    if (![before, after].every(value => value.project.ownerOrgIdHash === authorization.expectedOwnerOrgIdHash)) deny('OWNER_MISMATCH');
  }
  const state = before.installState;
  if (!state) {
    if ([before, after].some(snapshot => snapshot.state.legacyLedgerPresent
      || snapshot.installed.ledger === 'present')) deny('RESOURCE_OWNERSHIP_MISMATCH');
    else if ([before, after].some(hasUnownedProjectState)) deny('EXISTING_PROJECT_NOT_CLEAN');
  } else {
    try {
      const changedPair = state.journal.runtimeManifestSha256 !== authorization.runtimeManifestSha256
        || state.journal.approvalSha256 !== authorization.approvalSha256;
      assertAuthorizationMatches(state.journal, authorization, {
        renewAuthorization: renewAuthorization && changedPair, resourcesSha256, migrationsSha256,
      });
      if (!INSTALL_PHASES.has(state.journal.phase)) deny('INSTALL_JOURNAL_INVALID');
      if (state.journal.databaseFingerprint && state.journal.databaseFingerprint !== before.databaseFingerprint) deny('DRIFT_BLOCKED');
      if (!Array.isArray(state.migrations)
        || state.migrations.some(entry => typeof entry?.id !== 'string' || typeof entry?.checksum !== 'string')) {
        deny('MIGRATION_CHECKSUM_MISMATCH');
      } else {
        const applied = [...state.migrations].sort((left, right) => left.id.localeCompare(right.id));
        if (applied.length > migrations.length || applied.some((entry, index) =>
          entry.id !== migrations[index]?.id || entry.checksum !== migrations[index]?.checksum)) deny('MIGRATION_CHECKSUM_MISMATCH');
      }
      if (![before, after].every(snapshot =>
        resourcesMatchObservation(snapshot, state, authorization.installationId))) {
        deny('RESOURCE_OWNERSHIP_MISMATCH');
      }
    } catch (error) { deny(error?.code ?? 'INSTALL_AUTHORIZATION_MISMATCH'); }
  }
  const stateFingerprint = await installationStateFingerprint(before);
  const unchanged = stateFingerprint === await installationStateFingerprint(after)
    && await hashCanonical(observationSafety(before)) === await hashCanonical(observationSafety(after))
    && await hashCanonical(before.installed) === await hashCanonical(after.installed)
    && await hashCanonical(before.installState ?? null) === await hashCanonical(after.installState ?? null);
  if (!unchanged) deny('PLAN_STATE_CHANGED');
  const planFingerprint = await hashCanonical({
    stateFingerprint, resourcesSha256, migrationsSha256,
    runtimeManifestSha256: authorization?.runtimeManifestSha256 ?? null,
    approvalSha256: authorization?.approvalSha256 ?? null,
  });
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
    plannedResources: expectedSupabaseResources, migrations, blockers,
    notes: target === 'local' ? ['로컬 개발 관찰이며 설치 승인이나 운영 준비 증거가 아닙니다.'] : ['서명과 소유권을 확인한 읽기 전용 계획이며 DB 변경 승인이 아닙니다.'],
  };
}

export async function buildSupabaseDoctor(options) {
  const plan = await buildSupabasePlan(options);
  const snapshot = await options.inspector.inspect();
  const state = snapshot.installState;
  const issues = [...plan.blockers];
  if (!state) {
    issues.push({ code: 'INSTALL_NOT_FOUND', message: new PlanFailure('INSTALL_NOT_FOUND').message });
  } else {
    if (state.journal?.phase !== 'installed'
      || state.currentReceipt === null || typeof state.currentReceipt !== 'object'
      || Array.isArray(state.currentReceipt)) {
      issues.push({ code: 'INSTALL_INCOMPLETE', message: new PlanFailure('INSTALL_INCOMPLETE').message });
    }
    if (state.journal?.stateFingerprint
      && state.journal.stateFingerprint !== await installationStateFingerprint(snapshot)) {
      issues.push({ code: 'DRIFT_DETECTED', message: new PlanFailure('DRIFT_DETECTED').message });
    }
  }
  return {
    operation: 'doctor', readOnly: true, ready: issues.length === 0, productionReady: false,
    installed: plan.installed, stateFingerprint: await installationStateFingerprint(snapshot),
    completedSteps: safeCompletedSteps(state),
    blockers: issues,
  };
}
