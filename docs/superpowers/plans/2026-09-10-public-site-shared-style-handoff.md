# P9/E2-6 public site and shared CSS source handoff

## Status and ownership

Source pass on `design/beta-public-site`, based on `d35dbaab947fdcd74b5ac341f6a73030eeab9eac`. Main owns integration and frozen-snapshot validation. This is not production deployment evidence, E2-7 retirement, or full P9 completion.

Owned changes: `apps/site`, canonical wire styles/build entry, narrowly required legacy web style consumers, root workspace build/test wiring. Main, acting as integration coordinator, approved the narrow design-guard source-path and kit harness wiring; this was not an additional direct Q decision. No guard algorithm, threshold, assertion or baseline was relaxed. No `apps/client`, STT, API/core, migrations, credentials, infrastructure, deployment or other-worktree source was edited. No MacBook prototypes were copied or added.

D86 was read from ADR-0044. D89 (ADR-0048) was initially absent from this base and was subsequently reviewed read-only at `/tmp/ccc-d89-runtime-contract.txt` for the narrow public-surface correction. The public guidance is consistent with its boundary: Supabase describes institution-owned storage, not hosted Edge execution of the business API; institution creation remains install-owned, with no public signup or fabricated initial-setup success. D89's independent business runtime and install-owned first-administrator invitation do not authorize provider selection, deployment, live invitations or AI/STT activation here. The explicit HTTPS business-client origin remains separate from any API/Auth manifest contract. No copy of D89 is added as a second canon. The P9 frontend acceptance plan remains absent from this base; Main must reconcile that plan before claiming full acceptance. `apps/web/app/globals.css` is absent in this base: the shared rules lived in layout template literals.

## Public surface

- `apps/site/index.html` and `apps/site/welcome.html` use the same React introduction at `/` and `/welcome`.
- Vite is multi-page, not an SPA catch-all. Local smoke returned 200 for `/` and `/welcome`, 404 for `/login` and `/onboarding`.
- The introduction preserves the five-minute opening time, fifteen-second briefing and its three areas. The primary action is `#adoption`, an actual on-page installation/adoption section.
- Institutions are created by installation, not an anonymous signup form. Mode descriptions are design guidance and explicitly do not assert completed installation or deployment verification.
- There are no business DB/Auth/API clients, Next imports, forms, session handling or backend requests in the site implementation.
- `apps/web/app/welcome/page.tsx` remains synchronous and consumes `@ccc/site/pages`. It has no verified business origin, so it shows the honest missing-login-address guidance rather than linking back to the business redirect at `/`.
- `apps/web/app/page.tsx` remains the business account-setting redirect. It was not moved.

### Public login configuration

`apps/site/.env.example` defines the optional, nonsecret, build-time `CCC_BUSINESS_CLIENT_ORIGIN`. Supply only the separately deployed business client's HTTPS origin, without `/login` or any other path. Validation still returns an origin; the staff-login anchor appends `/login`. Main verified that `apps/client/src/app.tsx:264-276` implements business authentication at `/login` while the bare client `/` intentionally remains the STT entry. Neither client route is changed here. No default hostname is invented. Only the configured origin value, not the environment object, enters the public bundle.

Absent/invalid values, non-HTTPS URLs, credentials, paths, queries, fragments and the public site's own origin omit the login link. The page instead tells existing staff to obtain their address from the institution administrator. No fake login endpoint is created.

Historical smoke for `3bb2f6c1`: a local server used `CCC_BUSINESS_CLIENT_ORIGIN=https://work.example.test` (reserved test domain, not a deployment). Its rendered login anchor had exactly that origin; this was the destination defect later identified by Main, not successful staff-login verification. The corrected anchor targets `https://work.example.test/login`. The link was not followed, and the corrected destination remains subject to Main's built-site verification.

Deployment owner must map `/welcome` to the emitted `welcome.html` (or its platform's equivalent extensionless HTML routing) and verify direct navigation. This source pass does not change hosting configuration or deploy anything.

### Hierarchy/composition table

| Line/group | Hierarchy | Component/style |
|---|---|---|
| Relayer name and introduction | Sole h1 + explanation | `PageTitle` inside `preview-gate-head` |
| `15초 페이지` heading | Card title | `WireCard` with semantic h2 |
| Three briefing areas | Peer reading list | `WireBullets` |
| Manual/approved AI distinction | Explanation | `report-description` |
| Adoption action | Primary action | `WireButton` |
| Configured login or unavailable guidance | Navigation + explanation | `WireButton`, `report-description` |
| Installation, storage, AI and preparation | Label + reading text | Four `WireCardSection` groups with automatic dividers |

The earlier claim that all classes already existed was incorrect: `report-description` was documented by DESIGN-RULES §5 and D88 but had no production selector. Main's integration token guard exposed the missing rule. The owner correction adds that canonical reading-description rule once in `packages/wire/src/shell-styles.ts`, immediately after the shared paragraph rule: `font-size:var(--text-detail);font-weight:400;color:var(--sub);line-height:var(--leading-relaxed)`. Tokens and palette values are unchanged; the production CSS now intentionally differs from the move-only transfer receipt below.

## Canonical CSS contract

- Seven layout CSS literals originally moved byte-for-byte to `packages/wire/src/shell-styles.ts` in `3bb2f6c1`; the subsequent missing `report-description` rule is an explicit addition, not part of that unchanged transfer.
- `@ccc/wire/shell-styles` exports the original concatenated `shellStyles` for legacy Next rendering.
- `@ccc/wire/styles` remains the existing `wireStyles` export.
- `@ccc/wire/build/shared-styles` is a Node-only build entry exposing `composeSharedCss`, `repoRoot`, `tokensPath`, `shellStylesPath`. It reads `design/tokens.css` and the canonical package source, reusing `composeRuntimeCss` from the existing hierarchy tool.
- Order is unchanged: base, participant, briefing, settings, schedule, wire, register, record form. The existing extraction/composition algorithm and order assertion are unchanged.
- Site imports a virtual **CSS** module. Vite is configured to emit an external CSS asset rather than a production runtime style-injection module. Production output and CSP still require Main's build verification.
- Legacy business selectors intentionally remain in the shared stylesheet. Removing them is not a safe source-count shortcut and belongs to verified retirement.

Historical move-only transfer receipt for `3bb2f6c1`, before the missing production rule was added and before any CSS minification. These bytes/hash do not describe the corrected stylesheet; Main must obtain current evidence on the integrated snapshot:

```text
composed CSS bytes: 296610
SHA-256: 6b7a8a1fbeac23bb23edca9199a663f1056216bc0bf1dc6ceff55749e9f5defe
raw layout CSS blocks identical: 7
existing component behavioral test files unchanged: 8
```

### Historical move-only composition evidence

The following recipe reproduces the move-only receipt at `3bb2f6c1`, not the current corrected snapshot. Its exact-equality assertion is no longer a valid acceptance check after the intentional `report-description` addition; do not use it to claim unchanged current CSS. It compares the base's original layout with the package composition using the unchanged wire literal, writes only a temporary file outside the repository and removes it.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeRuntimeCss } from './scripts/design/hierarchy-audit.mjs';
import { composeSharedCss } from './packages/wire/build/shared-styles.mjs';
const base = 'd35dbaab947fdcd74b5ac341f6a73030eeab9eac';
const show = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
const wireFile = 'packages/wire/src/wire-styles.ts';
assert.equal(readFileSync(wireFile, 'utf8'), show(wireFile));
const wire = show(wireFile).match(/export const wireStyles = `([\s\S]*?)`;/)[1];
const dir = mkdtempSync(join(tmpdir(), 'ccc-style-transfer-'));
try {
  const oldLayout = join(dir, 'layout.tsx');
  writeFileSync(oldLayout, show('apps/web/app/layout.tsx'));
  const before = show('design/tokens.css') + '\n' + composeRuntimeCss(oldLayout, wire);
  const after = composeSharedCss(wire);
  assert.equal(after, before);
  console.log(Buffer.byteLength(after), createHash('sha256').update(after).digest('hex'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
NODE
```

No CSS baseline regeneration is needed or authorized.

## FRONTEND/Main handoff: NOT APPLIED

**Apply these together with this source commit before validating client independence. The untouched client composer still reads the old layout and will fail after this CSS move until migrated.**

Exact files/edits for the current base:

1. `apps/client/package.json`: replace dependency `@ccc/web: workspace:*` with `@ccc/wire: workspace:*`. Corresponding client lock importer changes from `link:../web` to `link:../../packages/wire`; do not change package versions.
2. `apps/client/vite.config.ts`:
   - `import { wireStyles } from '@ccc/web/wire-styles'` becomes `import { wireStyles } from '@ccc/wire/styles'`.
   - Import `composeSharedCss`, `repoRoot`, `tokensPath`, `shellStylesPath` from `@ccc/wire/build/shared-styles`, not the client-local composer.
   - Change the virtual ID from `virtual:ccc-shared-css` to `virtual:ccc-shared.css`.
   - Keep resolve logic. The load hook must return **`composeSharedCss(wireStyles)` directly**, not `export default ${JSON.stringify(...)}`. Register token/shell/wire source watch inputs as in `apps/site/vite.config.ts`.
   - Do not alter STT proxies, origin checks or fixture behavior.
3. `apps/client/src/main.tsx`: replace the default `sharedCss` import with the side-effect `import 'virtual:ccc-shared.css'`; delete only the `document.createElement('style')`, `style.textContent` and `document.head.append(style)` block. Preserve the mounted client/STT surface.
4. `apps/client/src/vite-env.d.ts` (the virtual declaration owner): change the CSS virtual module declaration to the side-effect module `declare module 'virtual:ccc-shared.css';`.
5. Remove obsolete `apps/client/build/shared-styles.mjs` after the caller migration, rather than retaining a forwarding alias.
6. `apps/client/build/shared-styles.test.mjs`: migrate its import to `@ccc/wire/build/shared-styles` so it no longer loads the removed local composer. Main decides whether these source/plumbing assertions remain useful alongside the byte-equivalence evidence and actual style measurement; do not weaken the design gates.
7. `apps/client/src/stt-trial/stt-trial-page.tsx:15`: existing `@ccc/web/wire` import must become `@ccc/wire`. This is STT-owned: coordinate and apply through that lane; PUBLIC-SITE did not edit it. Do not remove `@ccc/web` from client dependencies before this consumer is migrated.
8. Inspect FRONTEND's integration branch for additional newer `@ccc/web/wire` consumers, using its actual import inventory rather than assuming this older source base contains its business pages.

The package still depends on repository design tokens and the existing composition tool at build time, but no longer requires web layout or globals. Prove this with file-read evidence or a build in a prepared temporary source tree without `apps/web`, not an `@ccc/web` string-count claim alone.

## Verification performed and deferred

Performed locally for source commit `3bb2f6c1ea0c9ff0f5435f4973c426101b0ac95f`, before the naming/PageTitle and login-destination corrections:

- `pnpm install --frozen-lockfile --ignore-scripts`: succeeded, existing versions only; supply-chain policy checked 569 entries. No lifecycle scripts ran.
- Actual canonical composition: identical bytes/hash above; seven raw blocks identical; all eight existing component test files have identical hashes to their pre-pass contents.
- Vite development server started successfully from `@ccc/site`.
- Browser DOM inspection: introduction and all adoption headings render; missing-config state exposes only `#adoption`; configured state exposes that anchor and the exact configured HTTPS origin; zero forms; zero recorded fetch/XHR resources in both observations.
- Missing-config mobile observation at 390px and configured desktop observation at 1280px had no document horizontal overflow.
- Final HTTP smoke: `/` and `/welcome` return 200; `/login` and `/onboarding` return 404.

Limitations:

- Browser screenshot capture repeatedly timed out, including direct Puppeteer capture. Later reload/click helpers also timed out. These were reported as tooling failures. **No successful screenshot, visual design approval or adoption-click interaction claim.** DOM and HTTP evidence are narrower than visual acceptance.
- No builds, test suites, linters, formatters or design gates ran in this source pass. Main validates the frozen snapshot. The user-provided base `guard-core-imports` pass was not rerun.
- No production/site deployment, Windows runtime, live login or installation-mode verification.

### Narrow public-surface correction (2026-09-10)

Q confirmed the official product name **Relayer** (naming only). The new site's heading now uses the existing `@ccc/wire` `PageTitle` as its sole h1, both HTML document titles use Relayer, and the briefing card uses the approved screen name `15초 페이지`. Repository/package/infrastructure names remain unchanged. The approval attribution and D89 reconciliation above are corrected without copying the decision text.

Correction inventory: `apps/site/src/welcome-page.tsx`, `apps/site/index.html`, `apps/site/welcome.html`, and this handoff. Navigation, origin validation, no-business-I/O behavior assertions and all existing tests are untouched; no text-only tests were re-pinned. CSS bytes/order and all gate algorithms, thresholds and baselines are untouched. No build/test/lint/format run or deployment was performed for this correction. Main owns screenshots, actual built-site and gate verification; the earlier runtime observations are not fresh verification of this correction.

### Verified business login destination correction (2026-09-10)

Main's browser/source finding establishes `/login` as the existing business authentication entry and bare `/` as the preserved STT entry. Only the public staff-login href changes to the validated configured origin plus `/login`; `businessClientOrigin` and its origin-only validation assertions remain unchanged. The naming/PageTitle changes from `eb82e9258edb2f6ab5dada8d282cf8e9c89f8569` are retained on this lane.

Changed files for this follow-up: `apps/site/src/welcome-page.tsx`, `apps/web/app/welcome/page.test.tsx`, and this handoff. The existing rendered navigation assertions retain the unconfigured `#adoption`-only path and no-form assertion; an added rendered-href regression expects `#adoption` plus `https://work.example.test/login` for a configured origin, again with no form. No text-only assertion was re-pinned and no business I/O was added. No client/STT routes, CSS, gate algorithms, thresholds or baselines were changed. No tests, builds or deployment ran during this source correction; Main owns their execution and actual built-site verification.

### Missing canonical reading-description rule (2026-09-10)

Main reported that the required token guard failed in VALIDATION because the public page used `report-description` without a production selector. This corrects the unsupported reuse claim above. The owner-approved patch adds exactly one rule after the global `p` rule in `packages/wire/src/shell-styles.ts`:

```css
.report-description{font-size:var(--text-detail);font-weight:400;color:var(--sub);line-height:var(--leading-relaxed)}
```

Main copied the initial rule patch `47158fdf8137b6604ff3f6a19691c6e56f188eb4` and reported the next token-audit failure: the existing `--text-detail` owner list omitted `.report-description`. D88 ⑨ and DESIGN-RULES §5 explicitly assign that token to this selector. The consolidated owner patch retains the exact CSS rule above and adds only `.report-description` plus its contract comment to the existing scoped owner list in `scripts/design/token-audit.mjs`; this aligns the declared ownership contract, not an audit algorithm, threshold or baseline.

The consolidated commit replaces the initial two-file owner commit and contains exactly three files: `packages/wire/src/shell-styles.ts`, `scripts/design/token-audit.mjs`, and this handoff. No tokens, algorithms, thresholds, baselines, client files or other worktrees are modified. No tests, builds, linting, formatting or deployment ran for this source correction. Main will copy the exact owner-approved source into the in-progress integration merge, then run the token guard and built-surface verification. No passing guard or visual result is claimed here.

Main's pending commands after client handoff and source freeze:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/guard-core-imports.mjs
pnpm --filter @ccc/wire typecheck
pnpm --filter @ccc/wire test
pnpm --filter @ccc/site typecheck
pnpm --filter @ccc/site test
pnpm --filter @ccc/site build
pnpm --filter @ccc/client typecheck
pnpm --filter @ccc/client build
pnpm --filter @ccc/web typecheck
pnpm --filter @ccc/web test
pnpm guard:tokens
pnpm guard:align
pnpm guard:hierarchy
pnpm guard:hierarchy:test
pnpm design:hierarchy
pnpm design:align
```

Also inspect emitted HTML/CSS, exercise production-preview direct routes, absence/invalid/same-origin/valid business-origin states, browser network isolation, keyboard adoption navigation and 1280/767/390px light/dark screenshots. Public hosting must not introduce a fake `/login` or institution signup fallback. Run the independent design review on Main; no subagents were spawned here.

Existing preserved behavioral tests under `packages/wire/src`: `chevron.test.tsx`, `participant-hero-card.test.tsx`, `participant-name.test.tsx`, `wire-data-rows.test.tsx`, `wire-form-field.test.tsx`, `wire-month-calendar.test.tsx`, `wire-section.test.tsx`, `wire-state.test.tsx`.

## E2-7 residual retirement paths

Do not delete these to make a source count pass:

- `apps/web/app/page.tsx`: business account-setting redirect.
- `apps/web/app/actions.ts`, `apps/web/app/lib/api.ts`, business pages under `participants`, `programs`, `admin` and `onboarding`: legacy server actions/business readers and workflows.
- `apps/web/middleware.ts`, `apps/web/app/preview/**`, `adapters/identity-access/**`, `apps/api/src/index.ts` and runtime identity wiring: transitional Access/preview authentication and delivery paths. API/adapter work belongs to their owners.
- `apps/web/app/join/**`: legacy request/invite surfaces requiring verified D86 replacement.
- `apps/web/app/kit/page.tsx` and `apps/web/app/preview/**`: existing kit/preview contact points retained. Only kit style measurement inputs changed. No redirect to an unverified replacement.
- `apps/web/package.json` legacy `./wire` and `./wire-styles` exports and remaining old consumers: FRONTEND/Main must finish import migration and verify replacements before retiring these paths. No compatibility shim was added here.
- Legacy Next runtime/build/deployment remains present. This pass does not claim E2-7 completion.

## Exact changed-file inventory

```text
apps/site/.env.example
apps/site/index.html
apps/site/package.json
apps/site/src/business-origin.test.ts
apps/site/src/business-origin.ts
apps/site/src/main.tsx
apps/site/src/vite-env.d.ts
apps/site/src/welcome-page.tsx
apps/site/tsconfig.json
apps/site/vite.config.ts
apps/site/welcome.html
apps/web/app/components/wire/back-link.test.tsx
apps/web/app/components/wire/participant-card.test.tsx
apps/web/app/components/wire/wire-badge-palette.test.tsx
apps/web/app/kit/align-harness.test.tsx
apps/web/app/kit/hierarchy-harness.test.tsx
apps/web/app/layout.tsx
apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/record-list.test.tsx
apps/web/app/programs/[programType]/schedule/schedule-nav.test.tsx
apps/web/app/welcome/page.test.tsx
apps/web/app/welcome/page.tsx
apps/web/package.json
docs/superpowers/plans/2026-09-10-public-site-shared-style-handoff.md
package.json
packages/wire/build/shared-styles.d.mts
packages/wire/build/shared-styles.mjs
packages/wire/package.json
packages/wire/src/shell-styles.ts
pnpm-lock.yaml
scripts/design/align-audit.mjs
scripts/design/hierarchy-audit.mjs
scripts/design/hierarchy-audit.test.mjs
scripts/design/token-audit.mjs
```
