import type { HumanRole } from './api';

export interface ShellDestination {
  id: 'account' | 'participants' | 'onboarding' | 'system';
  title: string;
  href: string;
  roles: readonly HumanRole[];
}

const destinations: readonly ShellDestination[] = [
  { id: 'account', title: '내 정보', href: '/settings', roles: ['institution-admin', 'technical-admin', 'supervisor', 'worker'] },
  { id: 'participants', title: '당사자 목록', href: '/participants', roles: ['institution-admin', 'supervisor', 'worker'] },
  { id: 'onboarding', title: '기관 준비', href: '/onboarding', roles: ['institution-admin'] },
  { id: 'system', title: '연결 상태', href: '/settings?module=system', roles: ['institution-admin', 'technical-admin'] },
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
    return destinations.find((destination) => destination.id === module && (module === 'account' || module === 'system')) ?? null;
  }
  return destinations.find((destination) => destination.href === pathname) ?? null;
}
