'use client';

import { useRouter } from 'next/navigation';
import { Chevron } from '../../../components/wire/chevron';
import { WireToolbarField } from '../../../components/wire/wire-form-field';
import { scheduleViewHref, type ScheduleView } from './schedule-calendar';

const viewOptions: readonly { readonly value: ScheduleView; readonly label: string }[] = [
  { value: 'day', label: '일간' },
  { value: 'week', label: '주간' },
  { value: 'month', label: '월간' },
];

export function ScheduleViewSelect({
  basePath,
  view,
  anchor,
}: {
  readonly basePath: string;
  readonly view: ScheduleView;
  readonly anchor: string;
}) {
  const router = useRouter();

  return (
    <WireToolbarField label="기간 단위" className="schedule-view-select">
      <select
        aria-label="기간 단위"
        value={view}
        onChange={(event) => {
          const nextView = event.currentTarget.value as ScheduleView;
          router.push(scheduleViewHref(basePath, view, anchor, nextView));
        }}
      >
        {viewOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Chevron dir="down" />
    </WireToolbarField>
  );
}
