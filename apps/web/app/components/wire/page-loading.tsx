import { GridContainer } from './grid-container';
import { PageTitle } from './page-title';
import { WireCard } from './wire-card';

// 로딩 화면 공용 부품(2026-08-09 Q). DESIGN.md §5 의 `[추론]` 목록에 "로딩·스켈레톤" 으로
// 남아 있던 자리를 계약으로 채운다.
//
// 규칙 셋만 지키면 된다:
//
// 1. **제목은 로드된 화면과 같은 부품·같은 문자열이다.** 이전에는 로딩만 클래스 없는 h1 을
//    써서 굵기가 700(UA 기본)이었고, 로드되면 PageTitle 600 으로 바뀌어 제목이 눈에 띄게
//    가늘어졌다. 767 미만에서는 크기까지 28 에서 24 로 뛰었다 — .wire-page-title 에만
//    좁은 화면 분기가 있기 때문이다. 같은 부품을 쓰면 두 어긋남이 함께 사라진다.
// 2. **모션이 없다**(§6). 스피너·시머 같은 장식용 무한 반복은 금지고, 로딩 진입 모션은
//    2026-08-04 에 '떠오름'을 폐지하며 함께 닫혔다. 되살리려면 ADR-0028 재개정이 필요하다.
//    회색 스켈레톤 블록도 두지 않는다 — 움직이지 않는 회색 덩어리는 내용을 흉내 낼 뿐
//    "곧 온다"를 말해 주지 못한다. 15초 안에 훑는 화면이라 한 문장이 더 정확하다.
// 3. **글자는 카드 안에 선다**(§4-5). 구 briefing 로딩은 카드 없이 맨 .empty 였고 나머지 둘은
//    p.empty 였다 — 셋을 카드 한 장으로 모은다.
export interface PageLoadingProps {
  /** 로드 후 화면과 **똑같은** 제목 문자열. 다르면 로딩이 끝날 때 제목이 바뀐다. */
  title: string;
  /** 무엇을 기다리는지 한 줄. 생략하면 제목을 넣은 기본 문장을 쓴다. */
  message?: string;
}

export function PageLoading({ title, message }: PageLoadingProps) {
  return (
    <GridContainer as="main" className="page-content" ariaBusy>
      <div className="page-header"><PageTitle>{title}</PageTitle></div>
      <WireCard>
        <p className="empty" role="status" aria-live="polite">{message ?? `${title}를 불러오는 중입니다.`}</p>
      </WireCard>
    </GridContainer>
  );
}
