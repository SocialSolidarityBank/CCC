import { WireCallout, WireCardSection, WireChoice, WireDataRow, WireDataRows, WireEmpty } from '@ccc/wire';
import type { ConsentDisclosureSnapshot, ConsentDomain } from '@ccc/contracts/consent';
import { CONSENT_DOMAIN_LABELS, consentEventFrom } from './consent';

/** 영역별 결정. 화면이 기본값을 정하지 않고 사람이 여섯 개를 다 고른다. */
export type ConsentDecisions = Partial<Record<ConsentDomain, 'grant' | 'decline'>>;

export function allDomainsDecided(
  disclosures: readonly ConsentDisclosureSnapshot[], decisions: ConsentDecisions,
): boolean {
  return disclosures.length > 0 && disclosures.every((entry) => decisions[entry.domain] !== undefined);
}

/** 발행된 고지문과 결정으로 서버가 받는 사건 여섯 개를 만든다. */
export function consentEventsFrom(
  disclosures: readonly ConsentDisclosureSnapshot[], decisions: ConsentDecisions,
): Record<string, unknown>[] {
  return disclosures.map((entry) => consentEventFrom(entry, decisions[entry.domain] ?? 'decline'));
}

/**
 * 등록과 요청 링크가 함께 쓰는 여섯 영역 결정 입력. 문안은 서버가 발행한 것만 보여 주고
 * 화면이 문구를 만들지 않는다(S7 §6).
 */
export function ConsentDecisionList({ disclosures, decisions, disabled, onChange }: {
  disclosures: readonly ConsentDisclosureSnapshot[];
  decisions: ConsentDecisions;
  disabled: boolean;
  onChange: (next: ConsentDecisions) => void;
}) {
  if (disclosures.length === 0) {
    return <WireEmpty live reserve>동의 문안을 불러오고 있습니다.</WireEmpty>;
  }
  return <>
    <WireCallout tone="info" title="여섯 영역을 각각 고릅니다">
      아래 문안은 서버가 발행한 그대로입니다. 고른 결과는 문안 버전과 확인값까지 함께 기록됩니다.
    </WireCallout>
    {disclosures.map((entry) => <WireCardSection key={entry.domain} title={CONSENT_DOMAIN_LABELS[entry.domain]}>
      <p className="wire-section-value">{entry.fullKoreanCopy}</p>
      <WireDataRows>
        <WireDataRow label="받는 곳" value={entry.providerLegalRecipient ?? entry.provider ?? '기관 안'} />
        <WireDataRow label="처리 국가" value={entry.country ?? '국내'} />
      </WireDataRows>
      <WireChoice type="radio" name={`consent-${entry.domain}`} label="동의함" value="grant"
        id={`consent-${entry.domain}-grant`} checked={decisions[entry.domain] === 'grant'} disabled={disabled}
        onChange={() => onChange({ ...decisions, [entry.domain]: 'grant' })} />
      <WireChoice type="radio" name={`consent-${entry.domain}`} label="동의하지 않음" value="decline"
        id={`consent-${entry.domain}-decline`} checked={decisions[entry.domain] === 'decline'} disabled={disabled}
        onChange={() => onChange({ ...decisions, [entry.domain]: 'decline' })} />
    </WireCardSection>)}
  </>;
}
