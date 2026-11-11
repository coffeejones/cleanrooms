import { BottomSheet, RNHostView } from '@expo/ui';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PeriodArrows } from '@/components/period-arrows';
import { IconButton, Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';

const monthNames = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December',
];
const monthsPerRow = 3;

export function CalendarMonthPicker({ year, selectedMonth, currentMonth, visible, onYearChange, onSelect, onDismiss }: {
  year: number;
  selectedMonth: string;
  currentMonth: string;
  visible: boolean;
  onYearChange: (offset: -1 | 1) => void;
  onSelect: (month: string) => void;
  onDismiss: () => void;
}) {
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onDismiss}
      snapPoints={['half', 'full']}
      containerColor={colors.surface}
      contentPadding={{ top: 12, bottom: 20, left: 20, right: 20 }}
    >
      <RNHostView>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          <View style={styles.form}>
            <Row gap={8}>
              <Txt accessibilityRole="header" size={20} weight="700" style={styles.heading}>Vælg måned</Txt>
              <IconButton name="x" label="Luk valg af måned" onPress={onDismiss} />
            </Row>
            <Row gap={12} style={styles.yearBar}>
              <Txt size={19} weight="700" accessibilityLiveRegion="polite">{year}</Txt>
              <PeriodArrows
                previousLabel="Forrige år"
                nextLabel="Næste år"
                onPrevious={() => onYearChange(-1)}
                onNext={() => onYearChange(1)}
              />
            </Row>
            <View style={styles.grid}>
              {Array.from({ length: monthNames.length / monthsPerRow }, (_, row) => {
                const firstMonth = row * monthsPerRow;
                return (
                  <Row key={row} gap={8} style={styles.monthRow}>
                    {monthNames.slice(firstMonth, firstMonth + monthsPerRow).map((name, column) => {
                      const monthNumber = String(firstMonth + column + 1).padStart(2, '0');
                      const month = `${String(year).padStart(4, '0')}-${monthNumber}`;
                      const selected = month === selectedMonth;
                      const current = month === currentMonth;
                      return (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          accessibilityLabel={`${name} ${year}${current ? ', indeværende måned' : ''}`}
                          accessibilityState={{ selected }}
                          onPress={() => onSelect(`${month}-01`)}
                          style={({ pressed }) => [
                            styles.month, (selected || current) && styles.outlinedMonth,
                            selected && styles.selected, pressed && styles.pressed,
                          ]}
                        >
                          <Txt
                            size={14}
                            weight={selected ? '700' : '500'}
                            color={selected ? colors.accent : colors.ink}
                            selectable={false}
                            style={styles.monthLabel}
                          >
                            {name}
                          </Txt>
                        </Pressable>
                      );
                    })}
                  </Row>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  form: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 10, paddingBottom: 4 },
  heading: { flex: 1, minWidth: 0, letterSpacing: -0.3 },
  yearBar: { justifyContent: 'space-between' },
  grid: { gap: 8 },
  monthRow: { alignItems: 'stretch' },
  month: {
    flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 5, paddingVertical: 8, backgroundColor: colors.paper, borderRadius: 10,
    borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent',
  },
  outlinedMonth: { borderColor: '#a5b6af' },
  selected: { backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
  monthLabel: { textAlign: 'center' },
});
