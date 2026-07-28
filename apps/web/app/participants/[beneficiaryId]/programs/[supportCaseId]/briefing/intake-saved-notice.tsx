'use client';

import { useEffect, type CSSProperties } from 'react';
import { WireButton } from '../../../../../components/wire/wire-button';

// 인테이크 저장 직후 브리핑에 한 번만 뜨는 안내줄(CCC-31 · 스펙 #78 US 17·18).
//
// 1회성 보장은 URL이 한다 — 리다이렉트 도착 URL에만 notice=intake_saved가 실린다.
// 그 값이 아니면(파라미터 없음·새로고침·다른 코드) 아무것도 그리지 않고, 값이 있으면
// 마운트 직후 history.replaceState로 파라미터를 지워 새로고침 재표시를 막는다.
// router.replace를 쓰면 서버 컴포넌트가 다시 실행되며 브리핑 게이트웨이 조회·감사가
// 중복된다(D14) — URL 정리만 필요하므로 히스토리 교체가 맞는다.
//
// 시각은 draft-notice와 같은 축이다: 블루 tint(시간·상태, D34) + --line 1px + radius 12.
// 리스크 배너의 어휘(그라데이션 테두리·전용 tint·경고 아이콘)는 확인된 리스크 전용이라
// 빌리지 않는다(D9). 버튼은 후속 안내이므로 세컨더리 — 프라이머리는 HERO 주 행동 몫이다(§4-5).

const noticeStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  background: 'var(--blue-tint)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-card)',
};

const titleStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' };
const bodyStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--sub)' };
const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };

function scheduleHref(beneficiaryId: string, supportCaseId: string): string {
  return `/schedules/new?target=${encodeURIComponent(`${beneficiaryId}|${supportCaseId}`)}`;
}

export function IntakeSavedNotice({
  notice,
  beneficiaryId,
  supportCaseId,
}: {
  notice: string | undefined;
  beneficiaryId: string;
  supportCaseId: string;
}) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('notice')) {
      url.searchParams.delete('notice');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);

  if (notice !== 'intake_saved') return null;

  return (
    <section style={noticeStyle} role="status" aria-live="polite" data-testid="intake-saved-notice">
      <p style={titleStyle}>인테이크 기록을 저장했습니다</p>
      <p style={bodyStyle}>다음 상담을 등록해 두면 상담 일정과 기록 작성으로 바로 이어갈 수 있습니다.</p>
      <div style={actionsStyle}>
        <WireButton variant="secondary" height="sm" href={scheduleHref(beneficiaryId, supportCaseId)}>
          다음 상담 등록
        </WireButton>
      </div>
    </section>
  );
}
