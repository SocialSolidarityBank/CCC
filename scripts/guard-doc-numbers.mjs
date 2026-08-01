/**
 * 문서 일련번호 중복 가드.
 *
 * ADR 파일·마이그레이션 파일·9장 결정 번호는 사람이 손으로 붙이는 순차 번호다. 브랜치를
 * 딴 시점에 각자 "다음 번호"를 계산하므로, 두 브랜치가 같은 번호를 집는 일이 구조적으로
 * 생긴다. **그리고 git 은 그것을 못 잡는다** — 파일 이름이 완전히 같지 않으면(`0025-a.md`
 * vs `0025-b.md`) 자동 병합이 "새 파일 둘"로 보고 조용히 통과시키고, 표의 행도 서로 다른
 * 줄이면 충돌이 나지 않는다.
 *
 * 실제로 두 번 일어났다: migrations/0009 두 건(적용 완료라 이름을 되돌릴 수 없어 예외로
 * 둔다)과 2026-08-01 의 ADR-0025 · D55(머지 전에 사람이 눈으로 잡아 0027 · D57 로 옮겼다).
 * 사람 눈에 기대는 대신 여기서 결정론으로 막는다.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

/**
 * 이미 중복인 채로 적용이 끝나 되돌릴 수 없는 번호. wrangler 는 마이그레이션 파일명 전체를
 * identity 로 쓰고 두 파일 모두 운영에 적용됐다(docs/ops.md '마이그레이션 파일 번호').
 * 새 중복을 눈감아 주는 자리가 아니라, 과거 한 건을 못 박아 두는 자리다.
 */
const KNOWN_DUPLICATES = new Set(['migrations/0009']);

/** `0025-openai-provider.md` → `0025`. 번호로 시작하지 않는 파일은 검사 대상이 아니다. */
function leadingNumber(fileName) {
  const match = /^(\d{4})[-_]/.exec(fileName);
  return match === null ? null : match[1];
}

async function numberedFiles(directory, extension) {
  let entries;
  try {
    entries = await readdir(resolve(root, directory), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => ({ number: leadingNumber(entry.name), label: `${directory}/${entry.name}` }))
    .filter((entry) => entry.number !== null);
}

/**
 * CLAUDE.md 9장의 결정 표에서 `| D55 | …` 행의 번호를 모은다. 본문·각주의 D 언급은 세지
 * 않는다 — 표 행만이 결정의 정의 자리다.
 */
async function decisionNumbers() {
  const content = await readFile(resolve(root, 'CLAUDE.md'), 'utf8');
  const numbers = [];
  for (const [index, line] of content.split('\n').entries()) {
    const match = /^\|\s*D(\d+)\s*\|/.exec(line);
    if (match !== null) numbers.push({ number: match[1], label: `CLAUDE.md:${index + 1} (D${match[1]})` });
  }
  return numbers;
}

/** 같은 번호를 둘 이상이 쓰고 있으면 그 목록을 돌려준다. */
function duplicates(entries, scope) {
  const byNumber = new Map();
  for (const entry of entries) {
    const existing = byNumber.get(entry.number);
    if (existing === undefined) byNumber.set(entry.number, [entry.label]);
    else existing.push(entry.label);
  }

  const found = [];
  for (const [number, labels] of byNumber) {
    if (labels.length < 2) continue;
    if (KNOWN_DUPLICATES.has(`${scope}/${number}`)) continue;
    found.push(`${scope} ${number} 번을 ${labels.length}개가 쓴다: ${labels.join(' · ')}`);
  }
  return found;
}

const violations = [
  ...duplicates(await numberedFiles('docs/adr', '.md'), 'docs/adr'),
  ...duplicates(await numberedFiles('migrations', '.sql'), 'migrations'),
  ...duplicates(await decisionNumbers(), 'CLAUDE.md 9장 D'),
];

if (violations.length > 0) {
  console.error('문서 번호 가드 실패 — 같은 번호를 둘이 쓰고 있다:');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  console.error('  머지 순서가 뒤인 쪽이 다음 빈 번호로 옮긴다. 파일명뿐 아니라 참조도 함께 고칠 것:');
  console.error('    command grep -rn "ADR-0025\\|D55" --include=*.md --include=*.ts .');
  process.exitCode = 1;
} else {
  console.log('문서 번호 가드 통과 (ADR · 마이그레이션 · 결정 번호).');
}
