import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireItem,
} from '@ccc/wire';
import type { ReportEvidence, SupportCaseReport } from '@ccc/contracts/report';
import {
  ACTION_RESOLUTION_LABELS, REPORT_SECTION_LABELS, REPORT_SECTION_ORDER, type ReportSectionKey,
} from '../business/report';
import { type BusinessError, safeError } from '../business/errors';
import type { Session } from '../business/session';

const CHANNEL_LABELS: Record<SupportCaseReport['sessions'][number]['channel'], string> = {
  in_person: '대면', phone: '전화', video: '화상',
};

/** 근거 인용은 그 자리에서 보이고 회차로 이어진다(D73). 근거 없는 문장은 리포트에 없다. */
function Evidence({ item, base }: { item: ReportEvidence; base: string }) {
  return <>
    {/* 인용 부품(WireQuote)이 아직 @ccc/wire 공개 진입점에 없어 기존 본문 클래스를 쓴다.
        공개 exports 추가는 design 레인 몫이라 여기서 손대지 않는다. */}
    <p className="wire-section-value">{item.text}</p>
    <WireButton variant="neutral" href={`${base}/records#session-${encodeURIComponent(item.sessionId)}`}>
      {`${item.sessionNumber}회차 기록 보기`}
    </WireButton>
  </>;
}

export function ReportScreen() {
  const session = useOutletContext<Session>();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  const [report, setReport] = useState<SupportCaseReport | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.report.read(supportCaseId).then((value) => {
      if (own === generation.current) setReport(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.report, session.auth, supportCaseId]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;

  if (error !== null) {
    return <WireCard title="전체 상담 리포트">
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div>
    </WireCard>;
  }
  if (report === null) {
    return <WireCard title="전체 상담 리포트"><WireEmpty live reserve>리포트를 불러오고 있습니다.</WireEmpty></WireCard>;
  }

  const missing = REPORT_SECTION_ORDER.filter((key: ReportSectionKey) => report.sections[key] === undefined);

  return <>
    <WireCard title="전체 상담 리포트">
      <WireDataRows>
        <WireDataRow label="사업" value={report.programName ?? report.programId} />
        <WireDataRow label="상태" value={report.status === 'active' ? '진행 중' : '종결'} />
        <WireDataRow label="회차 수" value={`${report.sessions.length}회`} />
      </WireDataRows>
      {report.firstIntakeGoal === undefined
        ? <WireCallout tone="info" title="첫 인테이크 목표 기록이 없습니다">
          지금 목표를 첫 목표로 대신 적지 않습니다.
        </WireCallout>
        : <WireCardSection title="첫 인테이크에서 세운 방향">
          <Evidence item={report.firstIntakeGoal} base={base} />
        </WireCardSection>}
      {missing.length > 0 && <WireCallout tone="info" title="자료가 없어 빠진 구획">
        {`${missing.map((key) => REPORT_SECTION_LABELS[key]).join(', ')}. 이것은 해당 사항이 없다는 뜻이 아니라 기록된 근거가 없다는 뜻입니다.`}
      </WireCallout>}
    </WireCard>

    <WireCard title="회차별 기록">
      {report.sessions.length === 0 && <WireEmpty>공식 기록이 된 회차가 없습니다.</WireEmpty>}
      {report.sessions.map((item) => <WireItem key={item.sessionId}
        title={`${item.sessionNumber}회차`}
        description={item.summary?.text ?? '요약으로 쓸 근거가 없습니다'}
        status={<>
          <WireBadge tone={item.kind === 'intake' ? 'lavender' : 'mint'}>
            {item.kind === 'intake' ? '인테이크' : '기본 상담'}
          </WireBadge>
          <WireBadge tone="neutral">{CHANNEL_LABELS[item.channel]}</WireBadge>
        </>}
        action={<WireButton variant="neutral" href={`${base}/records#session-${encodeURIComponent(item.sessionId)}`}>
          기록 보기
        </WireButton>} />)}
    </WireCard>

    {report.sections.situationChanges !== undefined && <WireCard title={REPORT_SECTION_LABELS.situationChanges}>
      {report.sections.situationChanges.entries.map((item) => <WireCardSection key={`${item.sessionId}-${item.source}`}
        title={`${item.sessionNumber}회차`}>
        <Evidence item={item} base={base} />
      </WireCardSection>)}
    </WireCard>}

    {report.sections.goalChanges !== undefined && <WireCard title={REPORT_SECTION_LABELS.goalChanges}>
      <WireCardSection title="처음 세운 목표">
        <Evidence item={report.sections.goalChanges.initialGoal} base={base} />
      </WireCardSection>
      {report.sections.goalChanges.directions.map((item) => <WireCardSection key={`${item.sessionId}-${item.source}`}
        title={`${item.sessionNumber}회차 방향`}>
        <Evidence item={item} base={base} />
      </WireCardSection>)}
    </WireCard>}

    {report.sections.actionItems !== undefined && <WireCard title={REPORT_SECTION_LABELS.actionItems}>
      {report.sections.actionItems.items.map((item) => <WireCardSection key={item.id} title={item.description}
        action={<WireBadge tone={item.resolutionStatus === 'done' ? 'mint' : 'neutral'}>
          {item.resolutionStatus === null ? '상태 없음' : ACTION_RESOLUTION_LABELS[item.resolutionStatus]}
        </WireBadge>}>
        <WireDataRows>
          <WireDataRow label="기한" value={item.dueDate ?? '없음'} />
          <WireDataRow label="완료 시각" value={item.resolvedAt ?? '없음'} />
        </WireDataRows>
        <Evidence item={item.evidence} base={base} />
        {item.resolution !== undefined && <Evidence item={item.resolution} base={base} />}
      </WireCardSection>)}
    </WireCard>}

    {report.sections.resourceConnections !== undefined && <WireCard title={REPORT_SECTION_LABELS.resourceConnections}>
      {report.sections.resourceConnections.entries.map((item) => <WireCardSection
        key={`${item.evidence.sessionId}-${item.orgName}`} title={item.orgName}>
        <WireDataRows>
          <WireDataRow label="사업이나 서비스" value={item.serviceName ?? '기록 없음'} />
          <WireDataRow label="지원 내용" value={item.supportDetail ?? '기록 없음'} />
          <WireDataRow label="이용 기간" value={item.usagePeriod ?? '기록 없음'} />
          <WireDataRow label="진행 상태" value={item.progressStatus ?? '기록 없음'} />
        </WireDataRows>
        <Evidence item={item.evidence} base={base} />
      </WireCardSection>)}
    </WireCard>}

    {report.sections.riskSignals !== undefined && <WireCard title={REPORT_SECTION_LABELS.riskSignals}>
      {report.sections.riskSignals.entries.map((item) => <WireCardSection key={`${item.sessionId}-${item.source}`}
        title={`${item.sessionNumber}회차`}>
        <Evidence item={item} base={base} />
      </WireCardSection>)}
    </WireCard>}

    {report.nextConfirmations !== undefined && <WireCard title="다음에 확인할 것">
      {report.nextConfirmations.map((item) => <WireCardSection key={`${item.evidence.sessionId}-${item.item}`}
        title={item.item}>
        <WireDataRows>
          <WireDataRow label="이유" value={item.reason ?? '기록 없음'} />
          <WireDataRow label="확인 방법" value={item.method ?? '기록 없음'} />
          <WireDataRow label="확인 시점" value={item.dueDate ?? item.dueNote ?? '기록 없음'} />
          <WireDataRow label="담당" value={item.owner ?? '기록 없음'} />
        </WireDataRows>
        <Evidence item={item.evidence} base={base} />
      </WireCardSection>)}
    </WireCard>}

    <WireCard>
      <div className="business-actions">
        <WireButton variant="neutral" href={`${base}/records`}>상담 기록 확인하기</WireButton>
        <WireButton variant="neutral" href={`${base}/briefing`}>15초 페이지</WireButton>
      </div>
    </WireCard>
  </>;
}
