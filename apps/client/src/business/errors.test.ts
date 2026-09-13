import { describe, expect, it } from 'vitest';
import { httpError } from './errors';

describe('HTTP 오류 번역', () => {
  it('동의 계약 위반 409 를 낙관 잠금 문구로 읽지 않는다', () => {
    const scope = httpError(409, { error: 'provider_scope_mismatch' });
    expect(scope.code).toBe('consent_scope_mismatch');
    expect(scope.message).not.toContain('다른 사람이 먼저 변경했습니다');
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
