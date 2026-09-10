import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

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
  OWNER_MANIFEST_CONTRACT_UNRESOLVED: 'S11은 기관과 소유자 서명 필드를 요구하지만 S2의 정확한 manifest 형식에는 해당 필드가 없습니다. 소유 승인 형식을 먼저 확정해야 합니다.',
  INSTALLER_CONTRACT_UNRESOLVED: '소유 승인 manifest와 journal 및 영수증 계약을 연결하기 전에는 apply, doctor, rollback을 실행할 수 없습니다.',
  MANIFEST_VERIFIER_UNAVAILABLE: 'Community Cloud manifest 검증 모듈을 먼저 빌드해야 합니다.',
  MIGRATION_CHECKSUM_MISMATCH: '마이그레이션 파일과 정본의 파일별 체크섬이 일치하지 않습니다.',
  CA_TRUST_UNAVAILABLE: '애플리케이션 전용 CA 파일과 프로세스 신뢰 설정을 확인하지 못했습니다.',
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
    message: '기관 소유 승인 형식이 확정되지 않아 hosted 계획을 적용 가능한 상태로 표시하지 않습니다.',
    recovery: 'S2와 S11의 private 소유 승인 manifest 연결을 Main에서 확정합니다.',
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

function blocker(code) {
  return { code, ...blockerDetails[code] };
}

function isSeoulRegion(region) {
  return region === 'ap-northeast-2';
}

function comparableState(snapshot) {
  return {
    schema: snapshot.state.schemaFingerprint,
    policies: snapshot.state.policyFingerprint,
    buckets: snapshot.state.bucketFingerprint,
    auth: snapshot.state.authFingerprint,
    institutionData: snapshot.state.institutionDataFingerprint,
    installed: {
      ledger: snapshot.installed.ledger,
      version: snapshot.installed.version,
      checksum: snapshot.installed.checksum,
    },
  };
}

function installedSummary(installed) {
  if (installed.ledger !== 'present') {
    return { state: 'not-installed', version: null, checksumMatches: null };
  }
  return { state: 'unverified', version: installed.version, checksumMatches: null };
}

function versionBlocker(snapshot) {
  const { installed, state } = snapshot;
  if (installed.ledger !== 'present') {
    if (state.userTableCount > 0 || state.userRowEstimate > 0) return blocker('EXISTING_PROJECT_NOT_CLEAN');
    return null;
  }
  // A legacy public ledger is not a signed-owner S11 journal or a resumable installation.
  return blocker('RESOURCE_OWNERSHIP_MISMATCH');
}

export async function buildSupabasePlan({ target, inspector }) {
  if (target !== 'hosted' && target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');

  let before;
  let after;
  try {
    before = await inspector.inspect();
    after = await inspector.inspect();
  } catch (error) {
    if (error instanceof PlanFailure) throw new PlanFailure(error.code);
    throw new PlanFailure(target === 'local' ? 'LOCAL_SUPABASE_UNAVAILABLE' : 'PROVIDER_UNREADABLE');
  }

  const blockers = [];
  if (!before.connection.readOnly || !before.connection.databaseReadable) {
    blockers.push(blocker('CONNECTION_NOT_READ_ONLY'));
  }
  if (target === 'hosted') {
    if (before.project.region === null || before.project.region === undefined || before.project.region === '') {
      blockers.push(blocker('REGION_UNVERIFIED'));
    } else if (!isSeoulRegion(before.project.region)) {
      blockers.push(blocker('REGION_MISMATCH'));
    }
  }

  const versionIssue = versionBlocker(before);
  if (versionIssue !== null) blockers.push(versionIssue);
  if (target === 'hosted') blockers.push(blocker('OWNER_EVIDENCE_MISSING'));

  const unchanged = JSON.stringify(comparableState(before)) === JSON.stringify(comparableState(after));
  if (!unchanged) blockers.push(blocker('STATE_CHANGED_DURING_PLAN'));

  return {
    operation: 'plan',
    target,
    readOnly: true,
    ready: blockers.length === 0,
    productionReady: false,
    unchanged,
    project: {
      regionEvidence: target === 'local' ? 'local-development' : (isSeoulRegion(before.project.region) ? 'seoul-verified' : 'blocked'),
      databaseVersion: before.project.databaseVersion ?? null,
      status: before.project.status ?? null,
    },
    connection: {
      databaseReadable: Boolean(before.connection.databaseReadable),
      authReadable: Boolean(before.connection.authReadable),
      storageReadable: Boolean(before.connection.storageReadable),
    },
    installed: installedSummary(before.installed),
    observed: {
      userTableCount: before.state.userTableCount,
      userRowEstimate: before.state.userRowEstimate,
      rlsEnabledTableCount: before.state.rlsEnabledTableCount,
      policyCount: before.state.policyCount,
      audioBucket: before.state.bucket,
      auth: before.auth,
    },
    plannedResources: expectedSupabaseResources,
    migrations: postgresMigrationPlan(),
    blockers,
    notes: target === 'local'
      ? ['로컬 계획은 개발 검증용이며 운영 준비 증거가 아닙니다.']
      : ['plan은 변경을 적용하지 않습니다.'],
  };
}
