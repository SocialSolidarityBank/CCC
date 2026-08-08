'use client';

// 재개편 T3(#33): 상담 카드 목록 본문. 정렬 토글(시간순 오름/내림)과 카드 그리드.
// 열 수는 .card-grid 가 정한다(2026-07-26) — wire-col-6 을 박아 두면 카드가 1장일 때도
// 화면 절반만 차지한다.
// 서버가 시간순(오름차순)으로 정렬·직렬화한 카드를 받아, 내림차순은 뒤집어 렌더한다.
// 카드 모양은 공용 당사자 카드(ParticipantCard, 2026-08-06 Q)가 갖는다 — 전체 일정과
// 같은 디자인이다. 1행 날짜·시간·종류 뱃지 / 2행 이름·가명 ID·연락처.
import { useState } from 'react';
import { Icon } from '../../../components/wire/wire-icon';
import { WireButton } from '../../../components/wire/wire-button';
import { ParticipantCard, type ParticipantCardSchedule } from '../../../components/wire/participant-card';
import { WireEmpty } from '../../../components/wire/wire-state';

export interface ScheduleCardItem {
  id: string;
  href: string;
  schedule: ParticipantCardSchedule;
  participantName: string | null;
  beneficiaryId: string;
  participantPhone: string | null;
}

export function ScheduleCards({ cards }: { cards: ScheduleCardItem[] }) {
  const [ascending, setAscending] = useState(true);
  const ordered = ascending ? cards : [...cards].reverse();

  return (
    <>
      {/* 여백은 페이지 셸의 --section-gap 이 준다 — 여기서 marginBottom 을 다시 주면 이중이 된다. */}
      {/* '고정'은 2026-07-31 Q 요청으로 뺐다. 누를 수 없는 자리표시자 버튼이 계속 보이면
          "아직 안 만든 것"이 아니라 "고장난 것"으로 읽힌다 — 기능이 실제로 생길 때 다시 넣는다. */}
      <div className="list-toolbar">
        {/* 정렬 토글은 보기 조작이라 일반(neutral) 그레이 알약이다(2026-08-06 Q 위계 재편). */}
        <WireButton variant="neutral" onClick={() => setAscending((prev) => !prev)}>
          시간순 {ascending ? <Icon name="arrow-up" size={14} /> : <Icon name="arrow-down" size={14} />}
        </WireButton>
      </div>

      {ordered.length === 0 ? (
        <WireEmpty live>예정된 상담이 없습니다.</WireEmpty>
      ) : (
        <div className="card-grid">
          {ordered.map((card) => (
            <ParticipantCard
              key={card.id}
              href={card.href}
              schedule={card.schedule}
              name={card.participantName}
              beneficiaryId={card.beneficiaryId}
              phone={card.participantPhone}
            />
          ))}
        </div>
      )}
    </>
  );
}
