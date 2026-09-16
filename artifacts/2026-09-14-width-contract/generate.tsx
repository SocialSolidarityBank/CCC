// 폭 계약 설명용 시안. 합성 문장만 쓰고 저장·통신을 하지 않는다.
// 왼쪽은 계약이 없는 현재 상태, 오른쪽은 계약을 적용한 상태다. 같은 마크업·같은 문장이다.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../packages/wire/src/wire-styles';
import { PageTitle, WireBadge, WireCard, WireCardSection } from '../../packages/wire/src/index';

const LONG = '함께온기금 울타리대출 (진행 중) 담당 이서연';
const EVENT = '오전 11:00 박한결 함께온기금 울타리대출 실행 상담';

/** 설명할 격자 하나. 안쪽 마크업은 두 패널이 완전히 같다. */
function Demo({ kind }: { kind: 'broken' | 'fixed' }) {
  return (
    <div className="demo-frame" data-kind={kind}>
      <p className="demo-frame-label">화면 폭 320px</p>
      <div className="demo-viewport">
        <WireCard title="일정">
          <div className="demo-list">
            <div className="demo-row">
              <span className="demo-row-name">{EVENT}</span>
              <WireBadge tone="mint">기본 상담</WireBadge>
            </div>
            <div className="demo-row">
              <span className="demo-row-name">오후 1:30 이로운 함께온기금 울타리대출 첫 상환 준비 상담</span>
              <WireBadge tone="lavender">인테이크</WireBadge>
            </div>
          </div>
          <WireCardSection title="참여 사업">
            <div className="demo-list">
              <div className="demo-row"><span className="demo-row-name">{LONG}</span></div>
            </div>
          </WireCardSection>
        </WireCard>
      </div>
    </div>
  );
}

const page = (
  <>
    <PageTitle>폭 계약</PageTitle>
    <WireCard title="같은 마크업, 같은 문장, 계약만 다르다">
      <p className="demo-note">단일 열 <code>display:grid</code>의 암시 트랙은 <code>minmax(auto, max-content)</code>다. 그래서 칸 폭이 가장 긴 문장을 따라가고, 문장이 길어지면 카드가 화면 밖으로 밀린다. 왼쪽은 지금의 공유 CSS 그대로이고, 오른쪽은 열 트랙 <code>minmax(0,1fr)</code>과 줄어드는 자식의 <code>min-width:0</code>만 더한 것이다.</p>
      <div className="demo-pair">
        <div className="demo-col">
          <h3 className="demo-col-title">계약 없음</h3>
          <p className="demo-note">칸이 문장 길이를 따라가 오른쪽으로 넘친다. 빨간 선이 화면 경계이고, 상태 배지는 선 밖으로 밀려 안 보인다.</p>
          <Demo kind="broken" />
        </div>
        <div className="demo-col">
          <h3 className="demo-col-title">계약 있음</h3>
          <p className="demo-note">칸이 0까지 줄 수 있어 경계 안에 들어오고, 긴 이름만 한 줄 말줄임으로 물러난다.</p>
          <Demo kind="fixed" />
        </div>
      </div>
    </WireCard>
    <WireCard title="계약 두 줄이 하는 일">
      <div className="demo-list">
        <div className="demo-row"><span className="demo-row-name"><code>grid-template-columns: minmax(0,1fr)</code></span><span className="demo-row-desc">칸의 하한을 0으로 내린다. 암시 트랙의 하한은 auto, 즉 내용 최소 폭이라 칸이 줄지 못한다.</span></div>
        <div className="demo-row"><span className="demo-row-name"><code>min-width: 0</code></span><span className="demo-row-desc">줄어들어야 하는 자식의 기본 최소 폭을 푼다. 이것이 없으면 말줄임이 걸리지 않는다.</span></div>
      </div>
    </WireCard>
  </>
);

const demoCss = `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{margin:0;font-family:'Pretendard Variable',sans-serif;background:var(--canvas)}
.demo-page{display:grid;gap:var(--section-gap);max-width:1120px;margin:0 auto;padding:var(--space-8) var(--space-8) var(--space-10)}
.demo-note{margin:0;color:var(--sub);font-size:var(--text-detail);font-weight:400;line-height:var(--leading-relaxed)}
.demo-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-6);margin-top:var(--space-5)}
.demo-col{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-3)}
.demo-col-title{margin:0;color:var(--ink);font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug)}
.demo-frame-label{margin:0;color:var(--sub);font-size:var(--text-badge);font-weight:400;line-height:var(--leading-normal)}
/* 화면 경계를 눈에 보이게 둔다. 넘친 만큼이 이 선 밖으로 나간다. */
.demo-viewport{position:relative;width:320px;padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel);overflow-x:auto}
.demo-viewport::after{content:"";position:absolute;top:0;bottom:0;right:0;width:2px;background:var(--risk)}
.demo-list{display:grid;gap:var(--space-4)}
.demo-row{display:flex;align-items:center;gap:var(--space-2)}
.demo-row-name{color:var(--ink);font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal);white-space:nowrap}
.demo-row-desc{color:var(--sub);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-relaxed)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--text-detail)}
/* 오른쪽 패널에만 계약을 적용한다. 이 네 줄이 이번 제안의 전부다. */
[data-kind="fixed"] .demo-list{grid-template-columns:minmax(0,1fr)}
[data-kind="fixed"] .wire-card,[data-kind="fixed"] .wire-card-body,[data-kind="fixed"] .wire-card-section{min-width:0}
[data-kind="fixed"] .demo-row{min-width:0}
[data-kind="fixed"] .demo-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
@media(max-width:767px){.demo-pair{grid-template-columns:minmax(0,1fr)}.demo-viewport{width:100%}}
`;

mkdirSync(new URL('.', import.meta.url), { recursive: true });
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>폭 계약 설명</title><style>${composeSharedCss(wireStyles)}\n${demoCss}</style></head><body><main class="demo-page">${renderToStaticMarkup(page)}</main></body></html>`;
writeFileSync(new URL('index.html', import.meta.url), html);
copyFileSync(new URL('../../apps/web/node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url), new URL('PretendardVariable.woff2', import.meta.url));
console.log('width-contract/index.html generated from current shared CSS.');
