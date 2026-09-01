import type { ReactNode } from 'react';
import { WireBullets, WireCard, type WireCardTone } from './wire-card';
import { WireButton } from './wire-button';

// 콜아웃(안내줄) 계약, 2026-08-07 Q 리팩터링으로 컴포넌트 확정.
// draft-notice 와 intake-saved-notice 가 손으로 조립하던 안내줄(WireCard tone
// + notice-title/desc/actions)을 한 부품으로 모았다. 새 안내줄은 이 부품만 쓴다.
// 톤은 D34 계열 의미를 그대로 따른다: info(블루) = 시간·상태 안내,
// mint = 사람·소속, lavender = 주의·대기(색 규율 5). 리스크 어휘는 배너 전용이라
// 콜아웃에 risk 톤은 없다(D9).

export interface WireCalloutProps {
  /** 제목 한 줄(16/600 --ink). */
  title: ReactNode;
  /** 본문 설명(14/400 --sub). 문장 안 링크 허용. */
  children?: ReactNode;
  /**
   * 열거해야 할 것이 있을 때의 목록 슬롯(2026-08-09 신설). children 은 `p` 한 장이라
   * 목록을 넣을 수 없어, 호출부가 줄마다 `span[display:block]` 을 깔아 흉내 내고 있었다 —
   * 줄 사이 간격이 행간뿐이라 여러 줄이 한 덩어리로 뭉치고, 줄바꿈된 둘째 줄이 번호 아래로
   * 들어가 항목 경계가 사라졌다. 여기로 넘기면 §5 불릿 규칙(2개 이상일 때만 불릿)이
   * 자동으로 적용된다.
   */
  items?: ReactNode[];
  /** 행동 버튼 줄. 안내줄의 버튼은 세컨더리 이하만 쓴다(프라이머리는 화면 주 행동 몫, §4-5). */
  actions?: ReactNode;
  tone?: WireCardTone;
  /** 상태 알림이면 "status", 즉시 주의가 필요하면 "alert". */
  role?: 'status' | 'alert';
  testId?: string;
  /** 제목 요소에 줄 id. labelledBy 로 카드 이름을 지을 때 함께 쓴다. */
  titleId?: string;
  labelledBy?: string;
}

export function WireCallout({ title, children, items, actions, tone = 'info', role, testId, titleId, labelledBy }: WireCalloutProps) {
  // exactOptionalPropertyTypes: 없는 슬롯은 undefined 대신 키를 뺀다(레포 공통 패턴).
  return (
    <WireCard
      as="section"
      tone={tone}
      {...(role !== undefined ? { role } : {})}
      {...(testId !== undefined ? { testId } : {})}
      {...(labelledBy !== undefined ? { labelledBy } : {})}
    >
      <p className="notice-title" id={titleId}>{title}</p>
      {children !== undefined && <p className="notice-desc">{children}</p>}
      {items !== undefined && items.length > 0 && <WireBullets items={items} className="notice-list" />}
      {actions !== undefined && <div className="notice-actions">{actions}</div>}
    </WireCard>
  );
}

// 인용 블록(§5): AI 제안의 근거 발언 전용(D6·D9). 모양(.wire-quote)은 wire-styles.ts 가
// 소유한다. 세로선은 --gradient-brand-v 2px, 회색 세로선을 쓰지 않는다.
export interface WireQuoteProps {
  children: ReactNode;
  /** 전사 타임코드(예: 12:04). */
  time?: string;
}

export function WireQuote({ children, time }: WireQuoteProps) {
  return (
    <blockquote className="wire-quote">
      {children}
      {time !== undefined && <span className="wire-quote-time">{time}</span>}
    </blockquote>
  );
}

export interface WireSourceQuotesProps {
  quotes: readonly string[];
  sourceHref: string;
}

/** D73 source disclosure. Quotes stay collapsed beside the output and end at the source record. */
export function WireSourceQuotes({ quotes, sourceHref }: WireSourceQuotesProps) {
  if (quotes.length === 0) return null;

  return (
    <details className="wire-source-quotes" data-source-quotes>
      {/* 좁은 근거 행은 24px 무형 슬롯의 또렷한 꺽쇠를 쓴다. */}
      <summary>근거 인용 보기 <span className="wire-card-arrow" data-size="sm" data-glyph="legible" aria-hidden="true" /></summary>
      <div className="wire-source-quotes-body">
        {/* 인용 묶음은 왼쪽 폭을 쓰고 출처 버튼은 같은 행 오른쪽이다(2026-08-30 Q 2차 —
            구 세로 스택. 좁으면 버튼이 아랫줄로 접힌다). */}
        <div className="wire-source-quotes-list">
          {quotes.map((quote, index) => <WireQuote key={`${index}-${quote}`}>{quote}</WireQuote>)}
        </div>
        <WireButton
          className="wire-source-quotes-link"
          variant="neutral"
          href={sourceHref}
        >
          출처 회차 보기
        </WireButton>
      </div>
    </details>
  );
}
