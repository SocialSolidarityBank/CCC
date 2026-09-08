import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { CounselingMemoryPrototype } from './prototype';

// 가상 데이터로 현재 맥락의 노출 구조 A/B/C를 비교하는 폐기 가능한 시안이다.
export default function CounselingMemoryPrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Suspense fallback={<p className="panel-meta">검토용 시안을 여는 중입니다.</p>}>
    <CounselingMemoryPrototype />
  </Suspense>;
}
