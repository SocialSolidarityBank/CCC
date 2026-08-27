# 디자인 통일 검수 기록 (design-reviewer 레인)

- 일시: 2026-08-27
- 검수자: design-reviewer 계약(`.claude/agents/design-reviewer.md`)을 따른 독립 검수 레인.
  구현 맥락과 분리해 실행했다(ADR-0034 결정 4).
- 범위: 브랜치 `ooo/design-unification`의 `origin/main` 대비 전체 변경
  (승인 대장, 라우트 인벤토리, 스윕 도구, 위계 감사 강화, CI design-sweep 잡, 실측 근거 6장)

## 판정

**지적 확실 3건, 판단 필요 0건. 3건 전부 같은 브랜치에서 해소 후 재검증 통과.**

| # | 지적 | 해소 |
| --- | --- | --- |
| 1 | `hierarchy-audit.mjs`의 전역 `p` 면제가 클래스 없는 `p`의 16/400 `--sub`(§1이 이름 박은 표 밖 조합)를 감사 밖으로 숨긴 채 미확정 0건을 선언 | 면제를 제거하고 `layout.tsx` 전역 `p`에 세 축을 실효값 그대로 명시(시각 변화 0). 해당 조합은 기존 부채로 baseline에 등재해 감사가 표면에 들게 함. 신규 위반 0, 미확정 0 유지 |
| 2 | 승인 대장의 '기계 검증' 문구가 존재하지 않는 PNG 실폭 검사를 주장 | `axis-approvals.test.mjs`에 PNG 시그니처, IHDR, 실폭(파일명 폭 x2, DPR 2) 검사를 실제 구현. 6장 전부 통과 |
| 3 | 스윕 안내의 API 포트 오기(8797)와 주어 오독 소지 | 8787로 정정하고 '띄워 둔 상태에서 실행'으로 문구 교정, 포트 분리 시 `SHOT_BASE`·`CCC_API_ORIGIN` 정렬 안내 유지 |

## 검수가 확인한 통과 항목

- `wire-styles.ts`·`layout.tsx` 역할 선언 18곳이 DESIGN-RULES §1 위계 표와 §4 deep 글자 규칙에 부합
- `.wire-modal-desc`의 16 → 14 이동은 §1 예시 위반 조합을 표 안 ④로 닫는 올바른 수정
- 라우트 인벤토리 30건의 경로, fixture 변수, 권한 표기가 실제 화면 코드와 일치

전문 기록: 검수 레인 대화 기록(DesignReviewLane)과 이 문서가 AC6의 승인 증적이다.
