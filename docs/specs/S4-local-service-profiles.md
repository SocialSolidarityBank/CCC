# S4: Local service profiles

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D78, D82, D83; `CCC_OPEN_PILOT_PLAN.md` SG4 및 E8-8
- 입력: `docs/specs/SPEC-TEMPLATE-and-S1-example.md`, `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`
- 산출: Local Single과 Local Office의 서비스 프로파일 계약, 모드 차이표, E7·E8 증거 목록, E8-8 부하 판정 기준
- 관련 티켓: E7-1a, E7-1b, E7-2, E7-3, E7-4, E7-5, E7-6a, E7-6b, E8-1, E8-2, E8-3, E8-4, E8-5, E8-6, E8-7, E8-8, E8-9

## 1. 목적

공통 코어와 일곱 런타임 포트를 유지하면서 Local Single과 Local Office의 접속, 신원, 운영 책임 경계를 고정한다. Single은 한 사용자의 PC 안에서만 동작하고, Office는 한 기관의 내부망에서 두 client가 중앙 서버를 함께 사용한다. 이 문서의 `확정`은 계약 완결을 뜻하며, 실제 Windows 실행 증거는 관련 E 티켓이 소유한다.

## 2. 인터페이스와 규칙

### 2.1 서비스 프로파일

```ts
export type SingleProfile = {
  kind: 'single';
  mode: 'local-single';
  bind: { host: '127.0.0.1'; port: 'ephemeral' };
  identity: { kind: 'os-user-app-lock'; stableUserId: string };
  tls: 'electron-same-origin-loopback';
  serviceAccount: 'interactive-user';
  scheduler: 'node-process-timer';
  backup: 'per-user-encrypted';
  update: 'electron-nsis-signed';
  firewall: 'loopback-only';
  recovery: 'recovery-kit-new-pc';
};

export type OfficeProfile = {
  kind: 'office';
  mode: 'local-office';
  bind: { host: string; privateCidr: string; port: 8443; ipv6: 'disabled' | 'configured-ula' };
  identity: { kind: 'argon2id-account'; adminMfa: true };
  tls: { minimumVersion: 'TLS1.2'; nameConstraints: 'rfc5280-configured-server' };
  serviceAccount: 'dedicated-windows-service';
  scheduler: 'service-owned-node-scheduler';
  backup: 'central-encrypted-server-backup';
  update: 'server-and-client-signed';
  firewall: 'private-domain-8443-only';
  recovery: 'server-replacement-preserve-ca';
};

export type LocalServiceProfile = SingleProfile | OfficeProfile;
```

두 프로파일은 `Database`, `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `STTProvider`, `AIProvider` 포트와 공통 Application Service를 사용한다. 평문 SQLite로 fallback하지 않으며 설치 직후 STT는 `off`, `sttEngine`은 `null`이다.

### 2.2 보안·운영 불변조건

- Single은 `127.0.0.1` 하나에만 OS가 고른 임의 port로 bind한다. `::1`, 외부 NIC, wildcard host, LAN 주소 bind, 포트 포워딩은 사용하지 않는다. Electron 셸은 custom protocol 또는 local-service same-origin으로 정적 client를 제공하며, DPAPI로 보호한 endpoint discovery 정보 외에는 port를 노출하지 않는다.
- Single stable user ID는 설치 때 무작위로 생성하고 SID에서 파생하지 않는다. DPAPI `CurrentUser`와 SG9 Recovery Kit에 보관하며 새 PC·다른 SID 복원 뒤에도 동일해야 한다. bearer와 앱 잠금 상태는 메모리에만 둔다.
- Office는 관리자가 지정한 RFC1918 IPv4 주소와 `privateCidr`가 일치할 때만 TCP 8443을 연다. IPv6는 명시적으로 설정한 ULA가 아니면 거부한다. 공인 주소, wildcard bind, Public 프로필과 포트 포워딩은 구성 검증에서 거부한다. 실제 외부 도달 가능성은 startup router introspection이 아니라 E8-6 방화벽 시험이 판정한다.
- Office는 TLS 1.2 이상만 허용한다. CA의 RFC5280 `nameConstraints`는 설정된 서버 DNS/IP 범위로 제한하고 server certificate SAN은 그 범위 안에 있어야 한다. HTTP listener와 cleartext redirect를 열지 않는다. 로컬 CA를 기본으로 사용하고 기관 인증서가 있으면 기관 인증서를 우선한다.
- Office 설치기는 무작위로 만든 password를 표시하거나 재사용하지 않는 전용 local Windows Service 계정을 만들고 SCM이 해당 계정의 profile을 로드하게 한다. 이 계정은 local logon과 RDP logon을 거부한다. 서비스 계정은 scheduler·health 전용 service principal이며 사용자 `Actor`로 인증되지 않는다.
- 두 Local 모드의 DB·file·PII·CA key는 DPAPI `CurrentUser`로 암호화한다. 중앙 Office backup에는 평문 key를 넣지 않고 SG9 Kit envelope 안에만 포함한다. 복원 passphrase는 입력·검증 순간에만 사용하고 저장하거나 출력하지 않는다. Kit verify와 hash 검증, 새 service account로의 rewrap를 통과한 뒤에만 DPAPI key를 원자적으로 교체한다. service account reset은 기존 DPAPI를 무효화하며 SG9 Kit만 복구 경로다.
- Single scheduler는 interactive local-service의 Node timer가 공통 runner를 호출하고 앱 종료 뒤 다음 실행 기회에 재개한다. Office scheduler는 Windows Service의 Node scheduler와 watchdog가 호출하며 client는 scheduler가 되지 않는다.
- Single backup은 사용자별 암호화 자동·수동 backup이고 update 전 backup 및 health 실패 rollback을 포함한다. Office backup은 중앙 서버의 암호화 SQLite·파일·CA identity를 함께 보존하고, 외장 디스크는 backup destination으로만 사용한다.

### 2.3 E7·E8 owner와 증거

각 구현 티켓은 아래 경로에 증거를 남긴다. 증거는 secret, raw SID, bearer, PII를 포함하지 않으며 JSON에는 `mode`, `build`, `fixtureHash`, `startedAt`, `finishedAt`, `verdict`를 포함한다.

| 계약 | 구현 owner | 정확한 증거와 통과 판정 |
|---|---|---|
| Single bind·stable identity·endpoint discovery | E7-1a, E7-1b | `artifacts/e7-1b-single-profile.json`, `artifacts/e7-1b-single-listeners.txt`; `127.0.0.1` 외 listener 0건, SID 비파생 stable ID, DPAPI endpoint discovery, raw SID·bearer 저장 0건 |
| Single 앱 잠금·interactive 경계 | E7-2 | `artifacts/e7-2-single-app-lock.json`; 잠금 중 업무 API 거부, unlock 뒤 stable ID 동일, crash 뒤 bearer 잔존 0건 |
| Single backup·새 PC recovery | E7-3 | `artifacts/e7-3-single-backup-restore.json`; Kit passphrase 비저장, Kit verify·hash·다른 SID rewrap, 100 cases와 금고 열람·기록 저장 복원 |
| Single installer | E7-4 | `artifacts/e7-4-single-install.json`; 깨끗한 Windows x64에서 Electron·NSIS 설치·제거, Agent 후설치와 AI Off doctor 기록 |
| Single offline·AI Off | E7-5 | `artifacts/e7-5-single-offline-ai-off.json`; offline·provider Off·키 없음에서도 수기 기록·15초 페이지·export 유지, 자동 전환 0건 |
| Single update·rollback·서명 | E7-6a, E7-6b | `artifacts/e7-6-single-update-rollback.json`, `artifacts/e7-6b-single-authenticode.json`; update 전 backup, health 실패 rollback, unsigned·downgrade 거부 |
| Office account·LAN bind·scheduler | E8-1 | `artifacts/e8-1-office-service-profile.json`; installer-created 계정·random password 비표시·logon 거부·SCM profile, private bind, service principal, watchdog·WAL health PASS |
| Office TLS·cleartext 차단 | E8-2 | `artifacts/e8-2-office-tls.json`; TLS ≥1.2, RFC5280 nameConstraints와 SAN 범위, HTTPS 성공, HTTP·cleartext redirect 0건 |
| Office client 2대·firewall | E8-3, E8-6 | `artifacts/e8-3-office-two-clients.json`, `artifacts/e8-6-office-firewall.json`; 두 client 재설치 없이 접속, CCC executable의 configured subnet TCP 8443만 허용, 외부 도달 0건 |
| Office identity·409·MFA | E8-4, E8-7 | `artifacts/e8-4-office-conflict-409.json`, `artifacts/e8-7-office-admin-mfa.json`; 역할·담당 범위·관리자 MFA 감사, 아래 409 기준 |
| Office backup·server replacement | E8-5 | `artifacts/e8-5-office-server-replacement.json`; SG9 Kit verify/hash·새 service account rewrap, DB·files·CA fingerprint 일치, client 재설치 없이 HTTPS·금고·신규 기록 복구 |
| Office installer | E8-9 | `artifacts/e8-9-office-install.json`; 계정·SCM profile·TLS·firewall·health·uninstall 전부 기록 |
| E8-8 replacement automation·load | E8-8 | 아래 `artifacts/e8-8/{runId}/load.json`, `histogram.json`, `memory.csv`, `hardfault.csv`, `restart.json`, `restore.json`; 실패 run도 삭제하지 않으며 모두 판정에 남김 |

## 3. 세 모드 차이와 E8-8 고정 게이트

### 3.1 차이표

| 항목 | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| bind | 기관 소유 Supabase의 인터넷 HTTPS | `127.0.0.1` 하나, 임의 ephemeral port | 설정된 RFC1918 IPv4, TCP `8443`, ULA는 명시 때만 |
| identity | Supabase Auth·MFA에서 `Actor`로 변환 | 설치 시 무작위 stable ID·OS user·앱 잠금 | Argon2id 계정·관리자 MFA·전용 service principal |
| TLS·service account | Supabase HTTPS·관리형 실행 | Electron same-origin·interactive user | TLS 1.2+·name-constrained CA·전용 Windows Service 계정 |
| scheduler | 관리형 scheduler | Node timer | service-owned Node scheduler·watchdog |
| backup·recovery | E6-7 기관 프로젝트 backup/restore | 사용자별 backup·SG9 Kit·새 PC rewrap | 중앙 backup·SG9 Kit·CA 보존 server replacement |
| update·firewall | Cloud 운영 경계 | Electron + NSIS 서명·loopback만 | server/client 서명·Private/Domain 8443만 |

Community Cloud의 adapter와 backup/restore는 E6-7이 소유하며, 이 S4는 local profile과 비교 기준만 정한다.

### 3.2 E8-8 측정 envelope와 closed-loop workload

- 서버는 qualifying reference CPU class인 Intel Core i5-8500T (6 cores/6 threads, 2.10GHz base)에서 Windows 11 Pro 24H2 x64를 실행한다. CPU affinity와 Windows Job Object로 최대 8 logical cores를 사용하고 RAM cap은 16GiB로 고정한다. Node는 `24.13.3`이어야 한다. CPU model, base clock, affinity mask, RAM cap, optional benchmark 결과(정보용), NVMe storage model, OS build, service build, Node version, SQLite WAL 설정과 유선 1Gbps LAN을 `artifacts/e8-8-freeze.json`에 기록한다. 다른 CPU class의 실행은 수치가 좋아도 이 gate에서 `미측정`이며 PASS가 아니다. 두 client는 Windows 11 Pro 24H2 x64, 4 logical cores 이상, RAM 8GiB 이상, 같은 LAN을 사용한다.
- 서버에는 Office service와 측정 도구만 실행한다. STT·LLM은 `off`, Agent·backup·Windows Update·화면 보호는 측정 중지 상태다. fixture seed와 canonical JSON·attachment manifest의 SHA-256은 사전 동결한다.
- fixture는 PII가 없는 100 cases이며 case마다 participant 1명, session 3개, note 2~4KiB, draft 2~4KiB, action item 3개, flag 2개, 결정론적으로 생성한 정확히 2MiB encrypted attachment 1개를 가진다. 100 cases를 10개의 disjoint partition으로 나누고 각 논리 session은 서로 겹치지 않는 10 cases만 사용한다.
- client 2대에서 논리 session을 각각 5개씩 실행한다. 각 persistent connection은 응답의 마지막 body byte를 받은 즉시 다음 요청을 보내는 closed-loop 방식이다. 각 session은 30분 동안 30회 이상 case 목록 조회, 15초 페이지 조회, session draft 저장, 일정 조회, `expectedVersion` 기록 저장을 수행해 정상 요청 1,500건 이상을 만든다. warmup 1회는 percentile에서 제외한다. 측정 중 aggregate in-flight가 5 이상인 1초 sample이 전체 sample의 50% 이상이고, warmup 뒤 5 req/s 이상을 지속해야 한다.
- hard paging은 Windows inbox WPR command `wpr -start Memory -filemode`로 capture하고 `wpr -stop artifacts/e8-8/{runId}/hardfault.etl`로 저장한다. ETW provider/event는 `Microsoft-Windows-Kernel-Memory/HardFault`의 WPR `Memory/HardFault` event로 고정하며, 수집한 ETL은 Job Object member PID만 남기도록 필터링해 `hardfault.csv`의 1초 bucket으로 변환한다. steady-window 평균은 `≤ 5 events/s`, 어떤 60초 rolling window도 `> 20 events/s`가 없어야 한다.
- `artifacts/e8-8-freeze.json`은 부하 시작 전에 이 spec commit으로 커밋하며 threshold와 envelope를 먼저 기록한다. 각 실행은 immutable run ID로 `artifacts/e8-8/{runId}/`에 저장하고 성공·실패·중단 run을 모두 보존한다. 불리한 결과 뒤 threshold, seed, fixture, concurrency, duration, 측정 시간을 바꿀 수 없다. envelope 밖 실행은 PASS가 아니라 `미측정`이다.

### 3.3 판정 기준

| 게이트 | 고정 기준 | 실패 판정 |
|---|---|---|
| latency | warmup 뒤 정상 요청의 request send 시각부터 마지막 response body byte까지 `p50 ≤ 250ms`, `p95 ≤ 750ms`, `p99 ≤ 1,500ms`; 10초 per-request timeout은 error로 집계; histogram을 `histogram.json`에 기록 | percentile 초과, histogram 누락, timeout 포함 error 누락이면 FAIL |
| error rate | 의도하지 않은 timeout·connection error·5xx 합계 `≤ 0.5%`; 계약 위반 4xx `0%`; 409 경쟁 요청은 별도 집계 | 기준 초과 또는 누락 요청이면 FAIL |
| memory | Windows Job Object로 Office service와 descendants를 묶고 5초마다 private bytes와 job commit을 기록한다. job commit peak `≤ 640MiB`로 고정한다. ETW provider/event `Microsoft-Windows-Kernel-Memory/HardFault`를 Job Object member PID로 필터링해 1초 bucket을 만든다. steady-window 평균 `≤ 5 events/s`, 어떤 60초 rolling window도 `> 20 events/s`가 없어야 한다 | job commit peak 초과, hard-fault 평균·rolling 기준 초과, ETW 증거 누락이면 FAIL |
| 409 correctness | 20개 이상 서로 다른 row pair마다 같은 `expectedVersion` 두 요청을 동시에 보낸다. pair마다 conflict-code `409` 정확히 1건, winner 성공 1건, version 증가 1회, winner audit 1건, loser audit 0건, 무음 덮어쓰기 0건 | 개수·version·audit가 다르면 FAIL |
| restart | pre-restart 2xx client write ledger를 request ID와 row hash로 기록한다. latency/error에서 제외하는 구간은 정확히 `[restart command sent, health PASS observed]`이며 이 구간을 별도로 보고하고 총 `≤ 30s`여야 한다. 재시작 뒤 ledger reconcile은 loss 0, duplicate 0이고 commit된 row·fixture count와 WAL integrity가 같아야 한다 | 시간 초과, ledger loss/duplicate, row 손실·중복, integrity 실패면 FAIL |
| restore | backup 뒤 clean replacement server에서 restore 시작부터 HTTPS health PASS까지 `≤ 15min`; 100 cases·300 sessions·attachment hash와 files hash 일치, CA fingerprint 유지, SG9 Kit verify/hash·새 service account rewrap, 기존 두 client 재설치 0건, 각 client 신규 기록 저장 PASS | 누락·불일치·Kit 검증 실패·재설치 필요면 FAIL |

## 4. 완료 조건

- [ ] 이 문서는 `확정` 상태이며 `SingleProfile | OfficeProfile`과 bind, identity, TLS, service account, scheduler, backup, update, firewall, recovery 규칙이 완결되어 있다.
- [ ] Community Cloud를 포함한 세 모드 차이와 Local Single·Office의 E7·E8 owner 및 정확한 증거 경로가 완결되어 있다.
- [ ] fixed seed, disjoint 100-case fixture, 10 concurrent logical sessions, client 2대, closed-loop persistent connection, in-flight·throughput 조건, exact reference CPU envelope와 config가 고정되어 있다.
- [ ] latency percentile, 10초 timeout error, error rate, Job Object memory ceiling, 409 correctness, restart interval/ledger, restore·CA·SG9 evidence threshold가 고정되어 있다.
- [ ] 부하 전 커밋되는 freeze manifest, run별 immutable evidence, 실패 run 보존과 결과 뒤 threshold 변경 금지 규칙이 문서에 있다.
- [ ] 검증 명령과 실패 판정이 §5에 완결되어 있고, 실제 실행 결과를 요구하지 않는다.

## 5. 검증 방법

SG4의 runtime·golden 명령은 저장소의 `test:runtime`과 `test:golden`에서 호출하는 subset이다. 구현 검증 때 아래 entrypoint가 정확한 증거 파일을 만든다.

- `pnpm test:runtime --mode=local-single --spec=SG4`: SingleProfile, `127.0.0.1` 단일 listener, SID 비파생 stable ID, DPAPI endpoint discovery와 app-lock 계약이 하나라도 어긋나면 FAIL이다.
- `pnpm test:runtime --mode=local-office --spec=SG4`: RFC1918 bind, service account·SCM profile, TLS 1.2+·nameConstraints, scheduler, WAL과 firewall 계약이 하나라도 어긋나면 FAIL이다.
- `pnpm test:golden --mode=local-single --spec=SG4`: Single backup·SG9 Kit verify/hash·다른 SID rewrap·update rollback을 증거와 함께 확인하며 하나라도 없으면 FAIL이다.
- `pnpm test:golden --mode=local-office --spec=SG4 --cases=100 --concurrency=10 --clients=2 --duration=30m --freeze=artifacts/e8-8-freeze.json`: §3.3의 한 게이트라도 FAIL이면 E8-8은 FAIL이다. restart·restore 증거가 없으면 성능 수치가 모두 통과해도 FAIL이다.

`확정`은 위 계약, fixture, threshold, 증거 경로와 검증 명령이 문서로 닫힌 상태를 뜻한다. 실제 Windows 실행 결과를 기록한 뒤에만 관련 E 티켓이 `구현 검증 완료`가 된다.

## 6. 이번에 안 하는 것

Community Cloud adapter와 Cloud backup/restore는 E6-7이 소유한다. Local Single과 Office의 실제 Windows adapter, 설치기, 인증서 발급, 방화벽 변경, backup 실행과 부하 실행은 각각 §2.3의 E7·E8 티켓이 소유하며 이 문서에는 구현 코드를 넣지 않는다. 기관 자체 클라우드, public reverse proxy, 외부 원격 접속, 다중 서버 HA와 자동 provider fallback은 ADR-0041 범위 밖이다.
