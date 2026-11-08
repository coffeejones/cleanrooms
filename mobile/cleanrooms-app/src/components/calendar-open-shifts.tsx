import { StyleSheet, View } from 'react-native';
import { ShiftRow } from '@/components/shift-row';
import { EmptyState, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { dateLabel, futureOpenShifts, type Shift } from '@/domain/model';
import { useNow } from '@/state/app-store';

export function CalendarOpenShifts({ shifts }: { shifts: Shift[] }) {
  const now = useNow();
  const openShifts = futureOpenShifts(shifts, now)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const groups = new Map<string, Shift[]>();
  for (const shift of openShifts) {
    const group = groups.get(shift.date);
    if (group) group.push(shift);
    else groups.set(shift.date, [shift]);
  }

  return (
    <View style={cardStyles.listSurface}>
      <View style={styles.heading}>
        <Txt accessibilityRole="header" size={16} weight="700" style={styles.title}>Kommende vagter</Txt>
      </View>
      <View style={cardStyles.divider}>
        {groups.size === 0 ? <EmptyState title="Ingen ledige vagter" /> : (
          Array.from(groups, ([date, dayShifts], groupIndex) => (
            <View key={date} style={groupIndex > 0 && cardStyles.divider}>
              <View style={styles.dateHeading}>
                <Txt accessibilityRole="header" size={13} weight="600" color={colors.muted}>
                  {dateLabel(date, { weekday: 'long', month: 'long' })}
                </Txt>
              </View>
              {dayShifts.map((shift, index) => (
                <View key={shift.id} style={[styles.row, index > 0 && cardStyles.divider]}>
                  <ShiftRow shift={shift} showDate={false} />
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: cardColors.section,
  },
  title: { letterSpacing: -.3 },
  dateHeading: { paddingTop: 9, paddingHorizontal: 14 },
  row: { paddingHorizontal: 14 },
});
