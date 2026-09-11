#!/usr/bin/env node

import { createHostedInspector } from './hosted-inspector.mjs';
import { createLocalInspector } from './local-inspector.mjs';
import {
  assertProviderBaselineCurrent,
  buildSupabasePlan,
  buildSupabaseDoctor,
  installationStateFingerprint,
  PlanFailure,
} from './plan.mjs';
import { configuredInstallTrust, requireSignedOwnerPreflight } from './manifest-preflight.mjs';
import { requireProviderBaseline } from './provider-baseline.mjs';
import { assertApplicationCaBinding } from '../../apps/community-cloud/src/application-ca.mjs';
import { withInstallerConnection } from './installer-connection.mjs';
import {
  ensureAuthorization,
  readInstallState,
  updateInstallPhase,
  withInstallLock,
} from './install-journal.mjs';
import {
  applyInstallation,
  createInstallJournalSession,
  loadReleaseForApply,
} from './apply.mjs';

const exitCodes = Object.freeze({
  CREDENTIAL_MISSING: 2,
  PROJECT_REF_MISSING: 2,
  CREDENTIAL_INVALID: 3,
  CREDENTIAL_INSUFFICIENT: 4,
  PROVIDER_UNREADABLE: 5,
  LOCAL_SUPABASE_UNAVAILABLE: 5,
  OUTPUT_REDACTION_FAILED: 5,
  OPERATION_UNSUPPORTED: 2,
  TARGET_UNSUPPORTED: 2,
  OWNER_EVIDENCE_MISSING: 6,
  MANIFEST_VERIFIER_UNAVAILABLE: 2,
  MIGRATION_CHECKSUM_MISMATCH: 6,
  CA_TRUST_UNAVAILABLE: 5,
  OWNER_MISMATCH: 6,
  INSTALL_AUTHORIZATION_MISMATCH: 6,
  INSTALL_LOCK_BUSY: 6,
  RESOURCE_OWNERSHIP_MISMATCH: 6,
  RELEASE_PREREQUISITES_MISSING: 6,
  ROLLBACK_PREREQUISITES_MISSING: 6,
  BETA_TRUST_INVALID: 6,
  PROVIDER_BASELINE_INVALID: 6,
  PROVIDER_BASELINE_MISMATCH: 6,
  BACKUP_FAILED: 6,
  ARTIFACT_IDENTITY_MISMATCH: 6,
  ARTIFACT_NOT_INDEXED: 6,
  BUNDLE_ENTRY_INVALID: 6,
  BUNDLE_SIGNATURE_INVALID: 6,
  BUNDLE_LIFETIME_INVALID: 6,
  EDGE_COMPONENT_DEPLOYER_UNAVAILABLE: 6,
  EDGE_COMPONENT_SET_MISMATCH: 6,
  HASH_MISMATCH: 6,
  HEALTH_FAILED: 6,
  INSTALL_POST_PROMOTION_FAILED: 6,
  MANIFEST_EXPIRED: 6,
  RELEASE_ORIGIN_INVALID: 6,
  RELEASE_FLOOR_INVALID: 6,
  RELEASE_FLOOR_LOCK_UNAVAILABLE: 6,
  RELEASE_FLOOR_PERMISSIONS_INVALID: 6,
  RELEASE_FLOOR_STATE_INVALID: 6,
  ROLLBACK_FAILED: 6,
  SIGNATURE_INVALID: 6,
  SIGNING_KEY_REVOKED: 6,
  SIGNING_KEY_UNKNOWN: 6,
  SCHEMA_INCOMPATIBLE: 6,
  TRUSTED_TIME_ROLLBACK: 6,
  TRUSTED_TIME_UNAVAILABLE: 6,
});

function parseArgs(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const [operation = 'plan', ...rest] = normalized;
  if (!['plan', 'apply', 'doctor', 'rollback', 'renew-authorization'].includes(operation)) throw new PlanFailure('OPERATION_UNSUPPORTED');
  const options = {
    operation, target: 'hosted', projectRef: null, installManifest: null, installApproval: null,
    manifestUrl: null, renewAuthorization: operation === 'renew-authorization', to: null,
    format: 'text', workdir: process.cwd(),
  };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--renew-authorization' && !seen.has(flag) && ['plan','apply'].includes(operation)) {
      options.renewAuthorization = true;
      seen.add(flag);
      continue;
    }
    const value = rest[index + 1];
    if (![
      '--target', '--project-ref', '--install-manifest', '--install-approval',
      '--manifest-url', '--format', '--workdir', '--to',
    ].includes(flag) || seen.has(flag) || value === undefined) {
      throw new PlanFailure('OPERATION_UNSUPPORTED');
    }
    index += 1;
    seen.add(flag);
    if (flag === '--target') options.target = value;
    if (flag === '--project-ref') options.projectRef = value;
    if (flag === '--install-manifest') options.installManifest = value;
    if (flag === '--install-approval') options.installApproval = value;
    if (flag === '--manifest-url') options.manifestUrl = value;
    if (flag === '--to') options.to = value;
    if (flag === '--format') options.format = value;
    if (flag === '--workdir') options.workdir = value;
  }
  if (options.target !== 'hosted' && options.target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.format !== 'text' && options.format !== 'json') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (options.target === 'local' && operation !== 'plan') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.to !== null && operation !== 'rollback') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (options.manifestUrl !== null && operation !== 'apply') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (operation === 'apply' && options.manifestUrl === null) throw new PlanFailure('RELEASE_PREREQUISITES_MISSING');
  return options;
}


const forbiddenOutput = [
  /https?:\/\//iu,
  /postgres(?:ql)?:\/\//iu,
  /\bsbp_[A-Za-z0-9_-]+\b/u,
  /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /"(?:ed25519Signature|releasePublicKey|objects|grants)"\s*:/iu,
];

const task4Failures = Object.freeze({
  BACKUP_FAILED: '검증된 백업 경로가 없고 첫 설치 백업 면제 조건도 충족하지 못했습니다.',
  ARTIFACT_IDENTITY_MISMATCH: '릴리스 artifact가 이 설치기의 대상 tuple과 다릅니다.',
  ARTIFACT_NOT_INDEXED: '릴리스 묶음에 없는 artifact 또는 manifest입니다.',
  BUNDLE_ENTRY_INVALID: '릴리스 묶음의 구조나 대상 항목이 유효하지 않습니다.',
  BUNDLE_SIGNATURE_INVALID: '릴리스 묶음 서명을 확인하지 못했습니다.',
  BUNDLE_LIFETIME_INVALID: '릴리스 묶음의 유효 기간을 확인하지 못했습니다.',
  EDGE_COMPONENT_DEPLOYER_UNAVAILABLE: '이 설치기가 적용할 수 없는 Edge component가 포함되어 있습니다.',
  EDGE_COMPONENT_SET_MISMATCH: '검증된 Edge component 집합과 적용 대상이 다릅니다.',
  HASH_MISMATCH: '다운로드한 artifact의 확인값이 manifest와 다릅니다.',
  HEALTH_FAILED: '승격한 설치 상태의 읽기 전용 확인을 통과하지 못했습니다.',
  INSTALL_POST_PROMOTION_FAILED: '마이그레이션 승격 뒤 확인이 실패해 설치를 완료하지 않았습니다. journal에서 재개 상태를 확인합니다.',
  RELEASE_ORIGIN_INVALID: '승인된 고정 릴리스 출처를 확인하지 못했습니다.',
  MANIFEST_EXPIRED: '릴리스 manifest의 유효 기간이 끝났습니다.',
  ROLLBACK_FAILED: '실패한 승격을 안전하게 되돌리지 못했습니다.',
  RELEASE_FLOOR_INVALID: '검증된 릴리스 floor를 기록하지 못했습니다.',
  RELEASE_FLOOR_LOCK_UNAVAILABLE: '릴리스 floor 잠금을 획득하지 못했습니다.',
  RELEASE_FLOOR_PERMISSIONS_INVALID: '릴리스 floor 저장소의 권한이 안전하지 않습니다.',
  RELEASE_FLOOR_STATE_INVALID: '릴리스 floor 저장 상태가 유효하지 않습니다.',
  SIGNATURE_INVALID: '릴리스 manifest 서명을 확인하지 못했습니다.',
  SIGNING_KEY_REVOKED: '폐기된 릴리스 키는 사용할 수 없습니다.',
  SIGNING_KEY_UNKNOWN: '신뢰 목록에 없는 릴리스 키입니다.',
  SCHEMA_INCOMPATIBLE: '릴리스와 현재 데이터베이스 schema 범위가 맞지 않습니다.',
  TRUSTED_TIME_ROLLBACK: '신뢰 시각이 이전 설치 기록보다 과거로 이동했습니다.',
  TRUSTED_TIME_UNAVAILABLE: '릴리스 출처의 신뢰 시각을 확인하지 못했습니다.',
});

function assertSafeOutput(text) {
  if (forbiddenOutput.some((pattern) => pattern.test(text))) {
    throw new PlanFailure('OUTPUT_REDACTION_FAILED');
  }
}

function json(value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  assertSafeOutput(rendered);
  return rendered;
}

function text(plan) {
  const lines = [
    'Supabase 변경 계획',
    `동작: ${plan.operation}`,
    `읽기 전용: ${plan.readOnly ? '예' : '아니오'}`,
    `결과: ${plan.ready ? '통과' : '차단'}`,
    '',
    '적용 예정 자원:',
    ...(plan.plannedResources ?? []).map((resource) => `- ${resource.name}`),
  ];
  if ((plan.blockers ?? []).length > 0) {
    lines.push('', '차단 사유:');
    for (const item of plan.blockers) {
      lines.push(`- [${item.code}] ${item.message}`, ...(item.recovery ? [`  다음 행동: ${item.recovery}`] : []));
    }
  } else {
    const success = plan.operation === 'apply'
      ? '검증된 개발판 마이그레이션을 적용하고 설치 영수증을 기록했습니다.'
      : '설치 승인 이력만 갱신했으며 완료된 자원 단계는 재실행하지 않았습니다.';
    lines.push('', plan.readOnly ? '이 명령은 프로젝트를 변경하지 않았습니다.' : success);
  }
  const rendered = `${lines.join('\n')}\n`;
  assertSafeOutput(rendered);
  return rendered;
}

function safeError(error, format) {
  const task4Message = task4Failures[error?.code];
  const failure = task4Message === undefined
    ? (error instanceof PlanFailure ? error : new PlanFailure(error?.code ?? 'PROVIDER_UNREADABLE'))
    : Object.assign(new Error(task4Message), { code: error.code });
  const payload = { error: { code: failure.code, message: failure.message } };
  return {
    exitCode: exitCodes[failure.code] ?? 5,
    output: format === 'json' ? json(payload) : `[${failure.code}] ${failure.message}\n`,
  };
}

function parseBetaConfiguration(value, fallback) {
  try {
    return value === undefined ? fallback : JSON.parse(value);
  } catch {
    throw new PlanFailure('BETA_TRUST_INVALID');
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    try { assertApplicationCaBinding(); } catch { throw new PlanFailure('CA_TRUST_UNAVAILABLE'); }
    const authorize = () => requireSignedOwnerPreflight({
      installManifest: options.installManifest ?? process.env.CCC_INSTALL_MANIFEST,
      installApproval: options.installApproval ?? process.env.CCC_INSTALL_APPROVAL,
      trust: configuredInstallTrust({
        organizationId: process.env.CCC_ORGANIZATION_ID,
        publicKeys: process.env.CCC_INSTALL_SIGNING_KEYS,
        revokedKeyIds: process.env.CCC_INSTALL_REVOKED_KEY_IDS,
      }),
      organizationId: process.env.CCC_ORGANIZATION_ID,
      projectRef: options.projectRef ?? process.env.CCC_SUPABASE_PROJECT_REF,
    });
    // Owner authorization and both beta documents are verified before token consumption.
    const authorization = options.target === 'hosted' ? await authorize() : undefined;
    const providerBaseline = options.target === 'hosted'
      ? await requireProviderBaseline({
          releaseTrust: process.env.CCC_BETA_RELEASE_TRUST,
          providerBaseline: process.env.CCC_PROVIDER_BASELINE,
          rootKeys: parseBetaConfiguration(process.env.CCC_BETA_TRUST_ROOT_KEYS),
          revokedRootKeyIds: parseBetaConfiguration(process.env.CCC_BETA_REVOKED_ROOT_KEY_IDS, []),
          authorization,
          manifestExpiresAt: authorization.expiresAt,
        })
      : undefined;
    if (options.target === 'hosted') {
      assertProviderBaselineCurrent(providerBaseline, authorization);
    }
    const authorizeProviderAccess = async () => {
      const fresh = await authorize();
      assertProviderBaselineCurrent(providerBaseline, fresh);
      return fresh;
    };
    const inspector = options.target === 'local'
      ? createLocalInspector({ workdir: options.workdir })
      : createHostedInspector({
        accessToken: process.env.SUPABASE_ACCESS_TOKEN, projectRef: authorization.projectRef,
        authorization, authorize: authorizeProviderAccess,
      });
    const planOptions = {
      target: options.target,
      inspector,
      authorization,
      providerBaseline,
      renewAuthorization: options.renewAuthorization,
    };
    let result = options.operation === 'doctor'
      ? await buildSupabaseDoctor(planOptions) : await buildSupabasePlan(planOptions);
    const resumableDrift = options.operation === 'apply'
      && result.installed?.state === 'installing'
      && result.blockers?.length === 1
      && result.blockers[0]?.code === 'DRIFT_BLOCKED';
    if (result.ready && options.operation === 'renew-authorization') {
      result = await withInstallerConnection(authorization, sql => withInstallLock(sql, authorization.projectRefHash, async session => {
        const fresh = await authorize();
        const current = await buildSupabasePlan({ ...planOptions, authorization: fresh });
        if (!current.ready || current.planFingerprint !== result.planFingerprint) throw new PlanFailure('PLAN_STATE_CHANGED');
        const state = await readInstallState(session, fresh.installationId);
        if (!state) throw new PlanFailure('INSTALL_NOT_FOUND');
        const renewed = await ensureAuthorization(session, fresh, {
          resourcesSha256: current.resourcesSha256, migrationsSha256: current.migrationsSha256,
          planFingerprint: state.journal.planFingerprint,
        }, { renewAuthorization: true, authorize });
        return {
          operation: 'renew-authorization', target: 'hosted', ready: true, readOnly: false, productionReady: false,
          renewed: renewed.renewed, runtimeManifestSha256: fresh.runtimeManifestSha256, approvalSha256: fresh.approvalSha256,
          blockers: [],
        };
      }));
    } else if ((result.ready || resumableDrift) && options.operation === 'apply') {
      const loaded = await loadReleaseForApply({
        manifestUrl: options.manifestUrl,
        authorize: authorizeProviderAccess,
        inspector,
        localNow: new Date(),
      });
      try {
        result = await withInstallerConnection(authorization, async sql => {
          const applyInspector = {
            inspect: () => inspector.inspect(),
            async revalidate(expected, session) {
              const inspectPlan = async () => {
                let observed;
                const current = await buildSupabasePlan({
                  ...planOptions,
                  inspector: {
                    inspect: async () => {
                      observed = await inspector.inspect();
                      return observed;
                    },
                  },
                  now: () => loaded.trustedTime.getTime(),
                });
                return { current, observed };
              };
              let checked = await inspectPlan();
              if (!checked.current.ready && resumableDrift) {
                const journal = checked.observed?.installState?.journal;
                if (journal?.phase !== 'installing'
                  || journal.databaseFingerprint !== checked.observed.databaseFingerprint) {
                  throw new PlanFailure('DRIFT_BLOCKED');
                }
                await updateInstallPhase(session, authorization, {
                  phase: 'installing',
                  currentStep: 'switch_release',
                  stateFingerprint: await installationStateFingerprint(
                    checked.observed,
                    providerBaseline,
                  ),
                }, { authorize: authorizeProviderAccess });
                checked = await inspectPlan();
              }
              if (!checked.current.ready
                || checked.current.planFingerprint !== expected.planFingerprint) {
                throw new PlanFailure('PLAN_STATE_CHANGED');
              }
              return checked.observed;
            },
            async health({ session, promotion }) {
              const roles = await session.unsafe(`SELECT
                rolcanlogin, rolsuper, rolbypassrls,
                has_database_privilege('ccc_api', current_database(), 'CONNECT') AS can_connect
                FROM pg_catalog.pg_roles WHERE rolname = 'ccc_api'`);
              if (roles.length !== 1 || roles[0].rolcanlogin !== true || roles[0].rolsuper !== false
                || roles[0].rolbypassrls !== false || roles[0].can_connect !== true) {
                throw Object.assign(new Error('HEALTH_FAILED'), { code: 'HEALTH_FAILED' });
              }
              const current = await buildSupabasePlan({
                ...planOptions,
                now: () => loaded.trustedTime.getTime(),
              });
              if (!current.ready || current.installed.state !== 'installing'
                || promotion.responseRegion !== 'ap-northeast-2'
                || current.stateFingerprint !== promotion.stateFingerprint
                || current.installed.migrationHead !== result.migrations.at(-1)?.id) {
                throw Object.assign(new Error('HEALTH_FAILED'), { code: 'HEALTH_FAILED' });
              }
              return {
                healthy: true,
                stateFingerprint: current.stateFingerprint,
                observedOwnerOrgIdHash: current.project.observedOwnerOrgIdHash,
              };
            },
          };
          return applyInstallation({
            authorization,
            providerBaseline,
            plan: result,
            release: loaded.release,
            inspector: applyInspector,
            journalSession: createInstallJournalSession({
              sql,
              authorization,
              authorize: authorizeProviderAccess,
            }),
            now: loaded.trustedTime,
          });
        });
      } finally {
        await loaded.cleanup();
      }
    } else if (result.ready && options.operation === 'rollback') {
      // No E6-7 verified restore catalog/executor or signed S12 rollback bundle is
      // available in this source tree. Never substitute down SQL or partial deletion.
      throw new PlanFailure('ROLLBACK_PREREQUISITES_MISSING');
    }
    process.stdout.write(options.format === 'json' ? json(result) : text(result));
    process.exitCode = result.ready ? 0 : 6;
  } catch (error) {
    const format = options?.format === 'json' || process.argv.includes('json') ? 'json' : 'text';
    try {
      const failure = safeError(error, format);
      process.stderr.write(failure.output);
      process.exitCode = failure.exitCode;
    } catch {
      process.stderr.write('[OUTPUT_REDACTION_FAILED] 안전한 출력 형식을 만들지 못했습니다.\n');
      process.exitCode = 5;
    }
  }
}

await main();
