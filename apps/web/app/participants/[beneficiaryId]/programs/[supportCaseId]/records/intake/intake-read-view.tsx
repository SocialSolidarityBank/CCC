import type { ReactNode } from 'react';
import type {
  IntakeAnswerInput,
  IntakeExtendedPii,
  IntakeSavedRecord,
} from '../../../../../../lib/api';
import { GridContainer } from '../../../../../../components/wire/grid-container';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { PageTitle } from '../../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { formatKoreanDateTime } from '../../../../../../lib/format-korean-date';
import {
  ADDITIONAL_COLUMNS,
  DEBT_COLUMNS,
  LINKED_ORG_COLUMNS,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_OPTION,
  STEP_GROUPS,
  STEP_TITLES,
  intakeSectionAnchor,
  type IntakeQuestionGroup,
  type IntakeTableColumn,
} from './intake-questions';

/**
 * 인테이크 조회 화면(CCC-58). 저장된 질문지 4부·표 3종·종합의견을 **한 페이지로 읽는다** —
 * 다시 보려고 4단계 편집 폼을 넘기게 하지 않는다. 기록이 있으면 이 화면이 기본이고,
 * 고치기는 우상단 '수정' 버튼이 기존 위저드 수정 모드(?edit=1)를 연다(2026-08-08 Q 결정
 * "조회 기본 + 수정 버튼").
 *
 * 질문 목록·표 열은 작성 위저드와 같은 intake-questions.ts 를 읽는다 — 항목이 늘거나
 * 문구가 바뀌면 그 파일만 고치면 두 화면이 함께 따라온다. 열람 감사는 페이지가 부르는
 * getIntakeRecordContext(게이트웨이)가 이미 남기므로(D14) 여기서는 그리기만 한다.
 */
export interface IntakeReadViewProps {
  beneficiaryId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  extendedPii: IntakeExtendedPii;
  consent: { privacy: boolean; recordingAi: boolean };
  saved: IntakeSavedRecord;
  /** 전체 목표 현재값(D62 · CCC-68). 주 입력 자리가 인테이크라 조회 화면도 함께 읽는다. */
  overallGoal: string | null;
  /** 위저드 수정 모드 진입(?edit=1). */
  editHref: string;
  /** 전체 상담 기록 목록 — 이 화면의 출구(D35 좌측 세컨더리). */
  recordsHref: string;
  /** 동의 기록·기본정보의 수정처 안내 링크. */
  participantHref: string;
  basicInfoHref: string;
}

// 작성 위저드와 같은 타이포 계약이다 — 그래서 위저드가 공용 클래스로 옮겨 간 2026-08-09 에
// 이 화면도 함께 옮긴다. 인라인으로 남겨 두면 같은 인테이크 기능인데 조회는 제목 20, 작성은
// 18 로 갈린다. 값도 15 였는데 15 는 §2-1 의 **버튼 전용** 하프스텝이라 버튼 밖에서는 계단
// 밖 값이다(작성 화면의 기본정보 줄과 같은 수정).
//   headingStyle → 그냥 h2(전역 18/600) · stackStyle → .wizard-stack · rowStyle → .wizard-field ·
//   labelStyle·valueStyle → .wire-field-label/.wire-field-value(§5 정보 필드) ·
//   captionStyle → .panel-meta
// 조회 값만 줄바꿈을 원문대로 살린다(pre-wrap) — 서술형 답변이 여러 줄로 저장되기 때문이다.
function ReadRow(props: { label: string; value: string }) {
  return (
    <div className="wizard-field" data-testid="intake-read-row">
      <span className="wire-field-label">{props.label}</span>
      <p className="wire-field-value intake-read-value">{props.value}</p>
    </div>
  );
}

/** 응답 코드를 정본 문구로 되돌린다. 빈 저장(전 항목 필수라 정상 흐름엔 없음)은 '기록 없음'. */
function answerText(answers: ReadonlyMap<string, IntakeAnswerInput>, key: string): string {
  const entry = answers.get(key);
  if (entry === undefined) return '기록 없음';
  if (entry.response === 'unknown') return NO_RESPONSE_OPTION;
  if (entry.response === 'not_applicable') return NOT_APPLICABLE_OPTION;
  if (entry.response === 'declined') return '답변 거부';
  const text = (entry.text ?? '').trim();
  return text.length === 0 ? '기록 없음' : text;
}

function GroupCard(props: {
  group: IntakeQuestionGroup;
  answers: ReadonlyMap<string, IntakeAnswerInput>;
  /** 소절 맨 위에 끼우는 자동값 행(작성 위저드의 extras 와 같은 자리 — 1-3 상담일). 없으면 null. */
  lead: ReactNode;
}) {
  return (
    // h3 id 는 우측 목차의 앵커 대상이다(2026-08-09 3차 — 작성 위저드와 같은 헬퍼).
    <WireCard title={<h3 id={intakeSectionAnchor(props.group.title)}>{props.group.title}</h3>}>
      {props.lead}
      {props.group.questions.map((question) => (
        <ReadRow key={question.key} label={question.label} value={answerText(props.answers, question.key)} />
      ))}
    </WireCard>
  );
}

/** 반복 행 표의 조회 표현: 행마다 열 라벨·값 목록. 빈 선택 칸은 '미입력'(첫 칸만 필수인 계약). */
function TableCard(props: {
  title: string;
  columns: readonly IntakeTableColumn[];
  rows: ReadonlyArray<Record<string, string>>;
  testId: string;
}) {
  return (
    <WireCard title={<h3 id={intakeSectionAnchor(props.title)}>{props.title}</h3>} testId={props.testId}>
      {props.rows.length === 0 ? (
        <p className="panel-meta">기록 없음</p>
      ) : (
        props.rows.map((row, index) => (
          <div key={index} className="wizard-field" data-testid={`${props.testId}-row`}>
            {props.rows.length > 1 && <span className="wire-form-label">{index + 1}번</span>}
            {props.columns.map((column) => {
              const cell = (row[column.key] ?? '').trim();
              return <ReadRow key={column.key} label={column.label} value={cell.length === 0 ? '미입력' : cell} />;
            })}
          </div>
        ))
      )}
    </WireCard>
  );
}

export function IntakeReadView(props: IntakeReadViewProps) {
  const answers: ReadonlyMap<string, IntakeAnswerInput> = new Map(
    props.saved.answers.map((answer) => [answer.key, answer] as const),
  );
  const consentRows: ReadonlyArray<readonly [string, boolean]> = [
    ['개인정보 수집·이용 동의', props.consent.privacy],
    ['AI를 활용한 녹취기록 동의', props.consent.recordingAi],
  ];
  const consentMissing = consentRows.some(([, recorded]) => !recorded);
  const heldAtLabel = formatKoreanDateTime(props.saved.heldAt);
  const overallGoalText = (props.overallGoal ?? '').trim();

  // 위저드가 소절 안에 끼워 넣는 자동값(1-3)과 같은 자리 규칙 — 번호는 소절 하나에 하나다.
  const groupLeads: Readonly<Record<string, ReactNode>> = {
    '1-3. 상담 운영정보': <ReadRow label="상담일" value={heldAtLabel} />,
  };

  const sections: ReadonlyArray<{ title: string; extra: ReactNode }> = [
    {
      title: STEP_TITLES[0],
      extra: null,
    },
    {
      title: STEP_TITLES[1],
      extra: <TableCard title="대출·부채 현황 표" columns={DEBT_COLUMNS} rows={props.saved.debts} testId="intake-read-debts" />,
    },
    {
      title: STEP_TITLES[2],
      extra: <TableCard title="3-3. 현재 연계된 기관·서비스" columns={LINKED_ORG_COLUMNS} rows={props.saved.linkedOrgs} testId="intake-read-linked-orgs" />,
    },
    {
      title: STEP_TITLES[3],
      extra: (
        <>
          {/* 전체 목표(D62 · CCC-68): 작성 위저드와 같은 자리(4단계)에서 읽는다. 수정은
              우상단 '수정'(위저드 수정 모드) 또는 15초 페이지 카드(보조 자리)가 갖는다. */}
          <WireCard title={<h3 id={intakeSectionAnchor('전체 목표')}>전체 목표</h3>} testId="intake-read-overall-goal">
            <ReadRow label="전체 목표" value={overallGoalText.length === 0 ? '설정 전' : overallGoalText} />
          </WireCard>
          <TableCard title="4-2. 추가 확인사항" columns={ADDITIONAL_COLUMNS} rows={props.saved.additionalItems} testId="intake-read-additional" />
          <WireCard title={<h3 id={intakeSectionAnchor('담당 실무자 종합의견')}>담당 실무자 종합의견</h3>} testId="intake-read-opinion">
            <p className="wire-field-value intake-read-value">
              {(props.saved.managerOpinion ?? '').trim().length === 0 ? '기록 없음' : props.saved.managerOpinion}
            </p>
          </WireCard>
        </>
      ),
    },
  ];

  return (
    <GridContainer as="main" className="page-content">
      {/* 화면 이름은 작성·수정과 같은 '인테이크'다(2026-08-08 Q 페이지 타이틀 규칙). */}
      <div className="page-header"><PageTitle>인테이크</PageTitle></div>
      {/* ParticipantHeroCard (D38): 케이스 1개를 읽는 화면. 출구는 왼쪽 세컨더리(전체 상담
          기록), 주 행동은 수정 — 조회 기본 구조에서 고치기의 유일한 입구다. */}
      <ParticipantHeroCard
        name={props.participant.name}
        beneficiaryId={props.beneficiaryId}
        meta={<MetaRow items={[`상담일 ${heldAtLabel}`]} />}
        actions={
          <>
            <WireButton variant="secondary" href={props.recordsHref}>전체 상담 기록</WireButton>
            <WireButton variant="primary" href={props.editHref}>수정</WireButton>
          </>
        }
      />
      {/* 광폭(컨테이너 ≥1150)에서 [본문 1fr | 목차 200] 2열이 된다(2026-08-09 3차 —
          4부 45문항이 한 페이지라 목차의 효과가 가장 큰 화면). 좁으면 한 열, 목차 숨김. */}
      <div className="intake-read-grid">
      <div className="wizard-stack" data-testid="intake-read-view">
        {sections.map((section, index) => (
          <section key={section.title} className="wizard-stack" aria-label={`${index + 1}. ${section.title}`}>
            <h2 id={`intake-read-part-${index + 1}`}>{index + 1}. {section.title}</h2>
            {index === 0 && (
              <>
                <WireCard title={<h3 id={intakeSectionAnchor('1-1. 당사자 기본정보')}>1-1. 당사자 기본정보</h3>} testId="intake-read-basic-info">
                  <p className="panel-meta">
                    당사자 등록에 저장된 값입니다. <a href={props.basicInfoHref}>당사자 등록 정보에서 수정</a>
                  </p>
                  <ReadRow label="이름" value={props.participant.name ?? '미입력'} />
                  <ReadRow label="생년월일" value={props.extendedPii.birthDate ?? '미입력'} />
                  <ReadRow label="휴대전화번호" value={props.participant.phone ?? '미입력'} />
                  <ReadRow label="이메일" value={props.participant.email ?? '미입력'} />
                  <ReadRow label="주소 또는 거주지역" value={props.extendedPii.region ?? '미입력'} />
                  <ReadRow label="성별" value={props.extendedPii.gender ?? '미입력'} />
                </WireCard>
                <WireCard title={<h3 id={intakeSectionAnchor('동의 기록')}>동의 기록</h3>} testId="intake-read-consent">
                  {consentRows.map(([label, recorded]) => (
                    <ReadRow key={label} label={label} value={recorded ? '기록됨' : '미기록'} />
                  ))}
                  {consentMissing && (
                    <p className="panel-meta">
                      동의는 당사자 정보 페이지에서 기록·수정합니다. <a href={props.participantHref}>당사자 정보로 이동</a>
                    </p>
                  )}
                </WireCard>
              </>
            )}
            {STEP_GROUPS[index]!.map((group) => (
              <GroupCard key={group.title} group={group} answers={answers} lead={groupLeads[group.title] ?? null} />
            ))}
            {section.extra}
          </section>
        ))}
      </div>

      {/* 우측 바로가기 목차 — 부(部) + 소절 두 층, 화면 렌더 순서 그대로(공용 .wire-toc-rail
          이 광폭 표시·붙박이를 갖는다). 소절 id 는 각 카드 h3 가 같은 헬퍼로 단다. */}
      <WireCard as="nav" labelledBy="intake-read-toc-title" testId="intake-read-toc" className="wire-toc-rail"
        title={<span id="intake-read-toc-title">바로가기</span>}>
        <ol className="wire-toc-list">
          {STEP_TITLES.map((title, index) => (
            <li key={title}>
              <a className="wire-toc-part" href={`#intake-read-part-${index + 1}`}>{index + 1}. {title}</a>
              <ol>
                {[
                  ...(index === 0 ? ['1-1. 당사자 기본정보', '동의 기록'] : []),
                  ...STEP_GROUPS[index]!.map((group) => group.title),
                  ...(index === 1 ? ['대출·부채 현황 표'] : []),
                  ...(index === 2 ? ['3-3. 현재 연계된 기관·서비스'] : []),
                  ...(index === 3 ? ['전체 목표', '4-2. 추가 확인사항', '담당 실무자 종합의견'] : []),
                ].map((label) => (
                  <li key={label}><a href={`#${intakeSectionAnchor(label)}`}>{label}</a></li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </WireCard>
      </div>
    </GridContainer>
  );
}
