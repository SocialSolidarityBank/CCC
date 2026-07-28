# STATUS — 비영리 사례관리 프로그램

> **이 레포는 2026-07-28 전환으로 새로 시작했습니다.** 옛 히스토리와 상세 이력은 비공개 아카이브 `SocialSolidarityBank/CCC-archive`에 보존돼 있습니다. 이 문서의 과거 기록은 아카이브의 STATUS.md가 정본이며, 여기에는 개인정보가 포함된 원문을 싣지 않습니다. 옛 이슈·PR을 인용할 때는 `CCC-archive#NN` 형식을 씁니다.

- **Last updated**: 2026-07-28 (Claude Code — CCC-36 반영: 정책 v0.2 + 쉬운 버전 정리. 직전 갱신: gitleaks 자동 검사 연결 — CI `secret-scan` 잡(전체 히스토리, 매 push/PR) + pre-commit 스테이징 스캔(설치 머신만).)
- **Current Phase**: 전환 직후 정비. 코드 스냅샷은 아카이브의 `origin/main`과 동일하나, 새 레포에는 GitHub 설정(Actions secret·브랜치 보호)과 일부 문서(이 STATUS·핸드오프)가 비어 있다. 기능 개발 재개 전 아래 Next Actions를 끝낸다.

## Next 3 Actions

1. `red` **Actions secret 재등록** — 새 레포 Settings → Secrets and variables → Actions에 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 등록. 없으면 main push 시 `Deploy Preview`가 조용히 인증 실패한다. 등록 후 첫 push로 green 확인.
2. `yellow` **브랜치 보호 설정** — 아카이브에도 없었으나 공개 레포 전환을 계기로 `main` 보호(PR 필수·관리자 예외) 검토.
3. `yellow` **CCC-28/29 가입 흐름 복구** — 로컬 `feat/ccc-28-signup`의 커밋 2개(`5bc55ce`·`19ce428`)를 새 main에 체리픽 + 미리보기 공개 표면 차단. 절차·충돌·게이트는 **Linear CCC-28** 코멘트에 있다. 머지(=미리보기 재배포)는 동의서 법률 검토 뒤 Q 결정
4. `yellow` **CCC-35 Access 서비스 토큰 로테이션** — 히스토리를 버려도 Cloudflare 측 토큰은 살아 있으므로 별개 로테이션 필요.

## 전환 요약 (2026-07-28)

- **왜**: 공개 레포의 git 히스토리에 실직원 이메일 커밋이 SHA 직접 조회로 접근 가능했다(과거 가명화가 새 커밋으로만 덮고 히스토리 재작성은 안 함).
- **어떻게**: 구레포를 `CCC-archive`로 이름 변경 + private 전환(무인증 접근 차단) → `origin/main`의 깨끗한 스냅샷을 새 `CCC` 공개 레포로 이전.
- **제외**: STATUS.md(이 파일)·`docs/handoffs/`는 실 이메일·로컬 경로 포함이라 스냅샷에서 제외하고 가명화해 재생성.
- **검증**: 실직원 개인 이메일 0건 · gitleaks no leaks · 첫 커밋 author는 조직 계정 · 무인증 차단 404(아카이브) / 공개 200(새 레포).
- **함정**: 이름 재사용으로 옛 클론의 origin URL이 새 공개 레포로 해석된다 — 모든 옛 클론은 origin을 `CCC-archive.git`으로 재지정하거나 **새로 clone**해야 한다(옛 클론에서 새 CCC로 push 금지).

## Blockers

- 노트북 파이프라인(Part B)은 해당 하드웨어 위 세션 필요.
- Claude 대조 프롬프트(2단계-c)는 상담 템플릿 스펙 확정(D29) 선행.

## History

- 2026-07-28 (Claude Code): **gitleaks 자동 검사 연결** — CI에 `secret-scan` 잡 추가(바이너리 v8.30.1 직접 다운로드 — gitleaks-action은 조직 레포 유료 라이선스 필요, `fetch-depth: 0`으로 전체 히스토리 스캔) + `.githooks/pre-commit`에 스테이징 스캔(gitleaks 설치 머신만, CI가 최종 방어선). 로컬 검증: 히스토리 7커밋 no leaks · staged 스캔 정상.
- 2026-07-28 (Claude Code): **공개 레포 노출 점검 + 민감 문단 정리** — 검토 결과 자격증명·실직원 PII 0건(green). 운영 ID(Slack `#ccc-tickets` 채널 ID·에이전트 계정 ID·Linear 연동 UUID)와 과거 보안 대응 경위의 세부 문구를 공개 문서에서 제거, ID 실값은 `~/developer/tools/portwright/services/linear.md`로 이관. URL(`*.workers.dev`)은 기능 설정에 필수 + Access/코드 게이트 보호라 존치. 잔여 권고: gitleaks를 CI에 연결(현재 설정 파일만 있고 자동 실행 없음).
- 2026-07-28 (Claude Code): **CCC-36 반영** — 내부 운영 정책 v0.2. 6장을 운영 규칙만 남기고 정리하고, 상세 추적은 비공개(Linear CCC-36 · CCC-archive)로 옮겼다. 쉬운 버전(`artifacts/ccc-policy-for-workers-v0.1.html`)의 대응 절도 같은 기준으로 맞췄다. 판단 근거·수용한 한계·남은 별도 작업은 Linear CCC-36 코멘트에 있다(공개 레포에 두지 않는다). **CCC-28/29 복구 설계**도 함께 마쳐 Linear CCC-28 코멘트에 두었다 — 새 main과 `feat/ccc-28-signup`은 공통 조상이 없어 체리픽만 가능하고(마이그레이션 0018·0019 번호 충돌 없음, 두 커밋에 실직원 식별자 0건), 미리보기 환경에는 공개 표면을 두지 않기로 Q가 결정했다.
- 2026-07-28 (Claude Code): **CCC-31 완료 — 인테이크 저장→브리핑 직행 + 브리핑 상단 '다음 상담 등록' 안내 한 줄(스펙 #78 US 17·18).** 인테이크 위저드 '완료' 성공 시 기록지 화면이 아니라 그 참여 사업의 **브리핑으로 router.push**(`?notice=intake_saved` 부착). 브리핑은 `IntakeSavedNotice`를 HERO 위(=페이지 상단)에 1회 렌더 — 값이 `intake_saved`일 때만, 마운트 직후 `history.replaceState`로 파라미터 제거(새로고침 재표시 차단 + 서버 컴포넌트/감사 중복 회피 D14). 안내줄 시각은 블루 tint(시간·상태 축 D34) + `--line` 1px + radius 12, 리스크 배너 어휘 차용 안 함(D9), 버튼은 세컨더리(프라이머리는 HERO 몫 §4-5)로 `/schedules/new?target=<beneficiary>|<case>` 직행(참여 사업 선택 선입력). 게이트: build + 웹 테스트 137개 + guard:db + 브라우저 journey(`scripts/design/journey-intake-redirect.py`, 증거 `artifacts/journey/intake-redirect/` — 저장→`/briefing?notice=intake_saved` 도착 · 배너 표시 · 파라미터 제거 · CTA target 선입력 · 재로드 시 배너 없음, page_errors 0). 마이그레이션 없음(웹+문서).
- 2026-07-28 (에이전트): **레포 전환** — 구레포 `CCC-archive` private 보관 + 새 `CCC` 공개 레포 스냅샷 이전. 상세는 아카이브 STATUS.md와 로컬 핸드오프 `docs/handoffs/2026-07-28-repo-reset.md`(미추적) 참조.
- 전환 이전의 전체 이력: `SocialSolidarityBank/CCC-archive`의 STATUS.md (비공개).
