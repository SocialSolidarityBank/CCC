'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageTitle } from '../../components/wire/page-title';
import { ParticipantHeroCard } from '../../components/wire/participant-hero-card';
import { WireBullets, WireCard, WireCardDetails } from '../../components/wire/wire-card';
import { WireCardSection, WireItem } from '../../components/wire/wire-section';
import { WireBadge } from '../../components/wire/wire-badge';
import { WireButton } from '../../components/wire/wire-button';
import { WireCallout, WireQuote } from '../../components/wire/wire-callout';
import { WireActionMenu } from '../../components/wire/wire-action-menu';
import { WireChoice, WireFormField } from '../../components/wire/wire-form-field';
import { Chevron, DisclosureChevron } from '../../components/wire/chevron';
import { Icon } from '../../components/wire/wire-icon';
import styles from './prototype.module.css';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const variantNames = { A: '기존 구획에 통합', B: '요약을 독립 카드로', C: '짧은 미리보기와 펼침' };
const viewNames = { briefing: '15초 페이지', memory: '기억 상세', settings: '기관 설정' };
type View = keyof typeof viewNames;
const stateNames = { ready: '최신', updating: '반영 중', empty: '기록 없음', unavailable: '사용 불가' };
type MemoryState = keyof typeof stateNames;
const summary = [
  '이사 후 고정 지출 내역을 정리하고 있습니다.',
  '공과금 자동이체 날짜를 급여일 이후로 바꾸기로 했습니다.',
  '다음 상담 때 2주 지출 기록을 함께 보기로 했습니다.',
];
const evidence = [
  { title: '고정 지출 정리', text: summary[0]!, date: '2026-08-24', session: '기본 상담 2회차', quote: '이사하고 나서 매달 나가는 돈이 달라졌어요. 월세랑 공과금부터 적어 보고 있어요.', note: '당사자는 이사 후 달라진 고정 지출을 항목별로 적고 있다고 말했다. 다음 상담에서 정리한 내역을 함께 보기로 했다.' },
  { title: '자동이체 날짜 변경', text: summary[1]!, date: '2026-09-07', session: '기본 상담 3회차', quote: '월급 들어온 다음에 공과금이 나가게 날짜를 바꿔 보려고요.', note: '급여일과 공과금 출금일을 함께 살폈다. 당사자는 자동이체 날짜 변경 가능 여부를 확인하기로 했다. 변경 완료 여부는 아직 확인하지 않았다.' },
  { title: '2주 지출 기록 함께 보기', text: summary[2]!, date: '2026-09-07', session: '기본 상담 3회차', quote: '앞으로 2주 동안 쓴 돈을 적어 올게요. 다음에 같이 보면 좋겠어요.', note: '다음 상담까지 2주 동안 지출을 기록하고 함께 살펴보기로 했다. 금액이나 기록 방식은 이번 상담에서 정하지 않았다.' },
];
const observation = '최근 두 상담에서는 지출 항목 정리에서 출금일 조정과 짧은 기간의 지출 기록으로 계획이 구체화되고 있습니다.';

function StatusBadge({ state }: { state: MemoryState }) {
  return <WireBadge tone={state === 'updating' ? 'lavender' : 'neutral'}>{stateNames[state]}</WireBadge>;
}

function EvidenceDisclosure({ index, onSource }: { index: number; onSource: (index: number) => void }) {
  const item = evidence[index]!;
  return <details className="wire-source-quotes">
    <summary>근거 인용 보기 <DisclosureChevron variant="plain" /></summary>
    <div className="wire-source-quotes-body">
      <div className="wire-source-quotes-list"><WireQuote>{item.quote}</WireQuote></div>
      <WireButton variant="neutral" onClick={() => onSource(index)}>가상 회차 원문 보기</WireButton>
    </div>
  </details>;
}

function StaffQuestions() {
  return <WireCardSection title="실무자가 적은 오늘 질문" tone="mint">
    <WireBullets items={['공과금 자동이체 날짜를 바꿀 수 있었나요?', '2주 동안 적은 지출 중 먼저 같이 보고 싶은 항목은 무엇인가요?']} />
  </WireCardSection>;
}

function AIQuestions({ onSource }: { onSource: (index: number) => void }) {
  return <WireCardSection title="AI가 제안한 확인 질문" tone="lavender">
    <WireItem title="자동이체 변경 여부 확인" description="지난 상담에서는 바꾸기로 한 계획만 기록되어 있습니다." />
    <WireBullets items={['자동이체 날짜 변경 가능 여부를 확인해 보셨나요?']} />
    <EvidenceDisclosure index={1} onSource={onSource} />
  </WireCardSection>;
}

function ContextSummary({ state, compact, onMemory }: { state: MemoryState; compact: boolean; onMemory: () => void }) {
  const available = state === 'ready' || state === 'updating';
  return <WireCardSection title={<span className="wire-title-with-badge">현재 맥락 <StatusBadge state={state} /></span>} tone="lavender">
    {state === 'updating' && <p className="panel-meta" role="status">새 기록을 반영하고 있습니다. 아래는 9월 7일 17:10에 만든 마지막 기억입니다.</p>}
    {available ? <>
      {compact ? <>
        <WireBullets items={['고정 지출을 정리하며 자동이체 날짜 조정과 2주 지출 기록을 준비하고 있습니다.']} />
        <details className="wire-source-quotes">
          <summary>맥락 3개 펼쳐 보기 <DisclosureChevron variant="plain" /></summary>
          <div className={styles.inlineBody}><WireBullets items={summary} /><p className="panel-meta">마지막 반영 2026-09-07 17:10. 공식 기록을 찾기 위한 보조 기억입니다.</p></div>
        </details>
      </> : <><WireBullets items={summary} /><p className="panel-meta">마지막 반영 2026-09-07 17:10. 공식 기록을 찾기 위한 보조 기억입니다.</p></>}
      <div className={styles.controls}><WireButton variant="neutral" onClick={onMemory} chevron>기억과 근거 보기</WireButton></div>
    </> : <p className="panel-meta">{state === 'empty' ? '아직 누적 기억이 없습니다. 상담 기록이 쌓이면 현재 맥락을 정리합니다.' : '현재 기억을 사용할 수 없어 이전 내용과 근거를 숨겼습니다. 공식 상담 기록을 직접 확인해 주세요.'}</p>}
  </WireCardSection>;
}

export function CounselingMemoryPrototype() {
  const params = useSearchParams();
  const variant: Variant = params.get('variant') === 'B' ? 'B' : params.get('variant') === 'C' ? 'C' : 'A';
  const view: View = params.get('view') === 'memory' ? 'memory' : params.get('view') === 'settings' ? 'settings' : 'briefing';
  const state: MemoryState = params.get('state') === 'updating' ? 'updating' : params.get('state') === 'empty' ? 'empty' : params.get('state') === 'unavailable' ? 'unavailable' : 'ready';
  const available = state === 'ready' || state === 'updating';
  const [source, setSource] = useState<number | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState('자동이체 날짜 변경');
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(evidence.map((item) => [item.title, item.text])),
    '자동이체 날짜 변경': '자동이체 날짜는 아직 바꾸지 않았습니다. 다음 상담에서 변경 가능 여부를 확인하기로 했습니다.',
    '지출 계획이 구체화되는 흐름': observation,
  }));
  const correction = correctionDrafts[correctionTarget]!;
  const [enabled, setEnabled] = useState(true);
  const [result, setResult] = useState('');
  const correctionInput = useRef<HTMLTextAreaElement>(null);
  const correctionTrigger = useRef<HTMLButtonElement>(null);
  const sourcePanel = useRef<HTMLDivElement>(null);

  function choose(key: 'variant' | 'view' | 'state', value: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant);
    url.searchParams.set('view', view);
    url.searchParams.set('state', state);
    url.searchParams.set(key, value);
    window.history.pushState(null, '', url);
    setResult('');
    if (key === 'view' || (key === 'state' && value === 'unavailable')) setSource(null);
  }
  function cycle(delta: number) { choose('variant', variants[(variants.indexOf(variant) + delta + variants.length) % variants.length]!); }
  function showSource(index: number) { setSource(index); }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, button, a, summary, [contenteditable], [role="button"], [role="tab"], [role="menuitem"], [role="slider"]'))) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!);
      url.searchParams.set('view', view);
      url.searchParams.set('state', state);
      window.history.pushState(null, '', url);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [variant, view, state]);
  useEffect(() => { if (correctionOpen && view === 'memory' && available) correctionInput.current?.focus(); }, [correctionOpen, view, available]);
  useEffect(() => { setSource(null); }, [view, state]);
  useEffect(() => { if (source !== null) sourcePanel.current?.focus(); }, [source]);

  const context = <ContextSummary state={state} compact={variant === 'C'} onMemory={() => choose('view', 'memory')} />;

  return <div className="page-content"><div className={styles.prototype}>
    <WireCallout title="검토용 시안 / 가상 데이터 / 실제 저장 없음" tone="lavender">
      {variant}안: {variantNames[variant]} / {viewNames[view]} / {stateNames[state]}. 모든 입력과 결과는 이 탭 안에서만 바뀝니다.
    </WireCallout>
    <WireCardDetails title="시안 조작 (화면과 상태)">
      <WireCardSection title="시안 화면 선택">
        <div className={styles.controls}>{(Object.keys(viewNames) as View[]).map((key) => <WireButton key={key} variant={view === key ? 'secondary' : 'neutral'} onClick={() => choose('view', key)}>{viewNames[key]}</WireButton>)}</div>
      </WireCardSection>
      <WireCardSection title="기억 상태 시뮬레이션">
        <WireFormField label="화면에 표시할 상태" control="select" htmlFor="prototype-state">
          <select id="prototype-state" value={state} onChange={(event) => choose('state', event.target.value)}>{(Object.keys(stateNames) as MemoryState[]).map((key) => <option key={key} value={key}>{stateNames[key]}</option>)}</select>
        </WireFormField>
      </WireCardSection>
    </WireCardDetails>
    <PageTitle>{viewNames[view]}</PageTitle>
    {view !== 'settings' && <ParticipantHeroCard name="김하늘" beneficiaryId="demo-memory-001" details={[
      { label: '참여 사업', value: '가상 자립 지원 사업', tone: 'mint' },
      { label: '진행 상태', value: '진행 중', tone: 'mint' },
      { label: '최근 상담', value: '2026-09-07 기본 상담 3회차', tone: 'blue' },
    ]} actions={<WireButton variant="neutral" onClick={() => choose('view', view === 'memory' ? 'briefing' : 'memory')}>{view === 'memory' ? '15초 페이지' : '기억과 근거 보기'}</WireButton>} />}

    {view === 'briefing' && <>
      <WireCard><WireCardSection title="전체 목표" tone="mint"><WireBullets items={['고정 지출을 파악하고 매달 생활비를 계획한다.']} /></WireCardSection></WireCard>
      {variant === 'B' ? <>
        <WireCard title="오늘 만나기 전 꼭 기억할 것"><StaffQuestions /></WireCard>
        <WireCard>{context}</WireCard>
        {available && <WireCard><AIQuestions onSource={showSource} /></WireCard>}
      </> : <WireCard title="오늘 만나기 전 꼭 기억할 것">
        <StaffQuestions />
        {context}
        {available && <AIQuestions onSource={showSource} />}
      </WireCard>}
      <WireCard title="상담 내용 회차별 정리">
        {[2, 0].map((index) => <WireCardSection key={index} title={<span className="wire-title-with-badge">{evidence[index]!.date}<WireBadge tone="mint">{evidence[index]!.session}</WireBadge></span>} action={<WireButton variant="neutral" onClick={() => showSource(index)}>가상 기록 보기</WireButton>}>
          <WireBullets items={[index === 2 ? '출금일 조정 가능 여부를 확인하고 2주 지출 기록을 함께 보기로 함' : '이사 후 달라진 고정 지출을 정리하기 시작함']} />
        </WireCardSection>)}
      </WireCard>
      <WireCard title="미해결 액션"><WireCardSection title="다음 상담까지" tone="mint"><WireBullets items={['김하늘: 공과금 자동이체 날짜 변경 가능 여부 확인하기', '김하늘: 2주 지출 기록 가져오기']} /></WireCardSection></WireCard>
    </>}

    {view === 'memory' && <>
      <WireCard title={<div className={styles.heading}><span className="wire-title-with-badge">현재 기억 <StatusBadge state={state} /></span>{available && <WireActionMenu triggerRef={correctionTrigger} items={[{ label: '기억 정정', onSelect: () => setCorrectionOpen(true) }]} />}</div>}>
        <WireCardSection title="이 기억을 읽는 법"><WireBullets items={['공식 상담 기록을 바꾸지 않는 보조 기억입니다. 명시된 내용과 여러 회차를 묶어 본 관찰을 구분해서 읽어 주세요.']} />{available && <p className="panel-meta">마지막 반영 2026-09-07 17:10</p>}</WireCardSection>
        {state === 'updating' && <WireCardSection title="새 기록 반영 중" tone="lavender"><p className="panel-meta" role="status">아래 내용은 마지막 기억입니다. 정정 중인 입력은 그대로 유지됩니다.</p></WireCardSection>}
        {!available && <WireCardSection title={stateNames[state]}><p className="panel-meta">{state === 'empty' ? '아직 기억이 없습니다. 공식 기록이 쌓이면 여기에 정리됩니다.' : '이전 기억과 근거를 숨겼습니다. 지금은 공식 상담 기록을 직접 확인해 주세요.'}</p></WireCardSection>}
        {available && variant === 'A' && <>
          <WireCardSection title="명시된 내용" tone="mint"><div className={styles.items}>{evidence.map((item, index) => <div key={item.title}><WireItem title={item.title} description={`${item.date} ${item.session}`} /><WireBullets items={[item.text]} /><EvidenceDisclosure index={index} onSource={showSource} /></div>)}</div></WireCardSection>
          <WireCardSection title="기억 관찰" tone="lavender"><WireItem title="지출 계획이 구체화되는 흐름" description="두 회차를 묶어 본 관찰이며 당사자가 직접 한 말은 아닙니다." /><WireBullets items={[observation]} /><EvidenceDisclosure index={0} onSource={showSource} /><EvidenceDisclosure index={2} onSource={showSource} /></WireCardSection>
        </>}
        {available && variant === 'B' && <>
          <WireCardSection title="내용과 근거 함께 읽기"><div className={styles.items}>{evidence.map((item, index) => <div className={styles.evidenceRow} key={item.title}>
            <div><WireItem title={item.title} description="공식 기록에 명시된 내용" /><WireBullets items={[item.text]} /></div>
            <div><WireQuote>{item.quote}</WireQuote><p className="panel-meta">{item.date} {item.session}</p><WireButton variant="neutral" onClick={() => showSource(index)}>가상 회차 원문 보기</WireButton></div>
          </div>)}</div></WireCardSection>
          <WireCardSection title="여러 회차를 묶어 본 기억 관찰" tone="lavender"><div className={styles.evidenceRow}><div><WireBullets items={[observation]} /><p className="panel-meta">직접 진술과 구별해서 읽어 주세요.</p></div><div><EvidenceDisclosure index={0} onSource={showSource} /><EvidenceDisclosure index={2} onSource={showSource} /></div></div></WireCardSection>
        </>}
        {available && variant === 'C' && <>
          {evidence.map((item, index) => <WireCardSection key={item.title} title={item.title} tone="mint"><WireBullets items={[item.text]} /><EvidenceDisclosure index={index} onSource={showSource} /></WireCardSection>)}
          <WireCardSection title="기억 관찰" tone="lavender"><WireBullets items={[observation]} /><p className="panel-meta">직접 진술이 아닌 회차 간 관찰입니다.</p><EvidenceDisclosure index={0} onSource={showSource} /><EvidenceDisclosure index={2} onSource={showSource} /></WireCardSection>
        </>}
      </WireCard>
      {available && correctionOpen && <WireCard title="기억 정정">
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); setResult(`시안에서만 변경했습니다. ‘${correctionTarget}’의 정정 내용을 확인했습니다. 공식 기록과 실제 기억은 바뀌지 않습니다.`); }}>
          <p className="panel-meta">기억에 잘못 묶인 내용을 적습니다. 회차 원문은 변경하지 않습니다.</p>
          <WireFormField label="정정할 기억" control="select" htmlFor="prototype-target"><select id="prototype-target" value={correctionTarget} onChange={(event) => { setCorrectionTarget(event.target.value); setResult(''); }}>{Object.keys(correctionDrafts).map((title) => <option key={title}>{title}</option>)}</select></WireFormField>
          <WireFormField label="바로잡을 내용" control="textarea" htmlFor="prototype-correction"><textarea ref={correctionInput} id="prototype-correction" rows={4} value={correction} onChange={(event) => setCorrectionDrafts((drafts) => ({ ...drafts, [correctionTarget]: event.target.value }))} required /></WireFormField>
          <div className={styles.controls}><WireButton variant="neutral" onClick={() => { setCorrectionOpen(false); correctionTrigger.current?.focus(); }}>닫기</WireButton><WireButton type="submit" variant="primary" icon={<Icon name="check" />}>시안에서 확인</WireButton></div>
        </form>
      </WireCard>}
      {available && <WireCardDetails title="과거 기억" badge={<WireBadge tone="neutral">이전 버전</WireBadge>}><WireCardSection title="2026-08-24 반영"><WireBullets items={['이사 후 달라진 고정 지출을 항목별로 정리하기 시작했습니다.']} /><EvidenceDisclosure index={0} onSource={showSource} /></WireCardSection></WireCardDetails>}
    </>}

    {view === 'settings' && <WireCard title="자동 기억 작동 범위">
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); setResult(`시안에서만 변경했습니다. 가상 기관 전체의 자동 기억을 ${enabled ? '켜는' : '끄는'} 선택을 확인했습니다. 실제 기관 설정은 바뀌지 않습니다.`); }}>
        <WireCardSection title="가상 기관의 자동 기억"><WireBullets items={['켜면 기존 공식 기록도 정리하며 처리 시간과 AI 비용이 발생할 수 있습니다.', '끄면 새 생성과 갱신만 멈춥니다. 기존 기억은 마지막 반영 시점을 표시해 읽을 수 있습니다.', 'AI 연결이나 당사자의 동의를 대신 켜지 않습니다. 기억은 지원 판단이나 진단을 하지 않습니다.']} /></WireCardSection>
        <WireCardSection title="자동 기억 사용" tone="mint"><WireChoice type="checkbox" label="공식 기록을 바탕으로 자동 기억 만들기" checked={enabled} onChange={setEnabled} desc="이 선택은 작동 범위 시안입니다. 실제 AI 활성화나 외부 전송을 하지 않습니다." /></WireCardSection>
        <WireCardSection title="현재 선택"><WireBullets items={[`가상 기관 전체 / 자동 기억 ${enabled ? '사용' : '중지'}`]} /><p className="panel-meta">기관 단위 설정입니다. 사업별 도입 확인, 동의와 처리 경로는 바뀌지 않습니다.</p></WireCardSection>
        <div className={styles.controls}><WireButton type="submit" variant="primary" icon={<Icon name="check" />}>시안에서 확인</WireButton></div>
      </form>
    </WireCard>}

    {source !== null && view !== 'settings' && (view === 'briefing' || available) && <div ref={sourcePanel} tabIndex={-1} className={styles.source}>
      <WireCard title="가상 상담 기록 원문"><WireCardSection title={`${evidence[source]!.date} ${evidence[source]!.session}`} action={<WireButton variant="neutral" onClick={() => setSource(null)}>원문 닫기</WireButton>}>
        <WireItem title="수기 기록" description="시안용으로 작성한 가상 원문입니다. 실제 당사자 기록이 아닙니다." /><WireBullets items={[evidence[source]!.note]} />
      </WireCardSection><WireCardSection title="가상 발언 인용"><WireQuote>{evidence[source]!.quote}</WireQuote></WireCardSection></WireCard>
    </div>}
    {result && <WireCallout title="시안 확인 결과" role="status">{result}</WireCallout>}
    <nav className={styles.switcher} aria-label="시안 비교">
      <WireButton variant="neutral" ariaLabel="이전 시안" onClick={() => cycle(-1)}><Chevron dir="left" /></WireButton>
      <div className={styles.switcherLabel}><span className={styles.variantTitle}>{variant}안: {variantNames[variant]}</span><span className="panel-meta">{viewNames[view]} / {stateNames[state]}</span></div>
      <WireButton variant="neutral" ariaLabel="다음 시안" onClick={() => cycle(1)}><Chevron dir="right" /></WireButton>
    </nav>
  </div></div>;
}
