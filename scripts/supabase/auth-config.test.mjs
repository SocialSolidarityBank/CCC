import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BOUNDED_AUTH_CONFIG_KEYS,
  RELAYER_INVITE_TEMPLATE_HTML,
  authConfigFingerprint,
  boundedAuthConfig,
  inspectAuthConfig,
} from './auth-config.mjs';

const INVITE_TEMPLATE_SHA256 = '6b5639d037932528297ebba1becf112e8b10c49e85caef0b10c9e25447c72c55';

test('exact invite template is 408 UTF-8 bytes with the approved SHA-256', () => {
  assert.equal(Buffer.byteLength(RELAYER_INVITE_TEMPLATE_HTML, 'utf8'), 408);
  assert.equal(RELAYER_INVITE_TEMPLATE_HTML.endsWith('\n'), false);
  assert.equal(
    createHash('sha256').update(RELAYER_INVITE_TEMPLATE_HTML, 'utf8').digest('hex'),
    INVITE_TEMPLATE_SHA256,
  );
  assert.equal(inspectAuthConfig({}).inviteTemplateSha256, INVITE_TEMPLATE_SHA256);
});

test('bounded Auth config preserves the approved key order and normalizes missing values to null', () => {
  const bounded = boundedAuthConfig({
    disable_signup: true,
    mailer_otp_exp: 3600,
    mailer_templates_invite_content: RELAYER_INVITE_TEMPLATE_HTML,
    site_url: 'https://app.example.invalid',
  });
  assert.deepEqual(Object.keys(bounded), [...BOUNDED_AUTH_CONFIG_KEYS]);
  assert.equal(bounded.disable_signup, true);
  assert.equal(bounded.site_url, 'https://app.example.invalid');
  assert.equal(bounded.jwt_exp, null);
  assert.equal(bounded.mfa_totp_enroll_enabled, null);
  assert.equal(boundedAuthConfig(null), null);
  assert.equal(boundedAuthConfig('config'), null);
  assert.equal(boundedAuthConfig([]), null);
});

test('prior Auth fingerprint changes only disable_signup to false', () => {
  const authConfig = {
    disable_signup: true,
    mailer_otp_exp: 3600,
    mailer_templates_invite_content: RELAYER_INVITE_TEMPLATE_HTML,
    site_url: 'https://app.example.invalid',
  };
  const evidence = inspectAuthConfig(authConfig);
  assert.equal(evidence.readable, true);
  assert.equal(evidence.disableSignup, true);
  assert.equal(evidence.inviteTemplateExact, true);
  assert.equal(evidence.currentAuthFingerprint, authConfigFingerprint(authConfig));
  assert.equal(
    evidence.priorAuthFingerprint,
    authConfigFingerprint({ ...authConfig, disable_signup: false }),
  );
  assert.notEqual(evidence.priorAuthFingerprint, evidence.currentAuthFingerprint);
  assert.equal(inspectAuthConfig(null).currentAuthFingerprint, null);
  assert.equal(inspectAuthConfig(null).priorAuthFingerprint, null);
});

test('invite template evidence rejects every non-byte-equal body', async t => {
  const variants = [
    ['missing', undefined],
    ['one-byte', `${RELAYER_INVITE_TEMPLATE_HTML}!`],
    ['ConfirmationURL', RELAYER_INVITE_TEMPLATE_HTML.replace('{{ .RedirectTo }}', '{{ .ConfirmationURL }}')],
    ['TokenHash', RELAYER_INVITE_TEMPLATE_HTML.replace('{{ .Token }}', '{{ .TokenHash }}')],
    ['query', RELAYER_INVITE_TEMPLATE_HTML.replace('{{ .RedirectTo }}', '{{ .RedirectTo }}?code={{ .Token }}')],
    ['fragment', RELAYER_INVITE_TEMPLATE_HTML.replace('{{ .RedirectTo }}', '{{ .RedirectTo }}#code')],
    ['trailing-newline', `${RELAYER_INVITE_TEMPLATE_HTML}\n`],
  ];

  for (const [name, template] of variants) {
    await t.test(name, () => {
      const authConfig = { disable_signup: true };
      if (template !== undefined) authConfig.mailer_templates_invite_content = template;
      const evidence = inspectAuthConfig(authConfig);
      assert.equal(evidence.inviteTemplateExact, false);
      assert.equal(evidence.inviteTemplateSha256, INVITE_TEMPLATE_SHA256);
    });
  }
});
