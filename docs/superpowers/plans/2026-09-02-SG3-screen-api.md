# SG3 S3 화면·API 대응표 Plan

**Goal:** Publish the `확정` S3 contract that gives E2-1 a deterministic, complete route, screen, server-action, API, DTO, auth-surface and E2-owner map.

**Scope:** `docs/specs/S3-screen-api-map.md` and this ticket-local plan only. Source inventory and implementation files are read-only inputs.

## Tasks

- [x] Read ADR-0041, ADR-0042, the published spec template, route inventory, Next pages, rendered component/layout closure, web API client, server actions, middleware, `index.ts`, `preview-gate.ts` and request handler.
- [x] Fix the census: 30 inventory page entries = 29 non-kit entries + 1 `/kit`; 29 = 22 authenticated operating screens + 5 public screens + 2 non-screen redirects. Keep `/preview/unlock` as a separate Route Handler contract row.
- [x] Add one canonical row for every inventory route, including auth surface, `Actor` requirement, effective API operations, DTOs, server actions and E2 owner. Redirect rows contain no rendered-screen data; `/` keeps only its declared `GET /me` prerequisite.
- [x] Add deterministic uniqueness/completeness and public-shell/credential invariants suitable for a mechanical E2-1 probe, including transitive rendered-component and shared-layout action discovery.
- [x] Add exact wire endpoint envelopes, client projections, required nullable `lastProgramType`, full `InviteTokenWire`, `expiresAt`, preview web/API adapter split, and explicit DTO.field-to-Actor/route PII matrix.
- [x] Record preview join's current `ccc_preview` forwarding gap and web unlock's current `expiresAt` validation gap with E2-5c/E2-3 ownership; do not claim either is implemented.
- [x] Split AI draft GET extended wire from mutation base wire; record source ingestion ack and full invite issuance wire without collapsing to client projections. Add exact PII fields for public signup/search and aliases.
- [x] Standardize `+shell-actions` on every access/kit route and `+admin-layout` on every `/admin*` route; scanner expands nested Next layouts and inherited actions/API.
- [x] Add explicit mutation-client cast mismatch ownership to E2-1 while preserving GET-only AI fields and the production token-only versus Preview Actor-gated distinction.
- [x] Add explicit contract rows for every current page-unmapped action and request-handler service/legacy endpoint, including schedule transitions and legacy `/cases*`; assign legacy cleanup to E2-7 rather than writing implementation TODOs.
- [x] Set S3 status to `확정` and amend the SG3 commit.

## Verification

The parent worktree will run the E2-1 probe and project-wide validation after parallel ticket merges. This ticket intentionally skips formatters, linters, builds, tests and project-wide validation while sibling worktrees are active.
