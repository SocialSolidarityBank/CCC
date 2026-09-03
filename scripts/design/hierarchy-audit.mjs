#!/usr/bin/env node
// 위계 감사 — 앱 CSS 가 만드는 **조합**(크기+굵기+색)이 DESIGN.md §2-1 역할표 안에 있는지 본다.
//
// guard:tokens 와 무엇이 다른가. token-audit 은 **값**을 한 축씩 본다 — 계단 밖 크기,
// 미선언 굵기, 토큰 밖 색. 그래서 세 축이 전부 합법 토큰이면 통과한다. 하지만 화면이
// 눌리는 원인은 값이 아니라 조합이다: 16/400 `--sub` 는 세 값이 다 합법인데 역할표에 없는
// 조합이고, 그 자리가 15초 페이지 AI 제안의 '이유' 줄이었다(wire-section.tsx 주석 참조).
//
//
// 이 감사가 보는 것과 못 보는 것:
//   본다   — 한 요소에 최종적으로 적히는 (크기, 굵기, 색) 조합이 역할표 밖인가
//   못 본다 — 이웃한 두 줄이 같은 옷인가(§2-2 규칙 1). 그건 DOM 순서를 알아야 하므로
//            하니스 실측(hierarchy-measure.mjs)이 맡는다
//
// 병합이 핵심이다. 앱 CSS 405+ 규칙 중 세 축을 다 적은 것은 절반이 안 되고, 나머지는 한두
// 축만 적고 물려받는다. 규칙 하나씩 보면 `color:var(--sub)` 한 줄짜리 덮어쓰기가 어떤 조합을
// 만드는지 알 수 없다. 그래서 같은 요소를 겨냥한 규칙들을 모아 최종 조합을 세운다.
//
// 실행: node scripts/design/hierarchy-audit.mjs   (pnpm guard:hierarchy)
//      node scripts/design/hierarchy-audit.mjs --update-baseline  (기준선 갱신)
// 종료 코드: 기준선에 없는 새 위반이 있으면 1, 기준선이 낡았으면 1, 아니면 0.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(repoRoot, 'scripts/design/hierarchy-baseline.json');
// guard:tokens 와 같은 대상이다 — 앱 CSS 는 이 둘뿐이다.
const TARGETS = [
  join(repoRoot, 'apps/web/app/layout.tsx'),
  join(repoRoot, 'apps/web/app/components/wire/wire-styles.ts'),
];

// ---------------------------------------------------------------------------
// 1. 계약 — DESIGN.md §2-1 역할표. 이 표 밖의 크기-역할 조합은 위반이다(표 자체가 계약).
// ---------------------------------------------------------------------------

// 전역 기본. body 는 크기만 적고 굵기를 안 적으므로 400 이 기본이고, :root 가 색을 --ink 로 둔다.
const ROOT = { size: 'var(--text-md)', weight: '400', color: 'var(--ink)' };

// 계열 deep 3종. 일반 라벨·아이콘의 색 축은 이 집합에서만 온다(§2-1 · D34).
const SERIES_DEEP = ['var(--mint-deep)', 'var(--lavender-deep)', 'var(--blue-deep)'];

// 채운 면 위 글자(D60 ④). 선택·반전·프라이머리처럼 면이 채워진 자리는 글자색이 면을 따라가고,
// 그때 위계를 지키는 축은 크기와 굵기다. 그래서 색 축은 자리마다 열거하지 않고 한 번에 둔다.
const ON_SURFACE = ['var(--on-action)', 'var(--on-badge)', 'var(--panel)', 'var(--canvas)'];
// 색만 물러서는 상태. 크기·굵기가 계약 안이면 조합으로 세지 않는다.
const DIMMED = ['var(--sub)', 'var(--muted)'];
const isDisabled = (variants) => variants.some((v) => /disabled/.test(v));
// 값이 아직 없는 자리(2026-08-10 CCC-84). '설정 전' 처럼 값이 비면 같은 크기에서 굵기와 색만
// 물러선다. 목표 카드 세 곳이 똑같이 이렇게 하고 있어 상태 규칙으로 세운다. 비활성과 같은 자리다.
const isEmptyState = (entry) => /(^|[.\s])is-empty($|[^-\w])/.test(entry.raw);
// 공식 AI 한 줄이 없는 수기 폴백과 닫힌 목표도 값 자체의 역할은 유지한 채 색만 물러선다.
// 둘 다 문구·상태를 함께 표시하므로 색만으로 상태를 전달하지 않는다.
const isSubduedState = (entry) => /(^|[.\s])(is-memo|is-closed)($|[^-\w])/.test(entry.raw);

// (크기, 굵기) → 허용 색 집합. 역할표의 각 행을 그대로 옮긴 것이라 행마다 근거를 적는다.
const ROLES = [
  // HERO 실명 · 페이지 제목
  { size: 'var(--text-2xl)', weight: '600', colors: ['var(--ink)'], role: 'HERO 실명·페이지 제목' },
  // 767 미만 페이지 제목 · GAS 점수
  { size: 'var(--text-xl)', weight: '600', colors: ['var(--ink)'], role: '좁은 화면 제목·GAS 점수' },
  // 섹션 제목(카드 여러 장을 묶는 h2) · 셸 기관명
  { size: 'var(--text-lg)', weight: '600', colors: ['var(--ink)'], role: '섹션 제목·기관명' },
  // 카드 제목 · 행 강조. --risk 는 리스크 배너 제목·항목 자리다(D9 · §5)
  { size: 'var(--text-md)', weight: '600', colors: ['var(--ink)', 'var(--risk)'], role: '카드 제목·행 강조' },
  // 셸 기본(사이드바·헤더). 비활성 내비는 --sub, 활성은 --ink
  { size: 'var(--text-md)', weight: '500', colors: ['var(--ink)', 'var(--sub)'], role: '셸 기본' },
  // 본문
  { size: 'var(--text-md)', weight: '400', colors: ['var(--ink)'], role: '본문' },
  // 라벨(구획 라벨·입력칸 라벨). 색은 --sub 또는 계열 deep
  { size: 'var(--text-sm)', weight: '600', colors: ['var(--sub)', ...SERIES_DEEP, 'var(--discrepancy)', 'var(--risk)'], role: '라벨' },
  // 일정 기간 값 — 2026-08-25 Q. 일정 기간 이름 한 자리 전용(§2-1 역할표 같은 행).
  { size: 'var(--text-sm)', weight: '500', colors: ['var(--ink)'], role: '일정 기간 값' },
  // 공통 입력값 — 2026-08-25 Q. input·select·textarea 공통.
  { size: 'var(--text-sm)', weight: '400', colors: ['var(--ink)'], role: '입력값' },
  // 메타·설명·도움말
  { size: 'var(--text-sm)', weight: '400', colors: ['var(--sub)'], role: '메타·설명' },
  // 배지·칩. 2026-08-06 Q 로 400 이고, 색은 계열 deep 이 원칙이되 무채색 배지가 있다
  { size: 'var(--text-sm)', weight: '400', colors: [...SERIES_DEEP, 'var(--risk)', 'var(--ink)'], role: '배지·칩' },
  // 입력칸 도움말 — 2026-09-04 Q. 13/400 회색. 크기 토큰 자체는 SCOPED_TEXT_TOKENS 가
  // .wire-form-hint 로 묶어 두므로 이 행이 13px 을 다른 자리로 퍼뜨리지 않는다.
  { size: 'var(--text-detail)', weight: '400', colors: ['var(--sub)'], role: '입력칸 도움말' },
  ];

/**
 * 컨트롤 표 (2026-08-10 CCC-84 신설). 누르는 것은 본문 위계표가 아니라 이 표를 쓴다.
 *
 * 왜 표를 가르나. 컨트롤은 자기 면과 테두리를 가지므로 §2-2 규칙 1 의 '한 축'을 이미
 * 만족한다 — 하니스도 같은 이유로 자기 면을 가진 요소를 이웃 판정에서 뺀다. 그런데 정적
 * 검사는 본문 표 하나로 재고 있었고, 그래서 작은 버튼·단계 버튼·눌린 시간 슬롯·비선택 탭이
 * 전부 위반으로 나왔다(6곳). 6곳이면 드리프트가 아니라 **표에 칸이 빠진 것**이다.
 *
 * 본문 표에 14/600 `--ink` 를 그냥 더하지 않은 이유가 여기 있다. 그렇게 하면 구획 라벨을
 * `--sub` 대신 `--ink` 로 쓴 것도 함께 합법이 되어, §2-1 이 막으려던 바로 그 드리프트가
 * 열린다. 컨트롤인지는 `cursor:pointer` 를 스스로 선언했는지로 가른다(상속은 안 센다).
 */
const CONTROL_ROLES = [
  // 버튼 전 종류(2026-08-28 Q — 구 --text-btn 15 폐지로 핵심 버튼 행이 이 행에 흡수됐다)
  // ·인테이크 단계 버튼·동의 토글 요약·완료 버튼·눌린 시간 슬롯
  { size: 'var(--text-sm)', weight: '600', colors: ['var(--ink)', ...SERIES_DEEP, 'var(--risk)'], role: '작은 컨트롤' },
  // 이동·보기 조작 알약(neutral·ghost)
  { size: 'var(--text-sm)', weight: '400', colors: ['var(--ink)', 'var(--sub)'], role: '조작 알약' },
  // 탭·목표 표시 버튼처럼 본문 크기로 서는 컨트롤. 선택은 --ink, 비선택은 --sub 로 물러선다
  { size: 'var(--text-md)', weight: '600', colors: ['var(--ink)', 'var(--sub)'], role: '본문 크기 컨트롤' },
  { size: 'var(--text-md)', weight: '400', colors: ['var(--ink)', 'var(--sub)'], role: '본문 크기 컨트롤(물러섬)' },
];

// 좁은 예외. 역할표 밖 조합이지만 결정으로 정당화된 자리만 사유와 함께 남긴다.
// 여기 넣는 기준: 근거가 되는 결정 문서가 있고, 그 자리 하나에만 쓰이는가.
const MIXED_SUB = 'color-mix(in srgb,var(--sub) 80%,var(--panel))';
const BADGE_TONES = ['blue', 'mint', 'lavender', 'coral', 'amber', 'lime', 'cyan', 'light-magenta', 'risk'];
// 라이트마젠타만 전용 전경을 쓴다(2026-08-24 Q 결정). 면은 승인 hex 하나고,
// 그 위 흰 글자는 대비가 모자라 다크 캔버스 중립색을 재사용한 토큰을 따로 둔다.
const badgeForeground = (tone) => (
  tone === 'light-magenta' ? 'var(--on-badge-light-magenta)' : 'var(--on-badge)'
);
const BADGE_ALLOW = BADGE_TONES.flatMap((tone) => [
  {
    selector: `.wire-badge[data-tone="${tone}"]`,
    combo: `var(--text-badge)/400/${badgeForeground(tone)}`,
    why: '13px 색상 배지의 테마 고정 전경색',
  },
  {
    selector: `.wire-badge[data-tone="${tone}"][data-size="sm"]`,
    combo: `var(--text-badge-compact)/400/${badgeForeground(tone)}`,
    why: '12px 컴팩트 색상 배지의 테마 고정 전경색',
  },
]);
const ALLOW = [
  {
    selector: '.wire-badge',
    combo: 'var(--text-badge)/400/var(--ink)',
    why: '배지 면을 본문보다 작게 읽히게 하는 13px 기본 배지',
  },
  {
    // 12px은 짧은 요구 상태와 곁다리 배지에만 쓴다.
    // 다른 필드가 이 토큰을 빌리면 14px 본문 계단을 우회하므로 자리로 한정한다.
    selector: '.wire-badge[data-size="sm"]',
    combo: 'var(--text-badge-compact)/400/var(--ink)',
    why: '짧은 요구 상태와 곁다리 전용 컴팩트 배지',
  },
  ...BADGE_ALLOW,
  {
    selector: '.wire-badge.wire-required-marker',
    combo: 'var(--text-badge)/400/var(--lavender-deep)',
    why: '필수 표식 라벤더 deep 아웃라인의 정적 기본형. 실제 호출은 모두 size="sm"이다',
  },
  {
    selector: '.record-rail-goal-body',
    combo: 'var(--text-sm)/600/var(--ink)',
    why: '상담 기록 레일에서 세부 목표보다 먼저 읽히는 세션 목표 본문',
  },
  {
    selector: '.record-open-action-body',
    combo: 'var(--text-sm)/600/var(--ink)',
    why: '상담 기록 레일에서 출처 날짜보다 먼저 읽히는 미해결 액션 본문',
  },
  {
    selector: '.record-rail-subgoal',
    combo: 'var(--text-detail)/400/var(--lime-deep)',
    why: '상담 기록 레일의 세부 목표 줄 전용 13px lime',
  },
  {
    selector: '.record-rail-subgoal-label',
    combo: 'var(--text-detail)/600/var(--lime-deep)',
    why: '상담 기록 레일의 세부 목표 라벨 전용 13px lime',
  },
  {
    selector: '.record-rail-subgoal-text',
    combo: 'var(--text-detail)/400/var(--lime-deep)',
    why: '상담 기록 레일의 세부 목표 본문 전용 13px lime',
  },
  {
    selector: '.record-open-action-meta',
    combo: 'var(--text-detail)/400/var(--lime-deep)',
    why: '미해결 액션의 지난 상담 날짜 전용 13px lime',
  },
  {
    selector: '.record-rail-number',
    combo: 'var(--text-lg)/600/var(--sub)',
    why: '레일 순서가 보이도록 키운 Enclosed Alphanumerics 원문자',
  },
  {
    // D59/2026-08-06 Q: 가명 ID 는 당사자 카드 정보 칸에서만 이름 옆에 선다.
    selector: '.participant-card-cell',
    combo: `var(--text-md)/400/${MIXED_SUB}`,
    why: 'D59 부분 재개정 — 당사자 카드 정보 칸의 가명 ID',
  },
  // 아래 둘은 2026-08-10 Q 결정(CCC-84). `16/400 --sub` 는 **조합으로는 열 수 없다**.
  // 그래서 자리를 지정해 예외로 둔다.
  {
    selector: '.participant-card-cell[data-tone="sub"]',
    combo: 'var(--text-md)/400/var(--sub)',
    why: '당사자 카드 정보 칸의 보조 톤 — 이름 17 옆에 서는 같은 줄의 칸이다',
  },
  {
    // 짝인 `.register-program-fixed-label` 은 14/600 민트 deep 으로 계약 안이다. 그 옆의
    // **값**이라 라벨보다 물러설 수 없어 --ink 로 선다. 라벨 규율을 통째로 여는 대신 자리로 연다.
    selector: '.register-program-fixed-value',
    combo: 'var(--text-sm)/600/var(--ink)',
    why: '민트 알약 안의 값 — 짝인 라벨이 계열 deep 이라 값은 --ink 다',
  },
  {
    // 2026-09-04 Q "'액션 아이템' 텍스트는 컬러 + 볼드 처리하고 왼쪽 정렬 맞추고 16px로".
    // 카드 제목과 같은 16/600 이되 카드가 아니라 폼 안 묶음 제목이라 계열 색으로 갈린다.
    // 조합으로 열면 카드 제목이 전부 색을 입을 수 있어 자리로 연다.
    selector: '.wire-fieldset>legend',
    combo: 'var(--text-md)/600/var(--mint-deep)',
    why: '폼 안 묶음(fieldset) 제목 — 카드 제목과 크기를 맞추고 계열 색으로 갈린다',
  },
];

// 킷 페이지 반례(`.wire-kit-flat>p.is-reason`)는 **여기 넣지 않는다.** 한 번 넣었다가 되돌렸다.
// ALLOW 에 넣으면 위반 목록에서 아예 사라지는데, 그 자리의 값은 "일부러 어긋나게 둔 시범
// 자료"인 동시에 "이 검사가 실제로 잡는다는 증거"다. 증거가 사라지면 검사가 무엇을 보는지
// 아무도 확인할 수 없다. 그래서 기준선에 남긴다 — 잡히되 실패로 세지 않는 자리다.

// ---------------------------------------------------------------------------
// 2. CSS 추출 — 두 파일 다 CSS 를 템플릿 리터럴에 담고 있고 보간이 없다.
// ---------------------------------------------------------------------------

/**
 * 파일에서 백틱 템플릿 리터럴 본문만 모은다. 줄 번호는 파일 기준으로 보존한다.
 *
 * 하니스 생성기도 이 함수를 쓴다(apps/web 의 hierarchy-harness.test.tsx). 추출기를 두 벌 두면
 * 검사와 하니스가 서로 다른 CSS 를 보게 되고, 그러면 둘의 결과를 맞대 볼 수 없다.
 */
export function extractCss(file) {
  const src = readFileSync(file, 'utf8');
  if (src.includes('${')) {
    throw new Error(`${relative(repoRoot, file)} 에 템플릿 보간이 생겼다 — 추출 방식을 다시 봐야 한다`);
  }
  // 리터럴 밖은 같은 줄 수의 공백으로 바꿔 줄 번호를 유지한다.
  let out = '';
  let inLiteral = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '`') {
      inLiteral = !inLiteral;
      out += ' ';
      continue;
    }
    if (inLiteral) out += ch;
    else out += ch === '\n' ? '\n' : ' ';
  }
  return out;
}

/**
 * layout.tsx가 실제로 <style>에 싣는 순서로 CSS를 조립한다.
 *
 * extractCss 뒤에 wireStyles를 덧붙이면 registerStyles보다 wireStyles가 늦게 적용되어 실제
 * RootLayout과 캐스케이드가 뒤집힌다. 2026-09-01 등록 동의 전문 상자의 위 패딩 결함을 그
 * 거짓 순서가 숨겼다. 아래 배열은 layout.tsx의 shellStyles 식과 같은 순서다.
 */
export function composeRuntimeCss(file, injectedWireStyles) {
  const src = readFileSync(file, 'utf8');
  const quote = String.fromCharCode(96);
  const order = [
    'styles',
    'participantStyles',
    'briefingStyles',
    'settingsStyles',
    'scheduleStyles',
    'wireStyles',
    'registerStyles',
    'recordFormStyles',
  ];
  const shellMarker = 'const shellStyles = ';
  const shellStart = src.indexOf(shellMarker);
  const shellEnd = shellStart < 0 ? -1 : src.indexOf(';', shellStart + shellMarker.length);
  if (shellStart < 0 || shellEnd < 0) throw new Error(`${relative(repoRoot, file)} 에 shellStyles 식이 없다`);
  const actualOrder = src.slice(shellStart + shellMarker.length, shellEnd)
    .match(/\b(?:styles|[A-Za-z]\w*Styles)\b/g) ?? [];
  if (actualOrder.join('|') !== order.join('|')) {
    throw new Error(`${relative(repoRoot, file)} 의 shellStyles 순서가 바뀌었다: composeRuntimeCss를 함께 갱신해야 한다`);
  }
  const take = (name) => {
    if (name === 'wireStyles') return injectedWireStyles;
    const marker = `const ${name} = ${quote}`;
    const start = src.indexOf(marker);
    if (start < 0) throw new Error(`${relative(repoRoot, file)} 에 ${name} CSS 묶음이 없다`);
    const bodyStart = start + marker.length;
    const end = src.indexOf(quote, bodyStart);
    if (end < 0) throw new Error(`${relative(repoRoot, file)} 의 ${name} CSS 묶음이 닫히지 않았다`);
    const body = src.slice(bodyStart, end);
    if (body.includes('${')) throw new Error(`${relative(repoRoot, file)} 의 ${name} CSS 묶음에 보간이 생겼다`);
    return body;
  };
  return order.map(take).join('\n');
}

/** CSS 주석 제거. 줄 번호 보존을 위해 개행만 남긴다. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * 규칙 파싱. @media 안 규칙은 media 문자열을 달고 나온다.
 * 중첩 at-rule 은 이 레포에 없지만 스택으로 다뤄 둔다.
 */
function parseRules(css) {
  const rules = [];
  const atStack = [];
  let head = '';
  let line = 1;
  let headLine = 1;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '\n') {
      line += 1;
      head += ch;
      continue;
    }
    if (ch === '{') {
      const sel = head.trim();
      head = '';
      if (sel.startsWith('@')) {
        atStack.push(sel);
        headLine = line;
        continue;
      }
      // 선언 블록 — 닫는 괄호까지 통째로 읽는다.
      let depth = 1;
      let body = '';
      i += 1;
      for (; i < css.length; i += 1) {
        const c = css[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        if (c === '\n') line += 1;
        body += c;
      }
      rules.push({
        media: atStack.filter((a) => a.startsWith('@media')).join(' '),
        selector: sel,
        body,
        line: headLine,
      });
      headLine = line;
      continue;
    }
    if (ch === '}') {
      atStack.pop();
      head = '';
      headLine = line;
      continue;
    }
    if (head.trim() === '') headLine = line;
    head += ch;
  }
  return rules;
}

/** 선언 블록에서 property: value 쌍을 뽑는다. 괄호 안 세미콜론은 없지만 깊이를 세어 안전하게 자른다. */
function parseDecls(body) {
  const decls = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) {
      decls.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  decls.push(buf);
  const out = {};
  for (const d of decls) {
    const idx = d.indexOf(':');
    if (idx < 0) continue;
    const prop = d.slice(0, idx).trim().toLowerCase();
    const value = d.slice(idx + 1).trim();
    // cursor 는 조합에 들어가지 않지만 **컨트롤 여부**를 가르는 신호라 함께 모은다.
    if (prop === 'font-size' || prop === 'font-weight' || prop === 'color' || prop === 'cursor') {
      out[prop] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * 변형(속성 선택자·의사 클래스)을 떼어 대상만 남기고, 뗀 변형은 따로 모은다.
 *
 * 변형을 **버리지 않고 모으는** 이유. 처음엔 그냥 지웠더니 `.wire-row[data-selected="true"]`
 * 의 선택 색이 기본형 `.wire-row` 의 조합으로 흘러들어 없는 위반이 생겼다. 변형은 기본형에서
 * 선언을 물려받되(base → variant), 자기 선언을 기본형에 되돌려 주지는 않는다.
 */
function normalize(sel) {
  const variants = [];
  const stripped = sel
    .replace(/::[a-z-]+/g, (m) => {
      variants.push(m);
      return '';
    })
    .replace(/:[a-z-]+\([^)]*\)/g, (m) => {
      variants.push(m);
      return '';
    })
    .replace(/:[a-z-]+/g, (m) => {
      variants.push(m);
      return '';
    })
    .replace(/\[[^\]]*\]/g, (m) => {
      variants.push(m);
      return '';
    })
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { sel: stripped, variants: variants.sort() };
}

/** 정규화된 선택자를 조상 체인과 마지막 compound 로 가른다. */
function split(sel) {
  const parts = sel.split(/(?=[>+~ ])/);
  const last = parts.pop() ?? '';
  const subject = last.replace(/^[>+~ ]/, '');
  return { ancestors: parts.join(''), subject };
}

/** compound 를 토큰 집합으로. `p.is-reason` → ['p', '.is-reason'] */
const compoundSet = (c) => (c.match(/^[a-z][a-z0-9-]*|[.#][A-Za-z0-9_-]+/g) ?? []).sort();

const isSubset = (a, b) => a.every((x) => b.includes(x));

// 글자가 아닌 것. 색은 아이콘 획을 칠하고 크기는 꺽쇠 상자를 잰다 — 타이포 조합이 아니다.
const NON_TEXT_TAGS = ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon'];
// 선택자만 보면 span/button 이지만 실제 마크업에서 글자 없이 아이콘만 담는 자리와,
// 자식 제목이 타이포를 소유하는 표면 컨테이너다. 세 축 조합의 판정 대상이 아니다.
const NON_TEXT_SELECTORS = new Set([
  '.program-switcher-trigger .switcher-updown',
  '.risk-banner-icon',
  '.wire-empty-icon',
  '.wire-date-popover .rdp-button_previous',
  '.wire-date-popover .rdp-button_next',
  '.wire-card-details.is-crisis>.wire-card-summary',
]);
// 전역 p는 한때 여기 면제로 두었지만, 클래스 없는 p가 body 상속과 합쳐져 16/400 --sub
// (§1이 이름 박은 표 밖 조합)로 서는 것을 감사 밖으로 숨겼다(2026-08-27 검수 지적).
// 지금은 layout.tsx의 전역 p가 세 축을 실효값 그대로 선언해 감사 대상이며, 그 조합은
// 기존 부채로 baseline에 있다. 고치는 날 baseline에서 지운다.
const INHERITANCE_FOUNDATIONS = new Set([]);

/** 감사 대상 CSS 를 모은다. 테스트는 파일 대신 문자열을 넣는다. */
function readSources() {
  return TARGETS.map((file) => ({ file: relative(repoRoot, file), css: extractCss(file) }));
}

function collect(sources) {
  const entries = [];
  for (const { file, css: rawCss } of sources) {
    const css = stripComments(rawCss);
    for (const rule of parseRules(css)) {
      const decls = parseDecls(rule.body);
      if (!decls['font-size'] && !decls['font-weight'] && !decls.color) continue;
      for (const rawSel of rule.selector.split(',')) {
        const { sel, variants } = normalize(rawSel);
        if (!sel) continue;
        const { ancestors, subject } = split(sel);
        entries.push({
          file,
          line: rule.line,
          media: rule.media,
          raw: rawSel.trim().replace(/\s+/g, ' '),
          sel,
          variants,
          ancestors,
          subject,
          set: compoundSet(subject),
          decls,
        });
      }
    }
  }
  return entries;
}

/**
 * 다른 규칙 `o` 의 선언이 `e` 가 겨냥한 요소에도 적용되는가.
 *
 * 셋 다 만족해야 한다:
 *   조상 — `o` 의 조상 체인이 비었거나 `e` 의 체인 끝과 같다(`.wire-card-title` → `.hub>.wire-card-title`)
 *   대상 — `o` 의 compound 가 `e` 의 부분집합이다(`p` → `p.is-reason`)
 *   변형 — `o` 의 변형이 `e` 의 부분집합이다(기본형 → 선택 상태, 그 반대는 아니다)
 */
function applies(o, e) {
  if (o.ancestors !== '') {
    // 조상 사이에 상태·래퍼가 하나 더 끼어도 같은 대상 규칙은 적용된다.
    // 예: `.wire-date-popover .rdp-day_button` 은
    // `.wire-date-popover .rdp-outside .rdp-day_button` 에도 적용된다.
    // 문자열 includes 는 `.foo` 와 `.foobar` 를 섞으므로 compound 단위 연속 부분열로 본다.
    const compounds = (ancestors) => ancestors.split(/[>+~ ]+/).filter(Boolean);
    const base = compounds(o.ancestors);
    const target = compounds(e.ancestors);
    const containsBase = target.some((_, start) => (
      base.every((compound, offset) => target[start + offset] === compound)
    ));
    if (!containsBase) return false;
  }
  if (!isSubset(o.set, e.set)) return false;
  if (!isSubset(o.variants, e.variants)) return false;
  // 자기 미디어 분기이거나 기본 분기의 선언만 받는다.
  if (o.media && o.media !== e.media) return false;
  return true;
}

/**
 * 각 항목의 최종 조합을 세우고, **어느 축이 선언으로 채워졌는지**를 함께 남긴다.
 *
 * 선언 여부를 세는 이유. 세 축이 다 선언돼야 조합을 확정할 수 있다. 한 축이라도 비면 그 값은
 * 요소 종류(`h2` 같은)나 조상에서 오는데 그건 CSS 파일에 없고 렌더 결과에 있다. 그런 항목까지
 * 위반으로 세면 `.participant-hero-title`(크기만 적고 굵기는 h2 에서 오는 자리)처럼 멀쩡한 곳이
 * 걸린다. 그래서 미확정 항목은 위반이 아니라 **하니스가 재야 할 목록**으로 따로 낸다.
 */
function resolve(entries) {
  return entries.map((e) => {
    const merged = { ...ROOT };
    const declared = new Set();
    let control = false;
    for (const o of entries) {
      if (!applies(o, e)) continue;
      for (const [prop, value] of Object.entries(o.decls)) {
        if (prop === 'cursor') {
          // 컨트롤 신호. 상속은 안 센다 — 버튼 안 글자까지 컨트롤로 보면 표가 통째로 헐거워진다.
          if (value.trim() === 'pointer') control = true;
          continue;
        }
        merged[prop === 'font-size' ? 'size' : prop === 'font-weight' ? 'weight' : 'color'] = value;
        declared.add(prop);
      }
    }
    return { ...e, resolved: merged, declared: [...declared], control };
  });
}

// ---------------------------------------------------------------------------
// 4. 판정
// ---------------------------------------------------------------------------

const comboKey = (r) => `${r.size}/${r.weight}/${r.color}`;

/**
 * 조합이 계약 안인가.
 *
 * 크기와 굵기의 짝이 역할표에 있는지를 먼저 보고, 그 다음에 색을 본다. 색은 두 경우에 자리마다
 * 열거하지 않는다 — 채운 면 위 글자(D60)와 비활성(색만 물러섬)이다. 둘 다 위계를 지키는 축은
 * 여전히 크기와 굵기이고, 색은 면이나 상태를 따라간다.
 */
function legal(entry) {
  const { resolved, variants, control } = entry;
  // 컨트롤은 본문 표를 **대신하지 않고 더한다**. 갈아치웠더니 원래 합법이던 자리 둘
  // (`.briefing-history>summary`·`.goal-tree-history>summary`, 14/600 `--sub` 라벨 차림의
  // 조용한 토글)이 새 위반으로 나왔다. 컨트롤 표가 하는 일은 칸을 더하는 것이지 빼는 것이 아니다.
  const table = control ? [...ROLES, ...CONTROL_ROLES] : ROLES;
  const step = table.filter((r) => r.size === resolved.size && r.weight === resolved.weight);
  if (step.length === 0) return false;
  if (step.some((r) => r.colors.includes(resolved.color))) return true;
  if (ON_SURFACE.includes(resolved.color)) return true;
  if (isDisabled(variants) && DIMMED.includes(resolved.color)) return true;
  if (isEmptyState(entry) && DIMMED.includes(resolved.color)) return true;
  if (isSubduedState(entry) && DIMMED.includes(resolved.color)) return true;
  return false;
}

function allowed(entry) {
  return ALLOW.some((a) => {
    if (!entry.raw.includes(a.selector)) return false;
    return a.combo === null || a.combo === comboKey(entry.resolved);
  });
}

/** 판정 대상인가. 글자가 아닌 것과 계단 밖 크기는 이 감사의 물음이 아니다. */
function judgeable(e) {
  if (e.set.some((t) => NON_TEXT_TAGS.includes(t))) return false;
  if (NON_TEXT_SELECTORS.has(e.raw) || INHERITANCE_FOUNDATIONS.has(e.raw)) return false;
  // inherit 은 "부모를 따른다"는 선언이고, transparent 는 글자를 지우고 그라데이션을 오려
  // 내는 자리(background-clip)라 둘 다 조합을 만들지 않는다.
  if (Object.values(e.resolved).some((v) => v === 'inherit' || v === 'transparent')) return false;
  // 계단 밖 크기(em·calc)는 guard:tokens 의 물음이다. 여기서 조합으로 다시 세지 않는다.
  if (!/^var\(--text-[a-z0-9-]+\)$/.test(e.resolved.size)) return false;
  return true;
}

export function audit(sources = readSources()) {
  const entries = resolve(collect(sources));
  const violations = [];
  const unresolved = [];
  const seen = new Set();
  const seenUnresolved = new Set();

  for (const e of entries) {
    if (!judgeable(e)) continue;
    if (legal(e) || allowed(e)) continue;

    // 기준선 키는 줄 번호를 쓰지 않는다 — 무관한 편집마다 흔들린다.
    // 변형까지 붙인 **원래 선택자**를 쓴다. 변형을 뗀 이름으로 키를 지었더니
    // `.row` 와 `.row[data-selected]` 가 한 키로 겹쳐, 기준선의 한 줄이 다른 자리의 새 위반을
    // 가려 주는 구멍이 생겼다.
    const key = `${e.raw}${e.media ? ` @${e.media}` : ''} = ${comboKey(e.resolved)}`;
    const record = {
      key,
      file: e.file,
      line: e.line,
      selector: e.raw,
      combo: comboKey(e.resolved),
      missing: ['font-size', 'font-weight', 'color'].filter((p) => !e.declared.includes(p)),
    };

    if (record.missing.length > 0) {
      if (seenUnresolved.has(key)) continue;
      seenUnresolved.add(key);
      unresolved.push(record);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push(record);
  }
  return { violations, unresolved };
}

// ---------------------------------------------------------------------------
// 5. 기준선 래칫 — 새 위반은 막고, 이미 있던 위반은 목록으로만 남긴다(2026-08-10 Q).
// ---------------------------------------------------------------------------

/**
 * 기준선과 대조한다. 두 방향으로 실패한다.
 *   새 위반 — 기준선에 없는 것이 생겼다. 이번 변경이 만든 것이므로 막는다
 *   낡은 기준선 — 기준선에 있는데 더 이상 안 나온다. 고쳤으면 목록에서도 빼야 래칫이 조여진다
 */
export function compare(violations, baselineEntries) {
  const known = new Set(baselineEntries);
  return {
    fresh: violations.filter((v) => !known.has(v.key)),
    stale: [...known].filter((k) => !violations.some((v) => v.key === k)),
  };
}

function main() {
  const { violations, unresolved } = audit();

  if (process.argv.includes('--unresolved')) {
    console.log(`세 축이 다 선언되지 않아 확정할 수 없는 자리 ${unresolved.length}건 (하니스가 잰다):`);
    for (const u of unresolved) {
      console.log(`  ${u.file}:${u.line}  ${u.selector}`);
      console.log(`    추정 ${u.combo}, 안 적힌 축 ${u.missing.join(', ')}`);
    }
    return unresolved.length === 0 ? 0 : 1;
  }

  if (process.argv.includes('--update-baseline')) {
    // 조합별로 묶어 함께 적는다. 낱개 목록만 두면 "14건의 빚"으로 읽히지만, 실제로는 같은
    // 조합이 여러 자리에 반복된 모양이다. 한 조합이 여러 곳에 있으면 그건 드리프트가 아니라
    // 역할표에 빠진 단일 가능성이 크고, 그 판단은 사람이 해야 한다.
    const byCombo = {};
    for (const v of violations) {
      (byCombo[v.combo] ??= []).push(v.selector);
    }
    const payload = {
      note: '위계 감사 기준선. 여기 적힌 위반은 이미 있던 것이라 실패로 세지 않는다. 고치면 이 파일에서도 지운다.',
      generated: 'node scripts/design/hierarchy-audit.mjs --update-baseline',
      byCombo: Object.fromEntries(
        Object.entries(byCombo).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, v.sort()]),
      ),
      entries: violations.map((v) => v.key).sort(),
    };
    writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`기준선 갱신: 위반 ${violations.length}건`);
    return 0;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error(`기준선 파일이 없다: ${relative(repoRoot, BASELINE)}`);
    console.error('처음이라면 node scripts/design/hierarchy-audit.mjs --update-baseline 으로 만든다.');
    return 1;
  }

  const { fresh, stale } = compare(violations, baseline.entries);

  for (const u of unresolved) {
    console.error(`미확정 ${u.file}:${u.line}`);
    console.error(`  ${u.selector}`);
    console.error(`  안 적힌 축 ${u.missing.join(', ')}. 세 축을 명시해 정적 판정을 닫는다`);
  }

  for (const v of fresh) {
    console.error(`위반 ${v.file}:${v.line}`);
    console.error(`  ${v.selector}`);
    console.error(`  조합 ${v.combo} 은 DESIGN.md §2-1 역할표에 없다`);
  }
  if (fresh.length) {
    console.error('\n고치는 길은 셋이다. 역할표 안 조합으로 바꾸거나, 위계 부품(WireCardSection·WireItem)을');
    console.error('쓰거나, 계약을 바꿔야 하는 자리라면 DESIGN.md 를 먼저 고치고 이 표도 함께 고친다.');
  }

  if (stale.length) {
    console.error(`\n기준선이 낡았다. 아래 ${stale.length}건은 더 이상 나오지 않으니 기준선에서도 지운다:`);
    for (const k of stale) console.error(`  ${k}`);
  }

  if (fresh.length === 0 && stale.length === 0 && unresolved.length === 0) {
    console.log(`위계 감사 통과. 새 위반 0건, 기준선에 남은 기존 위반 ${violations.length}건`);
    console.log('세 축 미확정 0건');
    return 0;
  }
  console.error(`\n새 위반 ${fresh.length}건, 낡은 기준선 ${stale.length}건, 미확정 ${unresolved.length}건.`);
  return 1;
}

// 테스트에서 import 할 때는 돌지 않는다.
if (process.argv[1] && process.argv[1].endsWith('hierarchy-audit.mjs')) {
  process.exit(main());
}
