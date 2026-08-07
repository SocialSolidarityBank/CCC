#!/usr/bin/env node
// 디자인 토큰 감사 — design/tokens.css 를 기준으로 앱 CSS 를 검사한다.
//
// 왜 스크립트인가: DESIGN.md 는 확률적 참고이고 이 검사는 결정론적이다. 2026-07-31 감사에서
// 실제로 잡힌 것들이 근거다 — var(--blue-base) 는 **정의되지 않은 토큰**이었고(날짜 선택기의
// 선택일이 면 없이 렌더됐다), 계단 밖 글자 크기 12·13px 이 네 곳에 새어 있었으며(그중 둘은
// DESIGN.md §9 가 금지한 'deep 색 14px 미만'), z-index 리터럴이 하나 남아 있었다.
// 문서만으로는 이 넷 다 다음 세션에서 다시 생긴다.
//
// 검사 대상은 **앱 CSS 뿐**이다. artifacts/ 는 지나간 시안 증거라 계약을 소급 적용하지 않는다.
//
// 실행: node scripts/design/token-audit.mjs   (pnpm guard:tokens)
// 종료 코드: 위반 0 이면 0, 있으면 1.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS = join(repoRoot, 'design/tokens.css');
const TARGETS = [
  join(repoRoot, 'apps/web/app/layout.tsx'),
  join(repoRoot, 'apps/web/app/components/wire/wire-styles.ts'),
];

// 이 감사에서 허용하는 계단. tokens.css 와 어긋나면 아래 assertScale 이 먼저 잡는다.
const TEXT_STEPS = ['--text-2xl', '--text-xl', '--text-lg', '--text-md', '--text-sm'];
// 2026-08-03 Q: 700 이 작은 화면에서 뭉개져 한 단계 내림(400·600).
// 2026-08-04 Q: 사이드바 기본 굵기로 500 신설 — 강조(활성·선택·기관명)만 600, 본문 400 유지.
const WEIGHTS = ['400', '500', '600'];

const tokensSrc = readFileSync(TOKENS, 'utf8');
// :root 및 그 변형(:root[data-contrast="high"])에서 선언된 이름을 모은다.
const defined = new Set([...tokensSrc.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

const findings = [];
const add = (file, line, rule, detail) =>
  findings.push({ file: relative(repoRoot, file), line, rule, detail });

// CSS 주석을 지운 사본에서 검사한다 — 주석 안의 예시 값이 위반으로 잡히면 안 되고,
// /* optical: ... */ 로 사유를 적어 둔 줄은 그 사유가 곧 면제 근거다.
// 주석은 같은 줄 수만큼 개행으로 바꿔 줄 번호를 보존한다.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// /* optical: ... */ 주석이 **바로 앞 줄들**에 붙은 규칙은 간격 검사에서 면제한다.
const opticalLines = (src) => {
  const exempt = new Set();
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!/\/\*\s*optical:/.test(line)) return;
    // 주석이 끝나는 줄을 찾고, 그 다음 줄(규칙)을 면제 대상으로 잡는다.
    let j = i;
    while (j < lines.length && !lines[j].includes('*/')) j += 1;
    exempt.add(j + 2); // 1-indexed 다음 줄
  });
  return exempt;
};

for (const file of TARGETS) {
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const exempt = opticalLines(raw);
  const lines = src.split('\n');

  lines.forEach((line, idx) => {
    const n = idx + 1;

    // 1) 정의되지 않은 토큰 참조. --surface-fill 은 .surface-card 가 규칙 안에서 만드는
    //    지역 변수라 tokens.css 에 없는 것이 정상이다.
    for (const m of line.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = m[1];
      if (name === '--surface-fill') continue;
      // .wire-button 이 규칙 안에서 만드는 지역 변수(CCC-51) — 그라데이션 테두리 2겹의
      // 채움을 호버가 background 대신 이 변수로 바꾼다(--surface-fill 과 같은 패턴).
      if (name === '--button-fill') continue;
      // .page-backbar 가 규칙 안에서 만드는 지역 변수(2026-08-04) — 컨테이너 상한(1120/960)을
      // 담아, 가로선 전폭 상태의 좌우 패딩 계산과 narrow 분기가 한 값을 본다.
      if (name === '--backbar-max') continue;
      if (name.startsWith('--rdp-')) continue; // react-day-picker 라이브러리 소유
      if (!defined.has(name)) add(file, n, 'undefined-token', `${name} 는 design/tokens.css 에 없다`);
    }

    // 2) z-index 리터럴 — 겹침은 4층뿐이고 층 이름으로만 쓴다(DESIGN.md §4-5).
    for (const m of line.matchAll(/z-index:\s*(-?[0-9]+)/g)) {
      add(file, n, 'raw-z-index', `z-index:${m[1]} — var(--z-sticky|--z-dropdown|--z-modal) 를 쓴다`);
    }

    // 3) font-size 리터럴 — 크기 계단은 닫혀 있다(DESIGN.md §2).
    for (const m of line.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      add(file, n, 'raw-font-size', `font-size:${m[1]}px — 계단은 ${TEXT_STEPS.join(' · ')} 다섯뿐이다`);
    }

    // 4) font-weight — 400·600 두 단계뿐(DESIGN.md §2, 2026-08-03 개정). 토큰 대신 값을 직접 검사한다.
    for (const m of line.matchAll(/font-weight:\s*([0-9]+)/g)) {
      if (!WEIGHTS.includes(m[1])) add(file, n, 'font-weight-step', `font-weight:${m[1]} — 400 과 600 두 단계만 쓴다`);
    }

    // 5) 간격 리터럴 — /* optical: */ 로 사유를 적지 않은 px 는 위반.
    if (!exempt.has(n)) {
      for (const m of line.matchAll(/(?:^|[;{\s])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?:\s*([^;}]+)/g)) {
        const value = m[2];
        if (!/[0-9]px/.test(value)) continue;
        // calc(var(--space-N) * -1) 처럼 토큰만으로 된 식은 통과.
        if (!/[0-9]+px/.test(value.replace(/var\(--[a-z0-9-]+\)/g, ''))) continue;
        add(file, n, 'raw-spacing', `${m[1]}: ${value.trim()} — var(--space-*) 를 쓰거나 앞줄에 /* optical: 사유 */ 를 단다`);
      }
    }

    // 6) border-radius 리터럴 — 형태 토큰 5종 밖의 값 금지(0 은 해제라 허용).
    for (const m of line.matchAll(/border-radius:\s*([^;}]+)/g)) {
      const value = m[1].trim();
      if (value === '0') continue;
      if (/[0-9]+px|%/.test(value.replace(/var\(--[a-z0-9-]+\)/g, ''))) {
        add(file, n, 'raw-radius', `border-radius: ${value} — var(--radius-*) 를 쓴다`);
      }
    }

    // 7) 원시 hex 색. 유일한 예외는 체크박스 체크 표시의 data URI 다 — data URI 안에는
    //    var() 를 쓸 수 없다(DESIGN.md §5 체크박스 계약이 명시한 자리).
    if (!/data:image\/svg\+xml/.test(line)) {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        add(file, n, 'raw-hex', `${m[0]} — 색은 design/tokens.css 의 이름으로만 쓴다`);
      }
    }

    // 8) 알약(pill) 반경 허용목록 (2026-08-07 버튼 직사각화). 버튼·조작 요소는 radius 6 이고
    //    pill 은 읽기 전용 배지·상태 태그(2026-08-06 알약 재개정)·원형 아이콘 버튼·라디오·불릿 점만 갖는다. 새 알약 레시피가
    //    화면 CSS 에 스며드는 것을 막는다.
    if (line.includes('var(--radius-pill)')) {
      // consent-detail-summary: 전문 보기 배지형 버튼(2026-08-07 Q 9차 — 배지 레시피를 빌린 조작).
      const PILL_ALLOWED = ['wire-badge', 'navigation-soon', 'header-icon-button', 'wire-radio', 'wire-bullets', 'wire-status-tag', 'consent-detail-summary'];
      if (!PILL_ALLOWED.some((name) => line.includes(name))) {
        add(file, n, 'pill-outside-badge', `--radius-pill 은 배지(.wire-badge)·원형 아이콘(.header-icon-button)·라디오·불릿만 쓴다. 버튼은 var(--radius-control)`);
      }
    }
  });
}

// ── 죽은 클래스 검사 ──────────────────────────────────────────────────────────
// 2026-07-31 감사에서 CSS 클래스 351개 중 **68개(19%)** 가 마크업에 한 곳도 없었다. 전부
// 대체된 결정의 잔여물이다 — 구 케이스 목록 표(D35 IA 개편) · 클릭 복호화 PII 패널(D22 를
// D24·D31 이 대체) · GAS 게이지(D43 보류) · 구 일정 화면(D54 가 month-* 로 재구축) 등.
// 무해한 죽은 코드가 아니다: 같은 계약이 두 벌 있으면 어느 쪽을 고칠지가 매번 판단거리가 되고,
// 실제로 .button 4종이 그렇게 살아 있었다.
//
// 허용목록은 "아직 안 쓰지만 DESIGN.md 가 계약으로 적어 둔 부품"이다. 여기 넣는 것은
// 결정이고, 넣지 않은 채 남기는 것이 결함이다.
const UNUSED_BUT_CONTRACTED = new Set([
  'card-grid-dense',     // §4-2 조밀 그리드(GAS 가 D43 으로 보류되며 사용처가 비었다)
  'wire-scrim',          // §5 모달 — 검토·승인 화면 미구현
  'is-selected-surface', // §5 '선택·활성 표면'을 details 가 아닌 곳에서 수동으로 켜는 훅
  'wire-card-section',   // §5 카드 안 하위 구획
  'wire-col-3', 'wire-col-12', // 12칼럼 세트(4·6·8 은 사용 중)
  // §6 모션 3종(D58/ADR-0028): 어휘 정의는 CCC-50, 배선은 CCC-51·CCC-53 몫
  'motion-flow',
  'motion-press',
  'motion-rise',
]);

const markupFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) markupFiles.push(p);
  }
})(join(repoRoot, 'apps/web/app'));

const declaredClasses = new Map();
for (const file of TARGETS) {
  const raw = readFileSync(file, 'utf8');
  // CSS 는 템플릿 리터럴(역따옴표 문자열) 안에만 있다 — 바깥 JS 에서 경로의 .css·.ts 가 잡힌다.
  for (const lit of raw.matchAll(/`([\s\S]*?)`/g)) {
    const css = lit[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/url\("[^"]*"\)/g, ' ');
    if (!/\{[^}]*:/.test(css)) continue; // 규칙이 없으면 CSS 리터럴이 아니다
    for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)(?=[\s,{:[>.]|$)/gm)) {
      const name = m[1];
      if (name.startsWith('rdp-')) continue; // react-day-picker 가 생성하는 이름
      if (!declaredClasses.has(name)) declaredClasses.set(name, { file, line: 0 });
    }
  }
  // 줄 번호는 첫 등장 기준으로 따로 채운다(위 루프는 리터럴 단위라 줄을 모른다).
  raw.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)(?=[\s,{:[>.]|$)/g)) {
      const rec = declaredClasses.get(m[1]);
      if (rec && rec.file === file && rec.line === 0) rec.line = i + 1;
    }
  });
}

const usedTokens = new Set();
for (const file of markupFiles) {
  let src = readFileSync(file, 'utf8');
  if (TARGETS.includes(file)) src = src.replace(/`[\s\S]*?`/g, ' '); // CSS 자기 자신은 사용처가 아니다
  for (const m of src.matchAll(/["'`]([^"'`\n]{0,300})["'`]/g)) {
    for (const t of m[1].split(/[\s{}$]+/)) if (t) usedTokens.add(t);
  }
}

for (const [name, rec] of declaredClasses) {
  if (usedTokens.has(name) || UNUSED_BUT_CONTRACTED.has(name)) continue;
  add(rec.file, rec.line, 'dead-class', `.${name} 를 쓰는 마크업이 없다 — 지우거나, 계약이면 token-audit 의 UNUSED_BUT_CONTRACTED 에 사유와 함께 넣는다`);
}

// ── UI 문안 부호 검사 ─────────────────────────────────────────────────────────
// DESIGN.md §10: 화면 문자열에 긴 대시(—)를 쓰지 않고, 서로 다른 정보를 잇는 구분자
// 가운뎃점(' · ')을 쓰지 않는다(한 낱말 병렬 '주거·생계'는 공백이 없어 잡히지 않는다).
// 주석은 검사 대상이 아니다 — 코드 주석 소급 수정은 §10 개정이 명시적으로 제외했다.
// 테스트 파일도 제외한다: describe/it 설명문은 화면에 나가지 않는다.
const stripJsComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // 라인 주석. URL 의 :// 를 지우지 않도록 앞 글자를 본다.
    .replace(/(^|[^:"'`])\/\/[^\n]*/gm, (_, pre) => pre);

for (const file of markupFiles) {
  if (/\.test\.tsx?$/.test(file)) continue;
  const src = stripJsComments(readFileSync(file, 'utf8'));
  src.split('\n').forEach((line, idx) => {
    if (line.includes('—')) {
      add(file, idx + 1, 'prose-em-dash', `긴 대시(—)는 화면 문자열에 쓰지 않는다(§10) — 마침표나 쉼표로 나눈다`);
    }
    if (line.includes(' · ')) {
      add(file, idx + 1, 'prose-separator-dot', `구분자 가운뎃점(' · ') 금지(§10) — 조각을 나눠 MetaRow 간격으로 띄운다`);
    }
  });
}

// ── 다크 대응 검사 ────────────────────────────────────────────────────────────
// 다크 블록(:root[data-theme="dark"])은 **덮어쓰기만** 담으므로, 라이트에서 원시 색값
// (hex·rgba·그라데이션)으로 선언된 토큰을 빠뜨리면 그 자리만 라이트로 남는다. 눈으로는
// 잘 안 잡힌다 — 예컨대 --gradient-hover 를 빠뜨리면 어두운 화면의 행 호버만 밝게 켜진다.
// var() 조합으로 만든 토큰(--shadow-soft)은 재료가 바뀌면 따라오므로 대상이 아니다.
const THEME_INVARIANT = new Set([
  '--on-action',      // 채운 면이 두 테마에서 같으므로 그 위 글자도 같다(tokens.css 다크 절 ③)
  '--line-on-action', // 같은 이유 — 밝은 파스텔 면 위 아웃라인
  '--blue', '--mint', '--lavender', // base 는 면이라 어두운 배경 위에서 그대로 선다
  '--gradient-action',              // 위 ③
  '--gradient-brand', '--gradient-brand-v', // 파스텔 자체라 두 테마에서 모두 선다
  '--gradient-frame', '--gradient-frame-v', // 같은 이유 — 프레임 구분선의 base 3색 (2026-08-05)
]);

const lightBlock = (() => {
  const open = tokensSrc.indexOf('{', tokensSrc.indexOf(':root {'));
  return tokensSrc.slice(open, tokensSrc.indexOf('\n}', open));
})();
const darkStart = tokensSrc.indexOf(':root[data-theme="dark"]');
const darkBlock = darkStart < 0 ? '' : (() => {
  const open = tokensSrc.indexOf('{', darkStart);
  return tokensSrc.slice(open, tokensSrc.indexOf('\n}', open));
})();

if (darkBlock) {
  const darkNames = new Set([...darkBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const m of lightBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m;
    // 원시 색값만 대상: hex 또는 rgba/hsla 리터럴. var() 로만 조합된 값은 자동으로 따라온다.
    const raw = value.replace(/var\(--[a-z0-9-]+\)/g, '');
    if (!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(raw)) continue;
    if (THEME_INVARIANT.has(name) || darkNames.has(name)) continue;
    add(TOKENS, 0, 'dark-parity', `${name} 는 원시 색값인데 다크 블록에 대응이 없다 — 다크에서 라이트 값이 그대로 남는다. 의도라면 token-audit 의 THEME_INVARIANT 에 사유와 함께 넣는다`);
  }
}

// 계단 자체가 tokens.css 에 살아 있는지 확인한다 — 위 검사들이 "토큰을 쓰라"고 말하는데
// 그 토큰이 지워져 있으면 검사가 통과하면서도 화면은 깨진다.
for (const step of TEXT_STEPS) {
  if (!defined.has(step)) add(TOKENS, 0, 'missing-scale', `${step} 이 design/tokens.css 에 없다`);
}

if (findings.length === 0) {
  console.log('token-audit: 위반 0');
  process.exit(0);
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
console.error(`token-audit: 위반 ${findings.length}건\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.detail}`);
console.error('\n요약: ' + [...byRule].map(([r, c]) => `${r}=${c}`).join(' · '));
process.exit(1);
