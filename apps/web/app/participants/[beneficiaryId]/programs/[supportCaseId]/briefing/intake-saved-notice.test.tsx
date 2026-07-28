import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { IntakeSavedNotice } from './intake-saved-notice';

// 인테이크 저장 → 브리핑 직행 뒤의 1회성 안내줄(CCC-31 · 스펙 #78 US 17·18).
// 1회성의 실체는 URL이다: 파라미터가 있을 때만 뜨고, 뜨는 즉시 주소에서 지운다.

const BENEFICIARY = 'swallow-003';
const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';

function renderNotice(notice: string | undefined) {
  return render(
    <IntakeSavedNotice notice={notice} beneficiaryId={BENEFICIARY} supportCaseId={SUPPORT_CASE_ID} />,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('IntakeSavedNotice', () => {
  it('저장 직후 진입(notice=intake_saved)에서만 표시한다', () => {
    expect(renderNotice(undefined).queryByTestId('intake-saved-notice')).toBeNull();
    expect(renderNotice('record_submission_processed').queryByTestId('intake-saved-notice')).toBeNull();
    expect(renderNotice('intake_saved').queryByTestId('intake-saved-notice')).not.toBeNull();
  });

  it('다음 상담 등록 버튼은 참여자·참여 사업이 자동 선택되는 상담 등록 화면으로 간다', () => {
    const { getByRole } = renderNotice('intake_saved');
    const link = getByRole('link', { name: '다음 상담 등록' });
    expect(link.getAttribute('href')).toBe(
      `/schedules/new?target=${encodeURIComponent(`${BENEFICIARY}|${SUPPORT_CASE_ID}`)}`,
    );
  });

  it('표시 직후 주소에서 파라미터를 지워 새로고침하면 다시 뜨지 않는다', () => {
    window.history.replaceState(null, '', '/briefing?notice=intake_saved');
    renderNotice('intake_saved');
    expect(new URL(window.location.href).searchParams.has('notice')).toBe(false);
  });
});
