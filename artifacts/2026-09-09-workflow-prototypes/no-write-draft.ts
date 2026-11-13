// Prototype-only adapter: RecordOnepage keeps its production UI while no Storage API is read, written or swept.
export function useDomDraft() {
  return {
    containerRef: (_node: HTMLElement | null) => {},
    restorable: null,
    savedAt: null,
    available: true,
    resume: () => {},
    discard: () => {},
  };
}
