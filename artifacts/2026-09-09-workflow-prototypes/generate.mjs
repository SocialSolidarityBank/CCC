// Run with Bun after bundle.mjs. Generates five review-only HTML files from shared production components.
import { readFileSync } from 'node:fs';
import { pageComponent } from './prototype-app.tsx';
import { render, writePrototype } from './frame.mjs';

const css = readFileSync(new URL('./prototype.css', import.meta.url), 'utf8');
const pages = [
  { active: 'participant', filename: 'participant.html', title: '당사자 페이지' },
  { active: 'entry', filename: 'record-entry.html', title: '상담 기록하기' },
  { active: 'scheduleNew', filename: 'schedule-new.html', title: '일정 등록하기' },
  { active: 'participants', filename: 'participants.html', title: '당사자 목록' },
  { active: 'schedule', filename: 'schedule.html', title: '일정 보기' },
  { active: 'spacing', filename: 'spacing.html', title: '목록 간격 비교' },
];

for (const page of pages) {
  writePrototype({
    ...page,
    css,
    content: render(pageComponent(page.active)),
  });
}
