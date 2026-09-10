#!/usr/bin/env node

import { createHostedInspector } from './hosted-inspector.mjs';
import { createLocalInspector } from './local-inspector.mjs';
import { buildSupabasePlan, PlanFailure } from './plan.mjs';
import { requireSignedOwnerPreflight } from './manifest-preflight.mjs';
import { assertApplicationCaBinding } from '../../apps/community-cloud/src/application-ca.mjs';

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
  OWNER_MANIFEST_CONTRACT_UNRESOLVED: 6,
  INSTALLER_CONTRACT_UNRESOLVED: 6,
  MANIFEST_VERIFIER_UNAVAILABLE: 2,
  MIGRATION_CHECKSUM_MISMATCH: 6,
  CA_TRUST_UNAVAILABLE: 5,
});

function parseArgs(argv) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  const [operation = 'plan', ...rest] = normalized;
  if (['apply', 'doctor', 'rollback'].includes(operation)) throw new PlanFailure('INSTALLER_CONTRACT_UNRESOLVED');
  if (operation !== 'plan') throw new PlanFailure('OPERATION_UNSUPPORTED');
  const options = { operation, target: 'hosted', projectRef: null, installManifest: null, format: 'text', workdir: process.cwd() };
  const seen = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!['--target', '--project-ref', '--install-manifest', '--format', '--workdir'].includes(flag)
      || seen.has(flag) || value === undefined) {
      throw new PlanFailure('OPERATION_UNSUPPORTED');
    }
    index += 1;
    seen.add(flag);
    if (flag === '--target') options.target = value;
    if (flag === '--project-ref') options.projectRef = value;
    if (flag === '--install-manifest') options.installManifest = value;
    if (flag === '--format') options.format = value;
    if (flag === '--workdir') options.workdir = value;
  }
  if (options.target !== 'hosted' && options.target !== 'local') throw new PlanFailure('TARGET_UNSUPPORTED');
  if (options.format !== 'text' && options.format !== 'json') throw new PlanFailure('OPERATION_UNSUPPORTED');
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
    `대상: ${plan.target === 'hosted' ? '호스팅 프로젝트' : '로컬 개발 프로젝트'}`,
    `읽기 전용 확인: ${plan.readOnly && plan.unchanged ? '통과' : '차단'}`,
    `설치 상태: ${plan.installed.state === 'not-installed' ? '설치 전' : '소유권과 설치 이력 검증 필요'}`,
    '',
    '적용 예정 자원:',
    ...plan.plannedResources.map((resource) => `- ${resource.name}`),
  ];
  if (plan.blockers.length > 0) {
    lines.push('', '차단 사유:');
    for (const item of plan.blockers) {
      lines.push(`- [${item.code}] ${item.message}`, `  다음 행동: ${item.recovery}`);
    }
  } else {
    lines.push('', '결과: 변경 적용 계획을 검토할 수 있습니다. 이 명령은 아무것도 바꾸지 않았습니다.');
  }
  const rendered = `${lines.join('\n')}\n`;
  assertSafeOutput(rendered);
  return rendered;
}

function safeError(error, format) {
  const failure = error instanceof PlanFailure ? error : new PlanFailure('PROVIDER_UNREADABLE');
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
    // S11 requires signed institution ownership before even observing the hosted
    // project. Never infer approval from a live response or substitute an owner DB URL.
    if (options.target === 'hosted') {
      await requireSignedOwnerPreflight({
        installManifest: options.installManifest ?? process.env.CCC_INSTALL_MANIFEST,
        signingKeys: process.env.CCC_INSTALL_SIGNING_KEYS,
        projectRef: options.projectRef ?? process.env.CCC_SUPABASE_PROJECT_REF,
      });
    }
    const inspector = options.target === 'local'
      ? createLocalInspector({ workdir: options.workdir })
      : createHostedInspector({
          accessToken: process.env.SUPABASE_ACCESS_TOKEN,
          projectRef: options.projectRef ?? process.env.CCC_SUPABASE_PROJECT_REF,
        });
    const plan = await buildSupabasePlan({ target: options.target, inspector });
    process.stdout.write(options.format === 'json' ? json(plan) : text(plan));
    process.exitCode = plan.ready ? 0 : 6;
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
