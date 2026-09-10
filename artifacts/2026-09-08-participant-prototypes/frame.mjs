// Review-only prototypes. No business requests, persistence or production routes.
import React from '../../apps/web/node_modules/react/index.js';
import { renderToStaticMarkup } from '../../apps/web/node_modules/react-dom/server.node.js';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../apps/web/app/components/wire/wire-styles.ts';
import { Icon } from '../../apps/web/app/components/wire/wire-icon.tsx';
export { ParticipantHeroCard } from '../../apps/web/app/components/wire/participant-hero-card.tsx';
export { WireCard, WireCardDetails, WireBullets, WireField } from '../../apps/web/app/components/wire/wire-card.tsx';
export { WireCardSection, WireItem } from '../../apps/web/app/components/wire/wire-section.tsx';
export { WireButton } from '../../apps/web/app/components/wire/wire-button.tsx';
export { WireBadge } from '../../apps/web/app/components/wire/wire-badge.tsx';
export { WireTabs, WireTab } from '../../apps/web/app/components/wire/wire-tabs.tsx';
export { WireFormField, WireChoice } from '../../apps/web/app/components/wire/wire-form-field.tsx';
export { WireQuote, WireCallout } from '../../apps/web/app/components/wire/wire-callout.tsx';
export { PageTitle } from '../../apps/web/app/components/wire/page-title.tsx';
export { Chevron } from '../../apps/web/app/components/wire/chevron.tsx';
export const h = React.createElement;
export const fragment = React.Fragment;
export const render = renderToStaticMarkup;
const here = fileURLToPath(new URL('.', import.meta.url));
export function writePrototype({ filename, title, content, css = '', script = '', active }) {
  let shell = readFileSync(`${here}shell.html`, 'utf8');
  shell = shell.replaceAll('상담 일정 등록', '일정 등록하기');
  if (active === 'entry') shell = shell.replace(/ (?:data-current="true"|aria-current="page")/g, '');
  const scheduleEnd = shell.indexOf('</li>', shell.indexOf('일정 등록하기')) + 5;
  const recordEntry = `<li><a class="navigation-link" href="record-entry.html"${active === 'entry' ? ' data-current="true" aria-current="page"' : ''}>${render(h(Icon, { name: 'arrow-right' }))}<span>상담 기록하기</span></a></li>`;
  shell = `${shell.slice(0, scheduleEnd)}${recordEntry}${shell.slice(scheduleEnd)}`;
  const commonCss = `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{font-family:'Pretendard Variable',sans-serif}
.prototype-main{padding-bottom:112px}
.prototype-controls{position:fixed;bottom:var(--space-4);left:50%;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:var(--space-2);max-width:calc(100vw - var(--space-6));padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-soft)}
.prototype-label{font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal);color:var(--sub)}
.prototype-toast{position:fixed;bottom:112px;left:50%;transform:translateX(-50%);z-index:1001;max-width:calc(100vw - var(--space-6));padding:var(--space-3) var(--space-4);background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius-card);font-size:var(--text-sm);line-height:var(--leading-normal);font-weight:400}
[hidden]{display:none!important}
@media(max-width:767px){.prototype-main{padding-bottom:160px}.prototype-controls{width:calc(100vw - var(--space-6))}.prototype-label{flex-basis:100%;text-align:center}.prototype-toast{bottom:160px}}
`;
  const control = (label, href, selected) => `<a href="${href}" class="wire-button" data-variant="${selected ? 'primary' : 'neutral'}"><span class="wire-button-text">${label}</span></a>`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | 검토용 시안</title><style>${composeSharedCss(wireStyles)}\n${commonCss}\n${css}</style></head><body><div class="wire-shell app-shell">${shell}<div class="content-column"><main class="page-content prototype-main">${content}</main></div></div><div class="prototype-controls" aria-label="시안 검토 도구"><span class="prototype-label">시안 · 가상 데이터 · 저장 없음</span>${control('당사자 통합', 'participant.html', active === 'participant')}${control('기록 입구', 'record-entry.html', active === 'entry')}<button class="wire-button" data-variant="neutral" type="button" id="prototype-theme"><span class="wire-button-text">다크 모드</span></button></div><div class="prototype-toast" id="prototype-toast" role="status" hidden></div><script>
window.prototypeNotice=(message)=>{const toast=document.getElementById('prototype-toast');toast.textContent=message;toast.hidden=false;clearTimeout(window.prototypeTimer);window.prototypeTimer=setTimeout(()=>toast.hidden=true,3500)};
document.querySelectorAll('.wire-shell>header a,.wire-shell>.sidebar a').forEach(a=>{if(!a.getAttribute('href')?.endsWith('.html'))a.addEventListener('click',e=>{e.preventDefault();window.prototypeNotice('화면 검토용 시안입니다. 실제 페이지로 이동하지 않습니다.')})});
document.querySelectorAll('form').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();window.prototypeNotice('시안에서는 데이터를 저장하지 않습니다.')}));
document.getElementById('prototype-theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('#prototype-theme span').textContent=dark?'라이트 모드':'다크 모드'});
${script}
</script></body></html>`;
  writeFileSync(`${here}${filename}`, html);
  copyFileSync(new URL('../../apps/web/node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url), `${here}PretendardVariable.woff2`);
  console.log(`${filename}: generated from main dc89aa9 shared components/styles`);
}
