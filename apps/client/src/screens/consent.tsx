import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError,
} from '@ccc/web/wire';
import type { ConsentDisclosureSnapshot, CurrentConsentState } from '@ccc/contracts/consent';
import { CONSENT_DOMAIN_LABELS, CONSENT_STATE_LABELS } from '../business/consent';
import { type BusinessError, safeError } from '../business/errors';
import type { Session } from '../business/session';

/** 여섯 영역 동의 화면. 서버가 발행한 고지문과 상태만 다루고 옛 2종 체크를 대신하지 않는다. */
export function ConsentScreen() {
  const session = useOutletContext<Session>();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
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
    disclosure: ConsentDisclosureSnapshot, decision: 'grant' | 'withdraw' | 'decline', expectedRevision: number | null,
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

  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;

  return <WireCard title="여섯 영역 동의">
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div></>}
    {states === null && error === null && <WireEmpty live reserve>동의 상태와 고지문을 불러오고 있습니다.</WireEmpty>}
    {states !== null && disclosures !== null && <>
      <WireCallout tone="info" title="고지문은 서버가 발행합니다">
        아래 문안은 서버가 발행한 고지문 그대로입니다. 동의를 기록하면 그 문안의 버전과 확인값이 함께 남습니다.
      </WireCallout>
      {states.map((state) => {
        const disclosure = disclosures.find((entry) => entry.domain === state.domain) ?? null;
        return <WireCardSection key={state.domain} title={CONSENT_DOMAIN_LABELS[state.domain]}
          action={<WireBadge tone={state.state === 'granted' ? 'mint' : state.state === 'not_granted' ? 'coral' : 'neutral'}>
            {CONSENT_STATE_LABELS[state.state]}
          </WireBadge>}>
          {disclosure === null
            ? <WireCallout tone="info" title="발행된 고지문이 없습니다">
              이 영역의 고지문을 발행할 수 없어 동의를 기록하지 않습니다. 기관 설정의 문안 등록 상태를 확인해 주세요.
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
                  onClick={() => { void decide(disclosure, 'decline', state.revision); }}>동의하지 않음</WireButton>
                {state.state === 'granted' && <WireButton variant="neutral" disabled={busy}
                  onClick={() => { void decide(disclosure, 'withdraw', state.revision); }}>철회</WireButton>}
              </div>
            </>}
        </WireCardSection>;
      })}
      <WireCallout tone="info" title="옛 2종 체크와의 관계">
        당사자 정보 화면의 옛 2종 체크는 아직 그대로 있습니다. 여기서 기록한 여섯 영역이 그 체크를 자동으로 바꾸지 않고,
        옛 기록도 여섯 영역으로 올려 적지 않습니다.
      </WireCallout>
      <div className="business-actions">
        <WireButton variant="neutral" href={`${base}/records`}>상담 기록 확인하기</WireButton>
      </div>
    </>}
  </WireCard>;
}
