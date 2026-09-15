# 처리 장비의 하루 운영과 자격 복구

확인일: 2026-09-16. 소스 기준: `release/0916`의 `4388f62a`. 아래 줄번호는 이 기준의 번호다. `apps/pipeline`은 다른 작업에서 수정 중이므로 다음 실행 전에는 해당 레인의 반영 여부를 확인한다.

이 문서는 **현재 가능한 수동 조치와 아직 실행할 수 없는 구간을 구분한 운영 절차**다. 실제 발급, 설치, provider 호출, 장비 재시작은 수행하지 않았다. 맥미니에도 접속하지 않았으므로 장비의 현재 프로세스, 주입 경로, launchd label과 소요 시간은 실측하지 않았다.

## 1. Attestation 하루 갱신 절차

### 시작 조건과 중단 기준

세 증빙은 서로 대체하지 않는다.

| 증빙 | 두는 곳과 확인할 내용 |
|---|---|
| NER health attestation | Agent의 `CCC_NER_ATTESTATION`에 JSON 하나를 주입한다. 실제 측정 결과와 `validatedAt`, `expiresAt`, `status`가 필요하다. 유효기간은 `validatedAt + 24시간` 이내다. 정본: [S6:43-78](../specs/S6-privacy-packet.md#L43-L78). |
| Production release 영수증 | 서버의 기관별 `ner_release_qualification_receipts`에 유효한 passed 영수증이 있어야 하고, Agent에는 그 ID를 `CCC_NER_RELEASE_RECEIPT_ID`로 주입한다. 서버는 만료와 모델, revision, 라벨, corpus/result hash의 일치를 검사한다. 근거: [gateway.ts:9350-9379](../../packages/core/src/gateway.ts#L9350-L9379). |
| Canonical masking registry | 서버와 Agent가 `MEMORY_MASKING_PIPELINES`로 같은 승인 manifest를 읽는다. Agent는 registry의 모델과 health hash를 attestation과 대조한다. 날짜 갱신만을 이유로 규칙이나 hash를 바꾸지 않는다. 근거: [config.py:255-275](../../apps/pipeline/ccc_pipeline/config.py#L255-L275), [masking-pipeline.ts:10-57](../../packages/contracts/src/masking-pipeline.ts#L10-L57). |

**현재는 이 절차를 레포 명령만으로 끝까지 수행할 수 없다.** install-health 측정부터 attestation 생성, release 영수증 발급과 저장, 비노출 주입까지 이어지는 운영 명령이 없다. 확인한 release 측정 자료도 `failed`다([measurement.json:99-100](../../artifacts/ner-release/measurement.json#L99-L100)). 이는 해당 자료의 판정이며 운영 DB 전체나 후속 측정의 상태를 뜻하지 않는다. 날짜나 `status`만 고쳐 통과 증빙을 만들지 않는다.

또한 두 가지 정합성 문제가 있다.

- S6는 소규모 install-health N과 별도의 production release corpus를 구분한다([S6:58-95](../specs/S6-privacy-packet.md#L58-L95)). 그러나 현재 서버는 두 증빙의 corpus/result hash가 같아야 한다([gateway.ts:9366-9375](../../packages/core/src/gateway.ts#L9366-L9375)). N 측정값을 release 측정값인 것처럼 옮겨 적을 수 없다.
- 상담 맥락 경로는 `receipt.validated_at === attestation.validatedAt`까지 요구한다([gateway.ts:25932-25935](../../packages/core/src/gateway.ts#L25932-L25935)). 따라서 **기존 영수증을 둔 채 attestation 날짜만 새로 만드는 일일 갱신은 이 경로에서 거부된다.** 두 증빙의 결속 계약을 먼저 정리해야 한다.

### 운영자가 따를 번호 순서

공통 사전 확인: **승인된 증빙 결속 계약과 그 적용, 발급/등록/비노출 주입 도구, 대상 API URL, 관리자와 활성 service 사용자, 단일 실행 관리 방법**을 먼저 확보한다. 도구만 있어도 결속 충돌이 남아 있으면 진행하지 않는다. 외부 정본이나 기존 장비 관리 절차를 확인할 수 없으면 계획된 종료·교체를 시작하지 않고 담당자에게 확인을 요청한다. 다만 이미 만료됐거나 자격 재사용이 발생한 경우에는 준비를 기다리며 처리를 계속하지 않고 사고 중지 절차를 우선한다.

1. **처리 시작 전에 유효기간과 경로를 확인한다.** 마지막 검증 시각부터 최대 24시간이며, 만료 직전 작업을 새로 시작하지 않는다. 작업 중에도 자격을 재검사하므로 처리 시간만큼 여유가 필요하다. 여유 시간의 고정 숫자는 레포에 없고 장비별 측정이 필요하다. 이미 만료했으면 새 작업 처리를 멈추고 수기 기록 경로를 사용한다. 원음의 보관 기한은 연장하지 않는다.
2. **자격 레인을 먼저 결정한다.** §3의 페어링 레인은 같은 refresh를 넣은 프로세스를 다시 실행하면 안 된다. 계획된 갱신은 승인된 방법으로 새 claim을 중단하고 기존 작업이 끝난 뒤 종료하는 순서가 필요하다. **자동 재시작 중지는 실행 중인 루프의 새 claim 중단과 다르다.** 레포에는 작업 배출 명령도 launchd label과 중지 명령도 없으므로 무중단 갱신을 약속하거나 임의의 `launchctl` 명령을 제시하지 않는다. 담당 운영자가 기존 장비 절차로 배출·중지를 확인하지 못하면 계획된 교체를 보류한다. 이미 만료된 job은 완료만 기다리지 말고 §2의 lease/차단 상태에 따른 복구 대상으로 넘긴다.
3. **고정 모델로 health를 실제 측정한다.** N corpus와 계산 규칙은 [S6:58-78, 267-275](../specs/S6-privacy-packet.md#L267-L275)에 있다. 이를 실행해 attestation까지 발급하는 CLI는 없다. 이 지점은 발급 도구와 승인된 절차가 준비될 때까지 중단한다. 테스트 fixture의 passed JSON, 미래 만료일 또는 readiness 성공을 대신 넣지 않는다.
4. **release 측정이 필요할 때는 기존 도구의 용도를 구분한다.** 아래는 레포 루트에서 실행할 수 있는 기존 release 측정 스크립트의 호출 형식이다. 사전에 준비한 ML Python과 합성 JSONL 입력, 승인된 출력 경로가 필요하다. `<...>`는 운영자가 확인해야 할 경로이며 실행 가능한 실제 경로를 꾸민 값이 아니다. 이번 조사에서는 실행하지 않았다.

   ```sh
   HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 <준비된-ML-Python> scripts/ner-release/measure.py <합성-corpus.jsonl> <측정-결과.json>
   ```

   근거: [measure.py:18-20, 132-169](../../scripts/ner-release/measure.py#L132-L169). 이 명령은 측정 보고서를 만들 뿐 `id`, `validatedAt`, `expiresAt`가 있는 attestation이나 DB 영수증을 발급하지 않는다. `gen_corpus.py`도 corpus 생성용이다. `rerun_production_path.py`는 production span 경로와의 대조 도구이고, 특정 맥미니 코드 경로를 내장한다([17-43행](../../scripts/ner-release/rerun_production_path.py#L17-L43)). 둘 다 하루 갱신 명령이 아니다. 실패한 측정에서 영수증을 만들지 않는다.
5. **통과 증빙의 저장과 주입을 승인된 경로로 수행한다.** 저장 대상은 위 표의 서버 영수증과 Agent 환경변수 세 개다. 이 레포에는 영수증 발급 API/CLI와 세 값을 일관되게 갱신하는 명령이 없다. DB에 직접 INSERT하는 예시를 만들지 않는다. 운영 담당자가 별도로 승인된 발급 절차를 확보하지 못하면 여기서 중단한다. Infisical의 실제 env/path나 시크릿 존재도 이번 조사에서 확인하지 않았으므로 특정 위치에 있다고 가정하지 않는다.

   조직 시크릿 접근은 레포 밖 정본 `~/developer/tools/portwright/services/1password.md`의 **Cross-runtime headless policy**와 `services/infisical.md`를 따른다. `opsvc`를 통한 자식 프로세스 주입만 사용하고 GUI 인증, 권한 확대, 시크릿 파일 신설, 환경 전체 출력은 하지 않는다. `infisical secrets`, `get`, `export`, `--plain` 명령을 제시하거나 실행하지 않는다. README의 `/etc/ccc-pipeline.env` 예시는 WSL2 역사 절차이지 맥미니의 현재 주입 위치가 아니다.
6. **새 증빙이 들어간 새 프로세스 하나만 시작한다.** 기존 프로세스는 저장소의 값이 바뀌어도 갱신되지 않는다. 시작할 때 `load_config()`를 한 번 호출하고 그 `config`를 루프에 계속 넘긴다([__main__.py:21-46](../../apps/pipeline/ccc_pipeline/__main__.py#L21-L46)). 승인된 비노출 주입이 끝난 환경에서 `apps/pipeline`을 작업 디렉터리로 하여 기존 명령 `python3 -m ccc_pipeline`을 사용한다. 자동 재기동 없이 운영자가 지켜보는 단일 실행만을 뜻한다. 재시작 전에 페어링을 썼다면 §4의 새 refresh가 필요하다.
7. **업무 요청의 성공까지 확인한다.** 시작 성공이나 readiness만으로 갱신 성공을 판정하지 않는다. 실제 운영을 승인받은 날에 인증, readiness, claim과 결과 제출의 상태 코드 및 작업 상태를 확인한다. `python3 -m ccc_pipeline --once`도 기존 명령이지만 실제 preflight와 작업 처리를 수행하므로 읽기 전용 점검이 아니다. Azure preflight는 인증 endpoint를 호출한다([README.md:97-103](../../apps/pipeline/README.md#L97-L103)). `--once`는 일반 작업을 한 번 폴링하며 상담 맥락 작업까지 확인하지 않는다([worker.py:1045-1053, 1083-1091](../../apps/pipeline/ccc_pipeline/worker.py#L1045-L1053)). **`--once`로 소비한 refresh를 그대로 넣고 본 실행을 시작하지 않는다.**

   결과 보고는 인증/readiness, 일반 작업 claim/결과, 상담 맥락 claim/결과를 나눠 기록한다. 일반 작업만 확인했으면 “일반 작업 경로만 확인했고 상담 맥락 복구는 미확인”이라고 쓴다. 실제 작업과 provider 호출이 발생할 수 있으므로 각각의 실행 승인이 필요하다.

### 소요 시간

| 구간 | 시간과 한계 |
|---|---|
| 증빙 만료, 대상 환경, 단일 프로세스 확인 | **추정 5~10분**이다. 담당자가 위치와 승인 이력을 이미 알고 있다는 가정이며 실측값이 아니다. |
| N health 측정과 attestation 발급 | **산정 불가**다. 일괄 발급 명령이 없고 이 조사에서는 모델을 실행하지 않았다. |
| release 재측정 및 영수증 저장 | **산정 불가**다. 측정 도구는 있으나 장비 소요 시간과 통과 영수증 발급 절차가 확인되지 않았다. 매일 release 전체 측정이 필요하다고 결정한 것도 아니다. |
| 승인된 값 주입, 수동 재기동, 페어링 복구 | **사람 조작은 추정 5~10분 + 관리자 승인 대기**다. 발급 도구가 확보된 뒤의 가정이며 모델 적재와 작업 처리 시간은 별도다. |
| 하루 전체 | **현재 완료 시간은 제시할 수 없다.** 도구와 결속 계약이 없는 구간이 있어 위 추정치를 합쳐 “10~20분이면 완료”라고 약속하지 않는다. |

24시간은 최대 유효기간이지 자정 기준이 아니다. 상담이 있는 날 시작 전에 갱신하고, 처리 종료까지 유효한지 확인한다. 더 짧게 발급된 증빙은 24시간을 기다리지 않고 그 만료 시각을 따른다.

## 2. 만료가 지났을 때의 증상과 원인

| 관찰되는 증상 | 차단 지점과 실제 의미 | 운영자의 다음 행동 |
|---|---|---|
| 시작은 되지만 claim이 거부된다. | Agent는 JSON 형태와 manifest 일치만 확인한다([config.py:158-175, 255-275](../../apps/pipeline/ccc_pipeline/config.py#L158-L175)). 실제 만료는 서버 `assertNerReleaseQualification`의 `expiresAt <= nowIso`가 `local_ner_unavailable`로 차단한다([gateway.ts:9357-9375](../../packages/core/src/gateway.ts#L9357-L9375)). claim은 작업 임대 전에 검사하므로 이 실패로 새 작업을 잡거나 attempt를 소모하지 않는다([9517-9538행](../../packages/core/src/gateway.ts#L9517-L9538)). | 새 claim을 반복하지 말고 §1의 갱신 준비 상태를 확인한다. |
| API가 `422`와 `local_ner_unavailable`를 반환한다. | 본문은 `{error, jobId, retryable}`다. attestation 만료뿐 아니라 release 영수증 부재, 만료, hash 불일치도 같은 코드다([request-handler.ts:2305-2309](../../packages/http-api/src/request-handler.ts#L2305-L2309), [agent-jobs.ts:353-368](../../packages/contracts/src/agent-jobs.ts#L353-L368)). | §1의 세 증빙을 함께 확인한다. NER 모델 장애로만 단정하지 않는다. |
| 콘솔에는 `pipeline poll failed` 또는 `claim failed: ApiError`만 보인다. | `--once`는 일반화된 메시지와 종료 코드 1을 반환한다([__main__.py:39-44](../../apps/pipeline/ccc_pipeline/__main__.py#L39-L44)). 상주 루프는 예외 종류만 쓰고 계속 폴링한다([worker.py:1081-1092](../../apps/pipeline/ccc_pipeline/worker.py#L1081-L1092)). 프로세스가 살아 있어도 처리는 멈춰 있을 수 있다. | 기존 안전한 응답/감사 기록에서 상태 코드와 만료 메타데이터를 확인한다. 오류 문구만으로 만료라고 확정하지 않는다. 디버깅을 위해 전체 환경, 요청 본문, 토큰을 출력하지 않는다. |
| 날짜만 갱신했는데 상담 맥락 처리는 계속 실패한다. | `memoryNerQualification`은 release의 `validated_at`과 다른 날짜를 `ValidationError('local_ner_unavailable')`로 거부한다([gateway.ts:25932-25935](../../packages/core/src/gateway.ts#L25932-L25935)). 이 분기는 일반 `ValidationError` 응답인 `400 invalid_request`로 가므로 앞의 422와 구분한다([request-handler.ts:2336](../../packages/http-api/src/request-handler.ts#L2336)). | 날짜를 되돌려 맞추거나 영수증을 임의 수정하지 않는다. §5의 계약 정합성 수정이 선행되어야 한다. |
| 작업을 받은 뒤 원음 접근 또는 후속 처리가 닫힌다. | 서버는 job에 저장한 attestation과 영수증을 다시 검사한다([gateway.ts:9382-9408](../../packages/core/src/gateway.ts#L9382-L9408)). 원음 접근의 [10254-10255행](../../packages/core/src/gateway.ts#L10254-L10255), 엔티티 등록 재료의 [10461-10462행](../../packages/core/src/gateway.ts#L10461-L10462), 외부 전사 허가의 [11299-11303행](../../packages/core/src/gateway.ts#L11299-L11303)도 이 검사를 사용한다. | 새 환경을 주입해도 이미 임대한 job의 증빙은 바뀌지 않는다. 기존 작업의 lease/차단 상태를 확인하고 정상 복구 경로를 따른다. job, attempt, 원음 기한을 직접 고치지 않는다. |

readiness 성공, `--once`의 단순 실행 성공, NER 모델 적재 성공은 세 증빙의 유효성을 대신하지 않는다. 일반 job의 만료 lease 복구는 다음 정상 claim의 `recoverAgentJobs`가 맡는다([gateway.ts:9411-9415, 9537-9538](../../packages/core/src/gateway.ts#L9411-L9415)). 원음은 별도 삭제 기한의 적용을 받는다. 해당 job의 정상 복구 조건을 확인할 수 없으면 담당 운영자에게 넘기고 직접 재큐잉하지 않는다.

**24시간 계약과 현재 구현의 차이:** 24시간 상한은 [S6:73](../specs/S6-privacy-packet.md#L73)의 요구사항이다. 확인한 claim 파서와 공통 만료 검사에는 `expiresAt <= validatedAt + 24h`를 계산하는 검사가 없다([request-handler.ts:1444-1470](../../packages/http-api/src/request-handler.ts#L1444-L1470), [gateway.ts:9350-9379](../../packages/core/src/gateway.ts#L9350-L9379)). 현재 실패는 주입된 `expiresAt` 도달로 발생한다. 이 구현 누락을 장기 만료값 발급의 허가로 해석하지 않는다.

## 3. 자격 레인 선택 판단표

| 레인 | 상주 데몬 | 수동 실행 | 근거 |
|---|---|---|---|
| E6-4 페어링 | **현재 자동 재시작형 데몬에는 부적합하다.** 최초 인증 요청부터 refresh를 소비하고 회전값은 메모리에만 남는다. 재시작이나 두 프로세스의 동일 refresh 사용은 설치 전체 자격 폐기를 일으킬 수 있다. | **새로 페어링한 값으로 단일 프로세스를 한 번 실행하는 임시 방식만 조건부로 가능하다.** 반복 `--once`도 같은 값 재사용이면 안전하지 않다. 종료 후 다음 실행에는 새 페어링이 필요하다. | 메모리 저장: [api_client.py:173-194](../../apps/pipeline/ccc_pipeline/api_client.py#L173-L194). 최초/주기 교환: [278-325행](../../apps/pipeline/ccc_pipeline/api_client.py#L278-L325). 재사용 폐기: [gateway.ts:14791-14817](../../packages/core/src/gateway.ts#L14791-L14817). |
| Legacy Cloudflare Access 서비스 토큰 | **Access가 실제 앞단에 있는 기존 API에서만 재시작에 상대적으로 안전하다.** 정적 자격이므로 refresh 소비 문제는 없지만 만료, 폐기, Access 정책은 여전히 적용된다. 새 독립 런타임의 대안은 아니다. | 기존 Access API에 한해서 사용할 수 있다. **Access가 없는 독립 런타임에는 수동 실행도 불가하다.** | Agent는 Access ID/Secret 헤더만 보낸다([api_client.py:338-347](../../apps/pipeline/ccc_pipeline/api_client.py#L338-L347)). 기존 adapter는 검증 가능한 JWT assertion을 요구한다([identity-access/index.ts:37-50](../../adapters/identity-access/src/index.ts#L37-L50)). 독립 Cloud runtime은 Agent Bearer와 Supabase Identity를 조합한다([runtime.ts:64-76](../../apps/community-cloud/src/runtime.ts#L64-L76), [agent-identity.ts:20-24](../../packages/http-api/src/agent-identity.ts#L20-L24)). |

**권고: 새 독립 런타임에서는 legacy로 우회하지 말고, §1의 증빙 발급/결속과 아래 URL 차단을 먼저 해소한 뒤 새 페어링을 사용하는 감독하의 단일 수동 실행만 허용하며, refresh 영속화 전에는 KeepAlive 상주 운영을 보류한다.**

추가 선행조건: 현재 `config.py:212-214`는 운영 API URL이 고정 `PRODUCTION_API_BASE_URL`과 다르면 시작을 거부한다([근거](../../apps/pipeline/ccc_pipeline/config.py#L212-L214)). 독립 runtime 주소를 단순 주입해서 해결되지 않는다. `CCC_STT_ENGINE=qwen3-asr`의 운영 실행도 [234-235행](../../apps/pipeline/ccc_pipeline/config.py#L234-L235)에서 제한한다. 이 문서는 엔진 승인이나 동의 게이트를 해제하지 않는다.

레포의 [systemd unit:24-28](../../apps/pipeline/systemd/ccc-pipeline.service#L24-L28)도 환경 파일을 읽고 `Restart=always`를 사용한다. 이를 페어링 환경에 그대로 적용하면 같은 종류의 재시작 위험이 있다. 맥미니용 launchd plist, label, 중지/재시작 wrapper는 확인한 레포에 없다.

## 4. 재시작으로 자격이 닫혔을 때의 복구

여기서는 기존 HTTP API 계약을 적는다. **API가 존재하는 것과 안전한 발급/주입 CLI가 존재하는 것은 다르다.** 응답에 평문 자격이 들어가므로 그대로 출력하는 curl 예시는 제공하지 않는다. 아래 호출은 별도 실행 승인과 비노출 운영 도구를 갖춘 관리자가 수행할 절차이며, 이번 조사에서는 호출하지 않았다.

1. **재시작과 중복 실행을 멈춘다.** 같은 refresh를 반복 전송하지 않는다. KeepAlive 또는 유사 재시작 관리자를 담당 운영자가 기존 장비 절차로 멈춘다. 살아 있는 다른 인스턴스도 확인하되 메모리나 환경을 덤프하지 않는다.
2. **401의 원인을 감사로 구분한다.** 서버는 재사용 시 `agent_pairing_revoke` 감사에 `reason: refresh_reuse`를 남기고, `auth_revocations`에는 `pairing-revoked`를 기록한다([gateway.ts:14711-14727, 14791-14799](../../packages/core/src/gateway.ts#L14711-L14727)). HTTP는 `401 actor_authentication_required`다([request-handler.ts:2302](../../packages/http-api/src/request-handler.ts#L2302)). Agent의 코드 허용목록에는 이 문자열이 없어 내부 `ApiError`의 상세는 `unknown`으로 바뀐다([api_client.py:33-41, 357-382](../../apps/pipeline/ccc_pipeline/api_client.py#L357-L382)). 401 하나만으로 재사용인지 만료인지 구분할 수 없다. 기존 관리자 감사 조회 경로에서 설치 ID와 위 사유를 확인한다.

   3번의 단방향 폐기 전에 관리자가 새 페어링 발급 권한, 활성 service 사용자, 안전한 응답 전달/주입 도구와 §1의 실행 선행조건을 확인한다. 확인되지 않으면 정지 상태를 유지하고 복구를 보류한다. 기존 자격을 다시 시험하거나 임의로 DB를 고치지 않는다.
3. **기관 관리자가 이전 설치를 명시적으로 폐기한다.** `POST /agents/{installationId}/revoke`, 본문 `{}`를 사용한다. 이미 닫힌 자격을 되살리는 동작이 아니라 오래된 설치를 정리하는 동작이다. 재사용 감지는 자격을 닫지만 설치 행의 `revoked_at`까지 바꾸는 것은 아니며, 이 관리자 API가 설치 자체를 단방향 폐기한다([gateway.ts:14848-14868](../../packages/core/src/gateway.ts#L14848-L14868)). 라우트는 [request-handler.ts:3735-3742](../../packages/http-api/src/request-handler.ts#L3735-L3742)에 있다. DB 값을 되돌리지 않는다.
4. **같은 기관의 활성 service 사용자로 새 페어링 코드를 발급한다.** 기관 관리자는 `POST /agents/pairing-codes`에 `actorUserId` 하나를 보낸다. 서버는 사용자 활성 여부, 기관, `role='service'`를 검사하고 새 `installationId`와 10분짜리 1회용 `pairingCode`를 만든다([gateway.ts:14595, 14734-14767](../../packages/core/src/gateway.ts#L14734-L14767), [request-handler.ts:3728-3733](../../packages/http-api/src/request-handler.ts#L3728-L3733)). 기존 설치 ID를 재활용하지 않는다. 적합한 service 사용자가 없으면 관리자 프로비저닝을 별도로 승인받는다.
5. **새 코드를 한 번 교환하고 refresh를 직접 주입 경로로 넘긴다.** `POST /agents/pair`의 본문 필드는 `pairingCode` 하나다. 응답에는 `installationId`, `bearerToken`, `bearerExpiresAt`, `refreshToken`, `refreshExpiresAt`가 있다. 코드와 응답을 채팅, 로그, 터미널, Git 파일에 출력하지 않는다. 응답의 refresh를 새 실행의 `CCC_AGENT_REFRESH_TOKEN`으로 안전하게 연결해야 하지만, 이를 수행하는 레포 CLI는 없다. 승인된 비노출 도구가 없으면 여기서 중단한다. 근거: [request-handler.ts:2464-2475](../../packages/http-api/src/request-handler.ts#L2464-L2475), [gateway.ts:14616-14622, 14774-14783](../../packages/core/src/gateway.ts#L14774-L14783).
6. **다른 인증 레인을 섞지 않고 한 번 시작한다.** production에서 페어링 refresh를 주입할 때 Access ID/Secret과 Preview 코드는 제외해야 한다([config.py:193-224](../../apps/pipeline/ccc_pipeline/config.py#L193-L224)). §1의 증빙과 URL 선행조건을 다시 확인한 뒤 `apps/pipeline`에서 `python3 -m ccc_pipeline`을 실행한다. 이 시작도 첫 인증에서 refresh를 회전하므로 새 값을 보존하지 못한 채 종료하면 다시 같은 복구가 필요하다.
7. **새 설치의 접근과 새 작업 처리를 확인한다.** 새 Agent ID는 `agent:{installationId}`이므로 이전 설치의 claim을 이어받지 않는다([gateway.ts:14600-14605](../../packages/core/src/gateway.ts#L14600-L14605)). 이전 lease는 정상 만료/복구 절차를 기다리고 새 claim과 결과 제출을 확인한다. refresh 교환 성공만으로 NER, 엔진, 동의, 작업 처리까지 복구됐다고 보고하지 않는다.

   검증 범위는 §1의 마지막 단계와 같이 일반 작업과 상담 맥락 작업을 분리해 보고한다. 한 경로의 성공으로 다른 경로까지 복구됐다고 판정하지 않는다.

## 5. 두 문제를 코드로 없애는 최소 순서

아래는 **제안이며 구현하거나 승인한 내용이 아니다.** 변경 전 담당 레인과 소유권을 합의해야 한다. 특히 `apps/pipeline/**`는 현재 작업자의 파일이므로 이 문서 작성자는 수정하지 않는다. 승인 열의 “필요”는 이 조사 요청에 구현 권한이 포함되어 있지 않다는 뜻도 포함한다.

| 순서 | 문제와 최소 변경 | 바꿀 파일 | 위험과 확인 조건 | 승인 필요 여부 |
|---|---|---|---|---|
| 1 | 가장 작은 운영 보조 수정부터 한다. 기존 만료값으로 시작 전 잔여 시간을 검사하고, claim 실패의 허용된 상태 코드만 로그에 남긴다. | `apps/pipeline/ccc_pipeline/config.py`, `apps/pipeline/ccc_pipeline/__main__.py`, `apps/pipeline/ccc_pipeline/worker.py`. | 명확한 증상 표시일 뿐 자동 갱신이나 refresh 영속화의 대체가 아니다. 로그에는 토큰이나 원문 오류를 넣지 않는다. | **필요하다.** 처리 장비 담당 레인과 구현 범위를 합의한다. |
| 2 | Attestation: 날짜만 갱신할 수 없는 기존 결속을 정리한다. install-health와 release의 독립성을 유지하면서 각 증빙의 corpus/result hash를 자기 측정에 대조하고, `validatedAt` 동일성 대신 승인된 연결 관계를 검증한다. 24시간 상한 검사는 공통 경계에 둔다. | `docs/specs/S6-privacy-packet.md`, `packages/contracts/src/agent-jobs.ts`, `packages/core/src/gateway.ts`의 `assertNerReleaseQualification`/`memoryNerQualification`, `packages/http-api/src/request-handler.ts`, `apps/pipeline/ccc_pipeline/config.py`; 저장 필드가 추가될 경우에만 양쪽 DB migration이 필요하다. | 단순히 비교를 삭제하면 미검증 NER도 통과할 수 있다. 독립 health/release 성공, 실패, 만료 경계와 과거 job 증빙 불변성을 확인해야 한다. | **필요하다.** S6 계약 정리와 개인정보 검증 경계 변경을 승인받는다. 유효기간 확대나 threshold 완화는 제안하지 않는다. |
| 3 | 자격: 기존 `AgentCredentialSource`의 저장 경계에 실제 영속 backend를 연결하고 회전 교환을 한 프로세스 안에서 직렬화한다. CLI 진입점은 env-only backend를 상주용으로 선택하지 않게 한다. 독립 runtime 접속에는 기존 설치 계약에 맞춘 API origin 검증으로 고정 Workers URL 제한도 교체해야 한다. | `apps/pipeline/ccc_pipeline/api_client.py`, `apps/pipeline/ccc_pipeline/__main__.py`, `apps/pipeline/ccc_pipeline/config.py`, 필요한 backend 파일. `adapters/secrets-dpapi`는 재사용 가능성을 검토하되 Python에 이미 연결됐다고 가정하지 않는다. URL 근거 계약은 `apps/community-cloud/src/runtime.ts`와 기존 signed manifest다. | 평문 저장, 중복 실행, readiness/작업 요청의 동시 refresh, 저장 실패가 위험하다. 원자적 영속 저장, 단일 실행 잠금, 재시작 후 새 refresh 사용을 검증한다. 서버가 소비한 뒤 응답 수신/저장 전에 죽는 구간은 영속화만으로 없어지지 않으므로 불확실하면 자동 재전송하지 않고 재페어링으로 닫는다. URL 변경은 origin/prefix, HTTPS, 환경 분리를 보존해야 한다. | **필요하다.** 자격 저장 방식, 대상 OS별 SecretStore 접근과 URL 신뢰 경계를 승인받는다. 맥미니에 Windows DPAPI를 적용할 수 있다고 가정하지 않고, 권한 등록/확대와 설치 적용은 별도 승인을 받는다. |
| 4 | 새 기능은 마지막에 만든다. 먼저 실제 health 측정과 attestation 발급, 필요 시 release 등록을 비노출로 수행하는 최소 운영 명령을 만든다. 이것이 검증된 뒤에만 하루 갱신, 안전한 주입, 작업 배출 후 재시작을 묶는다. refresh의 응답 유실까지 자동 복구하려면 별도 재개 프로토콜을 마지막에 설계한다. | `scripts/ner-release/`의 기존 측정 로직을 먼저 재사용하고 필요한 health 발급 도구만 추가한다. 서버 영수증 발급은 `packages/core/src/gateway.ts`와 `packages/http-api/src/request-handler.ts`의 관리자 경계에 둔다. 장비 lifecycle은 `apps/pipeline/ccc_pipeline/__main__.py`, `worker.py`와 별도 장비 실행 설정이 대상이다. | fail-closed 상태에서 자동으로 passed를 만들거나 실패값을 재사용하면 안 된다. release 승인과 일일 health를 분리하고, 새 증빙 검증 실패 시 새 claim을 중단한다. 재시작 도구부터 만들면 refresh 재사용 사고를 자동화한다. 서버 재개 프로토콜은 기존 재사용 탐지를 약화하지 않는 별도 설계가 필요하다. | **필요하다.** 발급 권한, 저장 경로, 자동 실행, 실제 장비 설치를 각각 승인받는다. provider 호출과 운영 활성화도 별도다. |

### 레포에 없어 명령으로 만들지 않은 것

- N corpus의 실측부터 하루 attestation JSON 발급까지 수행하는 CLI와 자동 갱신 timer.
- Production release 영수증의 승인 발급/등록 API 또는 CLI, 세 증빙의 일괄 배포 명령.
- 페어링 발급 응답을 출력하지 않고 refresh 주입까지 연결하는 운영 CLI.
- `EnvAgentCredentialSource`의 회전 refresh를 재시작까지 보존하는 Python backend와 응답 유실 복구 명령.
- 맥미니용 launchd plist/label 및 검증된 중지, 재주입, 재시작 wrapper.
- 현재 장비의 실제 주입 env/path, 일일 갱신 전체 소요 시간과 운영 성공 실측.

검색 범위는 `apps/pipeline`, `scripts`, `packages`, `adapters`, `apps/community-cloud`, `.github`, 관련 운영 문서와 S6다. 외부 운영 도구가 전혀 없다는 주장이나 맥미니에 이런 파일이 없다는 주장은 하지 않는다. 스펙과 코드가 충돌하는 부분은 이 문서에서 덮어쓰지 않고 §5의 승인 대상으로 남긴다.
