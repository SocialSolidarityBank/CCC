import { createHash } from 'node:crypto';

export const expectedSupabaseResources = Object.freeze([
  { kind: 'migration-ledger', name: 'public.ccc_schema_migrations' },
  { kind: 'database-baseline', name: 'CCC PostgreSQL baseline v1' },
  { kind: 'database-role', name: 'ccc_worker' },
  { kind: 'rls-policy-set', name: 'ccc_org_isolation' },
  { kind: 'auth-policy', name: 'CCC invitation and admin MFA' },
  { kind: 'storage-bucket', name: 'ccc-session-audio' },
  { kind: 'retention-contract', name: 'ccc_audio_30_day_purge' },
]);

export const expectedSchemaContract = Object.freeze({
  version: 1,
  minimumUpgradableVersion: 1,
  checksum: createHash('sha256').update(JSON.stringify(expectedSupabaseResources)).digest('hex'),
});

const safeFailures = Object.freeze({
  CREDENTIAL_MISSING: 'Supabase 접근 자격증명이 없습니다.',
  CREDENTIAL_INVALID: 'Supabase 접근 자격증명이 유효하지 않습니다.',
  CREDENTIAL_INSUFFICIENT: 'Supabase 읽기 권한이 부족합니다.',
  PROJECT_REF_MISSING: 'Supabase 프로젝트 식별자가 없습니다.',
  PROVIDER_UNREADABLE: 'Supabase의 현재 상태를 읽지 못했습니다.',
  LOCAL_SUPABASE_UNAVAILABLE: '로컬 Supabase 상태를 읽지 못했습니다.',
  OUTPUT_REDACTION_FAILED: '안전한 출력 형식을 만들지 못했습니다.',
  OPERATION_UNSUPPORTED: '이 티켓에서는 plan 동작만 지원합니다.',
  TARGET_UNSUPPORTED: 'target은 local 또는 hosted여야 합니다.',
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
    recovery: '서울 리전에 새 Supabase 프로젝트를 만든 뒤 그 프로젝트로 다시 계획합니다.',
  },
  EXISTING_PROJECT: {
    message: 'CCC 설치 이력 없이 기존 표나 기관 데이터가 있습니다.',
    recovery: '빈 프로젝트를 사용합니다. 기존 프로젝트 채택은 별도 호환성 검토를 거칩니다.',
  },
  VERSION_AHEAD: {
    message: '설치 버전이 현재 레포가 지원하는 버전보다 앞섭니다.',
    recovery: '더 최신 CCC 레포에서 다시 계획합니다. 다운그레이드는 실행하지 않습니다.',
  },
  VERSION_GAP: {
    message: '설치 버전에서 현재 버전으로 바로 올리는 경로를 지원하지 않습니다.',
    recovery: '지원되는 중간 버전의 업그레이드 절차를 먼저 적용합니다.',
  },
  VERSION_CHECKSUM_MISMATCH: {
    message: '설치 버전은 같지만 스키마 계약 체크섬이 다릅니다.',
    recovery: '변경을 적용하지 말고 스키마 드리프트를 먼저 검토합니다.',
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
  if (typeof region !== 'string') return false;
  const normalized = region.trim().toLowerCase().replace(/[ _]+/gu, '-');
  return normalized === 'ap-northeast-2'
    || normalized === 'northeast-asia-seoul'
    || normalized === 'seoul';
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
  return {
    state: 'installed',
    version: installed.version,
    checksumMatches: installed.checksum === expectedSchemaContract.checksum,
  };
}

function versionBlocker(snapshot) {
  const { installed, state } = snapshot;
  if (installed.ledger !== 'present') {
    if (state.userTableCount > 0 || state.userRowEstimate > 0) return blocker('EXISTING_PROJECT');
    return null;
  }
  if (!Number.isInteger(installed.version) || installed.version < expectedSchemaContract.minimumUpgradableVersion) {
    return blocker('VERSION_GAP');
  }
  if (installed.version > expectedSchemaContract.version) return blocker('VERSION_AHEAD');
  if (installed.version < expectedSchemaContract.version) return blocker('VERSION_GAP');
  if (installed.checksum !== expectedSchemaContract.checksum) return blocker('VERSION_CHECKSUM_MISMATCH');
  return null;
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
    blockers,
    notes: target === 'local'
      ? ['로컬 계획은 개발 검증용이며 운영 준비 증거가 아닙니다.']
      : ['plan은 변경을 적용하지 않습니다.'],
  };
}
