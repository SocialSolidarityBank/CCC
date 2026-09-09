import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import { type AuditLogItem, type RetentionReview, type RetentionReasonKind } from '../business/api';
import { type BusinessError, safeError } from '../business/errors';
import { AccountModule, InstitutionModule, MemoryModule } from '../business/settings-modules';
import { destinationAt } from '../business/navigation';
import type { Session } from '../business/session';

const RETENTION_STATUS_LABELS: Record<RetentionReview['status'], string> = {
  pending: '검토 대기', retained: '보존', purged: '파기 완료',
};
const RETENTION_REASON_LABELS: Record<RetentionReasonKind, string> = {
  extended_consent: '연장 동의', active_work: '진행 중 업무', legal_requirement: '법적 보존 사유',
};

function useFailure(session: Session) {
  return useCallback((error: BusinessError) => {
    if (error.status === 401) void session.auth.signOut(error);
    else if (error.code === 'mfa_required') session.auth.recheck(true);
  }, [session.auth]);
}

function AuditModule({ session }: { session: Session }) {
  const [items, setItems] = useState<AuditLogItem[] | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getAuditLog({ limit: 20 }).then((page) => {
      if (own === generation.current) setItems(page.items);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  return <WireCard title="감사 기록">
    <WireCallout tone="info" title="누가 무엇을 열고 바꿨는지만 남습니다">
      상담 내용과 개인정보 값은 이 목록에 실리지 않습니다. 기록은 지울 수 없습니다.
    </WireCallout>
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div></>}
    {items === null && error === null && <WireEmpty live reserve>최근 감사 기록을 불러오고 있습니다.</WireEmpty>}
    {items !== null && items.length === 0 && <WireEmpty>기록이 없습니다.</WireEmpty>}
    {(items ?? []).map((item) => <WireItem key={item.id}
      title={item.action}
      description={`${item.targetTable}, ${item.createdAt}, 수행자 ${item.actorId}`}
      status={<WireBadge tone="neutral">{item.actorRole}</WireBadge>} />)}
  </WireCard>;
}

function RetentionModule({ session }: { session: Session }) {
  const [reviews, setReviews] = useState<RetentionReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { reasonKind: RetentionReasonKind; reason: string; retainUntil: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getRetentionReviews().then((value) => {
      if (own === generation.current) setReviews(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const decide = async (review: RetentionReview, decision: 'retain' | 'purge') => {
    if (busy) return;
    const draft = drafts[review.beneficiaryId] ?? { reasonKind: 'active_work' as RetentionReasonKind, reason: '', retainUntil: '' };
    setBusy(true);
    setError(null);
    try {
      await session.api.reviewRetention(review.beneficiaryId, decision === 'purge'
        ? { decision: 'purge' }
        : {
          decision: 'retain', reasonKind: draft.reasonKind, reason: draft.reason,
          retainUntil: draft.retainUntil === '' ? '' : new Date(`${draft.retainUntil}T00:00:00.000Z`).toISOString(),
        });
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="개인정보 보존 검토">
    <WireCallout tone="info" title="파기는 서버 설정과 관리자 확인을 모두 요구합니다">
      이 화면은 검토 큐를 보여 주고 결정을 남깁니다. 최종 파기는 서버가 그 두 조건을 확인한 뒤에만 실행합니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {reviews === null && error === null && <WireEmpty live reserve>검토 큐를 불러오고 있습니다.</WireEmpty>}
    {reviews !== null && reviews.length === 0 && <WireEmpty>검토할 항목이 없습니다.</WireEmpty>}
    {(reviews ?? []).map((review) => {
      const draft = drafts[review.beneficiaryId] ?? { reasonKind: 'active_work' as RetentionReasonKind, reason: '', retainUntil: '' };
      return <WireCardSection key={review.beneficiaryId} title={review.beneficiaryId}
        action={<WireBadge tone={review.status === 'pending' ? 'coral' : 'neutral'}>
          {RETENTION_STATUS_LABELS[review.status]}
        </WireBadge>}>
        <WireDataRows>
          <WireDataRow label="아카이브" value={review.archivedAt} />
          <WireDataRow label="검토 기한" value={review.reviewDueAt} />
          <WireDataRow label="보존 상한" value={review.retentionCapDueAt} />
          <WireDataRow label="현재 사유"
            value={review.reasonKind === null ? '없음' : RETENTION_REASON_LABELS[review.reasonKind]} />
        </WireDataRows>
        {review.status === 'pending' && <>
          <WireFormField label="보존 사유 종류" htmlFor={`retention-kind-${review.beneficiaryId}`} control="select">
            <select id={`retention-kind-${review.beneficiaryId}`} value={draft.reasonKind} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts,
                [review.beneficiaryId]: { ...draft, reasonKind: event.target.value as RetentionReasonKind },
              })}>
              {(Object.keys(RETENTION_REASON_LABELS) as RetentionReasonKind[]).map((kind) => (
                <option key={kind} value={kind}>{RETENTION_REASON_LABELS[kind]}</option>
              ))}
            </select>
          </WireFormField>
          <WireFormField label="보존 사유" htmlFor={`retention-reason-${review.beneficiaryId}`}>
            <input id={`retention-reason-${review.beneficiaryId}`} value={draft.reason} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts, [review.beneficiaryId]: { ...draft, reason: event.target.value },
              })} />
          </WireFormField>
          <WireFormField label="보존 기한" htmlFor={`retention-until-${review.beneficiaryId}`}
            hint="종결 후 5년 상한을 넘길 수 없습니다">
            <input id={`retention-until-${review.beneficiaryId}`} type="date" value={draft.retainUntil} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts, [review.beneficiaryId]: { ...draft, retainUntil: event.target.value },
              })} />
          </WireFormField>
          <div className="business-actions">
            <WireButton variant="primary" disabled={busy || draft.reason.trim() === '' || draft.retainUntil === ''}
              onClick={() => { void decide(review, 'retain'); }}>보존</WireButton>
            <WireButton variant="neutral" disabled={busy}
              onClick={() => { void decide(review, 'purge'); }}>파기 요청</WireButton>
          </div>
        </>}
      </WireCardSection>;
    })}
  </WireCard>;
}

export function SettingsScreen() {
  const session = useOutletContext<Session>();
  const location = useLocation();
  const onFailure = useFailure(session);
  const destination = destinationAt(location.pathname, location.search);

  if (destination?.id === 'system') {
    const cap = session.capabilities;
    return <WireCard title="서버가 확인한 연결 상태">
      <WireDataRows>
        <WireDataRow label="설치 방식" value={cap.mode} />
        <WireDataRow label="음성 인식" value={cap.sttMode === 'off' ? '꺼짐' : cap.sttMode} />
        <WireDataRow label="지정된 엔진" value={cap.sttEngine ?? '승인된 엔진 없음'} />
        <WireDataRow label="AI 처리" value={cap.llmMode === 'off' ? '꺼짐' : cap.llmMode} />
        <WireDataRow label="처리 장비" value={cap.agentStatus} />
      </WireDataRows>
      <WireCallout tone="info" title="확인 범위">
        서버가 응답한 설치 값입니다. 실제 인증, 장비 준비나 제품 활성화가 모두 완료됐다는 뜻은 아닙니다.
      </WireCallout>
      <div className="business-actions">
        <WireButton variant="neutral" onClick={() => session.auth.recheck()}>상태 다시 확인</WireButton>
      </div>
    </WireCard>;
  }
  if (destination?.id === 'institution-profile') return <InstitutionModule api={session.api} onFailure={onFailure} />;
  if (destination?.id === 'memory') return <MemoryModule api={session.api} onFailure={onFailure} />;
  if (destination?.id === 'audit') return <AuditModule session={session} />;
  if (destination?.id === 'retention') return <RetentionModule session={session} />;
  return <AccountModule me={session.me} api={session.api} onFailure={onFailure} />;
}
