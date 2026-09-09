import { useEffect, useRef, useState } from 'react';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import { BusinessError, safeError } from './errors';
import { BusinessTransport } from './transport';
import { decodeSettingsCaseOptions, type SettingsCaseOptions } from './case-options';

export interface ExportCase {
  schemaVersion: 1;
  case: {
    id: string;
    programType: string;
    status: 'active' | 'closed';
    intakeAt: string | null;
    closedAt: string | null;
    closedReason: string | null;
  };
  goals: Array<{
    id: string;
    caseId: string;
    title: string;
    scaleCriteria: unknown | null;
    status: 'active' | 'closed';
    closedReason: string | null;
    closedAt: string | null;
    replacedByGoalId: string | null;
  }>;
  sessions: Array<{
    id: string;
    caseId: string;
    counselorId: string;
    heldAt: string;
    channel: 'in_person' | 'phone' | 'video';
    memo: string | null;
    aiStatus: 'none' | 'approved';
    aiSummary: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
  }>;
  gasScores: Array<{ sessionId: string; goalId: string; score: -2 | -1 | 0 | 1 | 2; scoredBy: string }>;
}

export interface ExportHistoryItem {
  id: number;
  actorId: string;
  actorRole: 'admin' | 'counselor' | 'service';
  createdAt: string;
  goalCount: number;
  sessionCount: number;
  gasScoreCount: number;
}
export interface ExportHistoryPage { items: ExportHistoryItem[]; nextCursor: string | null }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function safeString(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
function nullableString(value: unknown, max = 200): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value));
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function instant(value: unknown): value is string {
  if (!safeString(value, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function nullableInstant(value: unknown): value is string | null {
  return value === null || instant(value);
}
function caseId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 200_000;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10_000 && value.every((item) => jsonValue(item, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length <= 10_000 && entries.every(([key, item]) => safeString(key, 200) && jsonValue(item, depth + 1));
  }
  return false;
}
function decodeExport(value: unknown): ExportCase {
  const row = record(value);
  if (Object.keys(row).length !== 5 || row.schemaVersion !== 1
    || !Array.isArray(row.goals) || !Array.isArray(row.sessions) || !Array.isArray(row.gasScores)) {
    throw new BusinessError('invalid_response');
  }
  const caseRow = record(row.case);
  const caseKeys = ['id', 'programType', 'status', 'intakeAt', 'closedAt', 'closedReason'];
  if (Object.keys(caseRow).length !== caseKeys.length || !caseKeys.every((key) => Object.hasOwn(caseRow, key))
    || !safeString(caseRow.id) || !safeString(caseRow.programType, 120)
    || (caseRow.status !== 'active' && caseRow.status !== 'closed')
    || !nullableInstant(caseRow.intakeAt) || !nullableInstant(caseRow.closedAt)
    || !nullableText(caseRow.closedReason)) throw new BusinessError('invalid_response');
  const canonicalCaseId = caseRow.id;
  if (row.goals.length > 10_000 || row.sessions.length > 10_000 || row.gasScores.length > 20_000) {
    throw new BusinessError('invalid_response');
  }
  const goals: ExportCase['goals'] = row.goals.map((value) => {
    const goal = record(value);
    if (Object.keys(goal).length !== 8 || !Object.hasOwn(goal, 'id') || !Object.hasOwn(goal, 'caseId')
      || !Object.hasOwn(goal, 'title') || !Object.hasOwn(goal, 'scaleCriteria') || !Object.hasOwn(goal, 'status')
      || !Object.hasOwn(goal, 'closedReason') || !Object.hasOwn(goal, 'closedAt') || !Object.hasOwn(goal, 'replacedByGoalId')
      || !safeString(goal.id) || goal.caseId !== canonicalCaseId || typeof goal.title !== 'string'
      || !jsonValue(goal.scaleCriteria) || (goal.status !== 'active' && goal.status !== 'closed')
      || !nullableText(goal.closedReason) || !nullableInstant(goal.closedAt)
      || !nullableString(goal.replacedByGoalId, 200)) throw new BusinessError('invalid_response');
    return {
      id: goal.id, caseId: goal.caseId, title: goal.title, scaleCriteria: goal.scaleCriteria,
      status: goal.status, closedReason: goal.closedReason, closedAt: goal.closedAt, replacedByGoalId: goal.replacedByGoalId,
    };
  });
  const sessions = row.sessions.map((value) => {
    const session = record(value);
    if (Object.keys(session).length !== 10 || !Object.hasOwn(session, 'id') || !Object.hasOwn(session, 'caseId')
      || !Object.hasOwn(session, 'counselorId') || !Object.hasOwn(session, 'heldAt') || !Object.hasOwn(session, 'channel')
      || !Object.hasOwn(session, 'memo') || !Object.hasOwn(session, 'aiStatus') || !Object.hasOwn(session, 'aiSummary')
      || !Object.hasOwn(session, 'approvedAt') || !Object.hasOwn(session, 'approvedBy')
      || !safeString(session.id) || session.caseId !== caseRow.id || !safeString(session.counselorId)
      || !instant(session.heldAt) || !['in_person', 'phone', 'video'].includes(session.channel as string)
      || !nullableText(session.memo) || (session.aiStatus !== 'none' && session.aiStatus !== 'approved')
      || !nullableText(session.aiSummary) || !nullableInstant(session.approvedAt)
      || !nullableString(session.approvedBy)) throw new BusinessError('invalid_response');
    return {
      id: session.id, caseId: session.caseId, counselorId: session.counselorId, heldAt: session.heldAt,
      channel: session.channel, memo: session.memo, aiStatus: session.aiStatus, aiSummary: session.aiSummary,
      approvedAt: session.approvedAt, approvedBy: session.approvedBy,
    } as ExportCase['sessions'][number];
  });
  const gasScores = row.gasScores.map((value) => {
    const score = record(value);
    if (Object.keys(score).length !== 4 || !Object.hasOwn(score, 'sessionId') || !Object.hasOwn(score, 'goalId')
      || !Object.hasOwn(score, 'score') || !Object.hasOwn(score, 'scoredBy')
      || !safeString(score.sessionId) || !safeString(score.goalId) || ![-2, -1, 0, 1, 2].includes(score.score as number)
      || !safeString(score.scoredBy)) throw new BusinessError('invalid_response');
    return { sessionId: score.sessionId, goalId: score.goalId, score: score.score as -2 | -1 | 0 | 1 | 2, scoredBy: score.scoredBy };
  });
  return {
    schemaVersion: 1,
    case: { id: caseRow.id, programType: caseRow.programType, status: caseRow.status, intakeAt: caseRow.intakeAt, closedAt: caseRow.closedAt, closedReason: caseRow.closedReason },
    goals,
    sessions,
    gasScores,
  };
}
function decodeHistory(value: unknown): ExportHistoryPage {
  const row = record(value);
  if (Object.keys(row).length !== 2 || !Array.isArray(row.items)
    || !(row.nextCursor === null || (typeof row.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,300}$/u.test(row.nextCursor)))) throw new BusinessError('invalid_response');
  if (row.items.length > 50) throw new BusinessError('invalid_response');
  return {
    items: row.items.map((value) => {
      const item = record(value);
      if (Object.keys(item).length !== 7 || !Object.hasOwn(item, 'id') || !Object.hasOwn(item, 'actorId')
        || !Object.hasOwn(item, 'actorRole') || !Object.hasOwn(item, 'createdAt') || !Object.hasOwn(item, 'goalCount')
        || !Object.hasOwn(item, 'sessionCount') || !Object.hasOwn(item, 'gasScoreCount')
        || !Number.isSafeInteger(item.id) || (item.id as number) < 1 || !safeString(item.actorId)
        || !['admin', 'counselor', 'service'].includes(item.actorRole as string) || !instant(item.createdAt)
        || ![item.goalCount, item.sessionCount, item.gasScoreCount].every((count) => Number.isSafeInteger(count) && (count as number) >= 0 && (count as number) <= 100_000)) throw new BusinessError('invalid_response');
      return {
        id: item.id as number, actorId: item.actorId, actorRole: item.actorRole as ExportHistoryItem['actorRole'], createdAt: item.createdAt,
        goalCount: item.goalCount as number, sessionCount: item.sessionCount as number, gasScoreCount: item.gasScoreCount as number,
      };
    }),
    nextCursor: row.nextCursor,
  };
}


export class ExportsApi {
  constructor(private readonly transport: BusinessTransport) {}
  async cases(cursor?: string): Promise<SettingsCaseOptions> {
    if (cursor !== undefined && !caseId(cursor)) throw new BusinessError('invalid_request', 400);
    return decodeSettingsCaseOptions(await this.transport.request(`/exports/cases${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`));
  }
  async exportRecords(supportCaseId: string): Promise<ExportCase> {
    if (!caseId(supportCaseId)) throw new BusinessError('invalid_request', 400);
    const value = decodeExport(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/export`, 'POST'));
    if (value.case.id !== supportCaseId) throw new BusinessError('invalid_response');
    return value;
  }
  async history(supportCaseId: string, cursor?: string): Promise<ExportHistoryPage> {
    if (!caseId(supportCaseId) || (cursor !== undefined && !/^[A-Za-z0-9_-]{1,300}$/u.test(cursor))) throw new BusinessError('invalid_request', 400);
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    return decodeHistory(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/export-history${query}`));
  }
}

function downloadJson(value: ExportCase, supportCaseId: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ccc-export-${supportCaseId}.json`;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function ExportsModule({ api, onFailure }: { api: ExportsApi; onFailure: (error: BusinessError) => void }) {
  const [options, setOptions] = useState<SettingsCaseOptions | null>(null);
  const [supportCaseId, setSupportCaseId] = useState('');
  const [history, setHistory] = useState<ExportHistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const [prepared, setPrepared] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    busyRef.current = false;
    void loadCases();
    return () => { mounted.current = false; generation.current += 1; busyRef.current = false; };
  }, [api]);

  async function loadCases(cursor?: string): Promise<void> {
    if (busyRef.current || !mounted.current) return;
    const own = ++generation.current;
    busyRef.current = true; setBusy(true); setError(null);
    if (cursor === undefined) { setSupportCaseId(''); setHistory(null); setPrepared(false); setOptions(null); }
    try {
      const page = await api.cases(cursor);
      if (!mounted.current || own !== generation.current) return;
      setOptions((current) => ({ items: cursor === undefined ? page.items : [...(current?.items ?? []), ...page.items], nextCursor: page.nextCursor }));
    } catch (cause) {
      if (!mounted.current || own !== generation.current) return;
      const failure = safeError(cause); setError(failure); onFailure(failure);
    } finally {
      if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function prepare(): Promise<void> {
    const id = supportCaseId;
    if (busyRef.current || !mounted.current || !options?.items.some((item) => item.supportCaseId === id)) return;
    const own = ++generation.current;
    busyRef.current = true; setBusy(true); setError(null); setPrepared(false);
    try {
      const value = await api.exportRecords(id);
      if (!mounted.current || own !== generation.current) return;
      downloadJson(value, id);
      setPrepared(true);
      const latest = await api.history(id);
      if (!mounted.current || own !== generation.current) return;
      setHistory(latest);
    } catch (cause) {
      if (!mounted.current || own !== generation.current) return;
      const failure = safeError(cause); setError(failure); onFailure(failure);
    } finally {
      if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function refreshHistory(cursor?: string): Promise<void> {
    const id = supportCaseId;
    if (busyRef.current || !mounted.current || id === '') return;
    const own = ++generation.current;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const latest = await api.history(id, cursor);
      if (!mounted.current || own !== generation.current) return;
      setHistory((current) => ({ items: cursor === undefined ? latest.items : [...(current?.items ?? []), ...latest.items], nextCursor: latest.nextCursor }));
    } catch (cause) {
      if (!mounted.current || own !== generation.current) return;
      const failure = safeError(cause); setError(failure); onFailure(failure);
    } finally {
      if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  return <WireCard as="section" labelledBy="exports-title" title={<h2 id="exports-title">기록 내보내기</h2>}>
    <WireCallout tone="info" title="담당 당사자의 공식 기록을 준비합니다">
      당사자와 사업을 고르면 권한과 공식 기록 범위를 다시 확인합니다. 서버에 파일을 보관하지 않고 현재 브라우저에서 JSON 파일을 내려받습니다. 개인정보 금고와 원음, 전사 전문, 미승인 AI 내용은 파일에 포함하지 않습니다.
    </WireCallout>
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
      <WireFormField label="당사자와 사업" htmlFor="export-support-case-id" required>
        <select id="export-support-case-id" value={supportCaseId} required disabled={busy || options === null}
          onChange={(event) => { setSupportCaseId(event.target.value); setHistory(null); setPrepared(false); setError(null); }}>
          <option value="">당사자와 사업을 선택하세요</option>
          {options?.items.map((item) => <option key={item.supportCaseId} value={item.supportCaseId}>
            {item.name ?? item.beneficiaryId}{item.phone ? ` (${item.phone})` : ''} / {item.programName}{item.intakeAt ? ` / ${item.intakeAt.slice(0, 10)}` : ''}{item.status === 'closed' ? ' / 종결' : ''}
          </option>)}
        </select>
      </WireFormField>
      <div className="business-actions">
        <WireButton variant="primary" type="submit" disabled={busy || supportCaseId === ''}>기록 파일 내려받기</WireButton>
        <WireButton variant="neutral" type="button" disabled={busy || supportCaseId === ''} onClick={() => { void refreshHistory(); }}>내보내기 이력 확인</WireButton>
        <WireButton variant="neutral" type="button" disabled={busy} onClick={() => { void loadCases(); }}>대상 다시 확인</WireButton>
        {options?.nextCursor && <WireButton variant="neutral" type="button" disabled={busy} onClick={() => { void loadCases(options.nextCursor ?? undefined); }}>당사자 더 불러오기</WireButton>}
      </div>
    </form>
    {error && <WireError>{error.message}</WireError>}
    {prepared && <WireEmpty live>기록 파일을 준비해 브라우저 다운로드를 시작했습니다. 컴퓨터에 저장되었는지는 브라우저에서 확인해 주세요.</WireEmpty>}
    {busy && <WireEmpty live>담당 범위와 기록을 확인하고 있습니다.</WireEmpty>}
    {!busy && options?.items.length === 0 && <WireEmpty>내보낼 수 있는 담당 당사자가 없습니다.</WireEmpty>}
    {!busy && history !== null && history.items.length === 0 && history.nextCursor === null && <WireEmpty>확인된 내보내기 이력이 없습니다.</WireEmpty>}
    {history !== null && <WireCardSection title="내보내기 이력">
      {history.items.map((item) => <div key={item.id}>
        <WireItem title={new Date(item.createdAt).toLocaleString('ko-KR')}
          description={`목표 ${item.goalCount}개, 상담 ${item.sessionCount}회`}
          status={<WireBadge tone="neutral">기록 준비</WireBadge>} />
        <WireDataRows>
          <WireDataRow label="실행자 ID" value={item.actorId} />
          <WireDataRow label="감사 번호" value={String(item.id)} />
        </WireDataRows>
      </div>)}
      {history.nextCursor && <WireButton variant="neutral" disabled={busy} onClick={() => { void refreshHistory(history.nextCursor ?? undefined); }}>이전 이력 더 보기</WireButton>}
      <p>기록을 준비한 이력만 보관합니다. 서버에 저장된 파일이나 컴퓨터의 다운로드 완료 목록은 아닙니다.</p>
    </WireCardSection>}
  </WireCard>;
}
