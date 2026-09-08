'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaseMemoryView, MemoryItem } from '@ccc/contracts/counseling-memory';
import { WireCard } from '../../../../../components/wire/wire-card';
import { WireFormField } from '../../../../../components/wire/wire-form-field';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireError } from '../../../../../components/wire/wire-state';
import { Icon } from '../../../../../components/wire/wire-icon';
import { MemoryItemView, type MemoryCorrect } from './memory-view';
import type { MemoryMutationResult } from './memory-view';

export function MemoryCorrection({ items, onCorrect, onRefresh, onSaved, onCancel, recordsHref, goalsHref, actionsHref }: {
  items: MemoryItem[]; onCorrect: MemoryCorrect; onRefresh: () => Promise<MemoryMutationResult<CaseMemoryView>>; onSaved: (view: CaseMemoryView) => void; onCancel: () => void;
  recordsHref: string; goalsHref: string; actionsHref: string;
}) {
  const [selected, setSelected] = useState(items[0]);
  const [body, setBody] = useState(items[0]?.body ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => { select.current?.focus(); }, []);
  return <WireCard title="기억 정정">
    <form className="memory-form" onSubmit={async (event) => {
      event.preventDefault();
      if (pending || !selected || body.trim().length === 0) return;
      setPending(true); setError(null); setMessage(null);
      try {
        const result = await onCorrect({ itemId: selected.id, expectedRevision: selected.revision, body });
        if (result.ok) onSaved(result.data);
        else setError(result.error === 'conflict' ? '다른 곳에서 기억이 바뀌었습니다. 입력은 그대로 두었습니다. 최신 기억을 확인한 뒤 다시 정정해 주세요.' : '정정을 저장하지 못했습니다. 입력은 그대로 두었습니다. 접근 권한과 연결 상태를 확인해 주세요.');
      } catch { setError('정정을 저장하지 못했습니다. 입력은 그대로 두었습니다. 잠시 후 다시 시도해 주세요.'); }
      finally { setPending(false); }
    }}>
      <WireFormField label="바로잡을 기억" control="select" htmlFor="memory-correction-item">
        <select ref={select} id="memory-correction-item" value={selected?.id ?? ''} disabled={pending} onChange={(event) => {
          const next = items.find((item) => item.id === event.target.value);
          setSelected(next); setBody(next?.body ?? ''); setError(null); setMessage(null);
        }}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      </WireFormField>
      {selected && <MemoryItemView item={selected} recordsHref={recordsHref} goalsHref={goalsHref} actionsHref={actionsHref} />}
      <WireFormField label="바로잡을 내용" control="textarea" htmlFor="memory-correction-body" required hint="기억을 정정해도 원본 상담 기록은 바뀌지 않습니다.">
        <textarea id="memory-correction-body" required value={body} disabled={pending} onChange={(event) => setBody(event.target.value)} />
      </WireFormField>
      {error !== null && <WireError>{error}</WireError>}
      {message !== null && <p role="status" className="panel-meta">{message}</p>}
      {error !== null && <WireButton variant="neutral" disabled={pending} onClick={async () => {
        setPending(true);
        try {
          const result = await onRefresh();
          if (!result.ok || !result.data.canCorrect) { setError('최신 기억을 확인할 수 없습니다. 입력은 그대로 두었습니다.'); return; }
          const latest = result.data.items.find((item) => item.id === selected?.id);
          if (!latest) { setError('이 항목은 더 이상 정정할 수 없습니다. 입력은 그대로 두었습니다.'); return; }
          setSelected(latest);
          setError(null);
          setMessage('현재 내용과 근거를 최신 상태로 불러왔습니다. 작성한 정정 내용은 그대로입니다. 비교한 뒤 정정 저장을 눌러 주세요.');
        } catch { setError('최신 기억을 불러오지 못했습니다. 입력은 그대로 두었습니다.'); }
        finally { setPending(false); }
      }}>입력을 유지하고 최신 기억 확인</WireButton>}
      <div className="memory-reference-actions"><WireButton type="submit" variant="primary" icon={<Icon name="check" />} disabled={pending || body.trim().length === 0}>{pending ? '저장 중' : '정정 저장'}</WireButton><WireButton variant="neutral" disabled={pending} onClick={onCancel}>취소</WireButton></div>
    </form>
  </WireCard>;
}
