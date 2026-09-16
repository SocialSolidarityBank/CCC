// 값 앞 표시를 배지에서 컬러 텍스트로 바꾸는 안의 비교 시안. 합성 값만 쓴다.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../packages/wire/src/wire-styles';
import { PageTitle, WireBadge, WireCard } from '../../packages/wire/src/index';

const SESSIONS = [
  { no: '5회차', date: '2026년 9월 11일', kind: '기본상담', tone: 'mint' as const, line: '울타리대출 심사 결과를 함께 확인하고 카드 대금 상환 계획을 다시 점검했다.' },
  { no: '1회차', date: '2026년 4월 3일', kind: '인테이크', tone: 'lavender' as const, line: '보호종료 후 첫 독립 주거의 월세 보증금 부족으로 300만 원 소액대출을 신청했다.' },
];
const STATES = [
  { status: '활성', tone: 'mint' as const, value: 'openai-gpt5 v2026-08' },
  { status: '기관 안 처리', tone: 'mint' as const, value: 'whisper-local' },
  { status: '자격 없음', tone: 'lavender' as const, value: 'Azure 외부 처리' },
];

const RECORD_ROWS = [
  { no: '5회차', date: '2026년 9월 11일', kind: '기본상담', tone: 'mint' as const, line: '울타리대출 심사 결과를 함께 확인하고 카드 대금 상환 계획을 다시 점검했다.' },
  { no: '4회차', date: '2026년 9월 8일', kind: '기본상담', tone: 'mint' as const, line: '카드 대금 연체 우려를 확인하고 울타리대출 신청을 진행하기로 했다.' },
  { no: '3회차', date: '2026년 9월 4일', kind: '기본상담', tone: 'mint' as const, line: '월 지출 구조를 함께 정리하고 상환용 통장 분리를 시도하기로 했다.' },
  { no: '2회차', date: '2026년 8월 28일', kind: '기본상담', tone: 'mint' as const, line: '대출 목적과 상환 계획을 세부 목표로 합의했다.' },
  { no: '1회차', date: '2026년 8월 21일', kind: '인테이크', tone: 'lavender' as const, line: '인테이크 질문지 작성 회차' },
];

function Panel({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="marker-panel">
      <h3 className="marker-panel-title">{label}</h3>
      <p className="marker-note">{note}</p>
      <div className="marker-frame">{children}</div>
    </div>
  );
}

const body = (
  <>
    <PageTitle>값 앞 표시는 컬러 텍스트로</PageTitle>
    <WireCard title="규칙이 한 줄로 줄어든다">
      <p className="marker-note">배지는 자기가 수식하는 값 뒤에만 붙고, 값보다 먼저 읽혀야 하는 분류와 출처 표시는 배지를 쓰지 않고 계열 deep 14/600 컬러 텍스트로 쓴다. 아래는 실제 화면의 두 자리를 같은 값으로 비교한 것이다.</p>
    </WireCard>

    <WireCard title="회차별 정리 · 상담 유형이 핵심 한 줄 앞에 온다">
      <p className="marker-note">유형은 회차를 고르기 전에 먼저 읽는 분류다. 지금은 알약이 문장 앞을 막아 눈이 두 번 멈춘다.</p>
      <div className="marker-pair">
        <Panel label="지금 (배지)" note="알약 면이 문장 시작선을 밀고, 면 위 흰 글자는 라이트에서 대비 2.00이다.">
          <div className="marker-list">
            {SESSIONS.map((s) => (
              <div className="marker-row" key={s.no}>
                <span className="marker-meta">{s.date}</span>
                <WireBadge tone={s.tone}>{s.kind}</WireBadge>
                <span className="marker-text">{s.line}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel label="제안 (컬러 텍스트)" note="면이 없어 문장이 바로 이어지고, 유형은 계열색 14/600으로 먼저 읽힌다.">
          <div className="marker-list">
            {SESSIONS.map((s) => (
              <div className="marker-row" key={s.no}>
                <span className="marker-meta">{s.date}</span>
                <span className="marker-kind" data-tone={s.tone}>{s.kind}</span>
                <span className="marker-text">{s.line}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </WireCard>

    <WireCard title="AI·STT·연결 · 상태가 모델 이름 앞에 온다">
      <p className="marker-note">상태를 먼저 훑고 값을 읽는 자리다. 컬러 텍스트로 두면 상태 낱말과 값이 같은 글자 높이로 이어진다.</p>
      <div className="marker-pair">
        <Panel label="지금 (배지)" note="면과 테두리가 한 겹 더 쌓여 상태와 값의 글자 높이가 다르게 읽힌다.">
          <div className="marker-list">
            {STATES.map((s) => (
              <div className="marker-row" key={s.value}>
                <WireBadge tone={s.tone}>{s.status}</WireBadge>
                <span className="marker-value">{s.value}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel label="제안 (컬러 텍스트)" note="상태와 값이 같은 글자 높이로 이어진다. 값 시작선 편차는 두 안이 비슷하다(배지 36px, 글자 43px) — 줄을 맞추려면 고정 열이 따로 필요하다.">
          <div className="marker-list">
            {STATES.map((s) => (
              <div className="marker-row" key={s.value}>
                <span className="marker-kind" data-tone={s.tone}>{s.status}</span>
                <span className="marker-value">{s.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </WireCard>

    <WireCard title="확인 1 · 시간 축 배지(오늘·기한)를 예외로 둘지">
      <p className="marker-note">시간 축 배지는 TimeAxisBadge 전용 어휘다. 왼쪽은 지금이고 오른쪽은 이 안을 시간 축까지 밀어붙인 모습이다.</p>
      <div className="marker-pair">
        <Panel label="예외 유지 (권장)" note="주간 날짜 줄의 오늘, 액션 행의 기한이 채움 배지로 남는다. 날짜가 배지 안에 들어 있어 라벨과 값이 한 덩어리다.">
          <div className="marker-list">
            <div className="marker-row">
              <span className="marker-value">9월 15일 월요일</span>
              <WireBadge tone="blue">오늘</WireBadge>
              <span className="marker-meta">2건</span>
            </div>
            <div className="marker-row">
              <span className="marker-text">카드 대금 연체액과 잔액 정리</span>
              <WireBadge tone="mint">담당 당사자</WireBadge>
              <WireBadge tone="blue">기한 2026년 9월 17일</WireBadge>
            </div>
          </div>
        </Panel>
        <Panel label="시간 축까지 전환" note="채움 면이 사라져 오늘과 기한이 주변 메타 글자와 같은 무게로 읽힌다. 시간 축 신호를 색 하나에만 기대게 된다.">
          <div className="marker-list">
            <div className="marker-row">
              <span className="marker-value">9월 15일 월요일</span>
              <span className="marker-kind" data-tone="blue">오늘</span>
              <span className="marker-meta">2건</span>
            </div>
            <div className="marker-row">
              <span className="marker-text">카드 대금 연체액과 잔액 정리</span>
              <span className="marker-kind" data-tone="mint">담당 당사자</span>
              <span className="marker-kind" data-tone="blue">기한 2026년 9월 17일</span>
            </div>
          </div>
        </Panel>
      </div>
    </WireCard>

    <WireCard title="확인 2 · D47 상담 유형을 컬러 텍스트로 바꾸면">
      <p className="marker-note">계열 의미는 그대로다. 기본 상담은 민트, 인테이크는 라벤더이고 면만 없어진다. 아래는 회차 목록 다섯 줄을 같은 값으로 비교한 것이다.</p>
      <div className="marker-pair">
        <Panel label="지금 (D47 배지)" note="알약 다섯 개가 세로로 이어져 목록이 색 띠로 읽힌다.">
          <div className="marker-list">
            {RECORD_ROWS.map((row) => (
              <div className="marker-row" key={row.no}>
                <span className="marker-meta">{row.no}</span>
                <span className="marker-meta">{row.date}</span>
                <WireBadge tone={row.tone}>{row.kind}</WireBadge>
                <span className="marker-text">{row.line}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel label="제안 (컬러 텍스트)" note="유형이 날짜와 문장 사이에서 낱말로 읽히고, 문장 시작선이 앞당겨진다.">
          <div className="marker-list">
            {RECORD_ROWS.map((row) => (
              <div className="marker-row" key={row.no}>
                <span className="marker-meta">{row.no}</span>
                <span className="marker-meta">{row.date}</span>
                <span className="marker-kind" data-tone={row.tone}>{row.kind}</span>
                <span className="marker-text">{row.line}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </WireCard>

    <WireCard title="라이트 테마 대비 실측 (패널 흰 면 기준)">
      <div className="marker-list">
        <p className="marker-note">라벤더 deep 글자 <strong>6.11</strong>, 블루 deep <strong>5.61</strong>, 라임 deep <strong>4.72</strong>는 AA 4.5를 넘는다. 민트 deep 글자는 <strong>1.9</strong>로 미달이지만 지금 배지의 민트 면 위 흰 글자 <strong>2.00</strong>과 같은 수준이고, 둘 다 이미 §9가 받은 예외다. 고대비 모드에서는 글자 <strong>5.26</strong>, 배지 <strong>5.71</strong>로 함께 올라간다.</p>
        <p className="marker-note">다크 테마에서는 컬러 텍스트가 더 유리하다. 민트 deep <strong>11.0</strong>, 라벤더 deep <strong>9.7</strong>, 블루 deep <strong>11.0</strong>이다.</p>
      </div>
    </WireCard>
  </>
);

const demoCss = `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{margin:0;font-family:'Pretendard Variable',sans-serif;background:var(--canvas)}
.marker-page{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--section-gap);max-width:1440px;margin:0 auto;padding:var(--space-8) var(--space-8) var(--space-10)}
.marker-note{margin:0;color:var(--sub);font-size:var(--text-detail);font-weight:400;line-height:var(--leading-relaxed)}
.marker-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-6);margin-top:var(--space-5)}
.marker-panel{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-2);min-width:0}
.marker-panel-title{margin:0;color:var(--ink);font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug)}
.marker-frame{min-width:0;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel)}
.marker-list{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-4)}
.marker-row{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.marker-meta{flex:none;color:var(--sub);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal)}
.marker-kind{flex:none;font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal)}
.marker-kind[data-tone="mint"]{color:var(--mint-deep)}
.marker-kind[data-tone="lavender"]{color:var(--lavender-deep)}
.marker-kind[data-tone="blue"]{color:var(--blue-deep)}
.marker-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal)}
.marker-value{min-width:0;color:var(--ink);font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal)}
@media(min-width:768px){.marker-pair{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

writeFileSync(new URL('marker.html', import.meta.url), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>값 앞 표시 비교</title><style>${composeSharedCss(wireStyles)}\n${demoCss}</style></head><body><main class="marker-page">${renderToStaticMarkup(body)}</main></body></html>`);
console.log('width-contract/marker.html generated from current shared CSS.');
