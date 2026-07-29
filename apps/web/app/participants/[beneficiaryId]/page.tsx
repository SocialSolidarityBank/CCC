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
import { getDisplayLabels } from '../../lib/display-labels';
import { updateParticipantConsentAction } from '../../actions';
import { ErrorState, type ErrorKind } from './error-state';

// 당사자 정보 — **허브** (D35 · ADR-0014 §3, D36). 사람은 사업보다 크므로 이 페이지는
// 사업 워크스페이스 범위를 벗어난다: 그 당사자의 **기관 내 전 참여 사업**이 보인다.
//
// D36 (2026-07-26 Q 확정): 동료가 담당하는 사업도 **존재와 담당 실무자 이름까지는** 보이고,
// 상담 내용(브리핑·기록)으로는 들어갈 수 없다. 근거는 "이 페이지를 여는 사람은 이미 그
// 당사자의 담당 실무자라 PII를 보고 있다" — 그래서 **케이스를 1건도 담당하지 않으면 서버가
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

// 사업 표시 이름은 온보딩 저장값 우선(CCC-32) — 요청 안에서는 getDisplayLabels() 가 1회로 접힌다.
function programName(labels: Record<ParticipantProgramType, string>, programType: ParticipantProgramType): string {
  const name = labels[programType];
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

/** 기본정보 수정 화면(CCC-37). 등록 7종을 등록 뒤에 고치는 자리다. */
function participantEditHref(beneficiaryId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/edit`;
}

function recordsHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records`;
}

function LoadingState() {
  return (
    <main className="page-content" aria-busy="true">
      <GridContainer>
        <div className="page-header"><div><h1>당사자 정보</h1></div></div>
        <p className="empty" role="status" aria-live="polite">당사자 정보를 불러오는 중입니다.</p>
      </GridContainer>
    </main>
  );
}

/** 담당 실무자 이름 줄. 이름이 없으면 아무것도 그리지 않는다 — 빈 라벨을 남기지 않는다. */
function AssigneeLine({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="participant-program-assignee">
      <span className="participant-program-assignee-label">담당</span>
      <span>{names.join(', ')}</span>
    </div>
  );
}

// D44: 동의 3종은 등록 때 받고 **여기서 고친다**(인테이크는 읽기만). 담고 있는 값은
// 이 참여 사업의 현재 상태이고, 저장하면 게이트웨이가 append-only 이력에 새 행을 남긴다
// (철회도 이력으로 남는다, D14·D23). 담당하지 않는 사업에는 이 블록을 그리지 않는다 —
// D36 은 존재와 담당 실무자까지만 보여 주자는 결정이지 쓰기 권한을 넓힌 것이 아니다.
const CONSENT_ITEMS = [
  { name: 'consentPrivacy', label: '개인정보 수집·이용 동의', key: 'privacy' },
  { name: 'consentRecording', label: '녹음·음성 분석 동의', key: 'recording' },
  { name: 'consentTextAi', label: '텍스트 AI 정리 동의', key: 'textAi' },
] as const;

/** 마지막으로 동의 상태를 기록한 시각. 최초 동의일이 아니다 — 저장할 때마다 갱신된다. */
function formatConsentRecordedAt(value: string | null): string {
  if (value === null) return '기록 없음';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' })
    .format(date);
}

function ConsentEditor({ beneficiaryId, program }: { beneficiaryId: string; program: ParticipantProgram }) {
  return (
    <form className="participant-program-consent" action={updateParticipantConsentAction}>
      <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
      <input type="hidden" name="supportCaseId" value={program.id} />
      <fieldset className="consent-fieldset">
        <legend>동의 (항목별)</legend>
        <p className="schedule-form-hint">
          동의는 오프라인(종이·구두)으로 받고, 시스템에는 체크·일시·기록자만 남깁니다.
          체크를 풀면 철회로 기록되며, 이전 기록은 지워지지 않습니다.
        </p>
        {CONSENT_ITEMS.map((item) => (
          <label className="consent-checkbox" key={item.name}>
            <input
              type="checkbox"
              className="wire-checkbox"
              name={item.name}
              value="on"
              defaultChecked={program.consent[item.key]}
            />
            <span>{item.label}</span>
          </label>
        ))}
        <p className="participant-program-consent-meta">
          마지막 기록 {formatConsentRecordedAt(program.consentRecordedAt)}
        </p>
        <WireButton type="submit">동의 저장</WireButton>
      </fieldset>
    </form>
  );
}

function ProgramCard({ beneficiaryId, program, programTitle }: {
  beneficiaryId: string;
  program: ParticipantProgram;
  programTitle: string;
}) {
  return (
    <article className="surface-card participant-program" data-locked={program.authorized ? undefined : 'true'}>
      <div className="participant-program-head">
        <h2>{programTitle}</h2>
        <span className="status">{programStatus(program.status)}</span>
      </div>
      <p className="participant-program-meta">참여 시작 {formatIntakeDate(program.intakeAt)}</p>
      <AssigneeLine names={program.assigneeNames} />
      {program.authorized ? (
        <>
          <div className="participant-program-actions">
            <WireButton href={briefingHref(beneficiaryId, program.id)} variant="primary">상담 준비</WireButton>
            <WireButton href={recordsHref(beneficiaryId, program.id)}>상담 기록</WireButton>
          </div>
          <ConsentEditor beneficiaryId={beneficiaryId} program={program} />
        </>
      ) : (
        // D36: 담당하지 않는 사업. 존재와 담당 실무자까지만 알려주고 상담 내용은 열지 않는다.
        // 잠긴 이유를 문장으로 적는다 — 버튼만 없으면 "왜 없지"가 남는다.
        <p className="participant-program-locked">
          담당하지 않는 사업입니다. 상담 내용은 담당 실무자에게 확인하세요.
        </p>
      )}
    </article>
  );
}

async function ParticipantHub({ detail }: { detail: ParticipantDetail }) {
  const { programLabels } = await getDisplayLabels();
  // 진행 중을 먼저, 그 안에서는 사업명 순. 내 담당을 위로 올리지 않는다 — 사람 단위로
  // 무엇에 참여 중인지가 이 화면의 질문이고, 담당 여부는 카드 안에서 읽힌다.
  const programs = [...detail.programs].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
    return programName(programLabels, left.programType).localeCompare(programName(programLabels, right.programType), 'ko')
      || left.id.localeCompare(right.id);
  });

  // 기본정보 수정(CCC-37)은 **진행 중인 담당 사업이 있을 때만** 들어갈 수 있다 — 금고 쓰기가
  // 활성 참여 사업 컨텍스트를 요구하기 때문이다(게이트웨이 계약). 종결만 남은 당사자에게
  // 버튼을 띄우면 "권한과 주소를 확인하세요"라는 엉뚱한 오류 화면으로 보낸다.
  const editable = programs.some((program) => program.authorized && program.status === 'active');

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
          // 기본정보 수정(CCC-37)은 당사자 단위라 행동 슬롯(④)에 둔다 — 동의는 참여
          // 사업마다 다르므로 카드 안에 남는다. 둘은 저장 단위가 달라 섞지 않는다(D44).
          actions={editable
            ? <WireButton href={participantEditHref(detail.beneficiaryId)}>기본정보 수정</WireButton>
            : undefined}
        />
        {programs.length === 0 ? (
          <p className="empty" role="status">표시할 참여 사업이 없습니다.</p>
        ) : (
          <section className="participant-program-list" aria-label="참여 사업 목록">
            {programs.map((program) => (
              <ProgramCard
                key={program.id}
                beneficiaryId={detail.beneficiaryId}
                program={program}
                programTitle={programName(programLabels, program.programType)}
              />
            ))}
          </section>
        )}
        <p className="note-inline">
          다른 당사자를 찾으려면 <Link href="/participants">당사자 목록</Link>으로 가세요.
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
