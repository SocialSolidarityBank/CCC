import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAFT_TTL_MS,
  applyFieldValues,
  clearDraft,
  collectFieldValues,
  draftKey,
  readDraft,
  writeDraft,
} from './form-draft';

// 로컬 임시본 저장 계층(CCC-12). 보관 규율(만료·형식 방어)과 비제어 폼 수집·복원을 고정한다.

const KEY = draftKey('record', 'case-1');

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('임시본 보관 규율', () => {
  it('참여 사업·종류별로 키가 갈린다', () => {
    expect(draftKey('record', 'case-1')).not.toBe(draftKey('intake', 'case-1'));
    expect(draftKey('record', 'case-1')).not.toBe(draftKey('record', 'case-2'));
  });

  it('저장한 값을 그대로 돌려준다', () => {
    writeDraft(KEY, { memo: '오늘 상담' }, 'editing', 1_000);
    expect(readDraft<{ memo: string }>(KEY, 1_500)).toEqual({
      values: { memo: '오늘 상담' }, savedAt: 1_000, phase: 'editing',
    });
  });

  it('보관 기간이 지난 임시본은 읽는 순간 사라진다', () => {
    writeDraft(KEY, { memo: '오늘 상담' }, 'editing', 1_000);

    expect(readDraft(KEY, 1_000 + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(readDraft(KEY, 1_000 + DRAFT_TTL_MS)).toBeNull();
    // 만료 판정으로 끝내지 않고 실제로 지운다 — 상담 내용을 기기에 남겨 두지 않는다.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('형식이 깨진 값은 버린다', () => {
    window.localStorage.setItem(KEY, '{이건 JSON 이 아니다');
    expect(readDraft(KEY)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();

    window.localStorage.setItem(KEY, JSON.stringify({ values: {}, savedAt: 'x', phase: 'editing' }));
    expect(readDraft(KEY)).toBeNull();
  });

  it('지우면 없는 것이 된다', () => {
    writeDraft(KEY, { memo: 'x' }, 'editing');
    clearDraft(KEY);
    expect(readDraft(KEY)).toBeNull();
  });
});

describe('비제어 폼 수집·복원', () => {
  function mount(html: string): HTMLElement {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    return document.getElementById('root') as HTMLElement;
  }

  it('이름 있는 칸만 담고 빈 칸은 담지 않는다', () => {
    const root = mount(`
      <textarea name="memo">오늘 상담</textarea>
      <input name="heldAt" value="" />
      <input type="checkbox" />
    `);
    expect(collectFieldValues(root)).toEqual({ 'memo#0': '오늘 상담' });
  });

  it('숨은 칸과 제외 표시한 칸은 담지 않는다', () => {
    const root = mount(`
      <input type="hidden" name="submissionId" value="uuid" />
      <input name="birthDate" value="1990-01-01" data-draft="skip" />
      <input name="memo" value="본문" />
    `);
    expect(collectFieldValues(root)).toEqual({ 'memo#0': '본문' });
  });

  it('같은 name 의 체크박스는 값으로 구분한다', () => {
    const root = mount(`
      <input type="checkbox" name="flagType" value="crisis_utterance" checked />
      <input type="checkbox" name="flagType" value="debt_deterioration" />
    `);
    expect(collectFieldValues(root)).toEqual({ 'flagType::crisis_utterance': true });

    const target = mount(`
      <input type="checkbox" name="flagType" value="crisis_utterance" />
      <input type="checkbox" name="flagType" value="debt_deterioration" />
    `);
    applyFieldValues(target, { 'flagType::crisis_utterance': true });
    const boxes = target.querySelectorAll<HTMLInputElement>('input[name="flagType"]');
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
  });

  it('입력한 값을 그대로 되돌린다', () => {
    const target = mount('<textarea name="memo"></textarea><input name="heldAt" value="" />');
    applyFieldValues(target, { 'memo#0': '되돌린 본문', 'heldAt#0': '2026-07-20T13:00' });
    expect(target.querySelector<HTMLTextAreaElement>('textarea[name="memo"]')!.value).toBe('되돌린 본문');
    expect(target.querySelector<HTMLInputElement>('input[name="heldAt"]')!.value).toBe('2026-07-20T13:00');
  });

  it('셀렉트는 지금 실재하는 옵션일 때만 되돌린다', () => {
    // 임시본을 쓴 뒤 목표가 종료되면 그 GAS 옵션은 사라진다. 없는 값을 밀어 넣으면 점수가
    // 엉뚱한 목표에 붙거나 조용히 비므로 건너뛴다(D6 — 점수는 상담사 몫).
    const target = mount(`
      <select name="gasScore"><option value=""></option><option value="goal-2:1">goal-2</option></select>
    `);
    applyFieldValues(target, { 'gasScore#0': 'goal-1:2' });
    expect(target.querySelector<HTMLSelectElement>('select')!.value).toBe('');

    applyFieldValues(target, { 'gasScore#0': 'goal-2:1' });
    expect(target.querySelector<HTMLSelectElement>('select')!.value).toBe('goal-2:1');
  });
});
