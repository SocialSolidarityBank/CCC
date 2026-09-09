// Review-only workflow prototypes. Synthetic data; no requests, storage or business writes.
import React from '../../apps/web/node_modules/react/index.js';
import { renderToStaticMarkup } from '../../apps/web/node_modules/react-dom/server.node.js';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../apps/web/app/components/wire/wire-styles.ts';
import { Icon } from '../../apps/web/app/components/wire/wire-icon.tsx';
import { NavIcon } from '../../apps/web/app/components/wire/shell-icons.tsx';

export const h = React.createElement;
export const render = renderToStaticMarkup;
const oldShell = new URL('../2026-09-08-participant-prototypes/shell.html', import.meta.url);
const datePickerCss = readFileSync(new URL('../../apps/web/node_modules/react-day-picker/src/style.css', import.meta.url), 'utf8');

const destinations = {
  participant: ['당사자 페이지', 'participant.html'],
  entry: ['상담 기록하기', 'record-entry.html'],
  scheduleNew: ['일정 등록하기', 'schedule-new.html'],
  participants: ['당사자 관리', 'participants.html'],
  schedule: ['일정 보기', 'schedule.html'],
  spacing: ['목록 간격 비교', 'spacing.html'],
};

function navigationShell(active) {
  let shell = readFileSync(oldShell, 'utf8')
    .replaceAll('상담 일정 보기', '일정 보기')
    .replaceAll('상담 일정 등록', '일정 등록하기')
    .replace(/ (?:data-current="true"|aria-current="page")/g, '')
    .replace('href="#prototype-only"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6"><\/circle><path d="M8 4.5V8l2.5 1.5"><\/path><\/svg><span>일정 보기<\/span>', 'href="schedule.html"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" rx="2"></rect><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"></path></svg><span>일정 보기</span>')
    .replace('href="#prototype-only"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" rx="2"><\/rect><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"><\/path><\/svg><span>일정 등록하기<\/span>', 'href="schedule-new.html"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" rx="2"></rect><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"></path><path d="M8 8.75v3.5M6.25 10.5h3.5"></path></svg><span>일정 등록하기</span>')
    .replace('href="#prototype-only"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="5.5" r="2.5"><\/circle><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"><\/path><\/svg><span>당사자 목록<\/span>', 'href="participants.html"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="5.5" r="2.5"></circle><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"></path></svg><span>당사자 관리</span>');

  const scheduleEnd = shell.indexOf('</ul>', shell.indexOf('일정 등록하기'));
  const entry = `<li><a class="navigation-link" href="record-entry.html">${render(h(NavIcon, { name: 'record' }))}<span>상담 기록하기</span></a></li>`;
  shell = `${shell.slice(0, scheduleEnd)}${entry}${shell.slice(scheduleEnd)}`;
  // 당사자 페이지는 사이드바에 두지 않는다(2026-09-09 Q). 목록 카드와 검토 도구가 입구다.

  const [, href] = destinations[active];
  return shell.replace(`href="${href}"`, `href="${href}" data-current="true" aria-current="page"`);
}

const commonCss = `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{font-family:'Pretendard Variable',sans-serif}
.prototype-main{padding-bottom:128px}
.prototype-controls{position:fixed;bottom:var(--space-4);left:50%;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:var(--space-2);width:max-content;max-width:calc(100vw - var(--space-6));padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-soft)}
.prototype-label,.prototype-safety{font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal);color:var(--sub)}
.prototype-toast{position:fixed;bottom:124px;left:50%;transform:translateX(-50%);z-index:1001;max-width:calc(100vw - var(--space-6));padding:var(--space-3) var(--space-4);background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius-card);font-size:var(--text-sm);line-height:var(--leading-normal);font-weight:400}
.prototype-main>[data-prototype-root]{display:grid;gap:var(--section-gap)}
[hidden]{display:none!important}
@media(max-width:767px){.prototype-main{padding-bottom:224px}.prototype-controls{width:calc(100vw - var(--space-6))}.prototype-label{flex-basis:100%;text-align:center}.prototype-toast{bottom:224px}}
`;

export function writePrototype({ filename, title, active, content, css = '', vendorScripts = [] }) {
  const controls = Object.entries(destinations).map(([key, [label, href]]) => `<a href="${href}" class="wire-button" data-variant="${key === active ? 'primary' : 'neutral'}"><span class="wire-button-text">${label}</span></a>`).join('');
  const scripts = [...vendorScripts, './client.js'].map((src) => `<script defer src="${src}"></script>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | 검토용 시안</title><style>${datePickerCss}\n${composeSharedCss(wireStyles)}\n${commonCss}\n${css}</style>${scripts}</head><body data-prototype-page="${active}"><div class="wire-shell app-shell workflow-prototype">${navigationShell(active)}<div class="content-column"><main class="page-content prototype-main"><div id="prototype-root" data-prototype-root>${content}</div></main></div></div><div class="prototype-controls" aria-label="시안 검토 도구"><span class="prototype-label">검토용 시안입니다. 합성 데이터만 쓰고 저장하지 않습니다.</span>${controls}<button class="wire-button" data-variant="neutral" type="button" id="prototype-theme"><span class="wire-button-text">다크 모드</span></button></div><div class="prototype-toast" id="prototype-toast" role="status" hidden></div><script>
window.prototypeNotice=(message)=>{const toast=document.getElementById('prototype-toast');toast.textContent=message;toast.hidden=false;clearTimeout(window.prototypeTimer);window.prototypeTimer=setTimeout(()=>toast.hidden=true,3500)};
window.prototypeSetCaseLabel=(label)=>document.querySelectorAll('.program-switcher:not(.org-switcher) .program-switcher-name').forEach((node)=>{node.textContent=label});
document.querySelectorAll('.wire-shell>header a,.wire-shell>.sidebar a').forEach((a)=>{if(!a.getAttribute('href')?.endsWith('.html')&&!a.getAttribute('href')?.includes('.html?'))a.addEventListener('click',(event)=>{event.preventDefault();window.prototypeNotice('화면 검토용 시안입니다. 실제 페이지로 이동하지 않습니다.')})});
document.querySelectorAll('.header-action-form').forEach((form)=>form.addEventListener('submit',(event)=>event.preventDefault()));
document.getElementById('prototype-theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('#prototype-theme span').textContent=dark?'라이트 모드':'다크 모드'});
// 정적 셸에도 운영과 같은 여닫기 계약을 붙인다: 손잡이, 닫기, 스크림, Esc, 초점 이동.
(()=>{const sidebar=document.getElementById('app-sidebar');const scrim=document.querySelector('.drawer-scrim');const handle=document.querySelector('.drawer-handle');if(!sidebar||!handle)return;const setOpen=(open)=>{if(open)sidebar.dataset.drawerOpen='true';else delete sidebar.dataset.drawerOpen;if(scrim){if(open)scrim.dataset.open='true';else delete scrim.dataset.open}handle.setAttribute('aria-expanded',open?'true':'false');if(open)sidebar.focus();else handle.focus()};handle.setAttribute('aria-expanded','false');handle.addEventListener('click',()=>setOpen(sidebar.dataset.drawerOpen!=='true'));document.querySelectorAll('.drawer-dismiss').forEach((button)=>button.addEventListener('click',()=>setOpen(false)));scrim?.addEventListener('click',()=>setOpen(false));document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&sidebar.dataset.drawerOpen==='true')setOpen(false)});sidebar.querySelectorAll('a').forEach((link)=>link.addEventListener('click',()=>setOpen(false)))})();
</script></body></html>`;
  writeFileSync(new URL(filename, import.meta.url), html);
  copyFileSync(new URL('../../apps/web/node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url), new URL('PretendardVariable.woff2', import.meta.url));
  console.log(`${filename}: generated from current shared components/styles`);
}
