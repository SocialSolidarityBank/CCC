# 전달용 핸드오프 프롬프트: 베타 클라이언트 결함 세 개

Q가 직접 붙여 넣는다. 아래 구분선 사이만 복사하면 된다.
받는 쪽은 새 세션이고 대화 이력이 없으므로 이 글 하나로 자족해야 한다.

붙여 넣기 전에 확인할 것 두 가지.

1. mini 오케스트레이터가 인계 패킷에 10장(결함 원인과 계획)을 아직 커밋하지 않았다면,
   커밋을 기다렸다가 전달한다. 프롬프트가 그 10장을 근거로 삼는다.
   **(2026-09-12 완료)** `orchestrate/beta-0.9` `1538229` 로 커밋하고 origin 에 올렸다.
   확인: `git show origin/orchestrate/beta-0.9:docs/superpowers/plans/2026-09-12-beta-0.9-mini-handoff.md`
2. 어느 머신, 어느 워크트리에서 돌릴지는 프롬프트 1번 항목에서 받는 쪽이 스스로 정하게 해 두었다.
   Q가 미리 정했다면 그 줄을 지우고 경로를 박아 넣는다.

***

당신은 CCC 베타 0.9 업무 클라이언트의 결함 세 개를 고치는 구현 레인이다.
대화 이력이 없으니 아래 내용과 지정된 문서만 근거로 삼는다. 추측으로 채우지 마라.

## 0. 먼저 읽을 것

저장소는 `SocialSolidarityBank/CCC`다. 다음 세 가지를 순서대로 읽는다.

1. `docs/superpowers/plans/2026-09-12-beta-0.9-mini-handoff.md`
   브랜치 `orchestrate/beta-0.9`에 있다. 체크아웃 없이
   `git show origin/orchestrate/beta-0.9:docs/superpowers/plans/2026-09-12-beta-0.9-mini-handoff.md`로 읽는다.
   **10장이 이번 작업의 진단과 계획이다.** 3장부터 6장까지는 이미 확인된 사실이니 재조사하지 마라.
2. 저장소 루트의 `CLAUDE.md`. 특히 디자인 소유권 잠금과 레인 예외 절.
3. Mac mini에 있는 Q의 설계 문서 묶음.
   `/Users/barq/DEVELOPER/PROJECTS/CCC/inbox/2026-09-12/`
   먼저 `handoff-decisions-2026-09-12.md`를 읽는다. 정본을 `apps/client`로 잡고
   `apps/web`의 `/admin/*`을 기준에서 뺀 문서다.
   다른 머신에서 작업한다면 그 디렉터리를 먼저 받아 온다.

## 1. 작업 공간

시작 전에 브랜치와 워크트리 게이트를 돌린다.

* 기준은 갓 fetch한 `origin/main`이다. **로컬** **`main`을 쓰지 마라.** 낡아 있을 수 있다.

* 다른 레인이 쓰는 워크트리를 뺏지 마라. 점유돼 있으면 형제 워크트리를 새로 판다.

* `origin/main`에서 토픽 브랜치를 하나 딴다. 이름은 `client/beta-defects-3`.
  같은 이름이 origin에 이미 있으면 만들지 말고 이름을 바꾼다.

* **`orchestrate/beta-0.9`은 mini 오케스트레이터가 쓰는 문서 전용 브랜치다. 건드리지 마라.**

* 상대 레인의 워크트리에서 checkout, reset, clean, stash, 미커밋 파일 정리를 하지 않는다.

작업 전에 한 블록으로 보고한다. 워크트리 경로, 브랜치, 기준 SHA, git status, origin 대비 앞뒤 카운트.

## 2. 고칠 결함 세 개

Q가 실제 베타에서 테스트하다 잡은 것이다. 증상은 사실이고, 원인은 인계 패킷 10장이 짚어 둔 것을
확인한 뒤에 고친다. 10장과 실제 코드가 다르면 코드를 믿고 그 차이를 보고하라.

### 결함 1. 당사자 등록에 당사자 초대 단계가 없다

당사자가 링크로 직접 자기 정보를 쓰고 동의까지 마치는 단계다. D86 ④의 요청 링크 경로이고
화면은 `/participants/invite`와 공개 `/join`이다.

`apps/client/src/business/navigation.ts`의 `participant-invite` 항목에
`feature: 'public_signup'`이 걸려 있어서 `GET /capabilities`의 features가 꺼지면 자리 자체가 사라진다.
**스위치가 꺼진 문제인지 화면 문제인지를 먼저 가른다.** 고칠 자리가 다르다.

### 결함 2. 페이지를 옮길 때마다 서버 연결을 다시 확인한다

"설치 능력과 내 계정을 확인하고 있습니다"가 너무 자주 뜬다.

mini의 1차 진단은 이렇다. 라우트 전환 자체의 비용은 0으로 측정됐으므로 **라우트 캐시는 답이 아니다.**
실제 트리거는 `VerifiedSession`의 remount이고, 재핸드셰이크 동안 이전 세션을 화면에 유지하고
같은 신원의 회전된 토큰을 transport가 받아들이게 하는 쪽이 고칠 자리로 보인다.
다만 **합성 하네스에서 그 깜빡임을 재현하지 못했다.** 그러니 고치기 전에 실제 호출 횟수를 세라.
라우트 전환 한 번에 capabilities와 me를 몇 번 부르는지가 증거다. 추정으로 적지 마라.

### 결함 3. 당사자 등록 뒤 인테이크로 가는 길이 없다

등록을 마쳐도 인테이크 기록으로 이어지지 않는다.
등록 성공 뒤 어디로 보내는지와 `/participants/:id/programs/:caseId/records/intake` 사이가 왜 끊겼는지 본다.
**등록 응답에** **`supportCaseId`가 오는지부터 확인한다.** 안 오면 그게 원인이고 서버 계약 문제다.
그 경우 클라이언트에서 추측으로 만들지 말고 보고하라.

## 3. 소유 경계

* 소유: `apps/client/**` 에서 `apps/client/src/stt-trial/**` 을 뺀 범위.
  필요하면 루트 `package.json`의 client 검사 연결과 `artifacts/design/client/**` 도 만진다.

* **건드리지 않는다**: `apps/client/src/stt-trial/**`,
  `apps/web/app/components/wire/**`, `packages/wire/**`, 공유 CSS, 디자인 토큰,
  `DESIGN.md`, `DESIGN-RULES.md`, 기존 디자인 하니스.
  기존 컴포넌트와 클래스만 재사용한다. **새 컴포넌트나 새 CSS가 필요해지면 거기서 멈추고**
  `docs/superpowers/plans/<날짜>-<주제>-design-handoff.md` 인계 패킷을 써서 DESIGN 레인에 넘긴다.

* 서버 계약을 바꿔야 하면 클라이언트에서 우회하지 말고 멈추고 보고한다.

* 기존 검사 알고리즘, 기준, baseline, assertion을 완화하지 않는다.

## 4. 검증

고친 것마다 실제로 돌린 명령과 결과를 남긴다. 통과했다고 적기 전에 출력을 본다.

```
pnpm --filter @ccc/client run typecheck
pnpm --filter @ccc/client run test
pnpm --filter @ccc/client run build
pnpm run guard:tokens && pnpm run guard:align && pnpm run guard:hierarchy
```

단위 검사만으로 끝내지 마라. 세 결함 전부 **화면에서 실제로 확인한 증거**가 필요하다.
결함 2는 특히 호출 횟수를 재기 전과 후로 나눠 숫자로 적는다.
재현하지 못한 항목은 재현하지 못했다고 적는다. 꾸미지 마라.

회귀 검사는 그럴듯한 버그가 실제로 걸릴 자리에만 남긴다. 검사를 위한 검사는 만들지 마라.

## 5. 하지 말 것

* `main`이나 보호 브랜치에 직접 push.

* 머지, 배포, `ccc-preview` 수동 배포.

* Azure 자원 변경. 이 인계에 배포 승인이 없다.

* 시크릿 값을 읽거나 출력하는 명령. 이름과 존재 여부까지만 다룬다.

* 한국어 산출물에 긴 대시 사용. 가운데 점도 자제한다.

## 6. 산출물

브랜치를 push하고 PR을 연다. PR 본문에 결함별로 증상, 실제 원인, 고친 자리, 검증 증거,
남은 미확인 항목을 적는다. **머지는 하지 않는다.** Q가 확인한 뒤 지시한다.

시작하기 전에 1번의 작업 공간 블록과, 세 결함 각각을 어디서부터 볼지 한 줄씩 먼저 보고하라.
그 보고 뒤에 진행 승인을 기다린다.
