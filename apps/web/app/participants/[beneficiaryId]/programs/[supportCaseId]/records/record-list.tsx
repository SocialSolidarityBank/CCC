import Link from 'next/link';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { formatKoreanDate, formatKoreanDateTime } from '../../../../../lib/format-korean-date';
import { Icon } from '../../../../../components/wire/wire-icon';
import { ConsultationTypeBadge } from '../../../../../components/wire/consultation-type-badge';
import { WireBadge } from '../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../components/wire/wire-card';
import { WireSourceQuotes } from '../../../../../components/wire/wire-callout';
import { WireCardSection, WireItem } from '../../../../../components/wire/wire-section';
import { WireEmpty } from '../../../../../components/wire/wire-state';
import { lifeAreaOrder, lifeAreaStatusLabels } from '../../../../../lib/life-area-labels';
import type { FlagType, LifeAreaKey, SupportCaseRecord } from '../../../../../lib/api';

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
  housing_livelihood_shock: '주거·생계·건강 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
  violence_exploitation: '폭력·착취 피해',
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
const discrepancyKindLabels: Record<SupportCaseRecord['discrepancies'][number]['kind'], string> = {
  cross_session: '회차 간 불일치',
  within_session: '회차 내 모순',
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

// 생활 6영역 영역 이름. 쓰는 순서는 lifeAreaOrder(CCC-8)를 따른다 — 읽기 화면도 작성 화면과
// 같은 순서로 보여야 실무자가 같은 목록을 보고 있다고 느낀다.
const lifeAreaLabels = Object.fromEntries(lifeAreaOrder) as Record<LifeAreaKey, string>;

function lifeAreaStatusLabel(status: SupportCaseRecord['lifeAreaSnapshot'][number]['status']): string {
  const label = lifeAreaStatusLabels[status];
  if (label === undefined) throw new Error('Life area status was invalid.');
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
  recordsHref,
  briefingHref,
  intakeHref,
}: {
  record: SupportCaseRecord;
  ordinal: number;
  recordError: boolean;
  defaultOpen: boolean;
  recordsHref: string;
  briefingHref: string;
  /** 인테이크 회차에만 온다 — 펼친 본문에서 확인·수정 화면으로 가는 입구(2026-08-08 Q). */
  intakeHref?: string;
}) {
  // 핵심 한 줄은 승인된 AI 산출물만(R2). 승인 전·녹음 없음·레거시면 수기 발췌로 낮추고
  // '수기' 배지를 단다(D5) — 브리핑 영역 ②와 같은 폴백이라 두 화면이 같은 문장을 보여준다.
  const oneLiner = record.aiOneLiner ?? record.memoExcerpt;
  const confirmedFlags = record.flags.filter((flag) => flag.reviewStatus === 'confirmed');
  const hasConfirmedFlag = confirmedFlags.length > 0;

  return <details className="surface-card" id={`record-${record.id}`} open={defaultOpen}>
    {/* 회차 앞 꺽쇠는 2026-08-06 Q 로 폐지했었다(닫힘 오른쪽 꺽쇠가 세로선으로 읽혔다).
        2026-08-27 화살표 어휘 통일(아코디언 = 닫힘 아래·펼침 위)로 그 반론이 해소돼
        오른쪽 끝에 복원한다. 날짜는 공용 표기("2026년 8월 7일")고, 고정 칸
        (.record-held-at 136px)이 최장 날짜까지 한 줄로 담아 좌측 정렬이 성립한다.
        넘침은 공용 .wire-fade-clip. */}
    <summary className="record-summary">
      <span className="record-ordinal">{ordinal}회차</span>
      <span className="record-held-at">{formatKoreanDate(record.heldAt)}</span>
      <ConsultationTypeBadge kind={record.kind} />
      <span className={record.aiOneLiner === null ? 'record-one-liner wire-fade-clip is-memo' : 'record-one-liner wire-fade-clip'}>
        {/* 일괄 검토 A9 (2026-08-08): 인테이크는 메모가 없어 항상 빈말이 나오던 자리다. */}
        {oneLiner ?? (record.kind === 'intake' ? '인테이크 질문지 작성 회차' : '핵심 한 줄이 아직 없습니다')}
      </span>
      <span className="record-summary-right">
        {record.aiOneLiner === null && record.memoExcerpt !== null && <WireBadge>수기</WireBadge>}
        {/* 리스크 배너는 두지 않는다(D47 §5) — 대신 어느 회차에서 나왔는지를 이 표시가 알린다. */}
        {hasConfirmedFlag && <span className="record-flag" data-confirmed="true"><Icon name="warning" size={14} /> 리스크</span>}
        <span className="wire-card-arrow" aria-hidden="true" />
      </span>
    </summary>

    <div className="record-body">
      {/* 인테이크 진입은 전체 상담 기록 안이다(2026-08-08 Q — 사이트맵상 이 목록의 하위).
          질문지 답변은 이 목록에 펴지 않고 확인·수정 화면이 정본을 보여준다. */}
      {record.kind === 'intake' && intakeHref !== undefined && <p className="record-intake-entry">
        {/* 도착지는 조회가 기본이다(CCC-58) — 수정은 조회 화면의 버튼이 연다. */}
        <WireButton variant="secondary" height="sm" href={intakeHref}>인테이크 기록 보기</WireButton>
      </p>}
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

      {/* CCC-11: 저장된 항목은 모두 보이고 빈 항목은 생략한다. 담당 실무자 의견은
          정기 기록지의 선택 항목이라 값이 있을 때만 블록을 그린다(D47 §6 목록의 항목). */}
      {record.managerOpinion !== null && record.managerOpinion.trim().length > 0 && (
        <section className="record-block record-manager-opinion" aria-labelledby={`opinion-${record.id}`}>
          <h3 id={`opinion-${record.id}`}>담당 실무자 의견</h3>
          <p>{record.managerOpinion}</p>
        </section>
      )}

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

      {/* CCC-11: 6영역 스냅샷도 저장된 항목이라 읽기 화면에서 보인다. 스냅샷이 없는
          회차(인테이크 등)는 블록 자체를 그리지 않는다. 배지 톤은 계열 의미(DESIGN-RULES §4)를
          따른다: 위기=라벤더(주의), 그 외=무채색(상태 값은 D9 플래그가 아니므로 리스크 레드는
          쓰지 않는다 — D47 §5). */}
      {record.lifeAreaSnapshot.length > 0 && <section
        className="record-block record-life-areas"
        aria-labelledby={`life-areas-${record.id}`}
      >
        <h3 id={`life-areas-${record.id}`}>생활 6영역</h3>
        <ul className="record-life-area-list">
          {record.lifeAreaSnapshot.map((area) => (
            <li key={area.areaKey}>
              <span className="record-life-area-name">{lifeAreaLabels[area.areaKey]}</span>
              <WireBadge {...(area.status === 'crisis' ? { tone: 'lavender' } : {})}>
                {lifeAreaStatusLabel(area.status)}
              </WireBadge>
              {area.note !== null && area.note.trim().length > 0 && (
                <span className="record-item-meta">{area.note}</span>
              )}
            </li>
          ))}
        </ul>
      </section>}

      <WireCardSection title="이 회차에서 나온 것" tone="mint">
        {record.aiOneLiner === null && confirmedFlags.length === 0 && record.discrepancies.length === 0
          ? <WireEmpty>이 회차에 연결된 승인 산출물이 없습니다.</WireEmpty>
          : <ul className="briefing-suggestions">
              {record.aiOneLiner !== null && <li>
                <WireItem
                  tone="lavender"
                  title={record.aiOneLiner}
                  status={<WireBadge tone="lavender">승인된 핵심 한 줄</WireBadge>}
                  action={<Link href={`${recordsHref}/${encodeURIComponent(record.id)}/review`}>승인 내용 보기</Link>}
                />
              </li>}
              {confirmedFlags.map((flag) => <li key={flag.id}>
                <WireItem
                  title={<span className="record-flag" data-confirmed={flag.reviewStatus === 'confirmed' ? 'true' : 'false'}>
                    {flag.reviewStatus === 'confirmed' && <><Icon name="warning" size={14} />{' '}</>}{flagLabel(flag.flagType)}
                  </span>}
                  description={flagReviewStatusLabel(flag.reviewStatus)}
                  {...(flag.source === 'ai' ? { status: <WireBadge tone="lavender">AI 제안</WireBadge> } : {})}
                />
                {flag.quote !== null && (
                  <WireSourceQuotes quotes={[flag.quote]} sourceHref={`#record-${record.id}`} />
                )}
              </li>)}
              {record.discrepancies.map((discrepancy) => <li key={discrepancy.id}>
                <WireItem
                  title={discrepancyKindLabels[discrepancy.kind]}
                  status={<WireBadge tone={discrepancy.resolutionStatus === null ? 'lavender' : 'neutral'}>
                    {discrepancy.resolutionStatus === null ? '미처리' : '처리됨'}
                  </WireBadge>}
                  action={<Link href={`${briefingHref}#discrepancy-${discrepancy.id}`}>불일치 보기</Link>}
                />
              </li>)}
            </ul>}
      </WireCardSection>
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
  recordsHref,
  briefingHref,
  intakeHref,
}: {
  records: SupportCaseRecord[];
  recordErrorSessionIds: ReadonlySet<string>;
  unavailable: boolean;
  recordsHref: string;
  briefingHref: string;
  /** 인테이크 확인·수정 화면(2026-08-08 Q — 인테이크 진입은 이 목록 안이다). */
  intakeHref?: string;
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
      recordsHref={recordsHref}
      briefingHref={briefingHref}
      {...(record.kind === 'intake' && intakeHref !== undefined ? { intakeHref } : {})}
    />)}
  </section>;
}
