'use client';

import { useState } from 'react';
import { WireButton } from '../../../../../../components/wire/wire-button';

/**
 * 접힘 칸 전체 여닫기 (2026-08-09 Q — 당사자 카드 안 작은 버튼).
 *
 * 구 자리는 본문 맨 위의 조작 줄이었다. 그 줄은 버튼 하나만 담고 있어서, 스크롤을 조금만
 * 내려도 화면 밖으로 나가 정작 접힘 칸을 볼 때는 없었다. HERO 는 이 화면에서 유일하게
 * "이 당사자·이 기록 전체"를 가리키는 자리이므로 전체 여닫기가 거기 붙는 것이 맞다.
 *
 * **상태를 위로 올리지 않았다.** 여닫기는 이미 DOM 을 직접 만지는 조작이고(details.open),
 * 리액트가 쥔 것은 버튼 라벨 하나뿐이다. HERO 는 서버 컴포넌트가 그리므로, 상태를 올리려면
 * 화면 절반을 클라이언트로 내려야 한다 — 라벨 한 글자를 위해 치를 값이 아니다.
 *
 * 범위는 선택자로 찾는다(.record-main). 같은 화면에 접힘 칸을 담은 다른 영역이 생기면
 * 그때 범위를 명시적으로 넘기면 된다.
 */
export function RecordAccordionToggle() {
  const [allOpen, setAllOpen] = useState(false);

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    const scope = document.querySelector('.record-main');
    if (scope === null) return;
    for (const details of scope.querySelectorAll('details')) {
      // 위기·안전 칸의 자동 펼침은 일괄 접기보다 우선한다 — 위기 선택 중에는 숨길 수 없다.
      if (!next && details.classList.contains('is-crisis')) continue;
      details.open = next;
    }
  };

  return (
    <WireButton onClick={toggleAll} variant="neutral" height="sm">
      {allOpen ? '전체 접기' : '전체 열기'}
    </WireButton>
  );
}
