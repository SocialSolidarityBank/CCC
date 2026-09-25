const NOOP = () => {};

function canAdapt(api) {
  return Boolean(api && api.mobile === true);
}

function textOf(element) {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function lockOpen(details) {
  const summary = details.querySelector(':scope > summary');
  if (!summary) return NOOP;

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    details.open = true;
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      details.open = true;
    }
  };
  const onToggle = () => {
    if (!details.open) details.open = true;
  };

  details.open = true;
  details.dataset.protoAlwaysOpen = 'true';
  summary.setAttribute('aria-disabled', 'true');
  summary.setAttribute('aria-expanded', 'true');
  summary.addEventListener('click', onClick);
  summary.addEventListener('keydown', onKeyDown);
  details.addEventListener('toggle', onToggle);

  return () => {
    summary.removeEventListener('click', onClick);
    summary.removeEventListener('keydown', onKeyDown);
    details.removeEventListener('toggle', onToggle);
    summary.removeAttribute('aria-disabled');
    summary.removeAttribute('aria-expanded');
    delete details.dataset.protoAlwaysOpen;
  };
}

/**
 * Mobile briefing reading surface. The core and discrepancy/risk sections stay
 * readable in the page; only optional empty sections may start collapsed.
 */
export function initBriefing(root, api) {
  if (!root || !canAdapt(api)) return NOOP;

  const cleanups = [];
  const alwaysVisible = [
    root.querySelector('#briefing-remember'),
    root.querySelector('#briefing-discrepancies'),
    root.querySelector('details.is-crisis'),
    root.querySelector('details[data-prototype-risk]'),
  ].filter(Boolean);

  for (const details of new Set(alwaysVisible)) {
    cleanups.push(lockOpen(details));
  }

  // The seed has no unresolved actions. Keep its honest empty label available,
  // but do not spend a tall open card on it. Populated action rows stay open.
  const emptyDetails = [];
  for (const details of root.querySelectorAll('details.briefing-card')) {
    if (alwaysVisible.includes(details)) continue;
    const hasEmptyState = Boolean(details.querySelector(':scope > .wire-card-body .empty[role="status"]'));
    const hasAction = Boolean(details.querySelector(':scope > .wire-card-body a, :scope > .wire-card-body button, :scope > .wire-card-body form'));
    if (hasEmptyState && !hasAction) {
      emptyDetails.push([details, details.open]);
      details.open = false;
      details.dataset.protoEmpty = 'true';
    }
  }

  for (const row of root.querySelectorAll('.briefing-session-row')) {
    row.dataset.protoReadingRow = 'true';
    // The anchor already owns the source link. This label makes the compact
    // two-line row meaningful when its visual text is clipped.
    if (!row.getAttribute('aria-label')) row.setAttribute('aria-label', textOf(row));
  }

  const cleanup = () => {
    for (const cleanupFn of cleanups) cleanupFn();
    for (const [details, wasOpen] of emptyDetails) {
      details.open = wasOpen;
      delete details.dataset.protoEmpty;
    }
    for (const row of root.querySelectorAll('.briefing-session-row[data-proto-reading-row]')) {
      delete row.dataset.protoReadingRow;
      if (row.getAttribute('aria-label') === textOf(row)) row.removeAttribute('aria-label');
    }
  };

  return cleanup;
}

function recordTitle(details) {
  const ordinal = textOf(details.querySelector(':scope > summary .record-ordinal'));
  const date = textOf(details.querySelector(':scope > summary .record-held-at'));
  return [ordinal, date].filter(Boolean).join(' · ') || '상담 기록';
}

function findRecord(root, id) {
  const normalized = String(id || '').replace(/^#/, '');
  if (!normalized) return null;
  return [...root.querySelectorAll('details[id^="record-"]')].find((details) => details.id === normalized) || null;
}

/**
 * Mobile record list/detail transition. Native details remain the semantic
 * record container, but their bodies are moved into the shared full pane so
 * the list never becomes a stack of nested accordions.
 */
export function initRecords(root, api) {
  if (!root || !canAdapt(api)) return NOOP;

  const records = [...root.querySelectorAll('details[id^="record-"]')];
  const cleanups = [];
  let activePanel = null;
  let activeDetails = null;
  let activeScrollY = 0;

  const openRecord = (id) => {
    const details = findRecord(root, id);
    if (!details || activePanel) return false;

    const summary = details.querySelector(':scope > summary');
    const body = details.querySelector(':scope > .record-body');
    const foot = details.querySelector(':scope > .record-foot');
    if (!summary || !body) return false;

    const chevron = summary.querySelector('.wire-disclosure-chevron .wire-chevron');
    if (chevron) chevron.dataset.dir = 'right';

    activeDetails = details;
    activeScrollY = window.scrollY;
    details.open = false;
    const content = [body, foot].filter(Boolean);
    const panel = api.openPanel({
      title: recordTitle(details),
      content,
      kind: 'full',
      trigger: summary,
      onClose: () => {
        details.open = false;
        activeDetails = null;
        activePanel = null;
        api.updateState?.('상담 기록 목록');
        window.scrollTo({ top: activeScrollY, behavior: 'auto' });
      },
    });

    activePanel = panel || null;
    api.updateState?.(`${recordTitle(details)} 전체 보기`);
    return Boolean(panel);
  };

  for (const details of records) {
    const summary = details.querySelector(':scope > summary');
    if (!summary) continue;

    const originalOpen = details.open;
    details.open = false;
    details.dataset.protoRecord = 'true';
    summary.dataset.protoRecordSummary = 'true';
    summary.setAttribute('aria-label', `${recordTitle(details)} 전체 보기`);
    const chevron = summary.querySelector('.wire-disclosure-chevron .wire-chevron');
    if (chevron) chevron.dataset.dir = 'right';
    const metadata = document.createElement('span');
    metadata.className = 'proto-record-metadata';
    const kindBadge = summary.querySelector(':scope > .wire-badge');
    const memoBadge = summary.querySelector('.record-summary-right .wire-badge');
    const badgePositions = [];
    for (const badge of [kindBadge, memoBadge].filter(Boolean)) {
      const marker = document.createComment('prototype-badge-position');
      badge.before(marker);
      badgePositions.push(() => marker.replaceWith(badge));
      metadata.append(badge);
    }
    summary.append(metadata);
    cleanups.push(() => {
      badgePositions.forEach(restore => restore());
      metadata.remove();
    });

    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openRecord(details.id);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        summary.click();
      }
    };
    summary.addEventListener('click', onClick);
    summary.addEventListener('keydown', onKeyDown);
    cleanups.push(() => {
      summary.removeEventListener('click', onClick);
      summary.removeEventListener('keydown', onKeyDown);
      summary.removeAttribute('aria-label');
      delete summary.dataset.protoRecordSummary;
      delete details.dataset.protoRecord;
      details.open = originalOpen;
      if (chevron) chevron.dataset.dir = 'down';
    });
  }

  const onOpenRecordEvent = (event) => {
    if (event.detail) openRecord(event.detail);
  };
  root.addEventListener('prototype:open-record', onOpenRecordEvent);

  const cleanup = () => {
    if (activePanel?.close) activePanel.close();
    activePanel = null;
    activeDetails = null;
    root.removeEventListener('prototype:open-record', onOpenRecordEvent);
    for (const cleanupFn of cleanups) cleanupFn();
  };
  cleanup.openRecord = openRecord;
  return cleanup;
}
