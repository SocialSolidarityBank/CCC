import Link from 'next/link';
import { Suspense } from 'react';
import {
  ApiError,
  getParticipantDetail,
  type ParticipantDetail,
  type ParticipantProgram,
  type ParticipantProgramType,
} from '../../lib/api';
import { isBeneficiaryId } from '../../../../../db/animal-slugs';
import { GridContainer } from '../../components/wire/grid-container';
import { ParticipantHeroCard } from '../../components/wire/participant-hero-card';
import { WireButton } from '../../components/wire/wire-button';
import { PROGRAM_LABELS } from '../../lib/labels';
import { ErrorState, type ErrorKind } from './error-state';

// 참여자 정보 — **허브** (D35 · ADR-0014 §3, D36). 사람은 사업보다 크므로 이 페이지는
// 사업 워크스페이스 범위를 벗어난다: 그 참여자의 **조직 내 전 참여 사업**이 보인다.
//
// D36 (2026-07-26 Q 확정): 동료가 담당하는 사업도 **존재와 담당자 이름까지는** 보이고,
// 상담 내용(브리핑·기록)으로는 들어갈 수 없다. 근거는 "이 페이지를 여는 사람은 이미 그
// 참여자의 담당자라 PII를 보고 있다" — 그래서 **케이스를 1건도 담당하지 않으면 서버가
// 페이지 자체를 막는다**(ForbiddenError → 아래 access_or_not_found). 화면은 그 판정을
// 다시 하지 않고 서버가 준 `authorized` 로 링크만 잠근다.
//
// PII: 실명·연락처는 API 가 이미 내려주고 감사도 서버에 이미 있다(D24 화면 조회당 1건).
// **여기서 감사를 새로 남기지 않는다** — 중복이 된다.

function expectedApiErrorKind(error: ApiError): ErrorKind | null {
  switch (error.code) {
    case 'authentication_required':
      return 'authentication_required';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return 'access_or_not_found';
    case 'service_unavailable':
      return 'service_unavailable';
    default:
      return null;
  }
}

function programName(programType: ParticipantProgramType): string {
  const name = PROGRAM_LABELS[programType];
  if (name === undefined) throw new Error('Participant program type was invalid.');
  return name;
}

function programStatus(status: ParticipantProgram['status']): string {
  return status === 'active' ? '진행 중' : '종결';
}

/**
 * 참여 시작일. intakeAt 은 ISO 문자열이라 그대로 쓰면 "2026-06-15T10:00:00.000Z" 가 화면에
 * 나온다 — 비개발자 사용자에게 읽히지 않는다. 날짜만 한국어로 표기한다(시각은 의미 없음).
 */
function formatIntakeDate(value: string | null): string {
  if (value === null) return '기록 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(date);
}

function briefingHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/briefing`;
}

function recordsHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records`;
}

function LoadingState() {
  return (
    <main className="page-content" aria-busy="true">
      <GridContainer>
        <div className="page-header"><div><h1>참여자 정보</h1></div></div>
        <p className="empty" role="status" aria-live="polite">참여자 정보를 불러오는 중입니다.</p>
      </GridContainer>
    </main>
  );
}

/** 담당자 이름 줄. 이름이 없으면 아무것도 그리지 않는다 — 빈 라벨을 남기지 않는다. */
function AssigneeLine({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="participant-program-assignee">
      <span className="participant-program-assignee-label">담당</span>
      <span>{names.join(', ')}</span>
    </div>
  );
}

function ProgramCard({ beneficiaryId, program }: { beneficiaryId: string; program: ParticipantProgram }) {
  return (
    <article className="surface-card participant-program" data-locked={program.authorized ? undefined : 'true'}>
      <div className="participant-program-head">
        <h2>{programName(program.programType)}</h2>
        <span className="status">{programStatus(program.status)}</span>
      </div>
      <p className="participant-program-meta">참여 시작 {formatIntakeDate(program.intakeAt)}</p>
      <AssigneeLine names={program.assigneeNames} />
      {program.authorized ? (
        <div className="participant-program-actions">
          <WireButton href={briefingHref(beneficiaryId, program.id)} variant="primary">상담 준비</WireButton>
          <WireButton href={recordsHref(beneficiaryId, program.id)}>상담 기록</WireButton>
        </div>
      ) : (
        // D36: 담당하지 않는 사업. 존재와 담당자까지만 알려주고 상담 내용은 열지 않는다.
        // 잠긴 이유를 문장으로 적는다 — 버튼만 없으면 "왜 없지"가 남는다.
        <p className="participant-program-locked">
          담당하지 않는 사업입니다. 상담 내용은 담당 상담사에게 확인하세요.
        </p>
      )}
    </article>
  );
}

function ParticipantHub({ detail }: { detail: ParticipantDetail }) {
  // 진행 중을 먼저, 그 안에서는 사업명 순. 내 담당을 위로 올리지 않는다 — 사람 단위로
  // 무엇에 참여 중인지가 이 화면의 질문이고, 담당 여부는 카드 안에서 읽힌다.
  const programs = [...detail.programs].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
    return programName(left.programType).localeCompare(programName(right.programType), 'ko')
      || left.id.localeCompare(right.id);
  });

  return (
    <main className="page-content">
      <GridContainer>
        {/* ParticipantHeroCard (D38): 허브는 케이스가 교차하는 화면이라
            단일 상태가 없어 상태 태그를 생략한다(슬롯 ②).
            연락처는 메타 한 줄로 흡수(슬롯 ③) — 계좌·주소 등 추가 PII는
            메타 줄에 올리지 않는다(§5 계약). */}
        <ParticipantHeroCard
          name={detail.name}
          beneficiaryId={detail.beneficiaryId}
          meta={detail.phone !== null && detail.phone.length > 0 ? `연락처 ${detail.phone}` : undefined}
        />
        {programs.length === 0 ? (
          <p className="empty" role="status">표시할 참여 사업이 없습니다.</p>
        ) : (
          <section className="participant-program-list" aria-label="참여 사업 목록">
            {programs.map((program) => (
              <ProgramCard key={program.id} beneficiaryId={detail.beneficiaryId} program={program} />
            ))}
          </section>
        )}
        <p className="note-inline">
          다른 참여자를 찾으려면 <Link href="/participants">참여자 목록</Link>으로 가세요.
        </p>
      </GridContainer>
    </main>
  );
}

async function ParticipantContent({ beneficiaryId }: { beneficiaryId: string }) {
  if (!isBeneficiaryId(beneficiaryId)) return <ErrorState kind="access_or_not_found" />;

  try {
    const detail = await getParticipantDetail(beneficiaryId);
    if (detail.beneficiaryId !== beneficiaryId) {
      throw new Error('Participant detail response did not match the requested participant.');
    }
    return <ParticipantHub detail={detail} />;
  } catch (error) {
    const kind = error instanceof ApiError ? expectedApiErrorKind(error) : null;
    if (kind === null) throw error;
    return <ErrorState kind={kind} />;
  }
}

export default async function ParticipantPage({ params }: { params: Promise<{ beneficiaryId: string }> }) {
  const { beneficiaryId } = await params;
  return <Suspense fallback={<LoadingState />}><ParticipantContent beneficiaryId={beneficiaryId} /></Suspense>;
}
