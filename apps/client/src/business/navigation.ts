import type { HumanRole } from './api';

export interface ShellDestination {
  id: 'account' | 'schedule' | 'schedule-register' | 'participants' | 'participant-register'
    | 'onboarding' | 'system' | 'institution-profile' | 'accounts' | 'memory' | 'audit'
    | 'retention' | 'retention-policy';
  title: string;
  href: string;
  roles: readonly HumanRole[];
}

const destinations: readonly ShellDestination[] = [
  { id: 'account', title: '내 정보', href: '/settings', roles: ['institution-admin', 'technical-admin', 'supervisor', 'worker'] },
  { id: 'schedule', title: '일정', href: '/schedule', roles: ['institution-admin', 'supervisor', 'worker'] },
  { id: 'schedule-register', title: '상담 일정 등록', href: '/schedules/new', roles: ['institution-admin', 'worker'] },
  { id: 'participants', title: '당사자 목록', href: '/participants', roles: ['institution-admin', 'supervisor', 'worker'] },
  { id: 'participant-register', title: '당사자 등록', href: '/participants/new', roles: ['institution-admin', 'worker'] },
  { id: 'onboarding', title: '기관 준비', href: '/onboarding', roles: ['institution-admin'] },
  { id: 'system', title: '연결 상태', href: '/settings?module=system', roles: ['institution-admin', 'technical-admin'] },
  { id: 'institution-profile', title: '기관 정보', href: '/settings?module=institution-profile', roles: ['institution-admin'] },
  { id: 'accounts', title: '사용자와 역할', href: '/settings?module=accounts', roles: ['institution-admin'] },
  { id: 'memory', title: '기관 상담 기억', href: '/settings?module=memory', roles: ['institution-admin'] },
  { id: 'audit', title: '감사 기록', href: '/settings?module=audit', roles: ['institution-admin'] },
  { id: 'retention-policy', title: '개인정보 보유기간', href: '/settings?module=retention-policy', roles: ['institution-admin'] },
  { id: 'retention', title: '개인정보 보존 검토', href: '/settings?module=retention', roles: ['institution-admin'] },
];

/** 사람 ID만 받는다. 케이스 ID나 경로가 섞인 값은 상세 화면으로 인정하지 않는다. */
const PARTICIPANT_DETAIL = /^\/participants\/([A-Za-z0-9_-]{1,200})(\/edit)?$/;
/** 15초 페이지는 사람과 참여 사업 두 값을 함께 받는다. */
const BRIEFING = /^\/participants\/[A-Za-z0-9_-]{1,200}\/programs\/[A-Za-z0-9-]{1,200}\/briefing$/;
/** 상담 기록 확인하기와 상담 기록하기. 목록과 같은 권한 묶음을 쓴다. */
const RECORDS = /^\/participants\/[A-Za-z0-9_-]{1,200}\/programs\/[A-Za-z0-9-]{1,200}\/records(\/new|\/intake|\/[A-Za-z0-9-]{1,200}\/review)?$/;
/** 계획 화면은 일정 하나를 받는다. */
const SCHEDULE_PLAN = /^\/schedules\/[A-Za-z0-9-]{1,200}\/plan$/;

/** `/settings` 아래 탭으로 열 수 있는 모듈. 목록에 없는 값은 주소로도 열리지 않는다. */
const SETTINGS_MODULES: readonly string[] = [
  'account', 'system', 'institution-profile', 'accounts', 'memory', 'audit', 'retention', 'retention-policy',
];

export function canOpenDestination(destination: ShellDestination, roles: readonly HumanRole[]): boolean {
  return destination.roles.some((role) => roles.includes(role));
}

export function visibleDestinations(roles: readonly HumanRole[]): readonly ShellDestination[] {
  return destinations.filter((destination) => canOpenDestination(destination, roles));
}

export function destinationAt(pathname: string, search: string): ShellDestination | null {
  const params = new URLSearchParams(search);
  if (params.getAll('module').length > 1) return null;
  const module = params.get('module') ?? 'account';
  if (pathname === '/settings') {
    return destinations.find((destination) => destination.id === module && SETTINGS_MODULES.includes(module)) ?? null;
  }
  const exact = destinations.find((destination) => destination.href === pathname);
  if (exact !== undefined) return exact;
  const participants = destinations.find((destination) => destination.id === 'participants');
  const schedule = destinations.find((destination) => destination.id === 'schedule');
  if (schedule !== undefined && SCHEDULE_PLAN.test(pathname)) {
    return { ...schedule, title: '상담 계획', href: pathname };
  }
  if (participants !== undefined && BRIEFING.test(pathname)) {
    return { ...participants, title: '15초 페이지', href: pathname };
  }
  const records = RECORDS.exec(pathname);
  if (participants !== undefined && records !== null) {
    const title = records[1] === undefined ? '상담 기록 확인하기'
      : records[1] === '/new' ? '상담 기록하기'
        : records[1] === '/intake' ? '인테이크 기록' : 'AI 정리 검토';
    return { ...participants, title, href: pathname };
  }
  const detail = PARTICIPANT_DETAIL.exec(pathname);
  if (detail === null || participants === undefined) return null;
  // 상세와 수정은 목록과 같은 권한 묶음을 쓰고 제목만 자기 화면 것을 쓴다.
  return { ...participants, title: detail[2] === undefined ? '당사자 정보' : '기본정보 수정', href: pathname };
}
