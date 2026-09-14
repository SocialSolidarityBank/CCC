export const SUPPORT_CASE_CSV_HEADER = [
  '구획',
  '사업ID',
  '사례ID',
  '회차ID',
  '항목종류',
  '항목ID',
  '상위항목ID',
  '순서',
  '필드',
  '값',
] as const;

export interface SupportCaseCsvSectionItem {
  kind: string;
  id?: string | null;
  parentId?: string | null;
  sessionId?: string | null;
  ordinal?: number | null;
  value: unknown;
}

export interface SupportCaseCsvSection {
  name: string;
  items: SupportCaseCsvSectionItem[];
}

export interface SupportCaseCsvDocument {
  csv: string;
  rowCount: number;
}

interface CsvContext {
  section: string;
  programId: string;
  supportCaseId: string;
  sessionId: string;
  itemKind: string;
  itemId: string;
  parentItemId: string;
  ordinal: string;
}
type CsvRow = [string, string, string, string, string, string, string, string, string, string];

const IDENTITY_FIELDS = [
  'id',
  'draftVersionId',
  'eventId',
  'questionId',
  'actionItemId',
  'goalId',
  'scheduleId',
  'sessionId',
] as const;

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function objectIdentity(value: Record<string, unknown>): string | null {
  for (const field of IDENTITY_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return null;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function appendLeaf(rows: CsvRow[], context: CsvContext, field: string, value: string): void {
  rows.push([
    context.section,
    context.programId,
    context.supportCaseId,
    context.sessionId,
    context.itemKind,
    context.itemId,
    context.parentItemId,
    context.ordinal,
    field,
    value,
  ]);
}

function appendValue(
  rows: CsvRow[],
  value: unknown,
  path: string[],
  context: CsvContext,
): void {
  const leaf = scalar(value);
  if (leaf !== null) {
    appendLeaf(rows, context, path.join('.') || '값', leaf);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      appendLeaf(rows, context, path.join('.') || '값', '[]');
      return;
    }
    value.forEach((entry, index) => {
      const identity = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? objectIdentity(entry as Record<string, unknown>)
        : null;
      appendValue(rows, entry, [...path, String(index)], {
        ...context,
        itemKind: path.at(-1) ?? context.itemKind,
        parentItemId: identity === null ? context.parentItemId : context.itemId,
        itemId: identity ?? context.itemId,
        ordinal: String(index + 1),
      });
    });
    return;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) {
    appendLeaf(rows, context, path.join('.') || '값', '{}');
    return;
  }
  const identity = objectIdentity(record);
  const nestedContext = identity === null ? context : {
    ...context,
    parentItemId: context.itemId === identity ? context.parentItemId : context.itemId,
    itemId: identity,
  };
  for (const [field, child] of entries) {
    appendValue(rows, child, [...path, field], nestedContext);
  }
}

export function serializeSupportCaseCsv(
  programId: string,
  supportCaseId: string,
  sections: readonly SupportCaseCsvSection[],
): SupportCaseCsvDocument {
  const rows: CsvRow[] = [];
  for (const section of sections) {
    appendLeaf(rows, {
      section: section.name,
      programId,
      supportCaseId,
      sessionId: '',
      itemKind: '구획',
      itemId: '',
      parentItemId: '',
      ordinal: '',
    }, '포함', 'true');
    for (const item of section.items) {
      appendValue(rows, item.value, [], {
        section: section.name,
        programId,
        supportCaseId,
        sessionId: item.sessionId ?? '',
        itemKind: item.kind,
        itemId: item.id ?? '',
        parentItemId: item.parentId ?? '',
        ordinal: item.ordinal === null || item.ordinal === undefined ? '' : String(item.ordinal),
      });
    }
  }
  const lines = [SUPPORT_CASE_CSV_HEADER, ...rows]
    .map((row) => row.map(csvCell).join(','));
  return {
    csv: `\ufeff${lines.join('\r\n')}\r\n`,
    rowCount: rows.length,
  };
}
