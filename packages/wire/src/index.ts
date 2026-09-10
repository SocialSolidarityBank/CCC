// @ccc/wire 의 공개 UI 엔트리. 브라우저 중립 Wire 부품만 내보낸다.
//
// 이 패키지는 Next.js, Cloudflare Workers, 그 외 모든 React 환경에서 사용할 수 있다.
// next/link, next/navigation, 서버 전용 모듈을 물지 않는 부품만 있다.
//
// 셸(AppHeader, AppSidebar, AdminSidebar, BackLink), 목록 행과 전환기
// (ListRow, OrgSwitcher, ParticipantCard, ProgramSwitcher)는 여기 없다.
// 전부 next 라우팅을 물기 때문이다. 서버, 인증, 라우트 모듈도 이 면에 없다.

export { GridContainer, type GridContainerProps } from './grid-container';
export { PageTitle, type PageTitleProps } from './page-title';
export { WireCard, type WireCardProps, type WireCardTone } from './wire-card';
export { WireCardSection, type WireCardSectionProps, type WireSectionTone, WireItem, type WireItemProps } from './wire-section';
export {
  WireChoice,
  type WireChoiceProps,
  WireFormField,
  type WireFormFieldProps,
  WireToolbarField,
  type WireToolbarFieldProps,
} from './wire-form-field';
export {
  WireButton,
  type WireButtonProps,
  type WireButtonVariant,
  WireLinkProvider,
  type WireLinkProps,
  type WireLinkRenderer,
  useWireLink,
} from './wire-button';
export { WireBadge, type WireBadgeProps, type WireBadgeTone } from './wire-badge';
export { WireCallout, type WireCalloutProps } from './wire-callout';
export { WireEmpty, type WireEmptyProps, WireError, type WireErrorProps } from './wire-state';
export { WireDataRow, WireDataRows } from './wire-data-rows';
export { Icon, type IconName } from './wire-icon';
export { WireRadioGroup } from './wire-radio-group';
export {
  WireMonthCalendar,
  type WireMonthCalendarCell,
  type WireMonthCalendarWeek,
  type WireMonthCalendarProps,
  type WireMonthCalendarEvent,
  type WireMonthCalendarEventColor,
  buildMonthWeeks,
} from './wire-month-calendar';
export {
  ParticipantHeroCard,
  type ParticipantHeroCardProps,
  type ParticipantHeroDetail,
} from './participant-hero-card';
export { ParticipantName, type ParticipantNameProps, type ParticipantNameSize, participantDisplayName } from './participant-name';
