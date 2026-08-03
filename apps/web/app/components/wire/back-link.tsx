'use client';

import { useRouter } from 'next/navigation';
import { Icon } from './icon';
import { useEffect, useState } from 'react';

/**
 * 뒤로 가기 (2026-07-31 Q 요청). 모든 화면 좌상단 같은 자리에 둔다.
 *
 * D47 은 "브리핑 복귀는 브라우저 뒤로가기"라고 적었고 그 판단으로 앱 안 뒤로가기를 두지
 * 않았다. 그 전제는 **쓰는 사람이 브라우저 뒤로가기를 안다**는 것인데, 심사위원처럼 처음
 * 여는 사람에게는 보이는 출구가 하나도 없다. 그래서 브라우저 기능을 없애는 것이 아니라
 * **화면에도 같은 출구를 하나 낸다** — 두 방법의 결과는 같다(router.back()).
 *
 * 자리는 페이지 제목 위 좌상단이다. D35 축(사이드바=장소 / 우상단=행동)을 건드리지
 * 않는 유일한 자리이기도 하다 — 뒤로가기는 장소도 행동도 아닌 '되돌리기'다.
 *
 * **돌아갈 곳이 없으면 아예 그리지 않는다.** 처음에는 그 경우 홈으로 보내려 했는데, 홈(`/`)은
 * 서버가 마지막 선택 사업의 일정으로 **리다이렉트**하는 경로다. 리다이렉트는 히스토리를 쌓지
 * 않고 갈아치우므로, 링크를 받아 연 사람은 일정 화면에 length===1 로 도착한다 — 거기서 홈으로
 * 보내면 같은 화면으로 되돌아와 아무 일도 안 일어난 것처럼 보인다. 심사위원이 링크를 열었을 때가
 * 정확히 이 경우다. 갈 곳이 없으면 출구를 만들지 않는 편이 정직하다.
 *
 * 판단을 effect 로 미루는 이유는 history 가 서버에 없기 때문이다 — 서버·클라이언트 첫 렌더가
 * 모두 null 이라야 하이드레이션이 어긋나지 않는다.
 */
export function BackLink() {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => { setCanGoBack(window.history.length > 1); }, []);

  if (!canGoBack) return null;

  return (
    <button type="button" className="page-back" onClick={() => router.back()}>
      <Icon name="arrow-left" size={14} />
      <span>뒤로</span>
    </button>
  );
}
