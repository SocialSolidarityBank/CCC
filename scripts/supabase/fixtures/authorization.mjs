import { createHash } from 'node:crypto';

// Unit input for the observation layer, not a signed document or production trust.
// Dual-signature adversarial coverage lives in install-authorization.test.mjs.
export function observationAuthorization() {
  const digest = value => createHash('sha256').update(value).digest('hex');
  return {
    installationId: 'synthetic-installation', institutionId: 'synthetic-institution',
    projectRef: 'test-project', expectedOwnerOrgId: 'test-organization',
    institutionIdHash: digest('synthetic-institution'), projectRefHash: digest('test-project'),
    expectedOwnerOrgIdHash: digest('test-organization'), runtimeManifestSha256: digest('signed-runtime'),
    approvalSha256: digest('signed-approval'), runtimeConfigurationSha256: digest('runtime-configuration'),
    contractVersion: 'S11-install-approval-v1', runtimeSequence: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
