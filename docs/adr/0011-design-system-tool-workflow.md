# ADR-0011: 디자인 시스템 구축 도구 워크플로우 (Figma · Pencil · Stitch · Claude)

- 상태: 승인 (2026-07-25, Q)
- 관계: D30(ADR-0008 디자인 레퍼런스 락)의 **실행 파이프라인** — 시각 기준은 불변, 그 기준을 어떤 도구로 어떤 순서로 화면·컴포넌트에 입히는지를 정한다.

## 배경

디자인 시스템 구축에 쓸 수 있는 도구가 4종(Figma MCP, Pen.dev Pencil MCP, Google Stitch MCP, Claude Code)으로 늘었다. 역할 분담 없이 섞어 쓰면 두 가지가 무너진다: ① 원본이 여러 곳에 생겨 어긋났을 때 어느 쪽이 맞는지 판정 불가(이중 관리) ② 비싼 단계(정밀 시안·코드)를 탐색 단계에 낭비.

## 결정

**진실의 원천(SSOT)은 레포의 토큰 파일 하나. 나머지 도구는 각자 잘하는 단계에만 투입한다.**

```
[0 토큰 정의] → [1 Stitch 탐색] → [2 Pencil 정밀화] → [3 Figma 발행] → [4 코드 구현·검증]
     Claude        Stitch MCP        Pencil MCP         Figma MCP        Claude
```

| 단계 | 도구 | 하는 일 | 산출물 |
|---|---|---|---|
| 0 토큰 정의 | Claude | D30·ADR-0008·DESIGN.md를 기계가 읽는 design.md + 토큰 파일로 변환. 웜 뉴트럴 #faf9f7, 리스크 레드 #c22b10 유일 색, Pretendard 트래킹 전부 명시 | **SSOT**: 레포 design.md + 토큰 파일 |
| 1 탐색 | Stitch | `upload_design_md`로 시스템 생성 → 화면마다 `generate_screen_from_text`+`generate_variants` 3~4안 → `apply_design_system`으로 톤 강제. **레이아웃·구조만 취하고 디테일은 버린다** | 방향 선택(Q) |
| 2 정밀화 | Pencil | 고른 방향을 .pen 파일로 토큰 값 그대로, 실제 한글 콘텐츠로 재작성. 채팅 반복 수정. **Q 승인 지점** | 승인된 시안(.pen) |
| 3 발행 | Figma | 승인된 토큰·컴포넌트를 Figma 변수+컴포넌트 라이브러리로 발행. **읽기 사본** — 팀 공유·문서·핸드오프 전용, Figma에서 직접 수정 금지 | Figma 라이브러리 |
| 4 구현 | Claude | apps/web에 shadcn/ui+CSS 변수로 구현 → design-review 검증 → 미리보기 배포로 Q 최종 확인 | 라이브 화면 |

## 근거

1. **이중 관리 차단**: 토큰 원본이 레포 파일 하나라서 Stitch·Pencil·Figma·코드가 어긋나면 "파일과 다른 쪽이 틀림"으로 즉시 판정된다.
2. **비용 배분**: 싼 도구(Stitch)로 넓게 탐색하고, 비싼 단계(Pencil·코드)는 선택된 안에만 쓴다.
3. **D30 강제**: design.md에 락을 박으면 Stitch가 벗어나도 apply_design_system과 2단계 재작업에서 걸러진다.

## 도구별 주의

- **Stitch**: 제약 없이 쓰면 자기 취향(색·장식)으로 그린다 — design.md 없이 화면 생성 금지. 접속은 로컬 shim 경유(서버 스키마 버그 우회, portwright services/stitch.md).
- **Pencil**: 팀 공유·협업 문서 용도로 쓰지 않는다(그건 Figma 몫).
- **Figma**: 원본으로 쓰지 않는다. 라이브러리 갱신은 항상 레포 토큰 변경 → 재발행 방향.

## 첫 사이클

가장 중요한 화면 하나(상담 준비 브리핑)로 0→4를 끝까지 돌려 워크플로우를 검증한 뒤 나머지 화면에 적용한다. 0단계는 기존 DESIGN.md·layout.tsx `:root` 토큰(D30 스킨 패스 상태, STATUS Next 2 참조)을 출발점으로 삼는다.
