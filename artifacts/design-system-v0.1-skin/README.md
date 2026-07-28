# V0.1 스킨 패스 렌더 근거 (2026-07-26)

디자인 시스템 V0.1을 라이브 화면에 입힌 결과다. 브랜치 `design/system-v0.1-skin`, 상세는 STATUS.md History.

색만 바뀌는 작업은 테스트가 통과하면서 화면이 깨질 수 있어서, 이 폴더에 결정과 결과를 남긴다.

| 파일 | 무엇 |
| --- | --- |
| `briefing-before.png` · `briefing-after.png` | 상담 준비 화면. 검정 와이어프레임에서 V0.1로 넘어간 대비 |
| `risk-banner-after.png` | 확인된 리스크가 있는 케이스. 4중 신호(아이콘·문구·고정 위치·접힘 불가)와 이슈 CCC-archive#49 액센트 띠 제거 확인 |
| `risk-banner-contrast-default.png` · `risk-banner-contrast-high.png` | 고대비 모드 스위치. `--risk`가 `#F071B4`(흰 위 2.72)에서 `#B52573`(6.04)로 바뀐다 |
| `decision-button-sizes.png` | Q 결정 1 — 32px 버튼은 기존 4종의 크기 변형. 색·테두리·라운드는 40px과 같고 높이만 다르다 |
| `decision-risk-checkbox.png` | Q 결정 2 — 리스크 체크박스는 테두리만 `--risk`인 변형 |
| `checkbox-consent-rendered.png` | 참여자 등록 동의 체크박스. 실제로 눌러 선택 상태까지 확인했다 — 체크 표시를 `::after`가 아니라 `background-image`로 그리는 이유는 DESIGN.md §5 참조 |

## 전체 화면 스윕을 다시 만드는 방법

화면 13개 × 데스크톱·모바일 before/after 전체는 용량이 커서 커밋하지 않는다. 다시 뽑으려면
`docs/ops.md` '로컬 프리뷰' 절차로 API(8787)·웹(3000)을 띄운 뒤:

```bash
~/.local/share/uv/tools/playwright/bin/python scripts/design/shots.py <라벨>
```

`artifacts/skin-shots/<라벨>/`에 저장된다(이 경로는 gitignore).
