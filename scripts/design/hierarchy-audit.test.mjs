/**
 * 위계 감사 회귀 테스트 — 검사가 **헛돌지 않는지**를 고정한다.
 *
 * 왜 필요한가. 이 감사는 "위반이 없으면 통과"라서, 아무것도 못 잡는 상태와 통과가 화면에서
 * 구별되지 않는다. 실제로 만들면서 두 번 그랬다 — 변형 선택자가 기본형을 오염시켜 없는 위반을
 * 만들었고(65건), 반대로 조상 체인을 엄격히 보다가 있는 위반을 놓쳤다. 그래서 아래 테스트는
 * 전부 **일부러 어긋난 CSS 를 넣고 빨간불이 뜨는지**를 본다. 통과만 확인하는 항목은 두지 않는다.
 *
 * 실행: node scripts/design/hierarchy-audit.test.mjs   (pnpm guard:hierarchy:test)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, compare } from './hierarchy-audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const failures = [];

const check = (name, ok, detail) => {
  if (ok) return;
  failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
};

/** 문자열 CSS 하나를 감사한다. 실제 파일 대신 넣는 통로가 audit(sources) 다. */
const run = (css) => audit([{ file: 'probe.css', css }]);
const combos = (css) => run(css).violations.map((v) => v.combo);
const keys = (css) => run(css).violations.map((v) => v.key);

// ---------------------------------------------------------------------------
// 1. 킷 반례 — 실물 증거. guard:tokens 를 그대로 통과하는 CSS 가 여기서는 걸려야 한다.
// ---------------------------------------------------------------------------

// apps/web/app/kit/page.tsx 의 '고치기 전' 칸이 쓰는 규칙 그대로.
const KIT_COUNTEREXAMPLE = `
.wire-kit-flat>p{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.wire-kit-flat>p.is-reason{font-weight:400;color:var(--sub)}
`;
check(
  '킷 반례의 이유 줄(16/400 --sub)이 잡힌다',
  combos(KIT_COUNTEREXAMPLE).includes('var(--text-md)/400/var(--sub)'),
  `잡힌 조합: ${JSON.stringify(combos(KIT_COUNTEREXAMPLE))}`,
);
check(
  '같은 반례의 제목 줄(16/600 --ink)은 계약 안이라 안 잡힌다',
  !combos(KIT_COUNTEREXAMPLE).includes('var(--text-md)/600/var(--ink)'),
);

// ---------------------------------------------------------------------------
// 2. 병합 — 한 축만 덮어쓰는 규칙이 만드는 조합을 봐야 한다(이게 이 감사의 존재 이유다).
// ---------------------------------------------------------------------------

check(
  '색만 덮어쓴 규칙이 만드는 조합을 잡는다',
  combos(`
    .a{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
    .a.b{color:var(--ink)}
  `).includes('var(--text-sm)/600/var(--ink)'),
);

check(
  '조상 체인이 붙은 덮어쓰기도 기본 클래스에서 물려받는다',
  combos(`
    .title{font-size:var(--text-md);font-weight:600;color:var(--ink)}
    .hub>.title{color:var(--sub)}
  `).includes('var(--text-md)/600/var(--sub)'),
);

// 변형은 기본형에서 물려받되 거꾸로 주지 않는다. 그래서 아래에서 걸려야 하는 것은
// `.row[data-selected="true"]` 하나뿐이고 기본형 `.row` 는 나오면 안 된다.
const variantKeys = keys(`
  .row{font-size:var(--text-md);font-weight:600;color:var(--ink)}
  .row[data-selected="true"]{color:var(--lavender-deep)}
`);
check(
  '변형의 선언은 기본형을 오염시키지 않는다',
  !variantKeys.some((k) => k.startsWith('.row =')),
  `잡힌 키: ${JSON.stringify(variantKeys)}`,
);
check(
  '변형 자신은 자기 이름으로 잡힌다',
  variantKeys.some((k) => k.startsWith('.row[data-selected="true"] =')),
  `잡힌 키: ${JSON.stringify(variantKeys)}`,
);

check(
  '조상 체인이 다르면 남의 선언을 물려받지 않는다',
  run(`
    .card>h3{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
    .record>h3{font-size:var(--text-md);font-weight:600;color:var(--ink)}
  `).violations.length === 0,
);

// ---------------------------------------------------------------------------
// 3. 계약 — 역할표 밖 조합만 걸리고, 표 안은 안 걸린다.
// ---------------------------------------------------------------------------

const decl = (size, weight, color) => `.probe{font-size:var(${size});font-weight:${weight};color:var(${color})}`;

for (const [size, weight, color] of [
  ['--text-md', '600', '--ink'],
  ['--text-md', '400', '--ink'],
  ['--text-sm', '600', '--sub'],
  ['--text-sm', '600', '--mint-deep'],
  ['--text-sm', '400', '--sub'],
  ['--text-2xl', '600', '--ink'],
]) {
  check(
    `계약 안 조합 ${size}/${weight}/${color} 은 안 잡힌다`,
    run(decl(size, weight, color)).violations.length === 0,
  );
}

for (const [size, weight, color] of [
  ['--text-md', '400', '--sub'], // 위계 4단 밖 — 실제로 15초 페이지 AI 제안 이유가 이랬다
  ['--text-sm', '600', '--ink'], // 라벨은 --sub 또는 계열 deep 이다
  ['--text-md', '600', '--sub'],
  ['--text-md', '400', '--lavender-deep'],
  ['--text-lg', '400', '--ink'], // 섹션 제목은 600 이다
]) {
  check(
    `계약 밖 조합 ${size}/${weight}/${color} 은 잡힌다`,
    run(decl(size, weight, color)).violations.length === 1,
  );
}

// --- 컨트롤 표 (2026-08-10 CCC-84) -----------------------------------------
// 이 네 단언이 함께 있어야 의미가 있다. 컨트롤에 칸을 더하되 **본문 라벨 규율은 그대로**
// 남는지를 보는 것이라, 셋째 단언이 빠지면 그냥 표를 헐겁게 만든 것과 구별되지 않는다.

const CONTROL = '.probe{font-size:var(--text-sm);font-weight:600;color:var(--ink);cursor:pointer}';
check('컨트롤의 14/600 --ink 는 안 잡힌다', run(CONTROL).violations.length === 0);
check(
  '컨트롤이 아니면 같은 조합이 잡힌다 (라벨 드리프트는 계속 막힌다)',
  run(decl('--text-sm', '600', '--ink')).violations.length === 1,
);
check(
  '컨트롤 표는 본문 표를 대신하지 않고 더한다',
  run('.probe{font-size:var(--text-sm);font-weight:600;color:var(--sub);cursor:pointer}').violations.length === 0,
);
check(
  'cursor 가 pointer 가 아니면 컨트롤이 아니다',
  run('.probe{font-size:var(--text-sm);font-weight:600;color:var(--ink);cursor:default}').violations.length === 1,
);

// --- 값이 비면 물러서는 상태 -------------------------------------------------

check(
  '값이 빈 자리는 --sub 로 물러설 수 있다',
  run('.goal{font-size:var(--text-md);font-weight:600;color:var(--ink)}\n.goal.is-empty{font-weight:400;color:var(--sub)}')
    .violations.length === 0,
);
check(
  'is-empty 가 아니면 같은 조합이 잡힌다',
  run('.goal{font-size:var(--text-md);font-weight:600;color:var(--ink)}\n.goal.is-filled{font-weight:400;color:var(--sub)}')
    .violations.length === 1,
);

check(
  '채운 면 위 글자(--on-action)는 크기·굵기가 계약 안이면 안 잡힌다',
  run(decl('--text-md', '600', '--on-action')).violations.length === 0,
);
check(
  '채운 면 위 글자여도 크기·굵기 짝이 표 밖이면 잡힌다',
  run(decl('--text-lg', '400', '--on-action')).violations.length === 1,
);
check(
  // 15/600 은 핵심 버튼 전용이라 컨트롤 표에만 있다. cursor 를 빼면 크기·굵기 짝부터 표 밖이다.
  '비활성은 색만 물러서므로 안 잡힌다',
  run('.probe{font-size:var(--text-btn);font-weight:600;color:var(--ink);cursor:pointer}\n.probe:disabled{color:var(--sub)}')
    .violations.length === 0,
);

// ---------------------------------------------------------------------------
// 4. 판정 대상 — 글자가 아닌 것과 세 축 미확정은 위반으로 세지 않는다.
// ---------------------------------------------------------------------------

check(
  '아이콘(svg)은 글자가 아니라 판정하지 않는다',
  run('.nav svg{font-size:var(--text-md);font-weight:400;color:var(--blue-deep)}').violations.length === 0,
);
check(
  'color:inherit 은 조합을 만들지 않는다',
  run('.probe{font-size:var(--text-md);font-weight:400;color:inherit}').violations.length === 0,
);

const partial = run('.probe{font-size:var(--text-lg)}');
check('축이 비면 위반이 아니다', partial.violations.length === 0);
check('축이 비면 미확정 목록에 오른다', partial.unresolved.length === 1);
check(
  '미확정 항목은 어느 축이 비었는지 남긴다',
  partial.unresolved[0]?.missing.join(',') === 'font-weight,color',
  `실제: ${JSON.stringify(partial.unresolved[0]?.missing)}`,
);

// ---------------------------------------------------------------------------
// 5. 래칫 — 두 방향으로 실패해야 한다.
// ---------------------------------------------------------------------------

const sample = [{ key: 'a' }, { key: 'b' }];
check('기준선에 없는 새 위반은 실패로 센다', compare(sample, ['a']).fresh.length === 1);
check('기준선에만 있고 안 나오는 항목도 실패로 센다', compare(sample, ['a', 'b', 'c']).stale.length === 1);
check('기준선과 같으면 둘 다 0 이다', (() => {
  const r = compare(sample, ['a', 'b']);
  return r.fresh.length === 0 && r.stale.length === 0;
})());

// ---------------------------------------------------------------------------
// 6. 기준선 파일 — 실제 레포와 맞는지. 여기가 어긋나면 CI 가 처음 도는 순간 빨개진다.
// ---------------------------------------------------------------------------

const baseline = JSON.parse(readFileSync(join(repoRoot, 'scripts/design/hierarchy-baseline.json'), 'utf8'));
const live = audit();
const diff = compare(live.violations, baseline.entries);
check(
  '기준선이 지금 레포와 맞는다',
  diff.fresh.length === 0 && diff.stale.length === 0,
  `새 위반 ${diff.fresh.length}건, 낡은 항목 ${diff.stale.length}건`,
);
check(
  '기준선이 비어 있지 않다',
  baseline.entries.length > 0,
  '기준선이 0건이면 감사가 아무것도 못 보고 있다는 뜻일 수 있다',
);

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error(`위계 감사 테스트 실패 ${failures.length}건:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('위계 감사 테스트 통과');
