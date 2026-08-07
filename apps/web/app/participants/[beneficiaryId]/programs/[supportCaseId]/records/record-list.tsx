import { MetaRow } from '../../../../../components/wire/meta-row';
import { formatKoreanDate, formatKoreanDateTime } from '../../../../../lib/format-korean-date';
import { Icon } from '../../../../../components/wire/wire-icon';
import { WireBadge } from '../../../../../components/wire/wire-badge';
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

// 날짜·시각 표기는 공용 계약 하나다(2026-08-07 Q 통일 — 구 dateStyle medium ·
// YYYY-MM-DD 지역 함수 대체). 이 파일의 두 export 는 records/page.tsx 가 함께 쓴다.
export function formatDateTime(value: string): string {
  return formatKoreanDateTime(value);
}

export function formatDateOnly(value: string): string {
  return formatKoreanDate(value);
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
    {/* 회차 앞 꺽쇠는 2026-08-06 Q 로 폐지(세로선으로 읽혔다). 날짜는 공용 표기
        ("2026년 8월 7일")고, 고정 칸(.record-held-at 136px)이 최장 날짜까지 한 줄로 담아
        좌측 정렬이 성립한다. 넘침은 공용 .wire-fade-clip. */}
    <summary className="record-summary">
      <span className="record-ordinal">{ordinal}회차</span>
      <span className="record-held-at">{formatKoreanDate(record.heldAt)}</span>
      <WireBadge tone="blue">{sessionKindLabel(record.kind)}</WireBadge>
      <span className={record.aiOneLiner === null ? 'record-one-liner wire-fade-clip is-memo' : 'record-one-liner wire-fade-clip'}>
        {oneLiner ?? '핵심 한 줄이 아직 없습니다'}
      </span>
      <span className="record-summary-right">
        {record.aiOneLiner === null && record.memoExcerpt !== null && <WireBadge>수기</WireBadge>}
        {/* 리스크 배너는 두지 않는다(D47 §5) — 대신 어느 회차에서 나왔는지를 이 표시가 알린다. */}
        {hasConfirmedFlag && <span className="record-flag" data-confirmed="true"><Icon name="warning" size={14} /> 리스크</span>}
      </span>
    </summary>

    <div className="record-body">
      {/* 불일치 처리 '기록 오류'의 흔적 (D45 · ADR-0018 · CCC-42). 원본은 손대지 않고 표시만
          붙여 다음 열람자의 오해를 막는다 — 정정이 필요하면 실무자가 따로 기록한다.
          상자가 아니라 플랫 한 줄이다 — 카드 안에 상자를 두지 않는다(카드 안 카드 금지). */}
      {recordError && <p className="record-error-note" role="note">
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
              <WireBadge tone="mint">{actionOwnerLabel(item.owner)}</WireBadge>
              {item.dueDate !== null && <span className="record-item-meta">기한 {item.dueDate}</span>}
              {item.resolved ? <WireBadge>완료</WireBadge> : <WireBadge tone="lavender">미완료</WireBadge>}
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
              {flag.source === 'ai' && <WireBadge tone="lavender">AI 제안</WireBadge>}
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
