'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * 떠오름 배선 (DESIGN.md §6 · D58/ADR-0028 · CCC-53).
 *
 * 페이지 본문의 직속 자식(섹션·카드 묶음)이 뷰포트에 **처음** 들어올 때 한 번만
 * `.motion-rise`(opacity 0→1 + 8px, 200ms)를 붙인다. 상한(1회·8px·200ms)은 구 §6 v1
 * "스크롤 트리거 금지"의 목적(15초 훑기 방해 방지)을 승계한 값이다 — 늘리려면 ADR 개정.
 *
 * 미리 숨기지 않는다: 클래스가 붙는 순간 애니메이션이 시작되므로 JS 가 없으면 그냥
 * 보인다(무JS 안전). reduced-motion 은 tokens.css 의 시스템 계약이 1ms 로 줄이지만,
 * 여기서도 미리 걸러 클래스 조작 자체를 생략한다.
 *
 * 라우트가 바뀌면 새 페이지의 요소를 다시 관찰한다 — "페이지당 1회"의 단위가 경로다.
 */
export function MotionRise() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const targets = document.querySelectorAll('.page-content > *');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('motion-rise');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.05 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
