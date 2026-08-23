#!/usr/bin/env node
// 대비 실측 — design/tokens.css 의 토큰 짝을 WCAG 2.x 공식으로 잰다.
//
// 왜 스크립트인가: DESIGN.md §9 '알려진 접근성 예외'는 **실측한 숫자**를 적기로 한 표인데,
// 그 숫자를 사람이 손으로 계산해 왔다. 손계산은 틀려도 아무도 모르고, 색이 바뀌면 표만
// 낡는다. 다크 팔레트를 새로 만들면서 짝이 두 배가 되므로 여기서 기계로 옮긴다.
//
// 실행: node scripts/design/contrast.mjs        (표만 출력)
//       node scripts/design/contrast.mjs --check (기대값 이탈 시 종료 코드 1)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(repoRoot, 'design/tokens.css'), 'utf8');

// 블록별로 토큰을 읽는다: :root(라이트) / :root[data-theme="dark"](다크).
function readBlock(selector) {
  // 선택자 뒤 첫 { 부터 짝이 맞는 } 까지. 이 파일은 :root 블록 안에 중첩 블록이 없다.
  const at = src.indexOf(selector);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  const close = src.indexOf('\n}', open);
  const body = src.slice(open, close);
  const map = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const light = readBlock(':root {');
const dark = readBlock(':root[data-theme="dark"]');

const hex = (v) => {
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const lum = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 재는 짝 — DESIGN.md §9 표와 같은 목록이다. [전경, 배경, 설명, 기준]
// 기준: 4.5 = 본문 텍스트 AA · 3 = UI 컴포넌트/굵은 큰 글자(1.4.11)
const PAIRS = [
  ['--ink', '--canvas', '본문 글자 / 캔버스', 4.5],
  ['--ink', '--panel', '본문 글자 / 카드', 4.5],
  ['--sub', '--panel', '보조 글자 / 카드', 4.5],
  ['--blue-deep', '--blue-tint', '블루 deep / 블루 tint', 4.5],
  ['--mint-deep', '--mint-tint', '민트 deep / 민트 tint', 4.5],
  ['--lavender-deep', '--lavender-tint', '라벤더 deep / 라벤더 tint', 4.5],
  ['--risk', '--panel', '리스크 글자 / 패널', 4.5],
  ['--risk', '--risk-tint-solid', '리스크 글자 / 배너 배경', 4.5],
  ['--line-control', '--panel', '입력칸 경계 / 카드', 3, true],
  ['--track', '--panel', '추이 막대 / 카드', 3, true],
  ['--ink', '--blue-tint', '칩 글자 / 블루 tint (D47 계열 칩)', 4.5],
  ['--ink', '--mint-tint', '칩 글자 / 민트 tint (D47 계열 칩)', 4.5],
  ['--on-badge', '--badge-blue', '배지 글자 / 블루 면', 4.5, true],
  ['--on-badge', '--badge-mint', '배지 글자 / 민트 면', 4.5, true],
  ['--on-badge', '--badge-lavender', '배지 글자 / 라벤더 면', 4.5, true],
  ['--on-badge', '--badge-coral', '배지 글자 / 코랄 면', 4.5, true],
  ['--on-badge', '--badge-amber', '배지 글자 / 앰버 면', 4.5, true],
  ['--on-badge', '--badge-lime', '배지 글자 / 라임 면', 4.5, true],
  ['--on-badge', '--badge-cyan', '배지 글자 / 시안 면', 4.5, true],
  ['--on-badge', '--risk', '배지 글자 / 리스크 면', 4.5],
  // 채운 면 위 글자 — 그라데이션 양끝을 각각 잰다(가장 나쁜 쪽이 기준이다).
  ['--on-action', '--gradient-action@start', '버튼·체크박스 글자 / 채움 시작', 4.5],
  ['--on-action', '--gradient-action@end', '버튼·체크박스 글자 / 채움 끝', 4.5],
];

function resolve(map, name) {
  if (name.endsWith('@start') || name.endsWith('@end')) {
    const base = name.split('@')[0];
    const v = map.get(base);
    if (!v) return null;
    const all = [...v.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => hex('#' + m[1]));
    if (all.length < 2) return null;
    return name.endsWith('@start') ? all[0] : all[all.length - 1];
  }
  const v = map.get(name);
  return v ? hex(v) : null;
}

let failures = 0;
for (const [theme, map] of [['라이트', light], ['다크', dark]]) {
  if (!map) { console.log(`\n[${theme}] 블록 없음 — 건너뜀`); continue; }
  console.log(`\n[${theme}]`);
  for (const [fg, bg, label, min, acceptedException = false] of PAIRS) {
    // 다크 블록은 덮어쓰기만 담으므로 없는 값은 라이트에서 물려받는다(CSS 캐스케이드와 같다).
    const f = resolve(map, fg) ?? resolve(light, fg);
    const b = resolve(map, bg) ?? resolve(light, bg);
    if (!f || !b) { console.log(`  ?     ${label} — 색을 못 읽음`); continue; }
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok && !acceptedException) failures += 1;
    const verdict = ok ? 'OK  ' : acceptedException ? '예외' : '미달';
    console.log(`  ${verdict} ${r.toFixed(2).padStart(6)} (기준 ${min})  ${label}`);
  }
}

console.log(`\n예상 밖 미달 ${failures}건. 승인된 예외는 DESIGN.md §9 에 기록하고, 표에 없는 미달만 결함으로 센다.`);
if (process.argv.includes('--check') && failures > 0) process.exit(1);
