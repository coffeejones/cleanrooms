import { StyleSheet, View } from 'react-native';
import { colors } from '@/constants/palette';
import { dateLabel, shiftTimeLabel, type NotificationShiftSnapshot } from '@/domain/model';
import { Row, Txt } from './ui';

export function notificationShiftChange(before: Partial<NotificationShiftSnapshot>, after: Partial<NotificationShiftSnapshot>) {
  const acrossYears = before.date?.slice(0, 4) !== after.date?.slice(0, 4);
  const format = (shift: Partial<NotificationShiftSnapshot>) => [
    dateLabel(shift.date ?? '', { weekday: 'short', year: acrossYears ? 'numeric' : undefined }),
    shift.start && shift.end ? shiftTimeLabel({ start: shift.start, end: shift.end }) : '',
    shift.siteName,
  ];
  const previous = format(before);
  const earlier: string[] = [];
  const updated: string[] = [];
  const context: string[] = [];
  format(after).forEach((value, index) => {
    const oldValue = previous[index];
    if (oldValue && value && oldValue !== value) {
      earlier.push(oldValue);
      updated.push(value);
    } else if (value) {
      context.push(value);
    }
  });
  if (Number.isFinite(before.plannedBreakMinutes) && Number.isFinite(after.plannedBreakMinutes) &&
    before.plannedBreakMinutes !== after.plannedBreakMinutes) {
    earlier.push(`Pause ${before.plannedBreakMinutes} min`);
    updated.push(`Pause ${after.plannedBreakMinutes} min`);
  }
  if (!earlier.length) return null;

  const oldValue = earlier.join(' · ');
  const newValue = updated.join(' · ');
  return {
    before: oldValue, after: newValue, context: context.join(' · '),
    spoken: [`Før ${oldValue}`, `Nu ${newValue}`, ...context].join(', '),
  };
}

export function NotificationShiftChange({ change }: { change: NonNullable<ReturnType<typeof notificationShiftChange>> }) {
  return (
    <View style={styles.comparison}>
      <Row gap={7} style={styles.row}>
        <Txt size={12} weight="500" color={colors.muted} style={styles.label}>Før</Txt>
        <Txt size={13} color={colors.muted} style={styles.value}>{change.before}</Txt>
      </Row>
      <Row gap={7} style={styles.row}>
        <Txt size={12} weight="500" color={colors.muted} style={styles.label}>Nu</Txt>
        <Txt size={13} weight="600" style={styles.value}>{change.after}</Txt>
      </Row>
      {!!change.context && <Txt size={12} color={colors.muted}>{change.context}</Txt>}
    </View>
  );
}

const styles = StyleSheet.create({
  comparison: { gap: 3 },
  row: { alignItems: 'baseline' },
  label: { minWidth: 24 },
  value: { flex: 1, minWidth: 0 },
});
