// @ccc/web 의 공개 UI 엔트리(2026-09-08). 브라우저 중립 Wire 부품만 내보낸다.
//
// 2026-09-10 P9: 실제 부품은 @ccc/wire 패키지에 있다. 이 파일은 기존 import 경로의
// 호환을 위해 @ccc/wire 를 그대로 내보낸다. 새 코드는 @ccc/wire 를 직접 쓴다.
//
// 왜 필요한가: 다른 앱이 Wire 부품을 쓰려면 경로가 하나 있어야 하는데, 상대 경로로 패키지
// 밖을 가리키면 scripts/guard-core-imports.mjs 가 막는다(그래야 맞다). alias 로 숨기거나
// 가드에 예외를 다는 대신 실제 공개 면을 선언한다. package.json 의 exports 가 이 파일을
// `@ccc/web/wire` 로 연다.
//
// 여기 올릴 수 있는 것: next/link, next/navigation, 서버 전용 모듈을 물지 않는 부품.
// 올리지 않는 것: 셸(AppHeader, AppSidebar, AdminSidebar, BackLink), 목록 행과 전환기
// (ListRow, OrgSwitcher, ParticipantCard, ProgramSwitcher). 전부 next 라우팅을 문다.
// 서버, 인증, 라우트 모듈은 이 면에 없다.

export {
  GridContainer,
  type GridContainerProps,
  PageTitle,
  type PageTitleProps,
  WireCard,
  type WireCardProps,
  type WireCardTone,
  WireCardSection,
  type WireCardSectionProps,
  type WireSectionTone,
  WireItem,
  type WireItemProps,
  WireChoice,
  type WireChoiceProps,
  WireFormField,
  type WireFormFieldProps,
  WireToolbarField,
  type WireToolbarFieldProps,
  WireButton,
  type WireButtonProps,
  type WireButtonVariant,
  WireLinkProvider,
  type WireLinkProps,
  type WireLinkRenderer,
  useWireLink,
  WireBadge,
  type WireBadgeProps,
  type WireBadgeTone,
  WireCallout,
  type WireCalloutProps,
  WireEmpty,
  type WireEmptyProps,
  WireError,
  type WireErrorProps,
  WireDataRow,
  WireDataRows,
  Icon,
  type IconName,
  WireRadioGroup,
  WireMonthCalendar,
  type WireMonthCalendarCell,
  type WireMonthCalendarWeek,
  type WireMonthCalendarProps,
  type WireMonthCalendarEvent,
  type WireMonthCalendarEventColor,
  buildMonthWeeks,
  ParticipantHeroCard,
  type ParticipantHeroCardProps,
  type ParticipantHeroDetail,
  ParticipantName,
  type ParticipantNameProps,
  type ParticipantNameSize,
  participantDisplayName,
} from '@ccc/wire';
