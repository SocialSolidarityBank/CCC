import { describe, expect, it } from 'vitest';
import { canOpenDestination, destinationAt, visibleDestinations } from './navigation';

describe('business navigation permission boundary', () => {
  it('keeps a role-pending account out of every business destination', () => {
    expect(visibleDestinations([])).toEqual([]);
    const account = destinationAt('/settings', '');
    expect(account).not.toBeNull();
    expect(canOpenDestination(account!, [])).toBe(false);
  });

  it('does not grant policy or participant access to a technical administrator', () => {
    const roles = ['technical-admin'] as const;
    expect(canOpenDestination(destinationAt('/settings', '?module=system')!, roles)).toBe(true);
    expect(canOpenDestination(destinationAt('/onboarding', '')!, roles)).toBe(false);
    expect(canOpenDestination(destinationAt('/participants', '')!, roles)).toBe(false);
  });

  it('combines actual roles without accepting a role from the URL', () => {
    const target = destinationAt('/settings', '?module=system&role=institution-admin')!;
    expect(canOpenDestination(target, ['worker'])).toBe(false);
    expect(canOpenDestination(target, ['worker', 'technical-admin'])).toBe(true);
    expect(canOpenDestination(destinationAt('/onboarding', '')!, ['worker', 'technical-admin'])).toBe(false);
    expect(canOpenDestination(destinationAt('/participants', '')!, ['worker'])).toBe(true);
  });

  it('distinguishes unsupported and ambiguous URLs from valid destinations', () => {
    expect(destinationAt('/settings', '?module=unknown')).toBeNull();
    expect(destinationAt('/settings', '?module=system&module=account')).toBeNull();
    expect(destinationAt('/missing', '')).toBeNull();
    expect(destinationAt('/settings', '?module=account')?.id).toBe('account');
  });

  it('includes institution setup only for institution administrators', () => {
    expect(visibleDestinations(['institution-admin']).map((entry) => entry.id))
      .toEqual(['account', 'participants', 'onboarding', 'system']);
    expect(visibleDestinations(['supervisor']).map((entry) => entry.id))
      .toEqual(['account', 'participants']);
  });
});
