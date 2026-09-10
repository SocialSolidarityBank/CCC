import type { ReactNode } from 'react';

// 위계 부품 2종 (2026-08-10 · 규칙집 리팩터 1단계).
//
// 왜 부품인가. DESIGN.md §2-2(위계 쌓임)와 §2-3(중요 정보 강조)은 스스로 "검사로 못 막는다"고
// 적어 두었고, 실제로 `pnpm guard:tokens` 는 위반 0 인데 화면은 계속 눌린 채로 나왔다. 검사가
// 보는 것은 값(색·크기·간격)이고, 어긋나는 것은 조합(무엇을 먼저 읽는가)이기 때문이다.
//
// 그래서 규칙을 문장이 아니라 부품에 박는다. 아래 둘은 **크기·굵기·색을 바깥에서 정할 수
// 없다** — className 슬롯이 일부러 없다. 슬롯을 열어 두면 그 슬롯이 곧 계약을 비켜 가는 길이
// 되고, 화면마다 자기 이름의 클래스를 하나씩 더 만드는 지금 상태로 돌아간다(화면이 쓰는
// 클래스 338종 중 205종이 딱 한 화면에서만 쓰인다, 2026-08-10 실측).
//
// 같은 레시피가 지금 세 벌로 살아 있다는 것이 이 부품의 직접적인 근거다:
//   .wire-card-section>h3  14/600 --sub        (계약으로 선언만 되고 쓰인 곳 0)
//   .record-block>h3       14/600 --mint-deep  (상담 기록·인테이크)
//   .briefing-qlabel       14/600 --mint-deep  (15초 페이지)
// 셋 중 형제 구획 사이에 구분선을 자동으로 넣는 것은 브리핑 한 벌뿐이라, 같은 모양의 구획이
// 화면에 따라 §2-2 규칙 2 를 지키기도 하고 안 지키기도 했다. 부품은 그 차이를 없앤다.

/** 구획 라벨의 계열 색(D34 고정 의미). discrepancy 는 리스크와 분리한 기록 차이 전용이다. */
export type WireSectionTone = 'sub' | 'mint' | 'lavender' | 'discrepancy';

export interface WireCardSectionProps {
  /** 구획 라벨. 제목이 아니라 **라벨**이다 — 14/600 으로 본문 16 아래에 선다(§2-2 위계 4단 ②). */
  title: ReactNode;
  children: ReactNode;
  tone?: WireSectionTone;
  /** 구획 전체에 해당하는 행동. 제목 줄의 남는 폭을 지나 카드 오른쪽 끝에 선다. */
  action?: ReactNode;
  /** 라벨 요소의 id. 구획에 이름을 지어 줄 때 labelledBy 와 짝으로 쓴다. */
  titleId?: string;
  labelledBy?: string;
  testId?: string;
}

/**
 * 카드 안 구획 — 라벨 한 줄 + 내용.
 *
 * **형제 구획이 이어지면 구분선이 저절로 붙는다**(`.wire-card-section + .wire-card-section`).
 * 화면이 구분선을 넣을지 말지 매번 판단하지 않는다. §2-2 규칙 2 는 "한 묶음에 줄이 3개 이상
 * 쌓이면 장치를 쓴다"고 요구하는데, 구획이 둘 이상 이어진다는 것이 곧 그 조건이므로 장치 ⓐ
 * (가로선)를 부품이 자동으로 만족시킨다.
 */
export function WireCardSection({
  title,
  children,
  tone = 'sub',
  action,
  titleId,
  labelledBy,
  testId,
}: WireCardSectionProps) {
  const titleElement = <h3 {...(titleId !== undefined ? { id: titleId } : {})}>{title}</h3>;
  return (
    <section
      className="wire-card-section"
      data-tone={tone === 'sub' ? undefined : tone}
      {...(labelledBy !== undefined ? { 'aria-labelledby': labelledBy } : {})}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {action === undefined
        ? titleElement
        : (
            <div className="wire-card-section-head">
              {titleElement}
              <span className="wire-card-section-action">{action}</span>
            </div>
          )}
      {children}
    </section>
  );
}

/** 항목의 면 색. 톤을 주면 tint 면 + 안쪽 여백이 붙고, 안 주면 면 없이 줄만 선다. */
export type WireItemTone = 'plain' | 'mint' | 'lavender';

export interface WireItemProps {
  /** 항목 제목 — 16/600 --ink (§2-2 위계 4단 ①). */
  title: ReactNode;
  /** 제목 아래 설명 — 14/400 --sub (단 ④). 제목과 짝이라 크기·굵기가 함께 정해진다(§2-1 짝 계약). */
  description?: ReactNode;
  /**
   * 상태·분류 낱말 자리. '미기록'·'무응답'·'3회차'처럼 훑을 때 먼저 잡혀야 하는 낱말은
   * 본문 글자로 두지 않고 여기에 `WireBadge` 로 넣는다(§2-2 규칙 4 · §2-3 강조 의무).
   */
  status?: ReactNode;
  /** 개별 항목에 딸린 행동. 항목 텍스트 뒤에 이어지고 카드 끝으로 밀지 않는다. */
  action?: ReactNode;
  tone?: WireItemTone;
  testId?: string;
}

/**
 * 한 항목. 카드 안 읽기 4단 안에서 제목, 설명, 상태, 행동을 조립한다.
 *
 * 15초 페이지의 옛 손 조립은 이유를 16/400 sub로, 링크를 제목과 같은 16/600 ink로
 * 그려 위계가 사라졌다. 이 부품은 현재 계약대로 이유를 14/400 sub로 낮추고 행동을
 * 14/600 계열색으로 분리한다. 개별 행동은 항목 텍스트 뒤에 둔다.
 */
export function WireItem({ title, description, status, action, tone = 'plain', testId }: WireItemProps) {
  return (
    <div
      className="wire-item"
      data-tone={tone === 'plain' ? undefined : tone}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <p className="wire-item-title">{title}</p>
      {description !== undefined && <p className="wire-item-desc">{description}</p>}
      {status !== undefined && <span className="wire-item-status">{status}</span>}
      {action !== undefined && <span className="wire-item-action">{action}</span>}
    </div>
  );
}
