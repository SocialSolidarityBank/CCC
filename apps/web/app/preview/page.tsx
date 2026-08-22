import type { Metadata } from 'next';
import { PreviewGateForm } from './preview-gate-form';

export const metadata: Metadata = { title: 'CCC 사례관리 미리보기' };

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 미리보기 코드 게이트 진입 화면(CCC-6). 팀원이 지정 코드를 입력하면 일반 POST 수신점이
 * API 로 검증하고 세션 쿠키를 심은 뒤 홈으로 보낸다. 이 화면은 API 를 호출하지 않아 쿠키
 * 없이도 렌더된다. 쿠키가 없는 다른 경로는 middleware.ts 가 이 화면으로 되돌린다.
 */
export default async function PreviewGatePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const errorCode = queryValue(query, 'error');

  return <PreviewGateForm mode="counselor" errorCode={errorCode} />;
}
