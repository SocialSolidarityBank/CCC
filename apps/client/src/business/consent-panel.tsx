import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WireBadge, WireButton, WireCallout, WireCardSection, WireDataRow, WireDataRows, WireEmpty, WireError,
} from '@ccc/wire';
import type { ConsentDisclosureSnapshot, CurrentConsentState } from '@ccc/contracts/consent';
import { CONSENT_DOMAIN_LABELS, CONSENT_STATE_LABELS } from './consent';
import { type BusinessError, safeError } from './errors';
import type { Session } from './session';

/**
 * 여섯 영역 동의 편집 자리 (S7 §6). 별도 화면을 만들지 않고 당사자 정보의 참여 사업 구획 안에 붙인다.
 * 옛 2종 체크 입력은 사라졌고 이 자리만 남는다(S7 §5.1.1 clean cutover).
 *
 * 화면은 서버가 발행한 고지문만 보여 주고, 그 문안의 버전과 확인값, 스냅샷 ID를 그대로 되돌려 보낸다.
 * 옛 자료를 여섯 영역 사건으로 바꾸지 않는다.
 */
export function ConsentPanel({ session, supportCaseId }: { session: Session; supportCaseId: string }) {
  const [states, setStates] = useState<CurrentConsentState[] | null>(null);
  const [disclosures, setDisclosures] = useState<ConsentDisclosureSnapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void Promise.all([session.consent.states(supportCaseId), session.consent.disclosures(supportCaseId)])
      .then(([current, issued]) => {
        if (own !== generation.current) return;
        setStates(current);
        setDisclosures(issued);
      }).catch((cause: unknown) => {
        if (own !== generation.current) return;
        const safe = safeError(cause);
        if (safe.code === 'session_changed') return;
        setError(safe);
        if (safe.status === 401) void session.auth.signOut(safe);
      });
  }, [session.consent, session.auth, supportCaseId]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const decide = async (
    disclosure: ConsentDisclosureSnapshot,
    decision: 'grant' | 'withdraw' | 'decline',
    expectedRevision: number | null,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.consent.record(supportCaseId, {
        disclosure, decision, idempotencyKey: crypto.randomUUID(), expectedRevision,
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

  if (error !== null) {
    return <WireCardSection title="동의">
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div>
    </WireCardSection>;
  }
  if (states === null || disclosures === null) {
    return <WireCardSection title="동의"><WireEmpty live reserve>동의 상태를 불러오고 있습니다.</WireEmpty></WireCardSection>;
  }

  return <>
    {states.map((state) => {
      const disclosure = disclosures.find((entry) => entry.domain === state.domain) ?? null;
      return <WireCardSection key={state.domain} title={CONSENT_DOMAIN_LABELS[state.domain]}
        action={<WireBadge tone={state.state === 'granted' ? 'mint' : state.state === 'not_granted' ? 'coral' : 'neutral'}>
          {CONSENT_STATE_LABELS[state.state]}
        </WireBadge>}>
        {disclosure === null
          ? <WireCallout tone="info" title="이 항목의 동의 상태가 확인되지 않아 해당 처리를 진행할 수 없습니다">
            수기 기록은 계속 사용할 수 있습니다.
          </WireCallout>
          : <>
            <p className="wire-section-value">{disclosure.fullKoreanCopy}</p>
            <WireDataRows>
              <WireDataRow label="받는 곳" value={disclosure.providerLegalRecipient ?? disclosure.provider ?? '기관 안'} />
              <WireDataRow label="처리 국가" value={disclosure.country ?? '국내'} />
              <WireDataRow label="문안 버전" value={disclosure.copyVersion} />
              <WireDataRow label="현재 결정 시각" value={state.effectiveAt ?? '기록 없음'} />
            </WireDataRows>
            <div className="business-actions">
              <WireButton variant="primary" disabled={busy}
                onClick={() => { void decide(disclosure, 'grant', state.revision); }}>동의함</WireButton>
              <WireButton variant="neutral" disabled={busy}
                onClick={() => { void decide(disclosure, 'decline', state.revision); }}>거부함</WireButton>
              {state.state === 'granted' && <WireButton variant="neutral" disabled={busy}
                onClick={() => { void decide(disclosure, 'withdraw', state.revision); }}>철회함</WireButton>}
            </div>
          </>}
      </WireCardSection>;
    })}
  </>;
}
