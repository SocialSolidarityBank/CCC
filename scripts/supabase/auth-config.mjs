import { createHash } from 'node:crypto';

export const BOUNDED_AUTH_CONFIG_KEYS = Object.freeze([
  'disable_signup',
  'external_anonymous_users_enabled',
  'external_email_enabled',
  'mailer_autoconfirm',
  'mfa_max_enrolled_factors',
  'mfa_totp_enroll_enabled',
  'mfa_totp_verify_enabled',
  'refresh_token_rotation_enabled',
  'security_captcha_enabled',
  'jwt_exp',
  'site_url',
  'sessions_single_per_user',
]);

export const RELAYER_INVITE_TEMPLATE_HTML = [
  '<h2>Relayer 관리자 초대</h2>',
  '<p>아래 링크를 열고 이 이메일 주소와 여섯 자리 인증 코드를 입력해 관리자 계정을 설정하세요.</p>',
  '<p><a href="{{ .RedirectTo }}">관리자 계정 설정</a></p>',
  '<p>인증 코드: <strong>{{ .Token }}</strong></p>',
  '<p>이 코드는 한 번만 사용할 수 있으며 만료되면 설치 담당자에게 새 초대를 요청해 주세요.</p>',
].join('\n');

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function boundedAuthConfig(authConfig) {
  if (!record(authConfig)) return null;
  return Object.fromEntries(BOUNDED_AUTH_CONFIG_KEYS.map(key => [key, authConfig[key] ?? null]));
}

export function authConfigFingerprint(authConfig) {
  const bounded = boundedAuthConfig(authConfig);
  if (bounded === null) return null;
  return sha256(JSON.stringify(bounded));
}

export function inspectAuthConfig(authConfig) {
  const bounded = boundedAuthConfig(authConfig);
  const prior = bounded === null ? null : { ...bounded, disable_signup: false };
  return {
    readable: bounded !== null,
    disableSignup: bounded?.disable_signup === true,
    inviteTemplateExact: record(authConfig)
      && authConfig.mailer_templates_invite_content === RELAYER_INVITE_TEMPLATE_HTML,
    inviteTemplateSha256: sha256(RELAYER_INVITE_TEMPLATE_HTML),
    currentAuthFingerprint: authConfigFingerprint(authConfig),
    priorAuthFingerprint: prior === null ? null : sha256(JSON.stringify(prior)),
  };
}
