/* Throwaway two-variant prototype. Captured CCC seed UI, original routes mapped locally, memory only. */
import { initWrite, initParticipant } from './forms.js?v=2';
import { initBriefing, initRecords } from './reading.js?v=2';

const root = document.querySelector('#prototype-screen');
const status = document.querySelector('#proto-status');
const sourceStyle = document.querySelector('#source-style');
const mobileQuery = matchMedia('(max-width:767px)');
const manifest = await fetch('./sources/manifest.json').then(r => r.json());
const scheduleRows = await fetch('./sources/schedules.json').then(r => r.json()).then(rows => rows.sort((a, b) => a.date.localeCompare(b.date)));
const labels = { write: '상담 기록하기', briefing: '15초 페이지', records: '상담 기록 확인하기', schedule: '일정', participant: '당사자 정보' };
const snapshots = new Map();
const values = new Map();
const savedValues = new Map();
const scrollPositions = new Map();
let currentScreen = '';
let variant = 'B';
let cleanup = null;
let activePanel = null;
let renderVersion = 0;
let sessionGoal = null;
let scheduleView = 'week';
let scheduleDate = '2026-09-07';

function chevron(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('wire-chevron');
  svg.dataset.dir = direction;
  const path = document.createElementNS(svg.namespaceURI, 'path');
  for (const [key, value] of Object.entries({ d: 'M3.3 4.65 6 7.35 8.7 4.65', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
  svg.append(path);
  return svg;
}
function button(label, { variant: tone = 'neutral', onClick } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wire-button';
  b.dataset.variant = tone;
  b.dataset.justify = 'center';
  const text = document.createElement('span');
  text.className = 'wire-button-text';
  text.textContent = label;
  b.append(text);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function updateState(message = '') {
  const memo = root.querySelector('#record-memo');
  status.textContent = message || (memo?.value ? `이 탭에서만 유지 · 메모 ${memo.value.length}자` : '비교 시안 · 실제 저장 안 됨');
  window.prototypeState = { screen: currentScreen, variant, mobile: mobileQuery.matches, scheduleView, scheduleDate, values: collectValues() };
}
function collectValues() {
  return Array.from(document.querySelectorAll('#prototype-screen [data-proto-key],.proto-panel [data-proto-key]')).map(e => ({ key: e.dataset.protoKey, type: e.type, value: e.value, checked: e.checked }));
}
function rememberValues() {
  if (!currentScreen) return;
  values.set(currentScreen, collectValues());
  scrollPositions.set(currentScreen, scrollY);
}
function restoreValues() {
  const entries = values.get(currentScreen);
  if (!entries) return;
  Array.from(root.querySelectorAll('[data-proto-key]')).forEach(el => {
    const entry = entries.find(v => v.key === el.dataset.protoKey);
    if (!entry) return;
    el.value = entry.value;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = entry.checked;
  });
}
function openPanel({ title, content, kind = 'sheet', trigger = document.activeElement, onClose }) {
  activePanel?.close();
  const y = scrollY;
  const dialog = document.createElement('dialog');
  dialog.className = 'proto-panel';
  dialog.dataset.kind = kind;
  dialog.setAttribute('aria-labelledby', 'proto-panel-title');
  const head = document.createElement('div');
  head.className = 'proto-panel-head';
  const heading = document.createElement('h2');
  heading.id = 'proto-panel-title';
  heading.className = 'proto-panel-title';
  heading.textContent = title;
  const closeButton = button(kind === 'full' ? '돌아가기' : '닫기', { onClick: () => closePanel() });
  closeButton.prepend(chevron(kind === 'full' ? 'left' : 'down'));
  const body = document.createElement('div');
  body.className = 'proto-panel-body';
  const restores = [];
  for (const el of Array.isArray(content) ? content : [content]) {
    if (!el) continue;
    if (el.isConnected) {
      const mark = document.createComment('prototype-panel-position');
      el.before(mark);
      restores.push(() => mark.replaceWith(el));
    }
    body.append(el);
  }
  head.append(heading, closeButton);
  dialog.append(head, body);
  document.body.append(dialog);
  const originalOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePanel(); } });
  let closed = false;
  const handle = { close: closePanel, dialog };
  activePanel = handle;
  function finish() {
    if (closed) return;
    closed = true;
    restores.forEach(restore => restore());
    dialog.remove();
    document.documentElement.style.overflow = originalOverflow;
    if (activePanel === handle) activePanel = null;
    onClose?.();
    window.scrollTo({ top: y, behavior: 'instant' });
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    updateState();
  }
  function closePanel() {
    if (dialog.open) dialog.close();
    finish();
  }
  dialog.addEventListener('close', finish, { once: true });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePanel(); });
  dialog.showModal();
  closeButton.focus({ preventScroll: true });
  return handle;
}
const api = { button, openPanel, navigate, updateState, get mobile() { return mobileQuery.matches; } };
function showScope(label = '이동') {
  const text = document.createElement('div');
  const p = document.createElement('p');
  p.className = 'proto-notice';
  p.textContent = `‘${label}’은 이번 모바일 비교 범위 밖입니다. 아래 다섯 화면의 배치와 열기·닫기, 입력 흐름을 비교할 수 있습니다. 이 시안은 실제 데이터를 등록하거나 변경하지 않습니다.`;
  text.append(p, makeScreenList());
  openPanel({ title: '모바일 시안 범위', content: text });
}
function makeScreenList() {
  const list = document.createElement('div');
  list.className = 'proto-menu-list';
  for (const [screen, label] of Object.entries(labels)) list.append(button(label, { variant: screen === currentScreen ? 'primary' : 'neutral', onClick: () => { activePanel?.close(); navigate(screen); } }));
  return list;
}
function showScreens() {
  const content = document.createElement('div');
  content.append(makeScreenList());
  const p = document.createElement('p');
  p.className = 'proto-notice';
  p.textContent = 'A는 원본 배치, B는 모바일 전환안입니다. 768px 이상은 둘 다 원본 배치입니다. 가상 시드 자료로 만든 비교 시안이며 새로고침하면 입력이 초기화됩니다.';
  content.append(p);
  content.append(button('입력 상태 보기', { onClick: () => {
    const state = document.createElement('pre'); state.className = 'proto-state';
    state.textContent = JSON.stringify({ screen: currentScreen, variant, values: values.get(currentScreen) || collectValues() }, null, 2);
    openPanel({ title: '시안의 메모리 상태', content: state });
  } }));
  openPanel({ title: '비교할 화면', content });
}
async function navigate(screen, hash = '', replace = false) {
  activePanel?.close();
  rememberValues();
  const url = new URL(location.href);
  url.searchParams.set('screen', screen);
  url.searchParams.set('variant', variant);
  url.hash = hash;
  (replace ? history.replaceState : history.pushState).call(history, {}, '', url);
  await render();
}
function applyHero() {
  const hero = root.querySelector('.participant-hero-card');
  if (!hero) return;
  const meta = hero.querySelector('.participant-hero-meta');
  if (meta) {
    const leaves = Array.from(meta.querySelectorAll('span')).filter(e => !e.children.length).map(e => e.textContent.trim()).filter(Boolean);
    if (leaves.length) {
      const wrap = document.createElement('div'); wrap.className = 'proto-hero-compact-meta';
      const program = document.createElement('div'); program.className = 'proto-hero-program'; program.textContent = leaves[0];
      const time = document.createElement('div'); time.className = 'proto-hero-time';
      for (const value of leaves.slice(1)) { const span = document.createElement('span'); span.textContent = value; time.append(span); }
      wrap.append(program, time); meta.replaceChildren(wrap);
    }
  }
}
function labelDate(date, full = false) {
  const d = new Date(date + 'T12:00:00Z');
  return `${full ? d.getUTCFullYear() + '년 ' : ''}${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${['일','월','화','수','목','금','토'][d.getUTCDay()]})`;
}
function addDays(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekStart(date) { const d = new Date(date + 'T12:00:00Z'); return addDays(date, -((d.getUTCDay() + 6) % 7)); }
function renderSchedule() {
  const list = root.querySelector('.schedule-day-list');
  if (!list) return;
  const first = scheduleView === 'week' ? weekStart(scheduleDate) : scheduleDate;
  const last = scheduleView === 'week' ? addDays(first, 6) : first;
  const rows = scheduleRows.filter(r => scheduleView === 'month' ? r.date.startsWith(scheduleDate.slice(0, 7)) : r.date >= first && r.date <= last);
  list.innerHTML = rows.map(r => r.html).join('');
  list.dataset.view = scheduleView;
  const details = Array.from(list.querySelectorAll(':scope>details'));
  details.forEach((d, i) => {
    const date = rows[i].date;
    d.open = scheduleView === 'day' || (scheduleView === 'week' ? date >= '2026-09-07' : date === '2026-09-07');
    if (scheduleView === 'day') d.querySelector('summary').hidden = true;
  });
  if (!rows.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = '이 기간의 시안 일정이 없습니다. 시안 자료는 2026년 9월 일정입니다.'; list.append(p);
  }
  const fullLabel = scheduleView === 'month' ? `${scheduleDate.slice(0,4)}년 ${Number(scheduleDate.slice(5,7))}월` : scheduleView === 'day' ? labelDate(first, true) : `${labelDate(first, true)}-${labelDate(last)}`;
  const label = root.querySelector('.schedule-period-label');
  label.textContent = variant === 'B' && mobileQuery.matches && scheduleView === 'week' ? `${labelDate(first)}-${new Date(last+'T12:00Z').getUTCDate()}일` : fullLabel;
  label.setAttribute('aria-label', fullLabel);
  label.title = fullLabel;
  root.querySelector('.schedule-view-select select').value = scheduleView;
  const url = new URL(location.href); url.searchParams.set('view', scheduleView); url.searchParams.set('date', scheduleDate); history.replaceState({}, '', url);
  updateState(`${scheduleView === 'day' ? '일간' : scheduleView === 'week' ? '주간' : '월간'} · 실제 저장 안 됨`);
}
function initSchedule() {
  const select = root.querySelector('.schedule-view-select select');
  select.addEventListener('change', () => { scheduleView = select.value; renderSchedule(); });
  if (variant === 'B' && mobileQuery.matches) {
    const today = root.querySelector('.schedule-nav-controls>.wire-button');
    today.classList.add('proto-today'); root.querySelector('.schedule-nav-actions').prepend(today);
  }
  renderSchedule();
}
function editSessionGoal(trigger) {
  const target = root.querySelector('.briefing-memo-item .wire-bullets-single .wire-meta-row>span');
  if (!target) return showScope('세션 목표 수정');
  const form = document.createElement('form'); form.className = 'proto-edit-form';
  const label = document.createElement('label'); label.textContent = '이번 상담 목표';
  const field = document.createElement('textarea'); field.value = sessionGoal ?? target.textContent;
  label.append(field);
  const note = document.createElement('p'); note.className = 'proto-notice'; note.textContent = '비교용 편집입니다. 이 탭의 시안에만 반영됩니다.';
  const actions = document.createElement('div'); actions.className = 'proto-edit-actions';
  let panel;
  actions.append(button('취소', { onClick: () => panel.close() }), button('시안에 반영', { variant: 'primary', onClick: () => { sessionGoal = field.value; target.textContent = sessionGoal; panel.close(); updateState('목표 문구를 시안에만 반영했습니다'); } }));
  form.append(label, note, actions);
  panel = openPanel({ title: '세션 목표 수정', content: form, trigger });
}
function syncThemeControls() {
  const label = document.documentElement.dataset.theme === 'dark' ? '라이트 모드' : '다크 모드';
  document.querySelectorAll('[aria-label="다크 모드"],[aria-label="라이트 모드"]').forEach(b => {
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
  });
}
function wireBaseInteractions() {
  root.querySelectorAll('input[type="hidden"]').forEach(el => el.remove());
  root.querySelectorAll('[action],[formaction]').forEach(el => { el.removeAttribute('action'); el.removeAttribute('formaction'); });
  root.querySelectorAll('form').forEach(form => form.noValidate = false);
  root.querySelectorAll('[data-proto-base-handler]').forEach(el => el.removeAttribute('data-proto-base-handler'));
  // Snapshot labels must not imply the real automatic-save service is connected.
  root.querySelectorAll('.record-side *').forEach(e => { if (!e.children.length && /자동 저장/.test(e.textContent)) e.textContent = '이 탭에서만 유지'; });
  const titleTexts = new Map([['상담 기록', '상담 기록하기'], ['상담 기록 확인', '상담 기록 확인하기']]);
  // Only B gets proposed mobile action labels; A and desktop remain pixel-comparable.
  if (variant === 'B' && mobileQuery.matches) root.querySelectorAll('.participant-hero-card .wire-button-text').forEach(e => { if (titleTexts.has(e.textContent)) e.textContent = titleTexts.get(e.textContent); });
  if (sessionGoal != null) root.querySelectorAll('.briefing-memo-item .wire-bullets-single .wire-meta-row>span,.record-rail-goal-body').forEach(t => t.textContent = sessionGoal || '등록된 상담 목표가 없습니다.');
  syncThemeControls();
}
async function render() {
  const version = ++renderVersion;
  root.removeAttribute('data-ready');
  activePanel?.close();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const params = new URLSearchParams(location.search);
  currentScreen = Object.hasOwn(labels, params.get('screen')) ? params.get('screen') : 'write';
  variant = params.get('variant') === 'A' ? 'A' : 'B';
  if (currentScreen === 'schedule') { scheduleView = ['day','week','month'].includes(params.get('view')) ? params.get('view') : scheduleView; if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')) scheduleDate = params.get('date'); }
  if (!snapshots.has(currentScreen)) snapshots.set(currentScreen, await fetch(`./sources/${currentScreen}.html`).then(r => r.text()));
  if (version !== renderVersion) return;
  const cssHref = `sources/${currentScreen}.css?v=2`;
  if (sourceStyle.getAttribute('href') !== cssHref) { await new Promise((resolve, reject) => { sourceStyle.onload = resolve; sourceStyle.onerror = reject; sourceStyle.href = cssHref; }); }
  if (version !== renderVersion) return;
  document.documentElement.dataset.protoVariant = variant;
  root.dataset.protoScreen = currentScreen;
  root.innerHTML = snapshots.get(currentScreen);
  root.querySelectorAll('input:not([type="hidden"]),textarea,select').forEach((e, i) => e.dataset.protoKey = `${e.id || e.name || 'field'}:${i}`);
  restoreValues();
  wireBaseInteractions();
  if (variant === 'B' && mobileQuery.matches) {
    applyHero();
    const init = { write: initWrite, participant: initParticipant, briefing: initBriefing, records: initRecords }[currentScreen];
    if (init) cleanup = init(root, api);
    if (currentScreen === 'write') {
      const heroActions = root.querySelector('.participant-hero-card .page-actions');
      const formActions = root.querySelector('.proto-write-actions');
      if (heroActions && formActions) {
        formActions.insertBefore(heroActions.querySelector('button'), formActions.lastElementChild);
        heroActions.remove();
      }
    }
  }
  if (currentScreen === 'schedule') initSchedule();
  document.querySelector('#proto-variant').textContent = variant === 'A' ? 'A 원본 배치' : 'B 모바일 전환';
  document.querySelector('#proto-variant').setAttribute('aria-label', `${variant === 'A' ? '원본 배치' : '모바일 전환안'}, 누르면 다른 시안`);
  document.title = `${labels[currentScreen]} | ${variant} 비교 시안`;
  await document.fonts.ready;
  window.scrollTo({ top: scrollPositions.get(currentScreen) || 0, behavior: 'instant' });
  if (location.hash) openHash(location.hash);
  updateState();
  root.dataset.ready = 'true';
}
function openHash(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  const target = document.getElementById(id);
  if (!target) return;
  const detail = target.matches('details[id^="record-"]') ? target : target.closest('details[id^="record-"]');
  if (detail && variant === 'B' && mobileQuery.matches) root.dispatchEvent(new CustomEvent('prototype:open-record', { detail: detail.id }));
  else { if (detail) detail.open = true; target.scrollIntoView({ block: 'start' }); }
}
function toggleVariant() {
  activePanel?.close(); rememberValues(); variant = variant === 'A' ? 'B' : 'A'; navigate(currentScreen, '', true);
}
document.querySelector('#proto-prev').append(chevron('left'));
document.querySelector('#proto-next').append(chevron('right'));
for (const id of ['proto-prev','proto-next','proto-variant']) document.getElementById(id).addEventListener('click', toggleVariant);
document.querySelector('#proto-screens').addEventListener('click', showScreens);
document.addEventListener('keydown', e => {
  if (activePanel || e.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); toggleVariant(); }
});
// All mutations are stopped at the prototype boundary. There is no original Next runtime or server action code.
document.addEventListener('submit', e => {
  e.preventDefault();
  if (!e.target.closest('#prototype-screen,.proto-panel')) return;
  if (!e.target.matches('form.record-form')) {
    showScope(e.submitter?.getAttribute('aria-label') || e.submitter?.textContent.trim() || '이동');
    return;
  }
  rememberValues(); savedValues.set(currentScreen, structuredClone(values.get(currentScreen)));
  updateState('시안 저장됨 · 실제 기록에는 반영 안 됨');
}, true);
document.addEventListener('input', e => { if (e.target.closest('#prototype-screen,.proto-panel')) { rememberValues(); updateState(); } });
document.addEventListener('change', e => { if (e.target.closest('#prototype-screen,.proto-panel')) { rememberValues(); updateState(); } });
document.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a && a.closest('#prototype-screen,.proto-panel')) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const original = new URL(a.getAttribute('href'), 'http://localhost:3100');
    if (currentScreen === 'schedule' && a.closest('.schedule-nav')) {
      if (a.getAttribute('aria-label') === '이전 기간' || a.getAttribute('aria-label') === '다음 기간') {
        const delta = a.getAttribute('aria-label') === '이전 기간' ? -1 : 1;
        if (scheduleView === 'month') { const d = new Date(scheduleDate + 'T12:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + delta); scheduleDate = d.toISOString().slice(0,10); }
        else scheduleDate = addDays(scheduleDate, delta * (scheduleView === 'week' ? 7 : 1));
        renderSchedule(); return;
      }
      if (a.textContent.trim() === '오늘') { scheduleDate = '2026-09-07'; renderSchedule(); return; }
    }
    if (/\/schedules\/[^/]+\/plan$/.test(original.pathname)) { editSessionGoal(a); return; }
    const entry = Object.entries(manifest).find(([key,v]) => Object.hasOwn(labels,key) && new URL(v.route, original.origin).pathname === original.pathname);
    if (entry) { navigate(entry[0], original.hash); return; }
    if (a.getAttribute('href').startsWith('#')) { openHash(original.hash); return; }
    showScope(a.textContent.trim() || a.getAttribute('aria-label') || '이동');
    return;
  }
  const b = e.target.closest('button');
  if (!b || !b.closest('#prototype-screen,.proto-panel') || e.defaultPrevented) return;
  if (b.classList.contains('page-back')) { e.preventDefault(); if (activePanel) activePanel.close(); else if (history.length > 1) history.back(); else navigate('schedule'); return; }
  const aria = b.getAttribute('aria-label');
  if (aria === '메뉴') {
    openPanel({ title: '메뉴', content: root.querySelector('#app-sidebar'), kind: 'navigation', trigger: b });
    return;
  }
  if (aria === '메뉴 닫기') { activePanel?.close(); return; }
  if (/다크 모드|라이트 모드/.test(aria || b.textContent)) {
    e.preventDefault();
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    syncThemeControls();
    return;
  }
  if (b.closest('.briefing-ai-goal-hint') && b.textContent.trim() === '닫기') { b.closest('.briefing-ai-goal-hint').remove(); return; }
  if (/^전체 (접기|열기)$/.test(b.textContent.trim())) {
    const open = b.textContent.includes('열기');
    root.querySelectorAll('main details').forEach(d => { if (variant === 'B' && mobileQuery.matches && d.id === 'briefing-remember') return; d.open = open; });
    const t = b.querySelector('.wire-button-text'); if (t) t.textContent = open ? '전체 접기' : '전체 열기';
  }
});
window.addEventListener('popstate', () => { rememberValues(); render(); });
mobileQuery.addEventListener('change', () => { activePanel?.close(); rememberValues(); render(); });
await render();
