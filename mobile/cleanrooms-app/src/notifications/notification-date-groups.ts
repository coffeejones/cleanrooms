import { addDays, copenhagenDate, dateLabel, TIME_ZONE } from '../domain/model';

const time = new Intl.DateTimeFormat('da-DK', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit',
});
const dateAndTime = new Intl.DateTimeFormat('da-DK', {
  timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function notificationDateGroups(items: readonly { createdAt: string }[], today: string) {
  const yesterday = addDays(today, -1);
  const dates = items.map(({ createdAt }) => {
    const instant = Date.parse(createdAt);
    if (!Number.isFinite(instant)) return { label: 'Uden dato', timestamp: '' };

    const day = copenhagenDate(instant);
    if (day === today || day === yesterday) {
      return { label: day === today ? 'I dag' : 'I går', timestamp: time.format(instant) };
    }
    return {
      label: day < today ? 'Tidligere' : dateLabel(day, { year: 'numeric' }),
      timestamp: dateAndTime.format(instant),
    };
  });

  return dates.map(({ label, timestamp }, index) => ({
    heading: label !== dates[index - 1]?.label ? label : undefined,
    isLastInGroup: label !== dates[index + 1]?.label,
    timestamp,
  }));
}
