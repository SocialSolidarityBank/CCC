import { BusinessError } from './errors';

export interface SettingsCaseOption {
  supportCaseId: string;
  beneficiaryId: string;
  name: string | null;
  phone: string | null;
  programName: string;
  status: 'active' | 'closed';
  intakeAt: string | null;
}
export interface SettingsCaseOptions { items: SettingsCaseOption[]; nextCursor: string | null }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function nullableText(value: unknown): value is string | null { return value === null || value === '' || text(value); }
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function nullableInstant(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

export function decodeSettingsCaseOptions(value: unknown): SettingsCaseOptions {
  const page = object(value);
  if (Object.keys(page).length !== 2 || !Array.isArray(page.items) || page.items.length > 50
    || !(page.nextCursor === null || uuid(page.nextCursor))) throw new BusinessError('invalid_response');
  const items: SettingsCaseOption[] = page.items.map((value) => {
    const item = object(value);
    if (Object.keys(item).length !== 7 || !uuid(item.supportCaseId) || !text(item.beneficiaryId)
      || !nullableText(item.name) || !nullableText(item.phone) || !text(item.programName)
      || (item.status !== 'active' && item.status !== 'closed') || !nullableInstant(item.intakeAt)) {
      throw new BusinessError('invalid_response');
    }
    return { supportCaseId: item.supportCaseId, beneficiaryId: item.beneficiaryId, name: item.name, phone: item.phone,
      programName: item.programName, status: item.status, intakeAt: item.intakeAt };
  });
  return { items, nextCursor: page.nextCursor };
}
