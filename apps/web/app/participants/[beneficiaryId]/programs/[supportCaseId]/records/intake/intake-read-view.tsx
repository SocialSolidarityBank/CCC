'use client';

import { useState, type ReactNode } from 'react';
import type {
  IntakeAnswerInput,
  IntakeSavedRecord,
} from '../../../../../../lib/api';
import { PageTitle } from '../../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard, WireCardDetails } from '../../../../../../components/wire/wire-card';
import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { formatKoreanDateTime } from '../../../../../../lib/format-korean-date';
import {
  ADDITIONAL_COLUMNS,
  DEBT_COLUMNS,
  LINKED_ORG_COLUMNS,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_OPTION,
  INTAKE_STEP_REQUIRED_EXTRA_COUNTS,
  STEP_GROUPS,
  STEP_TITLES,
  intakeSectionAnchor,
  type IntakeQuestionGroup,
  type IntakeTableColumn,
} from './intake-questions';
import { WireDataRow, WireDataRows } from '../../../../../../components/wire/wire-data-rows';
import { IntakeStepRail } from './intake-step-rail';

/**
 * 인테이크 조회 화면(CCC-58). 저장된 질문지 4부를 작성 화면과 같은 단계 위치에서 읽는다.
 * 한 번에 한 단계만 보이고, 단계 안 소절은 아코디언과 현재 단계 목차로 빠르게 찾는다.
 * 기록이 있으면 이 화면이 기본이고 고치기는 우상단 '수정' 버튼이 기존 위저드 수정 모드
 * (?edit=1)를 연다.
 *
 * 질문 목록·표 열은 작성 위저드와 같은 intake-questions.ts 를 읽는다 — 항목이 늘거나
 * 문구가 바뀌면 그 파일만 고치면 두 화면이 함께 따라온다. 열람 감사는 페이지가 부르는
 * getIntakeRecordContext(게이트웨이)가 이미 남기므로(D14) 여기서는 그리기만 한다.
 */
export interface IntakeReadViewProps {
  beneficiaryId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  consent: { privacy: boolean; recordingAi: boolean };
  saved: IntakeSavedRecord;
  /** 전체 목표 현재값(D62 · CCC-68). 주 입력 자리가 인테이크라 조회 화면도 함께 읽는다. */
  overallGoal: string | null;
  /** 위저드 수정 모드 진입(?edit=1). */
  editHref: string;
  /** 전체 상담 기록 목록 — 이 화면의 출구(D35 좌측 세컨더리). */
  recordsHref: string;
  /** 동의 기록 수정처인 당사자 정보 화면. */
  participantHref: string;
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
    <WireDataRow label={props.label} value={<span className="intake-read-value">{props.value}</span>} />
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

function statusValue(value: string): ReactNode {
  if (value === '기록 없음' || value === '미입력') {
    return <WireBadge tone="lavender">{value}</WireBadge>;
  }
  if (
    value === NO_RESPONSE_OPTION
    || value === NOT_APPLICABLE_OPTION
    || value === '답변 거부'
  ) {
    return <WireBadge>{value}</WireBadge>;
  }
  return <span className="intake-read-value">{value}</span>;
}

function GroupCard(props: {
  group: IntakeQuestionGroup;
  answers: ReadonlyMap<string, IntakeAnswerInput>;
  leadRows?: ReactNode;
  extraRows?: ReactNode;
  extraMissingCount?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  testId?: string;
}) {
  const missingCount = (props.extraMissingCount ?? 0) + props.group.questions.filter(
    (question) => answerText(props.answers, question.key) === '기록 없음',
  ).length;
  return (
    <WireCardDetails
      id={intakeSectionAnchor(props.group.title)}
      title={<span role="heading" aria-level={3}>{props.group.title}</span>}
      badge={missingCount > 0
        ? <WireBadge tone="lavender">미기록 {missingCount}</WireBadge>
        : <WireBadge>기록됨</WireBadge>}
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
      testId={props.testId}
    >
      <WireDataRows data-testid="intake-read-rows">
        {props.leadRows}
        {props.group.questions.map((question) => (
          <WireDataRow
            key={question.key}
            label={question.label}
            value={statusValue(answerText(props.answers, question.key))}
          />
        ))}
        {props.extraRows}
      </WireDataRows>
    </WireCardDetails>
  );
}

function TableCard(props: {
  title: string;
  columns: readonly IntakeTableColumn[];
  rows: ReadonlyArray<Record<string, string>>;
  testId: string;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <WireCardDetails
      id={intakeSectionAnchor(props.title)}
      title={<span role="heading" aria-level={3}>{props.title}</span>}
      badge={props.rows.length === 0
        ? <WireBadge tone="lavender">기록 없음</WireBadge>
        : <WireBadge>{props.rows.length}건</WireBadge>}
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
      testId={props.testId}
    >
      {props.rows.length === 0 ? (
        <p className="panel-meta">기록 없음</p>
      ) : props.rows.map((row, index) => (
        <div key={index} className="intake-read-table-entry" data-testid={`${props.testId}-row`}>
          {props.rows.length > 1 ? <WireBadge>{index + 1}번</WireBadge> : null}
          <WireDataRows>
            {props.columns.map((column) => {
              const cell = (row[column.key] ?? '').trim();
              return (
                <WireDataRow
                  key={column.key}
                  label={column.label}
                  value={statusValue(cell.length === 0 ? '미입력' : cell)}
                />
              );
            })}
          </WireDataRows>
        </div>
      ))}
    </WireCardDetails>
  );
}

export function IntakeReadView(props: IntakeReadViewProps) {
  const [step, setStep] = useState(1);
  const [closedSections, setClosedSections] = useState<Set<string>>(() => new Set());
  const answers: ReadonlyMap<string, IntakeAnswerInput> = new Map(
    props.saved.answers.map((answer) => [answer.key, answer] as const),
  );
  const heldAtLabel = formatKoreanDateTime(props.saved.heldAt);
  const overallGoalText = (props.overallGoal ?? '').trim();
  const consentRows: ReadonlyArray<readonly [string, boolean]> = [
    ['개인정보 수집·이용 동의', props.consent.privacy],
    ['AI를 활용한 녹취기록 동의', props.consent.recordingAi],
  ];
  const consentMissing = consentRows.filter(([, recorded]) => !recorded).length;

  function isOpen(id: string): boolean {
    return !closedSections.has(id);
  }

  function setOpen(id: string, open: boolean): void {
    setClosedSections((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groupId = (group: IntakeQuestionGroup): string => intakeSectionAnchor(group.title);
  const tableId = (title: string): string => intakeSectionAnchor(title);
  const currentIds: string[] = [];
  const currentToc: Array<{ id: string; label: string }> = [];
  const currentCards: ReactNode[] = [];

  const addGroup = (
    group: IntakeQuestionGroup,
    options: { leadRows?: ReactNode; extraRows?: ReactNode; extraMissingCount?: number; testId?: string } = {},
  ): void => {
    const id = groupId(group);
    currentIds.push(id);
    currentToc.push({ id, label: group.title });
    currentCards.push(
      <GroupCard
        key={id}
        group={group}
        answers={answers}
        open={isOpen(id)}
        onToggle={(open) => setOpen(id, open)}
        {...options}
      />,
    );
  };

  const addTable = (
    title: string,
    columns: readonly IntakeTableColumn[],
    rows: ReadonlyArray<Record<string, string>>,
    testId: string,
  ): void => {
    const id = tableId(title);
    currentIds.push(id);
    currentToc.push({ id, label: title });
    currentCards.push(
      <TableCard
        key={id}
        title={title}
        columns={columns}
        rows={rows}
        testId={testId}
        open={isOpen(id)}
        onToggle={(open) => setOpen(id, open)}
      />,
    );
  };

  if (step === 1) {
    const consentId = intakeSectionAnchor('동의 기록');
    currentIds.push(consentId);
    currentToc.push({ id: consentId, label: '동의 기록' });
    currentCards.push(
      <WireCardDetails
        key={consentId}
        id={consentId}
        title={<span role="heading" aria-level={3}>동의 기록</span>}
        badge={consentMissing > 0
          ? <WireBadge tone="lavender">미기록 {consentMissing}</WireBadge>
          : <WireBadge>기록됨</WireBadge>}
        open={isOpen(consentId)}
        onToggle={(event) => setOpen(consentId, event.currentTarget.open)}
        testId="intake-read-consent"
      >
        <WireDataRows>
          {consentRows.map(([label, recorded]) => (
            <WireDataRow
              key={label}
              label={label}
              value={recorded
                ? <WireBadge tone="mint">기록됨</WireBadge>
                : <WireBadge tone="lavender">미기록</WireBadge>}
            />
          ))}
        </WireDataRows>
        {consentMissing > 0 ? (
          <p className="panel-meta">
            동의는 당사자 정보 페이지에서 기록하고 수정합니다.{' '}
            <a href={props.participantHref}>당사자 정보로 이동</a>
          </p>
        ) : null}
      </WireCardDetails>,
    );
    STEP_GROUPS[0]!.forEach((group) => {
      addGroup(group, group.title === '1-3. 상담 운영정보'
        ? { leadRows: <ReadRow label="상담일" value={heldAtLabel} /> }
        : {});
    });
  } else if (step === 2) {
    STEP_GROUPS[1]!.forEach((group) => addGroup(group));
    addTable('대출·부채 현황 표', DEBT_COLUMNS, props.saved.debts, 'intake-read-debts');
  } else if (step === 3) {
    STEP_GROUPS[2]!.forEach((group) => addGroup(group));
    addTable(
      '3-3. 현재 연계된 기관·서비스',
      LINKED_ORG_COLUMNS,
      props.saved.linkedOrgs,
      'intake-read-linked-orgs',
    );
  } else {
    const participation = STEP_GROUPS[3]!.find((group) => group.title.startsWith('4-1.'));
    const judgment = STEP_GROUPS[3]!.find((group) => group.title.startsWith('4-3.'));
    if (participation !== undefined) addGroup(participation);
    addTable(
      '4-2. 추가 확인사항',
      ADDITIONAL_COLUMNS,
      props.saved.additionalItems,
      'intake-read-additional',
    );
    if (judgment !== undefined) {
      addGroup(judgment, {
        extraMissingCount: (props.saved.managerOpinion ?? '').trim().length === 0 ? 1 : 0,
        testId: 'intake-read-judgment',
        extraRows: (
          <>
            <WireDataRow
              label="전체 목표"
              value={statusValue(overallGoalText.length === 0 ? '기록 없음' : overallGoalText)}
            />
            <WireDataRow
              label="담당 실무자 종합의견"
              value={statusValue(
                (props.saved.managerOpinion ?? '').trim().length === 0
                  ? '기록 없음'
                  : props.saved.managerOpinion!,
              )}
            />
          </>
        ),
      });
    }
  }

  const changeStep = (next: number): void => {
    setStep(next);
  };
  const openAll = (): void => {
    setClosedSections((current) => {
      const next = new Set(current);
      currentIds.forEach((id) => next.delete(id));
      return next;
    });
  };
  const closeAll = (): void => {
    setClosedSections((current) => {
      const next = new Set(current);
      currentIds.forEach((id) => next.add(id));
      return next;
    });
  };

  return (
    <main className="page-content">
      <div className="page-header"><PageTitle>인테이크</PageTitle></div>
      <ParticipantHeroCard
        name={props.participant.name}
        beneficiaryId={props.beneficiaryId}
        stageTag="인테이크 완료"
        details={[
          ...(props.participant.phone === null
            ? []
            : [{ label: '전화번호', value: props.participant.phone, tone: 'mint' as const }]),
          ...(props.participant.email === null
            ? []
            : [{ label: '이메일', value: props.participant.email, tone: 'mint' as const }]),
          { label: '상담일', value: heldAtLabel, tone: 'blue' as const },
        ]}
        actions={(
          <>
            <WireButton variant="secondary" href={props.recordsHref}>전체 상담 기록</WireButton>
            <WireButton variant="primary" href={props.editHref}>수정</WireButton>
          </>
        )}
      />

      <div className="wire-container rail-grid intake-read-grid" data-grid="true">
        <IntakeStepRail
          currentStep={step}
          items={STEP_TITLES.map((_, index) => {
            const count = STEP_GROUPS[index]!.reduce<number>(
              (sum, group) => sum + group.questions.length,
              INTAKE_STEP_REQUIRED_EXTRA_COUNTS[index]!,
            );
            return {
              countLabel: `${count}/${count}`,
              ariaCount: `${count}/${count} 완료`,
              state: step === index + 1 ? 'current' : 'waiting',
            };
          })}
          onSelect={changeStep}
        />

        <section className="wizard-stack">
          <div className="intake-step-toolbar">
            <h2>{step}. {STEP_TITLES[step - 1]}</h2>
            <div className="wizard-actions">
              <WireButton variant="neutral" onClick={openAll}>전체 열기</WireButton>
              <WireButton variant="neutral" onClick={closeAll}>전체 닫기</WireButton>
            </div>
          </div>
          <div className="wizard-stack" data-testid="intake-read-current-step">
            {currentCards}
          </div>
        </section>

        <WireCard
          as="nav"
          labelledBy="intake-read-toc-title"
          testId="intake-read-toc"
          className="wire-toc-rail intake-read-toc"
        >
          <h2 className="wire-card-title" id="intake-read-toc-title">바로가기</h2>
          <ol className="wire-toc-list">
            {currentToc.map(({ id, label }) => (
              <li key={id}><a href={`#${id}`}>{label}</a></li>
            ))}
          </ol>
        </WireCard>
      </div>
    </main>
  );
}
