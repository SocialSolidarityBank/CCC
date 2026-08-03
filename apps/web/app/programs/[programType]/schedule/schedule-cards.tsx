'use client';

// 재개편 T3(#33): 상담 카드 목록 본문. 정렬 토글(시간순 오름/내림)과 카드 그리드.
// 열 수는 .card-grid 가 정한다(2026-07-26) — wire-col-6 을 박아 두면 카드가 1장일 때도
// 화면 절반만 차지한다.
// 서버가 시간순(오름차순)으로 정렬·직렬화한 카드를 받아, 내림차순은 뒤집어 렌더한다.
// 실명/연락처 폴백 판단은 여기서 한다(participantName ?? 가명 ID, participantPhone ?? '—').
// 스타일은 와이어 킷과 디자인 토큰(design/tokens.css)만 사용한다(신규 CSS 클래스 없음).
import { useState } from 'react';
import { Icon } from '../../../components/wire/wire-icon';
import Link from 'next/link';
import { WireButton } from '../../../components/wire/wire-button';
import { WireCard, WireField } from '../../../components/wire/wire-card';

export interface ScheduleCardItem {
  id: string;
  href: string;
  when: string;
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
        <WireButton onClick={() => setAscending((prev) => !prev)}>
          시간순 {ascending ? <Icon name="arrow-up" size={14} /> : <Icon name="arrow-down" size={14} />}
        </WireButton>
      </div>

      {ordered.length === 0 ? (
        <p style={{ color: 'var(--sub)' }} aria-live="polite">
          예정된 상담이 없습니다.
        </p>
      ) : (
        <div className="card-grid">
          {ordered.map((card) => (
            <Link key={card.id} href={card.href} style={{ display: 'block' }}>
              {/* 일시를 카드 헤더(구분선)로, 실명/폴백은 이름 필드로 — T2(D24) 실명 표시가 이 티켓의 핵심. */}
              {/* 참여 사업 행은 없음 — 사업을 고른 뒤 진입하는 화면이라 중복 정보(카드 높이 균일 목적 포함). */}
              <WireCard title={card.when}>
                <WireField label="이름">{card.participantName ?? card.beneficiaryId}</WireField>
                <WireField label="연락처">{card.participantPhone ?? '미기입'}</WireField>
              </WireCard>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
