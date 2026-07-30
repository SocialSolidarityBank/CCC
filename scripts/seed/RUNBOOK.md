# 운영 시드 적용 RUNBOOK (오케스트레이터 전용)

가상 참여자 4명 + 상담 활동 전체를 운영 D1(org `bss`)에 넣는 절차. 시드 생성 툴은 로컬
Miniflare 에서 **실제 게이트웨이 함수**로 시드를 실행하며 write SQL 을 캡처 → 인라인 SQL 로
직렬화 → 신선한 두 번째 DB 에 재생해 검증한다. 아래 1~3 단계는 **오케스트레이터가 수행**한다
(시드 생성 세션은 실키·원격·운영 DB 에 접근하지 않는다).

## 0. 전제

- Node 22, pnpm 11, repo 루트에서 실행.
- `scripts/seed/out/` 은 gitignore(커밋 금지). 산출물 6종: `seed.sql`, `preload.sql`,
  `manifest.json`, `verify.sql`, `delete-best-effort.sql`, `capture-report.txt`.
- `seed.sql` 은 **계정을 담지 않는다**(게이트웨이가 방출한 쓰기만 담는다). 이미 계정이 있는
  운영 D1 에 얹는 것이 원래 용도라서다. **빈 DB 를 세울 때는 `preload.sql` 을 먼저** 적용한다
  — 안 그러면 로그인 신원이 없어 화면이 열리지 않는다(5장).

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

- `verify.sql` 결과를 `manifest.json` 기대치와 대조한다(참여자 +4, 세션 +15, 동의 +4,
  vault key_version=2 +4, audit 총합 = 기준선 162 + 방출 audit + 세션 수).
- 라이브 스모크: 브리핑/일정 화면에서 담당자 계정으로 실명 렌더 + 예정 일정(ai00 담당 3건)이
  보이는지 확인한다. 주의: 시드의 예정 일정은 2026-07-19~23 으로 하드코딩돼 있어, 그 주가
  지나면 '다가오는 상담'(향후 7일) 섹션은 비어 보인다 — 날짜를 옮기려면 content.ts 의
  futureSchedules 와 generate.ts 의 UPCOMING_FROM 을 함께 고친다.
- 실패 시 롤백: `delete-best-effort.sql` 은 자식 테이블만 부분 정리한다. audit_log·
  participant_consent_records 는 append-only, support_cases·beneficiaries 는 동의 FK 로
  삭제 불가하므로 **완전 롤백은 (a)의 Time Travel restore 로만** 한다:
  ```bash
  wrangler d1 time-travel restore ccc --env production --bookmark <저장한 북마크>
  ```

## 5. 미리보기 D1 초기화 (운영과 별개 · 되돌리기 쉬움)

미리보기 D1(`ccc-preview`)은 가상 데이터 전용이라 통째로 다시 세우는 편이 낫다. **부분 삭제는
불가능하다** — `participant_consent_records`·`audit_log` 에 삭제 차단 트리거가 걸려 있고(D14),
동의 기록을 못 지우면 그것이 참조하는 당사자·참여 사업도 못 지운다. 테스트로 쌓인 일정·당사자를
치우려면 아래처럼 비우고 다시 넣는다(`database_id` 가 유지되므로 설정 변경·재배포 없음).

```bash
# apps/api 에서
# (a) 되돌릴 수단 먼저
pnpm exec wrangler d1 time-travel info ccc-preview --env preview   # 북마크 기록

# (b) 전 테이블 DROP → 마이그레이션 재적용
#     DROP 은 행 삭제가 아니라 테이블 제거라 append-only 트리거에 걸리지 않는다
#     (트리거도 테이블과 함께 사라진다).
pnpm exec wrangler d1 execute ccc-preview --env preview --remote --file ../../scripts/seed/out/drop-all.sql
pnpm exec wrangler d1 migrations apply ccc-preview --env preview --remote

# (c) 프리로드 → 시드 (순서 엄수)
pnpm exec wrangler d1 execute ccc-preview --env preview --remote --file ../../scripts/seed/out/preload.sql
pnpm exec wrangler d1 execute ccc-preview --env preview --remote --file ../../scripts/seed/out/seed.sql
pnpm exec wrangler d1 execute ccc-preview --env preview --remote --file ../../scripts/seed/out/verify.sql
```

- `drop-all.sql` 은 고정 파일이 아니다 — `sqlite_master` 를 조회해 그때그때 만든다.
  **`type IN ('table','view')` 둘 다** 잡아야 한다 — 뷰(`cases`·`case_assignees`·
  `approved_ai_briefing_v1`·`grounded_ai_quality_v1`)를 빠뜨리면 재적용이
  `view cases already exists` 로 죽는다(2026-07-31 실측). Cloudflare 내부 `_cf_KV` 는 제외하고,
  `d1_migrations` 는 **포함**해야 마이그레이션이 처음부터 다시 적용된다.
- `wrangler d1 migrations apply` 는 확인 프롬프트에서 멈춘다. `CI=true ... < /dev/null` 로
  비대화형 실행하면 "fallback value in non-interactive context: yes" 로 진행한다.
- **미리보기 키는 `PII_ENC_KEY` 가 아니라 `PREVIEW_PII_ENC_KEY` 다**(운영 키와 다른 값,
  2026-07-31 실측). 시드 생성기는 `PII_ENC_KEY` 라는 이름을 읽으므로 주입 시 갈아끼운다:
  ```bash
  TOK="$(op read 'op://seongqkim-bss/infisical/ggbss_project_access_token')"
  infisical run --token="$TOK" --env=prod --path=/ --silent -- \
    sh -c 'PII_ENC_KEY="$PREVIEW_PII_ENC_KEY" pnpm exec vitest run --config scripts/seed/vitest.config.ts'
  ```
- `audit_log` 도 함께 사라진다. 가상 데이터의 감사 흔적이라 미리보기에서는 문제되지 않는다.

## 금지

- infisical `secrets`/`export`/`get`/`--plain` 등 값이 stdout 에 닿는 명령.
- 시드 생성 세션에서의 wrangler `--remote`/원격 접근(3단계는 오케스트레이터 몫).
- `apps/`·`db/`·`migrations/` 수정, 새 의존성 추가.
