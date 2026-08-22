'use client';

import { useEffect } from 'react';

/**
 * 브리핑 앵커 진입 시 그 회차를 펼친다 (D47 · ADR-0019 §1).
 *
 * 브리핑은 이 화면으로 `#record-{회차ID}` 를 걸어 들어온다(영역 ③의 '기록 보기',
 * 영역 ①의 AI 제안 근거 링크). 접힘이 기본이 되면서 앵커 진입은 곧 "그 회차를 펴서
 * 보여 달라"는 뜻이 됐다 — 안 펴면 브라우저가 접힌 줄로 스크롤만 하고 내용은 안 보인다.
 *
 * 해시는 서버로 오지 않으므로 이 판정만 브라우저 쪽에 남는다. 나머지(최신 1개 열기)는
 * 전부 서버 렌더라 자바스크립트가 죽어도 화면은 성립한다.
 *
 * `hashchange` 까지 듣는 이유: 이미 이 화면에 있을 때 같은 페이지 안의 앵커를 누르면
 * 마운트가 다시 일어나지 않아 첫 진입만 처리하면 두 번째 링크가 조용히 안 먹는다.
 */
export function RecordHashOpener() {
  useEffect(() => {
    function openFromHash() {
      const { hash } = window.location;
      if (!hash.startsWith('#record-')) return;
      const target = document.getElementById(hash.slice(1));
      if (!(target instanceof HTMLDetailsElement)) return;
      // 이미 열려 있으면 건드리지 않는다 — open 을 다시 쓰면 애니메이션이 튄다.
      if (!target.open) target.open = true;
      // 펴기 전에 브라우저가 이미 스크롤을 마쳤으므로 위치를 다시 맞춘다.
      target.scrollIntoView({ block: 'start' });
    }

    openFromHash();
    // Next App Router가 다른 경로의 해시 링크로 이동할 때는 이 컴포넌트가 마운트된 뒤
    // location.hash를 붙일 수 있다. 그 전환은 hashchange를 따로 내지 않으므로 다음
    // 페인트 직전에 한 번 더 확인해야 접힌 과거 회차도 확실히 열린다.
    const frame = window.requestAnimationFrame(openFromHash);
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', openFromHash);
    };
  }, []);

  return null;
}
