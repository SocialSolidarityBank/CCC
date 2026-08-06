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
import { WireCard } from '../../components/wire/wire-card';
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

// D44: 동의 2종(D49)은 등록 때 받고 **여기서 고친다**(인테이크는 읽기만). 담고 있는 값은
// 이 참여 사업의 현재 상태이고, 저장하면 게이트웨이가 append-only 이력에 새 행을 남긴다
// (철회도 이력으로 남는다, D14·D23). 담당하지 않는 사업에는 이 블록을 그리지 않는다 —
// D36 은 존재와 담당 실무자까지만 보여 주자는 결정이지 쓰기 권한을 넓힌 것이 아니다.
const CONSENT_ITEMS = [
  { name: 'consentPrivacy', label: '개인정보 수집·이용 동의', key: 'privacy' },
  { name: 'consentRecordingAi', label: 'AI를 활용한 녹취기록 동의', key: 'recordingAi' },
] as const;

/** 마지막으로 동의 상태를 기록한 시각. 최초 동의일이 아니다 — 저장할 때마다 갱신된다. */
function formatConsentRecordedAt(value: string | null): string {
  if (value === null) return '기록 없음';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' })
    .format(date);
}

// 테스트에서 직접 렌더한다 — 체크박스 `name` 이 서버 액션이 읽는 키와 어긋나면 오류가 아니라
// **조용한 철회**가 저장된다(checkbox 헬퍼는 키가 없으면 false 다). 그래서 이름을 DOM 으로 고정한다.
export function ConsentEditor({ beneficiaryId, program }: { beneficiaryId: string; program: ParticipantProgram }) {
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

/** 참여중인 사업 카드의 한 행(2026-08-06 Q — 구 사업별 낱개 카드 대체). 동의서는 여기서
 *  뺐다 — 페이지 맨 아래 동의서 카드로 옮겼다(같은 날 Q 지시). 행 사이는 --line 구분선이다
 *  (카드 안 카드 금지 — D59 ③ 유지). */
function ProgramRow({ beneficiaryId, program, programTitle }: {
  beneficiaryId: string;
  program: ParticipantProgram;
  programTitle: string;
}) {
  return (
    <div className="participant-program-row">
      <div className="participant-program-head">
        <h3>{programTitle}</h3>
        <span className="status mint">{programStatus(program.status)}</span>
      </div>
      <p className="participant-program-meta">참여 시작 {formatIntakeDate(program.intakeAt)}</p>
      <AssigneeLine names={program.assigneeNames} />
      {program.authorized ? (
        <div className="participant-program-actions">
          <WireButton href={briefingHref(beneficiaryId, program.id)} variant="primary">상담 준비</WireButton>
          <WireButton href={recordsHref(beneficiaryId, program.id)}>상담 기록</WireButton>
        </div>
      ) : (
        // D36: 담당하지 않는 사업. 존재와 담당 실무자까지만 알려주고 상담 내용은 열지 않는다.
        // 잠긴 이유를 문장으로 적는다 — 버튼만 없으면 "왜 없지"가 남는다.
        <p className="participant-program-locked">
          담당하지 않는 사업입니다. 상담 내용은 담당 실무자에게 확인하세요.
        </p>
      )}
    </div>
  );
}

/** 다가오는 일정 표기 — 일정 카드 1행과 같은 어휘(날짜 · 시각 · 유형 뱃지). 기관 표준
 *  시간대 표기는 이 파일의 다른 시각 표기(참여 시작·동의 기록)와 같이 Asia/Seoul 이다. */
function formatScheduleParts(value: string): { date: string; time: string } {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: value, time: '' };
  return {
    date: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(instant),
    time: new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(instant),
  };
}

const scheduleKindLabels: Record<'regular' | 'intake', string> = {
  regular: '기본 상담',
  intake: '인테이크',
};

/** 최신 일정 카드(2026-08-06 Q) — 담당 사업들의 예정 일정 중 가장 이른 1건. */
function NextScheduleCard({ beneficiaryId, programs, programLabels }: {
  beneficiaryId: string;
  programs: ParticipantProgram[];
  programLabels: Record<ParticipantProgramType, string>;
}) {
  const candidates = programs
    .filter((program) => program.upcomingSchedule !== null)
    .sort((left, right) => left.upcomingSchedule!.scheduledAt.localeCompare(right.upcomingSchedule!.scheduledAt));
  const next = candidates[0];

  return (
    <WireCard as="section" title="최신 일정">
      {next === undefined || next.upcomingSchedule === null ? (
        <>
          <p className="participant-program-meta">예정된 상담이 없습니다.</p>
          <div className="participant-program-actions">
            <WireButton href="/schedules/new">상담 등록</WireButton>
          </div>
        </>
      ) : (
        <>
          <div className="participant-next-schedule-row">
            <span className="participant-next-schedule-date">
              {formatScheduleParts(next.upcomingSchedule.scheduledAt).date}
            </span>
            <span className="participant-next-schedule-time">
              {formatScheduleParts(next.upcomingSchedule.scheduledAt).time}
            </span>
            <span className="wire-badge" data-tone="blue">
              {scheduleKindLabels[next.upcomingSchedule.sessionKind]}
            </span>
          </div>
          <p className="participant-program-meta">{programName(programLabels, next.programType)}</p>
          <div className="participant-program-actions">
            <WireButton href={briefingHref(beneficiaryId, next.id)} variant="primary">상담 준비</WireButton>
          </div>
        </>
      )}
    </WireCard>
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

  // 인테이크 기록의 입구(2026-08-06 Q) — 담당 사업 중 첫 번째(진행 중 우선 정렬)의 상담
  // 기록으로 간다. 인테이크는 회차 목록의 1회차라 별도 화면이 없다(D47).
  const intakeTarget = programs.find((program) => program.authorized);
  const consentPrograms = programs.filter((program) => program.authorized);

  return (
    <main className="page-content">
      <GridContainer>
        {/* ParticipantHeroCard (D38 · D59 개편 2026-08-04): 허브는 케이스가 교차하는 화면이라
            단일 상태가 없어 상태 태그를 생략한다(슬롯 ②).
            이름은 h2(18) — 이미 '그 사람' 화면이라 페이지 제목 크기가 과했다. 연락처는
            이름 옆에 나란히 직표시. 가명 ID 도 이름 옆이다(2026-08-06 Q — D59 ② 부분
            재개정을 허브 머리까지 넓혔다, 당사자 카드 정보 칸과 같은 표기). */}
        <ParticipantHeroCard
          name={detail.name}
          beneficiaryId={detail.beneficiaryId}
          nameSize="h2"
          showId
          {...(detail.phone !== null && detail.phone.length > 0 ? { contact: detail.phone } : {})}
          // 기본정보 수정(CCC-37)은 당사자 단위라 행동 슬롯(④)에 둔다. 인테이크 기록도
          // 같은 슬롯이다(2026-08-06 Q) — 세컨더리 2개, D38 상한(버튼 최대 2개) 안이다.
          actions={
            <>
              {intakeTarget !== undefined && (
                <WireButton href={recordsHref(detail.beneficiaryId, intakeTarget.id)}>인테이크 기록</WireButton>
              )}
              {editable && (
                <WireButton href={participantEditHref(detail.beneficiaryId)}>기본정보 수정</WireButton>
              )}
            </>
          }
        />
        {programs.length === 0 ? (
          <p className="empty" role="status">표시할 참여 사업이 없습니다.</p>
        ) : (
          <>
            {/* 참여중인 사업 + 최신 일정 두 카드가 나란히 선다(2026-08-06 Q — 구 사업별
                낱개 카드 대체). 그리드는 표준 카드 그리드(D37 §4-2)다. */}
            <div className="card-grid">
              <WireCard as="section" title="참여중인 사업">
                {programs.map((program) => (
                  <ProgramRow
                    key={program.id}
                    beneficiaryId={detail.beneficiaryId}
                    program={program}
                    programTitle={programName(programLabels, program.programType)}
                  />
                ))}
              </WireCard>
              <NextScheduleCard
                beneficiaryId={detail.beneficiaryId}
                programs={programs}
                programLabels={programLabels}
              />
            </div>
            {/* 동의서는 맨 아래다(2026-08-06 Q — 구 사업 카드 안 동의 묶음 대체). 저장 단위는
                여전히 참여 사업이라(D44) 담당 사업마다 한 묶음씩 서고, 사업이 여럿이면
                묶음 머리에 사업명이 선다. */}
            {consentPrograms.length > 0 && (
              <WireCard as="section" title="동의서">
                {consentPrograms.map((program) => (
                  <div key={program.id} className="participant-consent-block">
                    {consentPrograms.length > 1 && (
                      <h3 className="participant-consent-program">{programName(programLabels, program.programType)}</h3>
                    )}
                    <ConsentEditor beneficiaryId={detail.beneficiaryId} program={program} />
                  </div>
                ))}
              </WireCard>
            )}
          </>
        )}
        {/* '다른 당사자를 찾으려면 …' 안내줄은 삭제했다(2026-08-06 Q) — 당사자 목록은
            사이드바가 이미 안내한다(D35 사이드바=장소). */}
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
