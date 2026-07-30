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

import { readFileSync } from 'node:fs';
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
const WEIGHTS = ['400', '700'];

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

    // 4) font-weight — 400·700 두 단계뿐(DESIGN.md §2). 토큰 대신 값을 직접 검사한다.
    for (const m of line.matchAll(/font-weight:\s*([0-9]+)/g)) {
      if (!WEIGHTS.includes(m[1])) add(file, n, 'font-weight-step', `font-weight:${m[1]} — 400 과 700 두 단계만 쓴다`);
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
  });
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
