import type { BusinessError } from './errors';

export interface EditorState<Value, Draft> {
  value: Value | null;
  draft: Draft | null;
  busy: boolean;
  needsRefresh: boolean;
  error: BusinessError | null;
  saved: boolean;
}
export type EditorAction<Value, Draft> =
  | { type: 'loaded' | 'saved'; value: Value; draft: Draft }
  | { type: 'edit'; draft: Draft }
  | { type: 'loading' | 'saving' }
  | { type: 'failed'; error: BusinessError; write: boolean };

export function initialEditor<Value, Draft>(): EditorState<Value, Draft> {
  return { value: null, draft: null, busy: true, needsRefresh: false, error: null, saved: false };
}

/** 재조회는 CAS 기준만 바꾼다. 사용자가 쓴 초안은 저장 성공 때만 서버 값으로 바꾼다. */
export function reduceEditor<Value, Draft>(state: EditorState<Value, Draft>, action: EditorAction<Value, Draft>): EditorState<Value, Draft> {
  switch (action.type) {
    case 'loaded':
      return { ...state, value: action.value, draft: state.draft ?? action.draft,
        busy: false, needsRefresh: false, error: null, saved: false };
    case 'saved':
      return { value: action.value, draft: action.draft, busy: false, needsRefresh: false, error: null, saved: true };
    case 'edit':
      return { ...state, draft: action.draft, saved: false };
    case 'loading':
    case 'saving':
      return { ...state, busy: true, error: null, saved: false };
    case 'failed':
      return { ...state, busy: false, needsRefresh: state.needsRefresh || action.write,
        error: action.error, saved: false };
  }
}
