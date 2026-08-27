import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerPath = resolve(repoRoot, "docs/design-unification/axis-approvals.md");
const ledgerDirectory = dirname(ledgerPath);
const ledger = readFileSync(ledgerPath, "utf8");
const expectedAxes = ["버튼", "배지", "카드 경계", "타이포", "간격"];
const expectedMeasurements = [
  ["light", 1280],
  ["light", 767],
  ["light", 390],
  ["dark", 1280],
  ["dark", 767],
  ["dark", 390],
];

function markdownLinks(value) {
  return [...value.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}


function approvalRows() {
  const section = ledger.match(/## 축별 승인과 동결\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, "축별 승인과 동결 section is missing");

  return section[1]
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

test("승인 대장은 다섯 축의 Q 승인과 동결 근거를 실제 파일 및 Git 객체로 고정한다", () => {
  const rows = approvalRows();
  assert.deepEqual(rows.map(([axis]) => axis), expectedAxes);

  for (const [axis, status, approval, adrCell, screenshotCell, commitCell] of rows) {
    assert.equal(status, "`frozen`", `${axis}: status must be frozen`);
    assert.match(approval, /Q/iu, `${axis}: Q approval evidence is missing`);
    assert.match(approval, /2026-\d{2}-\d{2}/u, `${axis}: approval date is missing`);

    const adrLinks = markdownLinks(adrCell);
    assert.ok(adrLinks.length > 0, `${axis}: ADR link is missing`);
    for (const link of adrLinks) {
      assert.match(link, /^\.\.\/adr\/\d{4}[-\w]+\.md$/u, `${axis}: malformed ADR link ${link}`);
      const adr = readFileSync(resolve(ledgerDirectory, link), "utf8");
      assert.match(adr, /^# (?:ADR-\d{4}: )?\S/u, `${axis}: linked ADR has no title`);
    }

    const screenshotLinks = markdownLinks(screenshotCell);
    assert.ok(screenshotLinks.some((link) => /\/light-/u.test(link)), `${axis}: light screenshot is missing`);
    assert.ok(screenshotLinks.some((link) => /\/dark-/u.test(link)), `${axis}: dark screenshot is missing`);
    for (const link of screenshotLinks) {
      assert.match(
        link,
        /^\.\.\/\.\.\/artifacts\/design-unification\/kit-measurements\/(?:light|dark)-(?:1280|767|390)\.png$/u,
        `${axis}: malformed measurement link ${link}`,
      );
    }

    const commit = commitCell.match(/`([0-9a-f]{40})`/u)?.[1];
    assert.ok(commit, `${axis}: full freeze commit SHA is missing`);
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repoRoot });
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: repoRoot });
  }
});

test("실측 조합은 두 테마와 세 폭의 재생성 경로를 모두 기록한다", () => {
  for (const [theme, width] of expectedMeasurements) {
    const relativePath = `../../artifacts/design-unification/kit-measurements/${theme}-${width}.png`;
    assert.ok(ledger.includes(`(${relativePath})`), `${theme}-${width} measurement is missing`);
  }
});

