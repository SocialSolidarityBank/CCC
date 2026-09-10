#!/usr/bin/env node

import { createHostedInspector } from './hosted-inspector.mjs';
import { createLocalInspector } from './local-inspector.mjs';
import { buildSupabasePlan, buildSupabaseDoctor, PlanFailure } from './plan.mjs';
import { configuredInstallTrust, requireSignedOwnerPreflight } from './manifest-preflight.mjs';
import { assertApplicationCaBinding } from '../../apps/community-cloud/src/application-ca.mjs';
import { withInstallerConnection } from './installer-connection.mjs';
import { withInstallLock, readInstallState, ensureAuthorization } from './install-journal.mjs';

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
});

function parseArgs(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const [operation = 'plan', ...rest] = normalized;
  if (!['plan', 'apply', 'doctor', 'rollback', 'renew-authorization'].includes(operation)) throw new PlanFailure('OPERATION_UNSUPPORTED');
  const options = { operation, target: 'hosted', projectRef: null, installManifest: null, installApproval: null,
    renewAuthorization: operation === 'renew-authorization', to: null, format: 'text', workdir: process.cwd() };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--renew-authorization' && !seen.has(flag) && ['plan','apply'].includes(operation)) {
      options.renewAuthorization = true;
      seen.add(flag);
      continue;
    }
    const value = rest[index + 1];
    if (!['--target', '--project-ref', '--install-manifest', '--install-approval', '--format', '--workdir', '--to'].includes(flag)
      || seen.has(flag) || value === undefined) {
      throw new PlanFailure('OPERATION_UNSUPPORTED');
    }
    index += 1;
    seen.add(flag);
    if (flag === '--target') options.target = value;
    if (flag === '--project-ref') options.projectRef = value;
    if (flag === '--install-manifest') options.installManifest = value;
    if (flag === '--install-approval') options.installApproval = value;
    if (flag === '--to') options.to = value;
    if (flag === '--format') options.format = value;
    if (flag === '--workdir') options.workdir = value;
  }
  if (options.target !== 'hosted' && options.target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.format !== 'text' && options.format !== 'json') throw new PlanFailure('OPERATION_UNSUPPORTED');
  if (options.target === 'local' && operation !== 'plan') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.to !== null && operation !== 'rollback') throw new PlanFailure('OPERATION_UNSUPPORTED');
  return options;
}


const forbiddenOutput = [
  /https?:\/\//iu,
  /postgres(?:ql)?:\/\//iu,
  /\bsbp_[A-Za-z0-9_-]+\b/u,
  /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
];

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
    lines.push('', plan.readOnly ? '이 명령은 프로젝트를 변경하지 않았습니다.' : '설치 승인 이력만 갱신했으며 완료된 자원 단계는 재실행하지 않았습니다.');
  }
  const rendered = `${lines.join('\n')}\n`;
  assertSafeOutput(rendered);
  return rendered;
}

function safeError(error, format) {
  const failure = error instanceof PlanFailure ? error : new PlanFailure(error?.code ?? 'PROVIDER_UNREADABLE');
  const payload = { error: { code: failure.code, message: failure.message } };
  return {
    exitCode: exitCodes[failure.code] ?? 5,
    output: format === 'json' ? json(payload) : `[${failure.code}] ${failure.message}\n`,
  };
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
    // Both documents and institution-scoped trust are checked before token consumption.
    const authorization = options.target === 'hosted' ? await authorize() : undefined;
    const inspector = options.target === 'local'
      ? createLocalInspector({ workdir: options.workdir })
      : createHostedInspector({
        accessToken: process.env.SUPABASE_ACCESS_TOKEN, projectRef: authorization.projectRef,
        authorization, authorize,
      });
    const planOptions = { target: options.target, inspector, authorization, renewAuthorization: options.renewAuthorization };
    let result = options.operation === 'doctor'
      ? await buildSupabaseDoctor(planOptions) : await buildSupabasePlan(planOptions);
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
      // S11 approval is not S12 release authorization. No approved embedded release
      // origin/offline-root/factory-floor or signed platform artifact set exists yet.
      // Do not run checkout SQL or emit an installed receipt in place of those inputs.
      throw new PlanFailure('RELEASE_PREREQUISITES_MISSING');
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
