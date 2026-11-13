# CCC-204 existing-source PWA acceptance audit

Understood as: verify the already implemented frontend at `f7194dc88064455f3eb6be02abb5aae836981612`, without rebuilding a second product scaffold or acquiring frontend/design ownership.

Assignment: `ccc204-pwa-acceptance-20260913`. Controller: `w1N:p6`. Executor: `w1N:p1`, session `01a09acb-883e-7562-88b7-ec7db8a87ef8`.

## Evidence boundary

- Observe live Bash/Herdr identity, source branch/commit and hashes. Read only the current-rule preamble of the canonical handoff.
- Preserve every worktree and all WIP. Build a disposable committed-source snapshot inside `artifacts/ccc204-pwa/`; resolve workspace dependencies within that snapshot and use installed third-party dependencies read-only. No installs or Git mutations.
- Run the existing Vite build and supported token guard against the snapshot. Record the imported source closure, commands, exit codes and exact source defects without repairing them.
- Use a fresh browser context and loopback-only runtime. Exercise public routes and protected-route rejection, direct URLs, reload and Back. Do not manufacture successful login or bypass installation signatures, consent or permissions.
- Observe the emitted service worker, exact cache entries, offline shell/assets, and exclusion of synthetic API/auth/PII-shaped responses and token markers. If automatic registration is behind inaccessible authenticated state, distinguish manual registration of the unchanged worker from application-triggered registration; never call the latter verified.

## Acceptance and proof

| Criterion | Required evidence |
| --- | --- |
| React/Vite application | Pinned manifests, build exit, actual rendered application |
| Data router | Actual route tree plus direct URL, reload and Back observations |
| Shared design system | Resolved `@ccc/wire`, canonical token/CSS inputs and runtime computed styles |
| Static-only worker cache | Actual browser registration, cache key classes, synthetic exclusion checks and offline behavior |
| Web/client design guard | Unmodified target inclusion and supported guard exit/output |

The approved E2-2 row and reconciled S2 storage/CSP boundary are the acceptance inputs. CCC-201 correspondence evidence is provenance only. CCC-212 owns later browser authentication/API acceptance; no hosted-auth success is inferred here.

## Delivery

Save non-sensitive scripts and JSON evidence under `artifacts/ccc204-pwa/`. Record each gap with file, behavior, owner and smallest repair. Close only owned browser contexts and services, remove only inventoried generated runtime files, preserve the scripts/evidence, and write `artifacts/orchestration/ccc204-pwa-acceptance-result.json`. No ticket/control mutations, agent spawning, pane prompts or next-ticket work.
