import { notFound, redirect } from 'next/navigation';
import { isKnownProgramType } from '../../../../lib/labels';

// 구 '전체 일정' 경로. 일정 화면 통합(D75 · ADR-0039)으로 화면이 하나가 됐고,
// CCC-133 이 범위를 `?view=` 으로 바꿨다. 이 경로는 북마크·과거 링크를 살리는
// 리다이렉트만 남았다. month 쿼리는 그대로 넘기고 검증은 통합 화면이 한다
// (형식이 어긋나면 서버가 정한 이번 달로 떨어진다).
export default async function ProgramScheduleAllPage({
  params,
  searchParams,
}: {
  params: Promise<{ programType: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();
  const query = await searchParams;
  const month = typeof query.month === 'string' ? `&month=${encodeURIComponent(query.month)}` : '';
  redirect(`/programs/${encodeURIComponent(programType)}/schedule?view=month${month}`);
}
