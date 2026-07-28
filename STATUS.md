# STATUS — 비영리 사례관리 프로그램

> **이 레포는 2026-07-28 전환으로 새로 시작했습니다.** 옛 히스토리와 상세 이력은 비공개 아카이브 `SocialSolidarityBank/CCC-archive`에 보존돼 있습니다. 이 문서의 과거 기록은 아카이브의 STATUS.md가 정본이며, 여기에는 개인정보가 포함된 원문을 싣지 않습니다. 옛 이슈·PR을 인용할 때는 `CCC-archive#NN` 형식을 씁니다.

- **Last updated**: 2026-07-28 (Claude Code — 그릴링: D40 용어 개편(기관·실무자·당사자) 스윕 적용 + D41 인테이크 정본 양식 확정. 커밋 전 워킹트리 상태.)
- **Current Phase**: 설계 개편 진행 중. D40 용어 스윕(85파일·624건)과 D41 문서가 워킹트리에 있고 커밋 대기. GAS 보류 결정(기능 전체 보류·스키마 유지)은 확정됐으나 후속(세부 목표 층·화면 재구성)은 인테이크→브리핑→상세 기록 내용 정리 그릴링과 함께 진행하기로 보류.

## Next 3 Actions

1. `red` **D40·D41 커밋** — 용어 스윕 + CONTEXT.md/CLAUDE.md/ADR-0017/PRD 인테이크 정본을 검증 게이트(build·test 426·guard:db 통과 확인됨) 위에서 커밋.
2. `yellow` **그릴링 이어서** — 인테이크 화면 재구현(D41: PII→당사자 등록 흡수 + 금고 확장 마이그레이션) 범위 확정, 이어 브리핑·상세 기록 내용 정리 + GAS 보류 후속(세부 목표 층 처지).
3. `yellow` **PR #5 리베이스** — D40 스윕과 CLAUDE.md §9(D39 vs D40·D41)·CONTEXT.md·apps/web·gateway 충돌 예정. 신규 문자열 140건(참여자 92·상담사 37 등) 동일 매핑 치환 후 재테스트. 머지 시점은 여전히 동의서 법률 검토 게이트(Q 결정). (기존 red 항목 Actions secret 재등록·브랜치 보호·CCC-35 토큰 로테이션은 미완이면 유지 — 아래 History 2026-07-28 항목 참조.)

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

- 2026-07-28 (Claude Code): **그릴링 — D40 용어 개편 + D41 인테이크 정본.** ① D40: 조직→기관 / 상담사→실무자 / 담당자→담당 실무자 / 참여자→당사자 / 시스템 관리자+배정 책임자→기관 관리자(역할 통합, 권한 경계는 승계 — 상담 내용은 담당 케이스만+긴급 접근 예외). 화면·문서만, 코드 식별자 유지. 스윕 85파일·624건, 게이트: build·guard:db·테스트 426개(API 289+웹 137) 전부 통과. 상세 ADR-0017. ② D41: 인테이크 상담지를 Q 제공 질문지 v1로 확정(`PRD/intake-questionnaire-v1.md`) — 1-1 PII는 당사자 등록(pii_vault)으로만 저장+금고 확장(생년월일·주소·성별), 인테이크는 고정 폼(D29 재구성은 정기 상담만), '긴급도'는 리스크 플래그와 별개 필드(실무자 직접, AI 제안 없음). ③ GAS: 기능 전체 보류·스키마 유지 방향 확정, 후속 재설계는 화면 내용 정리 그릴링으로 보류. ④ PR 검토: PR #4(CCC-36) 충돌 없음·수정 불요 / PR #5(CCC-28·29) 리베이스+신규 문자열 치환 필요(기능 자체는 새 결정과 무충돌).
- 2026-07-28 (Claude Code): **gitleaks 자동 검사 연결** — CI에 `secret-scan` 잡 추가(바이너리 v8.30.1 직접 다운로드 — gitleaks-action은 조직 레포 유료 라이선스 필요, `fetch-depth: 0`으로 전체 히스토리 스캔) + `.githooks/pre-commit`에 스테이징 스캔(gitleaks 설치 머신만, CI가 최종 방어선). 로컬 검증: 히스토리 7커밋 no leaks · staged 스캔 정상.
- 2026-07-28 (Claude Code): **공개 레포 노출 점검 + 민감 문단 정리** — 검토 결과 자격증명·실직원 PII 0건(green). 운영 ID(Slack `#ccc-tickets` 채널 ID·에이전트 계정 ID·Linear 연동 UUID)와 과거 보안 대응 경위의 세부 문구를 공개 문서에서 제거, ID 실값은 `~/developer/tools/portwright/services/linear.md`로 이관. URL(`*.workers.dev`)은 기능 설정에 필수 + Access/코드 게이트 보호라 존치. 잔여 권고: gitleaks를 CI에 연결(현재 설정 파일만 있고 자동 실행 없음).
- 2026-07-28 (Claude Code): **CCC-31 완료 — 인테이크 저장→브리핑 직행 + 브리핑 상단 '다음 상담 등록' 안내 한 줄(스펙 #78 US 17·18).** 인테이크 위저드 '완료' 성공 시 기록지 화면이 아니라 그 참여 사업의 **브리핑으로 router.push**(`?notice=intake_saved` 부착). 브리핑은 `IntakeSavedNotice`를 HERO 위(=페이지 상단)에 1회 렌더 — 값이 `intake_saved`일 때만, 마운트 직후 `history.replaceState`로 파라미터 제거(새로고침 재표시 차단 + 서버 컴포넌트/감사 중복 회피 D14). 안내줄 시각은 블루 tint(시간·상태 축 D34) + `--line` 1px + radius 12, 리스크 배너 어휘 차용 안 함(D9), 버튼은 세컨더리(프라이머리는 HERO 몫 §4-5)로 `/schedules/new?target=<beneficiary>|<case>` 직행(참여 사업 선택 선입력). 게이트: build + 웹 테스트 137개 + guard:db + 브라우저 journey(`scripts/design/journey-intake-redirect.py`, 증거 `artifacts/journey/intake-redirect/` — 저장→`/briefing?notice=intake_saved` 도착 · 배너 표시 · 파라미터 제거 · CTA target 선입력 · 재로드 시 배너 없음, page_errors 0). 마이그레이션 없음(웹+문서).
- 2026-07-28 (에이전트): **레포 전환** — 구레포 `CCC-archive` private 보관 + 새 `CCC` 공개 레포 스냅샷 이전. 상세는 아카이브 STATUS.md와 로컬 핸드오프 `docs/handoffs/2026-07-28-repo-reset.md`(미추적) 참조.
- 전환 이전의 전체 이력: `SocialSolidarityBank/CCC-archive`의 STATUS.md (비공개).
