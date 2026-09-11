#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import {
  createHostedInspector,
  createInstallationHealth,
  readRestrictedRoleFromSession,
} from './hosted-inspector.mjs';
import { createLocalInspector } from './local-inspector.mjs';
import {
  assertProviderBaselineCurrent,
  buildSupabasePlan,
  buildSupabaseDoctor,
  PlanFailure,
} from './plan.mjs';
import {
  configuredInstallTrust,
  hashCanonical,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from './manifest-preflight.mjs';
import { requireProviderBaseline } from './provider-baseline.mjs';
import { assertApplicationCaBinding } from '../../apps/community-cloud/src/application-ca.mjs';
import { withInstallerConnection } from './installer-connection.mjs';
import {
  ensureAuthorization,
  readInstallState,
  withInstallLock,
} from './install-journal.mjs';
import {
  applyInstallation,
  createInstallJournalSession,
  loadReleaseForApply,
  loadReleaseIndexForDoctor,
} from './apply.mjs';
import { assertSafeOutput, buildRedactedReport, writeRedactedReport } from './report.mjs';

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
  EDGE_BUNDLE_LIMIT: 6,
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
  if (!['plan', 'apply', 'doctor', 'report', 'rollback', 'renew-authorization'].includes(operation)) throw new PlanFailure('OPERATION_UNSUPPORTED');
  const options = {
    operation, target: 'hosted', projectRef: null, installManifest: null, installApproval: null,
    manifestUrl: null, renewAuthorization: operation === 'renew-authorization', to: null,
    format: 'text', workdir: process.cwd(), output: null,
  };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--renew-authorization' && !seen.has(flag) && ['plan','apply'].includes(operation)) {
      options.renewAuthorization = true;
      seen.add(flag);
      continue;
    }
    if (flag === '--json' && !seen.has('--format') && ['doctor', 'report'].includes(operation)) {
      options.format = 'json';
      seen.add('--format');
      continue;
    }
    const value = rest[index + 1];
    if (![
      '--target', '--project-ref', '--install-manifest', '--install-approval',
      '--manifest-url', '--format', '--workdir', '--to', '--output',
    ].includes(flag) || seen.has(flag) || value === undefined
      || (flag === '--output' && value.startsWith('--'))) {
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
    if (flag === '--output') options.output = value;
  }
  if (options.target !== 'hosted' && options.target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.format !== 'text' && options.format !== 'json') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (options.target === 'local' && operation !== 'plan') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.to !== null && operation !== 'rollback') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (options.manifestUrl !== null && operation !== 'apply') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (operation === 'apply' && options.manifestUrl === null) throw new PlanFailure('RELEASE_PREREQUISITES_MISSING');
  if (operation === 'report' ? !options.output : options.output !== null) throw new PlanFailure('OPERATION_UNSUPPORTED');
  return options;
}



const task4Failures = Object.freeze({
  BACKUP_FAILED: '검증된 백업 경로가 없고 첫 설치 백업 면제 조건도 충족하지 못했습니다.',
  ARTIFACT_IDENTITY_MISMATCH: '릴리스 artifact가 이 설치기의 대상 tuple과 다릅니다.',
  ARTIFACT_NOT_INDEXED: '릴리스 묶음에 없는 artifact 또는 manifest입니다.',
  BUNDLE_ENTRY_INVALID: '릴리스 묶음의 구조나 대상 항목이 유효하지 않습니다.',
  BUNDLE_SIGNATURE_INVALID: '릴리스 묶음 서명을 확인하지 못했습니다.',
  BUNDLE_LIFETIME_INVALID: '릴리스 묶음의 유효 기간을 확인하지 못했습니다.',
  EDGE_COMPONENT_DEPLOYER_UNAVAILABLE: '이 설치기가 적용할 수 없는 Edge component가 포함되어 있습니다.',
  EDGE_COMPONENT_SET_MISMATCH: '검증된 Edge component 집합과 적용 대상이 다릅니다.',
  EDGE_BUNDLE_LIMIT: 'Edge 함수 묶음이 배포 한도를 넘었습니다.',
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
  if ((plan.notices ?? []).length > 0) {
    lines.push('', '안내(차단 아님):');
    for (const item of plan.notices) lines.push(`- [${item.code}] ${item.message}`);
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

/**
 * The already-verified installation manifest, re-read only for the addresses
 * the health probes and the signer bindings need. Its JCS digest must be the
 * one the signed approval bound, so no unsigned value can redirect a probe.
 */
async function verifiedInstallManifest(document, authorization) {
  const manifest = await readStrictJsonDocument(document);
  if (await hashCanonical(manifest) !== authorization.runtimeManifestSha256
    || typeof manifest.apiBase !== 'string' || manifest.apiBase.length === 0
    || typeof manifest.supabaseAuthOrigin !== 'string' || manifest.supabaseAuthOrigin.length === 0) {
    throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  }
  return manifest;
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
    const installManifest = options.installManifest ?? process.env.CCC_INSTALL_MANIFEST;
    const signedManifest = options.target === 'hosted'
      ? await verifiedInstallManifest(installManifest, authorization)
      : undefined;
    // One probe set for both lanes: doctor has no installer connection and
    // reads the restricted role through the read-only Management query.
    const installationHealth = options.target === 'hosted'
      ? createInstallationHealth({
        apiBase: signedManifest.apiBase,
        supabaseAuthOrigin: signedManifest.supabaseAuthOrigin,
        installationId: authorization.installationId,
        readRestrictedRole: input => (input.session === undefined
          ? inspector.restrictedRole()
          : readRestrictedRoleFromSession(input.session)),
      })
      : undefined;
    const planOptions = {
      target: options.target,
      inspector,
      authorization,
      providerBaseline,
      renewAuthorization: options.renewAuthorization,
      health: installationHealth,
    };
    let reportLedger = null;
    const diagnosisOptions = options.operation === 'report' ? {
      ...planOptions,
      inspector: {
        async inspect() {
          const observation = await inspector.inspect();
          reportLedger = observation.installState;
          return observation;
        },
      },
    } : planOptions;
    // doctor와 report는 고정 원본의 서명된 묶음을 읽어 영수증을 대조한다.
    // trust store가 없으면 index도 없고 릴리스 차단 사유가 그대로 남는다.
    let result = ['doctor', 'report'].includes(options.operation)
      ? await buildSupabaseDoctor({
        ...diagnosisOptions,
        release: await loadReleaseIndexForDoctor({ now: new Date() }),
      })
      : await buildSupabasePlan(planOptions);
    if (options.operation === 'report') {
      const report = buildRedactedReport({ doctor: result, ledger: reportLedger });
      await writeRedactedReport({
        report,
        outputPath: options.output,
        operatorDirectory: dirname(resolve(options.output)),
      });
      process.stdout.write(options.format === 'json'
        ? json(report) : '설치 진단 보고서를 저장했습니다. 미완료 항목은 보고서에서 확인합니다.\n');
      process.exitCode = result.ready ? 0 : 6;
      return;
    }
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
    } else if (result.ready && options.operation === 'apply') {
      const loaded = await loadReleaseForApply({
        manifestUrl: options.manifestUrl,
        authorize: authorizeProviderAccess,
        inspector,
        // Written provider access is the Management API with the same scoped
        // token; the value stays in this object and is never printed.
        management: { fetch, accessToken: process.env.SUPABASE_ACCESS_TOKEN },
        secrets: {
          schedulerSecret: process.env.SCHEDULER_SECRET,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          installManifestJson: JSON.stringify(signedManifest),
          signingKeysJson: process.env.CCC_INSTALL_SIGNING_KEYS,
          // 업무 runtime의 ccc_api 로그인 비밀번호. apply의 api_credential 단계만 쓴다.
          apiDatabasePassword: process.env.CCC_API_DATABASE_PASSWORD,
        },
        apiBase: signedManifest.apiBase,
        supabaseOrigin: signedManifest.supabaseAuthOrigin,
        localNow: new Date(),
      });
      try {
        result = await withInstallerConnection(authorization, async sql => {
          const applyInspector = {
            inspect: () => inspector.inspect(),
            async revalidate(expected) {
              let observed;
              const current = await buildSupabasePlan({
                ...planOptions,
                inspector: {
                  inspect: async () => {
                    observed = await inspector.inspect();
                    return observed;
                  },
                },
                now: () => loaded.trustedTime().getTime(),
              });
              if (!current.ready
                || current.planFingerprint !== expected.planFingerprint) {
                throw new PlanFailure('PLAN_STATE_CHANGED');
              }
              return observed;
            },
            // Health reads the promoted installation once more, read only.
            health: async input => installationHealth({
              session: input.session,
              observation: await inspector.inspect(),
              providerBaseline,
            }),
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
    const format = options?.format === 'json'
      || process.argv.includes('json') || process.argv.includes('--json') ? 'json' : 'text';
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
