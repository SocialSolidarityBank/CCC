import { Suspense } from 'react';
import Link from 'next/link';
import {
  ApiError,
  getParticipantDetail,
  getParticipantGoalTree,
  type ParticipantDetail,
  type ParticipantGoalTreeCase,
  type ParticipantProgram,
  type ParticipantProgramType,
} from '../../lib/api';
import { isBeneficiaryId } from '../../../../../db/animal-slugs';
import { GridContainer } from '../../components/wire/grid-container';
import { PageLoading } from '../../components/wire/page-loading';
import { PageTitle } from '../../components/wire/page-title';
import { ParticipantHeroCard } from '../../components/wire/participant-hero-card';
import { ConsultationTypeBadge } from '../../components/wire/consultation-type-badge';
import { Chevron } from '../../components/wire/chevron';
import { WireBadge } from '../../components/wire/wire-badge';
import { WireButton } from '../../components/wire/wire-button';
import { WireCard } from '../../components/wire/wire-card';
import { getDisplayLabels } from '../../lib/display-labels';
import { formatKoreanDateTime } from '../../lib/format-korean-date';
import { updateParticipantConsentAction } from '../../actions';
import {
  CONSENT_DETAIL_DISCLAIMER,
  CONSENT_PRIVACY_SECTIONS,
  CONSENT_RECORDING_AI_SECTIONS,
  type ConsentDetailSection,
} from '../new/consent-copy';
import { ErrorState, type ErrorKind } from './error-state';
import { GoalTreeCard } from './goal-tree';

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

/** 케이스 종결 확인 화면(CCC-107). 종결 뒤에는 같은 주소가 종결 정보 읽기 전용 화면이 된다. */
function closeHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/close`;
}

/** 인테이크 화면(2026-08-08 Q). 주소는 전체 상담 기록의 하위다.
 *  기록이 있으면 조회가 기본이고(CCC-58), 수정은 그 화면의 버튼이 연다. 없으면 작성 위저드다. */
function intakeHref(beneficiaryId: string, supportCaseId: string): string {
  return `${recordsHref(beneficiaryId, supportCaseId)}/intake`;
}

// 공용 로딩 부품(2026-08-09 Q "전역 로딩 화면 통일").
function LoadingState() {
  return <PageLoading title="당사자 정보" />;
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

// 항목별 전문(2026-08-07 Q "각 동의 체크박스 아래 전문 보기") — 문안은 등록 폼과 같은
// consent-copy 정본을 항목별로 갈라 실은 것이라 한 글자도 다르지 않다.
const CONSENT_ITEM_SECTIONS: Record<(typeof CONSENT_ITEMS)[number]['key'], ConsentDetailSection[]> = {
  privacy: CONSENT_PRIVACY_SECTIONS,
  recordingAi: CONSENT_RECORDING_AI_SECTIONS,
};

/** 전문 보기 아코디언 — 등록 폼 '자세히 읽어보기'와 같은 부품(.consent-detail)의 인라인 변형. */
function ConsentDetailAccordion({ sections }: { sections: ConsentDetailSection[] }) {
  return (
    <details className="consent-detail" data-inline="true">
      <summary className="consent-detail-summary">
        <span>전문 보기</span>
        <span aria-hidden="true" className="wire-card-arrow" />
      </summary>
      <div className="consent-detail-body">
        <p className="consent-detail-disclaimer">{CONSENT_DETAIL_DISCLAIMER}</p>
        {sections.map((section) => (
          <div className="consent-detail-section" key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs?.map((paragraph) => <p className="consent-detail-paragraph" key={paragraph}>{paragraph}</p>)}
            {section.items === undefined ? null : (
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/** 마지막으로 동의 상태를 기록한 시각. 최초 동의일이 아니다 — 저장할 때마다 갱신된다. */
function formatConsentRecordedAt(value: string | null): string {
  if (value === null) return '기록 없음';
  return formatKoreanDateTime(value);
}

/** '저장' 버튼이 폼 밖(카드·묶음 제목 줄 우측)에 서므로 form 속성으로 잇는다(2026-08-07 Q — 라벨도 '저장' 하나다). */
function consentFormId(supportCaseId: string): string {
  return `consent-form-${supportCaseId}`;
}

// 테스트에서 직접 렌더한다 — 체크박스 `name` 이 서버 액션이 읽는 키와 어긋나면 오류가 아니라
// **조용한 철회**가 저장된다(checkbox 헬퍼는 키가 없으면 false 다). 그래서 이름을 DOM 으로 고정한다.
// '저장' 버튼은 이 폼 안에 없다 — 제목 줄 우측에 서고 form 속성으로 이 폼을 가리킨다
// (2026-08-07 Q "동의서와 같은 라인 우측", 라벨은 '저장').
export function ConsentEditor({ beneficiaryId, program }: { beneficiaryId: string; program: ParticipantProgram }) {
  return (
    <form id={consentFormId(program.id)} className="participant-program-consent" action={updateParticipantConsentAction}>
      <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
      <input type="hidden" name="supportCaseId" value={program.id} />
      {/* legend 는 없다(2026-08-07 Q "'동의' 텍스트는 필요 없어 보이네" — 카드 제목 '동의서'가
          이미 구획을 말한다). 접근성 이름은 aria-label 이 잇는다. */}
      <fieldset className="consent-fieldset" aria-label="동의">
        <p className="schedule-form-hint">
          동의는 오프라인(종이·구두)으로 받고, 시스템에는{' '}
          <span className="participant-consent-nowrap">체크·일시·기록자만</span> 남깁니다.
          체크를 풀면 철회로 기록되며, 이전 기록은 지워지지 않습니다.
        </p>
        {CONSENT_ITEMS.map((item) => (
          // 체크 라벨과 '전문 보기'가 한 줄에 서고, 펼친 전문만 그 아래로 떨어진다
          // (2026-08-08 Q "우측에 나란히 가운데 정렬"). 배치는 .consent-item 이 갖는다.
          <div className="consent-item" key={item.name}>
            <label className="consent-checkbox">
              <input
                type="checkbox"
                className="wire-checkbox"
                name={item.name}
                value="on"
                defaultChecked={program.consent[item.key]}
              />
              <span>{item.label}</span>
            </label>
            <ConsentDetailAccordion sections={CONSENT_ITEM_SECTIONS[item.key]} />
          </div>
        ))}
        <p className="participant-program-consent-meta">
          마지막 기록 {formatConsentRecordedAt(program.consentRecordedAt)}
        </p>
      </fieldset>
    </form>
  );
}

/** 참여중인 사업 카드의 한 행(2026-08-06 Q — 구 사업별 낱개 카드 대체). 동의서는 여기서
 *  뺐다 — 페이지 맨 아래 동의서 카드로 옮겼다(같은 날 Q 지시). 행 사이는 --line 구분선이다
 *  (카드 안 카드 금지 — D59 ③ 유지).
 *  2026-08-07 Q 단순화: **사업명 리스트업이다** — 상담 준비·상담 기록 버튼과 참여 시작
 *  메타를 뺐다(최신 일정 카드와 내용이 중복됐다). 남는 것은 사업명·상태 뱃지·담당 이름
 *  한 줄 — 담당 이름은 D36 이 허브에 보이라고 정한 값이라 유지한다. 버튼이 없어졌으므로
 *  구 '담당하지 않는 사업입니다' 잠금 문구도 설 자리가 없다. */
function ProgramRow({ beneficiaryId, program, programTitle }: {
  beneficiaryId: string;
  program: ParticipantProgram;
  programTitle: string;
}) {
  return (
    <div className="participant-program-row">
      <div className="participant-program-head">
        <span className="participant-program-head-main">
          <h3>{programTitle}</h3>
          {/* 종결은 무채색이다 — 민트는 진행(사람·상태) 축의 색이라 닫힌 케이스에 어울리지 않는다(D58 ④). */}
          <WireBadge tone={program.status === 'active' ? 'mint' : 'neutral'}>{programStatus(program.status)}</WireBadge>
        </span>
        {/* 케이스 종결 입구(CCC-107). 담당(또는 admin) 사업에만 선다 — D36 은 존재·담당
               이름까지만 보여주자는 결정이지 쓰기 권한을 넓힌 것이 아니다. 진행 중이면 종결
               확인 화면으로, 이미 종결이면 같은 주소가 종결일·파기 예정일 읽기 전용이 된다. */}
        {program.authorized && (
          <WireButton variant="secondary" height="sm" href={closeHref(beneficiaryId, program.id)}>
            {program.status === 'active' ? '종결' : '종결 정보'}
          </WireButton>
        )}
      </div>
      <AssigneeLine names={program.assigneeNames} />
    </div>
  );
}

/** 최신 일정 카드(2026-08-06 Q · 2026-08-07 가로 행 개편) — 담당 사업들의 예정 일정 중
 *  가장 이른 1건. 행 문법은 브리핑 '상담 내용 회차별 정리'와 같다: 날짜 · 상담 종류 뱃지 ·
 *  참여 사업, 오른쪽 끝에 상담 준비 버튼. 날짜는 공용 표기(년 월 일 오전/오후 시간)다. */
function NextScheduleCard({ beneficiaryId, programs, programLabels, recordsTarget }: {
  beneficiaryId: string;
  programs: ParticipantProgram[];
  programLabels: Record<ParticipantProgramType, string>;
  /** 전체 상담 기록 버튼의 대상 사업(2026-08-08 Q — 담당 사업이 없으면 버튼도 없다). */
  recordsTarget: ParticipantProgram | undefined;
}) {
  const candidates = programs
    .filter((program) => program.upcomingSchedule !== null)
    .sort((left, right) => left.upcomingSchedule!.scheduledAt.localeCompare(right.upcomingSchedule!.scheduledAt));

  return (
    <WireCard
      as="section"
      className="participant-hub-card"
      title={
        <div className="wire-card-head">
          <span>최신 일정</span>
          <div className="participant-next-schedule-actions">
            <WireButton height="sm" href="/schedules/new">상담 등록</WireButton>
            {recordsTarget !== undefined && (
              <WireButton height="sm" href={recordsHref(beneficiaryId, recordsTarget.id)}>전체 상담 기록</WireButton>
            )}
          </div>
        </div>
      }
    >
      {candidates.length === 0 ? (
        <div className="participant-next-schedule-row">
          <p className="participant-program-meta">예정된 상담이 없습니다.</p>
        </div>
      ) : (
        // 행 전체가 브리핑으로 가는 링크다(2026-08-08 Q — 구 '상담 준비' 버튼 대체).
        // 여러 사업의 예정 일정이 시각순으로 전부 선다. 꺽쇠는 이동 어휘의 그레이 꺽쇠.
        candidates.map((candidate) => (
          <Link
            key={candidate.id}
            className="participant-next-schedule-link"
            href={briefingHref(beneficiaryId, candidate.id)}
          >
            {/* 내용은 좁으면 줄바꿈하되 꺽쇠는 행 전체의 세로 중앙에 남는다(2026-08-08 Q
                "가운데 정렬" — 격자 좌 1fr / 우 auto). */}
            <span className="participant-next-schedule-main">
              <span className="participant-next-schedule-date">
                {formatKoreanDateTime(candidate.upcomingSchedule!.scheduledAt)}
              </span>
              <ConsultationTypeBadge kind={candidate.upcomingSchedule!.sessionKind} />
              <span className="participant-next-schedule-program">{programName(programLabels, candidate.programType)}</span>
            </span>
            <Chevron dir="right" />
          </Link>
        ))
      )}
    </WireCard>
  );
}

/** 저장 결과 안내(일괄 검토 A4, 2026-08-08). 동의 저장 액션이 이 화면으로 notice 를 보낸다. */
const NOTICES: Record<string, string> = {
  consent_updated: '동의 내용을 저장했습니다.',
};

async function ParticipantHub({ detail, goalTree, goalTreeFailed, notice }: {
  detail: ParticipantDetail;
  /** 목표 트리(D62 §8 · CCC-69) — 담당 케이스만 온다(게이트웨이가 D36 범위를 강제). */
  goalTree: ParticipantGoalTreeCase[];
  /** 목표 조회만 실패했다 — 목표 카드 자리에 오류 한 줄을 남긴다(허브는 그대로 선다). */
  goalTreeFailed: boolean;
  notice?: string;
}) {
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

  // 인테이크의 입구(2026-08-08 Q — 구 '인테이크 기록'→상담 기록 목록 대체). 확인·수정
  // 화면으로 직행한다: 전체 상담 기록 버튼과 목적지가 같던 중복을 가른다. 담당 사업 중
  // 첫 번째(진행 중 우선 정렬)가 대상이다.
  const intakeTarget = programs.find((program) => program.authorized);
  const consentPrograms = programs.filter((program) => program.authorized);

  const noticeText = notice === undefined ? undefined : NOTICES[notice];

  return (
    <main className="page-content participant-hub-page">
      <GridContainer>
        {/* 페이지 타이틀(2026-08-08 Q "모든 페이지 상단에 페이지 타이틀"). */}
        <div className="page-header"><PageTitle>당사자 정보</PageTitle></div>
        {noticeText !== undefined && (
          <WireBadge role="status" aria-live="polite">{noticeText}</WireBadge>
        )}
        {/* ParticipantHeroCard (D38 · D59 개편 2026-08-04): 허브는 케이스가 교차하는 화면이라
            단일 상태가 없어 상태 태그를 생략한다(슬롯 ②).
            이름은 데스크톱 24, 767 이하는 18 이다. 연락처·가명 ID 는 구분선 아래 정보 행이다
            (2026-08-07 Q 위계 개편 — 부품이 배치를 갖는다). */}
        <ParticipantHeroCard
          name={detail.name}
          beneficiaryId={detail.beneficiaryId}
          showId
          nameSize="hub"
          {...(detail.phone !== null && detail.phone.length > 0 ? { contact: detail.phone } : {})}
          // 기본정보 수정(CCC-37)은 당사자 단위라 행동 슬롯(④)에 둔다. 인테이크 기록도
          // 같은 슬롯이다(2026-08-06 Q) — 세컨더리 2개, D38 상한(버튼 최대 2개) 안이다.
          actions={
            <>
              {intakeTarget !== undefined && (
                <WireButton href={intakeHref(detail.beneficiaryId, intakeTarget.id)}>인테이크</WireButton>
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
            {/* 참여중인 사업·최신 일정은 **가로로 긴 전폭 카드 2장 스택**이다(2026-08-07 Q —
                구 2열 나란 배치 대체: 좁은 카드에서 행이 접혔다). 카드 사이 간격은 페이지
                스택 24(--section-gap, GridContainer)다. */}
            <WireCard as="section" className="participant-hub-card" title="참여 중인 사업">
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
              recordsTarget={intakeTarget}
            />
            {/* 목표 트리 (D62 §8 · CCC-69) — 전체 > 세부 > 세션을 케이스별로. 담당 케이스만
                실리므로(D36 — 목표는 상담 내용) 비담당 사업은 구획 자체가 없다. */}
            <GoalTreeCard beneficiaryId={detail.beneficiaryId} cases={goalTree} programLabels={programLabels} loadFailed={goalTreeFailed} />
            {/* 동의서는 맨 아래다(2026-08-06 Q — 구 사업 카드 안 동의 묶음 대체). 저장 단위는
                여전히 참여 사업이라(D44) 담당 사업마다 한 묶음씩 서고, 사업이 여럿이면
                묶음 머리에 사업명이 선다.
                '저장'은 제목과 같은 줄 우측이다(2026-08-07 Q) — 사업 1개면 카드 제목
                '동의서' 줄, 여럿이면 각 묶음의 사업명 줄. 버튼은 폼 밖이라 form 속성으로
                자기 폼을 가리킨다(consentFormId). */}
            {consentPrograms.length > 0 && (
              <WireCard
                as="section"
                className="participant-hub-card"
                title={
                  consentPrograms.length === 1 ? (
                    <div className="wire-card-head">
                      <span>동의서</span>
                      <WireButton type="submit" form={consentFormId(consentPrograms[0]!.id)}>저장</WireButton>
                    </div>
                  ) : (
                    '동의서'
                  )
                }
              >
                {consentPrograms.map((program) => (
                  <div key={program.id} className="participant-consent-block">
                    {consentPrograms.length > 1 && (
                      <div className="participant-program-head">
                        <h3 className="participant-consent-program">{programName(programLabels, program.programType)}</h3>
                        <WireButton type="submit" form={consentFormId(program.id)}>저장</WireButton>
                      </div>
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

async function ParticipantContent({ beneficiaryId, notice }: { beneficiaryId: string; notice?: string }) {
  if (!isBeneficiaryId(beneficiaryId)) return <ErrorState kind="access_or_not_found" />;

  try {
    // 목표 트리는 상세와 독립 조회다 — 같은 접근 판정(담당 케이스 0건이면 Forbidden)을
    // 게이트웨이가 각각 강제하므로 병렬로 받는다. 단, 목표 쪽의 **가용성 오류만은** 여기서
    // 삼킨다 — 새 구획 하나의 장애(실제로 2026-08-09 프리뷰에서 스키마 지연으로 발생)가
    // 허브 전체를 오류 화면으로 바꾸면 안 된다(D8 폴백 태도). 접근·인증 오류는 삼키지
    // 않는다: 상세 조회가 같은 판정을 내리므로 페이지 판정과 어긋날 수 없다.
    const [detail, goalTreeResult] = await Promise.all([
      getParticipantDetail(beneficiaryId),
      getParticipantGoalTree(beneficiaryId).then(
        (cases) => ({ cases, failed: false }),
        (error: unknown) => {
          if (error instanceof ApiError && error.code === 'service_unavailable') {
            return { cases: [] as ParticipantGoalTreeCase[], failed: true };
          }
          throw error;
        },
      ),
    ]);
    if (detail.beneficiaryId !== beneficiaryId) {
      throw new Error('Participant detail response did not match the requested participant.');
    }
    return (
      <ParticipantHub
        detail={detail}
        goalTree={goalTreeResult.cases}
        goalTreeFailed={goalTreeResult.failed}
        {...(notice === undefined ? {} : { notice })}
      />
    );
  } catch (error) {
    const kind = error instanceof ApiError ? expectedApiErrorKind(error) : null;
    if (kind === null) throw error;
    return <ErrorState kind={kind} />;
  }
}

export default async function ParticipantPage({ params, searchParams }: {
  params: Promise<{ beneficiaryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { beneficiaryId } = await params;
  const query = await searchParams;
  const noticeValue = query.notice;
  const notice = typeof noticeValue === 'string' ? noticeValue : undefined;
  return (
    <Suspense fallback={<LoadingState />}>
      <ParticipantContent beneficiaryId={beneficiaryId} {...(notice === undefined ? {} : { notice })} />
    </Suspense>
  );
}
