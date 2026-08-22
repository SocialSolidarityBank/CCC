import type { Metadata } from 'next';
import { PreviewGateForm } from '../preview-gate-form';

export const metadata: Metadata = { title: 'CCC 기관 관리자 미리보기' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PreviewAdminGatePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const value = query.error;
  const errorCode = typeof value === 'string' ? value : undefined;

  return <PreviewGateForm mode="admin" errorCode={errorCode} />;
}
