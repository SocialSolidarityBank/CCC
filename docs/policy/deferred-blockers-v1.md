# 미루는 차단 항목 후속 명세 v1

작성일 2026-08-16. 이 문서는 이번 문서 정합화 작업(ADR-0035, D63~D68)에서 **고치지 않기로 한** 차단 항목 둘의 재개 조건과 착수 지점을 남긴다. 미룬 근거는 서비스 미개시, 전 데이터 더미, 4주 파일럿 집중 개발 기간 범위 셋이다. **실제 상담 데이터를 받기 전에는 반드시 해소해야 한다.** 이 문서는 코드를 바꾸지 않는다. 실측만 담는다.

## 1. 보존·파기 절차 누락

### 1.1 현재 동작

레포에는 서로 독립된 **파기 경로 둘**이 실재한다. 둘 다 D32(ADR-0010)·D46 이 요구하는 절차 없이 값을 지운다.

**경로 A. 매일 cron 자동 파기 (사람 개입 없음)**

1. `support_cases` 의 마지막 활성 케이스가 종결되면 `support_cases_schedule_pii_purge_due` 트리거(`migrations/0006_participant_support_case_cutover.sql:1773-1792`)가 기관 설정(`organization_settings.pii_purge_grace_days`)만큼 뒤로 `participant_pii_vault.purge_due` 를 채운다. 같은 당사자가 새 케이스로 재등록되면 `support_cases_cancel_pii_purge_due` 트리거(`migrations/0006_participant_support_case_cutover.sql:1794` 이하)가 `purge_due` 를 `NULL` 로 되돌린다(취소 경로).
2. 매일 03:00 UTC cron 이 `PURGE_CRON` 표현식으로 발동하면 `scheduled()` 핸들러가 `ctx.waitUntil(runPurge(env))` 를 호출한다(`apps/api/src/index.ts:83-84`). `runPurge` 는 `purgeExpiredParticipantPii(env)` 를 그대로 반환하는 얇은 진입점이다(`apps/api/src/index.ts:60-61`).
3. `purgeExpiredParticipantPii`(`db/gateway.ts:9984-10017`)가 `purge_due` 도래분·미파기분·활성 케이스 없는 당사자를 최대 100건 조회한 뒤, 건마다 `purgeParticipantPiiForActor`(`db/gateway.ts:9921-9955`)를 불러 `participant_pii_vault` 의 `enc_*` 컬럼을 그 자리에서 바로 `UPDATE ... SET enc_name = NULL, ...` 로 지운다. 검토 큐도, 사람 확인도 없다.
4. 이 경로가 실제로 지운다는 것은 테스트가 증명한다: `apps/api/test/watchdog-purge.test.ts:271-292`, 특히 282행 `await expect(runPurge(t.env)).resolves.toEqual({ attempted: 1, purged: 1, noops: 0 })` 가 파기 1건을 단언한다.

**경로 B. 기관 관리자 수동 파기 (HTTP 엔드포인트, 사람이 누르지만 절차는 없음)**

- `apps/api/src/request-handler.ts:2444` 가 `purgeExpiredPiiAsAdmin` 을 호출하는 엔드포인트를 연다.
- `purgeExpiredPiiAsAdmin` → `purgeDuePii` → `selectDuePii` 로 이어지며, 이 구간이 `db/gateway.ts:4769-4821` 이다. `selectDuePii`(4773행)가 도래분을 조회하고, `purgeDuePii`(4806행)가 건마다 같은 모양의 `UPDATE ... SET enc_name = NULL, ...`(4814-4825행)을 직접 실행한다. 경로 A 와 마찬가지로 검토 큐나 확인 단계가 없다. 다른 점은 버튼을 누르는 사람이 있다는 것뿐이다.
- 참고로 `db/gateway.ts:4850-4852` 의 `purgeExpiredPii` 함수는 주석에 "scheduled(cron) 핸들러 전용 내부 진입점"이라고 적혀 있으나, `apps/api/src/index.ts` 는 이 함수를 임포트하지 않는다(실제 cron 은 위 경로 A, `purgeExpiredParticipantPii` 를 부른다). 이 주석은 코드 실제 배선과 어긋난 낡은 설명이며, 이번 문서는 이 어긋남을 **기록만 하고 고치지 않는다.**

### 1.2 D32·D46 6단계 대조표

D32(ADR-0010)와 D46 이 요구하는 절차는 여섯 단계를 거쳐 파기에 이른다. 위 경로 A·B 모두 같은 결과다: 1단계만 있고 2~6단계는 없다.

| # | 단계 | D32·D46 이 요구하는 것 | 코드에 있는가 |
| --- | --- | --- | --- |
| 1 | 보관 시계 | 케이스 종결 시 `purge_due` 를 설정해 유예기간을 잰다 | **있음**. `migrations/0006:1773-1792` 트리거가 설정한다 |
| 2 | 아카이브 전환 | 유예기간 경과 시 **파기가 아니라** 자동 아카이브로 전환하고 열람 권한을 좁힌다(D32 가 "실행 방식"으로 D10 을 대체한 지점) | **없음**. `purge_due` 도래는 곧바로 파기로 이어진다. 아카이브 상태 자체가 스키마에 없다 |
| 3 | 접근 제한 | 아카이브 상태의 열람 권한을 축소한다 | **없음**. 2단계가 없으므로 제한할 상태도 없다 |
| 4 | 검토 큐 | 파기 전 검토 큐에 올린다 | **없음**. 경로 A·B 모두 조회한 즉시 지운다. 큐 테이블이 없다 |
| 5 | 법적·업무상 보존 확인 | 연장동의, 진행 중 업무, 법적 보존 사유를 확인한다(D46, `internal-operations-policy.md` 3.5) | **없음**. `selectDuePii`·`purgeExpiredParticipantPii` 의 조회 조건은 `purge_due <= now` 와 활성 케이스 부재뿐이다 |
| 6 | 기관 관리자 확인 | 파기 검토 큐 → 기관 관리자가 확인한 뒤 파기한다(D46) | **없음(경로 A)** / **부분(경로 B)**. 경로 A 는 cron 단독 실행이라 사람이 전혀 없다. 경로 B 는 기관 관리자가 버튼을 누르지만, 이는 "확인 후 승인"이 아니라 확인 없이 곧바로 실행이다 |
| → | 파기 | 위 절차를 거친 뒤에만 값을 지운다 | **있음(절차 없이)**. `db/gateway.ts:9921-9955`(경로 A), `db/gateway.ts:4814-4825`(경로 B)가 직접 `UPDATE ... SET enc_* = NULL` 을 실행한다 |

요약: 지금 코드는 "1단계 → 파기"만 있고 2~6단계가 통째로 비어 있다. `AGENTS.md`/`CLAUDE.md` 148행의 정정(별도 todo)이 등급을 `red` 로 올리는 근거가 바로 이 표다.

### 1.3 재개 조건과 착수 지점

- **재개 조건**: 실데이터 투입 전. 지금은 전 데이터가 더미이므로 자동 파기가 실행돼도 실손실이 없다. 파일럿 4주 범위 안에서는 차단하지 않는다.
- **착수 시 손댈 곳**:
  - `migrations/` 새 파일: 아카이브 상태 컬럼(또는 상태 테이블)과 파기 검토 큐 테이블 신설
  - `db/gateway.ts` 의 `purgeExpiredParticipantPii`(9984행), `purgeParticipantPiiForActor`(9921행), 그리고 경로 B 의 `purgeDuePii`/`selectDuePii`(4769-4821행): 즉시 파기를 아카이브 전환으로 바꾸고, 검토 큐 등재·법적 보존 확인·기관 관리자 확인을 끼워 넣는다. 두 경로를 하나로 합칠지도 이때 정한다
  - `apps/api/src/index.ts` 의 cron 배선(60-61, 83-84행): 필요하면 파기 cron 을 아카이브 전환 cron 으로 교체하고, 파기 자체는 검토·확인 뒤 별도 진입점으로 분리한다
  - `apps/api/test/watchdog-purge.test.ts`: 지금은 즉시 파기를 전제로 단언한다(274-290행). 절차가 늘어나면 이 테스트의 기대값도 다시 쓴다

## 2. 기관 관리자 접근 범위

### 2.1 정책과 코드의 차이

**정책**(`docs/policy/internal-operations-policy.md` 2.2절)은 명확하다. 기관 관리자의 상담 내용 열람은 "본인이 담당 실무자로 배정된 케이스만. 그 외는 평상시 불가(긴급 접근은 2.5)"다. 긴급 접근은 사유 입력·시간 제한·케이스 단위 제한·전건 감사·담당 실무자 통지 다섯을 모두 충족해야 한다(2.5절).

**코드**는 다르다. `assertSupportCaseAccess`(`db/gateway.ts:7515-7525`)가 접근 판정 하나를 전담하는데, 함수 자체 주석이 "administrators are organization-scoped"라고 명시한다. 분기를 보면:

```
if (actor.role === 'admin') {
  await assertActiveHumanUser(env, actor.orgId, actor.userId, 'admin');  // 기관 소속만 확인
  return supportCase;                                                    // 배정 확인 없이 통과
}
await assertCurrentHumanActor(env, actor);
await assertActiveAssignment(env, actor, supportCase.id);                // counselor 만 배정 확인
```

`admin` 역할은 활성 배정을 확인하는 `assertActiveAssignment` 를 아예 거치지 않는다. `counselor` 역할만 이 확인을 강제받는다. 즉 기관 관리자 계정은 담당 배정 여부와 무관하게 **기관 내 모든 케이스**에 접근할 수 있고, 이 접근은 긴급 접근 절차(사유 입력·시간 제한·전건 감사·담당 실무자 통지)도 거치지 않는다. 정책 문서 2.2절의 "평상시 불가"가 코드에서는 "평상시 가능"이다.

### 2.2 조사 범위 힌트 (정적 수치, 테스트 증거 아님)

`assertSupportCaseAccess` 를 직접 부르는 곳은 정의부(`db/gateway.ts:7515`)를 빼면 총 21곳이다. `db/gateway.ts` 안에서 20회, `apps/api/src/request-handler.ts` 안에서 1회다(2026-08-16 `grep -c` 정적 카운트).

**이 21이라는 수치는 정적 참조 그래프를 훑어 얻은 조사 범위 힌트일 뿐, 테스트 증거가 아니다.** 21개 호출부 각각이 실제로 admin 우회를 허용하는지, 아니면 이미 다른 경로에서 배정을 확인한 뒤의 중복 호출이라 영향이 없는지는 호출부 문맥을 하나씩 읽어야 확정된다. 이 문서는 그 하나하나를 읽지 않았다. 다음 사람이 착수할 때 이 21곳부터 훑으라는 뜻으로 남긴다.

### 2.3 재개 조건과 착수 지점

- **재개 조건**: 외부 기관 온보딩 전. 지금까지의 시드·시연 데이터는 단일 기관 안에서 관리자와 실무자가 겹치므로 이 gap이 실제로 노출된 사례가 없다.
- **1인 기관에서 체감 영향이 낮은 이유**: 1인 기관에서는 기관 관리자와 담당 실무자가 같은 사람이다(`internal-operations-policy.md` 2.2절 "역할 겸임"). 자신이 곧 담당 실무자이므로 이 gap이 실질적인 초과 열람으로 이어지지 않는다. 기관 인원이 둘 이상으로 늘어나는 순간부터 문제가 된다.
- **착수 시 손댈 곳**:
  - `db/gateway.ts` 의 `assertSupportCaseAccess`(7515-7525행): admin 분기에 `assertActiveAssignment` 를 추가하거나, 배정이 없을 때는 `docs/policy/internal-operations-policy.md` 2.5절의 긴급 접근 다섯 요건(사유 입력, 시간 제한, 케이스 단위 제한, 전건 감사, 담당 실무자 통지)을 강제하는 명시적 분기를 추가한다
  - 21개 호출부 각각의 문맥 확인(2.2절의 정적 힌트가 가리키는 조사 범위)
  - `apps/api/src/request-handler.ts` 의 긴급 접근 엔드포인트 신설(현재 없음)

## 3. 미루지 않은 것

이 문서가 전체 그림을 담도록, 같은 배치에서 실제로 처리한 항목을 적는다.

- `records/` 를 `.gitignore` 에 추가해 공개 레포로의 상담 녹음 유입을 차단했다.
- 감정 분석 계산을 `worker.py` 의 `EMOTION_DEFERRED` 상수로 멈췄다(D64). 스키마, 데이터, `emotion.py` 모듈, 테스트는 전부 그대로 두고 계산만 정지했다. 이 위 두 항목(보존·파기 절차, 기관 관리자 접근 범위)과 달리 이번 배치 안에서 마무리됐다.
