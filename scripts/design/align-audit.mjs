#!/usr/bin/env node
// 세로 중앙 정렬 감사 — 기하 정렬 계약(2026-08-06 Q)을 결정론으로 강제한다.
//
// 왜 스크립트인가: "뱃지·알약 옆 글자가 가운데에 안 앉는" 결함이 화면마다 반복됐고(2026-08-06
// Q "가운데 정렬이 안 돼서 계속 수정"), 원인은 매번 같았다 — 단일행 컨트롤이 기하 정렬
// (flex 상하 center + line-height:normal)을 빠뜨리고 상속 행간(1.55)을 그대로 받아, 글꼴
// 상자가 뱃지 글자보다 약 0.9px 위에 앉는다(브리핑 회차 행 실측). 문서(§5)만으로는 다음
// 세션에서 다시 생기므로 token-audit 과 같은 결정론 게이트로 닫는다.
//
// 계약 두 조각:
//  A. 알약·뱃지·컨트롤(반경 pill/control + 높이 badge/pill/control 토큰)은
//     (align-items:center 또는 place-items:center) 와 line-height:normal 을 함께 선언한다.
//     세로 중앙은 광학 보정이 아니라 기하가 만든다.
//  B. 세로 손보정(translateY px 리터럴) 금지. 허용 세 가지 — ① :active 눌림(§6 모션),
//     ② rotate 와 결합한 꺽쇠 잉크 보정, ③ var(--nudge-hangul) 토큰. 그 밖은 앞줄에
//     /* optical: 실측 사유 */ 를 달아야 통과한다(token-audit 간격 검사와 같은 면제 계약).
//
// 실행: node scripts/design/align-audit.mjs   (pnpm guard:align)
// 종료 코드: 위반 0 이면 0, 있으면 1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGETS = [
  join(repoRoot, 'apps/web/app/layout.tsx'),
  join(repoRoot, 'apps/web/app/components/wire/wire-styles.ts'),
];

// 검사에서 면제하는 선택자. 넣는 것은 결정이다 — 사유 없이 넣지 않는다.
const EXEMPT_SELECTORS = new Set([
  // 행간 1.55 + translateY(1px) 의 실측 보정 체계(2026-08-04 canvas TextMetrics, layout.tsx
  // 주석)가 이미 잉크 중심을 맞춘다. 기하 계약으로 바꾸려면 그 보정을 함께 재실측해야 한다.
  '.navigation-link',
  // 조각 묶음 껍데기다 — 조각(.month-nav-seg)이 stretch 로 전 높이를 채워 세로 구분선을
  // 만들고, 세로 중앙은 각 조각의 기하 정렬이 만든다.
  '.month-nav-group',
  // 레거시 .field: 단일행 두 컨트롤(input·select)은 바로 아랫줄 별도 블록이 normal 을 갖고,
  // textarea 는 다중행이라 일부러 제외한다(layout.tsx 주석) — 선택자가 갈라져 합산이 안 된다.
  '.field input,.field select,.field textarea',
]);

const findings = [];
const add = (file, line, rule, detail) =>
  findings.push({ file: relative(repoRoot, file), line, rule, detail });

// 주석은 위치를 보존한 채 공백으로 지운다(token-audit 과 같은 방식 — 줄 번호 유지).
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// /* optical: ... */ 가 바로 앞 줄들에 붙은 규칙은 면제한다(token-audit 과 같은 계약).
const opticalLines = (src) => {
  const exempt = new Set();
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!/\/\*\s*optical:/.test(line)) return;
    let j = i;
    while (j < lines.length && !lines[j].includes('*/')) j += 1;
    exempt.add(j + 2); // 1-indexed 다음 줄
  });
  return exempt;
};

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const HEIGHT_TOKENS = /(?:min-)?height:\s*var\(--(?:badge-height|pill-height|control-height)\)/;
const PILL_RADIUS = /border-radius:\s*var\(--radius-(?:pill|control)\)/;
const CENTERED = /(?:align-items|place-items):\s*center/;
const LINE_NORMAL = /line-height:\s*normal/;

for (const file of TARGETS) {
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const exempt = opticalLines(raw);

  // ── A. 단일행 컨트롤의 기하 정렬 ──
  // 중첩(@media 등)과 무관하게 최안쪽 규칙 블록만 잡되, 같은 선택자의 여러 블록(기본 +
  // 상태 변형)은 **합산해서** 판정한다 — 기본 블록이 이미 center 를 갖고 변형 블록이 높이만
  // 더하는 정상 패턴을 위반으로 잡지 않기 위해서다.
  const bySelector = new Map();
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().split('\n').pop().trim();
    if (selector.startsWith('@')) continue;
    const rec = bySelector.get(selector) ?? { decls: '', line: lineOf(src, m.index) };
    rec.decls += ';' + m[2];
    bySelector.set(selector, rec);
  }
  for (const [selector, rec] of bySelector) {
    if (EXEMPT_SELECTORS.has(selector)) continue;
    if (!HEIGHT_TOKENS.test(rec.decls) || !PILL_RADIUS.test(rec.decls)) continue;
    // 정렬 속성은 flex·grid 컨테이너에만 뜻이 있다 — input·button 같은 대체 요소는
    // 브라우저가 세로를 맞추므로 line-height 만 계약 대상이다.
    const isFlexOrGrid = /display:\s*(?:inline-)?(?:flex|grid)/.test(rec.decls);
    if (isFlexOrGrid && !CENTERED.test(rec.decls)) {
      add(file, rec.line, 'center-contract', `${selector} — 높이 토큰 + pill/control 반경의 flex/grid 인데 align-items:center(또는 place-items)가 없다. 세로 중앙은 기하 정렬이 만든다(§5)`);
    }
    if (!LINE_NORMAL.test(rec.decls)) {
      add(file, rec.line, 'center-contract', `${selector} — 단일행 컨트롤인데 line-height:normal 이 없다. 상속 행간(1.55)은 글꼴 상자를 중앙에서 밀어낸다(2026-08-06 실측 0.9px)`);
    }
  }

  // ── B. 세로 손보정 금지 ──
  src.split('\n').forEach((line, idx) => {
    const n = idx + 1;
    if (exempt.has(n)) return;
    for (const m of line.matchAll(/translateY\(((?:[^()]|\([^()]*\))*)\)/g)) {
      const value = m[1].trim();
      if (value === 'var(--nudge-hangul)') continue;      // ③ 승인된 토큰
      if (/:active/.test(line)) continue;                  // ① 눌림 모션(§6)
      if (/rotate\(/.test(line)) continue;                 // ② 꺽쇠 잉크 보정
      add(file, n, 'manual-vertical-nudge', `translateY(${value}) — 세로 위치를 손으로 밀지 않는다. 기하 정렬로 풀거나, 실측 근거가 있으면 앞줄에 /* optical: 사유 */ 를 단다`);
    }
  });
}

if (findings.length === 0) {
  console.log('align-audit: 위반 0');
  process.exit(0);
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
console.error(`align-audit: 위반 ${findings.length}건\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.detail}`);
console.error('\n요약: ' + [...byRule].map(([r, c]) => `${r}=${c}`).join(' · '));
process.exit(1);
