import { WireButton } from '../../components/wire/wire-button';
import { redirect } from 'next/navigation';
import {
  ANIMAL_SLUG_BENEFICIARY_ID_PATTERN,
  LEGACY_BENEFICIARY_ID_PATTERN,
} from '../../../../../db/animal-slugs';

function legacySupportCaseId(caseId: string): string {
  return `legacy-support-case:${caseId}`;
}

export default async function LegacyCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  // 확장 단계(티켓 #11): 레거시 A형식은 대문자로, 동물 슬러그는 소문자로 정규화해 판정한다 (D20).
  const legacyCandidate = caseId.toUpperCase();
  const slugCandidate = caseId.toLowerCase();
  const beneficiaryId = LEGACY_BENEFICIARY_ID_PATTERN.test(legacyCandidate)
    ? legacyCandidate
    : ANIMAL_SLUG_BENEFICIARY_ID_PATTERN.test(slugCandidate)
      ? slugCandidate
      : null;

  if (beneficiaryId !== null) {
    redirect(`/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(legacySupportCaseId(beneficiaryId))}/briefing`);
  }

  return <main className="page-content"><header className="page-header"><div><h1>상담 준비</h1><p>이전 주소의 당사자 정보를 확인할 수 없습니다.</p></div></header><p className="status risk" role="alert">당사자 ID로 확인할 수 없는 이전 주소입니다.</p><div><WireButton variant="secondary" href="/">당사자 목록으로 돌아가기</WireButton></div></main>;
}
