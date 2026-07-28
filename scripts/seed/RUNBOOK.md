# 운영 시드 적용 RUNBOOK (오케스트레이터 전용)

가상 참여자 20명 + 상담 활동 전체를 운영 D1(org `bss`)에 넣는 절차. 시드 생성 툴은 로컬
Miniflare 에서 **실제 게이트웨이 함수**로 시드를 실행하며 write SQL 을 캡처 → 인라인 SQL 로
직렬화 → 신선한 두 번째 DB 에 재생해 검증한다. 아래 1~3 단계는 **오케스트레이터가 수행**한다
(시드 생성 세션은 실키·원격·운영 DB 에 접근하지 않는다).

## 0. 전제

- Node 22, pnpm 11, repo 루트에서 실행.
- `scripts/seed/out/` 은 gitignore(커밋 금지). 산출물 5종: `seed.sql`, `manifest.json`,
  `verify.sql`, `delete-best-effort.sql`, `capture-report.txt`.

## 1. 운영 기준 리프레시 (드리프트 가드)

운영 D1 의 현재 상태를 조회해 `scripts/seed/preload-data.ts` 상수와 일치하는지 확인한다.
다르면 `preload-data.ts` 를 갱신한 뒤 재생성한다.

```bash
# apps/api 에서 (읽기 전용)
wrangler d1 execute ccc --env production --remote --command \
  "SELECT COUNT(*) FROM users WHERE org_id='bss' AND active=1;"
wrangler d1 execute ccc --env production --remote --command \
  "SELECT id, initialization_state FROM beneficiaries WHERE org_id='bss';"
wrangler d1 execute ccc --env production --remote --command \
  "SELECT COUNT(*) AS audit FROM audit_log;"
```

- 기대: 활성 users 8, beneficiaries 스텁 `A001`·`swallow-001`, audit 기준선 162.
- 슬러그 할당은 `id GLOB '*-*'` 개수 기반 라운드로빈이다. 기존 슬러그 beneficiary 가
  `swallow-001` 뿐이면 첫 할당은 `crane-001` 부터 이어진다. 다른 슬러그가 이미 있으면
  할당 동물이 달라지므로 재확인 후 재생성한다.

## 2. 시드 생성 + 검증 (실키 주입)

```bash
export PATH="/path/to/mise/installs/node/22.x/bin:$PATH"
infisical run --projectId=a7c44b37-a885-4c62-98cd-cbc8a9810de9 --env=prod -- \
  pnpm exec vitest run --config scripts/seed/vitest.config.ts
```

- `PII_ENC_KEY` 는 infisical 이 주입한다(stdout 에 값이 닿는 명령 금지). 미주입 시 툴이
  명시 실패 메시지를 낸다.
- green 이면 `scripts/seed/out/` 에 산출물 5종이 생성된다. `capture-report.txt` 의 문장 수와
  검증 결과를 확인한다. `manifest.json` 의 `audit.expectedAfterSeed` 를 기록해 둔다.

## 3. 운영 적용 (원자적) + 스모크 + 롤백 대비

```bash
# apps/api 에서
# (a) Time Travel 북마크 저장 — 진짜 롤백 수단
wrangler d1 time-travel info ccc --env production   # 북마크/timestamp 기록

# (b) 원자적 적용 (-y 금지: 프롬프트 확인)
wrangler d1 execute ccc --env production --remote --file ../../scripts/seed/out/seed.sql

# (c) 대조
wrangler d1 execute ccc --env production --remote --file ../../scripts/seed/out/verify.sql
```

- `verify.sql` 결과를 `manifest.json` 기대치와 대조한다(참여자 +20, 세션 +64, 동의 +20,
  vault key_version=2 +20, audit 총합 = 기준선 162 + 방출 audit + 세션 수).
- 라이브 스모크: 브리핑/일정 화면에서 담당자 계정으로 실명 렌더 + 향후 7일 예정 일정
  (ai00 담당 ≥4건)이 보이는지 확인한다.
- 실패 시 롤백: `delete-best-effort.sql` 은 자식 테이블만 부분 정리한다. audit_log·
  participant_consent_records 는 append-only, support_cases·beneficiaries 는 동의 FK 로
  삭제 불가하므로 **완전 롤백은 (a)의 Time Travel restore 로만** 한다:
  ```bash
  wrangler d1 time-travel restore ccc --env production --bookmark <저장한 북마크>
  ```

## 금지

- infisical `secrets`/`export`/`get`/`--plain` 등 값이 stdout 에 닿는 명령.
- 시드 생성 세션에서의 wrangler `--remote`/원격 접근(3단계는 오케스트레이터 몫).
- `apps/`·`db/`·`migrations/` 수정, 새 의존성 추가.
