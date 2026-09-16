// 같은 종류끼리 묶어 열로 나누는 계약 설명용 시안. 합성 값만 쓰고 저장·통신을 하지 않는다.
// '지금'은 캡처 HTML에서 그대로 긁어 온 마크업이고, '제안'은 같은 값에 배치만 바꾼 것이다.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../packages/wire/src/wire-styles';
import { PageTitle, WireBadge, WireCard, WireCardSection } from '../../packages/wire/src/index';

// ── 지금 상태: 운영 화면에서 실측한 마크업 그대로 ────────────────────────────
const nowEngines = `
<div class="wire-item"><p class="wire-item-title">사용 안 함</p><p class="wire-item-desc">지금 고를 수 있는 처리입니다.</p><span class="wire-item-status"><span class="wire-badge" data-tone="mint"><span class="wire-badge-label">사용 가능</span></span></span></div>
<div class="wire-item"><p class="wire-item-title">기관 안 처리</p><p class="wire-item-desc">지금 고를 수 있는 처리입니다.</p><span class="wire-item-status"><span class="wire-badge" data-tone="mint"><span class="wire-badge-label">사용 가능</span></span></span></div>
<div class="wire-item"><p class="wire-item-title">Azure 외부 처리</p><p class="wire-item-desc">처리 장비에 이 엔진의 자격이 없습니다.</p><span class="wire-item-status"><span class="wire-badge" data-tone="lavender"><span class="wire-badge-label">자격 없음</span></span></span></div>
`;
const nowAssignees = `
<div class="wire-item"><p class="wire-item-title">이서연</p><span class="wire-item-status"><span class="wire-badge" data-tone="mint"><span class="wire-badge-label">주 담당</span></span></span></div>
<div class="wire-item"><p class="wire-item-title">최지우</p><span class="wire-item-status"><span class="wire-badge" data-tone="mint"><span class="wire-badge-label">공동 담당</span></span></span></div>
`;

const LIFE_AREAS = [
  { name: '경제·생계', status: '긴장', note: '카드 대금 미납 확인' },
  { name: '주거', status: '괜찮음', note: null },
  { name: '일·고용·학업', status: '괜찮음', note: null },
  { name: '건강', status: '괜찮음', note: null },
  { name: '심리·정서', status: '긴장', note: '불면 호소' },
  { name: '가족·관계·돌봄', status: '괜찮음', note: null },
];

const nowLifeAreas = `<section class="record-block record-life-areas"><ul>${LIFE_AREAS.map((area) => `<li><span class="record-life-area-name">${area.name}</span><span class="wire-badge"><span class="wire-badge-label">${area.status}</span></span>${area.note === null ? '' : `<span class="record-item-meta">${area.note}</span>`}</li>`).join('')}</ul></section>`;
const ENGINES = [
  { name: '사용 안 함', desc: '지금 고를 수 있는 처리입니다.', status: '사용 가능', tone: 'mint' as const },
  { name: '기관 안 처리', desc: '지금 고를 수 있는 처리입니다.', status: '사용 가능', tone: 'mint' as const },
  { name: 'Azure 외부 처리', desc: '처리 장비에 이 엔진의 자격이 없습니다.', status: '자격 없음', tone: 'lavender' as const },
];
// 세 화면에서 실제로 쓰이는 배지들이다. 글자 수가 2자에서 5자까지 섞여 있다.
const BADGE_CASES = [
  { name: 'openai-gpt5 v2026-08', desc: 'AI 사업자 활성 상태', status: '활성', tone: 'mint' as const },
  { name: '2026년 9월 18일 오후 2:00', desc: '상담 일정', status: '예정', tone: 'neutral' as const },
  { name: 'Azure 외부 처리', desc: 'STT 엔진별 상태', status: '자격 없음', tone: 'lavender' as const },
  { name: '최지우', desc: '현재 배정된 실무자', status: '공동 담당', tone: 'mint' as const },
];

const ASSIGNEES = [
  { name: '이서연', role: '주 담당' },
  { name: '최지우', role: '공동 담당' },
];

function Panel({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="group-panel">
      <h3 className="group-panel-title">{label}</h3>
      <p className="group-note">{note}</p>
      <div className="group-frame">{children}</div>
    </div>
  );
}

function Case({ title, why, now, proposal }: { title: string; why: string; now: React.ReactNode; proposal: React.ReactNode }) {
  return (
    <WireCard title={title}>
      <p className="group-note">{why}</p>
      <div className="group-pair">
        <Panel label="지금" note="한 항목의 이름, 설명, 상태가 각각 자기 줄을 쓴다. 항목이 늘면 세로로만 길어지고 오른쪽은 비어 있다.">{now}</Panel>
        <Panel label="제안" note="같은 종류를 한 격자에 넣고 상태를 이름과 같은 줄, 같은 열에 세운다. 767 이하에서는 한 열로 쌓인다.">{proposal}</Panel>
      </div>
    </WireCard>
  );
}

const body = (
  <>
    <PageTitle>같은 종류끼리 묶는 계약</PageTitle>
    <WireCard title="지금은 종류가 섞인 채 세로로만 쌓인다">
      <p className="group-note">아래 세 자리는 운영 화면에서 실측한 것이다. 왼쪽은 그 마크업 그대로이고, 오른쪽은 값을 하나도 바꾸지 않고 배치만 고친 것이다. 값의 종류가 같으면 같은 열에 서고, 짧은 항목은 넓은 화면에서 가로로 나뉜다.</p>
    </WireCard>

    <Case
      title="AI·STT·연결 · 엔진별 상태 (3개 항목, 각 1031px × 76px)"
      why="엔진 셋은 같은 종류다. 지금은 항목마다 이름, 설명, 상태 배지가 세 줄로 쌓여 한 항목이 76px을 쓰고, 상태 배지가 설명 아래에 떨어져 어느 항목의 상태인지 눈으로 다시 맞춰야 한다."
      now={<div dangerouslySetInnerHTML={{ __html: nowEngines }} />}
      proposal={(
        <div className="group-grid" data-columns="3">
          {ENGINES.map((engine) => (
            <div className="group-cell" key={engine.name}>
              <div className="group-cell-head">
                <span className="group-cell-name">{engine.name}</span>
                <WireBadge tone={engine.tone}>{engine.status}</WireBadge>
              </div>
              <p className="group-cell-desc">{engine.desc}</p>
            </div>
          ))}
        </div>
      )}
    />

    <Case
      title="배정 · 현재 배정된 실무자 (2개 항목)"
      why="이름과 역할 배지는 한 사람의 정보인데 지금은 두 줄로 갈린다. 사람이 늘어날수록 이름과 배지가 번갈아 쌓여 목록의 경계가 사라진다."
      now={<div dangerouslySetInnerHTML={{ __html: nowAssignees }} />}
      proposal={(
        <div className="group-grid" data-columns="3">
          {ASSIGNEES.map((assignee) => (
            <div className="group-cell" key={assignee.name}>
              <div className="group-cell-head">
                <span className="group-cell-name">{assignee.name}</span>
                <WireBadge tone="mint">{assignee.role}</WireBadge>
              </div>
            </div>
          ))}
        </div>
      )}
    />

    <Case
      title="상담 기록 확인하기 · 생활 6영역 (6개 항목, 981px × 189px)"
      why="여섯 영역은 같은 종류인데 메모가 있는 줄만 길어져 줄마다 폭이 다르다. 메모가 없는 네 줄은 배지 뒤가 전부 빈자리다."
      now={<div dangerouslySetInnerHTML={{ __html: nowLifeAreas }} />}
      proposal={(
        <div className="group-grid" data-columns="3">
          {LIFE_AREAS.map((area) => (
            <div className="group-cell" key={area.name}>
              <div className="group-cell-head">
                <span className="group-cell-name">{area.name}</span>
                <WireBadge tone={area.status === '긴장' ? 'lavender' : 'mint'}>{area.status}</WireBadge>
              </div>
              {area.note === null ? null : <p className="group-cell-desc">{area.note}</p>}
            </div>
          ))}
        </div>
      )}
    />

    <WireCard title="배지를 글자 앞에 두면 (Q 질문)">
      <p className="group-note">세 안 모두 같은 값이다. 차이는 배지 자리와 이름이 시작하는 x다. 아래 숫자는 실측이며, 시안 오른쪽의 세로 점선이 이름 시작선이다.</p>
      <div className="group-triple">
        <Panel label="A. 이름 뒤 (현행 규칙 §1)" note="이름이 모두 같은 x에서 시작한다. 배지 길이가 달라도 이름 왼쪽 끝은 한 선이다.">
          <div className="group-grid" data-badge="after">
            {BADGE_CASES.map((row) => (
              <div className="group-cell" key={row.name}>
                <div className="group-cell-head"><span className="group-cell-name">{row.name}</span><WireBadge tone={row.tone}>{row.status}</WireBadge></div>
                <p className="group-cell-desc">{row.desc}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel label="B. 배지 앞, 내용 폭" note="배지 글자 수가 항목마다 달라 이름 시작선이 흔들린다. 목록을 위아래로 훑을 때 이름을 눈으로 다시 찾게 된다.">
          <div className="group-grid" data-badge="before-auto">
            {BADGE_CASES.map((row) => (
              <div className="group-cell" key={row.name}>
                <div className="group-cell-head"><WireBadge tone={row.tone}>{row.status}</WireBadge><span className="group-cell-name">{row.name}</span></div>
                <p className="group-cell-desc">{row.desc}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel label="C. 배지 앞, 고정 열 76" note="배지 칸을 고정하면 이름 시작선이 다시 한 선이 된다. 상태를 먼저 훑는 목록에 맞고, 배지 칸만큼 이름 폭이 줄어든다.">
          <div className="group-grid" data-badge="before-fixed">
            {BADGE_CASES.map((row) => (
              <div className="group-cell" key={row.name}>
                <div className="group-cell-head"><WireBadge tone={row.tone}>{row.status}</WireBadge><span className="group-cell-name">{row.name}</span></div>
                <p className="group-cell-desc">{row.desc}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </WireCard>

    <WireCard title="계약 세 줄">
      <WireCardSection title="1. 같은 종류는 한 격자에 넣는다">
        <p className="group-rule">엔진 목록, 배정된 사람, 생활 영역처럼 종류가 같은 항목은 낱개로 쌓지 않고 하나의 격자로 낸다. 항목마다 같은 조각을 같은 자리에 둔다.</p>
      </WireCardSection>
      <WireCardSection title="2. 상태는 이름과 같은 줄, 같은 열이다">
        <p className="group-rule">상태 배지는 자기 줄을 차지하지 않는다. 이름 바로 뒤에 서고, 설명은 그 아래 줄로 내려간다. 배지가 값보다 먼저 오는 자리와 나중에 오는 자리를 한 화면에 섞지 않는다.</p>
      </WireCardSection>
      <WireCardSection title="3. 짧은 항목은 넓은 화면에서 열로 나눈다">
        <p className="group-rule">항목 한 개가 한 줄을 채우지 못하면 768 이상에서 2열 또는 3열로 나누고, 767 이하에서는 한 열로 쌓는다. 열 수는 항목 수가 아니라 폭이 정한다.</p>
      </WireCardSection>
    </WireCard>
  </>
);

const demoCss = `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{margin:0;font-family:'Pretendard Variable',sans-serif;background:var(--canvas)}
.group-page{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--section-gap);max-width:1440px;margin:0 auto;padding:var(--space-8) var(--space-8) var(--space-10)}
.group-note{margin:0;color:var(--sub);font-size:var(--text-detail);font-weight:400;line-height:var(--leading-relaxed)}
.group-rule{margin:0;color:var(--ink);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-relaxed)}
.group-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-6);margin-top:var(--space-5)}
.group-panel{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-2);min-width:0}
.group-panel-title{margin:0;color:var(--ink);font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug)}
/* 사선 면이 채워지지 않은 자리다. */
.group-frame{min-width:0;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-card);background:repeating-linear-gradient(135deg,var(--canvas),var(--canvas) 6px,transparent 6px,transparent 12px)}
.group-frame>div,.group-frame>ul{background:var(--panel);border-radius:var(--radius-control)}
.group-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-4);min-width:0}
.group-cell{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-1);min-width:0}
.group-cell-head{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.group-cell-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug)}
.group-triple{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-6);margin-top:var(--space-5)}
/* C안: 배지 칸을 고정하면 이름 시작선이 한 선으로 돌아온다. */
.group-grid[data-badge="before-fixed"] .group-cell-head{display:grid;grid-template-columns:76px minmax(0,1fr);align-items:center}
.group-grid[data-badge="before-fixed"] .wire-badge{justify-self:start}
.group-cell-desc{margin:0;color:var(--sub);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal)}
@media(min-width:768px){
  .group-pair{grid-template-columns:repeat(2,minmax(0,1fr))}
  .group-grid[data-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
  .group-triple{grid-template-columns:repeat(3,minmax(0,1fr))}
}
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>같은 종류끼리 묶는 계약</title><style>${composeSharedCss(wireStyles)}\n${demoCss}</style></head><body><main class="group-page">${renderToStaticMarkup(body)}</main></body></html>`;
writeFileSync(new URL('grouping.html', import.meta.url), html);
console.log('width-contract/grouping.html generated from current shared CSS.');
