# SG4 Local Service Profiles Implementation Plan

> **For agentic workers:** This documentation ticket is complete in one pass. The parent session owns repository-wide validation after this branch is committed.

**Goal:** Freeze the Local Single and Local Office service-profile contracts and the E8-8 performance, restart, and restore gates before implementation begins.

**Architecture:** A discriminated `SingleProfile | OfficeProfile` keeps the two local deployment boundaries explicit while the common core retains seven runtime ports and shared Application Services. Single is a `127.0.0.1`-only interactive-user profile with DPAPI endpoint discovery; Office is a dedicated-service, private-LAN HTTPS profile with a central encrypted store. E7 and E8 remain implementation owners, while SG4 owns only the contract, fixture, thresholds, and evidence map.

**Tech Stack:** Markdown, TypeScript contract notation, encrypted SQLite with WAL, Windows 11 x64, Electron + NSIS for Single, Windows Service and internal HTTPS for Office.

**Spec:** `docs/specs/S4-local-service-profiles.md`, grounded in ADR-0041 D76, D78, D82, D83 and `CCC_OPEN_PILOT_PLAN.md` SG4/E8-8.

## Global Constraints

- Community Cloud, Local Single, and Local Office are all formal modes; this ticket specifies the local profiles and records Cloud only as the comparison baseline.
- Single binds only to one `127.0.0.1` ephemeral port. `::1`, external NIC, wildcard bind, LAN bind, and port forwarding are forbidden.
- Office binds only to an RFC1918 IPv4 address in the configured private subnet on TCP `8443`; IPv6 is rejected unless an explicit ULA is configured. External reachability is proven by the E8-6 firewall test, not startup router introspection.
- Office uses TLS `>=1.2`, an RFC5280 name-constrained CA, and a SAN inside the configured server DNS/IP range. It never exposes a cleartext listener or redirect.
- Office's installer creates a local Windows Service user with a random never-displayed password, SCM-loaded profile, and local/RDP logon denied. Its identity service principal is used only for scheduler and health.
- Local stable user ID is randomly generated at install, never SID-derived, protected by DPAPI `CurrentUser` and the SG9 Kit, and identical after a different-SID restore. All local at-rest keys use DPAPI `CurrentUser`.
- Central Office backup carries keys only inside the SG9 Kit envelope. Restore requires an input-only passphrase, Kit verify/hash, and rewrap to the new service account; service-account reset invalidates DPAPI and Kit is the only recovery path.
- Installation sets `sttMode` to `off` and `sttEngine` to `null` in every mode. Plaintext SQLite is never a fallback.
- E8-8 thresholds are frozen in a committed `artifacts/e8-8-freeze.json` before load begins. Immutable artifacts are stored under `artifacts/e8-8/{runId}/`; failed runs are retained and results cannot change the thresholds.
- This branch changes only the SG4 spec and this plan. It does not implement adapters, run validation, alter `CCC_OPEN_PILOT_PLAN.md`, or mutate GitHub/Linear.

---

### Task 1: Publish the six-section SG4 canonical contract

**Files:**
- Create: `docs/specs/S4-local-service-profiles.md`

**Interfaces:**
- Consumes: ADR-0041 D76/D78/D82/D83, ADR-0042 D84 preflight boundary, the common specification template, and SG4/E7/E8 rows in `CCC_OPEN_PILOT_PLAN.md`.
- Produces: status `확정`, a discriminated `SingleProfile | OfficeProfile`, six template sections, the Single/Office rule table, and the Cloud comparison baseline.

- [ ] Keep exactly six numbered template sections: purpose, interface and rules, three-mode differences plus E8-8 gates, completion criteria, verification method, and out-of-scope boundary.
- [ ] Define Single as one `127.0.0.1` ephemeral listener with DPAPI endpoint discovery, OS user/app lock, random non-SID stable ID, and no `::1` listener.
- [ ] Define Office as RFC1918 IPv4/private-CIDR TCP `8443`, optional configured ULA only, TLS `>=1.2`, RFC5280 nameConstraints/SAN rules, and no cleartext/public network exposure.
- [ ] Define installer-created random-password Windows Service account, SCM-loaded profile, denied local/RDP logon, DPAPI reset behavior, and Identity service principal limited to scheduler/health.
- [ ] Define both backup/recovery paths, including SG9 Kit-only central key carriage, passphrase non-persistence, Kit verify/hash, and rewrap.

### Task 2: Map E7/E8 evidence and freeze E8-8 gates

**Files:**
- Modify: `docs/specs/S4-local-service-profiles.md`

**Interfaces:**
- Consumes: E7-1a/b, E7-2, E7-3, E7-4, E7-5, E7-6a/b, E8-1 through E8-9 ownership rows.
- Produces: exact artifact paths and pass predicates for each owner, plus the E8-8 load/restart/restore contract.

- [ ] Map every local contract area to its E7 or E8 owner and exact evidence path, with secret/raw SID/bearer/PII exclusion.
- [ ] Freeze the envelope: qualifying reference server CPU class is Intel Core i5-8500T (6 cores/6 threads, 2.10GHz base), Windows 11 Pro 24H2 x64, Node `24.13.3`, RAM cap 16GiB, CPU affinity/Job Object at most 8 logical cores, and recorded CPU model/base clock/benchmark (informational only)/storage model. Other CPU classes are `미측정`, not PASS.
- [ ] Freeze the deterministic seeded fixture: 100 disjoint-partitioned cases, each with one participant, three sessions, 2 to 4KiB notes, 2 to 4KiB drafts, three action items, two flags, and one exact 2MiB attachment.
- [ ] Define a closed-loop shared API client over persistent connections: ten logical sessions, five per client, next request immediately after the last response byte, at least five in-flight for at least 50% of one-second samples, at least 5 req/s sustained, one warmup excluded, and histogram recording.
- [ ] Freeze latency from request send to last body byte at `p50 ≤ 250ms`, `p95 ≤ 750ms`, `p99 ≤ 1,500ms`; count each 10-second request timeout as an error.
- [ ] Freeze unintended error rate `≤ 0.5%`, contract 4xx `0%`, Job Object service-plus-descendants private bytes/job commit sampled every 5 seconds with job commit peak `≤ 640MiB`, and ETW hard paging gates.
- [ ] Pin ETW provider/event `Microsoft-Windows-Kernel-Memory/HardFault` as the WPR `Memory/HardFault` event and capture it with `wpr -start Memory -filemode` followed by `wpr -stop artifacts/e8-8/{runId}/hardfault.etl`; filter to Job Object member PIDs, record 1-second buckets, require steady-window mean `≤ 5 events/s` and no 60-second rolling window `> 20 events/s`.
- [ ] Define 409 testing on at least 20 distinct row pairs, exactly one conflict-code 409 and one winning audit with no loser audit per pair.
- [ ] Define restart exclusion exactly from restart command sent through health PASS, separately report `≤ 30s`, and reconcile the pre-restart 2xx write ledger with loss `0` and duplicate `0`.
- [ ] Define restore `≤ 15min` with 100 cases, 300 sessions, attachment/file hashes, CA fingerprint, SG9 Kit verify/hash, service-account rewrap, both clients without reinstall, and successful new writes.
- [ ] Keep committed freeze manifest separate from immutable `artifacts/e8-8/{runId}/` run files and retain every failed run.

### Task 3: Self-review and amend the documentation commit

**Files:**
- Modify: `docs/specs/S4-local-service-profiles.md`
- Modify: `docs/superpowers/plans/2026-09-02-SG4-local-profiles.md`

- [ ] Confirm the spec status is `확정`, the six template sections are present, and `확정` requires no implementation-dependent evidence.
- [ ] Confirm all named differences, owner mappings, evidence paths, fixed seed, envelope, closed-loop load shape, percentile/error/memory/409/restart/restore gates, and immutable freeze rule are explicit.
- [ ] Confirm SG4 commands are subsets invoked by `pnpm test:runtime` and `pnpm test:golden`, with exact failure predicates.
- [ ] Confirm only the two owned documentation files changed.
- [ ] Amend the existing commit with message `docs: define SG4 local service profiles`.
- [ ] Do not run formatters, linters, builds, tests, or project-wide validation; the parent session validates after parallel branches land.
