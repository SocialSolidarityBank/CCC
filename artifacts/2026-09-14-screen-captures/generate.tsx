// Screenshot artifacts only. No business data, credentials or runtime requests.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';
import { wireStyles } from '../../packages/wire/src/wire-styles';
import { Chevron, PageTitle, WireButton, WireCard } from '../../packages/wire/src/index';
import { NavIcon } from '../../apps/web/app/components/wire/shell-icons';
import * as forms from './forms';
import * as clinical from './clinical';
import * as overview from './overview';
import * as other from './other';

const modules = [forms, clinical, overview, other];
const pages = modules.flatMap(module => module.pages);
const slugs = new Set<string>();
for (const page of pages) {
  if (!/^[a-z0-9-]+$/.test(page.slug) || slugs.has(page.slug)) throw new Error(`Invalid/duplicate slug: ${page.slug}`);
  slugs.add(page.slug);
}
const local = (name: string) => new URL(name, import.meta.url);
// The frozen prototype used div-grid month cells; captures use the current table component.
// Omit its one-line month rules rather than overriding the canonical calendar layout.
const prototypeCss = readFileSync(new URL('../2026-09-09-workflow-prototypes/prototype.css', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.includes('.workflow-prototype .month-') && !line.includes('.workflow-prototype .calendar-event')).join('\n');
const css = composeSharedCss(wireStyles) + '\n' + prototypeCss + '\n' + modules.map(module => 'css' in module ? module.css : '').join('\n') + `
@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url('./PretendardVariable.woff2') format('woff2')}
body{font-family:'Pretendard Variable',sans-serif}
.capture-stack{display:grid;gap:var(--section-gap);min-width:0}
.capture-index-list{display:grid;gap:var(--space-3)}
.capture-index-description{font-size:var(--text-sm);font-weight:400;line-height:var(--leading-relaxed);color:var(--sub)}
`;
let shell = readFileSync(new URL('../2026-09-08-participant-prototypes/shell.html', import.meta.url), 'utf8')
  .replaceAll('마이크로크레딧 씬파일러 금융지원·멘토링', '함께온기금 울타리대출');
const navigation = [
  ['일정', [['일정 보기', 'calendar', 'schedule-week'], ['상담 일정 등록', 'calendar-plus', 'schedule-new-1'], ['상담 기록하기', 'record', 'record-entry']]],
  ['당사자', [['당사자 목록', 'participants', 'participants'], ['당사자 등록', 'participant-add', 'participant-new'], ['당사자 초대', 'invite', 'participant-invite']]],
] as const;
const menu = renderToStaticMarkup(<div className="navigation-groups">{navigation.map(([group, items]) => <div className="navigation-group" key={group}><p className="navigation-section-title">{group}</p><ul className="navigation-list">{items.map(([label, icon, slug]) => <li key={slug}><a className="navigation-link" href={`${slug}.html`}><NavIcon name={icon}/><span>{label}</span></a></li>)}</ul></div>)}</div>);
shell = shell.slice(0, shell.indexOf('<div class="navigation-groups">')) + menu + '</nav>';
const backLink = renderToStaticMarkup(<a href="index.html" className="page-back"><Chevron dir="left"/><span>뒤로</span></a>);
const prototypeSlugs = new Set<string>(overview.pages.map(page => page.slug));
function inert(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(?:action|formaction|on\w+)="[^"]*"/gi, '')
    .replace(/type="submit"/g, 'type="button"')
    .replace(/<input\b[^>]*type="hidden"[^>]*>/gi, '')
    .replace(/href="(?:https?:[^" ]*|\/(?!\/)[^"]*|#prototype-only)"/g, 'href="#"');
}
function documentHtml(title: string, body: string, isPublic = false, isPrototype = false) {
  const main = `<main class="page-content prototype-main${isPublic ? ' capture-public' : ''}"><div class="capture-stack">${body}</div></main>`;
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; font-src \'self\' data:; img-src \'self\' data:; form-action \'none\'; base-uri \'none\'"><title>' + title + ' | Relayer 화면 캡처</title><style>' + css + '</style></head><body' + (isPrototype ? ' class="workflow-prototype"' : '') + '>' + inert(isPublic ? main : `<div class="wire-shell app-shell">${shell}<div class="content-column"><nav class="page-backbar" aria-label="페이지 이동">${backLink}</nav>${main}</div></div>`) + '</body></html>';
}
for (const page of pages) {
  const heading = <PageTitle>{'heading' in page && typeof page.heading === 'string' ? page.heading : page.title}</PageTitle>;
  const header = 'headerActions' in page && React.isValidElement(page.headerActions) ? <div className="page-header">{heading}{page.headerActions}</div> : heading;
  let body = renderToStaticMarkup(<>{header}{page.content}</>);
  if (page.slug === 'record-entry') body = await clinical.populateRecordHtml(body);
  // 종결 사유 textarea 는 원본에 초기값이 없다. 캡처에서만 합성 문장을 넣는다(§7 채운 시안).
  if (page.slug === 'case-close') body = body.replace(/(<textarea id="close-reason"[^>]*>)<\/textarea>/, '$1대출 상환을 모두 마치고 자립 생활이 안정돼 당사자와 합의해 종결한다.</textarea>');
  writeFileSync(local(`${page.slug}.html`), documentHtml(page.title, body, page.public, prototypeSlugs.has(page.slug)));
}
const groups = [...new Set(pages.map(page => page.group))];
const index = renderToStaticMarkup(<><PageTitle>Relayer 화면 모음</PageTitle><p className="capture-index-description">캡처 전용 정적 화면 {pages.length}개입니다. 모든 인물과 상담 내용은 가상이며, 저장이나 외부 통신을 하지 않습니다. 각 탭과 작성 단계는 별도 파일로 열립니다. 브라우저 확대율 100%, 화면 너비 1440px을 권장합니다. 함께 제공한 PretendardVariable.woff2를 HTML과 같은 폴더에 두면 인터넷 없이 같은 글꼴로 열 수 있습니다. 압축을 푼 폴더를 그대로 유지하세요.</p>{groups.map(group => <WireCard title={group} key={group}><div className="capture-index-list">{pages.filter(page => page.group === group).map(page => <div key={page.slug}><WireButton href={`${page.slug}.html`} variant="neutral">{page.title}</WireButton><div className="capture-index-description">{page.slug}.html</div></div>)}</div></WireCard>)}<p className="capture-index-description">기존 프리뷰 디자인 소스를 바탕으로 재구성한 캡처용 시안입니다. 배포된 서버의 HTML을 내려받은 사본은 아닙니다. 당사자 정보는 요청하신 회차별 요약, 목표, 정보의 세 탭으로 나누었으며, 배치와 색은 기존 워크플로 시안을 따릅니다.</p></>);
writeFileSync(local('index.html'), documentHtml('화면 모음', index));
copyFileSync(new URL('../../apps/web/node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url), local('PretendardVariable.woff2'));
writeFileSync(local('manifest.json'), JSON.stringify({ syntheticOnly: true, scripts: false, baseline: 'DESIGN preview source and 2026-09-09 workflow prototype', pages: pages.map(page => ({slug:page.slug,title:page.title,group:page.group,source:page.source,public:page.public ?? false})) }, null, 2));
console.log(`Generated ${pages.length} capture pages + index.html; shared local font; scripts and form actions removed.`);
