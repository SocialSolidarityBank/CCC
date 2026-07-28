import { redirect } from 'next/navigation';
import { isBeneficiaryId } from '../../../../db/animal-slugs';

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// '상담 기록' 메뉴는 '상담 일정'로 병합되어 사라졌다(D21). 기존 /records 진입은
// 참여자 중심 동선으로 넘긴다: 참여자 ID가 붙어 있으면 그 참여자 페이지로, 없으면
// 상담 일정 홈으로 리다이렉트한다.
export default async function RecordsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const requestedBeneficiaryId = queryValue(query, 'beneficiaryId');
  if (requestedBeneficiaryId !== undefined && isBeneficiaryId(requestedBeneficiaryId)) {
    redirect(`/participants/${encodeURIComponent(requestedBeneficiaryId)}`);
  }
  redirect('/');
}
