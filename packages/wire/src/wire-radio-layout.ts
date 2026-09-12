/** Attach to a .wire-choice-group whose direct children are WireChoice radios.
 * Shared by React and detached HTML previews; never replaces control nodes.
 */
export function observeRadioLayout(group: HTMLElement): () => void {
  const mobile = window.matchMedia('(max-width: 767px)');
  let frame = 0;
  let disposed = false;
  let previousWidth = -1;
  group.setAttribute('data-radio-layout', '');
  let choices: HTMLElement[] = [];
  let breaks: HTMLElement[] = [];

  function clear() {
    for (const marker of breaks) marker.remove();
    breaks = [];
    group.removeAttribute('data-radio-balanced');
  }

  function layout() {
    frame = 0;
    clear();
    choices = Array.from(group.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    if (!mobile.matches || choices.length === 0 || choices.some(
      (choice) => !choice.matches('.wire-choice') || !choice.querySelector(':scope > input[type="radio"]'),
    )) return;

    const style = getComputedStyle(group);
    const width = group.getBoundingClientRect().width
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    if (width <= 0) return;
    const gap = parseFloat(style.columnGap) || 0;
    group.setAttribute('data-radio-measuring', '');
    const visible = choices.filter((choice) => choice.getClientRects().length > 0);
    const widths = visible.map((choice) => choice.getBoundingClientRect().width);
    group.removeAttribute('data-radio-measuring');
    if (widths.length === 0) return;

    // Count natural rows first, then distribute counts evenly with larger rows first.
    let rows = 1;
    let used = 0;
    for (const naturalWidth of widths) {
      const itemWidth = Math.min(naturalWidth, width);
      if (used > 0 && used + gap + itemWidth > width) {
        rows += 1;
        used = itemWidth;
      } else {
        used += (used > 0 ? gap : 0) + itemWidth;
      }
    }
    if (rows === 1) return;
    // Balance counts without stretching labels. If a balanced partition cannot fit
    // its natural-width choices, use another row instead of forcing a wider item.
    while (rows < visible.length) {
      let offset = 0;
      let fits = true;
      for (let row = 0; row < rows; row += 1) {
        const count = Math.floor(visible.length / rows) + (row < visible.length % rows ? 1 : 0);
        let rowWidth = gap * (count - 1);
        for (let column = 0; column < count; column += 1) {
          rowWidth += Math.min(widths[offset++]!, width);
        }
        if (rowWidth > width) fits = false;
      }
      if (fits) break;
      rows += 1;
    }
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      if (row > 0) {
        const marker = document.createElement('span');
        marker.setAttribute('data-radio-break', '');
        marker.setAttribute('aria-hidden', 'true');
        group.insertBefore(marker, visible[index]!);
        breaks.push(marker);
      }
      index += Math.floor(visible.length / rows) + (row < visible.length % rows ? 1 : 0);
    }
    group.setAttribute('data-radio-balanced', '');
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(layout);
  }

  const resize = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width !== previousWidth) {
      previousWidth = entry.contentRect.width;
      schedule();
    }
  });
  resize.observe(group);
  const mutations = new MutationObserver((records) => {
    const changed = records.some((record) => record.type !== 'childList'
      || [...record.addedNodes, ...record.removedNodes].some(
        (node) => !(node instanceof HTMLElement && node.hasAttribute('data-radio-break')),
      ));
    if (changed) schedule();
  });
  mutations.observe(group, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'type', 'dir', 'lang'],
  });
  mobile.addEventListener('change', schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  void document.fonts.ready.then(schedule);
  layout();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    group.removeAttribute('data-radio-layout');
    resize.disconnect();
    mutations.disconnect();
    mobile.removeEventListener('change', schedule);
    document.fonts.removeEventListener('loadingdone', schedule);
    clear();
  };
}
