import { addDays, copenhagenDate, dateLabel } from '@/domain/model';

export function notificationDateGroups(items: readonly { createdAt: string }[], today: string) {
  const yesterday = addDays(today, -1);
  const labels = items.map(({ createdAt }) => {
    const instant = Date.parse(createdAt);
    if (!Number.isFinite(instant)) return 'Uden dato';

    const day = copenhagenDate(instant);
    if (day === today) return 'I dag';
    if (day === yesterday) return 'I går';
    return day < today ? 'Tidligere' : dateLabel(day, { year: 'numeric' });
  });

  return labels.map((label, index) => ({
    heading: label !== labels[index - 1] ? label : undefined,
    isLastInGroup: label !== labels[index + 1],
  }));
}
