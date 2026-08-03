import { MetaRow } from '../../../../../components/wire/meta-row';
import { Chevron } from '../../../../../components/wire/chevron';
import { Icon } from '../../../../../components/wire/icon';
import { WireCard } from '../../../../../components/wire/wire-card';
import type { FlagType, SupportCaseRecord } from '../../../../../lib/api';

// 회차 목록 (D47 · ADR-0019 §1·§2·§4).
//
// 페이지에서 갈라 둔 이유는 브리핑과 같다 — 서버 컴포넌트는 fetch·스코프 검증만 하고,
// 표현·폴백·회차 번호 계산은 순수 데이터를 받는 이 파일이 갖는다. 그래야 화면 규칙을
// 테스트로 고정할 수 있다.
//
// 접힘은 details 다. 최신 1개만 열린 채 서버에서 오고, 브리핑 앵커 진입 시의 추가 펼침은
// RecordHashOpener(클라이언트)가 맡는다 — 자바스크립트가 죽어도 목록은 성립한다.

type ActionOwner = SupportCaseRecord['actionItems'][number]['owner'];
type FlagReviewStatus = SupportCaseRecord['flags'][number]['reviewStatus'];

const channelLabels: Record<SupportCaseRecord['channel'], string> = {
  in_person: '대면',
  phone: '전화',
  video: '화상',
};
const flagLabels: Record<FlagType, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거·생계 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
};
const actionOwnerLabels: Record<ActionOwner, string> = {
  counselor: '실무자',
  beneficiary: '당사자',
  org: '기관',
};
const flagReviewStatusLabels: Record<FlagReviewStatus, string> = {
  confirmed: '확인됨',
  rejected: '제외됨',
  pending: '검토 대기',
};
const sessionKindLabels: Record<SupportCaseRecord['kind'], string> = {
  intake: '인테이크',
  regular: '기본 상담',
};

function actionOwnerLabel(owner: ActionOwner): string {
  const label = actionOwnerLabels[owner];
  if (label === undefined) throw new Error('Record action item owner was invalid.');
  return label;
}

function channelLabel(channel: SupportCaseRecord['channel']): string {
  const label = channelLabels[channel];
  if (label === undefined) throw new Error('Record channel was invalid.');
  return label;
}

function flagLabel(flagType: FlagType): string {
  const label = flagLabels[flagType];
  if (label === undefined) throw new Error('Record flag type was invalid.');
  return label;
}

function flagReviewStatusLabel(reviewStatus: FlagReviewStatus): string {
  const label = flagReviewStatusLabels[reviewStatus];
  if (label === undefined) throw new Error('Record flag review status was invalid.');
  return label;
}

function sessionKindLabel(kind: SupportCaseRecord['kind']): string {
  const label = sessionKindLabels[kind];
  if (label === undefined) throw new Error('Record kind was invalid.');
  return label;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
}

/**
 * 한 회차. 접힌 줄(summary)과 펼친 본문이 같은 요소라 두 상태에서 자리가 안 흔들린다.
 * `id` 는 브리핑 앵커(`#record-{회차ID}`)의 목적지다 — 바뀌면 브리핑 링크가 조용히 끊긴다.
 */
export function RecordCard({
  record,
  ordinal,
  recordError,
  defaultOpen,
}: {
  record: SupportCaseRecord;
  ordinal: number;
  recordError: boolean;
  defaultOpen: boolean;
}) {
  // 핵심 한 줄은 승인된 AI 산출물만(R2). 승인 전·녹음 없음·레거시면 수기 발췌로 낮추고
  // '수기' 배지를 단다(D5) — 브리핑 영역 ②와 같은 폴백이라 두 화면이 같은 문장을 보여준다.
  const oneLiner = record.aiOneLiner ?? record.memoExcerpt;
  const hasConfirmedFlag = record.flags.some((flag) => flag.reviewStatus === 'confirmed');

  return <details className="surface-card" id={`record-${record.id}`} open={defaultOpen}>
    <summary className="record-summary">
      <span className="record-chevron" aria-hidden="true"><Chevron dir="right" /></span>
      <span className="record-ordinal">{ordinal}회차</span>
      <span className="record-held-at">{formatDateOnly(record.heldAt)}</span>
      <span className="record-kind">{sessionKindLabel(record.kind)}</span>
      <span className={record.aiOneLiner === null ? 'record-one-liner is-memo' : 'record-one-liner'}>
        {oneLiner ?? '핵심 한 줄이 아직 없습니다'}
      </span>
      <span className="record-summary-right">
        {record.aiOneLiner === null && record.memoExcerpt !== null && <span className="briefing-badge">수기</span>}
        {/* 리스크 배너는 두지 않는다(D47 §5) — 대신 어느 회차에서 나왔는지를 이 표시가 알린다. */}
        {hasConfirmedFlag && <span className="record-flag" data-confirmed="true"><Icon name="warning" size={14} /> 리스크</span>}
      </span>
    </summary>

    <div className="record-body">
      {/* 불일치 처리 '기록 오류'의 흔적 (D45 · ADR-0018 · CCC-42). 원본은 손대지 않고 표시만
          붙여 다음 열람자의 오해를 막는다 — 정정이 필요하면 실무자가 따로 기록한다. */}
      {recordError && <p className="note" role="note">
        이 기록과 관련된 내용 불일치가 <strong>기록 오류</strong>로 처리되었습니다. 아래 내용은 원본 그대로입니다.
      </p>}

      {/* GAS 가 있던 자리(D47 §2). 재료가 없으면 블록 자체를 그리지 않는다 —
          빈 블록을 두면 뺀 자리가 다시 빈칸으로 보인다. */}
      {record.sessionGoals.length > 0 && <div className="record-session-goal">
        <span className="record-session-goal-label">이번 상담의 목표</span>
        {record.sessionGoals.map((goal, index) => <p key={`${record.id}-goal-${index}`}>{goal}</p>)}
      </div>}

      <section className="record-block" aria-labelledby={`memo-${record.id}`}>
        <h3 id={`memo-${record.id}`}>수기 메모</h3>
        <p>{record.memo}</p>
      </section>

      <section className="record-block" aria-labelledby={`actions-${record.id}`}>
        <h3 id={`actions-${record.id}`}>액션 아이템</h3>
        {record.actionItems.length === 0
          ? <p className="record-item-meta">기록된 액션 아이템이 없습니다.</p>
          : <ul>{record.actionItems.map((item) => <li key={item.id}>
              {item.description}
              <span className="record-owner">{actionOwnerLabel(item.owner)}</span>
              {item.dueDate !== null && <span className="record-item-meta">기한 {item.dueDate}</span>}
              {item.resolved ? <span className="status">완료</span> : <span className="status warning">미완료</span>}
            </li>)}</ul>}
      </section>

      <section className="record-block" aria-labelledby={`flags-${record.id}`}>
        <h3 id={`flags-${record.id}`}>플래그</h3>
        {record.flags.length === 0
          ? <p className="record-item-meta">표시된 플래그가 없습니다.</p>
          : <ul>{record.flags.map((flag) => <li key={flag.id}>
              {/* 리스크 레드는 확인된 것에만(D9·D34) — 제외됨·검토 대기는 무채색이다. */}
              <span className="record-flag" data-confirmed={flag.reviewStatus === 'confirmed' ? 'true' : 'false'}>
                {flag.reviewStatus === 'confirmed' && <><Icon name="warning" size={14} />{' '}</>}{flagLabel(flag.flagType)}
              </span>
              {flag.source === 'ai' && <span className="record-ai-source">AI 제안</span>}
              <span className="record-item-meta">{flagReviewStatusLabel(flag.reviewStatus)}</span>
            </li>)}</ul>}
      </section>
    </div>

    <p className="record-foot">
      <MetaRow items={[channelLabel(record.channel), `공식 등록 ${formatDateTime(record.createdAt)}`]} />
    </p>
  </details>;
}

export function RecordList({
  records,
  recordErrorSessionIds,
  unavailable,
}: {
  records: SupportCaseRecord[];
  recordErrorSessionIds: ReadonlySet<string>;
  unavailable: boolean;
}) {
  if (unavailable) {
    return <section className="record-list" aria-label="상담 기록 목록">
      <WireCard><div className="empty"><span>상담 기록 목록을 확인할 수 없습니다.</span></div></WireCard>
    </section>;
  }
  if (records.length === 0) {
    return <section className="record-list" aria-label="상담 기록 목록">
      <WireCard>
        <div className="empty"><span>아직 상담 기록이 없습니다.</span></div>
        <p className="panel-meta">상담 일시, 방식, 수기 메모, 액션 아이템, 플래그를 한 번에 기록하세요.</p>
      </WireCard>
    </section>;
  }
  return <section className="record-list" aria-label="상담 기록 목록">
    {records.map((record, index) => <RecordCard
      key={record.id}
      record={record}
      // 오름차순 회차 번호 — 인테이크가 1회차다. 목록은 최신순이라 뒤에서부터 센다.
      // 저장값이 아니라 상담일 순서로 만든 표시값이라, 빠뜨린 과거 회차를 뒤늦게 추가하면
      // 그 뒤 번호가 한 칸씩 밀린다(D47 §4 — 감수한 결과).
      ordinal={records.length - index}
      recordError={recordErrorSessionIds.has(record.id)}
      // 최신 1개만 펼친 채 온다. 나머지는 브리핑 앵커나 클릭으로 열린다.
      defaultOpen={index === 0}
    />)}
  </section>;
}
