import { addDays, copenhagenDate, dateLabel, TIME_ZONE } from './model';

const clock = new Intl.DateTimeFormat('da-DK', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit',
});

export function chatListTimestamp(value: string | undefined, today: string): string {
  if (!value) return '';
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return '';
  const day = copenhagenDate(instant);
  if (day === today) return clock.format(instant);
  if (day === addDays(today, -1)) return 'I går';
  return dateLabel(day, { year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}
