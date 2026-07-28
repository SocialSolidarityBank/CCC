'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyFieldValues,
  clearDraft,
  collectFieldValues,
  readDraft,
  sweepExpiredDrafts,
  writeDraft,
  type FieldValues,
} from './form-draft';

// 정기 기록지처럼 폼이 비제어(입력값을 리액트 상태로 들지 않음)일 때 쓰는 임시본 훅.
// 인테이크 위저드는 상태가 곧 값이라 이 훅을 쓰지 않는다.

const SAVE_DEBOUNCE_MS = 800;

export interface DomDraft {
  /** 이 노드 안의 name 있는 입력칸이 자동 저장 대상이다. */
  containerRef: (node: HTMLElement | null) => void;
  /** 되돌릴 임시본. 실무자가 고르기 전에는 아무것도 덮어쓰지 않는다. */
  restorable: { savedAt: number; uncertain: boolean } | null;
  savedAt: number | null;
  available: boolean;
  resume: () => void;
  discard: () => void;
}

/**
 * 서버 저장 성공을 클라이언트가 직접 알 수 없는 화면이다 — 저장은 서버 액션이고 성공하면
 * 기록 목록으로 리다이렉트, 실패하면 이 화면으로 되돌아온다. 그래서 제출 순간 임시본에
 * 'submitting' 을 찍어 두고 다음 마운트에서 읽는다.
 *
 * `red` **'submitting' 을 성공으로 단정해 지우면 안 된다.** service_unavailable ·
 * unknown_outcome · conflict 세 경우에는 상위 화면이 폼 대신 안내 패널을 렌더하므로 이
 * 컴포넌트가 아예 마운트되지 않는다(records/new/page.tsx 의 mustCheckOutcome ·
 * mustStartFresh). 실무자가 "저장됐나?" 확인하러 갔다가 새 기록 작성으로 돌아오면 오류 표시
 * 없는 깨끗한 방문이 되는데, 그때 지우면 **저장도 안 된 상담 내용이 조용히 사라진다.**
 * 그래서 판정을 이렇게 나눈다.
 *  - 오류를 달고 되돌아왔다 → 실패가 확실하다. 이어쓰기를 권한다.
 *  - 오류 없이 새로 열렸다 → 저장됐을 가능성이 높지만 확실하지 않다. 지우지 말고 물어본다
 *    (uncertain). 실무자가 '새로 시작'을 고르면 그때 지운다.
 * 지우는 판단을 사람에게 넘기는 대신, 저장된 내용이 다음 회차에 섞이는 것은 배너가 막는다.
 */
export function useDomDraft({
  storageKey,
  submissionFailed,
}: {
  storageKey: string;
  submissionFailed: boolean;
}): DomDraft {
  const rootRef = useRef<HTMLElement | null>(null);
  const valuesRef = useRef<FieldValues>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<FieldValues | null>(null);

  const [restorable, setRestorableState] = useState<{ savedAt: number; uncertain: boolean } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);

  // 디바운스 콜백은 오래된 클로저를 붙들 수 있어 상태가 아니라 ref 를 본다. 둘을 같은
  // 함수에서만 바꿔 어긋나지 않게 한다.
  const restorableRef = useRef(false);
  const setRestorable = useCallback((next: { savedAt: number; uncertain: boolean } | null) => {
    restorableRef.current = next !== null;
    setRestorableState(next);
  }, []);

  const save = useCallback((values: FieldValues, phase: 'editing' | 'submitting') => {
    const written = writeDraft(storageKey, values, phase);
    if (written === null) {
      setAvailable(false);
      return;
    }
    setSavedAt(written);
  }, [storageKey]);

  // ① 마운트 — 만료분을 걷고 임시본을 판정한다. 되돌리기는 실무자가 고를 때만 한다.
  useEffect(() => {
    sweepExpiredDrafts();
    const stored = readDraft<FieldValues>(storageKey);
    if (stored === null) return;
    pendingRef.current = stored.values;
    setRestorable({ savedAt: stored.savedAt, uncertain: stored.phase === 'submitting' && !submissionFailed });
  }, [storageKey, submissionFailed]);

  // ② 입력할 때마다 자동 저장(디바운스). 빈 폼은 저장하지 않는다.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    function schedule() {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        // 배너가 떠 있는 동안에는 저장하지 않는다. 실무자가 배너를 무시하고 새로 타이핑하면
        // 되돌릴 수 있던 내용이 거의 빈 현재 폼으로 덮어써지고, 새로고침하면 사라진다.
        // 이어쓰기·새로 시작 중 하나를 고른 뒤부터 저장을 재개한다(인테이크 위저드와 같은 규칙).
        if (restorableRef.current) return;
        const node = rootRef.current;
        if (node === null) return;
        const values = collectFieldValues(node);
        valuesRef.current = values;
        if (Object.keys(values).length === 0) return;
        save(values, 'editing');
      }, SAVE_DEBOUNCE_MS);
    }

    root.addEventListener('input', schedule);
    root.addEventListener('change', schedule);

    // 제출 순간에 'submitting' 을 찍는다. 폼은 상위 서버 컴포넌트에 있으므로 거슬러 찾는다.
    const form = root.closest('form');
    function markSubmitting() {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      // 배너가 떠 있는 동안에는 저장소를 건드리지 않는다(위 schedule 과 같은 이유).
      // 고르지 않고 제출했다면 되돌릴 임시본을 남겨 두고 다음에 다시 묻는 쪽이 안전하다.
      if (restorableRef.current) return;
      const node = rootRef.current;
      const values = node === null ? valuesRef.current : collectFieldValues(node);
      if (Object.keys(values).length === 0) return;
      save(values, 'submitting');
    }
    form?.addEventListener('submit', markSubmitting);

    return () => {
      root.removeEventListener('input', schedule);
      root.removeEventListener('change', schedule);
      form?.removeEventListener('submit', markSubmitting);
      // 언마운트에서 남은 디바운스를 흘려보내지 않는다 — 저장 성공 뒤에 임시본이 되살아난다.
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [save]);

  const containerRef = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
  }, []);

  const resume = useCallback(() => {
    const node = rootRef.current;
    const values = pendingRef.current;
    if (node !== null && values !== null) applyFieldValues(node, values);
    pendingRef.current = null;
    setRestorable(null);
  }, []);

  const discard = useCallback(() => {
    clearDraft(storageKey);
    pendingRef.current = null;
    valuesRef.current = {};
    setRestorable(null);
    setSavedAt(null);
  }, [storageKey]);

  return { containerRef, restorable, savedAt, available, resume, discard };
}
