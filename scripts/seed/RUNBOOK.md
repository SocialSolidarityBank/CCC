# 미리보기 가상 시드 RUNBOOK

가상 참여자와 상담 활동을 **로컬 disposable preview 또는 원격 `ccc-preview`에만** 넣는다.
운영 D1용 프로파일과 지원 명령은 없다.

## 경계

- 생성은 `pnpm seed:generate:local`과 `pnpm seed:generate:preview`만 지원한다. 두 명령이
  `SEED_PROFILE=preview`와 산출물 대상(`SEED_TARGET`)을 고정한다.
- 적용은 `pnpm seed:apply:local`과 `pnpm seed:apply:preview`만 지원한다. 래퍼가 manifest의
  대상과 요청 대상을 대조하고 D1 이름 및 `--local`/`--env preview --remote` 인자를 고정한다.
- 생성된 `preload.sql`은 `users`·`organization_settings`·`beneficiaries`가 모두 빈 DB에서만
  통과한다. 운영 reset 뒤에도 보존되는 사용자와 기관 설정이 있으므로 운영에서는 첫 assertion이
  실패하고 뒤 fixture 쓰기로 진행하지 않는다.
- 생성된 `seed.sql`은 미리보기 프리로드의 사용자 수, 기관, pending 스텁 조건을 검사하고
  사업·동의·감사 데이터가 없는 상태에서만 통과한다. 재적용하려면 DB를 다시 초기화해야 한다.
- SQL은 Cloudflare D1의 바인딩 이름을 읽을 수 없다. 원시 `wrangler d1 execute` 권한이 있는
  관리자가 래퍼를 우회해 SQL을 수정하거나, 운영을 미리보기와 구별할 수 없는 빈 상태로 만든 뒤
  두 파일을 직접 실행하는 행위까지 절대 막지는 못한다. 지원 절차는 원시 실행을 사용하지 않는다.

## 생성

Node 22, pnpm 11에서 레포 루트에서 실행한다. `scripts/seed/out/`은 gitignore이며 산출물은
`seed.sql`, `preload.sql`, `manifest.json`, `verify.sql`, `delete-best-effort.sql`,
`capture-report.txt` 여섯 개다.

### 로컬 키

`apps/api/.dev.vars`의 `PII_ENC_KEY`로 생성하고, 같은 키로 로컬 API를 실행한다.

```bash
set -a; . ./apps/api/.dev.vars; set +a
pnpm seed:generate:local
```

### 원격 미리보기 키

`ccc-preview` Worker에 등록된 `PII_ENC_KEY`와 같은 `PREVIEW_PII_ENC_KEY`로 생성해야 한다.
기관 시크릿 접근 절차에 따라 이 값을 주입한 자식 셸에서 아래 명령을 실행한다.
인증 절차와 토큰 참조는 별도로 복사하지 않는다. 값이 stdout에 닿는 명령은 금지한다.

```bash
PII_ENC_KEY="${PREVIEW_PII_ENC_KEY:?미리보기 키 주입 필요}" pnpm seed:generate:preview
```

생성 뒤 `manifest.json`의 `profile`이 `preview`, `target`이 적용할 대상, `participants`가
15인지 확인한다. `out/`은 두 대상이 공유하므로 대상을 바꿔 생성하면 이전 산출물을 덮어쓴다.
날짜는 기관 시간대 기준일 상대값이며, 재현할 때는 `SEED_ANCHOR_DATE=<manifest의 anchorDate>`를
같이 준다.

## 로컬 disposable preview 적용

새 로컬 D1에 마이그레이션을 적용한 뒤 레포 루트에서 고정 대상 래퍼를 실행한다.

```bash
pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc-local --local
pnpm seed:apply:local
```

래퍼가 `preload.sql` → `seed.sql` → `verify.sql` 순서로 실행한다. 기존 로컬 데이터가 있으면
assertion이 거부한다. 로컬 D1을 폐기하고 다시 만든 뒤 재실행한다.

## 원격 `ccc-preview` 초기화와 적용

`ccc-preview`는 가상 데이터 전용이다. append-only 트리거 때문에 부분 삭제 대신 Time Travel
북마크를 남기고 전체 스키마를 초기화한 뒤 다시 마이그레이션한다.

```bash
# apps/api에서
pnpm exec wrangler d1 time-travel info ccc-preview --env preview
pnpm exec wrangler d1 execute ccc-preview --env preview --remote \
  --file ../../scripts/seed/out/drop-all.sql
pnpm exec wrangler d1 migrations apply ccc-preview --env preview --remote

# 레포 루트에서
pnpm seed:apply:preview
```

`drop-all.sql`은 고정 산출물이 아니다. `sqlite_master`의 사용자 table·view와 `d1_migrations`를
포함하고 Cloudflare 내부 `_cf_KV`는 제외해 초기화 직전에 만들고 내용을 검토한다. 파일과
Time Travel 북마크가 준비되지 않았으면 초기화를 시작하지 않는다. 실패 시:

```bash
pnpm --filter @ccc/api exec wrangler d1 time-travel restore ccc-preview \
  --env preview --bookmark <저장한 북마크>
```

## 금지

- production DB 이름이나 `--env production`을 넣은 시드 실행.
- 원시 `wrangler d1 execute ... --file scripts/seed/out/{preload,seed}.sql`을 지원 절차로 사용.
- infisical `secrets`/`export`/`get`/`--plain`처럼 값을 stdout에 노출하는 명령.
