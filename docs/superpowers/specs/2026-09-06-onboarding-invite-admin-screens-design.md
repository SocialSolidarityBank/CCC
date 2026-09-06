# 진입·초대·어드민 화면 설계 (design-lane 1단계)

- 상태: 배치표 승인 대기 (2026-09-06 그릴링, 결정은 ADR-0044 D86으로 닫힘)
- 범위: 랜딩, 로그인, 기관 초기 설정, 실무자 초대, 당사자 요청 링크(발급·수신), 어드민 탭, 비담당 실무자 허브
- 구현 소유: `design-adjustments` 워크트리(디자인 소유 잠금). 루트 세션이 쓴 초안을 이 워크트리가 현행 코드에 대조해 다시 적었다. 화면 코드·DESIGN.md·시안은 아직 손대지 않았다
- 1차 대상: Community Cloud. Local 두 모드는 끝의 축소표
- 입력: ADR-0044(`docs/d86-onboarding-decisions` 브랜치 922a56b, origin/main 미병합. 이 문서의 PR은 그 PR 뒤에 올린다), `DESIGN-RULES.md`, `skill://design-lane`

## 전제

- 규칙은 `DESIGN-RULES.md`가 갖는다. 아래 배치표의 단 번호 ①~⑧은 그 §1 표다
- 부품은 `apps/web/app/components/wire/`의 현행 37개 파일만 쓴다. 새 부품이 필요한 줄은 **어느 부품을 어떻게 고칠지**를 적었다(§2)
- 새 색·새 토큰·새 그라데이션 0. 카드 안 카드 금지, 버튼 32 알약, 폼 폭 520, 브레이크포인트 767 하나
- 용어는 `CONTEXT.md` 정본. 화면 문자열에 조직·상담사·참여자·관리자(단독)·초대(주체 없이)를 쓰지 않는다
- 화면 문자열에 긴 대시와 구분자 가운뎃점(공백 있는 ` · `)을 쓰지 않는다(`guard:tokens` prose 검사 2종). 공백 없는 병렬(`사용자·역할`)은 통과한다
- 공개 화면(랜딩, 로그인, 요청 링크 수신, 실무자 가입)은 셸 밖이다. 사이드바·드로어·헤더가 없다

## 현행 코드 대조 (2026-09-06 이 워크트리 실측)

| 초안이 전제한 것 | 실제 | 이 문서의 처리 |
| --- | --- | --- |
| `SearchInput` type은 text/email/date/select | `type?: 'text' \| 'date' \| 'email'`, `variant?: 'text' \| 'select'`. password 없음 | §2-1 그대로 |
| `WireFormField` choice(checkbox) | 선택지 부품은 `WireChoice({ type: 'radio' \| 'checkbox' })` (`wire-form-field.tsx`) | 표의 부품 칸을 `WireChoice type="checkbox"`로 고침 |
| `AdminSidebar` 탭 정적 5개 | `adminMenu`(`apps/web/app/admin/admin-format.ts`) 5개: 기관, 배정, 사용자, 실무자 초대, AI 사업자. 부품은 `activePath`만 받고 목록은 모듈 상수 | §2-3 그대로. 탭 이름 개정 목록을 화면 5에 적음 |
| 사용자·역할 탭은 목록만 있음 | `/admin/users`(목록) + `/admin/users/[id]`(읽기 전용 상세, 담당 당사자·배정하기 버튼). 역할 편집·비활성화·MFA 초기화 없음 | 화면 5 상태 칸 수정 |
| `/admin/invite` 익명 링크 카드 | `WorkerInviteIssue`(이메일 없이 링크만 발급) + `registerCounselorAction` 등록 폼 | 익명 발급 카드 삭제 대상 확정 |
| `/join/participant/[token]` 자기 확인 분기 | `SelfCheckView` + `getParticipantSelfCheck`가 소비된 토큰에서 열림 | 제거 대상 확정 |
| `/onboarding`은 위저드 | `onboarding-wizard.tsx`가 있으나 `WireSteps`를 쓰지 않음 | 화면 2에서 `WireSteps`로 교체 |
| 보존·파기 검토 API | `GET /pii-retention/reviews` (`packages/http-api/src/request-handler.ts:3136`) 있음, 화면 없음 | 그대로 |
| 로그인은 `apps/client` | `apps/client`는 `public/ccc-bootstrap.json.example` 하나뿐. wire 부품은 `apps/web`에만 있다 | 화면 1은 `apps/client` 첫 화면이다. 부품을 어떻게 나눠 쓸지는 E0/E1 클라이언트 티켓이 정하고 이 문서는 배치만 갖는다 |
| `hierarchy-harness.test.tsx` `SCREENS` | 있음(`kit`, `briefing`, …) | 검증 항목 그대로 |

## 화면 0. 랜딩 (`apps/site`, 아직 없음)

design-taste-frontend 기준 Design Read: **공공·비영리 신뢰 우선 랜딩, 실무자와 기관 관리자 대상, 조용한 언어, 기존 pen 토큰(웜 뉴트럴 + 파스텔 3계열) 그대로.** 다이얼 VARIANCE 3 / MOTION 2 / DENSITY 4. 그라데이션 히어로·3등분 카드·마퀴·스크롤 큐 금지.

랜딩은 업무 셸 규칙(모든 글자는 카드 안)을 따르지 않는다. 색·글자 계단·굵기 3단·여백 4의 배수·부호 규칙(긴 대시 0)은 따른다.

| 순서 | 구획 | 내용 | 레이아웃 |
| --- | --- | --- | --- |
| 1 | 내비 | 워드마크 `CCC`, 오른쪽 `기관 코드로 로그인`(neutral) | 한 줄, 64 |
| 2 | 히어로 | 제목 2줄 이하 "상담 5분 전, 15초면 맥락이 잡힙니다" 류. 부제 20단어 이하. CTA 둘: `도입 안내`(primary), `가상 데이터로 둘러보기`(secondary) | 좌 글·우 15초 페이지 실제 스크린샷(가상 시드) 분할 |
| 3 | 15초 페이지 한 장면 | 3영역 이름과 한 줄씩 | 글 위, 캡처 아래 세로 스택 |
| 4 | 세 배포 모드 | Community Cloud / Local Office / Local Single. 각 두 줄: 저장 위치, 누가 관리하나. **셋을 같은 무게로** (ADR-0041) | 3열 표, 767 이하 1열 |
| 5 | 안전 원칙 | AI 금지 영역, PII 2단 마스킹, 원음 7일 상한을 각 한 문장 | 불릿, 카드 없음 |
| 6 | 도입 안내 | `install` 요약, 문의 연락처, 문서 링크 | 글 |
| 7 | 푸터 | 배포기관 이름, Apache 2.0, 저장소 링크 | 한 줄 |

CTA 의도 중복 금지: `도입 안내`는 6번으로 앵커, `가상 데이터로 둘러보기`는 데모 링크, 로그인은 내비 하나뿐.

## 화면 1. 로그인 (`apps/client`, 셸 밖, 중앙 카드 `width:min(400px,100%)`)

두 단이다. 기관 URL(`/k/<코드>`)로 들어오면 1단을 건너뛴다.

**1단. 기관 코드**

| 줄 | 무엇 | 단 | 부품 |
| --- | --- | --- | --- |
| 1 | `기관 코드` 라벨 + 입력 | ②/⑥ | `SearchInput`(text) |
| 2 | 도움말 "기관 관리자에게 받은 짧은 코드입니다" | ⑦ | `SearchInput` hint(`.wire-form-hint` 13) |
| 3 | `다음` | 버튼 | `WireButton` primary |
| 4 | 오류 "코드를 찾을 수 없습니다" | 상태 | `WireError` |

**2단. 계정**

| 줄 | 무엇 | 단 | 부품 |
| --- | --- | --- | --- |
| 1 | 기관 이름 | ① | `.wire-card-title` |
| 2 | 기관 코드 | ④ | `.panel-meta` (①④ 연속 아님) |
| 3 | 이메일 / 비밀번호 | ②/⑥ | `SearchInput`(email), `SearchInput`(password: **type 추가 필요**, §2-1) |
| 4 | `로그인` | 버튼 | `WireButton` primary |
| 5 | `다른 기관` (1단으로) | 버튼 | `WireButton` ghost |
| 6 | MFA 6자리 (Supabase 요구 시 같은 카드에서 교체) | ②/⑥ | `SearchInput`(text, inputMode numeric) |

비밀번호 재설정은 Supabase 기본 이메일 흐름 링크 한 줄(ghost). 자체 화면 없음.

## 화면 2. 기관 초기 설정 (셸 안, `/onboarding` 후신, 기관 생성자 첫 로그인)

`WireSteps` 4단계(현 `onboarding-wizard.tsx`의 자체 단계 표시를 대체). 사이드바는 있되 다른 장소는 비활성(역할 대기와 같은 잠금 표현).

| 단계 | 줄 | 무엇 | 단 | 부품 |
| --- | --- | --- | --- | --- |
| 1 기관 | 1 | 기관 이름 | ②/⑥ | `SearchInput` |
| 2 첫 사업 | 1 | 사업 표시 이름 | ②/⑥ | 같음 |
| 2 | 2 | 사업 유형 | 배지 | `WireBadge` neutral "금전지원형 v1" (고정, 선택 없음) |
| 3 동의 문안 | 1~6 | 6영역 각각: 영역 이름 ② + 기본 문안 미리보기 ④ + `기본 문안 사용`/`직접 편집` | ②④+버튼 | `WireCardSection` × 6, 편집은 `textarea`(⑥) |
| 3 | 7 | 안내 "문안을 바꾸면 버전이 올라가고 기존 동의는 승격되지 않습니다"(D82) | 콜아웃 | `WireCallout` tone=info |
| 4 보유기간 | 1 | 기본 1년, 상한 5년(D32·D46) 표시 | ②/⑥ | `SearchInput`(variant select) |
| 완료 | 1 | `실무자 초대로 가기` | 버튼 | `WireButton` primary |

## 화면 3. 실무자 초대 (`/admin/invite` 개정, 셸 안)

칸은 **내 역할의 합**이 정한다. 익명 링크 카드(`WorkerInviteIssue`)는 삭제한다.

| 줄 | 무엇 | 단 | 부품 | 보이는 조건 |
| --- | --- | --- | --- | --- |
| 1 | 이름 | ②/⑥ | `SearchInput` | 항상 |
| 2 | 이메일 | ②/⑥ | `SearchInput`(email) | 항상 |
| 3 | 업무 역할 체크 4개(기관 관리자·기관 기술 관리자·실무 책임자·실무자), 하나 이상 필수 | ② + 체크 | `WireFormField` 라벨 + `WireChoice type="checkbox"` × 4 | 기관 관리자 역할 보유자만 |
| 4 | 안내 "가입 뒤 기관 관리자가 역할을 정합니다" | 콜아웃 | `WireCallout` tone=info | 기관 기술 관리자 역할만 가진 사람에게만 |
| 5 | `초대 링크 만들기` | 버튼 | `WireButton` primary | 항상 |
| 6 | 결과 카드: 링크(16, 당사자 초대 규칙과 같음) + 오른쪽 `공유` 아이콘 원형, 아래 `복사`, `이메일 문안 복사` | ③+버튼 | `WireCard`+`WireFormField`(`.wire-field-with-action`)+`.header-icon-button`(공유)+`WireButton` secondary ×2 | 발급 후. `공유`는 공유 시트가 있는 브라우저에서만 |

수신 화면 `/join/worker/[token]`: 기관 이름 ①, "OOO 님이 초대했습니다" ④, 이름·비밀번호·비밀번호 확인 ⑥, `가입` primary. 가입 뒤 로그인 화면 2단으로 이동(기관 코드 프리필). 역할 대기면 로그인 후 `WireEmpty` "기관 관리자가 역할을 주면 시작됩니다" 한 화면.

## 화면 4. 당사자 요청 링크, 현재 목적은 가입

다른 목적(동의 수집·정보 입력·변경 요청·목표와 액션 전달·일정 선택)은 각각의 입·출력 계약을 정한 뒤 더한다. 이번 화면에 빈 선택지나 자리표시자는 두지 않는다.

**발급(`/participants/invite` 개정, 셸 안, 767 이하 최적화)**

현재 워크스페이스의 사업과 발급 실무자가 링크에 자동으로 묶인다. 사업 선택창은 없다.

| 줄 | 무엇 | 단 | 부품 |
| --- | --- | --- | --- |
| 1 | 목적 `당사자 가입` | 배지 | `WireBadge` neutral, 고정 |
| 2 | 사업 이름 | ②/③ | `WireField`, 읽기 전용 |
| 3 | 만료 조건 | 배지 | `WireBadge` neutral × 2: `7일 뒤 만료`, `1회 사용`. 입력 없음. 한 배지에 ` · `로 잇지 않는다 |
| 4 | `링크 만들기` | 버튼 | `WireButton` primary |
| 5 | 링크 주소 + 오른쪽 `공유` 아이콘 원형 | 16 값 + 아이콘 버튼 | `WireFormField`(`.wire-field-with-action`, 당사자에게 보여 주는 값 16, `.participant-invite-stack`) + `.header-icon-button` 32 원(`NavIcon name="share"`, `aria-label="공유"`, `title="공유"`). 헤더 설정·로그아웃과 같은 옷 |
| 6 | QR | 이미지 | 현행 SVG |
| 7 | `링크 복사` / `이메일 문안 복사` | 버튼 | `WireButton` secondary ×2. 카카오톡·문자 버튼은 **두지 않는다** |

`공유`는 OS 공유 시트(`navigator.share`)를 띄우고 실무자가 카카오톡·문자·메일 중 고른다. CCC는 어느 채널로 갔는지 모른다(D86 ④ "링크는 전달 채널을 모른다" 유지). 공유 시트를 못 띄우는 브라우저(데스크톱 Firefox 등)에서는 버튼을 렌더하지 않는다. 자리 예약 없이 `링크 복사`만 남는다. 마운트 뒤 기능 감지로 켜서 서버 렌더와 어긋나지 않게 한다. 공유 문안은 `이메일 문안 복사`와 같은 문안이고 **당사자 이름을 넣지 않는다**: 기관 이름, 담당 실무자 이름, "7일 안에 한 번만 열 수 있습니다", 링크. 실무자 개인 메신저 계정 사용 여부는 기관 운영 규칙(배포기관 서식)이고 CCC는 강제하지 않는다(2026-09-06 Q 확정, ADR 없음).

**수신(`/join/participant/[token]`, 셸 밖, 모바일 1열)**

| 줄 | 무엇 | 단 | 부품 |
| --- | --- | --- | --- |
| 1 | 기관 이름 | ① | `.wire-card-title` |
| 2 | "담당 실무자 OOO 이 보낸 가입 요청입니다" | ④ | `.panel-meta` |
| 3 | 이름·연락처·이메일 + 동의 6영역 체크 `.consent-checkbox` 14/600 + `자세히 읽어보기` 일반형 꺽쇠 | ②/⑥ | `SearchInput`, `WireChoice type="checkbox"`, `DisclosureChevron variant="plain"` |
| 4 | `가입 정보 보내기` | 버튼 | primary |
| 완료 | "담당 실무자 OOO 에게 전달됐습니다" | ③ | `WireEmpty` 문장 |
| 소비·만료 | "이 링크는 사용이 끝났습니다. 담당 실무자 OOO" | ③ | `WireEmpty` |

소비된 토큰의 자기 확인 분기(`SelfCheckView`, `getParticipantSelfCheck`)와 그 API 응답은 제거한다. 링크 GET은 소진하지 않고 성공한 제출과 소진을 원자적으로 처리한다.

## 화면 5. 어드민 (`/admin/*`, `AdminSidebar` 탭)

탭은 내 역할의 합만큼만 렌더한다. 탭 0개면 `/admin`은 404. 현행 `adminMenu` 5개 중 이름이 바뀌는 것은 `사용자` → `사용자·역할`, `AI 사업자` → `AI·STT·연결`이고 나머지 셋은 그대로다.

| 탭 | 역할 | 현행 | 핵심 줄 |
| --- | --- | --- | --- |
| 기관 | 기관 관리자 | 있음 | 유지 |
| 사용자·역할 | 기관 관리자 / 기관 기술 관리자 | 목록 + 읽기 전용 상세(`/admin/users/[id]`) 있음. 역할 편집 없음 | 행마다 `WireItem`: 이름 ①, 이메일 ④, 역할 배지들(민트) + `역할 대기`(neutral)/`비활성`(neutral). 상세에서 기관 관리자는 `WireChoice` 역할 체크 4개 저장, 기술 관리자는 `비활성화`/`MFA 초기화`(danger). 마지막 기관 관리자·기술 관리자 회수 차단 문구 `WireError` |
| 실무자 초대 | 둘 다 | 있음 | 화면 3 |
| 팀·감독 | 기관 관리자 | 없음 | 팀 목록 `ListRow`, 팀 상세: 팀원 `WireItem` + 실무 책임자 지정 `SearchInput`(select) + `감독 종료`(danger) |
| 배정 | 기관 관리자 | 있음 | 맨 위 새 구획 `WireCardSection` "실무자가 요청한 배정": 행마다 당사자 ①, 요청자·사유 ④, `공동 담당으로 승인`(secondary) / `이관으로 승인`(secondary) / `거절`(ghost) |
| 보존·파기 검토 | 기관 관리자 | 없음(API `GET/POST /pii-retention/reviews` 있음) | 검토 큐 `WireItem`: 가명 ID ①, 종결일·파기 예정일 `TimeAxisBadge`, `보존 연장`/`파기 승인`(danger) |
| 동의 문안·보유기간 | 기관 관리자 | 없음 | 화면 2의 3·4단계와 같은 부품 재사용, 버전 이력 `WireTimeline` |
| AI·STT·연결 | 기관 기술 관리자 | AI 사업자만 있음 | 현행 `/admin/ai-provider` + STT 모드(`off` 고정 표시, D77) + Agent 마지막 폴링 시각 ④ |

## 화면 6. 비담당 실무자 허브 (2단 축소)

`ParticipantHeroCard` 유지. 정보 격자(ID·연락처·이메일)와 담당 실무자·참여 사업 구획만 렌더. 상담 기록·목표 트리·보호 PII·15초 페이지 링크는 **렌더하지 않는다**(자물쇠·빈 카드 없음). HERO 행동 슬롯 하나: `담당 배정 요청`(secondary) → `WireModal` 사유 한 줄 → 이후 HERO 상태 태그 `요청됨`(neutral, `stageTagTone` 기본값).

## Local 두 모드 축소표

| 화면 | Local Office | Local Single |
| --- | --- | --- |
| 0 랜딩 | 같음(공개 사이트) | 같음 |
| 1 로그인 | 1단 없음. 2단은 로컬 계정(Argon2id), 관리자만 MFA | 없음. OS 사용자 + 앱 잠금 화면 하나(비밀번호 칸 1개) |
| 2 초기 설정 | 같음(설치기가 첫 관리자 생성 후) | 1·2단계만. 동의 문안·보유기간은 기본값이고 설정에서 수정한다. 완료하면 당사자 목록으로 간다 |
| 3 실무자 초대 | 같음, 링크는 내부망 URL | 없음(1인) |
| 4 요청 링크 | 같음, QR은 내부망. 원격은 암호화 임시 전달함 | 같음, 127.0.0.1 QR은 같은 기기에서만. 원격은 전달함 |
| 5 어드민 | 같음 | 사용자·팀·배정 탭 없음 |
| 6 축소 허브 | 같음 | 없음(1인) |

## §2 부품 수정 목록

1. `SearchInput`: `type`에 `'password'` 추가(현행 `'text' | 'date' | 'email'`). 범용 입력이라 부품을 늘리지 않는다
2. `WireChoice type="checkbox"`: 역할 4개·동의 6영역에 그대로 쓴다. 변경 없음
3. `AdminSidebar`: `adminMenu` 정적 5개를 **역할 합으로 필터한 배열**로. 부품이 `items` 하나를 받고 `admin-format.ts`의 상수는 전체 목록과 역할 조건만 갖는다
4. `ParticipantHeroCard`: 변경 없음. 축소 허브는 슬롯을 덜 채울 뿐
5. `ShellIconName`에 `'share'` 추가(`shell-icons.tsx`, 16px 라인 아이콘, `currentColor`). D58 ⑦ 아이콘 공용 SVG 시스템이라 문자 글리프나 별도 아이콘 파일을 두지 않는다. 버튼 옷은 `.header-icon-button` 재사용이고 새 클래스는 없다. 드로어 손잡이가 이미 헤더 밖에서 같은 클래스를 쓴다

새 클래스 0, 새 토큰 0, 새 색 0을 목표로 한다. 못 지키는 줄이 나오면 이 문서에 사유를 적고 티켓으로 낸다.

## 검증(구현 단계에서)

- `pnpm guard:tokens && pnpm guard:align && pnpm guard:hierarchy` 통과
- `hierarchy-harness.test.tsx` `SCREENS`에 로그인 2단, 요청 링크 수신(가입), 어드민 사용자·역할 추가, 1280·767·390
- 축소 허브 390에서 HERO 행동이 줄바꿈되지 않고 32 높이 유지
- 요청 링크 수신 390에서 동의 6영역 체크 라벨 실제 글자 간격 14±1
- 발급 화면 390·1280에서 `공유` 원이 32×32이고 링크 입력 상자(40) 세로 중앙에 앉는다(`pnpm design:align` `center-y-each`, `size`)
