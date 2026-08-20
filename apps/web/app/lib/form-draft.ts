'use client';

// 로컬 임시본(CCC-12). 작성 중 기록이 브라우저 종료·정전으로 사라지는 것을 막는다.
//
// 보관 규율 — 이 파일이 담는 값은 상담 내용 본문이다. 무기한 두지 않는다.
//  1. 만료: 저장 시각부터 DRAFT_TTL_MS 가 지나면 읽는 순간 지운다.
//  2. 서버 저장에 성공하면 즉시 지운다(phase 참조).
//  3. 금고(pii_vault)에서 내려온 표시값은 임시본에 넣지 않는다 — 넣고 거르는 게 아니라
//     처음부터 수집 대상에서 뺀다. 호출부가 그 필드를 values 에 담지 않는 것으로 지킨다.
//  4. 민감 서술 필드(상담 메모 전문·안전 관련 메모·실무자 의견)는 처음부터 임시본에 넣지
//     않는다(P0-9 · CCC-111) — localStorage 사본은 서버의 권한·감사·파기 통제를 우회한다.
//     해당 입력칸이 data-draft="skip" 을 달아 수집 단계(collectFieldValues)에서 뺀다.
//  5. 제출 성공(records 목록의 RecordDraftCleanup)·로그아웃(clearAllDrafts) 때도 지운다.
// 화면 문구도 이 규율과 같은 말을 해야 한다(record-onepage 의 메모 도움말).

export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export type DraftPhase = 'editing' | 'submitting';

export interface StoredDraft<T> {
  values: T;
  savedAt: number;
  phase: DraftPhase;
}

/** 임시본 1건의 저장 키. 인테이크·기록지는 참여 사업 1건당, 세션 목표는 일정 1건당 1개다. */
export function draftKey(kind: 'intake' | 'record' | 'session-plan', scopeId: string): string {
  return `${KEY_PREFIX}${kind}:${scopeId}`;
}

/**
 * localStorage 는 접근 자체가 던질 수 있다(사파리 시크릿 모드·샌드박스 iframe·용량 초과).
 * 임시본은 편의 기능이라 실패하면 조용히 없는 것으로 취급한다 — 기록 작성을 막지 않는다.
 */
function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPhase(value: unknown): value is DraftPhase {
  return value === 'editing' || value === 'submitting';
}

/** 만료됐거나 형식이 깨진 임시본은 읽는 김에 지우고 없는 것으로 답한다. */
export function readDraft<T>(key: string, now: number = Date.now()): StoredDraft<T> | null {
  const store = storage();
  if (store === null) return null;

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft(key);
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    clearDraft(key);
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const savedAt = record.savedAt;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || !isPhase(record.phase) || !('values' in record)) {
    clearDraft(key);
    return null;
  }
  if (now - savedAt >= DRAFT_TTL_MS) {
    clearDraft(key);
    return null;
  }

  return { values: record.values as T, savedAt, phase: record.phase };
}

/** 저장에 성공하면 저장 시각을, 실패하면 null 을 준다(화면의 자동 저장 표시가 이 값을 쓴다). */
export function writeDraft<T>(key: string, values: T, phase: DraftPhase, now: number = Date.now()): number | null {
  const store = storage();
  if (store === null) return null;
  try {
    store.setItem(key, JSON.stringify({ values, savedAt: now, phase } satisfies StoredDraft<T>));
    return now;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(key);
  } catch {
    // 지우지 못해도 만료가 뒤를 받는다.
  }
}

/** 남은 보관 시간을 사람이 읽는 말로. 문구가 규율(§만료)과 어긋나지 않게 여기서만 만든다. */
export function draftRetentionLabel(): string {
  return `${DRAFT_TTL_MS / (60 * 60 * 1000)}시간`;
}

// v2 (CCC-111): v1 임시본은 상담 메모 전문·안전 관련 메모·실무자 의견까지 담았다.
// v2 부터 그 필드는 수집 대상이 아니므로(보관 규율 4), 구 형식은 민감 사본으로 보고
// 만료를 기다리지 않고 훑을 때(sweepExpiredDrafts) 즉시 지운다.
const KEY_PREFIX = 'ccc:draft:v2:';
const LEGACY_KEY_PREFIXES = ['ccc:draft:v1:'];

function isLegacyKey(key: string): boolean {
  return LEGACY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 만료를 읽는 순간에만 적용하면, 다시 열지 않은 임시본은 기기에 그대로 남는다 — 화면 문구가
 * "12시간 임시 보관"이라고 말하는데 실제로는 "12시간 뒤부터 무시"인 셈이다. 그래서 기록 화면을
 * 열 때마다 이 브라우저의 임시본 전체를 훑어 만료된 것을 지운다(다른 참여 사업 것도 함께).
 */
export function sweepExpiredDrafts(now: number = Date.now()): void {
  const store = storage();
  if (store === null) return;
  let keys: string[];
  try {
    keys = Object.keys(store).filter((key) => key.startsWith(KEY_PREFIX) || isLegacyKey(key));
  } catch {
    return;
  }
  for (const key of keys) {
    // 구 형식(v1)은 민감 필드가 담긴 사본이라 만료 판정 없이 한 번에 지운다(P0-9 버전 처리).
    if (isLegacyKey(key)) {
      clearDraft(key);
      continue;
    }
    // readDraft 가 만료분을 지운다 — 판정 규칙을 한 곳에만 둔다.
    readDraft(key, now);
  }
}

/**
 * 이 브라우저의 임시본 전부(구 형식 포함)를 지운다. 로그아웃 폼(app-header·app-sidebar)이
 * 제출 직전에 부른다 — 로그아웃 자체는 서버 액션(logout-action.ts)이라 localStorage 를
 * 만질 수 없고, 공용 기기에서 작성 중 내용이 다음 사용자에게 남으면 안 된다(P0-9).
 */
export function clearAllDrafts(): void {
  const store = storage();
  if (store === null) return;
  let keys: string[];
  try {
    keys = Object.keys(store).filter((key) => key.startsWith(KEY_PREFIX) || isLegacyKey(key));
  } catch {
    return;
  }
  for (const key of keys) clearDraft(key);
}

// ── 이름 있는 입력칸을 그대로 담고 되돌리기(정기 기록지처럼 폼이 비제어일 때) ──────────

export type FieldValues = Record<string, string | boolean>;

function fieldElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('input[name], textarea[name], select[name]'));
}

/**
 * 같은 name 이 여러 개인 칸이 있다(gasScore 셀렉트, flagType 체크박스). 그래서 키를 이렇게 나눈다.
 *  - 체크박스·라디오: `name::value` — 순서가 아니라 값으로 짚으므로 목록이 바뀌어도 안 밀린다.
 *  - 나머지: `name#등장순서` — 되돌릴 때 셀렉트는 그 값이 실제 옵션에 있는지 확인하고 넣는다.
 */
function fieldKey(element: HTMLElement, ordinal: number): string | null {
  const name = element.getAttribute('name');
  if (name === null || name.length === 0) return null;
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return `${name}::${element.value}`;
  }
  return `${name}#${ordinal}`;
}

function skipped(element: HTMLElement): boolean {
  if (element.dataset.draft === 'skip') return true;
  if (element instanceof HTMLInputElement) {
    return element.type === 'hidden' || element.type === 'file' || element.type === 'password';
  }
  return false;
}

function walk(root: HTMLElement, visit: (element: HTMLElement, key: string) => void): void {
  const ordinals = new Map<string, number>();
  for (const element of fieldElements(root)) {
    if (skipped(element)) continue;
    const name = element.getAttribute('name') ?? '';
    const ordinal = ordinals.get(name) ?? 0;
    ordinals.set(name, ordinal + 1);
    const key = fieldKey(element, ordinal);
    if (key !== null) visit(element, key);
  }
}

/** 비어 있는 칸은 담지 않는다 — 임시본을 작게 두고 "아무것도 안 썼는데 배너가 뜨는" 것을 막는다. */
export function collectFieldValues(root: HTMLElement): FieldValues {
  const values: FieldValues = {};
  walk(root, (element, key) => {
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      if (element.checked) values[key] = true;
      return;
    }
    const value = (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    if (value.length > 0) values[key] = value;
  });
  return values;
}

/**
 * 리액트는 각 DOM 노드의 직전 값을 따로 기억해 두고, 값이 그대로면 onChange 를 건너뛴다.
 * `element.value = x` 로 바로 넣으면 그 기억이 갱신돼 버려서 이어지는 이벤트가 무시된다 —
 * 화면은 되돌아왔는데 필수 채움 카운트나 '위기' 자동 펼침 같은 파생 상태만 안 따라오는,
 * 테스트로는 잘 안 잡히는 어긋남이 여기서 난다. 그래서 프로토타입의 원래 setter 로 넣는다.
 */
function nativeSet(element: HTMLElement, property: 'value' | 'checked', value: string | boolean): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
  if (setter === undefined) {
    (element as unknown as Record<string, unknown>)[property] = value;
    return;
  }
  setter.call(element, value);
}

export function applyFieldValues(root: HTMLElement, values: FieldValues): void {
  walk(root, (element, key) => {
    const stored = values[key];
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      const next = stored === true;
      if (element.checked === next) return;
      nativeSet(element, 'checked', next);
      element.dispatchEvent(new Event('click', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (typeof stored !== 'string') return;
    // 셀렉트는 저장 이후 목록이 바뀌었을 수 있다. 없는 값을 넣으면 조용히 빈 값이 되거나
    // 엉뚱한 목표에 GAS 점수가 붙으므로, 실재하는 옵션일 때만 되돌린다(D6).
    if (element instanceof HTMLSelectElement) {
      if (!Array.from(element.options).some((option) => option.value === stored)) return;
      nativeSet(element, 'value', stored);
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    nativeSet(element, 'value', stored);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
