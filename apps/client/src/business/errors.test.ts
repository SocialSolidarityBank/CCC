import { describe, expect, it } from 'vitest';
import { httpError } from './errors';
import { AiReviewApi } from './ai-review';
import { InvitesApi } from './invites';

describe('HTTP 오류 번역', () => {
  it('동의 계약 위반 409 를 낙관 잠금 문구로 읽지 않는다', () => {
    const scope = httpError(409, { error: 'provider_scope_mismatch' });
    expect(scope.code).toBe('consent_scope_mismatch');
    expect(httpError(409, { error: 'consent_disclosure_mismatch' }).code).toBe('consent_scope_mismatch');
  });

  it('초안 검토 409 를 각 복구 행동으로 가른다', () => {
    expect(httpError(409, { error: 'stale_draft_version' }).code).toBe('draft_changed');
    expect(httpError(409, { error: 'draft_version_required' }).code).toBe('draft_changed');
    expect(httpError(409, { error: 'speaker_confirmation_required' }).code)
      .toBe('speaker_confirmation_required');
    expect(httpError(409, { error: 'grounded_evidence_required' }).code)
      .toBe('grounded_evidence_required');
    expect(httpError(409, { error: 'fixture_draft_approval_forbidden' }).code)
      .toBe('fixture_draft_approval_forbidden');
  });

  it('그 밖의 409 는 그대로 동시 변경 충돌이다', () => {
    expect(httpError(409, { error: 'version_conflict' }).code).toBe('conflict');
    expect(httpError(409, { error: 'program_admission_required' }).code).toBe('program_admission_required');
  });
});

describe('CCC-212 browser error meanings', () => {
  it.each([
    [401, 'authentication_required', 'unauthenticated'],
    [403, 'access_denied', 'forbidden'],
    [400, 'validation_error', 'invalid_request'],
    [404, 'not_found', 'not_found'],
    [410, 'not_eligible_or_already_purged', 'unavailable'],
    [409, 'pilot_text_ai_consent_required', 'conflict'],
    [409, 'text_ai_pilot_disabled', 'text_ai_pilot_disabled'],
    [409, 'stale_draft_version', 'draft_changed'],
    [409, 'draft_version_required', 'draft_changed'],
    [409, 'ai_provider_not_configured', 'ai_provider_not_configured'],
    [422, 'ai_prohibited_output', 'ai_prohibited_output'],
    [503, 'ai_provider_unavailable', 'ai_provider_unavailable'],
    [503, 'service_unavailable', 'unavailable'],
    [401, 'actor_authentication_required', 'unauthenticated'],
    [409, 'consent_not_effective', 'consent_not_effective'],
  ] as const)('maps HTTP %s / %s to %s without exposing private response fields', (status, raw, code) => {
    const privateText = 'PRIVATE_PROVIDER_RESPONSE_SENTINEL';
    const error = httpError(status, { error: raw, message: privateText, provider: privateText, token: privateText, url: privateText });
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(JSON.stringify({ name: error.name, message: error.message, error })).not.toContain(privateText);
  });

  it.each([
    [403, 'forbidden'], [409, 'conflict'], [422, 'invalid_request'], [503, 'unavailable'],
  ] as const)('keeps unknown HTTP %s payloads generic and redacted', (status, code) => {
    const privateText = 'PRIVATE_UNKNOWN_RESPONSE_SENTINEL';
    for (const value of [null, privateText, { error: privateText, message: privateText }]) {
      const error = httpError(status, value);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(JSON.stringify({ name: error.name, message: error.message, error })).not.toContain(privateText);
    }
  });

  it('does not let an allowlisted body cross its status boundary or replace authentication recovery', () => {
    expect(httpError(401, { error: 'ai_provider_unavailable' }).code).toBe('unauthenticated');
    expect(httpError(403, { error: 'consent_not_effective' }).code).toBe('forbidden');
    expect(httpError(403, { error: 'mfa_required' }).code).toBe('mfa_required');
    expect(httpError(400, { error: 'ai_prohibited_output' }).code).toBe('invalid_request');
    expect(httpError(503, { error: 'consent_not_effective' }).code).toBe('unavailable');
    expect(httpError(422, { error: 'privacy_consent_required' }).code).toBe('privacy_consent_required');
    expect(httpError(422, { error: 'emergency_reason_required' }).code).toBe('emergency_reason_required');
    expect(httpError(429, { error: 'ai_provider_unavailable' }).code).toBe('rate_limited');
  });

  it('keeps draft and request-link 404 conversions scoped to their existing APIs', async () => {
    const transport = { request: async () => { throw httpError(404, { error: 'not_found' }); } };
    expect(httpError(404, { error: 'not_found' }).code).toBe('not_found');
    await expect(new AiReviewApi(transport as never).draft('session-1')).resolves.toBeNull();
    await expect(new InvitesApi(transport as never).createRequestLink('program-1'))
      .rejects.toMatchObject({ code: 'public_signup_disabled', status: 404 });
  });
});
