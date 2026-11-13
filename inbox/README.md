# CCC 정본 세트 (2026-09-02)

개발 세션에 넘기는 순서. 이 폴더 밖의 노션 문서는 "참고"이지 정본이 아니다.

1. `docs/adr/0041-one-core-three-deployment-modes.md` - 모든 결정의 정본. 레포 `docs/adr/`에 그대로 넣고 CLAUDE.md 9장에 D76~D83 등재.
2. `PRD/CCC-open-pilot-v0.2.md` - 모드 × 기능 표. 레포 `PRD/`에 넣는다.
3. `docs/specs/SPEC-TEMPLATE-and-S1-example.md` - 스펙 양식 + S1 예시. S2~S15는 이 양식으로 한 세션에 하나씩.
4. `docs/superpowers/plans/TICKET-PROMPT-TEMPLATE-and-E1-2-example.md` - 티켓 프롬프트 양식 + E1-2 예시. 티켓마다 이 양식으로 파일 하나.

스펙 목록(S1~S15)과 티켓 목록(E0~E12, 82개)은 `../handoff-implementation-plan-review-2026-09-02.md` 2.2절과 2.3절에 있다.

넣는 방법: 이 폴더를 레포 루트에 겹쳐 복사한다(`cp -r ccc-canon/* CCC/`). 그다음 노션의 9/01 통합본, 9/02 배포 방식 검토, 9/02 HANDOFF 머리말에 "Superseded by ADR-0041"을 붙인다.
