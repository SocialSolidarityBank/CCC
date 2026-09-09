import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  Icon, WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import type { AuditLogFilter, AuditLogItem, AuditLogPage, RetentionReasonKind, RetentionReview, SettingsApi } from './api';
import { BusinessError, safeError } from './errors';

const ACTOR_LABELS = { admin: '기관 관리자', counselor: '실무자', service: '시스템' } as const;
const ACTION_LABELS: Record<string, string> = {
  read: '조회', view: '조회', create: '생성', update: '변경', delete: '삭제',
  assign: '배정', accept: '배정 수락', retain: '보존 결정', purge: '파기 결정',
};
const TABLE_LABELS: Record<string, string> = {
  support_cases: '지원 사례', beneficiaries: '당사자', assignments: '담당 배정',
  pii_retention_reviews: '개인정보 보존 검토', programs: '사업', organization_settings: '기관 설정',
};
const STATUS_LABELS = { pending: '검토 필요', retained: '보존 중', purged: '파기 완료' } as const;
const STATUS_TONES = { pending: 'lavender', retained: 'mint', purged: 'neutral' } as const;
const REASON_LABELS: Record<RetentionReasonKind, string> = {
  extended_consent: '추가 동의', active_work: '진행 중 업무', legal_requirement: '법적 보존 의무',
};

function dateLabel(value: string): string {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}
function toCanonicalUtc(localValue: string): string | null {
  const parsed = new Date(localValue);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function AuditModule({ api, onFailure }: { api: SettingsApi; onFailure: (error: BusinessError) => void }) {
  const [filters, setFilters] = useState({ actorId: '', supportCaseId: '', from: '', to: '', limit: 50 });
  const [applied, setApplied] = useState<AuditLogFilter>({ limit: 50 });
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [previous, setPrevious] = useState<AuditLogPage[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  async function load(nextFilter: AuditLogFilter, append: boolean): Promise<void> {
    const own = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api.getAuditLog(nextFilter);
      if (own !== generation.current) return;
      if (append && page !== null) setPrevious((items) => [...items, page]);
      setApplied(nextFilter);
      setPage(result);
    } catch (cause) {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      setError(safe);
      onFailure(safe);
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  useEffect(() => { void load({ limit: 50 }, false); return () => { generation.current += 1; }; }, [api]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next: AuditLogFilter = { limit: filters.limit };
    if (filters.actorId.trim()) next.actorId = filters.actorId.trim();
    if (filters.supportCaseId.trim()) next.supportCaseId = filters.supportCaseId.trim();
    if (filters.from) next.from = `${filters.from}T00:00:00.000Z`;
    if (filters.to) next.to = `${filters.to}T23:59:59.999Z`;
    setPrevious([]);
    void load(next, false);
  }

  function nextPage(): void {
    if (page?.nextCursor === null || page?.nextCursor === undefined || busy) return;
    void load({ ...applied, cursor: page.nextCursor }, true);
  }
  function previousPage(): void {
    const prior = previous.at(-1);
    if (prior === undefined || busy) return;
    setPrevious((items) => items.slice(0, -1));
    setPage(prior);
    setApplied(({ cursor: _cursor, ...current }) => current);
  }

  return <WireCard as="section" labelledBy="audit-title" title={<h2 id="audit-title">감사 기록</h2>}>
    <WireCallout tone="info" title="기관 관리자 전용">
      감사 기록에는 행위와 연결된 안전한 메타데이터만 표시합니다. 상담 내용이나 원본 개인정보는 표시하지 않습니다.
    </WireCallout>
    <form className="business-form" onSubmit={submitFilters}>
      <WireFormField label="행위자 식별자" htmlFor="audit-actor-id" hint="필요할 때만 계정 식별자를 입력합니다.">
        <input id="audit-actor-id" value={filters.actorId} maxLength={200} disabled={busy}
          onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value }))} />
      </WireFormField>
      <WireFormField label="지원 사례 식별자" htmlFor="audit-case-id">
        <input id="audit-case-id" value={filters.supportCaseId} maxLength={200} disabled={busy}
          onChange={(event) => setFilters((current) => ({ ...current, supportCaseId: event.target.value }))} />
      </WireFormField>
      <WireFormField label="시작일" htmlFor="audit-from"><input id="audit-from" type="date" value={filters.from} disabled={busy}
        onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></WireFormField>
      <WireFormField label="종료일" htmlFor="audit-to"><input id="audit-to" type="date" value={filters.to} disabled={busy}
        onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></WireFormField>
      <WireButton variant="primary" type="submit" disabled={busy}>필터 적용</WireButton>
    </form>
    {error && <WireError>{error.message}</WireError>}
    {busy && <WireEmpty live>감사 기록을 확인하고 있습니다.</WireEmpty>}
    {!busy && page !== null && page.items.length === 0 && <WireEmpty>조건에 맞는 감사 기록이 없습니다.</WireEmpty>}
    {!busy && page !== null && page.items.length > 0 && <div>
      {page.items.map((item) => <AuditItem key={item.id} item={item} />)}
    </div>}
    <div className="business-actions">
      <WireButton variant="neutral" disabled={busy || previous.length === 0} onClick={previousPage}>이전 기록</WireButton>
      <WireButton variant="neutral" disabled={busy || page?.nextCursor === null || page?.nextCursor === undefined} onClick={nextPage}>다음 기록</WireButton>
      <WireButton variant="neutral" disabled={busy} onClick={() => { setPrevious([]); void load(applied, false); }}>최신 정보 확인</WireButton>
    </div>
  </WireCard>;
}

function AuditItem({ item }: { item: AuditLogItem }) {
  const action = ACTION_LABELS[item.action] ?? '기타 활동';
  const target = TABLE_LABELS[item.targetTable] ?? '기타 대상';
  return <>
    <WireItem title={`${target} ${action}`} description={dateLabel(item.createdAt)}
      status={<WireBadge tone="mint">{ACTOR_LABELS[item.actorRole]}</WireBadge>} />
    <WireDataRows>
      <WireDataRow label="기록 계정" value={item.actorId} />
      <WireDataRow label="당사자 연결" value={<WireBadge tone={item.beneficiaryId === null ? 'neutral' : 'mint'}>
        {item.beneficiaryId === null ? '없음' : '연결됨'}
      </WireBadge>} />
      <WireDataRow label="지원 사례 연결" value={<WireBadge tone={item.supportCaseId === null ? 'neutral' : 'mint'}>
        {item.supportCaseId === null ? '없음' : '연결됨'}
      </WireBadge>} />
    </WireDataRows>
  </>;
}

type RetentionDraft = { reasonKind: RetentionReasonKind; reason: string; retainUntil: string };
const blankDraft = (): RetentionDraft => ({ reasonKind: 'extended_consent', reason: '', retainUntil: '' });

export function RetentionModule({ api, onFailure }: { api: SettingsApi; onFailure: (error: BusinessError) => void }) {
  const [reviews, setReviews] = useState<RetentionReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RetentionDraft>>({});
  const [error, setError] = useState<BusinessError | null>(null);
  const [busy, setBusy] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const value = await api.getRetentionReviews();
      setReviews(value);
      setNeedsRefresh(false);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe); onFailure(safe);
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [api]);

  function updateDraft(id: string, patch: Partial<RetentionDraft>): void {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? blankDraft()), ...patch } }));
  }
  async function decide(review: RetentionReview, input: { decision: 'purge' } | { decision: 'retain'; reasonKind: RetentionReasonKind; reason: string; retainUntil: string }): Promise<void> {
    if (busyId !== null || needsRefresh) return;
    setBusyId(review.beneficiaryId); setError(null); setLastAction(null);
    try {
      await api.reviewRetention(review.beneficiaryId, input);
      const current = await api.getRetentionReviews();
      setReviews(current);
      setNeedsRefresh(false);
      setLastAction(input.decision === 'purge' ? '최종 파기 결정을 확인했습니다.' : '보존 결정을 확인했습니다.');
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe); setNeedsRefresh(true); onFailure(safe);
    } finally { setBusyId(null); }
  }

  return <WireCard as="section" labelledBy="retention-title" title={<h2 id="retention-title">개인정보 보존 검토</h2>}>
    <WireCallout tone="info" title="검토 대기 자료">
      보존 기간이 지난 당사자 자료만 표시합니다. 결정이 성공한 뒤 최신 검토 목록을 다시 확인합니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {lastAction && <WireEmpty live>{lastAction}</WireEmpty>}
    {busy && <WireEmpty live>보존 검토 목록을 확인하고 있습니다.</WireEmpty>}
    {!busy && reviews !== null && reviews.length === 0 && <WireEmpty>현재 검토할 자료가 없습니다.</WireEmpty>}
    {!busy && reviews !== null && reviews.map((review) => {
      const draft = drafts[review.beneficiaryId] ?? blankDraft();
      return <WireCardSection key={review.beneficiaryId} title={`당사자 자료 ${review.beneficiaryId}`}>
        <WireDataRows>
          <WireDataRow label="상태" value={<WireBadge tone={STATUS_TONES[review.status]}>{STATUS_LABELS[review.status]}</WireBadge>} />
          <WireDataRow label="검토 기한" value={dateLabel(review.reviewDueAt)} />
          <WireDataRow label="보존 상한" value={dateLabel(review.retentionCapDueAt)} />
          {review.reasonKind && <WireDataRow label="현재 사유" value={REASON_LABELS[review.reasonKind]} />}
        </WireDataRows>
        {review.status === 'pending' && <>
          <form className="business-form" onSubmit={(event) => {
            event.preventDefault();
            const retainUntil = toCanonicalUtc(draft.retainUntil);
            if (retainUntil === null || draft.reason.trim().length === 0 || draft.reason.trim().length > 500) {
              setError(safeError(new BusinessError('invalid_request', 400))); return;
            }
            void decide(review, { decision: 'retain', reasonKind: draft.reasonKind, reason: draft.reason, retainUntil });
          }}>
            <WireFormField label="보존 사유 종류" htmlFor={`retention-kind-${review.beneficiaryId}`} required>
              <select id={`retention-kind-${review.beneficiaryId}`} value={draft.reasonKind} disabled={busyId !== null || needsRefresh}
                onChange={(event) => updateDraft(review.beneficiaryId, { reasonKind: event.target.value as RetentionReasonKind })}>
                <option value="extended_consent">추가 동의</option><option value="active_work">진행 중 업무</option><option value="legal_requirement">법적 보존 의무</option>
              </select>
            </WireFormField>
            <WireFormField label="보존 사유" htmlFor={`retention-reason-${review.beneficiaryId}`} required hint="최대 500자">
              <textarea id={`retention-reason-${review.beneficiaryId}`} value={draft.reason} maxLength={500} required disabled={busyId !== null || needsRefresh}
                onChange={(event) => updateDraft(review.beneficiaryId, { reason: event.target.value })} />
            </WireFormField>
            <WireFormField label="보존 종료 시각" htmlFor={`retention-until-${review.beneficiaryId}`} required>
              <input id={`retention-until-${review.beneficiaryId}`} type="datetime-local" value={draft.retainUntil} required disabled={busyId !== null || needsRefresh}
                onChange={(event) => updateDraft(review.beneficiaryId, { retainUntil: event.target.value })} />
            </WireFormField>
            <div className="business-actions">
              <WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={busyId !== null || needsRefresh}>보존 결정</WireButton>
              <WireButton variant="danger" type="button" disabled={busyId !== null || needsRefresh} onClick={() => { void decide(review, { decision: 'purge' }); }}>최종 파기</WireButton>
            </div>
          </form>
        </>}
      </WireCardSection>;
    })}
    {needsRefresh && <WireCallout tone="info" title="다시 시도하기 전에 최신 상태를 확인해 주세요">
      저장 결과를 확정하지 못했습니다. 입력한 내용은 남아 있으니 최신 정보를 확인한 뒤 다시 결정해 주세요.
    </WireCallout>}
    <WireButton variant="neutral" disabled={busy || busyId !== null} onClick={() => { void refresh(); }}>최신 정보 확인</WireButton>
  </WireCard>;
}
